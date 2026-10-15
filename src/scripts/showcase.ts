/** Browser code for the sample cards: renders recipes, gallery examples, and private runs. */
import { SHOWCASES, type DemoSource, type Showcase } from '../showcases/catalog';
import { showInspector, type InspectorView, type SourceFile } from './inspector';
import type {
  CreativeRecord,
  Derivative,
  EditorialRecord,
  GalleryExample,
  Mode,
  PresetKey,
  PrivateResult,
  SourceIdentity,
  SourceSnapshot,
} from './run-types';

/** JSON returned by the server; client code does not import Worker binding types. */
type DisplayPlan = {
  family: string;
  variant: string;
  path: 'binding' | 'cf.image';
  transforms: Record<string, unknown>[];
  overlay?: Record<string, unknown>;
  fetchOptions?: { width: number; fit: string; format: string; quality: string };
  output: { format: string; quality?: number | string; anim?: boolean };
  requestPolicy?: { negotiated: string; saveData: boolean };
  focalPoint?: { x: number; y: number };
};

type RequestDetails = {
  kind: 'request';
  family: Showcase;
  variant: string;
  source: DemoSource;
  plan: DisplayPlan;
  version: string;
  planDigest: string;
  imageUrl: string;
  code: SourceFile[];
  execution: string;
};

type WorkflowDetails = {
  kind: 'workflow';
  family: Showcase;
  variant: string;
  source: DemoSource;
  version: string;
  code: SourceFile[];
  execution: string;
};

interface SampleCard {
  node: HTMLElement;
  family: string;
  status: HTMLElement;
  inspector: HTMLElement;
  source?: HTMLSelectElement;
  variant?: HTMLSelectElement;
  previousUrl?: string;
  controller?: AbortController;
  rendered: boolean;
}

const cards = new Map<string, SampleCard>();
const acceptScenarios: Record<string, string> = {
  avif: 'image/avif,image/webp;q=0.8,image/jpeg;q=0.7',
  webp: 'image/avif;q=0,image/webp,image/jpeg;q=0.7',
  jpeg: 'image/avif;q=0,image/webp;q=0,image/jpeg',
};

function integerHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function control<T extends HTMLElement>(node: HTMLElement, query: string): T {
  const result = node.querySelector<T>(query);
  if (!result) throw new Error(`Missing sample control: ${query}`);
  return result;
}

async function json<T>(response: Response): Promise<T> {
  const body: T & { error?: string } = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Sample returned HTTP ${response.status}.`);
  return body;
}

async function imageDimensions(url: string): Promise<string> {
  const image = new Image();
  return new Promise((resolve) => {
    image.onload = () => resolve(`${image.naturalWidth} × ${image.naturalHeight} px`);
    image.onerror = () => resolve('Decode unavailable');
    image.src = url;
  });
}

function headersFor(card: SampleCard): Headers {
  const headers = new Headers();
  if (card.family === 'responsive') {
    const scenario = control<HTMLSelectElement>(card.node, '[data-sample-accept]').value;
    headers.set('accept', acceptScenarios[scenario]);
    if (control<HTMLSelectElement>(card.node, '[data-sample-save]').value === 'on') {
      headers.set('save-data', 'on');
    }
  }
  return headers;
}

function cacheDescription(value: string | null): { title: string; cached: boolean } {
  const cache = value?.toUpperCase() ?? null;
  if (cache === 'HIT' || cache === 'STALE' || cache === 'UPDATING' || cache === 'REVALIDATED') {
    return { title: `${cache} · reused cached encoding`, cached: true };
  }
  return {
    title: cache ? `${cache} · Worker response` : 'Edge cache status not reported',
    cached: false,
  };
}

function humanSavings(source: number | null, output: number): string {
  if (!source) return 'Source byte count unavailable; no savings calculation.';
  const percentage = Math.abs(Math.round((1 - output / source) * 100));
  return output <= source
    ? `${percentage}% smaller than the actual public original (${source.toLocaleString()} B).`
    : `${percentage}% larger than the actual public original (${source.toLocaleString()} B).`;
}

async function renderSample(card: SampleCard): Promise<void> {
  card.controller?.abort();
  card.status.classList.remove('error');
  const controller = new AbortController();
  card.controller = controller;
  const button = control<HTMLButtonElement>(card.node, '[data-sample-run]');
  button.disabled = true;
  card.status.textContent =
    'Resolving bounded parameters and transforming the selected public original…';
  try {
    const query = new URLSearchParams({
      source: card.source!.value,
      family: card.family,
      variant: card.variant!.value,
    });
    if (card.family === 'framing' && card.variant?.value === 'point') {
      const selected = control<HTMLButtonElement>(card.node, '[data-point][aria-pressed="true"]');
      query.set('point', selected.dataset.point!);
    }
    const headers = headersFor(card);
    const details = await json<RequestDetails>(
      await fetch(`/api/showcase/details?${query}`, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      }),
    );
    if (details.kind !== 'request') throw new Error('A request-time recipe was expected.');

    const started = performance.now();
    const response = await fetch(details.imageUrl, { headers, signal: controller.signal });
    if (!response.ok) {
      const failure: { error?: string } = await response.json();
      throw new Error(failure.error ?? `Image returned HTTP ${response.status}.`);
    }
    const elapsedMs = Math.round(performance.now() - started);
    const mime = response.headers.get('content-type')?.split(';')[0] ?? 'unknown';
    if (!mime.startsWith('image/')) throw new Error('The response was not an image.');
    if (
      response.headers.get('x-workbench-recipe-version') !== details.version ||
      response.headers.get('x-workbench-source-sha256') !== details.source.sha256 ||
      response.headers.get('x-workbench-plan-digest') !== details.planDigest
    ) {
      throw new Error('The returned image did not match the inspected recipe. Refresh and retry.');
    }
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    const dimensions = await imageDimensions(imageUrl);
    if (controller.signal.aborted) {
      URL.revokeObjectURL(imageUrl);
      return;
    }
    if (card.previousUrl) URL.revokeObjectURL(card.previousUrl);
    card.previousUrl = imageUrl;

    const sourceBytes = integerHeader(response.headers, 'x-workbench-source-bytes');
    const processingMs = integerHeader(response.headers, 'x-workbench-operation-ms');
    const cache = cacheDescription(response.headers.get('cf-cache-status'));
    const responseAt = response.headers.get('x-workbench-response-at');
    const perceptual = details.plan.path === 'cf.image';
    const note = `${humanSavings(sourceBytes, blob.size)} ${cache.title}. ${cache.cached ? 'The Worker timestamp and operation duration refer to the earlier response, not this request.' : perceptual ? 'Perceptual WebP ran through fetch(cf.image); its internal resized-image cache may have been reused.' : 'The Images binding encoded the selected public original.'}`;
    const view: InspectorView = {
      id: `sample-${card.family}`,
      source: {
        label: 'Versioned public original',
        url: details.source.asset,
        alt: details.source.alt,
        dimensions: `${details.source.width} × ${details.source.height} px`,
        mime:
          details.source.asset.endsWith('.jpeg') || details.source.asset.endsWith('.jpg')
            ? 'image/jpeg'
            : undefined,
        bytes: sourceBytes,
        credit: details.source.credit,
        creditUrl: details.source.creditUrl,
      },
      output: {
        label: `Encoded output · ${details.family.title}`,
        url: imageUrl,
        alt: `Transformed ${details.source.title}: ${details.variant}`,
        dimensions,
        mime,
        bytes: blob.size,
      },
      resultNote: note,
      context: details.execution,
      flow: details.family.flow,
      flowNote: cache.cached
        ? 'This request was served from cache: the Worker and image-operation path were not rerun.'
        : perceptual
          ? 'The Worker fetched a versioned public asset with cf.image perceptual quality. The subrequest can reuse its own resized-image cache; the response status below describes this Worker’s edge cache.'
          : 'The image URL selects only approved assets and variants. Responses are cacheable; cache behavior is reported from the actual response.',
      code: details.code,
      codeNote:
        'These are marked excerpts extracted from deployed server files. The resolved plan in Run details was passed into this handler; no pseudocode or bearer tokens are included.',
      resolved: details.plan,
      details: {
        'Recipe / variant': `${details.family.id} / ${details.variant}`,
        'Recipe source version': details.version,
        'Resolved plan digest': details.planDigest,
        'Demo source SHA-256': details.source.sha256,
        'Source asset path': details.source.asset,
        'Shareable recipe URL': details.imageUrl,
        'Image operation': response.headers.get('x-workbench-operation'),
        'Requested output MIME': details.plan.output.format,
        'Observed output MIME': mime,
        'Observed output dimensions': dimensions,
        'Observed output bytes': blob.size,
        'Actual original bytes': sourceBytes,
        'Edge cache status': response.headers.get('cf-cache-status'),
        'Worker response at (from response)': responseAt,
        'Image operation (ms; prior run if cached)': processingMs,
        'Browser elapsed time (ms; not Worker CPU)': elapsedMs,
        'Request Accept (if set)':
          headers.get('accept') ?? 'Browser-defined / not observed by client',
        'Request Save-Data (if set)': headers.get('save-data') ?? 'Not set in this example',
      },
    };
    showInspector(card.inspector, view);
    card.status.textContent = `${dimensions} · ${mime} · ${blob.size.toLocaleString()} B · ${cache.title}`;
    card.rendered = true;
  } catch (error) {
    if (controller.signal.aborted) return;
    card.status.textContent =
      error instanceof Error ? error.message : 'Could not render this sample.';
    card.status.classList.add('error');
  } finally {
    if (card.controller === controller) button.disabled = false;
  }
}

async function showWorkflowReference(card: SampleCard): Promise<void> {
  try {
    const family = card.family;
    const variant =
      family === 'pipeline' ? 'editorial' : family === 'editorial-ai' ? 'focal' : 'creative';
    const source =
      family === 'pipeline' ? 'colmar' : family === 'editorial-ai' ? 'portrait' : 'product';
    const details = await json<WorkflowDetails>(
      await fetch(`/api/showcase/details?${new URLSearchParams({ source, family, variant })}`, {
        cache: 'no-store',
      }),
    );
    if (card.rendered) return;
    showInspector(card.inspector, {
      id: `sample-${family}`,
      source: {
        label: 'Public reference photo · not processed by this Workflow',
        url: details.source.asset,
        alt: details.source.alt,
        dimensions: `${details.source.width} × ${details.source.height} px`,
        credit: details.source.credit,
        creditUrl: details.source.creditUrl,
      },
      resultNote:
        'No completed run is loaded. The public reference photo is not presented as a generated derivative.',
      context: details.execution,
      flow: details.family.flow,
      flowNote:
        'Generation runs in durable steps after an authorized upload. Previewing a completed result later retrieves stored R2 bytes.',
      code: details.code,
      codeNote:
        'Current reference source, extracted from this build. Until a matching provenance record is loaded, this is not claimed as the source that produced an older image.',
      resolved: { selection: `${details.family.id}/${variant}`, outcome: 'Awaiting completed run' },
      details: {
        'Current reference version': details.version,
        'Generation status': 'No completed run selected',
        'Source identity / historical recipe': 'Unavailable until a run record is loaded',
      },
    });
  } catch {
    card.status.textContent = 'Workflow reference details are temporarily unavailable.';
  }
}

type WorkflowFamily = 'pipeline' | 'editorial-ai' | 'synthetic';
type StoredRun = {
  family: WorkflowFamily;
  sourceUrl: string | null;
  sourceLabel: string;
  sourceAlt: string;
  sourceCredit?: string;
  sourceBytes: number | null;
  resultUrl: string | null;
  resultAlt: string;
  resultBytes: number | null;
  record: EditorialRecord | CreativeRecord | null;
  derivative: Derivative | null;
  gallery: boolean;
  message: string;
};

function storedCode(run: StoredRun): SourceSnapshot | null {
  if (run.family === 'synthetic') {
    return (run.record as CreativeRecord | null)?.snapshot ?? null;
  }
  const editorial = run.record as EditorialRecord | null;
  return run.family === 'pipeline'
    ? (editorial?.snapshots.pipeline ?? null)
    : (editorial?.snapshots['editorial-ai'] ?? null);
}

function storedSource(record: EditorialRecord | CreativeRecord | null): SourceIdentity | null {
  return record?.source ?? null;
}

async function storedView(id: string, run: StoredRun): Promise<InspectorView> {
  const info = SHOWCASES.find((sample) => sample.id === run.family)!;
  const snapshot = storedCode(run);
  const identity = storedSource(run.record);
  const sourceDimensions = run.sourceUrl ? await imageDimensions(run.sourceUrl) : undefined;
  const dimensions = run.resultUrl ? await imageDimensions(run.resultUrl) : undefined;
  const status = run.record
    ? 'Recorded generation · R2 retrieval now'
    : 'Historical generation details unavailable';
  const originalBytes = identity?.bytes ?? null;
  const context = `Upload-time Queue / PROCESS_IMAGE Workflow · ${run.gallery ? 'approved gallery R2 object' : 'capability-protected R2 object'} served later`;
  const resolved = run.derivative
    ? {
        transform: run.derivative.transform,
        output: run.derivative.output,
        model: run.record?.kind === 'creative' ? run.record.model : (run.record?.analysis ?? null),
        ...(run.record?.kind === 'creative'
          ? { prompt: run.record.prompt, generation: run.record.generation ?? null }
          : {}),
      }
    : { state: 'No generation-matched transform record for this selection' };

  return {
    id,
    source: run.sourceUrl
      ? {
          url: run.sourceUrl,
          alt: run.sourceAlt,
          label: run.sourceLabel,
          dimensions: sourceDimensions,
          mime: 'image/webp',
          bytes: run.sourceBytes,
          credit: run.sourceCredit,
          // Gallery credit is descriptive text, not an unverified external URL.
        }
      : undefined,
    output: run.resultUrl
      ? {
          url: run.resultUrl,
          alt: run.resultAlt,
          label:
            run.family === 'synthetic'
              ? 'Clearly synthetic · stored WebP'
              : 'Pre-generated editorial WebP',
          dimensions,
          mime: 'image/webp',
          bytes: run.resultBytes,
        }
      : undefined,
    resultNote: `${run.message} ${run.resultUrl && run.resultBytes !== null ? humanSavings(originalBytes, run.resultBytes) : ''} This selection retrieves an existing R2 object, not a new image transformation.`,
    context,
    flow: info.flow,
    flowNote: run.record
      ? `Recorded completed steps: ${run.record.stepsCompleted.join(' → ')}. Generation finished ${run.record.finishedAt}. Serving now is a separate operation.`
      : 'No step-level completion data was retained for this historical image. Its overall status alone is not proof of individual step completion.',
    code: snapshot?.code ?? [],
    codeNote: snapshot
      ? 'Generation-matched, sanitized server source captured when this Workflow ran. The resolved parameters below and the output record were persisted with it.'
      : 'Historical source snapshot unavailable. Current reference code is shown only on the capability card before a run is selected; it is not attributed to this image.',
    resolved,
    details: {
      'Generation / retrieval': status,
      'Recipe ID': `${run.family}/${run.derivative?.asset ?? 'record unavailable'}`,
      'Source code version at generation': snapshot?.version,
      'Original source version (SHA-256)': identity
        ? run.gallery
          ? 'Withheld for approved private original'
          : identity.sha256
        : null,
      'Original input bytes (not preview bytes)': originalBytes,
      'Original input dimensions': identity ? `${identity.width} × ${identity.height} px` : null,
      'Original R2 object (authorized only)': run.gallery ? 'Withheld' : identity?.objectKey,
      'Derivative R2 object': run.derivative?.objectKey,
      'Requested output MIME': run.derivative?.output.format,
      'Observed encoded bytes (from R2)': run.derivative?.outputBytes ?? run.resultBytes,
      'Observed rendered dimensions': dimensions,
      'Generation time (Images only, ms; not Worker CPU)': run.derivative?.transformMs,
      'Generation completed at': run.derivative?.storedAt,
      'Writing model': run.record?.kind === 'editorial' ? run.record.analysis.writingModel : null,
      'Focal model': run.record?.kind === 'editorial' ? run.record.analysis.focalModel : null,
      'Synthetic generation model': run.record?.kind === 'creative' ? run.record.model : null,
      'Requested synthetic dimensions':
        run.record?.kind === 'creative' && run.record.generation
          ? `${run.record.generation.width} × ${run.record.generation.height} px`
          : null,
      'Requested generation seed':
        run.record?.kind === 'creative' ? run.record.generation?.seed : null,
      'AI.run wall time (ms; not Worker CPU)':
        run.record?.kind === 'creative' ? run.record.inferenceMs : null,
      'Synthetic generation + output processing (ms)':
        run.record?.kind === 'creative' ? run.record.generationMs : null,
    },
  };
}

function editorialDerivative(
  record: EditorialRecord | null,
  preset: PresetKey,
  mode: Mode,
): Derivative | null {
  return record?.crops.find((crop) => crop.asset === `${preset}-${mode}`) ?? null;
}

let privateSelection = 0;

/** A private run is passed in only after the workbench has fetched its capability-protected assets. */
export async function showPrivateRun(
  result: PrivateResult,
  preset: PresetKey,
  inspectedMode: Mode,
  images: ReadonlyMap<string, string>,
  sizes: ReadonlyMap<string, number>,
): Promise<void> {
  const serial = ++privateSelection;
  const preview = result.preview ? (images.get(result.preview) ?? null) : null;
  if (result.status !== 'ready' && result.status !== 'partial') return;
  const selections: { family: WorkflowFamily; mode: Mode }[] = [
    { family: 'pipeline', mode: 'center' },
    { family: 'editorial-ai', mode: 'ai' },
    { family: 'synthetic', mode: 'center' },
  ];
  for (const { family, mode } of selections) {
    const card = cards.get(family)!;
    const editorial = result.provenance.editorial;
    const creative = result.provenance.creative;
    const assetUrl =
      family === 'synthetic'
        ? result.creative.url
        : (result.crops
            .find((item) => item.key === preset)
            ?.modes.find((item) => item.mode === mode)?.url ?? null);
    const url = assetUrl ? (images.get(assetUrl) ?? null) : null;
    const derivative =
      family === 'synthetic'
        ? (creative?.output ?? null)
        : editorialDerivative(editorial, preset, mode);
    const record = family === 'synthetic' ? creative : editorial;
    const message =
      family === 'synthetic' && !url
        ? 'This upload has no completed synthetic treatment yet.'
        : !url
          ? 'The requested crop is unavailable in this completed or partial run.'
          : `Generated earlier for this authorized upload; selected ${preset}/${mode}.`;
    const view = await storedView(`sample-${family}`, {
      family,
      sourceUrl: preview,
      sourceLabel: 'Private sanitized preview · not the original',
      sourceAlt: 'Private preview of the uploaded photograph',
      sourceBytes: result.preview ? (sizes.get(result.preview) ?? null) : null,
      resultUrl: url,
      resultAlt:
        family === 'synthetic'
          ? 'Private synthetic illustration'
          : `Private ${preset} ${mode} crop`,
      resultBytes: assetUrl ? (sizes.get(assetUrl) ?? derivative?.outputBytes ?? null) : null,
      record,
      derivative,
      gallery: false,
      message,
    });
    if (serial !== privateSelection) return;
    showInspector(card.inspector, view);
    card.status.textContent = message;
    card.rendered = true;
  }

  const crop = result.crops
    .find((item) => item.key === preset)
    ?.modes.find((item) => item.mode === inspectedMode);
  const cropUrl = crop?.url ? (images.get(crop.url) ?? null) : null;
  const cropRecord = editorialDerivative(result.provenance.editorial, preset, inspectedMode);
  const privatePanel = document.getElementById('private-inspector');
  if (privatePanel) {
    showInspector(
      privatePanel,
      await storedView('private-editorial', {
        family: inspectedMode === 'ai' ? 'editorial-ai' : 'pipeline',
        sourceUrl: preview,
        sourceLabel: 'Private sanitized preview · not the original',
        sourceAlt: 'Private preview of the uploaded photograph',
        sourceBytes: result.preview ? (sizes.get(result.preview) ?? null) : null,
        resultUrl: cropUrl,
        resultAlt: `${preset} ${inspectedMode} editorial crop`,
        resultBytes: crop?.url ? (sizes.get(crop.url) ?? cropRecord?.outputBytes ?? null) : null,
        record: result.provenance.editorial,
        derivative: cropRecord,
        gallery: false,
        message: `Generated earlier · selected ${preset}/${inspectedMode}.`,
      }),
    );
  }
  const creativePanel = document.getElementById('creative-inspector');
  if (creativePanel && result.creative.status === 'ready' && result.creative.url) {
    creativePanel.hidden = false;
    showInspector(
      creativePanel,
      await storedView('private-creative', {
        family: 'synthetic',
        sourceUrl: preview,
        sourceLabel: 'Private sanitized preview · not the original',
        sourceAlt: 'Private reference photograph',
        sourceBytes: result.preview ? (sizes.get(result.preview) ?? null) : null,
        resultUrl: images.get(result.creative.url) ?? null,
        resultAlt: 'Generated synthetic illustration',
        resultBytes:
          sizes.get(result.creative.url) ?? result.provenance.creative?.output.outputBytes ?? null,
        record: result.provenance.creative,
        derivative: result.provenance.creative?.output ?? null,
        gallery: false,
        message: 'Generated in a separate, opt-in creative Workflow.',
      }),
    );
  }
}

/** Prefer a curated run that actually has the requested derivative. */
export async function showGallerySamples(examples: GalleryExample[]): Promise<void> {
  for (const family of ['pipeline', 'editorial-ai', 'synthetic'] as const) {
    const card = cards.get(family)!;
    const mode = family === 'editorial-ai' ? 'ai' : 'center';
    const chosen = examples.find((item) =>
      family === 'synthetic'
        ? Boolean(item.creative)
        : item.crops.some((crop) => crop.modes.some((entry) => entry.mode === mode && entry.url)),
    );
    if (!chosen || card.rendered) continue;
    const selectedCrop = chosen.crops.find((crop) =>
      crop.modes.some((entry) => entry.mode === mode && entry.url),
    );
    const record =
      family === 'synthetic'
        ? (chosen.provenance?.creative ?? null)
        : (chosen.provenance?.editorial ?? null);
    const outputUrl =
      family === 'synthetic'
        ? chosen.creative
        : (selectedCrop?.modes.find((entry) => entry.mode === mode)?.url ?? null);
    const derivative =
      family === 'synthetic'
        ? (chosen.provenance?.creative?.output ?? null)
        : selectedCrop
          ? editorialDerivative(chosen.provenance?.editorial ?? null, selectedCrop.key, mode)
          : null;
    const view = await storedView(`sample-${family}`, {
      family,
      sourceUrl: chosen.preview,
      sourceLabel: 'Approved sanitized preview · not the original',
      sourceAlt: chosen.altText,
      sourceCredit: chosen.credit,
      sourceBytes: chosen.provenance?.editorial?.preview.outputBytes ?? null,
      resultUrl: outputUrl,
      resultAlt: family === 'synthetic' ? 'Approved synthetic illustration' : chosen.altText,
      resultBytes: derivative?.outputBytes ?? null,
      record,
      derivative,
      gallery: true,
      message: `Approved example “${chosen.title}” · ${family === 'synthetic' ? 'creative' : `${selectedCrop?.key}/${mode}`} was generated before this visit.`,
    });
    if (card.rendered) continue;
    showInspector(card.inspector, view);
    card.status.textContent = `Approved / pre-generated · ${chosen.title}`;
    card.rendered = true;
  }
}

export async function showGalleryRun(
  example: GalleryExample,
  preset: PresetKey,
  mode: Mode,
): Promise<void> {
  const cropUrl =
    example.crops.find((item) => item.key === preset)?.modes.find((item) => item.mode === mode)
      ?.url ?? null;
  const record = example.provenance?.editorial ?? null;
  const derivative = editorialDerivative(record, preset, mode);
  const root = document.getElementById('gallery-inspector');
  if (!root) return;
  showInspector(
    root,
    await storedView('gallery-example', {
      family: mode === 'ai' ? 'editorial-ai' : 'pipeline',
      sourceUrl: example.preview,
      sourceLabel: 'Approved sanitized preview · not the original',
      sourceAlt: example.altText,
      sourceCredit: example.credit,
      sourceBytes: record?.preview.outputBytes ?? null,
      resultUrl: cropUrl,
      resultAlt: `${preset} ${mode} crop of ${example.title}`,
      resultBytes: derivative?.outputBytes ?? null,
      record,
      derivative,
      gallery: true,
      message: `Approved example “${example.title}” · previously generated, now retrieved.`,
    }),
  );
  const creativeRoot = document.getElementById('gallery-creative-inspector');
  if (creativeRoot) {
    creativeRoot.hidden = !example.creative;
    if (example.creative) {
      showInspector(
        creativeRoot,
        await storedView('gallery-creative', {
          family: 'synthetic',
          sourceUrl: example.preview,
          sourceLabel: 'Approved sanitized preview · not the original',
          sourceAlt: example.altText,
          sourceCredit: example.credit,
          sourceBytes: example.provenance?.editorial?.preview.outputBytes ?? null,
          resultUrl: example.creative,
          resultAlt: `Clearly synthetic illustration for ${example.title}`,
          resultBytes: example.provenance?.creative?.output.outputBytes ?? null,
          record: example.provenance?.creative ?? null,
          derivative: example.provenance?.creative?.output ?? null,
          gallery: true,
          message: 'Approved synthetic illustration from a separate, earlier creative run.',
        }),
      );
    }
  }
}

for (const node of document.querySelectorAll<HTMLElement>('[data-showcase]')) {
  const card: SampleCard = {
    node,
    family: node.dataset.showcase!,
    status: control(node, '[data-sample-status]'),
    inspector: control(node, '[data-sample-inspector]'),
    source: node.querySelector<HTMLSelectElement>('[data-sample-source]') ?? undefined,
    variant: node.querySelector<HTMLSelectElement>('[data-sample-variant]') ?? undefined,
    rendered: false,
  };
  cards.set(card.family, card);
  if (!card.variant) {
    void showWorkflowReference(card);
    continue;
  }
  control<HTMLButtonElement>(node, '[data-sample-run]').addEventListener('click', () => {
    card.status.classList.remove('error');
    void renderSample(card);
  });
  for (const select of node.querySelectorAll<HTMLSelectElement>('select')) {
    select.addEventListener('change', () => {
      if (card.family === 'framing') {
        const grid = node.querySelector<HTMLElement>('[data-focal-selector]');
        if (grid) grid.hidden = card.variant?.value !== 'point';
      }
      if (card.rendered) void renderSample(card);
    });
  }
  for (const point of node.querySelectorAll<HTMLButtonElement>('[data-point]')) {
    point.addEventListener('click', () => {
      for (const button of node.querySelectorAll<HTMLButtonElement>('[data-point]')) {
        const selected = button === point;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
      if (card.rendered) void renderSample(card);
    });
  }
}

window.addEventListener('beforeunload', () => {
  for (const card of cards.values()) {
    card.controller?.abort();
    if (card.previousUrl) URL.revokeObjectURL(card.previousUrl);
  }
});

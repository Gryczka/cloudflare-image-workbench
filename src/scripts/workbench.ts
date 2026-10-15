/**
 * Browser code for the private workbench: Turnstile, upload and gallery consent, result polling,
 * crops and downloads, creative requests, and the gallery dialog.
 */
import { showGalleryRun, showGallerySamples, showPrivateRun } from './showcase';
import type { GalleryExample, Mode, PresetKey, PrivateResult } from './run-types';

interface TurnstileClient {
  render(
    element: HTMLElement,
    options: { sitekey: string; action: 'upload' | 'creative'; theme: string },
  ): string | number;
  getResponse(widgetId: string | number): string;
  reset(widgetId: string | number): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileClient;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing interface element: ${id}`);
  return node as T;
}

const uploadForm = element<HTMLFormElement>('upload-form');
const uploadButton = element<HTMLButtonElement>('upload-button');
const uploadStatus = element<HTMLParagraphElement>('upload-status');
const imageInput = element<HTMLInputElement>('image-input');
const galleryPermission = element<HTMLFieldSetElement>('gallery-permission');
const galleryConsent = element<HTMLInputElement>('gallery-consent');
const galleryCredit = element<HTMLInputElement>('gallery-credit');
const creativeForm = element<HTMLFormElement>('creative-form');
const creativeButton = element<HTMLButtonElement>('creative-button');
const creativeStatus = element<HTMLParagraphElement>('creative-status');
const dialog = element<HTMLDialogElement>('gallery-dialog');

const MODE_LABELS: Record<Mode, string> = {
  center: 'Center',
  auto: 'Automatic saliency',
  ai: 'AI-guided focal point',
};
const PRESET_LABELS: Record<PresetKey, string> = {
  feature: 'Feature / 16:9',
  portrait: 'Portrait / 4:5',
  square: 'Social / 1:1',
};

let enabled = false;
let busy = false;
let uploadWidget: string | number | null = null;
let creativeWidget: string | number | null = null;
let active: { id: string; capability: string; expiresAt: string } | null = null;
let activeResult: PrivateResult | null = null;
let renderedResult = '';
let renderedCreative = '';
let selectedPreset: PresetKey = 'feature';
let inspectedMode: Mode = 'center';
let currentExample: GalleryExample | null = null;
let selectedExampleMode: Mode = 'center';
let pollTimer: number | undefined;
const blobs = new Map<string, string>();
const blobSizes = new Map<string, number>();

function status(node: HTMLElement, message: string, error = false) {
  node.textContent = message;
  node.classList.toggle('error', error);
}

function resetWidget(id: string | number | null) {
  if (id !== null) window.turnstile?.reset(id);
}

function updateUploadButton() {
  uploadButton.disabled = !enabled || !imageInput.files?.length || busy;
  galleryPermission.disabled = !enabled || busy;
}

galleryConsent.addEventListener('change', () => {
  galleryCredit.required = galleryConsent.checked;
});

function clearBlobs() {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
  blobSizes.clear();
}

async function protectedImage(url: string): Promise<string> {
  const cached = blobs.get(url);
  if (cached) return cached;
  if (!active) throw new Error('This private result is no longer available.');
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${active.capability}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('This private image could not be loaded.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  blobs.set(url, objectUrl);
  blobSizes.set(url, blob.size);
  return objectUrl;
}

async function loadTurnstile() {
  if (window.turnstile) return window.turnstile;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The verification widget could not load.'));
    document.head.append(script);
  });
  if (!window.turnstile) throw new Error('The verification widget is unavailable.');
  return window.turnstile;
}

async function initialize() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('The demo is temporarily unavailable.');
    const config: { enabled: boolean; siteKey: string | null } = await response.json();
    enabled = Boolean(config.enabled && config.siteKey);
    if (enabled && config.siteKey) {
      const turnstile = await loadTurnstile();
      uploadWidget = turnstile.render(element('upload-challenge'), {
        sitekey: config.siteKey,
        action: 'upload',
        theme: 'light',
      });
      creativeWidget = turnstile.render(element('creative-challenge'), {
        sitekey: config.siteKey,
        action: 'creative',
        theme: 'light',
      });
      status(uploadStatus, 'Ready when you are. Your upload stays private.');
    } else {
      status(
        uploadStatus,
        'Visitor uploads are paused on this deployment. The public recipes above still run live.',
      );
    }
  } catch {
    enabled = false;
    status(uploadStatus, 'The interactive demo is temporarily unavailable.', true);
  }
  updateUploadButton();
  await loadGallery();
  try {
    const saved = sessionStorage.getItem('workbench-private-result');
    if (saved) {
      const session: typeof active = JSON.parse(saved);
      if (session && Date.parse(session.expiresAt) > Date.now()) {
        active = session;
        element('workspace-empty').hidden = true;
        element('result-panel').hidden = false;
        await refreshResult();
      } else {
        sessionStorage.removeItem('workbench-private-result');
      }
    }
  } catch {
    sessionStorage.removeItem('workbench-private-result');
  }
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  element('file-title').textContent = file ? file.name : 'Drop a photo here';
  element('file-subtitle').textContent = file
    ? `${(file.size / 1_048_576).toFixed(1)} MB · ready to analyze`
    : 'or click to browse your files';
  updateUploadButton();
});

const dropZone = element('drop-zone');
for (const name of ['dragenter', 'dragover']) {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const name of ['dragleave', 'drop']) {
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', (event) => {
  if (!(event instanceof DragEvent) || !event.dataTransfer?.files.length) return;
  const transfer = new DataTransfer();
  transfer.items.add(event.dataTransfer.files[0]);
  imageInput.files = transfer.files;
  imageInput.dispatchEvent(new Event('change'));
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = imageInput.files?.[0];
  if (!enabled || !file || busy) return;
  const credit = galleryCredit.value.trim();
  if (galleryConsent.checked && !credit) {
    galleryCredit.focus();
    return status(uploadStatus, 'Add the credit to show, or clear the gallery permission.', true);
  }
  const token = uploadWidget !== null ? window.turnstile?.getResponse(uploadWidget) : '';
  if (!token) return status(uploadStatus, 'Complete the verification before uploading.', true);
  busy = true;
  updateUploadButton();
  status(uploadStatus, 'Storing your image privately…');
  try {
    const form = new FormData();
    form.set('image', file);
    form.set('cf-turnstile-response', token);
    if (galleryConsent.checked) {
      form.set('gallery-consent', 'yes');
      form.set('gallery-credit', credit);
    }
    const response = await fetch('/api/uploads', { method: 'POST', body: form });
    const data: { id?: string; capability?: string; expiresAt?: string; error?: string } =
      await response.json();
    if (!response.ok || !data.id || !data.capability || !data.expiresAt) {
      throw new Error(data.error ?? 'The upload did not complete.');
    }
    // Permission is per upload; never carry it over to the next image.
    galleryConsent.checked = false;
    galleryCredit.value = '';
    galleryCredit.required = false;
    window.clearTimeout(pollTimer);
    clearBlobs();
    renderedResult = '';
    renderedCreative = '';
    activeResult = null;
    active = { id: data.id, capability: data.capability, expiresAt: data.expiresAt };
    sessionStorage.setItem('workbench-private-result', JSON.stringify(active));
    element('workspace-empty').hidden = true;
    element('result-panel').hidden = false;
    element('result-content').hidden = true;
    element('creative-panel').hidden = true;
    status(uploadStatus, 'Image stored. Processing is underway.');
    await refreshResult();
  } catch (error) {
    status(uploadStatus, error instanceof Error ? error.message : 'Upload failed.', true);
  } finally {
    resetWidget(uploadWidget);
    busy = false;
    updateUploadButton();
  }
});

async function refreshResult() {
  if (!active) return;
  try {
    const response = await fetch(`/api/uploads/${active.id}`, {
      headers: { authorization: `Bearer ${active.capability}` },
      cache: 'no-store',
    });
    if (response.status === 404) {
      sessionStorage.removeItem('workbench-private-result');
      active = null;
      status(uploadStatus, 'This private result has expired. Start with a new image.', true);
      return;
    }
    if (!response.ok) throw new Error('Processing status is unavailable.');
    activeResult = (await response.json()) as PrivateResult;
    await showResult(activeResult);
    if (
      activeResult.status === 'queued' ||
      activeResult.status === 'processing' ||
      activeResult.creative.status === 'queued' ||
      activeResult.creative.status === 'processing'
    ) {
      pollTimer = window.setTimeout(refreshResult, 2000);
    }
  } catch {
    status(uploadStatus, 'Waiting for the processor. Retrying shortly…');
    pollTimer = window.setTimeout(refreshResult, 3500);
  }
}

async function showResult(result: PrivateResult) {
  const pill = element('result-state');
  pill.textContent = result.status === 'partial' ? 'Partial result' : result.status;
  pill.className = `status-pill ${result.status}`;
  element('progress-store').classList.add('complete');
  const editorial = result.provenance?.editorial;
  element('progress-analyze').classList.toggle(
    'complete',
    Boolean(editorial?.stepsCompleted.includes('suggest editorial metadata')),
  );
  element('progress-crop').classList.toggle('complete', Boolean(editorial?.crops.length));
  if (result.status === 'ready' || result.status === 'partial') {
    element('result-content').hidden = false;
    element('creative-panel').hidden = false;
    if (renderedResult !== result.id) {
      renderedResult = result.id;
      element<HTMLTextAreaElement>('caption-edit').value = result.caption ?? '';
      element<HTMLTextAreaElement>('alt-edit').value = result.altText ?? '';
      element('subject-label').textContent = result.subject ?? 'Subject unavailable';
      element('focal-description').textContent =
        result.note ?? 'AI focal point suggested. Check this image before publishing.';
      element('analysis-model').textContent = editorial?.analysis.writingModel
        ? `Writing: ${editorial.analysis.writingModel} · focal: ${editorial.analysis.focalModel ?? 'none'}`
        : result.analysisModel;
      const pin = element('focal-pin');
      pin.hidden = !result.focal;
      if (result.focal) {
        pin.style.left = `${result.focal.x * 100}%`;
        pin.style.top = `${result.focal.y * 100}%`;
      }
      if (result.preview) {
        element<HTMLImageElement>('source-preview').src = await protectedImage(result.preview);
      }
      await showPreset(selectedPreset, false);
    }
    creativeButton.disabled = !enabled || result.creative.status !== 'idle';
    if (
      result.creative.status === 'ready' &&
      renderedCreative !== result.id &&
      result.creative.url
    ) {
      element<HTMLImageElement>('creative-image').src = await protectedImage(result.creative.url);
      element('creative-image').hidden = false;
      element('creative-placeholder').hidden = true;
      element('creative-download').hidden = false;
      element('creative-model').textContent = result.creative.model;
      renderedCreative = result.id;
    }
    if (result.creative.status !== 'idle') {
      status(
        creativeStatus,
        result.creative.status === 'ready'
          ? 'Synthetic illustration ready. This is not an editorial photograph.'
          : result.creative.status === 'failed'
            ? 'Generation could not be completed for this image.'
            : 'Generating a clearly labeled synthetic variation…',
        result.creative.status === 'failed',
      );
    }
    await showPrivateRun(result, selectedPreset, inspectedMode, blobs, blobSizes);
  } else if (result.status === 'failed') {
    status(uploadStatus, result.note ?? 'Processing failed. Please try a different image.', true);
  }
}

async function showPreset(key: PresetKey, updateInspector = true) {
  selectedPreset = key;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.preset-button[data-preset]',
  )) {
    const isActive = button.dataset.preset === key;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  const crop = activeResult?.crops.find((item) => item.key === key);
  if (!crop) return;
  for (const mode of ['center', 'auto', 'ai'] as const) {
    const image = element<HTMLImageElement>(`crop-${mode}`);
    const fallback = element(`crop-${mode}-fallback`);
    const download = document.querySelector<HTMLButtonElement>(`[data-download="${mode}"]`)!;
    const url = crop.modes.find((item) => item.mode === mode)?.url;
    image.hidden = true;
    download.disabled = !url;
    fallback.hidden = false;
    fallback.textContent = url ? 'Loading crop…' : 'Not available for this image';
    if (url) {
      try {
        const privateUrl = await protectedImage(url);
        if (selectedPreset !== key) return;
        image.src = privateUrl;
        image.alt = `${MODE_LABELS[mode]} crop, ${PRESET_LABELS[key]}`;
        image.hidden = false;
        fallback.hidden = true;
      } catch {
        fallback.textContent = 'Crop could not be loaded';
        download.disabled = true;
      }
    }
  }
  if (updateInspector && activeResult) {
    await showPrivateRun(activeResult, key, inspectedMode, blobs, blobSizes);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.preset-button[data-preset]')) {
  button.addEventListener('click', () => void showPreset(button.dataset.preset as PresetKey));
}

for (const button of document.querySelectorAll<HTMLButtonElement>('#crop-grid [data-inspect]')) {
  button.addEventListener('click', () => {
    inspectedMode = button.dataset.inspect as Mode;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>(
      '#crop-grid [data-inspect]',
    )) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
    if (activeResult)
      void showPrivateRun(activeResult, selectedPreset, inspectedMode, blobs, blobSizes);
  });
}

async function downloadPrivate(url: string, filename: string) {
  const blobUrl = await protectedImage(url);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.click();
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-download]')) {
  button.addEventListener('click', async () => {
    const mode = button.dataset.download as Mode;
    const url = activeResult?.crops
      .find((crop) => crop.key === selectedPreset)
      ?.modes.find((item) => item.mode === mode)?.url;
    if (url) await downloadPrivate(url, `image-workbench-${selectedPreset}-${mode}.webp`);
  });
}

element('creative-download').addEventListener('click', async () => {
  const url = activeResult?.creative.url;
  if (url) await downloadPrivate(url, 'image-workbench-synthetic-flux-2.webp');
});

for (const [buttonId, inputId] of [
  ['copy-caption', 'caption-edit'],
  ['copy-alt', 'alt-edit'],
]) {
  element(buttonId).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(element<HTMLTextAreaElement>(inputId).value);
      status(uploadStatus, 'Edited text copied to clipboard.');
    } catch {
      status(uploadStatus, 'Select the text and copy it manually.', true);
    }
  });
}

creativeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!enabled || !active || !activeResult || activeResult.creative.status !== 'idle') return;
  const token = creativeWidget !== null ? window.turnstile?.getResponse(creativeWidget) : '';
  if (!token) return status(creativeStatus, 'Complete creative verification first.', true);
  creativeButton.disabled = true;
  status(creativeStatus, 'Starting the synthetic image Workflow…');
  try {
    const response = await fetch(`/api/uploads/${active.id}/creative`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${active.capability}` },
      body: JSON.stringify({ style: element<HTMLSelectElement>('creative-style').value, token }),
    });
    const data: { error?: string } = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Generation could not start.');
    status(creativeStatus, 'A synthetic variation is on its way…');
    window.clearTimeout(pollTimer);
    await refreshResult();
  } catch (error) {
    status(creativeStatus, error instanceof Error ? error.message : 'Generation failed.', true);
    creativeButton.disabled = false;
  } finally {
    resetWidget(creativeWidget);
  }
});

async function loadGallery() {
  try {
    const response = await fetch('/api/gallery', { cache: 'no-store' });
    if (!response.ok) return;
    const data: { items: GalleryExample[] } = await response.json();
    await showGallerySamples(data.items);
    if (!data.items.length) return;
    const grid = element('gallery-grid');
    grid.replaceChildren();
    for (const example of data.items) {
      const card = document.createElement('article');
      card.className = 'gallery-card';
      const image = document.createElement('img');
      image.src = example.preview;
      image.alt = example.altText;
      image.loading = 'lazy';
      const content = document.createElement('div');
      content.className = 'gallery-card-content';
      const label = document.createElement('span');
      label.className = 'micro-label';
      label.textContent = example.creative
        ? 'CURATED / WITH SYNTHETIC VARIANT'
        : 'CURATED / EDITORIAL';
      const heading = document.createElement('h3');
      heading.textContent = example.title;
      const summary = document.createElement('p');
      summary.textContent = example.caption;
      const credit = document.createElement('small');
      credit.textContent = example.credit;
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Explore the crops ↗';
      open.addEventListener('click', () => showExample(example));
      content.append(label, heading, summary, credit, document.createElement('br'), open);
      card.append(image, content);
      grid.append(card);
    }
    const first = data.items[0];
    const heroImage = element<HTMLImageElement>('hero-image');
    heroImage.src = first.preview;
    heroImage.alt = first.altText;
    element('hero-caption').textContent = `Approved example · ${first.credit}`;
    const reticle = document.querySelector<HTMLElement>('.hero-reticle');
    if (reticle) reticle.hidden = true;
  } catch {
    // The static layout and privacy explanation remain available without D1.
  }
}

function showExample(example: GalleryExample) {
  currentExample = example;
  element('dialog-title').textContent = example.title;
  element('dialog-credit').textContent = example.credit;
  element('dialog-caption').textContent = example.caption;
  const creative = element('dialog-creative');
  creative.hidden = !example.creative;
  if (example.creative) {
    element<HTMLImageElement>('dialog-creative-image').src = example.creative;
    element('dialog-creative-model').textContent =
      example.provenance?.creative?.model ?? 'Historical model unavailable';
  }

  const presets = element('dialog-presets');
  presets.replaceChildren();
  for (const key of ['feature', 'portrait', 'square'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `preset-button ${key === 'feature' ? 'is-active' : ''}`;
    button.textContent = PRESET_LABELS[key];
    button.setAttribute('aria-pressed', String(key === 'feature'));
    button.addEventListener('click', () => showExamplePreset(key));
    presets.append(button);
  }
  showExamplePreset('feature');
  dialog.showModal();
}

function showExamplePreset(key: PresetKey) {
  const crop = currentExample?.crops.find((item) => item.key === key);
  if (!crop) return;
  for (const button of element('dialog-presets').querySelectorAll<HTMLButtonElement>('button')) {
    const selected = button.textContent === PRESET_LABELS[key];
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const grid = element('dialog-crops');
  grid.replaceChildren();
  for (const mode of ['center', 'auto', 'ai'] as const) {
    const figure = document.createElement('figure');
    const url = crop.modes.find((item) => item.mode === mode)?.url;
    if (url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = `${MODE_LABELS[mode]} crop of ${currentExample?.title}, ${PRESET_LABELS[key]}`;
      image.loading = 'lazy';
      figure.append(image);
    } else {
      const unavailable = document.createElement('div');
      unavailable.className = 'crop-image';
      unavailable.textContent = 'No focal suggestion for this crop';
      figure.append(unavailable);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = MODE_LABELS[mode];
    const inspect = document.createElement('button');
    inspect.type = 'button';
    inspect.textContent = 'Inspect this crop ↗';
    inspect.className = 'text-link';
    inspect.setAttribute('aria-pressed', String(selectedExampleMode === mode));
    inspect.addEventListener('click', () => {
      selectedExampleMode = mode;
      for (const option of element('dialog-crops').querySelectorAll<HTMLButtonElement>(
        '[aria-pressed]',
      )) {
        option.setAttribute('aria-pressed', String(option === inspect));
      }
      if (currentExample) void showGalleryRun(currentExample, key, mode);
    });
    caption.append(document.createElement('br'), inspect);
    figure.append(caption);
    grid.append(figure);
  }
  if (currentExample) void showGalleryRun(currentExample, key, selectedExampleMode);
}

element('dialog-close').addEventListener('click', () => dialog.close());
window.addEventListener('beforeunload', clearBlobs);
void initialize();

export {};

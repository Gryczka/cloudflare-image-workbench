/** Workers AI calls: editorial drafts and a focal point from vision models, and synthetic art. */
import { privateKey, transformAndStore, type StoredAsset } from './media';

// showcase:start models
const VISION_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
const VISION_FALLBACK_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
export const IMAGE_MODEL_LABEL = 'FLUX.2 [klein] 9B';

// Bounded, source-matched art direction, tested with a fixed seed on the public demo photo.
export const CREATIVE_GENERATION = { width: 1152, height: 768, seed: 20261005 } as const;
const CREATIVE_REFERENCE_TRANSFORM = {
  width: 480,
  height: 480,
  fit: 'scale-down',
} as const satisfies ImageTransform;
const CREATIVE_OUTPUT_TRANSFORM = {
  width: 960,
  height: 640,
  fit: 'scale-down',
} as const satisfies ImageTransform;

export const CREATIVE_STYLES = {
  poster:
    'Re-render reference image 0 as a sophisticated editorial print illustration for a newspaper feature page. Preserve the recognizable subject, viewpoint, proportions, and essential spatial relationships of the reference. Translate the existing forms into carefully composed flat color shapes, fine ink contours, restrained halftone shading, and subtle matte print texture. Use a limited palette of deep indigo, muted terracotta, sage, and warm ivory. Favor precise silhouettes, clear visual hierarchy, and a calm landscape composition that remains legible at newspaper-column size. The result is clearly drawn rather than photographic: one continuous borderless scene, image only, without lettering, logos, poster layouts, or invented people and events.',
  collage:
    'Re-render reference image 0 as a refined cut-paper editorial illustration for a newspaper feature page. Preserve the recognizable subject, viewpoint, proportions, and essential spatial relationships of the reference. Build the visible scene from layered matte paper shapes with lightly torn edges, subtle fiber texture, delicate ink details, and restrained shallow shadows. Use warm ivory, charcoal, muted terracotta, ochre, and sage, with controlled contrast and a clear principal subject. Keep the composition coherent and spacious, readable at newspaper-column size, and unmistakably handmade. One borderless landscape scene, image only, without lettering, logos, floating unrelated objects, or invented people and events.',
  illustration:
    'Re-render reference image 0 as a refined newspaper feature illustration in pen and ink with restrained watercolor washes. Preserve the recognizable subject, viewpoint, proportions, and essential spatial relationships of the reference. Use confident dark navy contour lines, selective cross-hatching, translucent washes, and subtle ivory paper texture. Simplify incidental detail into a calm, coherent composition that reads clearly at newspaper-column size. Use a restrained palette of warm ochre, brick red, muted teal, and ink blue, with natural tonal contrast. Make the treatment unmistakably hand-drawn, with generous breathing room around the main subject. One borderless landscape scene, image only, without lettering, captions, logos, decorative frames, or invented people and events.',
} as const;

export const CREATIVE_STYLE_LABELS = {
  illustration: 'Ink & wash',
  poster: 'Editorial print',
  collage: 'Paper-cut collage',
} as const satisfies Record<keyof typeof CREATIVE_STYLES, string>;
// showcase:end models

export type CreativeStyle = keyof typeof CREATIVE_STYLES;

/** Editorial drafts and a focal point from one analysis, with the model behind each. */
export interface Analysis {
  caption: string | null;
  altText: string | null;
  subject: string | null;
  focal: { x: number; y: number } | null;
  focalSource: 'none' | 'moondream-point' | 'llama4-estimate';
  writingModel: string | null;
  focalModel: string | null;
  note: string | null;
}

/** Everything the creative Workflow records about one synthetic generation. */
export interface CreativeProcessing {
  model: string;
  style: CreativeStyle;
  prompt: string;
  generation: { width: number; height: number; seed: number };
  reference: StoredAsset;
  referenceTransform: ImageTransform;
  output: StoredAsset;
  outputTransform: ImageTransform;
  /** Wall time of AI.run, including the binding call; not Worker CPU or billed GPU time. */
  inferenceMs: number;
  generationMs: number;
}

/** Moondream point coordinates are accepted only if they use normalized 0..1 values. */
export function normalizedPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object' || !('x' in value) || !('y' in value)) return null;
  const { x, y } = value;
  return typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
    ? { x, y }
    : null;
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : null;
}

/** A JSON answer (fenced or not) fills each bounded draft field; free text becomes the caption. */
export function parseEditorialAnswer(
  value: unknown,
): Pick<Analysis, 'caption' | 'altText' | 'subject'> {
  if (typeof value !== 'string') return { caption: null, altText: null, subject: null };
  try {
    const data: unknown = JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    if (data && typeof data === 'object') {
      return {
        caption: 'caption' in data ? shortText(data.caption, 240) : null,
        altText: 'alt' in data ? shortText(data.alt, 220) : null,
        subject: 'subject' in data ? shortText(data.subject, 72) : null,
      };
    }
  } catch {
    // A free-form model response is still useful as a draft caption.
  }
  return { caption: shortText(value, 240), altText: null, subject: null };
}

function fallbackFocal(value: unknown): Analysis['focal'] {
  if (typeof value !== 'string') return null;
  try {
    const data: unknown = JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    return data && typeof data === 'object' && 'focal' in data ? normalizedPoint(data.focal) : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** True when a model "estimate" is just the image center, which adds nothing over a center crop. */
export function isImageCenter(point: { x: number; y: number }): boolean {
  return Math.abs(point.x - 0.5) <= 0.02 && Math.abs(point.y - 0.5) <= 0.02;
}

type CallOutcome = 'ok' | 'empty' | 'error' | 'unscaled' | 'skipped';

function failureSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'Unknown error';
}

// showcase:start analysis
/** The vision models get an in-memory JPEG of the sanitized preview, never the original upload. */
const ANALYSIS_INPUT = { format: 'image/jpeg', quality: 85 } as const satisfies ImageOutputOptions;

export async function analyzeImage(
  env: Pick<Env, 'AI' | 'MEDIA'> & { IMAGES: Pick<Env['IMAGES'], 'input'> },
  id: string,
): Promise<Analysis> {
  const preview = await env.MEDIA.get(privateKey(id, 'preview'));
  if (!preview?.body) throw new Error('Preview is missing.');
  const encoded = await env.IMAGES.input(preview.body).output(ANALYSIS_INPUT);
  const bytes = new Uint8Array(await encoded.response().arrayBuffer());
  const image = `data:image/jpeg;base64,${toBase64(bytes)}`;

  let draft = { caption: null, altText: null, subject: null } as ReturnType<
    typeof parseEditorialAnswer
  >;
  let focal: Analysis['focal'] = null;
  let estimatedFocal: Analysis['focal'] = null;
  let focalSource: Analysis['focalSource'] = 'none';
  let writingModel: string | null = null;
  let focalModel: string | null = null;
  const notes: string[] = [];
  // Outcomes and bounded error summaries are logged; captions and image data never are.
  const outcomes: Record<'query' | 'fallback' | 'point', CallOutcome> = {
    query: 'skipped',
    fallback: 'skipped',
    point: 'skipped',
  };
  const errors: Partial<Record<keyof typeof outcomes, string>> = {};

  try {
    const answer = await env.AI.run(VISION_MODEL, {
      task: 'query',
      image,
      question:
        'Return only JSON with caption (factual single sentence), alt (short alt text), and subject (a short noun phrase identifying the principal visible subject). Avoid conjecture.',
      reasoning: false,
      temperature: 0.1,
      max_tokens: 180,
    });
    draft = parseEditorialAnswer(answer.answer);
    outcomes.query = draft.caption ? 'ok' : 'empty';
    if (draft.caption) writingModel = VISION_MODEL;
  } catch (error) {
    // A second vision model can supply drafts if Moondream is temporarily unavailable.
    outcomes.query = 'error';
    errors.query = failureSummary(error);
  }

  if (!draft.caption) {
    try {
      const answer = await env.AI.run(VISION_FALLBACK_MODEL, {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Return only JSON with caption (a factual single sentence), alt (short alt text), subject (a short noun phrase), and focal (x and y between 0 and 1 locating the main visible subject, or null when uncertain). Do not invent details; all outputs are editable suggestions.',
              },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 220,
      });
      const suggested = parseEditorialAnswer(answer.response);
      outcomes.fallback = suggested.caption ? 'ok' : 'empty';
      if (suggested.caption) {
        draft = suggested;
        writingModel = VISION_FALLBACK_MODEL;
        estimatedFocal = fallbackFocal(answer.response);
        notes.push(
          `Moondream ${outcomes.query === 'error' ? 'returned an error' : 'returned no usable caption'}; using an editable Llama 4 draft.`,
        );
      }
    } catch (error) {
      // The center and automatic crops still work without a vision model.
      outcomes.fallback = 'error';
      errors.fallback = failureSummary(error);
    }
    if (!draft.caption) notes.push('AI writing suggestions were unavailable.');
  }

  if (draft.subject) {
    try {
      const point = await env.AI.run(VISION_MODEL, {
        task: 'point',
        image,
        target: draft.subject,
        max_objects: 1,
      });
      const located = point.points?.[0];
      focal = normalizedPoint(located);
      // Points outside 0..1 are rejected rather than guessed into a coordinate space.
      outcomes.point = focal ? 'ok' : located ? 'unscaled' : 'empty';
      if (focal) focalSource = 'moondream-point';
      if (focal) focalModel = VISION_MODEL;
    } catch (error) {
      // The center and saliency crops still provide useful editorial comparisons.
      outcomes.point = 'error';
      errors.point = failureSummary(error);
    }
    if (outcomes.point === 'error') notes.push('Moondream point request failed.');
    if (outcomes.point === 'empty') notes.push('Moondream did not locate the suggested subject.');
    if (outcomes.point === 'unscaled') {
      notes.push('Moondream returned non-normalized coordinates, which were not used.');
    }
  }
  if (!focal && estimatedFocal && draft.subject) {
    if (isImageCenter(estimatedFocal)) {
      notes.push('The Llama 4 estimate was the image center, so no AI-guided crop was made.');
    } else {
      focal = estimatedFocal;
      focalSource = 'llama4-estimate';
      focalModel = VISION_FALLBACK_MODEL;
      notes.push('Using an estimated Llama 4 focal point; compare it with other crops.');
    }
  } else if (!focal) {
    notes.push('AI focal point unavailable; compare the center and automatic crops.');
  }

  console.log(JSON.stringify({ event: 'editorial_analysis', outcomes, errors, focalSource }));
  return { ...draft, focal, focalSource, writingModel, focalModel, note: notes.join(' ') || null };
}
// showcase:end analysis

// showcase:start creative
export async function generateCreative(
  env: Parameters<typeof transformAndStore>[0] & {
    AI: {
      run(
        model: typeof IMAGE_MODEL,
        input: AiModels[typeof IMAGE_MODEL]['inputs'],
      ): Promise<AiModels[typeof IMAGE_MODEL]['postProcessedOutputs']>;
    };
  },
  id: string,
  style: CreativeStyle,
): Promise<CreativeProcessing> {
  const referenceKey = privateKey(id, 'creative-reference');
  const temporary = privateKey(id, 'creative-raw');
  try {
    // Workers AI requires each multipart reference to be smaller than 512×512.
    const referenceAsset = await transformAndStore(
      env,
      id,
      'creative-reference',
      CREATIVE_REFERENCE_TRANSFORM,
      privateKey(id, 'preview'),
    );
    const reference = await env.MEDIA.get(referenceKey);
    if (!reference?.body) throw new Error('Creative reference is missing.');
    const generation = { ...CREATIVE_GENERATION };
    const prompt = CREATIVE_STYLES[style];
    const form = new FormData();
    form.append(
      'input_image_0',
      new Blob([await reference.arrayBuffer()], { type: 'image/webp' }),
      'reference.webp',
    );
    form.append('prompt', prompt);
    form.append('width', String(generation.width));
    form.append('height', String(generation.height));
    form.append('seed', String(generation.seed));

    const encoded = new Response(form);
    const generatedAt = performance.now();
    const result = await env.AI.run(IMAGE_MODEL, {
      multipart: { body: encoded.body!, contentType: encoded.headers.get('content-type')! },
    });
    const inferenceMs = Math.round(performance.now() - generatedAt);
    if (typeof result.image !== 'string' || result.image.length > 16_000_000) {
      throw new Error('Image generation did not return a bounded image.');
    }
    const raw = result.image.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0));
    await env.MEDIA.put(temporary, bytes);
    const output = await transformAndStore(
      env,
      id,
      'creative',
      CREATIVE_OUTPUT_TRANSFORM,
      temporary,
    );
    return {
      model: IMAGE_MODEL,
      style,
      prompt,
      generation,
      reference: referenceAsset,
      referenceTransform: { ...CREATIVE_REFERENCE_TRANSFORM },
      output,
      outputTransform: { ...CREATIVE_OUTPUT_TRANSFORM },
      inferenceMs,
      generationMs: Math.round(performance.now() - generatedAt),
    };
  } finally {
    await env.MEDIA.delete([temporary, referenceKey]);
  }
}
// showcase:end creative

/** Upload limits and inspection, the R2 key layout, and Images calls for private derivatives. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const PRIVATE_LIFETIME_MS = 24 * 60 * 60 * 1000;

// showcase:start presets
export const PRESETS = [
  { key: 'feature', label: 'Feature • 16:9', width: 960, height: 540 },
  { key: 'portrait', label: 'Portrait • 4:5', width: 640, height: 800 },
  { key: 'square', label: 'Social • 1:1', width: 720, height: 720 },
] as const;

export const CROP_MODES = ['center', 'auto', 'ai'] as const;
export type CropMode = (typeof CROP_MODES)[number];
export type Preset = (typeof PRESETS)[number];
export const EDITORIAL_OUTPUT = { format: 'image/webp', quality: 82, anim: false } as const;
// showcase:end presets

export interface StoredAsset {
  sourceKey: string;
  objectKey: string;
  sourceBytes: number;
  outputBytes: number;
  transformMs: number;
  storedAt: string;
}

/** A client-facing failure with the HTTP status the route should return. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sniffMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return 'image/png';
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Verify signature, decoded dimensions, and declared type before an R2 write. */
export async function inspectImage(file: File, images: Pick<ImagesBinding, 'info'>) {
  if (!file.size || file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError('Choose an image no larger than 5 MB.', 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || (file.type && file.type !== mime)) {
    throw new UploadError('Only genuine JPEG, PNG, and WebP images are accepted.', 415);
  }

  let info: ImageInfoResponse;
  try {
    info = await images.info(new Blob([bytes]).stream());
  } catch {
    throw new UploadError('The image could not be decoded.', 415);
  }
  if (!('width' in info) || !Number.isInteger(info.width) || !Number.isInteger(info.height)) {
    throw new UploadError('The image could not be decoded.', 415);
  }
  if (info.width < 1 || info.height < 1 || info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new UploadError('Images may contain at most 16 megapixels.', 413);
  }

  const decodedMime = info.format.toLowerCase().replace('image/', '').replace('jpg', 'jpeg');
  if (decodedMime !== mime.replace('image/', '')) {
    throw new UploadError('The image format does not match the uploaded bytes.', 415);
  }
  return { bytes, mime, width: info.width, height: info.height };
}

/**
 * R2 layout: `uploads/` holds private originals and `private/` their derivatives, both keyed by
 * upload ID; `gallery/` holds approved copies under a separate, random gallery ID.
 */
export function originalKey(id: string): string {
  return `uploads/${id}/original`;
}

export function privateKey(id: string, asset: string): string {
  return `private/${id}/${asset}.webp`;
}

export function galleryKey(id: string, asset: string): string {
  return `gallery/${id}/${asset}.webp`;
}

/** The canonical `<preset>-<mode>` crop name, or null for an unknown preset or mode. */
export function assetName(preset: string, mode: string): string | null {
  return PRESETS.some((item) => item.key === preset) && CROP_MODES.some((item) => item === mode)
    ? `${preset}-${mode}`
    : null;
}

// showcase:start store
/** Guard every derivative write, including a write that finishes after the hourly purge. */
export async function assertUploadActive(db: D1Database, id: string): Promise<void> {
  const row = await db
    .prepare('SELECT id FROM uploads WHERE id = ? AND expires_at > ?')
    .bind(id, Date.now())
    .first();
  if (!row) throw new UploadError('The private upload has expired.', 410);
}

export async function transformAndStore(
  env: { IMAGES: Pick<Env['IMAGES'], 'input'>; MEDIA: Env['MEDIA']; DB: Env['DB'] },
  id: string,
  asset: string,
  transform: ImageTransform,
  sourceKey = originalKey(id),
): Promise<StoredAsset> {
  await assertUploadActive(env.DB, id);
  const source = await env.MEDIA.get(sourceKey);
  if (!source?.body) throw new Error('Source image is missing from R2.');

  // All served/approved assets are newly encoded WebP. The original stays private.
  const started = performance.now();
  const optimized = await env.IMAGES.input(source.body)
    .transform(transform)
    .output(EDITORIAL_OUTPUT);
  const transformMs = Math.round(performance.now() - started);
  const object = await env.MEDIA.put(privateKey(id, asset), optimized.image(), {
    httpMetadata: { contentType: 'image/webp' },
  });
  try {
    await assertUploadActive(env.DB, id);
  } catch (error) {
    await env.MEDIA.delete(object.key);
    throw error;
  }
  return {
    sourceKey,
    objectKey: object.key,
    sourceBytes: source.size,
    outputBytes: object.size,
    transformMs,
    storedAt: new Date().toISOString(),
  };
}
// showcase:end store

// showcase:start crop-plan
export function cropGravity(mode: CropMode, focal: { x: number; y: number } | null) {
  if (mode === 'auto') return 'auto' as const;
  if (mode === 'ai' && focal) {
    return { x: focal.x, y: focal.y, mode: 'box-center' } as const;
  }
  return 'center' as const;
}

export function editorialCrop(
  preset: Preset,
  mode: CropMode,
  focal: { x: number; y: number } | null,
): ImageTransform {
  return {
    width: preset.width,
    height: preset.height,
    fit: 'cover',
    gravity: cropGravity(mode, focal),
  };
}
// showcase:end crop-plan

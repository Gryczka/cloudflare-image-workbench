/** Runs a resolved plan on a versioned public source through the Images binding or cf.image. */
import { type DemoSource } from './catalog';
import { type Overlay, type RecipePlan } from './recipes';

/** The demo source could not be read, or no longer matches its catalog entry. */
export class SourceUnavailable extends Error {}

// showcase:start binding
/** The same plan returned by the inspector is executed against a public, immutable demo asset. */
export async function executeShowcase(
  env: Pick<Env, 'ASSETS' | 'IMAGES'>,
  request: Request,
  source: DemoSource,
  plan: RecipePlan,
): Promise<{
  image: Response;
  originalBytes: number;
  durationMs: number;
}> {
  if (plan.path === 'cf.image') {
    const started = performance.now();
    // Unlike the raw-byte binding, fetch(cf.image) accepts perceptual output quality.
    // Only versioned public demo assets can reach this URL-based transformation path.
    const image = await fetch(
      new Request(new URL(source.asset, request.url), { headers: { accept: 'image/webp' } }),
      { cf: { image: plan.fetchOptions } },
    );
    if (!image.ok || !image.body || !image.headers.get('content-type')?.startsWith('image/webp')) {
      throw new SourceUnavailable('Perceptual image processing is unavailable.');
    }
    return {
      image,
      originalBytes: source.bytes,
      durationMs: Math.round(performance.now() - started),
    };
  }

  const original = await env.ASSETS.fetch(new Request(new URL(source.asset, request.url)));
  if (!original.ok || !original.body) throw new SourceUnavailable('Demo source is unavailable.');

  // Content-Length may be absent; the build verifies each immutable source's bytes and SHA-256.
  const length = Number(original.headers.get('content-length'));
  if (length > 0 && length !== source.bytes)
    throw new SourceUnavailable('The versioned demo source has changed.');
  const started = performance.now();
  let image = env.IMAGES.input(original.body);
  if (plan.overlay?.order === 'before-resize') {
    image = await drawOverlay(env, request, image, plan.overlay);
  }
  for (const transform of plan.transforms) image = image.transform(transform);
  if (plan.overlay?.order === 'after-resize') {
    image = await drawOverlay(env, request, image, plan.overlay);
  }
  const result = await image.output(plan.output);
  return {
    image: result.response(),
    originalBytes: source.bytes,
    durationMs: Math.round(performance.now() - started),
  };
}
// showcase:end binding

// showcase:start overlay
async function drawOverlay(
  env: Pick<Env, 'ASSETS' | 'IMAGES'>,
  request: Request,
  image: ImageTransformer,
  overlay: Overlay,
): Promise<ImageTransformer> {
  if (overlay.kind === 'logo') {
    const logo = await env.ASSETS.fetch(new Request(new URL(overlay.asset, request.url)));
    if (!logo.ok || !logo.body) throw new SourceUnavailable('Demo overlay is unavailable.');
    return image.draw(env.IMAGES.input(logo.body).transform(overlay.transform), overlay.draw);
  }
  // The packaged OFL font has a public, versioned URL for Images text rasterization.
  const font = new URL(overlay.fontAsset, request.url).href;
  return image.draw(
    env.IMAGES.text(overlay.text, {
      font: { url: font },
      size: overlay.size,
      color: overlay.color,
    }),
    overlay.draw,
  );
}
// showcase:end overlay

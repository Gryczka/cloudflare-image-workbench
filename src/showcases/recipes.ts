/** Turns a registered sample, variant, and request headers into an explicit, bounded plan. */
import {
  FONT_ASSET,
  WATERMARK_ASSET,
  showcase,
  showcaseVariant,
  type RequestShowcase,
} from './catalog';

/** A rejected selection, with the HTTP status the route should return. */
export class RecipeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type Overlay =
  | {
      kind: 'logo';
      asset: typeof WATERMARK_ASSET;
      transform: ImageTransform;
      draw: ImageDrawOptions;
      order: 'before-resize' | 'after-resize';
    }
  | {
      kind: 'text';
      text: string;
      fontAsset: typeof FONT_ASSET;
      color: string;
      size: number;
      draw: ImageDrawOptions;
      order: 'after-resize';
    };

interface BaseRecipePlan {
  family: RequestShowcase['id'];
  variant: string;
  /** Operations execute in exactly this order. The overlay is inserted at the indicated stage. */
  transforms: ImageTransform[];
  overlay?: Overlay;
  focalPoint?: { x: number; y: number };
  requestPolicy?: { negotiated: 'avif' | 'webp' | 'jpeg'; saveData: boolean };
}

interface BindingPlan extends BaseRecipePlan {
  path: 'binding';
  output: ImageOutputOptions;
}

interface PerceptualPlan extends BaseRecipePlan {
  path: 'cf.image';
  /** This fixed, public source URL uses the perceptual quality supported by fetch(cf.image). */
  fetchOptions: { width: 960; fit: 'scale-down'; format: 'webp'; quality: 'medium-high' };
  output: { format: 'image/webp'; quality: 'medium-high' };
}

/** Raw-byte Images binding transforms, or the one recipe that uses fetch with cf.image. */
export type RecipePlan = BindingPlan | PerceptualPlan;

const WEBP: ImageOutputOptions = { format: 'image/webp', quality: 82, anim: false };

/** The public point selector is a 3×3 grid, not an arbitrary user-defined transform. */
export function selectedPoint(value: string | null): { x: number; y: number } {
  const match = /^(0\.25|0\.50|0\.75)-(0\.25|0\.50|0\.75)$/.exec(value ?? '0.50-0.50');
  if (!match) throw new RecipeError('Choose a point on the nine-position grid.');
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** A more specific q=0 overrides a wildcard. No supported representation means 406. */
export function accepts(accept: string | null, type: string): number {
  if (!accept) return type === 'image/jpeg' ? 1 : 0;
  if (accept.length > 512) throw new RecipeError('Accept header is too long.');
  let quality = 0;
  let specificity = -1;
  for (const entry of accept.split(',')) {
    const [media, ...params] = entry.trim().toLowerCase().split(';');
    const rank = media === type ? 2 : media === 'image/*' ? 1 : media === '*/*' ? 0 : -1;
    if (rank < 0 || rank < specificity) continue;
    const q = params.find((part) => part.trim().startsWith('q='));
    const value = q ? Number(q.trim().slice(2)) : 1;
    if (!Number.isFinite(value) || value < 0 || value > 1) continue;
    if (rank > specificity || value > quality) quality = value;
    specificity = rank;
  }
  return quality;
}

/** AVIF, then WebP, then JPEG, as the Accept header allows; 406 when none is acceptable. */
export function negotiatedFormat(accept: string | null): 'avif' | 'webp' | 'jpeg' {
  if (accepts(accept, 'image/avif') > 0) return 'avif';
  if (accepts(accept, 'image/webp') > 0) return 'webp';
  if (accepts(accept, 'image/jpeg') > 0) return 'jpeg';
  throw new RecipeError('No supported image format was accepted.', 406);
}

export function resolveRecipe(
  familyId: string,
  variant: string,
  headers: Headers,
  pointValue: string | null = null,
): RecipePlan {
  const family = showcase(familyId);
  if (!family || family.kind !== 'request' || !showcaseVariant(family, variant)) {
    throw new RecipeError('Unknown showcase recipe.', 404);
  }
  if (pointValue !== null && (familyId !== 'framing' || variant !== 'point')) {
    throw new RecipeError('A focal point is only valid for the point-framing recipe.');
  }

  const plan: BindingPlan = {
    family: family.id,
    variant,
    path: 'binding',
    transforms: [],
    output: { ...WEBP },
  };

  switch (family.id) {
    // showcase:start resize
    case 'resize': {
      const sizes: Record<string, ImageTransform> = {
        cover: { width: 720, height: 720, fit: 'cover', gravity: 'center' },
        contain: { width: 720, height: 720, fit: 'contain' },
        pad: { width: 720, height: 720, fit: 'pad', background: '#f4ead8' },
        enlarge: { width: 1800, height: 1800, fit: 'cover', gravity: 'center' },
        crop: { width: 1800, height: 1800, fit: 'crop', gravity: 'center' },
      };
      plan.transforms.push(sizes[variant]);
      break;
    }
    // showcase:end resize
    // showcase:start framing
    case 'framing': {
      const point = variant === 'point' ? selectedPoint(pointValue) : undefined;
      plan.transforms.push({
        width: 720,
        height: 480,
        fit: 'cover',
        gravity: point
          ? { x: point.x, y: point.y, mode: 'box-center' }
          : variant === 'saliency'
            ? 'auto'
            : variant === 'face'
              ? 'face'
              : 'center',
      });
      if (point) plan.focalPoint = point;
      break;
    }
    // showcase:end framing
    // showcase:start format
    case 'format': {
      if (variant === 'webp-perceptual') {
        // This variant demonstrates fetch(cf.image) with a named perceptual quality level.
        // The source is always one of our immutable public demo assets, never a private upload.
        return {
          family: family.id,
          variant,
          path: 'cf.image',
          transforms: [],
          fetchOptions: {
            width: 960,
            fit: 'scale-down',
            format: 'webp',
            quality: 'medium-high',
          },
          output: { format: 'image/webp', quality: 'medium-high' },
        };
      }
      plan.transforms.push({ width: 960, fit: 'scale-down' });
      plan.output =
        variant === 'jpeg'
          ? { format: 'image/jpeg', quality: 85, anim: false }
          : variant === 'avif'
            ? { format: 'image/avif', quality: 60, anim: false }
            : { format: 'image/webp', quality: variant === 'webp-small' ? 55 : 82, anim: false };
      break;
    }
    // showcase:end format
    // showcase:start effects
    case 'effects': {
      if (variant === 'grayscale') {
        plan.transforms.push({ width: 640, fit: 'scale-down' }, { saturation: 0, contrast: 1.35 });
      } else if (variant === 'sharpen') {
        plan.transforms.push({ width: 640, fit: 'scale-down' }, { sharpen: 2 });
      } else if (variant === 'blur-first') {
        plan.transforms.push({ blur: 14 }, { width: 640, fit: 'scale-down' });
      } else if (variant === 'resize-first') {
        plan.transforms.push({ width: 640, fit: 'scale-down' }, { blur: 14 });
      } else {
        plan.transforms.push({ rotate: 90 }, { flip: 'h' }, { width: 640, fit: 'scale-down' });
      }
      break;
    }
    // showcase:end effects
    // showcase:start composition
    case 'composition': {
      plan.transforms.push({ width: 660, fit: 'scale-down' });
      plan.overlay =
        variant === 'text'
          ? {
              kind: 'text',
              text: 'IMAGE / WORKBENCH',
              fontAsset: FONT_ASSET,
              size: 30,
              color: '#923400',
              draw: { left: 20, bottom: 20 },
              order: 'after-resize',
            }
          : {
              kind: 'logo',
              asset: WATERMARK_ASSET,
              transform: { width: 180 },
              draw: { right: 14, bottom: 14, opacity: 0.88 },
              order: variant === 'logo-before' ? 'before-resize' : 'after-resize',
            };
      break;
    }
    // showcase:end composition
    // showcase:start responsive
    case 'responsive': {
      const negotiated = negotiatedFormat(headers.get('accept'));
      const saveData = headers.get('save-data')?.toLowerCase() === 'on';
      plan.transforms.push({ width: Number(variant), fit: 'scale-down' });
      plan.output = {
        format: `image/${negotiated}` as ImageOutputOptions['format'],
        quality: saveData ? 55 : 82,
        anim: false,
      };
      plan.requestPolicy = { negotiated, saveData };
      break;
    }
    // showcase:end responsive
  }
  return plan;
}

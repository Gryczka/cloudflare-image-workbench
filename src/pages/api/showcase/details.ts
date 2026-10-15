import type { APIRoute } from 'astro';
import { noStoreJson, sha256 } from '../../../lib/security';
import { demoSource, showcase, showcaseVariant } from '../../../showcases/catalog';
import { publicCode, workflowCode } from '../../../showcases/code';
import { RecipeError, resolveRecipe } from '../../../showcases/recipes';
import { validateQuery } from '../../../showcases/requests';
import { recipeIdentity } from '../../../showcases/version';

/** The resolved plan, versioned image URL, and source excerpts for a sample's inspector. */
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    validateQuery(url.searchParams, ['source', 'family', 'variant', 'point']);
    const source = demoSource(url.searchParams.get('source') ?? '');
    const family = showcase(url.searchParams.get('family') ?? '');
    const variant = url.searchParams.get('variant') ?? '';
    if (!source || !family || !showcaseVariant(family, variant)) {
      throw new RecipeError('Unknown showcase selection.', 404);
    }

    if (family.kind === 'workflow') {
      if (url.searchParams.has('point'))
        throw new RecipeError('This workflow has no point control.');
      const code = workflowCode(family.id);
      return noStoreJson({
        kind: 'workflow',
        family,
        variant,
        source,
        code,
        version: (await sha256(JSON.stringify(code))).slice(0, 16),
        execution:
          'Upload-time Workflow · only a completed private run has actual result provenance',
      });
    }

    const plan = resolveRecipe(family.id, variant, request.headers, url.searchParams.get('point'));
    const { version, planDigest } = await recipeIdentity(plan);
    const imageUrl = new URL(`/api/showcase/${source.id}/${family.id}/${variant}`, request.url);
    imageUrl.searchParams.set('v', version);
    if (plan.focalPoint) {
      imageUrl.searchParams.set(
        'point',
        `${plan.focalPoint.x.toFixed(2)}-${plan.focalPoint.y.toFixed(2)}`,
      );
    }

    return noStoreJson({
      kind: 'request',
      family:
        plan.path === 'cf.image'
          ? {
              ...family,
              flow: [
                'Browser recipe URL',
                'HTTP Worker · bounded public source',
                'fetch · ASSETS public original',
                'cf.image · perceptual WebP',
                'Workers Cache · image',
              ],
            }
          : family,
      variant,
      source,
      plan,
      version,
      planDigest,
      imageUrl: imageUrl.pathname + imageUrl.search,
      code: publicCode(family.id),
      execution:
        plan.path === 'cf.image'
          ? 'Request-time HTTP Worker · fetch(cf.image) on a versioned public asset with a named perceptual quality'
          : 'Request-time HTTP Worker · raw-byte Images binding output',
    });
  } catch (error) {
    return error instanceof RecipeError
      ? noStoreJson({ error: error.message }, error.status)
      : noStoreJson({ error: 'Showcase details are unavailable.' }, 503);
  }
};

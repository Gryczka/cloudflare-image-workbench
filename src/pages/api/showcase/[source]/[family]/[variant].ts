import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { clientNetwork } from '../../../../../lib/clients';
import { noStoreJson } from '../../../../../lib/security';
import { demoSource } from '../../../../../showcases/catalog';
import { executeShowcase, SourceUnavailable } from '../../../../../showcases/execute';
import { RecipeError, resolveRecipe } from '../../../../../showcases/recipes';
import { validateQuery } from '../../../../../showcases/requests';
import { recipeIdentity } from '../../../../../showcases/version';

/** Execute one registered recipe at its current version; only a successful transform is cached. */
// showcase:start handler
export const GET: APIRoute = async ({ request, params }) => {
  const url = new URL(request.url);
  try {
    validateQuery(url.searchParams, ['v', 'point']);
    const source = demoSource(params.source ?? '');
    if (!source) throw new RecipeError('Unknown public demo source.', 404);
    const plan = resolveRecipe(
      params.family ?? '',
      params.variant ?? '',
      request.headers,
      url.searchParams.get('point'),
    );
    const { version, planDigest } = await recipeIdentity(plan);
    if (url.searchParams.get('v') !== version) {
      throw new RecipeError('This recipe URL is out of date. Refresh the workbench.', 409);
    }

    // The edge cache serves repeat public requests before this handler runs.
    const actor = clientNetwork(request.headers.get('cf-connecting-ip'));
    const allowed = await env.SHOWCASE_THROTTLE.limit({ key: `sample:${actor}` });
    if (!allowed.success) throw new RecipeError('The live sample is busy. Try again shortly.', 429);

    const { image, originalBytes, durationMs } = await executeShowcase(env, request, source, plan);
    // Copy only representation headers; subrequest cache and resize metadata stays internal.
    const headers = new Headers();
    for (const name of ['content-type', 'content-length']) {
      const value = image.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Browsers revalidate; the edge keeps an hour and can refresh in the background for a day.
    headers.set('cache-control', 'public, max-age=0');
    headers.set(
      'cloudflare-cdn-cache-control',
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    headers.set('x-workbench-recipe-version', version);
    headers.set('x-workbench-source-sha256', source.sha256);
    headers.set('x-workbench-plan-digest', planDigest);
    headers.set('x-workbench-operation', plan.path);
    headers.set('x-workbench-operation-ms', String(durationMs));
    headers.set('x-workbench-response-at', new Date().toISOString());
    headers.set('x-workbench-source-bytes', String(originalBytes));
    if (plan.family === 'responsive') headers.set('vary', 'Accept, Save-Data');
    return new Response(image.body, { status: image.status, headers });
  } catch (error) {
    if (error instanceof RecipeError) return noStoreJson({ error: error.message }, error.status);
    console.error(JSON.stringify({ event: 'showcase_transform_failed', cause: String(error) }));
    return noStoreJson(
      {
        error:
          error instanceof SourceUnavailable ? error.message : 'Image processing is unavailable.',
      },
      503,
    );
  }
};
// showcase:end handler

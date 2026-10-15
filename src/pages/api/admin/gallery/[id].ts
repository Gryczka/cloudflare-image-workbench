import { cache, env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { reviewerDenied } from '../../../../lib/api';
import { ReviewError } from '../../../../lib/gallery';
import { noStoreJson, sameOrigin, type AppEnv } from '../../../../lib/security';
import { takeDownGallery } from '../../../../lib/takedown';

/** Only an authenticated operator can withdraw a published example. */
export const DELETE: APIRoute = async ({ request, params }) => {
  const denied = await reviewerDenied(request, env as AppEnv);
  if (denied) return denied;
  if (!sameOrigin(request)) return noStoreJson({ error: 'Invalid request origin.' }, 403);
  try {
    await takeDownGallery(env, params.id ?? '', cache);
    return noStoreJson({ removed: true });
  } catch (error) {
    if (error instanceof ReviewError) return noStoreJson({ error: error.message }, error.status);
    return noStoreJson({ error: 'Takedown incomplete. Retry this request.' }, 503);
  }
};

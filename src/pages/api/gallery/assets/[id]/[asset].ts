import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { galleryKey, assetName } from '../../../../../lib/media';
import { noStoreJson } from '../../../../../lib/security';

/** One asset of a published example, cached at the edge until a takedown purges its tag. */
// showcase:start approved-asset
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  const asset = params.asset ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(id)) {
    return noStoreJson({ error: 'Image not found.' }, 404);
  }

  const row = await env.DB.prepare(
    'SELECT outputs_json, has_creative FROM gallery WHERE id = ? AND published = 1',
  )
    .bind(id)
    .first<{ outputs_json: string; has_creative: number }>();
  if (!row) return noStoreJson({ error: 'Image not found.' }, 404);
  const crop = /^([a-z]+)-(center|auto|ai)$/.exec(asset);
  const allowed =
    asset === 'preview' ||
    (asset === 'creative' && row.has_creative === 1) ||
    (crop &&
      assetName(crop[1], crop[2]) === asset &&
      (JSON.parse(row.outputs_json) as string[]).includes(asset));
  if (!allowed) return noStoreJson({ error: 'Image not found.' }, 404);

  const object = await env.MEDIA.get(galleryKey(id, asset));
  if (!object?.body) return noStoreJson({ error: 'Image not found.' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=60, must-revalidate',
      'cloudflare-cdn-cache-control': 'public, max-age=86400, must-revalidate',
      'cache-tag': `gallery-${id}`,
      'cross-origin-resource-policy': 'same-origin',
      // The gallery API attributes a model only when its generation record is available.
      ...(asset === 'creative' ? { 'x-image-provenance': 'synthetic' } : {}),
    },
  });
};
// showcase:end approved-asset

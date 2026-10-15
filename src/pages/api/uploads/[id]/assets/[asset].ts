import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { assetName, privateKey } from '../../../../../lib/media';
import { noStoreJson } from '../../../../../lib/security';
import { authorizedUpload } from '../../../../../lib/uploads';

/** One private asset behind the capability; originals and temporary creative files stay in R2. */
// showcase:start authorized-asset
export const GET: APIRoute = async ({ request, params }) => {
  const row = await authorizedUpload(env.DB, request, params.id ?? '');
  if (!row) return noStoreJson({ error: 'Result not found.' }, 404);

  const asset = params.asset ?? '';
  const crop = /^([a-z]+)-(center|auto|ai)$/.exec(asset);
  const validCrop = crop && assetName(crop[1], crop[2]) === asset;
  const ready = row.status === 'ready' || row.status === 'partial';
  const allowed =
    (asset === 'preview' && row.status !== 'queued') ||
    (asset === 'creative' && row.creative_status === 'ready') ||
    (ready && validCrop && (JSON.parse(row.outputs_json) as string[]).includes(asset));
  if (!allowed) return noStoreJson({ error: 'Result not found.' }, 404);

  const object = await env.MEDIA.get(privateKey(row.id, asset));
  if (!object?.body) return noStoreJson({ error: 'Result not found.' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'cache-control': 'private, no-store',
      'content-disposition': `inline; filename="image-workbench-${asset}.webp"`,
      'cross-origin-resource-policy': 'same-origin',
    },
  });
};
// showcase:end authorized-asset

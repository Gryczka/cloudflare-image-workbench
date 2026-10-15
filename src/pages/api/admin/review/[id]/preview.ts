import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { reviewerDenied } from '../../../../../lib/api';
import { privateKey } from '../../../../../lib/media';
import { noStoreJson, type AppEnv } from '../../../../../lib/security';

/** Operator: the private preview of a finished, unexpired upload. */
export const GET: APIRoute = async ({ request, params }) => {
  const denied = await reviewerDenied(request, env as AppEnv);
  if (denied) return denied;
  const id = params.id ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(id)) {
    return noStoreJson({ error: 'Image not found.' }, 404);
  }
  const row = await env.DB.prepare(
    `SELECT id FROM uploads WHERE id = ? AND expires_at > ? AND status IN ('ready', 'partial')`,
  )
    .bind(id, Date.now())
    .first();
  if (!row) return noStoreJson({ error: 'Image not found.' }, 404);
  const object = await env.MEDIA.get(privateKey(id, 'preview'));
  if (!object?.body) return noStoreJson({ error: 'Image not found.' }, 404);
  return new Response(object.body, {
    headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' },
  });
};

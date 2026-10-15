import { cache, env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { reviewerDenied } from '../../../../lib/api';
import { approveGallery, ReviewError, galleryView } from '../../../../lib/gallery';
import { UploadError } from '../../../../lib/media';
import { boundedJson } from '../../../../lib/requests';
import { noStoreJson, sameOrigin, type AppEnv } from '../../../../lib/security';

/** Operator: unexpired uploads whose owners opted into the gallery, with their credits. */
export const GET: APIRoute = async ({ request }) => {
  const denied = await reviewerDenied(request, env as AppEnv);
  if (denied) return denied;
  const { results } = await env.DB.prepare(
    `SELECT uploads.id, uploads.status, uploads.caption, uploads.alt_text, uploads.subject,
             uploads.creative_status, uploads.expires_at, uploads.consent_credit
     FROM uploads LEFT JOIN gallery ON gallery.upload_id = uploads.id
      WHERE gallery.id IS NULL AND uploads.expires_at > ?
        AND uploads.gallery_consent_at IS NOT NULL AND uploads.consent_credit IS NOT NULL
       AND uploads.status IN ('ready', 'partial')
     ORDER BY uploads.created_at DESC LIMIT 30`,
  )
    .bind(Date.now())
    .all();
  return noStoreJson({ pending: results });
};

/** Operator: publish one consented upload to the gallery; see `approveGallery`. */
export const POST: APIRoute = async ({ request }) => {
  const denied = await reviewerDenied(request, env as AppEnv);
  if (denied) return denied;
  if (!sameOrigin(request)) return noStoreJson({ error: 'Invalid request origin.' }, 403);
  try {
    const input = await boundedJson(request);
    if (!input || typeof input !== 'object') throw new ReviewError('Invalid review details.');
    if (!('id' in input) || typeof input.id !== 'string')
      throw new ReviewError('Choose an upload.');
    if (!('title' in input) || typeof input.title !== 'string')
      throw new ReviewError('A title is required.');
    if (!('credit' in input) || typeof input.credit !== 'string')
      throw new ReviewError('An image credit is required.');
    const caption =
      'caption' in input && typeof input.caption === 'string' ? input.caption : undefined;
    const altText =
      'altText' in input && typeof input.altText === 'string' ? input.altText : undefined;
    const includeCreative = 'includeCreative' in input && input.includeCreative === true;

    const row = await approveGallery(env, {
      id: input.id,
      title: input.title,
      credit: input.credit,
      caption,
      altText,
      includeCreative,
    });
    // The gallery list is edge-cached; a failed purge only delays the new item by a few minutes.
    const purged = await cache.purge({ tags: ['gallery-list'] }).catch(() => null);
    if (!purged?.success) console.warn(JSON.stringify({ event: 'gallery_list_purge_failed' }));
    return noStoreJson(galleryView(row), 201);
  } catch (error) {
    if (error instanceof ReviewError || error instanceof UploadError) {
      return noStoreJson({ error: error.message }, error.status);
    }
    console.error('Review publication failed', error);
    return noStoreJson({ error: 'Publication is temporarily unavailable.' }, 503);
  }
};

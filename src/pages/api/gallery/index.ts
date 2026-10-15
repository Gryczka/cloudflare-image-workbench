import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { galleryView, type GalleryRow } from '../../../lib/gallery';
import { noStoreJson } from '../../../lib/security';

/** The 12 newest published examples. */
export const GET: APIRoute = async () => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, upload_id, title, caption, alt_text, credit, approved_at, outputs_json, has_creative, provenance_json
       FROM gallery WHERE published = 1 ORDER BY approved_at DESC LIMIT 12`,
    ).all<GalleryRow>();
    // Approval and takedown purge the gallery-list tag, so the edge copy can live longer.
    return Response.json(
      { items: results.map(galleryView) },
      {
        headers: {
          'cache-control': 'public, max-age=0, must-revalidate',
          'cloudflare-cdn-cache-control': 'public, max-age=300, must-revalidate',
          'cache-tag': 'gallery-list',
        },
      },
    );
  } catch (error) {
    console.error('Gallery unavailable', error);
    return noStoreJson({ items: [], error: 'Examples are temporarily unavailable.' }, 503);
  }
};

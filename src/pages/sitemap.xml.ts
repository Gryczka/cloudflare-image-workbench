import type { APIRoute } from 'astro';

/** The single public page; the canonical origin when SITE_URL is set, else the serving host. */
export const GET: APIRoute = ({ request, site }) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${new URL('/', site ?? request.url).href}</loc></url></urlset>\n`,
    {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    },
  );

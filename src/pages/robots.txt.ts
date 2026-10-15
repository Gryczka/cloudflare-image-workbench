import type { APIRoute } from 'astro';

/** Served per request so a copy without SITE_URL still points at its own sitemap. */
export const GET: APIRoute = ({ request, site }) =>
  new Response(
    [
      'User-agent: *',
      'Content-Signal: search=yes, ai-input=yes, ai-train=no',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /health',
      '',
      `Sitemap: ${new URL('/sitemap.xml', site ?? request.url).href}`,
      '',
    ].join('\n'),
    {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    },
  );

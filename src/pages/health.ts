import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  Response.json(
    { ok: true, service: 'image-workbench' },
    { headers: { 'cache-control': 'no-store' } },
  );

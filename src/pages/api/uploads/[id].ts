import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { noStoreJson } from '../../../lib/security';
import { authorizedUpload, uploadView } from '../../../lib/uploads';

/** The owner's view of one result; requires the upload's capability token. */
export const GET: APIRoute = async ({ request, params }) => {
  const row = await authorizedUpload(env.DB, request, params.id ?? '');
  return row ? noStoreJson(uploadView(row)) : noStoreJson({ error: 'Result not found.' }, 404);
};

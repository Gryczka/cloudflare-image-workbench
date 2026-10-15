import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { publicUploadsEnabled, reserveAllowance, throttle } from '../../../../lib/api';
import { CREATIVE_STYLES, IMAGE_MODEL_LABEL, type CreativeStyle } from '../../../../lib/ai';
import { UploadError } from '../../../../lib/media';
import { boundedJson } from '../../../../lib/requests';
import { noStoreJson, sameOrigin, verifyTurnstile, type AppEnv } from '../../../../lib/security';
import { authorizedUpload } from '../../../../lib/uploads';

/** Start an upload's one synthetic illustration once Turnstile and the creative quota allow it. */
export const POST: APIRoute = async ({ request, params }) => {
  const runtime = env as AppEnv;
  if (!publicUploadsEnabled(runtime))
    return noStoreJson({ error: 'Creative uploads are paused.' }, 503);
  if (!sameOrigin(request)) return noStoreJson({ error: 'Invalid request origin.' }, 403);
  const row = await authorizedUpload(runtime.DB, request, params.id ?? '');
  if (!row) return noStoreJson({ error: 'Result not found.' }, 404);
  if (!['ready', 'partial'].includes(row.status)) {
    return noStoreJson({ error: 'Wait for the editorial image first.' }, 409);
  }
  if (row.creative_status !== 'idle')
    return noStoreJson({ error: 'One creative image is allowed per upload.' }, 409);

  try {
    if (!(await throttle(request, runtime, 'creative'))) {
      return noStoreJson({ error: 'Too many attempts. Try again shortly.' }, 429);
    }
    const body = await boundedJson(request);
    if (!body || typeof body !== 'object' || !('style' in body) || !('token' in body)) {
      return noStoreJson({ error: 'Choose a creative style.' }, 400);
    }
    const style = body.style;
    if (typeof style !== 'string' || !Object.hasOwn(CREATIVE_STYLES, style)) {
      return noStoreJson({ error: 'Choose one of the displayed creative styles.' }, 400);
    }
    if (!(await verifyTurnstile(request, runtime, body.token, 'creative'))) {
      return noStoreJson({ error: 'Verification expired or failed. Please try again.' }, 403);
    }

    const now = new Date();
    const allowance = await reserveAllowance(runtime.DB, request, 'creative', now);
    if (allowance === 'client-exhausted') {
      return noStoreJson({ error: 'Your network has used today’s creative allowance.' }, 429);
    }
    if (allowance === 'budget-exhausted') {
      return noStoreJson({ error: 'The demo creative budget is exhausted.' }, 429);
    }

    const claimed = await runtime.DB.prepare(
      `UPDATE uploads SET creative_status = 'queued', creative_prompt = ?
       WHERE id = ? AND creative_status = 'idle' AND expires_at > ? RETURNING id`,
    )
      .bind(style, row.id, now.getTime())
      .first();
    if (!claimed) {
      await allowance.release();
      return noStoreJson({ error: 'One creative image is allowed per upload.' }, 409);
    }

    try {
      const id = `creative-${row.id}`;
      try {
        await runtime.PROCESS_IMAGE.create({
          id,
          params: { id: row.id, kind: 'creative', style: style as CreativeStyle },
          retention: { successRetention: '1 day', errorRetention: '1 day' },
        });
      } catch {
        await runtime.PROCESS_IMAGE.get(id);
      }
    } catch (error) {
      await runtime.DB.prepare(
        `UPDATE uploads SET creative_status = 'idle', creative_prompt = NULL WHERE id = ? AND creative_status = 'queued'`,
      )
        .bind(row.id)
        .run();
      await allowance.release();
      throw error;
    }
    return noStoreJson({ status: 'queued', model: `${IMAGE_MODEL_LABEL} · synthetic image` }, 202);
  } catch (error) {
    if (error instanceof UploadError) return noStoreJson({ error: error.message }, error.status);
    console.error('Creative generation unavailable', { id: row.id, error });
    return noStoreJson({ error: 'Creative generation is temporarily unavailable.' }, 503);
  }
};

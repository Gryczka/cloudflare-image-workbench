import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { publicUploadsEnabled, reserveAllowance, throttle } from '../../../lib/api';
import { MAX_UPLOAD_BYTES, UploadError, inspectImage, originalKey } from '../../../lib/media';
import { boundedFormData } from '../../../lib/requests';
import {
  issueCapability,
  noStoreJson,
  sha256Bytes,
  sameOrigin,
  verifyTurnstile,
  type AppEnv,
} from '../../../lib/security';
import { createUploadRecord } from '../../../lib/uploads';
import { uploadConsent } from '../../../lib/consent';

/** Accept one Turnstile-verified upload within all limits and return its capability once. */
export const POST: APIRoute = async ({ request }) => {
  const runtime = env as AppEnv;
  if (!publicUploadsEnabled(runtime))
    return noStoreJson({ error: 'Public uploads are paused.' }, 503);
  if (!sameOrigin(request)) return noStoreJson({ error: 'Invalid request origin.' }, 403);

  try {
    if (!(await throttle(request, runtime, 'upload'))) {
      return noStoreJson({ error: 'Too many attempts. Try again shortly.' }, 429);
    }
    const form = await boundedFormData(request, MAX_UPLOAD_BYTES + 131_072);
    if (!(await verifyTurnstile(request, runtime, form.get('cf-turnstile-response'), 'upload'))) {
      return noStoreJson({ error: 'Verification expired or failed. Please try again.' }, 403);
    }
    const file = form.get('image');
    if (!(file instanceof File)) return noStoreJson({ error: 'Choose one image to upload.' }, 400);
    const image = await inspectImage(file, runtime.IMAGES);
    const now = new Date();
    const consent = uploadConsent(form, now.getTime());
    const allowance = await reserveAllowance(runtime.DB, request, 'upload', now);
    if (allowance === 'client-exhausted') {
      return noStoreJson({ error: 'Your network has used today’s upload allowance.' }, 429);
    }
    if (allowance === 'budget-exhausted') {
      return noStoreJson({ error: 'The demo upload budget is exhausted.' }, 429);
    }

    const id = crypto.randomUUID();
    const capability = await issueCapability();
    try {
      await createUploadRecord(runtime.DB, {
        id,
        hash: capability.hash,
        mime: image.mime,
        width: image.width,
        height: image.height,
        now: now.getTime(),
        sourceHash: await sha256Bytes(image.bytes),
        sourceBytes: image.bytes.byteLength,
        ...consent,
      });
      await runtime.MEDIA.put(originalKey(id), image.bytes, {
        httpMetadata: { contentType: image.mime },
      });
    } catch (error) {
      await Promise.allSettled([
        runtime.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run(),
        runtime.MEDIA.delete(originalKey(id)),
        allowance.release(),
      ]);
      throw error;
    }

    // R2 notifications never fire locally and may not be configured on a fresh deployment.
    // The Workflow ID is deterministic, so a later start from the Queue is a no-op.
    if (String(runtime.START_WORKFLOW_ON_UPLOAD) === 'true') {
      try {
        await runtime.PROCESS_IMAGE.create({
          id: `edit-${id}`,
          params: { id, kind: 'editorial' },
          retention: { successRetention: '1 day', errorRetention: '1 day' },
        });
      } catch (error) {
        console.error('Could not start the image Workflow from the upload', { id, error });
      }
    }

    return noStoreJson(
      {
        id,
        capability: capability.token,
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      202,
    );
  } catch (error) {
    if (error instanceof UploadError) return noStoreJson({ error: error.message }, error.status);
    console.error('Upload unavailable', error);
    return noStoreJson({ error: 'The image could not be stored. Please try again.' }, 503);
  }
};

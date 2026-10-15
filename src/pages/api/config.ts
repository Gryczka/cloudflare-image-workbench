import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import {
  CREATIVE_CLIENT_DAILY_LIMIT,
  CREATIVE_DAILY_LIMIT,
  CREATIVE_MONTHLY_LIMIT,
  UPLOAD_CLIENT_DAILY_LIMIT,
  UPLOAD_DAILY_LIMIT,
  UPLOAD_MONTHLY_LIMIT,
  publicUploadsEnabled,
} from '../../lib/api';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES } from '../../lib/media';
import { noStoreJson, type AppEnv } from '../../lib/security';

/** Whether uploads are open, the Turnstile site key when they are, and the demo limits. */
export const GET: APIRoute = () => {
  const runtime = env as AppEnv;
  const enabled = publicUploadsEnabled(runtime);
  return noStoreJson({
    enabled,
    siteKey: enabled ? runtime.TURNSTILE_SITE_KEY : null,
    limits: {
      bytes: MAX_UPLOAD_BYTES,
      megapixels: MAX_IMAGE_PIXELS / 1_000_000,
      uploadsPerDay: UPLOAD_DAILY_LIMIT,
      uploadsPerMonth: UPLOAD_MONTHLY_LIMIT,
      uploadsPerClientDay: UPLOAD_CLIENT_DAILY_LIMIT,
      creativePerDay: CREATIVE_DAILY_LIMIT,
      creativePerMonth: CREATIVE_MONTHLY_LIMIT,
      creativePerClientDay: CREATIVE_CLIENT_DAILY_LIMIT,
    },
  });
};

/** Shared route guards: the upload gate, abuse throttles, quota reservations, and operator auth. */
import { clientKey, clientNetwork } from './clients';
import {
  releaseClientQuota,
  releaseQuota,
  reserveClientQuota,
  reserveQuota,
  type QuotaKind,
} from './quota';
import { isReviewer, noStoreJson, type AppEnv } from './security';

/** Shared budgets per UTC day and month; client limits apply per network per UTC day. */
export const UPLOAD_DAILY_LIMIT = 8;
export const UPLOAD_MONTHLY_LIMIT = 120;
export const UPLOAD_CLIENT_DAILY_LIMIT = 3;
export const CREATIVE_DAILY_LIMIT = 2;
export const CREATIVE_MONTHLY_LIMIT = 10;
export const CREATIVE_CLIENT_DAILY_LIMIT = 1;

const ALLOWANCES = {
  upload: {
    day: UPLOAD_DAILY_LIMIT,
    month: UPLOAD_MONTHLY_LIMIT,
    client: UPLOAD_CLIENT_DAILY_LIMIT,
  },
  creative: {
    day: CREATIVE_DAILY_LIMIT,
    month: CREATIVE_MONTHLY_LIMIT,
    client: CREATIVE_CLIENT_DAILY_LIMIT,
  },
} as const;

/** Uploads open only when explicitly enabled and both Turnstile values are configured. */
export function publicUploadsEnabled(env: AppEnv): boolean {
  return (
    String(env.PUBLIC_UPLOADS_ENABLED) === 'true' &&
    Boolean(env.TURNSTILE_SITE_KEY) &&
    Boolean(env.TURNSTILE_SECRET)
  );
}

/** A per-action rate limit for one network: an IPv4 address or an IPv6 /64. */
export async function throttle(
  request: Request,
  env: Pick<Env, 'UPLOAD_THROTTLE'>,
  action: 'upload' | 'creative' | 'admin',
): Promise<boolean> {
  // Local abuse throttle, never an authoritative quota; D1 enforces the global cap.
  const actor = clientNetwork(request.headers.get('cf-connecting-ip'));
  const result = await env.UPLOAD_THROTTLE.limit({ key: `${action}:${actor}` });
  return result.success;
}

export interface Allowance {
  release(): Promise<void>;
}

/** Reserve the client's daily allowance, then the shared budget; undo the first if needed. */
export async function reserveAllowance(
  db: D1Database,
  request: Request,
  kind: QuotaKind,
  now: Date,
): Promise<Allowance | 'client-exhausted' | 'budget-exhausted'> {
  const limits = ALLOWANCES[kind];
  const client = await clientKey(db, request, now.toISOString().slice(0, 10));
  if (!(await reserveClientQuota(db, kind, client, now, limits.client))) return 'client-exhausted';
  if (!(await reserveQuota(db, kind, now, limits))) {
    await releaseClientQuota(db, kind, client, now);
    return 'budget-exhausted';
  }
  return {
    async release() {
      await Promise.allSettled([
        releaseQuota(db, kind, now),
        releaseClientQuota(db, kind, client, now),
      ]);
    },
  };
}

/** Wrong or missing operator tokens consume a per-network allowance: 401, then 429. */
export async function reviewerDenied(request: Request, env: AppEnv): Promise<Response | null> {
  if (await isReviewer(request, env)) return null;
  return (await throttle(request, env, 'admin'))
    ? noStoreJson({ error: 'Unauthorized.' }, 401)
    : noStoreJson({ error: 'Too many attempts. Try again shortly.' }, 429);
}

/** Response helpers, private-result capabilities, Turnstile verification, and operator auth. */

/** The generated bindings plus the two secrets, which `wrangler types` does not see. */
export type AppEnv = Env & {
  TURNSTILE_SECRET?: string;
  ADMIN_REVIEW_TOKEN?: string;
};

/** JSON that neither browsers nor the edge may cache. */
export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A 256-bit, URL-safe bearer token for one private result; only its SHA-256 is stored. */
export async function issueCapability(): Promise<{ token: string; hash: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...random))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return { token, hash: await sha256(token) };
}

/** The token from an `Authorization: Bearer` header, if it has the expected shape. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function verifyTurnstile(
  request: Request,
  env: Pick<AppEnv, 'TURNSTILE_SECRET'>,
  token: unknown,
  expectedAction: 'upload' | 'creative',
): Promise<boolean> {
  if (
    !env.TURNSTILE_SECRET ||
    typeof token !== 'string' ||
    token.length < 1 ||
    token.length > 2048
  ) {
    return false;
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return (
      typeof result === 'object' &&
      result !== null &&
      'success' in result &&
      result.success === true &&
      'action' in result &&
      result.action === expectedAction &&
      'hostname' in result &&
      result.hostname === new URL(request.url).hostname
    );
  } catch {
    return false;
  }
}

/** Fixed-size digest comparison for the operator's bearer secret. */
export async function isReviewer(request: Request, env: AppEnv): Promise<boolean> {
  if (env.ADMIN_REVIEW_TOKEN && !/^[A-Za-z0-9_-]{32,128}$/.test(env.ADMIN_REVIEW_TOKEN)) {
    // A base64 secret (with + / =) can never match a bearer header. Use `openssl rand -hex 32`.
    console.warn(JSON.stringify({ event: 'admin_token_misconfigured' }));
    return false;
  }
  const value = bearerToken(request);
  if (!value || !env.ADMIN_REVIEW_TOKEN) return false;
  const [provided, expected] = await Promise.all([sha256(value), sha256(env.ADMIN_REVIEW_TOKEN)]);
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return diff === 0;
}

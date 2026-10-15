import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueCapability, verifyTurnstile } from '../src/lib/security';

afterEach(() => vi.unstubAllGlobals());

const HOST = 'workbench.example.com';
const SECRET = { TURNSTILE_SECRET: 'test-secret' };
const VERIFIED = { success: true, action: 'upload', hostname: HOST };

function uploadRequest(): Request {
  return new Request(`https://${HOST}/api/uploads`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': '203.0.113.7' },
  });
}

/** Answer every Siteverify call with `respond`, which may also throw. */
function siteverify(respond: () => Response) {
  const call = vi.fn<typeof fetch>(async () => respond());
  vi.stubGlobal('fetch', call);
  return call;
}

describe('private result access', () => {
  it('issues unpredictable bearer capabilities with stable hashes', async () => {
    const first = await issueCapability();
    const second = await issueCapability();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('Turnstile verification', () => {
  it('accepts a successful token for the expected action and exact hostname', async () => {
    const call = siteverify(() => Response.json(VERIFIED));
    expect(await verifyTurnstile(uploadRequest(), SECRET, 'token', 'upload')).toBe(true);
    expect(call).toHaveBeenCalledOnce();
    const [url, init] = call.mock.calls[0];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init?.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      secret: 'test-secret',
      response: 'token',
      remoteip: '203.0.113.7',
    });
  });

  it.each([
    ['issued for another action', { ...VERIFIED, action: 'creative' }],
    ['issued for another hostname', { ...VERIFIED, hostname: 'other.example' }],
    ['issued for the parent domain', { ...VERIFIED, hostname: 'example.com' }],
    ['without an action or hostname', { success: true }],
    [
      'that Siteverify rejects, such as a replay',
      { ...VERIFIED, success: false, 'error-codes': ['timeout-or-duplicate'] },
    ],
  ])('rejects a token %s', async (_case, result) => {
    siteverify(() => Response.json(result));
    expect(await verifyTurnstile(uploadRequest(), SECRET, 'token', 'upload')).toBe(false);
  });

  it('fails closed on a non-2xx Siteverify status, even if the body claims success', async () => {
    siteverify(() => Response.json(VERIFIED, { status: 500 }));
    expect(await verifyTurnstile(uploadRequest(), SECRET, 'token', 'upload')).toBe(false);
  });

  it('fails closed if Siteverify cannot be reached', async () => {
    siteverify(() => {
      throw new TypeError('Network connection lost.');
    });
    expect(await verifyTurnstile(uploadRequest(), SECRET, 'token', 'upload')).toBe(false);
  });

  it('fails closed if Siteverify returns something other than JSON', async () => {
    siteverify(() => new Response('<html>Bad gateway</html>', { status: 200 }));
    expect(await verifyTurnstile(uploadRequest(), SECRET, 'token', 'upload')).toBe(false);
  });

  it('fails closed without calling Siteverify if the secret or token is unusable', async () => {
    const call = siteverify(() => Response.json(VERIFIED));
    expect(await verifyTurnstile(uploadRequest(), {}, 'token', 'upload')).toBe(false);
    for (const token of [undefined, 42, '', 'x'.repeat(2049)]) {
      expect(await verifyTurnstile(uploadRequest(), SECRET, token, 'upload')).toBe(false);
    }
    expect(call).not.toHaveBeenCalled();
  });
});

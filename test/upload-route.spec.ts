import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { originalKey } from '../src/lib/media';
import { POST as upload } from '../src/pages/api/uploads/index';
import { POST as creative } from '../src/pages/api/uploads/[id]/creative';
import { prepareTestDb, restoreEnv, stubEnv } from './helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08]);
type UploadContext = Parameters<typeof upload>[0];

function uploadRequest() {
  const form = new FormData();
  form.set('image', new File([JPEG], 'photo.jpg', { type: 'image/jpeg' }));
  form.set('cf-turnstile-response', 'turnstile-token');
  return {
    request: new Request('https://example.com/api/uploads', {
      method: 'POST',
      body: form,
      headers: { 'cf-connecting-ip': '198.51.100.20' },
    }),
  } as unknown as UploadContext;
}

async function count(table: string, column = 'COUNT(*)'): Promise<number> {
  const row = await env.DB.prepare(`SELECT ${column} AS value FROM ${table}`).first<{
    value: number | null;
  }>();
  return row?.value ?? 0;
}

beforeEach(async () => {
  await prepareTestDb(env.DB);
  stubEnv({
    PUBLIC_UPLOADS_ENABLED: 'true',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET: 'turnstile-secret',
    START_WORKFLOW_ON_UPLOAD: 'false',
    UPLOAD_THROTTLE: { limit: async () => ({ success: true }) },
    IMAGES: { info: async () => ({ format: 'image/jpeg', width: 1200, height: 800 }) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true, action: 'upload', hostname: 'example.com' })),
  );
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('upload and creative routes', () => {
  it('stay closed while uploads are paused or Turnstile is not configured', async () => {
    const creativeContext = {
      request: new Request('https://example.com/api/uploads/x/creative', { method: 'POST' }),
      params: { id: crypto.randomUUID() },
    } as unknown as Parameters<typeof creative>[0];
    stubEnv({ PUBLIC_UPLOADS_ENABLED: 'false' });
    expect((await upload(uploadRequest())).status).toBe(503);
    expect((await creative(creativeContext)).status).toBe(503);
    stubEnv({ PUBLIC_UPLOADS_ENABLED: 'true', TURNSTILE_SECRET: '' });
    expect((await upload(uploadRequest())).status).toBe(503);
    expect((await creative(creativeContext)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('spends no quota on an image that cannot be decoded', async () => {
    stubEnv({
      IMAGES: {
        info: async () => {
          throw new Error('9412: not an image');
        },
      },
    });
    const response = await upload(uploadRequest());
    expect(response.status).toBe(415);
    expect(await count('usage_counters')).toBe(0);
    expect(await count('client_usage')).toBe(0);
    expect(await count('uploads')).toBe(0);
  });

  it('refunds both allowances and leaves no row when the R2 write fails', async () => {
    const remove = vi.fn(async () => {});
    stubEnv({
      MEDIA: {
        put: async () => {
          throw new Error('R2 unavailable');
        },
        delete: remove,
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await upload(uploadRequest());
    expect(response.status).toBe(503);
    expect(await count('uploads')).toBe(0);
    expect(await count('usage_counters', 'SUM(day_count)')).toBe(0);
    expect(await count('client_usage', 'SUM(count)')).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('stores the original and starts the Workflow with bounded retention', async () => {
    const create = vi.fn(async () => ({}));
    stubEnv({ START_WORKFLOW_ON_UPLOAD: 'true', PROCESS_IMAGE: { create } });
    const response = await upload(uploadRequest());
    expect(response.status).toBe(202);
    const body: { id: string; capability: string } = await response.json();
    expect(body.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await env.MEDIA.head(originalKey(body.id))).not.toBeNull();
    const row = await env.DB.prepare('SELECT status, capability_hash FROM uploads WHERE id = ?')
      .bind(body.id)
      .first<{ status: string; capability_hash: string }>();
    expect(row?.status).toBe('queued');
    expect(row?.capability_hash).not.toBe(body.capability);
    expect(create).toHaveBeenCalledWith({
      id: `edit-${body.id}`,
      params: { id: body.id, kind: 'editorial' },
      retention: { successRetention: '1 day', errorRetention: '1 day' },
    });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(init?.body)).toContain('remoteip=198.51.100.20');
  });
});

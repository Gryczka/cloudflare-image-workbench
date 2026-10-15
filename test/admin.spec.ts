import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { galleryKey } from '../src/lib/media';
import { DELETE as takedown } from '../src/pages/api/admin/gallery/[id]';
import { GET as preview } from '../src/pages/api/admin/review/[id]/preview';
import { GET as pending } from '../src/pages/api/admin/review/index';
import { prepareTestDb, restoreEnv, stubEnv } from './helpers';

const TOKEN = '0123456789abcdef'.repeat(4);
const id = '00000000-0000-4000-8000-000000000001';
const limit = vi.fn(async () => ({ success: true }));

type Context = Parameters<typeof preview>[0];
const context = (path: string, authorization?: string, method = 'GET') =>
  ({
    request: new Request(`https://example.com${path}`, {
      method,
      headers: authorization ? { authorization } : {},
    }),
    params: { id },
  }) as unknown as Context;
const previewAs = (authorization?: string) =>
  preview(context(`/api/admin/review/${id}/preview`, authorization));

beforeEach(async () => {
  await prepareTestDb(env.DB);
  limit.mockClear();
  limit.mockResolvedValue({ success: true });
  stubEnv({ ADMIN_REVIEW_TOKEN: TOKEN, UPLOAD_THROTTLE: { limit } });
});
afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('operator authentication', () => {
  it('rejects missing, malformed, and wrong tokens identically', async () => {
    const headers = [
      undefined,
      `Basic ${TOKEN}`,
      'Bearer too-short',
      `Bearer ${TOKEN}=`,
      `Bearer ${'f'.repeat(64)}`,
    ];
    for (const header of headers) {
      const response = await previewAs(header);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Unauthorized.' });
    }
    expect(limit).toHaveBeenCalledTimes(headers.length);
    expect(limit).toHaveBeenCalledWith({ key: 'admin:unknown' });
  });

  it('fails closed when the secret is unset or cannot match a bearer token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubEnv({ ADMIN_REVIEW_TOKEN: undefined });
    expect((await previewAs(`Bearer ${TOKEN}`)).status).toBe(401);
    stubEnv({ ADMIN_REVIEW_TOKEN: `${'c'.repeat(43)}=` });
    expect((await previewAs(`Bearer ${'c'.repeat(43)}`)).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('admin_token_misconfigured'));
  });

  it('accepts the operator token without spending the failure allowance', async () => {
    expect((await previewAs(`Bearer ${TOKEN}`)).status).toBe(404);
    const list = await pending(context('/api/admin/review', `Bearer ${TOKEN}`));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ pending: [] });
    expect(limit).not.toHaveBeenCalled();
  });

  it('answers repeated failures from one network with 429', async () => {
    limit.mockResolvedValue({ success: false });
    const response = await previewAs(`Bearer ${'f'.repeat(64)}`);
    expect(response.status).toBe(429);
  });

  it('never withdraws a gallery item for an unauthenticated request', async () => {
    await env.DB.prepare(
      `INSERT INTO gallery (id, upload_id, title, caption, alt_text, credit, approved_at, published)
       VALUES (?, ?, 'Title', 'Caption.', 'Alt.', 'Credit', ?, 1)`,
    )
      .bind(id, id, Date.now())
      .run();
    await env.MEDIA.put(galleryKey(id, 'preview'), 'public');
    const response = await takedown(
      context(`/api/admin/gallery/${id}`, `Bearer ${'f'.repeat(64)}`, 'DELETE'),
    );
    expect(response.status).toBe(401);
    const row = await env.DB.prepare('SELECT published FROM gallery WHERE id = ?')
      .bind(id)
      .first<{ published: number }>();
    expect(row?.published).toBe(1);
    expect(await env.MEDIA.head(galleryKey(id, 'preview'))).not.toBeNull();
  });
});

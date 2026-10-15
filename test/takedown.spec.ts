import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { galleryKey, privateKey } from '../src/lib/media';
import { takeDownGallery } from '../src/lib/takedown';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

async function example(id: string) {
  await env.DB.prepare(
    `INSERT INTO gallery
    (id, upload_id, title, caption, alt_text, credit, approved_at, published)
    VALUES (?, ?, 'Title', 'Caption', 'Alt', 'Credit', ?, 1)`,
  )
    .bind(id, crypto.randomUUID(), Date.now())
    .run();
  await env.MEDIA.put(galleryKey(id, 'preview'), 'public');
  await env.MEDIA.put(privateKey(id, 'preview'), 'private');
}

describe('gallery withdrawal', () => {
  it('tombstones, deletes only public bytes, and checks the cache purge result', async () => {
    const id = crypto.randomUUID();
    await example(id);
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    await takeDownGallery(env, id, { purge });
    expect(purge).toHaveBeenCalledWith({ tags: [`gallery-${id}`, 'gallery-list'] });
    expect(await env.MEDIA.head(galleryKey(id, 'preview'))).toBeNull();
    expect(await env.MEDIA.head(privateKey(id, 'preview'))).not.toBeNull();
    expect(
      await env.DB.prepare('SELECT published FROM gallery WHERE id = ?').bind(id).first(),
    ).toEqual({ published: 0 });
    await takeDownGallery(env, id, { purge });
    expect(purge).toHaveBeenCalledTimes(2);
  });
  it('does not claim success when purge is rejected; a retry can finish it', async () => {
    const id = crypto.randomUUID();
    await example(id);
    const purge = vi.fn(async () => ({ success: false, errors: [] }));
    await expect(takeDownGallery(env, id, { purge })).rejects.toMatchObject({ status: 503 });
    expect(
      await env.DB.prepare('SELECT published FROM gallery WHERE id = ?').bind(id).first(),
    ).toEqual({ published: 0 });
    purge.mockResolvedValue({ success: true, errors: [] });
    await takeDownGallery(env, id, { purge });
  });
  it('rejects unknown IDs without touching cache', async () => {
    const purge = vi.fn(async () => ({ success: true, errors: [] }));
    await expect(takeDownGallery(env, '../private', { purge })).rejects.toMatchObject({
      status: 404,
    });
    await expect(takeDownGallery(env, crypto.randomUUID(), { purge })).rejects.toMatchObject({
      status: 404,
    });
    expect(purge).not.toHaveBeenCalled();
  });
});

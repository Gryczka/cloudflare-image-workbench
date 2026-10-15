import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { galleryKey, privateKey } from '../src/lib/media';
import { issueCapability } from '../src/lib/security';
import { createUploadRecord } from '../src/lib/uploads';
import { GET as galleryAsset } from '../src/pages/api/gallery/assets/[id]/[asset]';
import { GET as privateAsset } from '../src/pages/api/uploads/[id]/assets/[asset]';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

type PrivateContext = Parameters<typeof privateAsset>[0];
type GalleryContext = Parameters<typeof galleryAsset>[0];

async function privateUpload(status: string, outputs: string[], expiresAt?: number) {
  const id = crypto.randomUUID();
  const { token, hash } = await issueCapability();
  await createUploadRecord(env.DB, {
    id,
    hash,
    mime: 'image/jpeg',
    width: 1200,
    height: 800,
    now: Date.now(),
  });
  await env.DB.prepare('UPDATE uploads SET status = ?, outputs_json = ? WHERE id = ?')
    .bind(status, JSON.stringify(outputs), id)
    .run();
  if (expiresAt !== undefined) {
    await env.DB.prepare('UPDATE uploads SET expires_at = ? WHERE id = ?')
      .bind(expiresAt, id)
      .run();
  }
  // Every object exists, so a 404 proves the access policy rather than a missing file.
  for (const asset of [
    'original',
    'creative-raw',
    'creative-reference',
    'creative',
    'preview',
    'feature-center',
    'feature-ai',
  ]) {
    await env.MEDIA.put(privateKey(id, asset), 'bytes');
  }
  const get = (asset: string, capability = token) =>
    privateAsset({
      request: new Request(`https://example.com/api/uploads/${id}/assets/${asset}`, {
        headers: { authorization: `Bearer ${capability}` },
      }),
      params: { id, asset },
    } as unknown as PrivateContext);
  return { id, get };
}

async function galleryItem(published: number, outputs: string[], hasCreative: number) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO gallery
     (id, upload_id, title, caption, alt_text, credit, approved_at, outputs_json, has_creative, published)
     VALUES (?, ?, 'Title', 'Caption.', 'Alt.', 'Credit', ?, ?, ?, ?)`,
  )
    .bind(id, crypto.randomUUID(), Date.now(), JSON.stringify(outputs), hasCreative, published)
    .run();
  for (const asset of ['preview', 'creative', 'feature-center', 'feature-ai']) {
    await env.MEDIA.put(galleryKey(id, asset), 'bytes');
  }
  return (asset: string, itemId: string = id) =>
    galleryAsset({ params: { id: itemId, asset } } as unknown as GalleryContext);
}

describe('private asset access', () => {
  it('never serves originals, temporary creative files, or unlisted crops', async () => {
    const { get } = await privateUpload('ready', ['feature-center']);
    for (const asset of [
      'original',
      'creative-raw',
      'creative-reference',
      'creative',
      'feature-ai',
    ]) {
      expect((await get(asset)).status, asset).toBe(404);
    }
    const preview = await get('preview');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    expect((await get('feature-center')).status).toBe(200);
  });

  it('withholds a queued preview and every asset behind a wrong or expired capability', async () => {
    const queued = await privateUpload('queued', []);
    expect((await queued.get('preview')).status).toBe(404);

    const ready = await privateUpload('ready', ['feature-center']);
    expect((await ready.get('preview', 'A'.repeat(43))).status).toBe(404);

    const expired = await privateUpload('ready', ['feature-center'], Date.now() - 1);
    expect((await expired.get('preview')).status).toBe(404);
  });
});

describe('gallery asset access', () => {
  it('serves only published, listed assets with purgeable caching', async () => {
    const get = await galleryItem(1, ['feature-center'], 0);
    const preview = await get('preview');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    expect(preview.headers.get('cache-tag')).toMatch(/^gallery-[0-9a-f-]{36}$/);
    expect((await get('feature-ai')).status).toBe(404);
    expect((await get('creative')).status).toBe(404);
    expect((await get('preview', 'not-a-uuid')).status).toBe(404);
  });

  it('hides unpublished items and labels published synthetic images', async () => {
    const hidden = await galleryItem(0, ['feature-center'], 1);
    expect((await hidden('preview')).status).toBe(404);
    const synthetic = await galleryItem(1, [], 1);
    const response = await synthetic('creative');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-image-provenance')).toBe('synthetic');
  });
});

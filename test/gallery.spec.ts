import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveGallery, galleryView } from '../src/lib/gallery';
import { galleryKey, privateKey } from '../src/lib/media';
import { createUploadRecord } from '../src/lib/uploads';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));
afterEach(() => vi.restoreAllMocks());

describe('operator-reviewed gallery', () => {
  it('rejects a ready upload without explicit publication consent', async () => {
    const id = crypto.randomUUID();
    await createUploadRecord(env.DB, {
      id,
      hash: 'hash',
      mime: 'image/jpeg',
      width: 100,
      height: 100,
      now: Date.now(),
    });
    await env.DB.prepare("UPDATE uploads SET status = 'ready' WHERE id = ?").bind(id).run();
    await expect(
      approveGallery(env, {
        id,
        title: 'Title',
        credit: 'Credit',
        caption: 'Caption',
        altText: 'Alt',
        includeCreative: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('publishes only a sanitized preview and available crop after credit is supplied', async () => {
    const id = crypto.randomUUID();
    await createUploadRecord(env.DB, {
      id,
      hash: 'test-hash',
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      now: Date.now(),
      consentAt: Date.now(),
      consentCredit: 'Photo: contributor, used with permission',
    });
    await env.DB.prepare(
      `UPDATE uploads SET status = 'partial', outputs_json = ?, caption = ?, alt_text = ? WHERE id = ?`,
    )
      .bind('["feature-center"]', 'An outdoor scene.', 'A wooded scene.', id)
      .run();
    await env.MEDIA.put(privateKey(id, 'preview'), new Uint8Array([5, 5]));
    await env.MEDIA.put(privateKey(id, 'feature-center'), new Uint8Array([8, 8]));

    await expect(
      approveGallery(env, { id, title: 'Woodland', credit: '', includeCreative: false }),
    ).rejects.toMatchObject({ status: 400 });

    const published = await approveGallery(env, {
      id,
      title: 'Woodland',
      credit: 'Photo: contributor, used with permission',
      caption: 'An outdoor scene.',
      altText: 'A wooded scene.',
      includeCreative: false,
    });
    expect(galleryView(published).creative).toBeNull();
    expect(published.id).not.toBe(id);
    expect((await env.MEDIA.get(galleryKey(published.id, 'preview')))?.size).toBe(2);
    expect((await env.MEDIA.get(galleryKey(published.id, 'feature-center')))?.size).toBe(2);
    expect(await env.MEDIA.get(galleryKey(published.id, 'original'))).toBeNull();
    expect(
      await env.DB.prepare('SELECT published FROM gallery WHERE id = ?').bind(published.id).first(),
    ).toEqual({ published: 1 });
  });

  it.each(['preview', 'feature-center'] as const)(
    'rolls back a review when the sanitized %s asset is missing',
    async (missing) => {
      const id = crypto.randomUUID();
      await createUploadRecord(env.DB, {
        id,
        hash: 'test-hash',
        mime: 'image/jpeg',
        width: 1200,
        height: 800,
        now: Date.now(),
        consentAt: Date.now(),
        consentCredit: 'Photo: contributor, used with permission',
      });
      await env.DB.prepare(
        `UPDATE uploads SET status = 'partial', outputs_json = ?, caption = ?, alt_text = ? WHERE id = ?`,
      )
        .bind('["feature-center"]', 'An outdoor scene.', 'A wooded scene.', id)
        .run();
      if (missing !== 'preview') {
        await env.MEDIA.put(privateKey(id, 'preview'), new Uint8Array([5, 5]));
      }

      const deleteObjects = env.MEDIA.delete.bind(env.MEDIA);
      vi.spyOn(env.MEDIA, 'delete').mockImplementation(async (keys) => {
        // Remote R2 rejects an empty batch, even if the local emulator accepts one.
        if (Array.isArray(keys) && keys.length === 0) {
          throw new Error(
            'The number of keys in the request must be between 1 and 1000 inclusive.',
          );
        }
        await deleteObjects(keys);
      });

      await expect(
        approveGallery(env, {
          id,
          title: 'Woodland',
          credit: 'Photo: contributor, used with permission',
          caption: 'An outdoor scene.',
          altText: 'A wooded scene.',
          includeCreative: false,
        }),
      ).rejects.toMatchObject({ message: `Missing sanitized asset: ${missing}`, status: 409 });
      expect(
        await env.DB.prepare('SELECT id FROM gallery WHERE upload_id = ?').bind(id).first(),
      ).toBeNull();
      expect(await env.MEDIA.get(galleryKey(id, 'preview'))).toBeNull();
      if (missing !== 'preview') {
        expect((await env.MEDIA.get(privateKey(id, 'preview')))?.size).toBe(2);
      }
    },
  );
});

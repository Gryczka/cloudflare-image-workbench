import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { galleryView, approveGallery } from '../src/lib/gallery';
import { privateKey, type StoredAsset } from '../src/lib/media';
import { createUploadRecord, uploadView, type UploadRow } from '../src/lib/uploads';
import { GET as galleryAsset } from '../src/pages/api/gallery/assets/[id]/[asset]';
import {
  creativeProvenance,
  derivative,
  editorialProvenance,
  publicProvenance,
  snapshot,
} from '../src/showcases/provenance';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

const stored = (id: string, asset: string): StoredAsset => ({
  sourceKey: `uploads/${id}/original`,
  objectKey: privateKey(id, asset),
  sourceBytes: 42_000,
  outputBytes: 12_000,
  transformMs: 37,
  storedAt: '2026-10-01T11:00:00.000Z',
});

describe('generation records and historical honesty', () => {
  it('preserves exact parameters, model attribution, and source identity only for an authorized run', async () => {
    const id = crypto.randomUUID();
    const hash = 'aaa000bbb111ccc222';
    await createUploadRecord(env.DB, {
      id,
      hash: 'capability-hash',
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      now: Date.now(),
      sourceHash: hash,
      sourceBytes: 42_000,
      consentAt: Date.now(),
      consentCredit: 'With permission',
    });
    const row = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?')
      .bind(id)
      .first<UploadRow>();
    expect(row).not.toBeNull();
    const transform: ImageTransform = { width: 960, height: 540, fit: 'cover', gravity: 'center' };
    const preview = derivative(
      'preview',
      { width: 1024, fit: 'scale-down' },
      stored(id, 'preview'),
    );
    const crop = derivative('feature-center', transform, stored(id, 'feature-center'));
    const [pipeline, editorialAi] = await Promise.all([
      snapshot('pipeline'),
      snapshot('editorial-ai'),
    ]);
    const record = editorialProvenance(
      row!,
      preview,
      [crop],
      {
        caption: 'A real caption.',
        altText: 'A scene.',
        subject: 'scene',
        focal: { x: 0.62, y: 0.31 },
        focalSource: 'llama4-estimate',
        writingModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
        focalModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
        note: 'An estimate.',
      },
      [],
      { pipeline, 'editorial-ai': editorialAi },
    );
    expect(record.crops[0]).toMatchObject({
      transform,
      outputBytes: 12_000,
      transformMs: 37,
      objectKey: `private/${id}/feature-center.webp`,
    });
    expect(record.analysis.focalModel).toContain('llama-4-scout');
    expect(
      record.snapshots.pipeline.code.some(({ source }) => source.includes('transformAndStore(')),
    ).toBe(true);

    const publicRecord = publicProvenance(id, record, null);
    const disclosed = JSON.stringify(publicRecord);
    expect(publicRecord.editorial?.source).toMatchObject({
      bytes: null,
      objectKey: null,
      sha256: null,
    });
    expect(publicRecord.editorial?.crops[0]).toMatchObject({
      objectKey: `gallery/${id}/feature-center.webp`,
      sourceKey: null,
      sourceBytes: null,
      storedAt: '2026-10-01',
      outputBytes: 12_000,
    });
    expect(publicRecord.editorial?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(publicRecord.editorial?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(disclosed).not.toContain('42000');
    expect(disclosed).not.toContain('T11:00:00');
    expect(disclosed).not.toContain(hash);
    expect(disclosed).not.toContain(`private/${id}`);
    expect(disclosed).not.toContain(`uploads/${id}`);
    expect(disclosed).not.toContain('capability-hash');

    await env.DB.prepare(
      `UPDATE uploads SET status = 'ready', outputs_json = ?, caption = ?, alt_text = ?, editorial_provenance_json = ? WHERE id = ?`,
    )
      .bind('["feature-center"]', 'A real caption.', 'A scene.', JSON.stringify(record), id)
      .run();
    await env.MEDIA.put(privateKey(id, 'preview'), new Uint8Array([1]));
    await env.MEDIA.put(privateKey(id, 'feature-center'), new Uint8Array([2]));
    const loaded = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?')
      .bind(id)
      .first<UploadRow>();
    expect(uploadView(loaded!).analysisModel).toContain('llama-4-scout');
    const published = await approveGallery(env, {
      id,
      title: 'Scene',
      credit: 'With permission',
      caption: 'A real caption.',
      altText: 'A scene.',
      includeCreative: false,
    });
    const approved = galleryView(published).provenance;
    expect(approved?.editorial?.snapshots.pipeline.version).toBe(record.snapshots.pipeline.version);
    expect(approved?.editorial?.source.objectKey).toBeNull();
    expect(approved?.editorial?.crops[0].objectKey).toBe(
      `gallery/${published.id}/feature-center.webp`,
    );
    expect(JSON.stringify(approved)).not.toContain(hash);
  });

  it('keeps old gallery examples unattributed when there was no generation snapshot', async () => {
    const id = crypto.randomUUID();
    await createUploadRecord(env.DB, {
      id,
      hash: 'hash',
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      now: Date.now(),
      consentAt: Date.now(),
      consentCredit: 'With permission',
    });
    await env.DB.prepare(
      "UPDATE uploads SET status = 'partial', creative_status = 'ready', outputs_json = '[\"feature-center\"]', caption = 'Scene', alt_text = 'A scene' WHERE id = ?",
    )
      .bind(id)
      .run();
    await env.MEDIA.put(privateKey(id, 'preview'), new Uint8Array([1]));
    await env.MEDIA.put(privateKey(id, 'feature-center'), new Uint8Array([2]));
    await env.MEDIA.put(privateKey(id, 'creative'), new Uint8Array([3]));
    const published = await approveGallery(env, {
      id,
      title: 'Scene',
      credit: 'With permission',
      caption: 'Scene',
      altText: 'A scene',
      includeCreative: true,
    });
    expect(galleryView(published).provenance).toBeNull();
    const params: Parameters<typeof galleryAsset>[0]['params'] = {
      id: published.id,
      asset: 'creative',
    };
    const creative = await galleryAsset({ params } as Parameters<typeof galleryAsset>[0]);
    expect(creative.status).toBe(200);
    expect(creative.headers.get('x-image-provenance')).toBe('synthetic');
    const row = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?')
      .bind(id)
      .first<UploadRow>();
    expect(uploadView(row!).analysisModel).toBe('Historical model attribution unavailable');
  });

  it('records creative inference separately from image encoding and withholds temporary R2 keys', async () => {
    const id = crypto.randomUUID();
    const row = {
      id,
      original_key: `uploads/${id}/original`,
      original_sha256: 'private-source-hash',
      original_bytes: 42_000,
      mime_type: 'image/jpeg',
      width: 1200,
      height: 800,
    } as UploadRow;
    const record = creativeProvenance(
      row,
      {
        model: '@cf/black-forest-labs/flux-2-klein-4b',
        style: 'poster',
        prompt: 'An illustrated poster.',
        generation: { width: 768, height: 768, seed: 1234 },
        reference: stored(id, 'creative-reference'),
        referenceTransform: { width: 480, height: 480, fit: 'scale-down' },
        output: { ...stored(id, 'creative'), sourceKey: privateKey(id, 'creative-raw') },
        outputTransform: { width: 960, height: 960, fit: 'scale-down' },
        inferenceMs: 250,
        generationMs: 290,
      },
      await snapshot('synthetic'),
    );
    expect(record.model).toContain('flux-2');
    expect(record.reference.transform).toMatchObject({ width: 480 });
    expect(record.output.transform).toMatchObject({ width: 960, height: 960 });
    expect(record.generation).toEqual({ width: 768, height: 768, seed: 1234 });
    expect(record.inferenceMs).toBe(250);
    const sanitized = publicProvenance(id, null, record).creative!;
    expect(sanitized.reference.objectKey).toContain('deleted');
    expect(sanitized.output.objectKey).toBe(`gallery/${id}/creative.webp`);
    expect(JSON.stringify(sanitized)).not.toContain(`private/${id}`);
    expect(JSON.stringify(sanitized)).not.toContain('private-source-hash');
  });
});

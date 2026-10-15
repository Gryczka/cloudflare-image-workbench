import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeExpiredData } from '../src/lib/retention';
import { reserveQuota } from '../src/lib/quota';
import { createUploadRecord } from '../src/lib/uploads';
import { prepareTestDb } from './helpers';
import { galleryKey, originalKey, privateKey } from '../src/lib/media';

beforeEach(() => prepareTestDb(env.DB));
afterEach(() => vi.restoreAllMocks());

describe('retention cleanup', () => {
  it('removes expired private metadata and old counters without deleting an approved example', async () => {
    const now = Date.parse('2026-09-24T12:00:00Z');
    const expired = crypto.randomUUID();
    const active = crypto.randomUUID();
    for (const [id, createdAt] of [
      [expired, now - 2 * 86_400_000],
      [active, now],
    ] as const) {
      await createUploadRecord(env.DB, {
        id,
        hash: `hash-${id}`,
        mime: 'image/jpeg',
        width: 1280,
        height: 853,
        now: createdAt,
      });
    }
    await env.DB.prepare(
      `INSERT INTO gallery
       (id,upload_id,title,caption,alt_text,credit,approved_at,published)
       VALUES (?,?,?,?,?,?,?,1)`,
    )
      .bind(expired, expired, 'Colmar', 'A street.', 'A street.', 'DimiTalen', now - 2_000)
      .run();
    await reserveQuota(env.DB, 'upload', new Date('2026-08-24T12:00:00Z'), {
      day: 8,
      month: 120,
    });
    await reserveQuota(env.DB, 'upload', new Date(now), { day: 8, month: 120 });

    await env.MEDIA.put(originalKey(expired), 'original');
    await env.MEDIA.put(privateKey(expired, 'creative-raw'), 'temporary');
    await env.MEDIA.put(privateKey(active, 'preview'), 'active');
    await env.MEDIA.put(galleryKey(expired, 'preview'), 'public');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO client_salts (day, salt) VALUES ('2026-09-23', 'old'), ('2026-09-24', 'today')`,
      ),
      env.DB.prepare(
        `INSERT INTO client_usage (kind, client, day, count)
         VALUES ('upload', 'old-hash', '2026-09-23', 3), ('upload', 'today-hash', '2026-09-24', 1)`,
      ),
    ]);
    expect(await purgeExpiredData(env, now)).toEqual({
      expiredUploads: 1,
      oldCounters: 1,
      oldClientRows: 2,
    });
    expect((await env.DB.prepare('SELECT day FROM client_salts').all()).results).toEqual([
      { day: '2026-09-24' },
    ]);
    expect(await env.MEDIA.head(originalKey(expired))).toBeNull();
    expect(await env.MEDIA.head(privateKey(expired, 'creative-raw'))).toBeNull();
    expect(await env.MEDIA.head(privateKey(active, 'preview'))).not.toBeNull();
    expect(await env.MEDIA.head(galleryKey(expired, 'preview'))).not.toBeNull();
    expect(
      await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(expired).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(active).first(),
    ).toEqual({ id: active });
    expect(
      await env.DB.prepare('SELECT id FROM gallery WHERE id = ?').bind(expired).first(),
    ).toEqual({ id: expired });
    expect((await env.DB.prepare('SELECT month FROM usage_counters').all()).results).toEqual([
      { month: '2026-09' },
    ]);
  });
  it('keeps the metadata discoverable if R2 deletion fails', async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await createUploadRecord(env.DB, {
      id,
      hash: 'hash',
      mime: 'image/jpeg',
      width: 100,
      height: 100,
      now: now - 2 * 86_400_000,
    });
    await env.MEDIA.put(originalKey(id), 'private');
    vi.spyOn(env.MEDIA, 'delete').mockRejectedValue(new Error('offline'));
    await expect(purgeExpiredData(env, now)).rejects.toThrow('offline');
    expect(await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(id).first()).toEqual({
      id,
    });
  });
});

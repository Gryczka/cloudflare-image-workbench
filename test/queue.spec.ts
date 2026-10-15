import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeUploadEvents, uploadNotification } from '../src/lib/queue';
import { originalKey } from '../src/lib/media';
import { createUploadRecord } from '../src/lib/uploads';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

function notification(key: string, eTag: string) {
  return {
    action: 'PutObject',
    bucket: 'image-workbench-media',
    object: { key, size: 4, eTag },
  };
}

describe('R2 notification handling', () => {
  it('ignores output writes, unrelated buckets and stale objects', () => {
    const id = crypto.randomUUID();
    expect(
      uploadNotification(notification(`private/${id}/preview.webp`, 'a'), 'image-workbench-media'),
    ).toBeNull();
    expect(
      uploadNotification(notification(originalKey(id), 'a'), 'someone-elses-bucket'),
    ).toBeNull();
  });

  it('creates only one deterministic Workflow on duplicate object-create deliveries', async () => {
    const id = crypto.randomUUID();
    const key = originalKey(id);
    await createUploadRecord(env.DB, {
      id,
      hash: 'test-hash',
      mime: 'image/png',
      width: 100,
      height: 100,
      now: Date.now(),
    });
    const saved = await env.MEDIA.put(key, new Uint8Array([1, 2, 3, 4]));
    if (!saved) throw new Error('R2 did not store the test image.');
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: `edit-${id}` })
      .mockRejectedValueOnce(new Error('Already exists'));
    const get = vi.fn().mockResolvedValue({ id: `edit-${id}` });
    const ack = vi.fn();
    const retry = vi.fn();
    const batch = {
      messages: [
        { body: notification(key, saved.etag), ack, retry },
        { body: notification(key, saved.etag), ack, retry },
        { body: notification(key, 'stale-etag'), ack, retry },
      ],
    } as unknown as MessageBatch<unknown>;
    await consumeUploadEvents(batch, {
      DB: env.DB,
      MEDIA: env.MEDIA,
      PROCESS_IMAGE: { create, get } as unknown as Workflow,
      MEDIA_BUCKET_NAME: 'image-workbench-media',
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      id: `edit-${id}`,
      params: { id, kind: 'editorial' },
      retention: { successRetention: '1 day', errorRetention: '1 day' },
    });
    expect(get).toHaveBeenCalledWith(`edit-${id}`);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(retry).not.toHaveBeenCalled();
  });
});

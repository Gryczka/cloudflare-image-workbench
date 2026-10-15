/** Validates R2 upload notifications and starts one editorial Workflow per upload. */
import { MAX_UPLOAD_BYTES } from './media';

interface R2ObjectCreated {
  action: 'PutObject';
  bucket: string;
  object: { key: string; size: number; eTag: string };
}

/** Accept only a PutObject on this bucket's exact `uploads/<id>/original` key, within size. */
export function uploadNotification(
  body: unknown,
  bucketName: string,
): { id: string; event: R2ObjectCreated } | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Partial<R2ObjectCreated>;
  if (data.action !== 'PutObject' || data.bucket !== bucketName) return null;
  const object = data.object;
  if (
    !object ||
    typeof object.key !== 'string' ||
    typeof object.eTag !== 'string' ||
    !Number.isInteger(object.size) ||
    object.size < 1 ||
    object.size > MAX_UPLOAD_BYTES
  ) {
    return null;
  }
  const id = /^uploads\/([0-9a-f]{8}-[0-9a-f-]{27,36})\/original$/.exec(object.key)?.[1];
  return id ? { id, event: data as R2ObjectCreated } : null;
}

// showcase:start consumer
export async function consumeUploadEvents(
  batch: MessageBatch<unknown>,
  env: Pick<Env, 'DB' | 'MEDIA' | 'PROCESS_IMAGE' | 'MEDIA_BUCKET_NAME'>,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = uploadNotification(message.body, env.MEDIA_BUCKET_NAME);
    if (!parsed) {
      message.ack();
      continue;
    }

    try {
      const { id, event } = parsed;
      const record = await env.DB.prepare(
        'SELECT original_key, status FROM uploads WHERE id = ? AND expires_at > ?',
      )
        .bind(id, Date.now())
        .first<{ original_key: string; status: string }>();

      if (!record || record.original_key !== event.object.key || record.status !== 'queued') {
        message.ack();
        continue;
      }

      const object = await env.MEDIA.head(event.object.key);
      if (!object || object.etag !== event.object.eTag.replaceAll('"', '')) {
        message.ack();
        continue;
      }

      const instanceId = `edit-${id}`;
      try {
        await env.PROCESS_IMAGE.create({
          id: instanceId,
          params: { id, kind: 'editorial' },
          retention: { successRetention: '1 day', errorRetention: '1 day' },
        });
      } catch {
        // The same event can be delivered more than once. Only acknowledge a
        // create failure when that deterministic instance actually exists.
        await env.PROCESS_IMAGE.get(instanceId);
      }
      message.ack();
    } catch (error) {
      console.error('Unable to start an image Workflow', error);
      message.retry();
    }
  }
}
// showcase:end consumer

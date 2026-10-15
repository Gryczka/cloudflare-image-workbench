import { ReviewError } from './gallery';

type Purger = Pick<CacheContext, 'purge'>;

/** Tombstone first; retain it so failed cleanup/purge can be safely retried. */
export async function takeDownGallery(
  env: Pick<Env, 'DB' | 'MEDIA'>,
  id: string,
  cache: Purger,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(id)) {
    throw new ReviewError('Image not found.', 404);
  }
  const row = await env.DB.prepare('UPDATE gallery SET published = 0 WHERE id = ? RETURNING id')
    .bind(id)
    .first();
  if (!row) throw new ReviewError('Image not found.', 404);

  // List by the exact server-generated prefix, including any older derivative names.
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list({ prefix: `gallery/${id}/`, cursor });
    if (page.objects.length) await env.MEDIA.delete(page.objects.map(({ key }) => key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const purged = await cache.purge({ tags: [`gallery-${id}`, 'gallery-list'] });
  if (!purged.success) {
    throw new ReviewError('Image unpublished; cache purge failed. Retry this takedown.', 503);
  }
}

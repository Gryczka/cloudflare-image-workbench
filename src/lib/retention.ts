/** Delete bytes before metadata; lifecycle rules remain an independent cleanup backstop. */
export async function purgeExpiredData(env: Pick<Env, 'DB' | 'MEDIA'>, now = Date.now()) {
  const { DB: db, MEDIA: media } = env;
  // About five R2/D1 calls per upload keeps a batch under the Free plan's internal-call limit.
  const { results } = await db
    .prepare('SELECT id FROM uploads WHERE expires_at <= ? ORDER BY expires_at LIMIT 100')
    .bind(now)
    .all<{ id: string }>();
  let expiredUploads = 0;
  for (const { id } of results) {
    // Retaining the D1 row on deletion failure makes the next Cron retry discoverable.
    for (const prefix of [`uploads/${id}/`, `private/${id}/`]) {
      let cursor: string | undefined;
      do {
        const page = await media.list({ prefix, cursor });
        if (page.objects.length) await media.delete(page.objects.map(({ key }) => key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    const removed = await db
      .prepare('DELETE FROM uploads WHERE id = ? AND expires_at <= ?')
      .bind(id, now)
      .run();
    expiredUploads += removed.meta.changes;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const [counters, clientUsage, clientSalts] = await db.batch([
    db.prepare('DELETE FROM usage_counters WHERE month < ?').bind(today.slice(0, 7)),
    // Deleting a day's salt makes that day's client hashes unlinkable.
    db.prepare('DELETE FROM client_usage WHERE day < ?').bind(today),
    db.prepare('DELETE FROM client_salts WHERE day < ?').bind(today),
  ]);
  return {
    expiredUploads,
    oldCounters: counters.meta.changes,
    oldClientRows: clientUsage.meta.changes + clientSalts.meta.changes,
  };
}

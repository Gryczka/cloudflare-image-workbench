/** Atomic D1 counters for the shared daily and monthly budgets and per-network daily allowances. */
export type QuotaKind = 'upload' | 'creative';

export interface QuotaLimits {
  day: number;
  month: number;
}

/** One SQLite upsert checks both caps before incrementing either counter. */
export async function reserveQuota(
  db: D1Database,
  kind: QuotaKind,
  now: Date,
  limits: QuotaLimits,
): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (kind, month, month_count, day, day_count)
       SELECT ?, ?, 1, ?, 1 WHERE ? >= 1 AND ? >= 1
       ON CONFLICT (kind, month) DO UPDATE SET
         month_count = usage_counters.month_count + 1,
         day = excluded.day,
         day_count = CASE WHEN usage_counters.day = excluded.day THEN usage_counters.day_count + 1 ELSE 1 END
       WHERE usage_counters.month_count < ?
         AND (CASE WHEN usage_counters.day = excluded.day THEN usage_counters.day_count ELSE 0 END) < ?
       RETURNING month_count`,
    )
    .bind(kind, month, day, limits.day, limits.month, limits.month, limits.day)
    .first();

  return row !== null;
}

/** A per-client daily allowance, so one visitor cannot spend the whole shared budget. */
export async function reserveClientQuota(
  db: D1Database,
  kind: QuotaKind,
  client: string,
  now: Date,
  limit: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO client_usage (kind, client, day, count)
       SELECT ?, ?, ?, 1 WHERE ? >= 1
       ON CONFLICT (kind, client, day) DO UPDATE SET count = client_usage.count + 1
       WHERE client_usage.count < ?
       RETURNING count`,
    )
    .bind(kind, client, now.toISOString().slice(0, 10), limit, limit)
    .first();
  return row !== null;
}

/** Refund one per-network reservation without going below zero. */
export async function releaseClientQuota(
  db: D1Database,
  kind: QuotaKind,
  client: string,
  now: Date,
): Promise<void> {
  await db
    .prepare(
      `UPDATE client_usage SET count = count - 1
       WHERE kind = ? AND client = ? AND day = ? AND count > 0`,
    )
    .bind(kind, client, now.toISOString().slice(0, 10))
    .run();
}

/** Compensate for an upload that never reached R2 or a creative job that never started. */
export async function releaseQuota(db: D1Database, kind: QuotaKind, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await db
    .prepare(
      `UPDATE usage_counters
       SET month_count = month_count - 1,
           day_count = CASE WHEN day = ? THEN MAX(day_count - 1, 0) ELSE day_count END
       WHERE kind = ? AND month = ? AND month_count > 0`,
    )
    .bind(day, kind, day.slice(0, 7))
    .run();
}

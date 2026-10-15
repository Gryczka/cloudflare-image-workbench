import { env } from 'cloudflare:workers';
import schema from '../migrations/0001_initial.sql?raw';
import provenanceSchema from '../migrations/0002_provenance.sql?raw';
import consentSchema from '../migrations/0003_gallery_consent.sql?raw';
import clientSchema from '../migrations/0004_client_allowance.sql?raw';

function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function prepareTestDb(db: D1Database): Promise<void> {
  await db.batch(statements(schema).map((statement) => db.prepare(statement)));
  const { results } = await db.prepare('PRAGMA table_info(uploads)').all<{ name: string }>();
  if (!results.some(({ name }) => name === 'editorial_provenance_json')) {
    await db.batch(statements(provenanceSchema).map((statement) => db.prepare(statement)));
  }
  await db.prepare('DELETE FROM gallery').run();
  if (!results.some(({ name }) => name === 'gallery_consent_at')) {
    await db.batch(statements(consentSchema).map((statement) => db.prepare(statement)));
  }
  await db.batch(statements(clientSchema).map((statement) => db.prepare(statement)));
  await db.prepare('DELETE FROM uploads').run();
  await db.prepare('DELETE FROM usage_counters').run();
  await db.prepare('DELETE FROM client_usage').run();
  await db.prepare('DELETE FROM client_salts').run();
}

const originalEnv = new Map<string, unknown>();

/** Routes read `env` from cloudflare:workers; override bindings and vars until restoreEnv(). */
export function stubEnv(values: Record<string, unknown>): void {
  const target = env as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (!originalEnv.has(key)) originalEnv.set(key, target[key]);
    target[key] = value;
  }
}

export function restoreEnv(): void {
  const target = env as unknown as Record<string, unknown>;
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  originalEnv.clear();
}

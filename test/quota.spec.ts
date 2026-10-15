import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { reserveAllowance, UPLOAD_CLIENT_DAILY_LIMIT } from '../src/lib/api';
import { clientKey, clientNetwork } from '../src/lib/clients';
import { reserveClientQuota, reserveQuota } from '../src/lib/quota';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

const from = (ip: string) =>
  new Request('https://example.test/api/uploads', { headers: { 'cf-connecting-ip': ip } });

describe('global demo quota', () => {
  it('limits daily use and renews the daily allowance without renewing the month', async () => {
    const limits = { day: 1, month: 2 };
    expect(await reserveQuota(env.DB, 'upload', new Date('2026-09-24T12:00:00Z'), limits)).toBe(
      true,
    );
    expect(await reserveQuota(env.DB, 'upload', new Date('2026-09-24T12:00:00Z'), limits)).toBe(
      false,
    );
    expect(await reserveQuota(env.DB, 'upload', new Date('2026-09-25T12:00:00Z'), limits)).toBe(
      true,
    );
    expect(await reserveQuota(env.DB, 'upload', new Date('2026-09-26T12:00:00Z'), limits)).toBe(
      false,
    );
  });

  it('does not admit more than the cap under concurrent attempts', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reserveQuota(env.DB, 'creative', new Date('2026-09-24T12:00:00Z'), {
          day: 2,
          month: 4,
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
  });
});

describe('per-client allowance', () => {
  it('collapses IPv6 to its /64 and leaves IPv4 unchanged', () => {
    expect(clientNetwork('203.0.113.9')).toBe('203.0.113.9');
    expect(clientNetwork('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64');
    expect(clientNetwork('2001:DB8:abcd:12:ffff:1:2:3')).toBe('2001:0db8:abcd:0012::/64');
    expect(clientNetwork('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(clientNetwork(null)).toBe('unknown');
  });

  it('hashes clients with a daily salt and never stores the address', async () => {
    const first = await clientKey(env.DB, from('2001:db8::1'), '2026-09-24');
    const sameNetwork = await clientKey(env.DB, from('2001:db8::2'), '2026-09-24');
    const nextDay = await clientKey(env.DB, from('2001:db8::1'), '2026-09-25');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(sameNetwork).toBe(first);
    expect(nextDay).not.toBe(first);
    expect(
      (await env.DB.prepare('SELECT day FROM client_salts ORDER BY day').all()).results,
    ).toEqual([{ day: '2026-09-24' }, { day: '2026-09-25' }]);
  });

  it('caps one client concurrently without blocking another client', async () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => reserveClientQuota(env.DB, 'upload', 'a', now, 2)),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await reserveClientQuota(env.DB, 'upload', 'b', now, 2)).toBe(true);
  });

  it('reserves both allowances together and releases both on failure', async () => {
    const now = new Date();
    const request = from('198.51.100.7');
    const reservations = [];
    for (let attempt = 0; attempt < UPLOAD_CLIENT_DAILY_LIMIT; attempt++) {
      reservations.push(await reserveAllowance(env.DB, request, 'upload', now));
    }
    expect(reservations.every((reservation) => typeof reservation === 'object')).toBe(true);
    expect(await reserveAllowance(env.DB, request, 'upload', now)).toBe('client-exhausted');

    const last = reservations.at(-1);
    if (typeof last !== 'object') throw new Error('Expected a reservation.');
    await last.release();
    expect(typeof (await reserveAllowance(env.DB, request, 'upload', now))).toBe('object');
    const counter = await env.DB.prepare(
      `SELECT day_count FROM usage_counters WHERE kind = 'upload'`,
    ).first<{ day_count: number }>();
    expect(counter?.day_count).toBe(UPLOAD_CLIENT_DAILY_LIMIT);
  });

  it('returns the client allowance when the shared budget is exhausted', async () => {
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO usage_counters (kind, month, month_count, day, day_count) VALUES ('creative', ?, 2, ?, 2)`,
    )
      .bind(now.toISOString().slice(0, 7), now.toISOString().slice(0, 10))
      .run();
    expect(await reserveAllowance(env.DB, from('198.51.100.8'), 'creative', now)).toBe(
      'budget-exhausted',
    );
    const usage = await env.DB.prepare(
      `SELECT count FROM client_usage WHERE kind = 'creative'`,
    ).first<{
      count: number;
    }>();
    expect(usage?.count).toBe(0);
  });
});

import { sha256 } from './security';

/** Collapse IPv6 to its /64 so rotating interface IDs share one allowance; IPv4 is used as-is. */
export function clientNetwork(address: string | null): string {
  const ip = address?.trim().toLowerCase() ?? '';
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];

  const compressed = ip.includes('::');
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = compressed && tail ? tail.split(':') : [];
  const groups = compressed
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return ip;
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}

/**
 * Per-client counters never store an address. The network is hashed with a random salt
 * that rotates daily and is deleted with old counters, so old hashes cannot be linked.
 */
export async function clientKey(db: D1Database, request: Request, day: string): Promise<string> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const row = await db
    .prepare(
      `INSERT INTO client_salts (day, salt) VALUES (?, ?)
       ON CONFLICT (day) DO UPDATE SET salt = client_salts.salt
       RETURNING salt`,
    )
    .bind(day, salt)
    .first<{ salt: string }>();
  if (!row) throw new Error('Client salt is unavailable.');
  return sha256(`${row.salt}:${clientNetwork(request.headers.get('cf-connecting-ip'))}`);
}

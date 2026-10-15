import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueCapability } from '../src/lib/security';
import { authorizedUpload, createUploadRecord } from '../src/lib/uploads';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

describe('private upload capabilities', () => {
  it('rejects missing, incorrect, and expired capabilities', async () => {
    const id = crypto.randomUUID();
    const { token, hash } = await issueCapability();
    const now = Date.now();
    await createUploadRecord(env.DB, {
      id,
      hash,
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      now,
    });

    const auth = (value: string) =>
      new Request('https://example.com/', { headers: { authorization: `Bearer ${value}` } });
    expect(await authorizedUpload(env.DB, auth(token), id, now)).toMatchObject({ id });
    expect(await authorizedUpload(env.DB, auth('A'.repeat(43)), id, now)).toBeNull();
    expect(await authorizedUpload(env.DB, new Request('https://example.com/'), id, now)).toBeNull();
    expect(await authorizedUpload(env.DB, auth(token), id, now + 86_400_000)).toBeNull();
  });
});

import { env, type WorkflowStep } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueCapability } from '../src/lib/security';
import { createUploadRecord } from '../src/lib/uploads';
import { ProcessImageWorkflow } from '../src/workflows/process-image';
import { prepareTestDb } from './helpers';

type Event = Parameters<ProcessImageWorkflow['run']>[0];
const GENERATE = 'generate distinct synthetic image';

beforeEach(() => prepareTestDb(env.DB));

/** Records each step; the Workflows engine, not this fake, would apply the retry config. */
function recordingStep(failing?: string) {
  const calls: { name: string; config: unknown }[] = [];
  const step = {
    async do(name: string, configOrCallback: unknown, callback?: () => Promise<unknown>) {
      const configured = typeof configOrCallback !== 'function';
      calls.push({ name, config: configured ? configOrCallback : undefined });
      if (name === failing) throw new Error(`${name} failed`);
      return ((configured ? callback : configOrCallback) as () => Promise<unknown>)();
    },
  } as unknown as WorkflowStep;
  return { step, calls };
}

/** run() only reads this.env; any AI or Images use in these cases fails the test. */
function workflow(): ProcessImageWorkflow {
  const forbidden = (name: string) =>
    new Proxy(
      {},
      {
        get() {
          throw new Error(`${name} must not be used`);
        },
      },
    );
  return Object.assign(Object.create(ProcessImageWorkflow.prototype), {
    env: { DB: env.DB, MEDIA: env.MEDIA, AI: forbidden('AI'), IMAGES: forbidden('IMAGES') },
  });
}

async function upload(fields: string): Promise<string> {
  const id = crypto.randomUUID();
  const { hash } = await issueCapability();
  await createUploadRecord(env.DB, {
    id,
    hash,
    mime: 'image/jpeg',
    width: 1200,
    height: 800,
    now: Date.now(),
  });
  await env.DB.prepare(`UPDATE uploads SET ${fields} WHERE id = ?`).bind(id).run();
  return id;
}

describe('image Workflow idempotency', () => {
  it('ignores a re-delivered editorial job after the upload was claimed', async () => {
    const id = await upload(`status = 'ready'`);
    const { step, calls } = recordingStep();
    await workflow().run({ payload: { id, kind: 'editorial' } } as Event, step);
    expect(calls.map(({ name }) => name)).toEqual(['claim editorial job']);
  });

  it('never retries billed generation, and a failed job is not claimed again', async () => {
    const id = await upload(
      `status = 'ready', creative_status = 'queued', creative_prompt = 'collage'`,
    );
    const job = { payload: { id, kind: 'creative', style: 'collage' } } as Event;
    const first = recordingStep(GENERATE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(workflow().run(job, first.step)).rejects.toThrow(`${GENERATE} failed`);

    const generation = first.calls.filter(({ name }) => name === GENERATE);
    expect(generation).toHaveLength(1);
    expect(generation[0].config).toMatchObject({ retries: { limit: 0 } });
    expect(first.calls.at(-1)?.name).toBe('mark creative failure');
    const row = await env.DB.prepare('SELECT creative_status FROM uploads WHERE id = ?')
      .bind(id)
      .first<{ creative_status: string }>();
    expect(row?.creative_status).toBe('failed');

    const again = recordingStep();
    await workflow().run(job, again.step);
    expect(again.calls.map(({ name }) => name)).toEqual(['claim creative job']);
  });
});

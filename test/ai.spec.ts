import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeImage, isImageCenter, normalizedPoint, parseEditorialAnswer } from '../src/lib/ai';

const LLAMA = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MOONDREAM = '@cf/moondream/moondream3.1-9B-A2B';

afterEach(() => vi.restoreAllMocks());

function analysisEnv(run: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  const output = vi.fn(async () => ({
    response: () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb])),
  }));
  const env = {
    AI: { run },
    MEDIA: { get: async () => new Response(new Uint8Array([82, 73, 70, 70])) },
    IMAGES: { input: vi.fn(() => ({ output })) },
  } as unknown as Parameters<typeof analyzeImage>[0];
  return { env, output };
}

function llamaDraft(focal: { x: number; y: number } | null) {
  return {
    response: `\`\`\`json\n${JSON.stringify({
      caption: 'Colorful buildings along a canal.',
      alt: 'Buildings beside a canal.',
      subject: 'colorful buildings',
      focal,
    })}\n\`\`\``,
  };
}

describe('AI result boundaries', () => {
  it('does not treat pixel coordinates or malformed values as normalized focal points', () => {
    expect(normalizedPoint({ x: 320, y: 175 })).toBeNull();
    expect(normalizedPoint({ x: -0.2, y: 0.4 })).toBeNull();
    expect(normalizedPoint({ x: 0.62, y: 0.18 })).toEqual({ x: 0.62, y: 0.18 });
    expect(isImageCenter({ x: 0.5, y: 0.51 })).toBe(true);
    expect(isImageCenter({ x: 0.62, y: 0.5 })).toBe(false);
  });

  it('extracts bounded editorial drafts without asserting unverified facts', () => {
    expect(
      parseEditorialAnswer('{"caption":" A dog in a field. ","alt":"A dog.","subject":"dog"}'),
    ).toEqual({
      caption: 'A dog in a field.',
      altText: 'A dog.',
      subject: 'dog',
    });
    expect(parseEditorialAnswer('A plain description.').subject).toBeNull();
  });

  it('sends the models a JPEG of the preview and uses a Moondream point when available', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async (_model: string, input: Record<string, unknown>) =>
      input.task === 'point'
        ? { points: [{ x: 0.31, y: 0.62 }] }
        : { answer: '{"caption":"A lantern on a street.","alt":"A lantern.","subject":"lantern"}' },
    );
    const { env, output } = analysisEnv(run);

    const result = await analyzeImage(env, 'sample');
    expect(output).toHaveBeenCalledWith({ format: 'image/jpeg', quality: 85 });
    expect(
      run.mock.calls.every(([, input]) =>
        String(input.image).startsWith('data:image/jpeg;base64,'),
      ),
    ).toBe(true);
    expect(run.mock.calls.map(([model]) => model)).not.toContain(LLAMA);
    expect(result).toMatchObject({
      focal: { x: 0.31, y: 0.62 },
      focalSource: 'moondream-point',
      writingModel: MOONDREAM,
      focalModel: MOONDREAM,
      note: null,
    });
    const logged = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(logged).toContain('"query":"ok"');
    expect(logged).not.toContain('lantern');
  });

  it('labels an empty Moondream answer and uses an off-center Llama 4 estimate', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async (model: string, input: Record<string, unknown>) => {
      if (model === LLAMA) return llamaDraft({ x: 0.64, y: 0.43 });
      if (input.task === 'point') return { points: [] };
      return {};
    });
    const result = await analyzeImage(analysisEnv(run).env, 'sample');
    expect(result).toMatchObject({
      caption: 'Colorful buildings along a canal.',
      altText: 'Buildings beside a canal.',
      subject: 'colorful buildings',
      focal: { x: 0.64, y: 0.43 },
      focalSource: 'llama4-estimate',
      writingModel: LLAMA,
      focalModel: LLAMA,
    });
    expect(result.note).toContain('Moondream returned no usable caption');
    expect(result.note).toContain('did not locate the suggested subject');
  });

  it('distinguishes a Moondream error and never uses a center-only estimate', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async (model: string) => {
      if (model === LLAMA) return llamaDraft({ x: 0.5, y: 0.5 });
      throw new Error('upstream unavailable');
    });
    const result = await analyzeImage(analysisEnv(run).env, 'sample');
    expect(result.focal).toBeNull();
    expect(result.focalSource).toBe('none');
    expect(result.note).toContain('Moondream returned an error');
    expect(result.note).toContain('Moondream point request failed');
    expect(result.note).toContain('image center');
  });

  it('rejects point coordinates that are not normalized', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async (_model: string, input: Record<string, unknown>) =>
      input.task === 'point'
        ? { points: [{ x: 320, y: 175 }] }
        : { answer: '{"caption":"A street.","alt":"A street.","subject":"street"}' },
    );
    const result = await analyzeImage(analysisEnv(run).env, 'sample');
    expect(result.focal).toBeNull();
    expect(result.note).toContain('non-normalized coordinates');
  });

  it('does not silently report an empty AI result as a completed suggestion', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await analyzeImage(analysisEnv(async () => ({})).env, 'sample');
    expect(result.caption).toBeNull();
    expect(result.focalSource).toBe('none');
    expect(result.writingModel).toBeNull();
    expect(result.note).toContain('AI writing suggestions were unavailable.');
  });
});

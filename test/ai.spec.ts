import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EDITORIAL_QUESTIONS,
  analyzeImage,
  isImageCenter,
  moondreamFields,
  normalizedPoint,
  parseEditorialAnswer,
} from '../src/lib/ai';

const LLAMA = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MOONDREAM = '@cf/moondream/moondream3.1-9B-A2B';

type Input = Record<string, unknown>;
type Point = { x: number; y: number };

afterEach(() => vi.restoreAllMocks());

function analysisEnv(run: (model: string, input: Input) => Promise<unknown>) {
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

function llamaDraft(focal: Point | null) {
  return {
    response: `\`\`\`json\n${JSON.stringify({
      caption: 'Colorful buildings along a canal.',
      alt: 'Buildings beside a canal.',
      subject: 'colorful buildings',
      focal,
    })}\n\`\`\``,
  };
}

/** Moondream replies by task, nested under `result` as the binding currently returns them. */
function moondream(replies: {
  caption?: string;
  alt?: string;
  subject?: string;
  object?: string;
  face?: Point[];
  points?: (target: string) => Point[];
}) {
  return vi.fn(async (_model: string, input: Input) => {
    const answers: Record<string, string | undefined> = {
      [EDITORIAL_QUESTIONS.alt]: replies.alt,
      [EDITORIAL_QUESTIONS.subject]: replies.subject,
      [EDITORIAL_QUESTIONS.object]: replies.object,
    };
    const result =
      input.task === 'caption'
        ? { caption: replies.caption ?? null }
        : input.task === 'point' && input.target === 'human face'
          ? { points: replies.face ?? [] }
          : input.task === 'point'
            ? { points: replies.points?.(String(input.target)) ?? [] }
            : { answer: answers[String(input.question)] ?? null };
    return { result, usage: { prompt_tokens: 735 } };
  });
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

  it('reads Moondream fields at the top level or nested under result', () => {
    expect(moondreamFields({ caption: 'Top level.' })).toEqual({ caption: 'Top level.' });
    expect(moondreamFields({ result: { caption: 'Nested.' }, usage: {} })).toEqual({
      caption: 'Nested.',
    });
    expect(moondreamFields(new ReadableStream()).caption).toBeUndefined();
    expect(moondreamFields(null)).toEqual({});
  });

  it('drafts with Moondream, disables streaming, and frames a visible face', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = moondream({
      caption: 'A person stands beneath a blossoming tree.',
      alt: 'A person under pink blossoms.',
      subject: 'A person.',
      object: 'Cherry blossom tree',
      face: [{ x: 0.53, y: 0.64 }],
    });
    const { env, output } = analysisEnv(run);

    const result = await analyzeImage(env, 'sample');
    expect(output).toHaveBeenCalledWith({ format: 'image/jpeg', quality: 85 });
    expect(
      run.mock.calls.every(
        ([model, input]) =>
          model === MOONDREAM &&
          input.stream === false &&
          String(input.image).startsWith('data:image/jpeg;base64,'),
      ),
    ).toBe(true);
    // A visible face is the focal point, so no object is located.
    const targets = run.mock.calls.filter(([, input]) => input.task === 'point');
    expect(targets.map(([, input]) => input.target)).toEqual(['human face']);
    expect(result).toEqual({
      caption: 'A person stands beneath a blossoming tree.',
      altText: 'A person under pink blossoms.',
      subject: 'A person',
      focal: { x: 0.53, y: 0.64 },
      focalSource: 'moondream-point',
      writingModel: MOONDREAM,
      focalModel: MOONDREAM,
      note: null,
    });
    const logged = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(logged).toContain('"caption":"ok"');
    expect(logged).toContain('"face":"ok"');
    expect(logged).not.toContain('blossom');
  });

  it('locates the most prominent object when no face is visible', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const targets: string[] = [];
    const run = moondream({
      caption: 'A narrow street of half-timbered buildings.',
      subject: 'A street scene with buildings and a sign.',
      object: 'La Petite Venise sign.',
      points: (target) => {
        targets.push(target);
        return [{ x: 0.56, y: 0.23 }];
      },
    });
    const result = await analyzeImage(analysisEnv(run).env, 'sample');
    expect(targets).toEqual(['La Petite Venise sign']);
    expect(result).toMatchObject({
      subject: 'A street scene with buildings and a sign',
      focal: { x: 0.56, y: 0.23 },
      focalSource: 'moondream-point',
      focalModel: MOONDREAM,
      note: null,
    });
  });

  it('drops a focal point at the image center, which would duplicate the center crop', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = moondream({
      caption: 'A street scene.',
      object: 'Buildings',
      points: () => [{ x: 0.498, y: 0.504 }],
    });
    const result = await analyzeImage(analysisEnv(run).env, 'sample');
    expect(result).toMatchObject({ focal: null, focalSource: 'none', focalModel: null });
    expect(result.note).toBe(
      'Moondream located the subject at the image center, so no AI-guided crop was made.',
    );
  });

  it('treats a streamed Moondream reply as unusable and labels the Llama 4 fallback', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn(async (model: string) =>
      model === LLAMA ? llamaDraft({ x: 0.64, y: 0.43 }) : new ReadableStream(),
    );
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
    const run = moondream({
      caption: 'A street.',
      object: 'Street lamp',
      face: [{ x: 640, y: 360 }],
      points: () => [{ x: 320, y: 175 }],
    });
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

import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCreative } from '../src/lib/ai';
import { originalKey, privateKey } from '../src/lib/media';
import { createUploadRecord } from '../src/lib/uploads';
import { prepareTestDb } from './helpers';

beforeEach(() => prepareTestDb(env.DB));

async function prepareUpload(id: string) {
  await createUploadRecord(env.DB, {
    id,
    hash: 'hash',
    mime: 'image/jpeg',
    width: 1200,
    height: 800,
    now: Date.now(),
  });
  await env.MEDIA.put(privateKey(id, 'preview'), new Uint8Array([1, 2, 3]));
}

afterEach(() => vi.restoreAllMocks());

function images(onOutput: (index: number) => void = () => {}) {
  let outputs = 0;
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const transformer: ReturnType<ImagesBinding['input']> = {
    transform: vi.fn(() => transformer),
    draw: vi.fn(() => transformer),
    output: vi.fn(async () => {
      onOutput(++outputs);
      return {
        image: () => new Blob([bytes]).stream(),
        contentType: () => 'image/webp',
        response: () => new Response(bytes, { headers: { 'content-type': 'image/webp' } }),
      };
    }),
  };
  const binding: Pick<ImagesBinding, 'input'> = {
    input: vi.fn(() => transformer),
  };
  return { binding, transformer };
}

describe('editorial illustration generation', () => {
  it('sends the recorded landscape recipe and measures inference before output processing', async () => {
    const id = crypto.randomUUID();
    await prepareUpload(id);
    await env.MEDIA.put(originalKey(id), new Uint8Array([1, 2, 3]));
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const imageBinding = images((index) => {
      if (index === 2) elapsed += 500;
    });
    const run = vi
      .fn<Parameters<typeof generateCreative>[0]['AI']['run']>()
      .mockImplementation(async () => {
        elapsed += 40;
        return { image: btoa('generated raster') };
      });
    const result = await generateCreative(
      { DB: env.DB, MEDIA: env.MEDIA, IMAGES: imageBinding.binding, AI: { run } },
      id,
      'illustration',
    );

    const [model, input] = run.mock.calls[0];
    expect(model).toBe('@cf/black-forest-labs/flux-2-klein-9b');
    expect(input).toHaveProperty('multipart');
    if (!('multipart' in input)) throw new Error('Expected multipart input.');
    const multipart = input.multipart;
    if (
      !multipart ||
      typeof multipart !== 'object' ||
      !('body' in multipart) ||
      !(multipart.body instanceof ReadableStream) ||
      !('contentType' in multipart) ||
      typeof multipart.contentType !== 'string'
    ) {
      throw new Error('Expected a serialized multipart request.');
    }
    const form = await new Response(multipart.body, {
      headers: { 'content-type': multipart.contentType },
    }).formData();
    expect(form.get('prompt')).toBe(result.prompt);
    expect(result.prompt).toContain('newspaper feature illustration');
    expect(form.get('width')).toBe('1152');
    expect(form.get('height')).toBe('768');
    expect(form.get('seed')).toBe('20261005');
    expect(form.get('input_image_0')).toBeInstanceOf(File);
    expect((form.get('input_image_0') as File).type).toBe('image/webp');
    expect(result).toMatchObject({
      generation: { width: 1152, height: 768, seed: 20261005 },
      referenceTransform: { width: 480, height: 480, fit: 'scale-down' },
      outputTransform: { width: 960, height: 640, fit: 'scale-down' },
      inferenceMs: 40,
      generationMs: 540,
    });
    expect(await env.MEDIA.head(privateKey(id, 'creative'))).not.toBeNull();
    expect(await env.MEDIA.head(originalKey(id))).not.toBeNull();
    expect(await env.MEDIA.head(privateKey(id, 'creative-reference'))).toBeNull();
    expect(await env.MEDIA.head(privateKey(id, 'creative-raw'))).toBeNull();
  });

  it.each(['inference', 'missing result', 'encoding'])(
    'removes temporary model inputs when %s fails',
    async (failure) => {
      const id = crypto.randomUUID();
      await prepareUpload(id);
      await env.MEDIA.put(originalKey(id), new Uint8Array([1, 2, 3]));
      const imageBinding = images((index) => {
        if (failure === 'encoding' && index === 2) throw new Error('Encoding unavailable.');
      });
      const run = vi.fn<Parameters<typeof generateCreative>[0]['AI']['run']>();
      if (failure === 'inference') run.mockRejectedValue(new Error('Inference unavailable.'));
      else run.mockResolvedValue(failure === 'missing result' ? {} : { image: btoa('raster') });

      await expect(
        generateCreative(
          { DB: env.DB, MEDIA: env.MEDIA, IMAGES: imageBinding.binding, AI: { run } },
          id,
          'illustration',
        ),
      ).rejects.toThrow();
      expect(await env.MEDIA.head(originalKey(id))).not.toBeNull();
      expect(await env.MEDIA.head(privateKey(id, 'creative'))).toBeNull();
      expect(await env.MEDIA.head(privateKey(id, 'creative-reference'))).toBeNull();
      expect(await env.MEDIA.head(privateKey(id, 'creative-raw'))).toBeNull();
    },
  );
});

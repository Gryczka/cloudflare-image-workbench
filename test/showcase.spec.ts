import { describe, expect, it, vi } from 'vitest';
import { DEMO_SOURCES, SHOWCASES, demoSource } from '../src/showcases/catalog';
import { parseJsonc, publicCode } from '../src/showcases/code';
import { executeShowcase } from '../src/showcases/execute';
import { negotiatedFormat, resolveRecipe } from '../src/showcases/recipes';
import { validateQuery } from '../src/showcases/requests';
import { recipeIdentity } from '../src/showcases/version';

describe('public image recipe boundaries', () => {
  it('only accepts registered source and variant identifiers with a bounded focal point', () => {
    expect(DEMO_SOURCES).toHaveLength(3);
    expect(SHOWCASES).toHaveLength(9);
    expect(demoSource('uploads/private/original')).toBeUndefined();
    expect(() => resolveRecipe('resize', 'width=9000', new Headers())).toThrow();
    expect(() => resolveRecipe('pipeline', 'editorial', new Headers())).toThrow();
    expect(() => resolveRecipe('framing', 'point', new Headers(), '0.49-0.50')).toThrow();
    expect(() => resolveRecipe('format', 'webp', new Headers(), '0.50-0.50')).toThrow();
    expect(() => validateQuery(new URLSearchParams('v=a&v=b'), ['v', 'point'])).toThrow();
    expect(() => validateQuery(new URLSearchParams('v=a&width=9000'), ['v', 'point'])).toThrow();
    expect(resolveRecipe('framing', 'point', new Headers(), '0.25-0.75').focalPoint).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });

  it('reads the commented Wrangler config without corrupting string values', () => {
    expect(
      parseJsonc(`{
        // line comment, with a trailing comma below
        "url": "https://example.com/a,]", /* block */
        "quote": "say \\"hi\\" // not a comment",
        "list": [1, 2,],
      }`),
    ).toEqual({ url: 'https://example.com/a,]', quote: 'say "hi" // not a comment', list: [1, 2] });
    expect(() => parseJsonc('{ /* open')).toThrow(SyntaxError);
  });

  it('respects specific q=0 exclusions over wildcards and rejects unacceptable formats', () => {
    expect(negotiatedFormat('image/avif;q=0, image/webp;q=0.8, */*;q=1')).toBe('webp');
    expect(negotiatedFormat('image/*;q=0, image/jpeg;q=1')).toBe('jpeg');
    expect(() => negotiatedFormat('image/avif;q=0,image/webp;q=0,image/jpeg;q=0')).toThrow();
    expect(
      resolveRecipe('responsive', '640', new Headers({ accept: 'image/webp', 'save-data': 'on' })),
    ).toMatchObject({
      output: { format: 'image/webp', quality: 55 },
      requestPolicy: { saveData: true },
    });
  });

  it('runs the plan in the inspected order, including overlay before or after resizing', async () => {
    const operations: string[] = [];
    const transformer = {
      transform: vi.fn((settings: ImageTransform) => {
        operations.push(`transform:${settings.width}`);
        return transformer;
      }),
      draw: vi.fn(() => {
        operations.push('draw');
        return transformer;
      }),
      output: vi.fn(async (settings: ImageOutputOptions) => {
        operations.push(`output:${settings.format}`);
        return {
          response: () => new Response('encoded', { headers: { 'content-type': settings.format } }),
        };
      }),
    };
    const env = {
      ASSETS: {
        fetch: vi.fn(async () => new Response('source bytes')),
      },
      IMAGES: { input: vi.fn(() => transformer) },
    } as unknown as Pick<Env, 'ASSETS' | 'IMAGES'>;
    const request = new Request('https://example.test/');
    const source = DEMO_SOURCES[2];

    const before = await executeShowcase(
      env,
      request,
      source,
      resolveRecipe('composition', 'logo-before', new Headers()),
    );
    expect(operations).toEqual(['transform:180', 'draw', 'transform:660', 'output:image/webp']);
    expect(before.originalBytes).toBe(source.bytes);
    expect(new TextDecoder().decode(await before.image.arrayBuffer())).toBe('encoded');

    operations.length = 0;
    await executeShowcase(
      env,
      request,
      source,
      resolveRecipe('composition', 'logo-after', new Headers()),
    );
    expect(operations).toEqual(['transform:660', 'transform:180', 'draw', 'output:image/webp']);
  });

  it('uses cf.image for the named perceptual quality on a public source', async () => {
    const plan = resolveRecipe('format', 'webp-perceptual', new Headers());
    expect(plan).toMatchObject({
      path: 'cf.image',
      transforms: [],
      output: { format: 'image/webp', quality: 'medium-high' },
      fetchOptions: { width: 960, fit: 'scale-down', format: 'webp', quality: 'medium-high' },
    });
    if (plan.path !== 'cf.image') throw new Error('Expected URL-based image processing.');

    const fetchImage = vi.fn(
      async () => new Response('encoded', { headers: { 'content-type': 'image/webp' } }),
    );
    const env = {
      ASSETS: { fetch: vi.fn() },
      IMAGES: { input: vi.fn() },
    } as unknown as Pick<Env, 'ASSETS' | 'IMAGES'>;
    vi.stubGlobal('fetch', fetchImage);
    try {
      const result = await executeShowcase(
        env,
        new Request('https://example.test/'),
        DEMO_SOURCES[0],
        plan,
      );
      expect(fetchImage).toHaveBeenCalledWith(expect.any(Request), {
        cf: { image: plan.fetchOptions },
      });
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
      expect(env.IMAGES.input).not.toHaveBeenCalled();
      expect(result.image.headers.get('content-type')).toBe('image/webp');
      expect(result.originalBytes).toBe(DEMO_SOURCES[0].bytes);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('versions actual deployed recipe source and only displays extracted server code', async () => {
    const jpeg = resolveRecipe('format', 'jpeg', new Headers());
    const webp = resolveRecipe('format', 'webp', new Headers());
    const [a, b] = await Promise.all([recipeIdentity(jpeg), recipeIdentity(webp)]);
    expect(a.version).toBe(b.version);
    expect(a.planDigest).not.toBe(b.planDigest);
    const code = publicCode('composition');
    expect(code.map((entry) => entry.path)).toContain('src/showcases/execute.ts · composition');
    expect(code.some(({ source }) => source.includes('env.IMAGES.input('))).toBe(true);
    expect(code.some(({ source }) => source.includes('ADMIN_REVIEW_TOKEN'))).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as details } from '../src/pages/api/showcase/details';
import { GET as image } from '../src/pages/api/showcase/[source]/[family]/[variant]';
import { resolveRecipe } from '../src/showcases/recipes';
import { recipeIdentity } from '../src/showcases/version';
import { restoreEnv, stubEnv } from './helpers';

describe('public showcase HTTP boundary', () => {
  it('returns an executable recipe, code excerpt, and a versioned URL without public-caching metadata', async () => {
    const response = await details({
      request: new Request(
        'https://example.test/api/showcase/details?source=product&family=resize&variant=pad',
      ),
    } as Parameters<typeof details>[0]);
    const body: {
      kind: string;
      imageUrl: string;
      plan: { transforms: { fit: string }[] };
      code: { source: string }[];
      source: { sha256: string };
    } = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.plan.transforms[0].fit).toBe('pad');
    expect(body.imageUrl).toMatch(/\/api\/showcase\/product\/resize\/pad\?v=[0-9a-f]{16}$/);
    expect(body.source.sha256).toHaveLength(64);
    expect(body.code.some(({ source }) => source.includes('env.IMAGES.input('))).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ADMIN_REVIEW_TOKEN');
  });

  it('never transforms private paths, unknown recipes, duplicate query keys, or old versions', async () => {
    const bad = [
      [
        'https://example.test/api/showcase/private-id/format/jpeg?v=x',
        { source: 'private-id', family: 'format', variant: 'jpeg' },
        404,
      ],
      [
        'https://example.test/api/showcase/product/unknown/x?v=x',
        { source: 'product', family: 'unknown', variant: 'x' },
        404,
      ],
      [
        'https://example.test/api/showcase/product/resize/pad?v=x&v=y',
        { source: 'product', family: 'resize', variant: 'pad' },
        400,
      ],
      [
        'https://example.test/api/showcase/product/resize/pad?v=old',
        { source: 'product', family: 'resize', variant: 'pad' },
        409,
      ],
      [
        'https://example.test/api/showcase/product/framing/center?v=x&point=invalid',
        { source: 'product', family: 'framing', variant: 'center' },
        400,
      ],
      [
        'https://example.test/api/showcase/product/framing/face?v=x&point=0.25-0.75',
        { source: 'product', family: 'framing', variant: 'face' },
        400,
      ],
    ] as const;
    for (const [url, params, status] of bad) {
      const response = await image({ request: new Request(url), params } as unknown as Parameters<
        typeof image
      >[0]);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});

describe('public showcase caching', () => {
  afterEach(() => restoreEnv());

  function stubTransform(limit = vi.fn(async () => ({ success: true }))) {
    const transformer = {
      transform: () => transformer,
      draw: () => transformer,
      output: async () => ({
        response: () =>
          new Response('webp', {
            headers: {
              'content-type': 'image/webp',
              'content-length': '4',
              'cf-resized': 'internal=ok',
              etag: '"internal"',
            },
          }),
      }),
    };
    const source = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      });
    stubEnv({
      SHOWCASE_THROTTLE: { limit },
      ASSETS: { fetch: async () => new Response(source()) },
      IMAGES: { input: () => transformer },
    });
  }

  async function render(family: string, variant: string, headers: Record<string, string> = {}) {
    const { version } = await recipeIdentity(
      resolveRecipe(family, variant, new Headers(headers), null),
    );
    return image({
      request: new Request(
        `https://example.test/api/showcase/product/${family}/${variant}?v=${version}`,
        { headers },
      ),
      params: { source: 'product', family, variant },
    } as unknown as Parameters<typeof image>[0]);
  }

  it('publicly caches only successful transforms and copies only representation headers', async () => {
    stubTransform();
    const response = await render('resize', 'pad');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0');
    expect(response.headers.get('cloudflare-cdn-cache-control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('vary')).toBeNull();
    expect(response.headers.get('cf-resized')).toBeNull();
    expect(response.headers.get('etag')).toBeNull();
  });

  it('varies only negotiated responsive output, and never on a throttled response', async () => {
    stubTransform();
    const negotiated = await render('responsive', '640', {
      accept: 'image/webp',
      'save-data': 'on',
    });
    expect(negotiated.status).toBe(200);
    expect(negotiated.headers.get('vary')).toBe('Accept, Save-Data');

    stubTransform(vi.fn(async () => ({ success: false })));
    const throttled = await render('responsive', '640', { accept: 'image/webp' });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('cache-control')).toBe('no-store');
    expect(throttled.headers.get('vary')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { docsLink } from '../src/lib/site';
import { GET as robots } from '../src/pages/robots.txt';
import { GET as sitemap } from '../src/pages/sitemap.xml';

type Context = Parameters<typeof robots>[0];
const context = (url: string, site?: string) =>
  ({ request: new Request(url), site: site ? new URL(site) : undefined }) as Context;

describe('public discovery and attribution', () => {
  it('attributes Cloudflare docs links and leaves other links untouched', () => {
    const link = new URL(
      docsLink('https://developers.cloudflare.com/images/optimization/features/#fit'),
    );
    expect(link.hash).toBe('#fit');
    expect(Object.fromEntries(link.searchParams)).toEqual({
      utm_source: 'gryczka.dev',
      utm_medium: 'referral',
      utm_campaign: 'app-garden',
      utm_content: 'cloudflare-image-workbench-images-optimization-features',
      utm_term: 'images',
    });
    expect(docsLink('https://github.com/Gryczka/cloudflare-image-workbench')).toBe(
      'https://github.com/Gryczka/cloudflare-image-workbench',
    );
    expect(docsLink('https://cloudflare.com.example.net/')).toBe(
      'https://cloudflare.com.example.net/',
    );
  });

  it('keeps APIs out of search and AI training while pointing at its own sitemap', async () => {
    const response = await robots(context('https://fork.example.com/robots.txt'));
    const body = await response.text();
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=no');
    expect(body).toMatch(/^Disallow: \/api\/$/m);
    expect(body).toMatch(/^Disallow: \/health$/m);
    expect(body).toContain('Sitemap: https://fork.example.com/sitemap.xml');
  });

  it('lists the canonical origin when one is configured', async () => {
    const configured = await sitemap(
      context('https://staging.example.com/sitemap.xml', 'https://workbench.example.com'),
    );
    expect(await configured.text()).toContain('<loc>https://workbench.example.com/</loc>');
    const unconfigured = await sitemap(context('https://fork.example.com/sitemap.xml'));
    expect(await unconfigured.text()).toContain('<loc>https://fork.example.com/</loc>');
  });
});

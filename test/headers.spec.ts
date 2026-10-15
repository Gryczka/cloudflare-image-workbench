import { describe, expect, it } from 'vitest';
import headersFile from '../public/_headers?raw';
import { SECURITY_HEADERS } from '../src/lib/headers';

function staticRule(path: string): Record<string, string> {
  const rules = headersFile.split(/\n\s*\n/);
  const rule = rules.find((block) => block.split('\n')[0].trim() === path);
  if (!rule) throw new Error(`Missing ${path} rule in public/_headers.`);
  return Object.fromEntries(
    rule
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
  );
}

describe('security headers', () => {
  it('serves the same security headers on static assets and Worker responses', () => {
    expect(staticRule('/*')).toEqual(SECURITY_HEADERS);
  });

  it('marks only content-hashed demo assets as immutable', () => {
    for (const path of [
      '/showcase-*.jpg',
      '/showcase-*.jpeg',
      '/showcase-*.png',
      '/showcase-*.woff2',
    ]) {
      expect(staticRule(path)['cache-control']).toBe('public, max-age=31536000, immutable');
    }
    expect(headersFile).not.toMatch(/^\/showcase-\*\s*$/m);
  });
});

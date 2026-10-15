import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Astro's SSR handler imports a Vite virtual module unavailable in Vitest.
      // Only bind local storage; AI/Images bindings would require a remote account.
      // Test Worker-side modules in workerd, and smoke-test Astro through preview.
      main: './test/worker.ts',
      miniflare: {
        compatibilityDate: '2026-09-21',
        d1Databases: ['DB'],
        r2Buckets: ['MEDIA'],
      },
    }),
  ],
});

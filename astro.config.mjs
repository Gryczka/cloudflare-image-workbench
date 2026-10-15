import { env } from 'node:process';
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Canonical and Open Graph URLs need an absolute origin at build time. The production deploy
  // script sets SITE_URL; set it in your own build to emit them, or leave it unset to omit them.
  site: env.SITE_URL || undefined,
  // The prerendered explainer has no binding dependencies; build it offline.
  adapter: cloudflare({ prerenderEnvironment: 'node', imageService: 'passthrough' }),
  output: 'server',
  session: false,
});

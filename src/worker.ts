/**
 * Worker entrypoints. `fetch` runs Astro's page and API routes and adds the shared security
 * headers, `queue` turns R2 upload notifications into Workflow runs, and `scheduled` runs the
 * hourly retention cleanup. The Workflow class is re-exported for its binding.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { SECURITY_HEADERS } from './lib/headers';
import { consumeUploadEvents } from './lib/queue';
import { purgeExpiredData } from './lib/retention';

export { ProcessImageWorkflow } from './workflows/process-image';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const response = await handle(request, env, ctx);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
  // showcase:start queue
  async queue(batch, env): Promise<void> {
    await consumeUploadEvents(batch, env);
  },
  // showcase:end queue
  async scheduled(controller, env): Promise<void> {
    const removed = await purgeExpiredData(env, controller.scheduledTime);
    console.log(JSON.stringify({ event: 'retention_cleanup', ...removed }));
  },
} satisfies ExportedHandler<Env>;

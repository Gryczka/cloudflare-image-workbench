// Deploy and verify the staging or production environment:
//   DEPLOY_URL=https://<worker>.<subdomain>.workers.dev npm run deploy:production
// Authenticate Wrangler first (`npx wrangler login`, or export CLOUDFLARE_API_TOKEN).
// Credentials go only to Wrangler, never to the lint, test, or build steps.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { unstable_readConfig } from 'wrangler';

const target = process.argv[2];
if (target !== 'staging' && target !== 'production') {
  throw new Error('Usage: node scripts/deploy-environment.mjs <staging|production>');
}
const origin = process.env.DEPLOY_URL;
if (!origin || !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(origin)) {
  throw new Error(
    'Export DEPLOY_URL as the deployed origin, e.g. https://<worker>.<subdomain>.workers.dev',
  );
}

const root = fileURLToPath(new URL('../', import.meta.url));
const config = unstable_readConfig(
  { config: `${root}wrangler.jsonc`, env: target },
  { hideWarnings: true },
);
const bucket = config.r2_buckets.find(({ binding }) => binding === 'MEDIA')?.bucket_name;
const queue = config.queues.consumers?.[0]?.queue;
assert.ok(bucket && queue, `The ${target} environment needs a MEDIA bucket and a Queue consumer.`);

const wranglerEnv = { ...process.env, CLOUDFLARE_ENV: target };
// Only production is canonical; staging pages omit canonical and Open Graph URLs.
const toolEnv = { ...wranglerEnv, SITE_URL: target === 'production' ? origin : '' };
delete toolEnv.CLOUDFLARE_API_TOKEN;
delete toolEnv.CF_API_TOKEN;

function run(command, args, env, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (capture) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}.`);
  }
  return capture ? stripVTControlCharacters(result.stdout) : '';
}

/** Wrangler prints each rule as a block of `label: value` lines; blocks are blank-line separated. */
function labelledBlocks(output) {
  return output
    .split(/\n\s*\n/)
    .map((block) =>
      Object.fromEntries(
        block
          .split('\n')
          .map((line) => /^([a-z_]+):\s*(.*)$/.exec(line.trim()))
          .filter(Boolean)
          .map(([, label, value]) => [label, value.trim()]),
      ),
    )
    .filter((block) => Object.keys(block).length > 0);
}

/** Bucket notification and lifecycle rules are bucket settings that a deploy never creates. */
function checkBucketRules() {
  if (String(config.vars.START_WORKFLOW_ON_UPLOAD) !== 'true') {
    const rules = labelledBlocks(
      run('npx', ['wrangler', 'r2', 'bucket', 'notification', 'list', bucket], wranglerEnv, true),
    );
    assert.ok(
      rules.some(
        (rule) =>
          rule.queue_name === queue &&
          rule.prefix === 'uploads/' &&
          rule.event_type?.split(',').includes('PutObject'),
      ),
      `Missing R2 notification for ${bucket}: uploads/ object-create → ${queue}. See the README.`,
    );
  }
  const lifecycle = labelledBlocks(
    run('npx', ['wrangler', 'r2', 'bucket', 'lifecycle', 'list', bucket], wranglerEnv, true),
  );
  for (const prefix of ['uploads/', 'private/']) {
    assert.ok(
      lifecycle.some(
        (rule) =>
          rule.enabled === 'Yes' &&
          rule.prefix === prefix &&
          Number(/Expire objects after ([\d.]+) days/.exec(rule.action ?? '')?.[1]) <= 1,
      ),
      `Missing R2 lifecycle rule for ${bucket}: expire ${prefix} after 1 day. See the README.`,
    );
  }
}

/** The `/*` block of public/_headers; test/headers.spec.ts keeps it equal to SECURITY_HEADERS. */
async function securityHeaders() {
  const file = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const block = file.split(/\n\s*\n/).find((rule) => rule.split('\n')[0].trim() === '/*');
  assert.ok(block, 'public/_headers has no /* rule.');
  return block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]);
}

async function verifyPublicRoutes(expectedHeaders) {
  const get = (path) => fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const [health, home, settings, gallery, details, robots] = await Promise.all([
        get('/health'),
        get('/'),
        get('/api/config'),
        get('/api/gallery'),
        get('/api/showcase/details?source=product&family=resize&variant=pad'),
        get('/robots.txt'),
      ]);
      for (const response of [health, home, settings, gallery, details, robots]) {
        assert.equal(response.status, 200, response.url);
      }
      assert.deepEqual(await health.json(), { ok: true, service: 'image-workbench' });
      const page = await home.text();
      assert.match(page, /Image Workbench/);
      if (target === 'production') {
        assert.ok(
          page.includes(`<link rel="canonical" href="${origin}/">`),
          'Missing canonical URL.',
        );
      }
      assert.match(await robots.text(), /^Disallow: \/api\/$/m);
      assert.ok(Array.isArray((await gallery.json()).items));
      const uploads = await settings.json();
      assert.equal(typeof uploads.enabled, 'boolean');
      if (uploads.enabled) assert.ok(uploads.siteKey, 'Enabled uploads need a Turnstile site key.');
      // A real Images binding transform, not just a page render.
      const sample = await get((await details.json()).imageUrl);
      assert.equal(sample.status, 200, sample.url);
      assert.match(sample.headers.get('content-type') ?? '', /^image\//);
      // home is a static asset (public/_headers); health is a Worker response (SECURITY_HEADERS).
      for (const response of [health, home]) {
        for (const [name, value] of expectedHeaders) {
          assert.equal(response.headers.get(name), value, `${name} on ${response.url}`);
        }
      }
      return uploads.enabled;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error(`${origin} did not pass verification: ${lastError}`);
}

// Astro chooses the Wrangler environment at build time, so build the target explicitly.
run('npm', ['run', 'check'], toolEnv);
const built = JSON.parse(
  await readFile(new URL('../dist/server/wrangler.json', import.meta.url), 'utf8'),
);
assert.equal(built.targetEnvironment, target);
assert.equal(built.name, config.name);
if (target === 'production') {
  assert.equal(built.preview_urls, false, 'Production must not expose preview URLs.');
}
const expectedHeaders = await securityHeaders();

checkBucketRules();
// Migrations read wrangler.jsonc directly (not the build's redirected config), so name the env.
run(
  'npx',
  ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', target],
  wranglerEnv,
);
run('npx', ['wrangler', 'deploy'], wranglerEnv);

const uploadsEnabled = await verifyPublicRoutes(expectedHeaders);
console.log(
  `Verified ${config.name} at ${origin} (visitor uploads ${uploadsEnabled ? 'enabled' : 'paused'}).`,
);

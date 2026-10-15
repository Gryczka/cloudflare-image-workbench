// Build gate (`npm run check:sources`): every demo source and versioned asset must match the
// digest in its catalog entry and filename, and every displayed excerpt needs exactly one
// ordered `// showcase:start`/`// showcase:end` pair. Add new excerpt keys to `markedFiles`.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path));
const catalog = (await read('src/showcases/catalog.ts')).toString();

const sources = [
  ...catalog.matchAll(/asset: '(\/showcase-[\w.-]+)',\s*sha256: '([0-9a-f]{64})',\s*bytes: (\d+)/g),
];
if (sources.length !== 3) throw new Error('Expected three declared, versioned demo sources.');
for (const [, asset, expected, size] of sources) {
  const file = await read(`public${asset}`);
  const actual = createHash('sha256').update(file).digest('hex');
  if (actual !== expected || !asset.includes(expected.slice(0, 8))) {
    throw new Error(`Demo source checksum mismatch: ${asset}`);
  }
  if (file.byteLength !== Number(size))
    throw new Error(`Demo source byte count mismatch: ${asset}`);
}

for (const name of ['WATERMARK_ASSET', 'FONT_ASSET']) {
  const asset = new RegExp(`${name} = '(\\/showcase-[\\w.-]+)'`).exec(catalog)?.[1];
  if (!asset) throw new Error(`Missing ${name}.`);
  const hash = createHash('sha256')
    .update(await read(`public${asset}`))
    .digest('hex');
  if (!asset.includes(hash.slice(0, 8)))
    throw new Error(`Versioned asset checksum mismatch: ${asset}`);
}

// public/_headers caches these extensions as immutable, so each name must carry its digest.
for (const file of await readdir(resolve(root, 'public'))) {
  if (!/^showcase-.+\.(?:jpe?g|png|woff2)$/.test(file)) continue;
  const hash = createHash('sha256')
    .update(await read(`public/${file}`))
    .digest('hex');
  if (!file.includes(hash.slice(0, 8))) {
    throw new Error(`Immutable asset name lacks its SHA-256 prefix: public/${file}`);
  }
}

const markedFiles = new Map([
  [
    'src/showcases/recipes.ts',
    ['resize', 'framing', 'format', 'effects', 'composition', 'responsive'],
  ],
  ['src/showcases/execute.ts', ['binding', 'overlay']],
  ['src/pages/api/showcase/[source]/[family]/[variant].ts', ['handler']],
  ['src/worker.ts', ['queue']],
  ['src/lib/queue.ts', ['consumer']],
  ['src/lib/media.ts', ['presets', 'store', 'crop-plan']],
  ['src/lib/ai.ts', ['models', 'analysis', 'creative']],
  ['src/workflows/process-image.ts', ['editorial', 'creative']],
  ['src/pages/api/uploads/[id]/assets/[asset].ts', ['authorized-asset']],
  ['src/pages/api/gallery/assets/[id]/[asset].ts', ['approved-asset']],
]);

for (const [file, keys] of markedFiles) {
  const contents = (await read(file)).toString();
  for (const key of keys) {
    const start = `// showcase:start ${key}`;
    const end = `// showcase:end ${key}`;
    if (contents.split(start).length !== 2 || contents.split(end).length !== 2) {
      throw new Error(`Missing or duplicate ${key} source marker in ${file}.`);
    }
    if (contents.indexOf(end) < contents.indexOf(start)) {
      throw new Error(`Reversed ${key} source marker in ${file}.`);
    }
  }
}

console.log('Demo asset digests and executable source excerpts verified.');

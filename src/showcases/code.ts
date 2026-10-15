/** The source excerpts each inspector shows, cut by marker from the same files the Worker runs. */
import workerSource from '../worker.ts?raw';
import queueSource from '../lib/queue.ts?raw';
import mediaSource from '../lib/media.ts?raw';
import aiSource from '../lib/ai.ts?raw';
import workflowSource from '../workflows/process-image.ts?raw';
import wranglerSource from '../../wrangler.jsonc?raw';
import privateAssetSource from '../pages/api/uploads/[id]/assets/[asset].ts?raw';
import galleryAssetSource from '../pages/api/gallery/assets/[id]/[asset].ts?raw';
import { sourceExcerpt, PUBLIC_SOURCE } from './version';

export interface SourceFile {
  path: string;
  source: string;
}

/** Parse JSONC: drop comments and trailing commas outside strings, so `https://` values survive. */
export function parseJsonc(source: string): unknown {
  let json = '';
  let inString = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      json += char;
      if (char === '\\') json += source[++index] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      json += char;
    } else if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      json += '\n';
    } else if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2) + 1;
      if (index === 0) throw new SyntaxError('Unterminated JSONC comment.');
    } else {
      if (char === '}' || char === ']') {
        const trimmed = json.trimEnd();
        if (trimmed.endsWith(',')) json = trimmed.slice(0, -1);
      }
      json += char;
    }
  }
  return JSON.parse(json);
}

function bindings(): SourceFile {
  // Never return resource names or vars.
  const config = parseJsonc(wranglerSource) as {
    images: { binding: string };
    r2_buckets: { binding: string }[];
    assets: { binding: string };
    ai: { binding: string };
    workflows: { binding: string }[];
  };
  return {
    path: 'wrangler.jsonc · binding names only',
    source: JSON.stringify(
      {
        images: config.images,
        r2_buckets: config.r2_buckets.map(({ binding }) => ({ binding })),
        assets: { binding: config.assets.binding },
        ai: config.ai,
        workflows: config.workflows.map(({ binding }) => ({ binding })),
      },
      null,
      2,
    ),
  };
}

/** A request-time recipe's policy, the binding call, the HTTP handler, and binding names. */
export function publicCode(family: string): SourceFile[] {
  return [
    {
      path: 'src/showcases/recipes.ts · resolved policy',
      source: sourceExcerpt(PUBLIC_SOURCE.recipeSource, family),
    },
    {
      path: 'src/showcases/execute.ts · binding',
      source: sourceExcerpt(PUBLIC_SOURCE.executionSource, 'binding'),
    },
    ...(family === 'composition'
      ? [
          {
            path: 'src/showcases/execute.ts · composition',
            source: sourceExcerpt(PUBLIC_SOURCE.executionSource, 'overlay'),
          },
        ]
      : []),
    {
      path: 'src/pages/api/showcase/[source]/[family]/[variant].ts · handler',
      source: sourceExcerpt(PUBLIC_SOURCE.endpointSource, 'handler'),
    },
    bindings(),
  ];
}

/** A Workflow-backed sample's excerpts; each run also records a digest of these as its snapshot. */
export function workflowCode(family: 'pipeline' | 'editorial-ai' | 'synthetic'): SourceFile[] {
  const shared = [
    {
      path: 'src/lib/media.ts · editorial dimensions / output',
      source: sourceExcerpt(mediaSource, 'presets'),
    },
    { path: 'src/lib/media.ts · Images / R2', source: sourceExcerpt(mediaSource, 'store') },
    { path: 'src/lib/media.ts · crop policy', source: sourceExcerpt(mediaSource, 'crop-plan') },
    {
      path: 'src/pages/api/uploads/[id]/assets/[asset].ts · authorized retrieval',
      source: sourceExcerpt(privateAssetSource, 'authorized-asset'),
    },
    {
      path: 'src/pages/api/gallery/assets/[id]/[asset].ts · approved retrieval',
      source: sourceExcerpt(galleryAssetSource, 'approved-asset'),
    },
    bindings(),
  ];
  if (family === 'pipeline') {
    return [
      { path: 'src/worker.ts · Queue handler', source: sourceExcerpt(workerSource, 'queue') },
      { path: 'src/lib/queue.ts · start Workflow', source: sourceExcerpt(queueSource, 'consumer') },
      {
        path: 'src/workflows/process-image.ts · materialize crops',
        source: sourceExcerpt(workflowSource, 'editorial'),
      },
      ...shared,
    ];
  }
  if (family === 'editorial-ai') {
    return [
      { path: 'src/lib/ai.ts · chosen models', source: sourceExcerpt(aiSource, 'models') },
      { path: 'src/lib/ai.ts · vision and fallback', source: sourceExcerpt(aiSource, 'analysis') },
      {
        path: 'src/workflows/process-image.ts · AI crop',
        source: sourceExcerpt(workflowSource, 'editorial'),
      },
      ...shared,
    ];
  }
  return [
    {
      path: 'src/lib/ai.ts · chosen models / treatments',
      source: sourceExcerpt(aiSource, 'models'),
    },
    { path: 'src/lib/ai.ts · generated image', source: sourceExcerpt(aiSource, 'creative') },
    {
      path: 'src/workflows/process-image.ts · synthetic Workflow',
      source: sourceExcerpt(workflowSource, 'creative'),
    },
    ...shared,
  ];
}

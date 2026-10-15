import catalogSource from './catalog.ts?raw';
import recipeSource from './recipes.ts?raw';
import executionSource from './execute.ts?raw';
import endpointSource from '../pages/api/showcase/[source]/[family]/[variant].ts?raw';
import { sha256 } from '../lib/security';
import type { RecipePlan } from './recipes';

/** The version changes if the actual recipe, asset catalog, binding call, or HTTP handler changes. */
export async function recipeIdentity(plan: RecipePlan): Promise<{
  version: string;
  planDigest: string;
}> {
  const [version, planDigest] = await Promise.all([
    sha256([catalogSource, recipeSource, executionSource, endpointSource, plan.family].join('\n')),
    sha256(JSON.stringify(plan)),
  ]);
  return { version: version.slice(0, 16), planDigest: planDigest.slice(0, 16) };
}

/** The code between one key's start and end markers; a missing or duplicated marker throws. */
export function sourceExcerpt(source: string, key: string): string {
  const start = `// showcase:start ${key}`;
  const end = `// showcase:end ${key}`;
  const begin = source.indexOf(start);
  const finish = source.indexOf(end);
  if (begin === -1 || finish < begin || source.indexOf(start, begin + 1) !== -1) {
    throw new Error(`Missing or duplicate showcase source marker: ${key}`);
  }
  return source.slice(begin + start.length, finish).trim();
}

/** Runtime source and build-time displayed source are imported from the same deployed files. */
export const PUBLIC_SOURCE = { catalogSource, recipeSource, executionSource, endpointSource };

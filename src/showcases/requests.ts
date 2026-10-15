import { RecipeError } from './recipes';

/** Reject unused query keys and duplicates so they cannot create unbounded cache keys. */
export function validateQuery(params: URLSearchParams, allowed: readonly string[]): void {
  const seen = new Set<string>();
  for (const [key] of params) {
    if (!allowed.includes(key) || seen.has(key)) {
      throw new RecipeError('Unknown or repeated recipe parameter.');
    }
    seen.add(key);
  }
}

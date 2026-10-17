export const DEFAULT_RUN_CONCURRENCY = 10;
export const MIN_RUN_CONCURRENCY = 1;
export const MAX_RUN_CONCURRENCY = 20;

export function normalizeRunConcurrency(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_RUN_CONCURRENCY;
  return Math.max(MIN_RUN_CONCURRENCY, Math.min(MAX_RUN_CONCURRENCY, parsed));
}

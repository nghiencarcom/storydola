import { setTimeout as delay } from "node:timers/promises";

export function providerRateLimitDelay(error: unknown, attempt: number) {
  const failure = error as { statusCode?: number; retryAfterMs?: number; message?: string };
  if (failure?.statusCode !== 429 || attempt >= 4) return undefined;
  const message = failure.message || "";
  if (/daily|tomorrow|insufficient|credits?|lack points|hạn mức|ngày mai|hết.*(?:điểm|tiền)/i.test(message)) return undefined;
  const seconds = message.match(/(?:sau|after)\s+(\d+)\s*(?:giây|seconds?|s\b)/i);
  return Math.max(5_000 * 2 ** attempt, failure.retryAfterMs || 0, seconds ? Number(seconds[1]) * 1000 : 0) + 250;
}

export async function providerRequestWithRetry<T>(signal: AbortSignal | undefined, request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await request(); }
    catch (error) {
      const wait = providerRateLimitDelay(error, attempt);
      if (wait === undefined) throw error;
      await delay(wait, undefined, { signal });
    }
  }
}

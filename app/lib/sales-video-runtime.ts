import { randomUUID } from "node:crypto";

type SalesVideoRuntime = typeof globalThis & { storyAiSalesVideoWorkerId?: string };
const runtime = globalThis as SalesVideoRuntime;
export const salesVideoWorkerId = runtime.storyAiSalesVideoWorkerId ??= randomUUID();

/** Submit immediately; the provider manages capacity and queuing. */
export function enqueueSalesVideoTask(task: () => Promise<void>) {
  return Promise.resolve().then(task);
}

export function enqueueSalesUgcDraftTask(task: () => Promise<void>) {
  return Promise.resolve().then(task);
}

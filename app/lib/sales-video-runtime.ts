import { randomUUID } from "node:crypto";

type SalesVideoRuntime = typeof globalThis & {
  storyAiSalesVideoWorkerId?: string;
  storyAiSalesVideoQueue?: TaskQueue;
  storyAiSalesUgcQueue?: TaskQueue;
};

type TaskQueue = {
  active: number;
  pending: Array<{ task: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void }>;
};

const runtime = globalThis as SalesVideoRuntime;

export const salesVideoWorkerId = runtime.storyAiSalesVideoWorkerId ??= randomUUID();

const videoQueue = runtime.storyAiSalesVideoQueue ??= { active: 0, pending: [] };
const ugcQueue = runtime.storyAiSalesUgcQueue ??= { active: 0, pending: [] };

function concurrencyLimit(variable: string) {
  const configured = Number(process.env[variable]);
  return Number.isFinite(configured) && configured > 0 ? Math.min(4, Math.floor(configured)) : 2;
}

function drainQueue(queue: TaskQueue, limit: string) {
  while (queue.active < concurrencyLimit(limit) && queue.pending.length) {
    const item = queue.pending.shift()!;
    queue.active += 1;
    void item.task().then(item.resolve, item.reject).finally(() => {
      queue.active = Math.max(0, queue.active - 1);
      drainQueue(queue, limit);
    });
  }
}

function enqueue(queue: TaskQueue, limit: string, task: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    queue.pending.push({ task, resolve, reject });
    drainQueue(queue, limit);
  });
}

/** Bound concurrent calls to video providers so queued projects do not overload the server. */
export function enqueueSalesVideoTask(task: () => Promise<void>) {
  return enqueue(videoQueue, "STORYAI_SALES_VIDEO_CONCURRENCY", task);
}

/** Keep prompt writing from blocking video-provider tasks; both queues process jobs concurrently. */
export function enqueueSalesUgcDraftTask(task: () => Promise<void>) {
  return enqueue(ugcQueue, "STORYAI_SALES_UGC_CONCURRENCY", task);
}

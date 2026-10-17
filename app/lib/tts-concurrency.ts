import { DEFAULT_RUN_CONCURRENCY } from "./run-concurrency-config";
import { getCurrentUserId } from "./auth-server";
import { getRunConcurrencyLimit } from "./user-settings";

type ProjectTtsSlots = {
  active: number;
  limit: number;
  waiters: Array<() => void>;
};

type TtsConcurrencyGlobal = typeof globalThis & {
  __storyAIProjectTtsSlots?: Map<string, ProjectTtsSlots>;
};

function projectSlots() {
  const globalWithSlots = globalThis as TtsConcurrencyGlobal;
  globalWithSlots.__storyAIProjectTtsSlots ||= new Map<string, ProjectTtsSlots>();
  return globalWithSlots.__storyAIProjectTtsSlots;
}

function wakeWaiters(state: ProjectTtsSlots) {
  while (state.waiters.length && state.active < state.limit) {
    state.active += 1;
    state.waiters.shift()?.();
  }
}

export async function withProjectTtsSlot<T>(projectSlug: string, task: () => Promise<T>): Promise<T> {
  let userId = "local";
  let limit = DEFAULT_RUN_CONCURRENCY;
  try {
    userId = await getCurrentUserId();
    limit = await getRunConcurrencyLimit(userId);
  } catch {
    // Keep TTS available to internal callers that do not have request headers.
  }
  const slots = projectSlots();
  const key = `${userId}:${projectSlug}`;
  const state = slots.get(key) || { active: 0, limit, waiters: [] };
  state.limit = limit;
  slots.set(key, state);
  wakeWaiters(state);

  if (state.active >= state.limit) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else {
    state.active += 1;
  }

  try {
    return await task();
  } finally {
    state.active = Math.max(0, state.active - 1);
    wakeWaiters(state);
    if (state.active === 0 && state.waiters.length === 0) slots.delete(key);
  }
}

export function refreshUserTtsConcurrency(userId: string, limit: number) {
  const slots = projectSlots();
  for (const [key, state] of slots) {
    if (!key.startsWith(`${userId}:`)) continue;
    state.limit = limit;
    wakeWaiters(state);
  }
}

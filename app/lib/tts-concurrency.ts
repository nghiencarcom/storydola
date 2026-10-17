type ProjectTtsSlots = {
  active: number;
  waiters: Array<() => void>;
};

type TtsConcurrencyGlobal = typeof globalThis & {
  __storyAIProjectTtsSlots?: Map<string, ProjectTtsSlots>;
};

const MAX_PARALLEL_TTS_PER_PROJECT = 5;

function projectSlots() {
  const globalWithSlots = globalThis as TtsConcurrencyGlobal;
  globalWithSlots.__storyAIProjectTtsSlots ||= new Map<string, ProjectTtsSlots>();
  return globalWithSlots.__storyAIProjectTtsSlots;
}

export async function withProjectTtsSlot<T>(projectSlug: string, task: () => Promise<T>): Promise<T> {
  const slots = projectSlots();
  const state = slots.get(projectSlug) || { active: 0, waiters: [] };
  slots.set(projectSlug, state);

  if (state.active >= MAX_PARALLEL_TTS_PER_PROJECT) {
    await new Promise<void>((resolve) => state.waiters.push(resolve));
  } else {
    state.active += 1;
  }

  try {
    return await task();
  } finally {
    const next = state.waiters.shift();
    if (next) next();
    else {
      state.active -= 1;
      if (state.active === 0) slots.delete(projectSlug);
    }
  }
}

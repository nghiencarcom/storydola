type TtsLockGlobal = typeof globalThis & { __storyAIActiveTtsProjects?: Set<string> };

function activeProjects() {
  const globalWithLock = globalThis as TtsLockGlobal;
  globalWithLock.__storyAIActiveTtsProjects ||= new Set<string>();
  return globalWithLock.__storyAIActiveTtsProjects;
}

export function claimProjectTts(slug: string, chunkId?: string) {
  const active = activeProjects();
  const key = chunkId ? `${slug}:${chunkId}` : slug;
  const projectIsActive = [...active].some((activeKey) => activeKey === slug || activeKey.startsWith(`${slug}:`));
  if (projectIsActive && (!chunkId || active.has(key) || active.has(slug))) return false;
  active.add(key);
  return true;
}

export function isProjectTtsActive(slug: string) {
  return [...activeProjects()].some((key) => key === slug || key.startsWith(`${slug}:`));
}

export function releaseProjectTts(slug: string, chunkId?: string) {
  activeProjects().delete(chunkId ? `${slug}:${chunkId}` : slug);
}

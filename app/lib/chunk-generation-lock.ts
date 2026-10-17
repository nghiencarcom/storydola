type ChunkRunGlobal = typeof globalThis & { __storyAIActiveChunkRuns?: Set<string> };

function activeProjects() {
  const globalWithRuns = globalThis as ChunkRunGlobal;
  globalWithRuns.__storyAIActiveChunkRuns ||= new Set<string>();
  return globalWithRuns.__storyAIActiveChunkRuns;
}

export function claimProjectChunkRun(slug: string) {
  const active = activeProjects();
  if (active.has(slug)) return false;
  active.add(slug);
  return true;
}

export function isProjectChunkRunActive(slug: string) {
  return activeProjects().has(slug);
}

export function releaseProjectChunkRun(slug: string) {
  activeProjects().delete(slug);
}

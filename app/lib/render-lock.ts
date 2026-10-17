type RenderLockGlobal = typeof globalThis & { __storyAIActiveRenderProjects?: Set<string> };

function activeProjects() {
  const globalWithLock = globalThis as RenderLockGlobal;
  globalWithLock.__storyAIActiveRenderProjects ||= new Set<string>();
  return globalWithLock.__storyAIActiveRenderProjects;
}

export function claimProjectRender(slug: string) {
  const active = activeProjects();
  if (active.has(slug)) return false;
  active.add(slug);
  return true;
}

export function isProjectRenderActive(slug: string) {
  return activeProjects().has(slug);
}

export function releaseProjectRender(slug: string) {
  activeProjects().delete(slug);
}

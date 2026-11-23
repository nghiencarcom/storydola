/** Reuse the account-scoped single-project API, preserving individual failures. */
export async function deleteSelectedProjects(slugs: string[], remove: (slug: string) => Promise<unknown>) {
  const deleted: string[] = [];
  const failed: Array<{ slug: string; message: string }> = [];
  for (const slug of [...new Set(slugs)]) {
    try { await remove(slug); deleted.push(slug); }
    catch (cause) { failed.push({ slug, message: cause instanceof Error ? cause.message : String(cause) }); }
  }
  return { deleted, failed };
}

import path from "node:path";

/**
 * All persistent StoryAI state lives beneath STORYAI_DATA_DIR. A relative value
 * is resolved from the project root, so `./data` follows the folder when it is
 * moved between the internal disk, an external drive, or Windows.
 */
const configuredDataDir = process.env.STORYAI_DATA_DIR?.trim() || "./data";

export const DATA_DIR = path.resolve(process.cwd(), configuredDataDir);

export function dataPath(...segments: string[]) {
  return path.join(DATA_DIR, ...segments);
}

export function relativeDataPath(...segments: string[]) {
  const relativeRoot = path.relative(process.cwd(), DATA_DIR) || ".";
  return path.join(relativeRoot, ...segments).split(path.sep).join("/");
}

/**
 * Resolves a stored data path (such as `data/media/...` or `../../data/media/...`)
 * into `DATA_DIR` regardless of whether the process runs from the repo root
 * or `.next/standalone`. Rejects traversal outside `DATA_DIR`.
 */
export function resolveStoredDataPath(localPath: string): string | undefined {
  const trimmed = String(localPath || "").trim();
  if (!trimmed) return undefined;
  const direct = path.resolve(process.cwd(), trimmed);
  if (direct === DATA_DIR || direct.startsWith(`${DATA_DIR}${path.sep}`)) return direct;
  const normalized = trimmed.replace(/\\/g, "/");
  const match = normalized.match(/^(?:(?:\.\.\/)+|\.?\/)?data(?:\/(.*))?$/);
  if (!match) return undefined;
  const candidate = path.resolve(DATA_DIR, match[1] || ".");
  return candidate === DATA_DIR || candidate.startsWith(`${DATA_DIR}${path.sep}`) ? candidate : undefined;
}

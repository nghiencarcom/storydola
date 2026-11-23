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

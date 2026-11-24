import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type State = { phase: "submitting" | "polling"; jobId?: string };
const context = new AsyncLocalStorage<string>();
export function withVideoCheckpoint<T>(file: string, task: () => Promise<T>) { return context.run(file, task); }
async function save(file: string, state: State) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
}
export async function videoCheckpoint() {
  const file = context.getStore();
  if (!file) return {};
  let state: State | undefined;
  try { state = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (state?.phase === "submitting" && !state.jobId) throw new Error("VIDEO_SUBMISSION_UNCERTAIN: cần đối soát job API trước khi gửi lại.");
  if (!state?.jobId) await save(file, { phase: "submitting" });
  return { existingJobId: state?.jobId, onJobCreated: async (jobId: string) => { if (!jobId.trim()) throw new Error("EMPTY_VIDEO_JOB_ID"); await save(file, { phase: "polling", jobId }); } };
}

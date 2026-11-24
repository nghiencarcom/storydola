import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./agent-access-store";
import { dataPath } from "./data-directory";
import { saveSalesVideoProject, salesVideoOwnerDirectory } from "./sales-video-storage";
import type { SalesVideoProject } from "./sales-video-storage";
import type { SalesVideoRenderInput } from "./sales-video-creative";
const directory = dataPath("sales-video-recovery");
const active = new Set<string>();
async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
async function encode(input: SalesVideoRenderInput) {
  const { signal: _signal, audio, video, ...plain } = input;
  const file = async (value?: File) => value ? { name: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()).toString("base64") } : undefined;
  return encrypt(JSON.stringify({ ...plain, audio: await file(audio), video: await file(video) }));
}
function decode(value: ReturnType<typeof encrypt>): SalesVideoRenderInput {
  const input = JSON.parse(decrypt(value));
  for (const key of ["audio", "video"]) if (input[key]) input[key] = new File([Buffer.from(input[key].bytes, "base64")], input[key].name, { type: input[key].type });
  return { ...input, signal: AbortSignal.timeout(60 * 60_000) };
}
type Render = (input: SalesVideoRenderInput) => Promise<Array<{ start: number; duration: number; prompt: string }>>;
export async function durableSalesVideo(input: SalesVideoRenderInput, render: Render) {
  const key = `${input.userId}-${input.id}-${input.onlySegmentIndex ?? "all"}`;
  if (active.has(key)) throw new Error("VIDEO_JOB_ALREADY_RUNNING");
  active.add(key);
  const file = path.join(directory, `${input.id}-${input.onlySegmentIndex ?? "all"}.json`);
  try {
    let record;
    try { record = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // A user retry is a new attempt. Only recovery inputs carry the run ID
    // that permits resuming the saved provider job and its original model.
    if (!record || record.state === "complete" || (input.onlySegmentIndex !== undefined && !input.recoveryRunId)) {
      record = { state: "pending", input: await encode({ ...input, recoveryRunId: randomUUID() }) };
      await atomic(file, record);
    }
    const result = await render(decode(record.input));
    await atomic(file, { ...record, state: "complete", result });
    return result;
  } finally { active.delete(key); }
}
export async function recoverSalesVideos() {
  const { createCreativeSalesVideo } = await import("./sales-video-creative");
  const files = await readdir(directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  await Promise.allSettled(files.filter(file => file.endsWith(".json")).map(async file => {
    const record = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    if (record.state !== "pending" && record.state !== "complete") return;
    const input = decode(record.input);
    try {
      const projectFileBefore = path.join(salesVideoOwnerDirectory(input.userId), "projects", `${input.id}.json`);
      const before = JSON.parse(await readFile(projectFileBefore, "utf8")) as SalesVideoProject;
      if (record.state === "complete" && before.status !== "processing") return;
      const segments = record.state === "complete" ? record.result as Awaited<ReturnType<Render>> : await createCreativeSalesVideo(input);
      const projectFile = path.join(salesVideoOwnerDirectory(input.userId), "projects", `${input.id}.json`);
      const project = JSON.parse(await readFile(projectFile, "utf8")) as SalesVideoProject;
      if (input.onlySegmentIndex === undefined) {
        await saveSalesVideoProject(input.userId, { ...project, status: "ready", phase: undefined, worker: undefined, error: undefined,
          details: project.details ? { ...project.details, generatedSegments: segments, segmentResults: segments.map(segment => ({ start: segment.start, duration: segment.duration, status: "ready" })), needsStitching: false } : undefined });
      } else if (project.details) {
        await saveSalesVideoProject(input.userId, { ...project, status: "ready", phase: undefined, worker: undefined, error: undefined,
          details: { ...project.details, needsStitching: true, segmentResults: project.details.segmentResults?.map((segment, index) => index === input.onlySegmentIndex ? { ...segment, status: "ready", error: undefined } : segment) } });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không khôi phục được video.";
      console.error("Sales video recovery requires attention", input.id, message);
      const projectFile = path.join(salesVideoOwnerDirectory(input.userId), "projects", `${input.id}.json`);
      const project = JSON.parse(await readFile(projectFile, "utf8")) as SalesVideoProject;
      await saveSalesVideoProject(input.userId, { ...project, status: "failed", phase: undefined, worker: undefined, error: `Khôi phục job API: ${message}` });
    }
  }));
}

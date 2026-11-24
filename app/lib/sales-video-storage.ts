import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "./data-directory";

export function salesVideoOwnerDirectory(userId: string) {
  return dataPath("media", "sales-video", createHash("sha256").update(userId).digest("hex"));
}

export function salesVideoPath(userId: string, id: string) {
  return path.join(salesVideoOwnerDirectory(userId), id, "video.mp4");
}

export function salesVideoSegmentPath(userId: string, id: string, index: number) {
  return path.join(salesVideoOwnerDirectory(userId), id, "segments", `clip-${index + 1}.mp4`);
}

export function salesVideoReferencePath(userId: string, id: string, kind: "presenter" | "product", index = 0) {
  const suffix = kind === "product" && index > 0 ? `-${index + 1}` : "";
  return path.join(salesVideoOwnerDirectory(userId), id, "references", `${kind}${suffix}.webp`);
}

export type SalesVideoProjectDetails = {
  templateId?: string;
  product?: string;
  productUrl?: string;
  facts?: string;
  userExperience?: string;
  painPoint?: string;
  heroBenefit?: string;
  minorFlaw?: string;
  targetAudience?: string;
  hookStyle?: string;
  prompt?: string;
  promptSegments?: Array<{ start: number; duration: number; prompt: string }>;
  script?: string;
  scriptSegments?: Array<{ start: number; duration: number; script: string }>;
  subtitleSrt?: string;
  language?: string;
  duration?: number;
  ratio?: string;
  videoModelId?: string;
  promptMaxLength?: number;
  claimCategory?: string;
  audio?: boolean;
  references?: { presenter?: string; product?: string; primaryProduct?: string; additionalProducts?: string[]; products?: string[] };
  productImageCount?: number;
  additionalProductImageCount?: number;
  codingAgent?: string;
  codingModel?: string;
  codingQuality?: string;
  codingSpeed?: string;
  generatedSegments?: Array<{ start: number; duration: number; prompt: string }>;
  segmentResults?: Array<{ start: number; duration: number; status: "pending" | "processing" | "ready" | "failed"; error?: string }>;
  needsStitching?: boolean;
};

export type SalesVideoProject = {
  id: string;
  title: string;
  template: string;
  model: string;
  createdAt: string;
  status: "processing" | "draft" | "ready" | "failed";
  phase?: "writing" | "review" | "generating";
  worker?: string;
  error?: string;
  details?: SalesVideoProjectDetails;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export async function saveSalesVideoProject(userId: string, project: SalesVideoProject) {
  const directory = path.join(salesVideoOwnerDirectory(userId), "projects");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, project.id + ".json");
  await writeFile(file + ".tmp", JSON.stringify(project), { mode: 0o600 });
  await rename(file + ".tmp", file);
}

export async function deleteSalesVideoProject(userId: string, id: string) {
  const ownerDirectory = salesVideoOwnerDirectory(userId);
  await rm(path.join(ownerDirectory, "projects", `${id}.json.tmp`), { force: true });
  await rm(path.join(ownerDirectory, id), { recursive: true, force: true });
  await rm(path.join(ownerDirectory, "projects", `${id}.json`), { force: true });
}

export async function listSalesVideoProjects(userId: string, worker: string) {
  const directory = salesVideoOwnerDirectory(userId);
  const records = path.join(directory, "projects");
  const projects = new Map<string, SalesVideoProject>();
  for (const file of await readdir(records).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (!file.endsWith(".json") || !uuid.test(file.slice(0, -5))) continue;
    const project = JSON.parse(await readFile(path.join(records, file), "utf8")) as SalesVideoProject;
    if (project.status === "processing" && project.worker !== worker) {
      const output = await stat(salesVideoPath(userId, project.id)).catch(() => null);
      project.status = output?.isFile() ? "ready" : "failed";
      if (project.status === "failed") project.error = "Máy chủ đã khởi động lại trong lúc tạo video. Hãy tạo lượt mới.";
      if (project.details?.segmentResults?.some((segment) => segment.status === "processing")) {
        project.details.segmentResults = project.details.segmentResults.map((segment) => segment.status === "processing"
          ? { ...segment, status: "failed" as const, error: "Tác vụ bị gián đoạn. Hãy tạo lại clip này." }
          : segment);
        project.details.needsStitching = true;
      }
      delete project.worker;
      await saveSalesVideoProject(userId, project);
    }
    delete project.worker;
    projects.set(project.id, project);
  }
  // Include MP4s created before project history was introduced.
  for (const id of await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (!uuid.test(id) || projects.has(id)) continue;
    const video = await stat(salesVideoPath(userId, id)).catch(() => null);
    if (video?.isFile()) {
      const recovered: SalesVideoProject = { id, title: "Video bán hàng", template: "", model: "", createdAt: video.mtime.toISOString(), status: "ready" };
      projects.set(id, recovered);
      await saveSalesVideoProject(userId, recovered).catch(() => undefined);
    }
  }
  return [...projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

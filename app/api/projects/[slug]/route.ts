import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { isProjectChunkRunActive } from "../../../lib/chunk-generation-lock";
import { isProjectRenderActive } from "../../../lib/render-lock";
import { isProjectTtsActive } from "../../../lib/tts-lock";
import { makeActivity, readData, updateData, updateProjectRecord } from "../../../lib/server-store";
import { normalizeProjectChunkSize } from "../../../lib/project-types";
import type { DramaProjectPlan, ProjectCharacter, ProjectLocation, StoryProject, UpdateProjectInput } from "../../../lib/project-types";
import { normalizeDramaPlan } from "../../../lib/drama-plan";
import { dataPath } from "../../../lib/data-directory";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({ project, activities: data.activities.filter((item) => item.projectSlug === slug).slice(0, 80) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const rawBody = (await request.json().catch(() => ({}))) as UpdateProjectInput & { silent?: boolean };
  const { silent, ...body } = rawBody;
  try {
    const project = await updateData((data) => {
      const index = data.projects.findIndex((item) => item.slug === slug);
      if (index < 0) throw new Error("PROJECT_NOT_FOUND");
      const before = data.projects[index];
      if (body.presetId !== undefined && body.presetId !== before.presetId) throw new Error("PROJECT_PRESET_IMMUTABLE");
      let plan: DramaProjectPlan | undefined;
      if (body.dramaPlan !== undefined) {
        if (before.presetId !== "ai-drama") throw new Error("DRAMA_PLAN_PROJECT_REQUIRED");
        try {
          const durationChanged = body.durationMinutes !== undefined && body.durationMinutes !== before.durationMinutes;
          const chunkSizeChanged = body.chunkSize !== undefined && normalizeProjectChunkSize(body.chunkSize) !== before.chunkSize;
          const durationMinutes = Math.max(1, Number(body.durationMinutes ?? before.durationMinutes) || 60);
          const chunkSize = normalizeProjectChunkSize(body.chunkSize ?? before.chunkSize);
          const expectedEpisodes = !durationChanged && !chunkSizeChanged && before.chunks.length > 0
            ? before.chunks.length
            : Math.ceil(Math.ceil(durationMinutes * 4) / chunkSize);
          plan = normalizeDramaPlan(body.dramaPlan, expectedEpisodes);
        } catch (cause) {
          throw new Error(`DRAMA_PLAN_INVALID:${cause instanceof Error ? cause.message : "Kế hoạch Phim AI không hợp lệ."}`);
        }
      }
      const updated = updateProjectRecord(before, { ...body, ...(plan ? { dramaPlan: plan } : {}) });
      if (plan) {
        const timestamp = new Date().toISOString();
        const stableKey = (value: string) => value.trim().toLocaleLowerCase();
        const matchingCharacter = (name: string) => before.characters?.find((item) => stableKey(item.name) === stableKey(name));
        const matchingLocation = (name: string) => before.locations?.find((item) => stableKey(item.name) === stableKey(name));
        updated.videoTitle = plan.videoTitle;
        updated.dramaPlan = plan;
        updated.chunks = updated.chunks.map((chunk, chunkIndex) => ({ ...chunk, title: plan!.episodes[chunkIndex]?.title || chunk.id }));
        updated.characters = plan.characters.map((character, characterIndex): ProjectCharacter => {
          const current = matchingCharacter(character.name);
          const preserveReference = Boolean(current && current.description === character.description && current.imagePrompt === character.imagePrompt);
          return {
            id: preserveReference && current ? current.id : `char-ai-${characterIndex + 1}-${randomUUID()}`,
            name: character.name,
            description: character.description,
            imagePrompt: character.imagePrompt,
            referenceImagePath: preserveReference ? current?.referenceImagePath || "" : "",
            referenceImageName: preserveReference ? current?.referenceImageName || "" : "",
            referenceImageMimeType: preserveReference ? current?.referenceImageMimeType || "" : "",
            voiceId: current?.voiceId || before.voiceId || "",
            voiceName: current?.voiceName || before.voiceName || "",
            voiceLanguage: current?.voiceLanguage || before.voiceLanguage || before.language,
            createdAt: preserveReference && current ? current.createdAt : timestamp,
            updatedAt: timestamp,
          };
        });
        updated.locations = plan.locations.map((location, locationIndex): ProjectLocation => {
          const current = matchingLocation(location.name);
          const preserveReference = Boolean(current && current.description === location.description && current.imagePrompt === location.imagePrompt);
          return {
            id: preserveReference && current ? current.id : `loc-ai-${locationIndex + 1}-${randomUUID()}`,
            name: location.name,
            aliases: preserveReference ? current?.aliases : undefined,
            description: location.description,
            imagePrompt: location.imagePrompt,
            referenceImagePath: preserveReference ? current?.referenceImagePath || "" : "",
            referenceImageName: preserveReference ? current?.referenceImageName || "" : "",
            referenceImageMimeType: preserveReference ? current?.referenceImageMimeType || "" : "",
            ...(preserveReference && current?.imageGeneration ? { imageGeneration: current.imageGeneration } : {}),
            createdAt: preserveReference && current ? current.createdAt : timestamp,
            updatedAt: timestamp,
          };
        });
      }
      data.projects[index] = updated;
      if (silent !== true) {
        data.activities.unshift(makeActivity({ projectSlug: slug, kind: "project", title: "Project đã được cập nhật", detail: "Cấu hình và nguồn đầu vào đã được lưu.", status: "success" }));
      }
      return updated;
    });
    return NextResponse.json({ project });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "PROJECT_NOT_FOUND") return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
    if (cause instanceof Error && cause.message === "PROJECT_PRESET_IMMUTABLE") return NextResponse.json({ message: "Loại dự án được cố định khi tạo. Hãy tạo một dự án mới trong luồng Phim AI, AI Story hoặc Audio Story tương ứng." }, { status: 409 });
    if (cause instanceof Error && cause.message === "DRAMA_PLAN_PROJECT_REQUIRED") return NextResponse.json({ message: "Chỉ project Phim AI mới nhận được kế hoạch kịch bản nguồn." }, { status: 400 });
    if (cause instanceof Error && cause.message.startsWith("DRAMA_PLAN_INVALID:")) return NextResponse.json({ message: cause.message.slice("DRAMA_PLAN_INVALID:".length) }, { status: 400 });
    return NextResponse.json({ message: "Không thể cập nhật project." }, { status: 500 });
  }
}

function projectHasRunningTasks(project: StoryProject) {
  return Boolean(project.sceneMediaJobs?.some(job => job.status === "queued" || job.status === "running"))
    || Boolean(project.locations?.some(location => location.imageGeneration?.status === "queued" || location.imageGeneration?.status === "running"))
    || project.chunks.some((chunk) => chunk.status === "processing" || chunk.render?.status === "running" || chunk.tts?.status === "running")
    || project.render?.status === "running"
    || project.videoQueue?.status === "running"
    || project.videoQueue?.jobs.some((job) => job.status === "running");
}

function projectTaskIsActive(project: StoryProject) {
  return projectHasRunningTasks(project)
    || isProjectChunkRunActive(project.slug)
    || isProjectRenderActive(project.slug)
    || isProjectTtsActive(project.slug);
}

async function removeProjectArtifacts(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("PROJECT_SLUG_INVALID");
  const uploadSlug = slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
  const audioSlug = slug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "project";
  const projectDirs = [
    ["outputs", slug],
    ["renders", slug],
    ["media", slug],
    ["audio", audioSlug],
    ["uploads", uploadSlug],
  ] as const;
  await Promise.all(projectDirs.map(async ([rootName, directoryName]) => {
    const root = dataPath(rootName);
    const target = path.resolve(root, directoryName);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("PROJECT_ARTIFACT_PATH_INVALID");
    await rm(target, { recursive: true, force: true });
  }));
}

export async function DELETE(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  const existing = snapshot.projects.find((item) => item.slug === slug);
  if (!existing) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (projectTaskIsActive(existing)) {
    return NextResponse.json({ message: "Project đang chạy tác vụ. Hãy đợi các tác vụ hoàn tất rồi xóa." }, { status: 409 });
  }

  let removed: StoryProject;
  try {
    removed = await updateData((data) => {
      const index = data.projects.findIndex((item) => item.slug === slug);
      if (index < 0) throw new Error("PROJECT_NOT_FOUND");
      const project = data.projects[index];
      if (projectTaskIsActive(project)) throw new Error("PROJECT_BUSY");
      data.projects.splice(index, 1);
      data.activities = data.activities.filter((activity) => activity.projectSlug !== slug);
      return project;
    });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "PROJECT_DELETE_FAILED";
    if (code === "PROJECT_NOT_FOUND") return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
    if (code === "PROJECT_BUSY") return NextResponse.json({ message: "Project đang chạy tác vụ. Hãy đợi các tác vụ hoàn tất rồi xóa." }, { status: 409 });
    return NextResponse.json({ message: "Không thể xóa project." }, { status: 500 });
  }

  try {
    await removeProjectArtifacts(removed.slug);
  } catch (cause) {
    console.error("Project artifacts cleanup failed", removed.slug, cause);
  }
  return NextResponse.json({ ok: true });
}

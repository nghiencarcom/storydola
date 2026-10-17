import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isProjectChunkRunActive } from "../../../lib/chunk-generation-lock";
import { isProjectRenderActive } from "../../../lib/render-lock";
import { isProjectTtsActive } from "../../../lib/tts-lock";
import { makeActivity, readData, updateData, updateProjectRecord } from "../../../lib/server-store";
import type { StoryProject, UpdateProjectInput } from "../../../lib/project-types";

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
  const body = (await request.json().catch(() => ({}))) as UpdateProjectInput;
  try {
    const project = await updateData((data) => {
      const index = data.projects.findIndex((item) => item.slug === slug);
      if (index < 0) throw new Error("PROJECT_NOT_FOUND");
      const before = data.projects[index];
      if (body.presetId !== undefined && body.presetId !== before.presetId) throw new Error("PROJECT_PRESET_IMMUTABLE");
      const updated = updateProjectRecord(before, body);
      data.projects[index] = updated;
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "project", title: "Project đã được cập nhật", detail: "Cấu hình và nguồn đầu vào đã được lưu.", status: "success" }));
      return updated;
    });
    return NextResponse.json({ project });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "PROJECT_NOT_FOUND") return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
    if (cause instanceof Error && cause.message === "PROJECT_PRESET_IMMUTABLE") return NextResponse.json({ message: "Loại dự án được cố định khi tạo. Hãy tạo một dự án mới trong luồng AI Drama, AI Story hoặc Audio Story tương ứng." }, { status: 409 });
    return NextResponse.json({ message: "Không thể cập nhật project." }, { status: 500 });
  }
}

function projectHasRunningTasks(project: StoryProject) {
  return project.chunks.some((chunk) => chunk.status === "processing" || chunk.render?.status === "running" || chunk.tts?.status === "running")
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
    const root = path.resolve(process.cwd(), "data", rootName);
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

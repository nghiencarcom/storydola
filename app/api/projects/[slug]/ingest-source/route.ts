import { NextResponse } from "next/server";
import { ingestSourceUrl } from "../../../../lib/source-ingest";
import { getProjectOrThrow, makeActivity, now, readData, updateData, updateProjectRecord } from "../../../../lib/server-store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  let project;
  try { project = getProjectOrThrow(snapshot, slug); } catch { return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 }); }
  if (!project.sourceUrl.trim()) return NextResponse.json({ code: "SOURCE_URL_REQUIRED", message: "Hãy nhập link YouTube trước khi lấy transcript." }, { status: 400 });
  if (project.sourceText.trim()) return NextResponse.json({ ok: true, skipped: true, project, source: { text: project.sourceText, sourceUrl: project.sourceUrl } });

  try {
    const source = await ingestSourceUrl(project.sourceUrl);
    const updated = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      const next = updateProjectRecord(current, { sourceText: source.text });
      const index = data.projects.findIndex((item) => item.slug === slug);
      if (index >= 0) data.projects[index] = next;
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "source", title: "Đã lấy transcript tự động", detail: `${source.platform || "video"} · ${source.text.length.toLocaleString("vi-VN")} ký tự`, status: "success" }));
      return next;
    });
    return NextResponse.json({ ok: true, project: updated, source });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không lấy được transcript.";
    await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      current.updatedAt = now();
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "source", title: "Lấy transcript thất bại", detail: message, status: "error" }));
    });
    return NextResponse.json({ code: cause instanceof Error ? cause.name : "SOURCE_INGEST_FAILED", message }, { status: 502 });
  }
}

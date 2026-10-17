import { NextResponse } from "next/server";
import { buildContinuityQaReport } from "../../../../lib/continuity-qa";
import { getProjectOrThrow, makeActivity, now, readData, updateData } from "../../../../lib/server-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  return NextResponse.json({ report: project.continuityQa || null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const snapshot = await readData();
  const project = snapshot.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  try {
    const report = await buildContinuityQaReport(project);
    const updated = await updateData((data) => {
      const current = getProjectOrThrow(data, slug);
      current.continuityQa = report;
      current.updatedAt = now();
      data.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "qa",
        title: "Continuity QA hoàn tất",
        detail: `${report.score}/100 · ${report.issueCount} điểm cần kiểm tra · ${report.sceneCount}/${report.expectedSceneCount} cảnh`,
        status: report.status === "passed" ? "success" : "warning",
      }));
      return current;
    });
    return NextResponse.json({ ok: true, report, project: updated });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Không thể chạy continuity QA.";
    return NextResponse.json({ code: "CONTINUITY_QA_FAILED", message }, { status: 500 });
  }
}

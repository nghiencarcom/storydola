import { after, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { getOmniVoiceCatalog } from "../../../../lib/omnivoice-server";
import { readMaiVideoAuthCookie } from "../../../../lib/maivideo-auth-shared";
import { salesVideoPath, listSalesVideoProjects, saveSalesVideoProject, type SalesVideoProject } from "../../../../lib/sales-video-storage";
import { enqueueSalesVideoTask, salesVideoWorkerId } from "../../../../lib/sales-video-runtime";
import { regenerateSalesVideoVoice } from "../../../../lib/sales-video-voice";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = request.headers.get("x-storyai-user-id")?.trim();
  if (!userId || !readMaiVideoAuthCookie(request.headers.get("cookie") || "")) {
    return NextResponse.json({ message: "Vui lòng đăng nhập MaiVideo." }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ message: "Project không hợp lệ." }, { status: 404 });
  const project = (await listSalesVideoProjects(userId, salesVideoWorkerId)).find((item) => item.id === id);
  if (!project?.details) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });
  if (project.status !== "ready" || !project.details.audio || !project.details.subtitleSrt?.trim()) {
    return NextResponse.json({ message: "Chỉ tạo lại voice được khi video đã ghép và có phụ đề SRT." }, { status: 409 });
  }
  if (project.details.voiceRegeneration?.status === "processing") {
    return NextResponse.json({ message: "Voice của project đang được tạo lại." }, { status: 409 });
  }
  if (!await stat(salesVideoPath(userId, id)).then((value) => value.isFile()).catch(() => false)) {
    return NextResponse.json({ message: "Chưa tìm thấy video đã ghép. Hãy ghép video trước." }, { status: 409 });
  }
  const body = await request.json().catch(() => null) as { voiceId?: unknown } | null;
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  if (!voiceId || voiceId.length > 200) return NextResponse.json({ message: "Chọn một giọng MaiVideo hợp lệ." }, { status: 400 });
  const catalog = await getOmniVoiceCatalog().catch((error) => ({ voices: [], error }));
  if (!catalog.voices.length) {
    const error = "error" in catalog && catalog.error instanceof Error ? catalog.error.message : "Không tải được danh sách giọng MaiVideo.";
    return NextResponse.json({ message: error }, { status: 503 });
  }
  const voice = catalog.voices.find((item) => item.id === voiceId);
  if (!voice) return NextResponse.json({ message: "Giọng đã chọn không còn trong danh sách MaiVideo. Hãy tải lại danh sách." }, { status: 400 });

  const startedAt = new Date().toISOString();
  const working: SalesVideoProject = {
    ...project,
    worker: salesVideoWorkerId,
    details: {
      ...project.details,
      voiceRegeneration: { status: "processing", voiceId, voiceName: voice.name, updatedAt: startedAt },
    },
  };
  await saveSalesVideoProject(userId, working);
  after(async () => {
    await enqueueSalesVideoTask(async () => {
      try {
        await regenerateSalesVideoVoice({
          userId,
          projectId: id,
          srt: project.details!.subtitleSrt!,
          duration: project.details!.duration || 15,
          language: project.details!.language || "Tiếng Việt",
          voiceId,
          signal: AbortSignal.timeout(30 * 60_000),
        });
        await saveSalesVideoProject(userId, {
          ...working,
          worker: undefined,
          details: { ...working.details!, voiceRegeneration: { status: "ready", voiceId, voiceName: voice.name, updatedAt: new Date().toISOString() } },
        });
      } catch (error) {
        await saveSalesVideoProject(userId, {
          ...working,
          worker: undefined,
          details: {
            ...working.details!,
            voiceRegeneration: {
              status: "failed", voiceId, voiceName: voice.name, updatedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message.slice(0, 300) : "Không tạo được voice mới.",
            },
          },
        });
      }
    });
  });
  return NextResponse.json({ project: working }, { status: 202 });
}

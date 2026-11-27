import { after, NextResponse } from "next/server";
import { getCurrentUserId } from "../../lib/auth-server";
import { getCodingAgentCliStatuses } from "../../lib/coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "../../lib/coding-agent-preferences";
import { readDataForUser } from "../../lib/server-store";
import { remakeInputSchema } from "../../lib/video-remake";
import { createRemakeProject } from "../../lib/video-remake-project";
import { addRemakeJob, deleteRemakeJob, getRemakeJob, linkRemakeProject, listRemakeJobs, maxQueuedRemakeJobsPerUser, retryRemakeJob, runRemakeQueue } from "../../lib/video-remake-worker";

export const runtime = "nodejs";

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function wakeQueue() {
  after(() => runRemakeQueue().catch((error) => console.error("[video-remake] Queue failed", error)));
}

async function configuredAgent(owner: string): Promise<CodingAgentPreference | undefined> {
  const [preference, statuses] = await Promise.all([getCodingAgentPreference(owner), getCodingAgentCliStatuses({ includeModels: false })]);
  return preference && statuses.some(({ id, available }) => id === preference.agent && available) ? preference : undefined;
}

export async function GET(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    const [jobs, data] = await Promise.all([listRemakeJobs(owner), readDataForUser(owner)]);
    const existingSlugs = new Set(data.projects.map((project) => project.slug));
    const sanitizedJobs = jobs.map((entry) => {
      if (entry.projectSlug && !existingSlugs.has(entry.projectSlug)) {
        return { ...entry, projectSlug: undefined };
      }
      return entry;
    });
    if (sanitizedJobs.some(({ status }) => status === "queued" || status === "reading" || status === "analyzing")) {
      wakeQueue();
    }
    return respond({ jobs: sanitizedJobs });
  }
  const [job, data] = await Promise.all([getRemakeJob(owner, id), readDataForUser(owner)]);
  if (!job) return respond({ message: "Không tìm thấy job remake." }, 404);
  if (job.status === "queued" || job.status === "reading" || job.status === "analyzing") {
    wakeQueue();
  }
  if (job.projectSlug && !data.projects.some((project) => project.slug === job.projectSlug)) {
    await linkRemakeProject(owner, job, undefined);
    return respond({ job: { ...job, projectSlug: undefined } });
  }
  return respond({ job });
}

export async function POST(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const parsed = remakeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ message: "Kiểm tra link HTTPS, thời lượng cảnh, ngôn ngữ và độ dài nội dung nhập." }, 400);
  const agent = await configuredAgent(owner);
  if (!agent) return respond({ message: "Hãy chọn và kết nối Code Agent CLI trong Cài đặt để phân tích khung hình." }, 503);
  const id = await addRemakeJob(owner, parsed.data, agent);
  if (!id) return respond({ message: `Bạn đang có ${maxQueuedRemakeJobsPerUser} job remake trong hàng đợi. Hãy đợi một job hoàn tất.` }, 409);
  wakeQueue();
  return respond({ id }, 202);
}

export async function PATCH(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "string" || !body.id.trim()) return respond({ message: "Thiếu mã job remake." }, 400);
  if (body.action === "delete") {
    const status = await deleteRemakeJob(owner, body.id);
    if (status === "missing") return respond({ message: "Không tìm thấy job remake." }, 404);
    wakeQueue();
    return respond({ ok: true });
  }
  if (body.action === "retry") {
    const agent = await configuredAgent(owner);
    if (!agent) return respond({ message: "Hãy chọn và kết nối Code Agent CLI trong Cài đặt để phân tích khung hình." }, 503);
    const status = await retryRemakeJob(owner, body.id, agent);
    if (status === "missing") return respond({ message: "Không tìm thấy job remake." }, 404);
    if (status !== "queued") return respond({ message: "Job chưa thể thử lại hoặc hàng đợi đã đầy." }, 409);
    wakeQueue();
    return respond({ ok: true }, 202);
  }
  if (body.action === "create-project") {
    const [job, data] = await Promise.all([getRemakeJob(owner, body.id), readDataForUser(owner)]);
    if (!job) return respond({ message: "Không tìm thấy job remake." }, 404);
    if (job.status !== "ready" || !job.result) return respond({ message: "Bản remake chưa sẵn sàng." }, 409);
    if (job.projectSlug && data.projects.some((project) => project.slug === job.projectSlug)) {
      return respond({ slug: job.projectSlug });
    }
    try {
      const slug = await createRemakeProject(owner, { ...job, result: job.result });
      await linkRemakeProject(owner, job, slug);
      return respond({ slug });
    } catch (error) {
      console.error("[video-remake] Project import failed", error);
      return respond({ message: "Chưa lưu được dự án Phim AI. Bạn có thể thử lại từ bản nháp đã lưu." }, 500);
    }
  }
  return respond({ message: "Tác vụ remake không hợp lệ." }, 400);
}

export async function DELETE(request: Request) {
  const owner = await getCurrentUserId().catch(() => null);
  if (!owner) return respond({ message: "Vui lòng đăng nhập lại." }, 401);
  const queryId = new URL(request.url).searchParams.get("id");
  const bodyId = queryId ? undefined : (await request.json().catch(() => null))?.id;
  const id = typeof queryId === "string" && queryId.trim()
    ? queryId.trim()
    : typeof bodyId === "string" && bodyId.trim()
      ? bodyId.trim()
      : "";
  if (!id) return respond({ message: "Thiếu mã job remake." }, 400);
  const status = await deleteRemakeJob(owner, id);
  if (status === "missing") return respond({ message: "Không tìm thấy job remake." }, 404);
  wakeQueue();
  return respond({ ok: true });
}

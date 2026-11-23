import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "../../../../lib/auth-server";
import {
  salesVideoLanguages, salesVideoProductInstruction, salesVideoRatios, salesVideoTemplates, salesVideoMaxWordCount, salesVideoWordCount,
  salesVideoContentStyleGuidance, salesVideoClaimGuidance, salesVideoProductScriptInstruction,
} from "../../../../lib/sales-video-templates";

const inputSchema = z.object({
  url: z.string().trim().max(2000).url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }),
  template: z.string().refine((id) => salesVideoTemplates.some((item) => item.id === id)),
  product: z.string().trim().max(5000),
  facts: z.string().trim().max(1000),
  language: z.enum(salesVideoLanguages),
  ratio: z.enum(salesVideoRatios),
  seconds: z.number().int().min(5).max(30),
  model: z.string().max(200),
  audio: z.boolean(),
  contentStyle: z.enum(["problem-solution", "review", "how-to", "before-buy", "after-buy", "comparison"]).default("problem-solution"),
  claimCategory: z.enum(["general", "health", "finance"]).default("general"),
});

const outputSchema = z.object({
  id: z.uuid(),
  product: z.string().trim().max(5000),
  facts: z.string().trim().max(1000),
  prompt: z.string().trim().max(2500),
  script: z.string().trim().max(2000),
  sourceUnavailable: z.boolean().default(false),
});

type Job = {
  id: string;
  expiresAt: number;
  input: z.infer<typeof inputSchema>;
  result?: z.infer<typeof outputSchema>;
};

const runtimeState = globalThis as typeof globalThis & { storyaiSalesUgcJobs?: Map<string, Job> };
const jobs = runtimeState.storyaiSalesUgcJobs ??= new Map<string, Job>();

function buildUgcPrompt(job: Job, result: z.infer<typeof outputSchema>) {
  const seconds = job.input.seconds;
  const maxWords = salesVideoMaxWordCount(seconds, job.input.language);
  const hookEnd = Math.max(2, Math.round(seconds * 0.2));
  const demoEnd = Math.min(seconds - 1, Math.max(hookEnd + 1, Math.round(seconds * 0.8)));
  const authored = result.prompt.trim().startsWith(salesVideoProductInstruction)
    ? result.prompt.trim().slice(salesVideoProductInstruction.length).trim()
    : result.prompt.trim();
  const template = salesVideoTemplates.find(({ id }) => id === job.input.template);
  const facts = result.facts.trim() || job.input.facts.trim();
  const guidance = [
    salesVideoProductInstruction,
    `MỤC TIÊU: Quảng cáo UGC chân thực dài ${seconds} giây, khung hình ${job.input.ratio}, cho ${JSON.stringify(result.product || job.input.product)}. Ngành hàng: ${template?.name || "sản phẩm"}. ${template?.direction || ""}`,
    `KIỂU NỘI DUNG: ${salesVideoContentStyleGuidance(job.input.contentStyle)}`,
    salesVideoClaimGuidance(job.input.claimCategory, job.input.template),
    `NHỊP CẢNH: 0–${hookEnd}s mở bằng hook có hành động hoặc biểu cảm tự nhiên; ${hookEnd}–${demoEnd}s trình diễn rõ một thao tác thật với sản phẩm; ${demoEnd}–${seconds}s chốt bằng khung hình sản phẩm dễ nhận diện và lời kêu gọi nhẹ nhàng. Mô tả cỡ cảnh, hành động, hướng nhìn và chuyển động máy cho từng nhịp; lấp đầy thời lượng, không tua nhanh hay đổi cảnh vô cớ.`,
    "TÍNH LIÊN TỤC: Giữ cùng một người, quần áo, sản phẩm, bối cảnh, ánh sáng và hướng máy xuyên suốt. Chỉ một sản phẩm đúng ảnh tham chiếu; thao tác tay tự nhiên, không làm méo nhãn hoặc chữ. Phong cách video điện thoại đời thường, ánh sáng thật, chuyển động máy nhẹ và ổn định.",
    job.input.audio
      ? `GIỌNG VÀ LỜI THOẠI: Đây là đối thoại UGC 2 vai: người hỏi ở ngoài khung hình, người trả lời là nhân vật tham chiếu. Nói bằng ${job.input.language}, tự nhiên, không đọc kiểu quảng cáo. Nhãn vai trong script chỉ là cue, không đọc thành tiếng; dùng hai giọng riêng nếu model hỗ trợ. ${salesVideoProductScriptInstruction(result.script, job.input.language, true)} ${maxWords === null ? "Không áp trần tốc độ từ/giây tiếng Việt; ưu tiên câu nói tự nhiên, dễ nghe." : `Lời thoại không vượt ${maxWords} từ cho ${seconds} giây.`}`
      : "ÂM THANH: Không lời thoại, không giọng đọc, không nhép miệng; chỉ dùng hành động và hình ảnh để kể chuyện.",
    `GIỚI HẠN THÔNG TIN: Chỉ dùng dữ kiện có trong phần thông tin sản phẩm hoặc đã xác nhận từ trang nguồn. Không bịa thông số, công dụng, giá, ưu đãi, logo hay chữ trên bao bì.${facts ? ` Dữ kiện được phép dùng: ${JSON.stringify(facts)}.` : " Nếu chưa xác minh được thông tin, chỉ mô tả điều nhìn thấy trong ảnh."}`,
    "MÔ TẢ SÁNG TẠO RIÊNG CHO SẢN PHẨM:",
  ].join("\n\n");
  const promptBudget = Math.max(0, 5000 - guidance.length - 2);
  const sceneDescription = authored.length > promptBudget
    ? `${authored.slice(0, Math.max(0, promptBudget - 1)).trimEnd()}…`
    : authored;
  return [guidance, sceneDescription].filter(Boolean).join("\n\n");
}

export async function GET() {
  const userId = await getCurrentUserId();
  const job = jobs.get(userId);
  return NextResponse.json({ job: job && job.expiresAt > Date.now() ? job : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Kiểm tra link HTTPS và các tùy chọn video." }, { status: 400 });

  const now = Date.now();
  for (const [owner, job] of jobs) if (job.expiresAt <= now) jobs.delete(owner);
  const job = { id: randomUUID(), input: parsed.data, expiresAt: now + 30 * 60_000 };
  jobs.set(userId, job);
  return NextResponse.json({ job });
}

export async function PATCH(request: Request) {
  const userId = await getCurrentUserId();
  const parsed = outputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Bản nháp UGC không hợp lệ." }, { status: 400 });

  const job = jobs.get(userId);
  if (!job || job.id !== parsed.data.id || job.expiresAt <= Date.now() || job.result) {
    return NextResponse.json({ message: "Yêu cầu UGC đã hết hạn, đã hoàn tất hoặc đã được thay thế." }, { status: 409 });
  }
  const result = parsed.data;
  const maxWords = salesVideoMaxWordCount(job.input.seconds, job.input.language);
  if ((!result.sourceUnavailable && (!result.prompt || !result.product))
    || (!result.sourceUnavailable && job.input.audio && !result.script.trim())
    || (!job.input.audio && result.script)
    || (maxWords !== null && salesVideoWordCount(result.script, job.input.language) > maxWords)) {
    return NextResponse.json({ message: `Cần tên sản phẩm, prompt và lời thoại khi đọc được nguồn${maxWords === null ? "." : `; lời thoại tối đa ${maxWords} từ.`}` }, { status: 400 });
  }
  job.result = result.sourceUnavailable ? result : { ...result, prompt: buildUgcPrompt(job, result) };
  return NextResponse.json({ ok: true });
}

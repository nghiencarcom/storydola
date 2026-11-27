import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateWithCodingAgent, getCodingAgentCliStatuses } from "./coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "./coding-agent-preferences";
import { autoEditFfmpeg, autoEditFfprobe } from "./auto-edit-media";
import {
  CREATE_VIDEO_PRESETS,
  computeCreateVideoTimeline,
  estimateReadingDurationMs,
  normalizeAgentCreateVideoOutline,
  normalizeAgentCreateVideoPlan,
  type CreateVideoAssetImage,
  type CreateVideoAudioInfo,
  type CreateVideoChapter,
  type CreateVideoJob,
  type CreateVideoJobSummary,
  type CreateVideoOptions,
  type CreateVideoOutline,
  type CreateVideoPlan,
  type CreateVideoScene,
  type CreateVideoWord,
} from "./motion-video";
import {
  createVideoJobDir,
  createVideoOwnerFolder,
  createVideoRoot,
  harvestArticleUrlForCreateVideo,
  isValidCreateVideoUuid,
} from "./motion-video-ingest";
import { synthesizeOmniVoice } from "./omnivoice-tts-server";
import { SFX_CATALOG } from "./sfx-library";

const exec = promisify(execFile);
const maxActiveCreateJobsPerUser = 5;
const staleLockMs = 30 * 60_000;

const guideCandidates = [
  path.join(process.cwd(), "prompts", "motion-video-code-agent-guide.md"),
  path.resolve(process.cwd(), "..", "..", "prompts", "motion-video-code-agent-guide.md"),
];

const runtime = globalThis as typeof globalThis & {
  storyAiCreateVideo?: {
    bootId: string;
    dirty: boolean;
    worker?: Promise<void>;
    writes: Promise<unknown>;
    pendingRenders: Set<string>;
  };
};

const queue = (runtime.storyAiCreateVideo ??= {
  bootId: randomUUID(),
  dirty: false,
  writes: Promise.resolve(),
  pendingRenders: new Set<string>(),
});
queue.bootId ||= randomUUID();
queue.pendingRenders ||= new Set<string>();

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isActiveCreateVideoJob(job: CreateVideoJob): boolean {
  return (
    job.status === "queued" ||
    job.status === "ingesting_source" ||
    job.status === "planning_outline" ||
    job.status === "scripting_scenes" ||
    job.status === "synthesizing_voice" ||
    job.status === "rendering"
  );
}

function serializeWrite<T>(write: () => Promise<T>) {
  const pending = queue.writes.then(write);
  queue.writes = pending.catch(() => undefined);
  return pending;
}

function ownerJobsDir(ownerFolder: string) {
  return path.join(createVideoRoot, ownerFolder);
}

async function readJobByFolder(folder: string, id: string): Promise<CreateVideoJob | undefined> {
  if (!isValidCreateVideoUuid(id)) return undefined;
  try {
    return JSON.parse(await readFile(path.join(ownerJobsDir(folder), `${id}.json`), "utf8")) as CreateVideoJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveJobByFolder(folder: string, job: CreateVideoJob) {
  const dir = ownerJobsDir(folder);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${job.id}.json`);
  const temp = path.join(dir, `.${job.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function listJobsByFolder(folder: string): Promise<CreateVideoJob[]> {
  try {
    const entries = await readdir(ownerJobsDir(folder), { withFileTypes: true });
    const jobs = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => readJobByFolder(folder, e.name.slice(0, -5))),
    );
    return jobs.filter((j): j is CreateVideoJob => Boolean(j));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function claimJobLock(folder: string, id: string) {
  const lockPath = path.join(ownerJobsDir(folder), `.${id}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, claimedAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return async () => {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [contents, details] = await Promise.all([
        readFile(lockPath, "utf8").catch(() => ""),
        stat(lockPath).catch(() => undefined),
      ]);
      let ownerPid = 0;
      try {
        ownerPid = Number((JSON.parse(contents) as { pid?: unknown }).pid);
      } catch {
        // Concurrent writer
      }
      if (isPidAlive(ownerPid) || !details || Date.now() - details.mtimeMs < staleLockMs) return undefined;
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  return undefined;
}

export function markCreateVideoRenderPending(jobId: string) {
  queue.pendingRenders.add(jobId);
}

export function clearCreateVideoRenderPending(jobId: string) {
  queue.pendingRenders.delete(jobId);
}

export async function claimCreateVideoRenderLock(folder: string, id: string) {
  const lockPath = path.join(ownerJobsDir(folder), `.${id}.render.lock`);
  await mkdir(ownerJobsDir(folder), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, bootId: queue.bootId, claimedAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      queue.pendingRenders.delete(id);
      return async () => {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raw = await readFile(lockPath, "utf8").catch(() => "");
      let pid = 0;
      let bootId = "";
      try {
        const parsed = JSON.parse(raw) as { pid?: unknown; bootId?: unknown };
        pid = Number(parsed.pid);
        bootId = typeof parsed.bootId === "string" ? parsed.bootId : "";
      } catch {
        // Malformed lock
      }
      if (bootId === queue.bootId && isPidAlive(pid)) return undefined;
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  return undefined;
}

export async function hasLiveCreateVideoRenderLock(folder: string, id: string): Promise<boolean> {
  if (queue.pendingRenders.has(id)) return true;
  const lockPath = path.join(ownerJobsDir(folder), `.${id}.render.lock`);
  const raw = await readFile(lockPath, "utf8").catch(() => "");
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; bootId?: unknown };
    return parsed.bootId === queue.bootId && isPidAlive(Number(parsed.pid));
  } catch {
    return false;
  }
}

export async function getCreateVideoJob(owner: string, id: string): Promise<CreateVideoJob | undefined> {
  const folder = createVideoOwnerFolder(owner);
  const job = await readJobByFolder(folder, id);
  if (job && isActiveCreateVideoJob(job)) {
    const shouldKick = job.status !== "rendering" || !(await hasLiveCreateVideoRenderLock(folder, job.id));
    if (shouldKick) void runCreateVideoQueue().catch(() => undefined);
  }
  return job;
}

export async function listCreateVideoJobs(owner: string): Promise<CreateVideoJobSummary[]> {
  const folder = createVideoOwnerFolder(owner);
  const jobs = await listJobsByFolder(folder);
  let needsQueue = jobs.some((j) => isActiveCreateVideoJob(j) && j.status !== "rendering");
  if (!needsQueue) {
    for (const j of jobs) {
      if (j.status === "rendering" && !(await hasLiveCreateVideoRenderLock(folder, j.id))) {
        needsQueue = true;
        break;
      }
    }
  }
  if (needsQueue) {
    void runCreateVideoQueue().catch(() => undefined);
  }
  return jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map((job) => {
      const computed = job.plan
        ? computeCreateVideoTimeline(job.plan, job.options.aspectRatio, job.audio?.words || [])
        : undefined;
      const fallbackTitle =
        job.outline?.title ||
        job.options.topicQuery ||
        job.sourceBrief?.sourceTitle ||
        job.options.sourceUrl ||
        job.options.rawContent.slice(0, 56) ||
        "Video Motion Mới";
      return {
        id: job.id,
        title: job.plan?.title || fallbackTitle,
        inputMode: job.options.inputMode,
        workflowMode: job.options.workflowMode,
        preset: job.options.preset,
        aspectRatio: job.options.aspectRatio,
        voiceMode: job.options.voiceMode,
        status: job.status,
        progress: job.progress,
        error: job.error,
        sceneCount: job.plan?.scenes.length || 0,
        chapterCount: job.outline?.chapters.length,
        durationMs: computed?.totalDurationMs,
        renderReady: job.render?.status === "ready" && Boolean(job.render.outputPath),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    });
}

export async function canEnqueueCreateVideoJob(owner: string): Promise<boolean> {
  const all = await listJobsByFolder(createVideoOwnerFolder(owner));
  return all.filter(isActiveCreateVideoJob).length < maxActiveCreateJobsPerUser;
}

export function createQueuedCreateVideoJob(
  owner: string,
  jobId: string,
  options: CreateVideoOptions,
  images: CreateVideoAssetImage[],
  agentPreferenceInput?: CodingAgentPreference,
) {
  return serializeWrite(async () => {
    const folder = createVideoOwnerFolder(owner);
    const existing = await readJobByFolder(folder, jobId);
    if (existing) return existing.id;
    const all = await listJobsByFolder(folder);
    if (all.filter(isActiveCreateVideoJob).length >= maxActiveCreateJobsPerUser) return undefined;
    const agentPreference = agentPreferenceInput ?? await getCodingAgentPreference(owner).catch(() => undefined);
    const now = new Date().toISOString();
    const job: CreateVideoJob = {
      id: jobId,
      options,
      status: "queued",
      progress: "Đang chờ tới lượt khởi tạo kịch bản & Motion...",
      agentPreference,
      images,
      createdAt: now,
      updatedAt: now,
    };
    await saveJobByFolder(folder, job);
    return job.id;
  });
}

export function updateCreateVideoJob(
  ownerFolder: string,
  jobId: string,
  updater: (latest: CreateVideoJob) => CreateVideoJob | undefined,
): Promise<CreateVideoJob | undefined> {
  return serializeWrite(async () => {
    const latest = await readJobByFolder(ownerFolder, jobId);
    if (!latest) return undefined;
    const next = updater(latest);
    if (!next) return latest;
    const saved: CreateVideoJob = { ...next, updatedAt: new Date().toISOString() };
    await saveJobByFolder(ownerFolder, saved);
    return saved;
  });
}

export async function updateCreateVideoJobPlan(
  owner: string,
  id: string,
  plan: CreateVideoPlan,
  optionsPatch?: Partial<CreateVideoOptions>,
): Promise<CreateVideoJob | undefined> {
  const folder = createVideoOwnerFolder(owner);
  const existing = await readJobByFolder(folder, id);
  if (!existing) return undefined;

  const nextOptions = optionsPatch ? { ...existing.options, ...optionsPatch } : existing.options;
  const prevNarrationSig = existing.plan?.scenes.map((s) => `${s.id}:${s.narrationText.trim()}`).join("|") || "";
  const nextNarrationSig = plan.scenes.map((s) => `${s.id}:${s.narrationText.trim()}`).join("|");
  const prevDurSig = existing.plan?.scenes.map((s) => `${s.id}:${s.durationMs}`).join("|") || "";
  const nextDurSig = plan.scenes.map((s) => `${s.id}:${s.durationMs}`).join("|");

  const needsAudioResync =
    nextNarrationSig !== prevNarrationSig ||
    (nextOptions.voiceMode === "kinetic_silent" && nextDurSig !== prevDurSig);

  let finalPlan = plan;
  let finalAudio = existing.audio;

  if (needsAudioResync) {
    const workDir = await mkdtemp(path.join(tmpdir(), "storyai-mv-save-"));
    try {
      const jobDir = createVideoJobDir(owner, existing.id);
      const locked = await synthesizeAndLockPlanAudio(
        folder,
        { ...existing, options: nextOptions },
        plan,
        jobDir,
        workDir,
      );
      finalPlan = locked.lockedPlan;
      finalAudio = locked.audioInfo;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return updateCreateVideoJob(folder, id, (job) => {
    const now = new Date().toISOString();
    return {
      ...job,
      options: nextOptions,
      plan: finalPlan,
      audio: finalAudio,
      status: job.status === "rendered" ? "ready" : job.status,
      render: job.render
        ? { ...job.render, status: job.render.status === "ready" ? "idle" : job.render.status, updatedAt: now }
        : undefined,
      updatedAt: now,
    };
  });
}

export function retryCreateVideoJob(owner: string, id: string) {
  return serializeWrite(async () => {
    const folder = createVideoOwnerFolder(owner);
    const job = await readJobByFolder(folder, id);
    if (!job) return "missing" as const;
    if (isActiveCreateVideoJob(job)) return "busy" as const;
    const latestPref = await getCodingAgentPreference(owner).catch(() => job.agentPreference);
    await saveJobByFolder(folder, {
      ...job,
      agentPreference: latestPref ?? job.agentPreference,
      status: "queued",
      progress: "Đã đưa lại vào hàng đợi viết kịch bản & dàn dựng Motion...",
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    return "queued" as const;
  });
}

export async function approveCreateVideoOutline(
  owner: string,
  id: string,
  rawOutline: unknown,
): Promise<{ status: "ok"; job: CreateVideoJob } | { status: "missing" | "busy" }> {
  const folder = createVideoOwnerFolder(owner);
  return serializeWrite(async () => {
    const latest = await readJobByFolder(folder, id);
    if (!latest) return { status: "missing" as const };
    if (latest.status !== "awaiting_outline_approval") return { status: "busy" as const };

    const normalized = normalizeAgentCreateVideoOutline(
      rawOutline,
      latest.options,
      latest.sourceBrief?.sourceTitle || latest.outline?.title || latest.options.topicQuery,
    );
    const totalSec = Math.min(
      1_800,
      Math.max(15, normalized.chapters.reduce((sum, c) => sum + c.targetDurationSec, 0)),
    );
    const saved: CreateVideoJob = {
      ...latest,
      options: { ...latest.options, targetDurationSec: totalSec },
      outline: normalized,
      outlineApproved: true,
      completedChapterScenes: {},
      status: "scripting_scenes",
      progress: `Đã duyệt dàn ý (${normalized.chapters.length} chương)! Đang viết kịch bản chi tiết từng Chương...`,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    await saveJobByFolder(folder, saved);
    return { status: "ok" as const, job: saved };
  });
}

async function resolveActiveAgentPreference(stored?: CodingAgentPreference): Promise<CodingAgentPreference | undefined> {
  const statuses = await getCodingAgentCliStatuses({ includeModels: false }).catch(() => []);
  const available = statuses.filter((s) => s.available);
  if (!available.length) return undefined;
  if (stored && available.some((s) => s.id === stored.agent)) return stored;
  return {
    agent: available[0].id,
    model: "",
    quality: "auto",
    speed: "standard",
  };
}

async function readCreateVideoGuide(): Promise<string> {
  for (const candidate of guideCandidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try next
    }
  }
  return "Bạn là Đạo diễn Kịch bản & Motion Graphics AI của StoryAI. Trả về JSON create-video-plan.v1 hợp lệ.";
}

function safeUrlHostname(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return new URL(raw.trim()).hostname || undefined;
  } catch {
    return undefined;
  }
}

function buildFallbackCreateVideoPlan(
  options: CreateVideoOptions,
  sourceText: string,
  sourceTitle: string,
  images: readonly CreateVideoAssetImage[],
): CreateVideoPlan {
  const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === options.preset) || CREATE_VIDEO_PRESETS[0];
  const isEn = options.language === "en";
  const cleanTitle = (sourceTitle || options.topicQuery || (isEn ? "Key Insights & Breakdown" : "Phân tích & Điểm nhấn Cốt lõi"))
    .trim()
    .slice(0, 96);

  const sentences = sourceText
    .split(/(?<=[.!?…\n])\s+/u)
    .map((s) => s.replace(/^#+\s*/gu, "").trim())
    .filter((s) => s.length >= 24);

  const scrollImg = images.find((i) => i.source === "captured_scroll") || images[0];
  const heroImg = images.find((i) => i.source === "captured_hero") || images[1] || images[0];

  const p1 = sentences[0] || (isEn
    ? `Here is what makes ${cleanTitle} stand out right now and why it changes everything.`
    : `Đây là lý do vì sao ${cleanTitle} đang tạo ra bước ngoặt lớn ngay lúc này.`);
  const p2 = sentences[1] || (isEn
    ? "Looking closely at the real interface and core workflow reveals three decisive advantages."
    : "Quan sát trực tiếp giao diện và cấu trúc vận hành cho thấy ba lợi thế mang tính quyết định.");
  const p3 = sentences[2] || (isEn
    ? "Execution speed increases dramatically while manual repetitive overhead drops to near zero."
    : "Tốc độ triển khai tăng vọt gấp nhiều lần trong khi thao tác thủ công lặp lại giảm xuống mức tối thiểu.");
  const p4 = sentences[3] || (isEn
    ? "Instead of fragmented tools and slow handoffs, one unified pipeline keeps every beat aligned."
    : "Thay vì quy trình rời rạc tốn hàng giờ chỉnh tay, mọi công đoạn nay được đồng bộ trong một luồng duy nhất.");
  const p5 = sentences[4] || (isEn
    ? "Start applying this workflow today to turn every idea or article into high-impact visual stories."
    : "Áp dụng ngay hôm nay để biến mọi ý tưởng hay bài viết thành thước phim chuyên nghiệp cuốn hút.");

  const scenes: CreateVideoScene[] = [
    {
      id: "scene_01",
      kind: "kinetic_hook",
      badge: isEn ? "KEY BREAKDOWN" : "ĐIỂM NHẤN MỚI",
      headline: cleanTitle.toUpperCase().slice(0, 68),
      subheadline: isEn ? "Automated 3D Motion & Visual Storytelling" : "Bóc tách trực quan chuyển động 3D",
      narrationText: p1.slice(0, 240),
      durationMs: estimateReadingDurationMs(p1, options.language, 3_800),
      palette: presetMeta.defaultPalette,
      accentColor: "cyan",
      emoji: "⚡",
      revealSfxId: "reveal-woosh",
      seamOut: { technique: "zoom-through", vector: "z-push", durationMs: 320, sfxId: "transition-rise" },
      note: "Mở màn Kinetic Waterfall Typography",
    },
    {
      id: "scene_02",
      kind: scrollImg || heroImg ? "browser_3d_showcase" : "quote_editorial",
      badge: isEn ? "INSIDE LOOK" : "TRỰC QUAN HOÁ",
      headline: isEn ? "REAL SOURCE ON 3D STAGE" : "PHÂN TÍCH TRỰC TIẾP NỘI DUNG GỐC",
      subheadline: p2.slice(0, 110),
      narrationText: p2.slice(0, 240),
      durationMs: estimateReadingDurationMs(p2, options.language, 4_500),
      palette: presetMeta.defaultPalette,
      accentColor: "emerald",
      emoji: "🖥️",
      imageId: (scrollImg || heroImg)?.id,
      scrollStart: 0,
      scrollEnd: 0.55,
      quoteSource: safeUrlHostname(options.sourceUrl),
      annotation: {
        kind: "oversized_cursor",
        label: isEn ? "Core Insight" : "Luận điểm chính",
        targetX: 0.52,
        targetY: 0.45,
        targetW: 0.38,
        targetH: 0.12,
      },
      revealSfxId: "mouse-clicks",
      seamOut: { technique: "cut-the-curve", vector: presetMeta.dominantVector, durationMs: 300, sfxId: "transition-sweep" },
    },
    {
      id: "scene_03",
      kind: "stat_counter_3d",
      badge: isEn ? "IMPACT METRICS" : "SỐ LIỆU ĐỐI CHIẾU",
      headline: isEn ? "MEASURABLE PERFORMANCE JUMP" : "HIỆU SUẤT TĂNG TRƯỞNG VƯỢT TRỘI",
      subheadline: p3.slice(0, 110),
      narrationText: p3.slice(0, 240),
      durationMs: estimateReadingDurationMs(p3, options.language, 4_400),
      palette: presetMeta.defaultPalette,
      accentColor: "amber",
      emoji: "📊",
      stats: [
        { label: isEn ? "Speedup" : "Tốc độ xử lý", value: 3, suffix: "x", color: "cyan" },
        { label: isEn ? "Saved Time" : "Tiết kiệm thời gian", value: 85, suffix: "%", color: "emerald" },
        { label: isEn ? "Precision" : "Độ chuẩn khung hình", value: 100, suffix: "%", color: "amber" },
      ],
      revealSfxId: "reveal-ping",
      seamOut: { technique: "cut-the-curve", vector: presetMeta.dominantVector, durationMs: 300, sfxId: "swoosh" },
    },
    {
      id: "scene_04",
      kind: "comparison_split",
      badge: isEn ? "BEFORE VS AFTER" : "ĐỐI CHIẾU CÁCH LÀM",
      headline: isEn ? "MANUAL WORKFLOW VS AI MOTION" : "THỦ CÔNG RỜI RẠC VS TỰ ĐỘNG HOÁ",
      leftTitle: isEn ? "Traditional Way" : "Cách làm cũ",
      rightTitle: isEn ? "New Approach" : "Giải pháp mới",
      comparisons: [
        {
          leftLabel: isEn ? "Hours of manual keyframing" : "Mất hàng giờ căn chỉnh từng lớp chữ",
          rightLabel: isEn ? "Instant velocity-matched 3D scenes" : "Dàn dựng 3D & GSAP tự động theo nhịp nói",
        },
        {
          leftLabel: isEn ? "Disconnected audio & visuals" : "Hình ảnh và giọng đọc dễ lệch nhịp",
          rightLabel: isEn ? "Frame-accurate Audio-Clock sync" : "Khớp chính xác từng từ với Audio-Clock",
        },
      ],
      narrationText: p4.slice(0, 240),
      durationMs: estimateReadingDurationMs(p4, options.language, 4_600),
      palette: presetMeta.defaultPalette,
      accentColor: "rose",
      emoji: "⚖️",
      revealSfxId: "reveal-pop",
      seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 340, sfxId: "transition-bass" },
    },
    {
      id: "scene_05",
      kind: "cta_climax",
      badge: isEn ? "NEXT STEP" : "TỔNG KẾT",
      headline: isEn ? "READY TO LAUNCH YOUR NEXT VIDEO" : "BIẾN MỌI Ý TƯỞNG THÀNH VIDEO NGAY",
      subheadline: p5.slice(0, 120),
      ctaButtonText: isEn ? "Explore Full Story" : "Khám phá & Áp dụng Ngay",
      ctaHint: safeUrlHostname(options.sourceUrl) || "StoryAI Motion Video Studio",
      narrationText: p5.slice(0, 240),
      durationMs: estimateReadingDurationMs(p5, options.language, 4_000),
      stillnessBeforeClimaxMs: 420,
      palette: presetMeta.defaultPalette,
      accentColor: "cyan",
      emoji: "🚀",
      revealSfxId: "tada",
      seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 280 },
    },
  ];

  return {
    schema: "create-video-plan.v1",
    title: cleanTitle,
    summary: isEn
      ? "5-scene 3D + GSAP motion video synthesized automatically from your input."
      : "Bản dựng 5 phân cảnh kết hợp sân khấu 3D, biểu đồ số liệu và chuyển cảnh khớp gia tốc.",
    dominantVector: presetMeta.dominantVector,
    captionStyle: options.captionStyle,
    scenes,
    keywordHighlights: [],
    directorNotes: [
      isEn
        ? "Applied Z-push -> Cut-the-Curve -> Inverse-Zoom arrival structure."
        : "Áp dụng cấu trúc Z-push mở màn -> Cut-the-Curve dẫn chuyện -> Inverse-Zoom chốt cao trào.",
    ],
  };
}

function buildFallbackOutline(
  options: CreateVideoOptions,
  sourceText: string,
  sourceTitle: string,
): CreateVideoOutline {
  const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === options.preset) || CREATE_VIDEO_PRESETS[0];
  const isEn = options.language === "en";
  const count = Math.min(20, Math.max(2, Math.round(options.targetDurationSec / 75)));
  const perChapSec = Math.min(240, Math.max(25, Math.round(options.targetDurationSec / count)));
  const cleanTitle = (sourceTitle || options.topicQuery || (isEn ? "Deep-Dive Motion Documentary" : "Phim Phân Tích Chuyên Sâu")).trim().slice(0, 110);

  const headings = sourceText
    .split(/\r?\n/u)
    .filter((l) => l.startsWith("## "))
    .map((l) => l.replace(/^##\s+/u, "").trim())
    .filter(Boolean);

  const sentences = sourceText
    .split(/(?<=[.!?…\n])\s+/u)
    .map((s) => s.replace(/^#+\s*/gu, "").trim())
    .filter((s) => s.length >= 24);

  const chapters: CreateVideoChapter[] = [];
  for (let i = 0; i < count; i++) {
    const startIdx = Math.floor((i * sentences.length) / count);
    const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) * sentences.length) / count));
    const slice = sentences.slice(startIdx, endIdx);
    const defaultTitle = i === 0
      ? (isEn ? `Opening & Context: ${cleanTitle}` : `Mở màn & Bối cảnh: ${cleanTitle}`).slice(0, 90)
      : i === count - 1
        ? (isEn ? "Synthesis & Action Plan" : "Tổng kết & Lộ trình Ứng dụng")
        : headings[i - 1] || (isEn ? `Chapter ${i + 1}: Core Breakdown` : `Chương ${i + 1}: Phân tích Chuyên sâu`);

    chapters.push({
      id: `chap_${String(i + 1).padStart(2, "0")}`,
      index: i,
      title: defaultTitle.slice(0, 100),
      summary: (slice[0] || defaultTitle).slice(0, 260),
      targetDurationSec: perChapSec,
      keyPoints: slice.length ? slice.slice(0, 4).map((s) => s.slice(0, 140)) : [defaultTitle],
      palette: presetMeta.defaultPalette,
      dominantVector: presetMeta.dominantVector,
    });
  }

  return {
    title: cleanTitle,
    summary: isEn
      ? `${count}-chapter structured motion video (~${Math.round(options.targetDurationSec / 60)} min).`
      : `Kế hoạch ${count} chương cho video Motion dài khoảng ${Math.max(1, Math.round(options.targetDurationSec / 60))} phút.`,
    dominantVector: presetMeta.dominantVector,
    chapters,
  };
}

function buildFallbackChapterScenes(
  chapter: CreateVideoChapter,
  chapterIdx: number,
  totalChapters: number,
  options: CreateVideoOptions,
  sourceChunk: string,
  images: readonly CreateVideoAssetImage[],
): CreateVideoScene[] {
  const isEn = options.language === "en";
  const count = Math.max(4, Math.min(18, Math.round(chapter.targetDurationSec / 5.5)));
  const sentences = sourceChunk
    .split(/(?<=[.!?…\n])\s+/u)
    .map((s) => s.replace(/^#+\s*/gu, "").trim())
    .filter((s) => s.length >= 20);
  const pool = [...chapter.keyPoints, ...sentences];
  const heroOrScroll = images.find((i) => i.source === "captured_scroll") || images[0];

  const scenes: CreateVideoScene[] = [];
  const prefix = `c${String(chapterIdx + 1).padStart(2, "0")}`;

  for (let s = 0; s < count; s++) {
    const isFirstOverall = chapterIdx === 0 && s === 0;
    const isLastOverall = chapterIdx === totalChapters - 1 && s === count - 1;
    const isChapOpener = chapterIdx > 0 && s === 0;
    const point = pool[s % Math.max(1, pool.length)] || chapter.summary || chapter.title;
    const words = point.split(/\s+/u).filter(Boolean);
    const headline = isChapOpener
      ? chapter.title.toUpperCase().slice(0, 72)
      : words.slice(0, 6).join(" ").toUpperCase().slice(0, 72) || chapter.title.toUpperCase().slice(0, 72);

    let kind: CreateVideoScene["kind"] = "hyperframes_custom";
    if (isFirstOverall) kind = "kinetic_hook";
    else if (isChapOpener) kind = "chapter_card";
    else if (isLastOverall) kind = "cta_climax";
    else if (s % 4 === 1 && heroOrScroll) kind = "browser_3d_showcase";
    else if (s % 4 === 2) kind = "stat_counter_3d";
    else if (s % 4 === 3) kind = "comparison_split";
    else kind = "quote_editorial";

    scenes.push({
      id: `${prefix}_sc_${String(s + 1).padStart(2, "0")}`,
      kind,
      chapterIndex: chapterIdx,
      chapterTitle: chapter.title,
      badge: isChapOpener
        ? `${isEn ? "CHAPTER" : "CHƯƠNG"} ${String(chapterIdx + 1).padStart(2, "0")}`
        : chapter.title.slice(0, 36),
      headline,
      subheadline: point.slice(0, 120),
      narrationText: point.slice(0, 260),
      durationMs: estimateReadingDurationMs(point, options.language, 4_000),
      palette: chapter.palette,
      accentColor: s % 3 === 0 ? "cyan" : s % 3 === 1 ? "emerald" : "amber",
      emoji: isFirstOverall ? "⚡" : isChapOpener ? "📑" : isLastOverall ? "🚀" : undefined,
      imageId: kind === "browser_3d_showcase" ? heroOrScroll?.id : undefined,
      scrollStart: kind === "browser_3d_showcase" ? ((s * 0.18) % 0.6) : undefined,
      scrollEnd: kind === "browser_3d_showcase" ? Math.min(0.95, ((s * 0.18) % 0.6) + 0.32) : undefined,
      stats: kind === "stat_counter_3d"
        ? [
            { label: isEn ? "Chapter Progress" : "Tiến độ phân tích", value: Math.round(((chapterIdx + 1) / totalChapters) * 100), suffix: "%", color: "cyan" },
            { label: isEn ? "Key Impact" : "Mức độ tác động", value: 3 + (s % 4), suffix: "x", color: "emerald" },
          ]
        : undefined,
      comparisons: kind === "comparison_split"
        ? [{ leftLabel: isEn ? "Surface assumption" : "Cách hiểu bề mặt", rightLabel: point.slice(0, 72) }]
        : undefined,
      ctaButtonText: isLastOverall ? (isEn ? "Apply These Insights" : "Áp dụng Ngay") : undefined,
      stillnessBeforeClimaxMs: isLastOverall ? 420 : undefined,
      seamOut: {
        technique: isLastOverall ? "inverse-zoom" : s === 0 ? "zoom-through" : "cut-the-curve",
        vector: isLastOverall ? "z-pull" : chapter.dominantVector,
        durationMs: 320,
      },
    });
  }

  return scenes;
}

async function probeAudioDurationMs(filePath: string): Promise<number> {
  try {
    const { stdout } = await exec(
      autoEditFfprobe(),
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15_000 },
    );
    const sec = Number(stdout.trim());
    if (Number.isFinite(sec) && sec > 0.1) return Math.round(sec * 1000);
  } catch {
    // Ignore probe error
  }
  return 0;
}

async function synthesizeMacosLocalSayWav(text: string, language: "vi" | "en", outWavPath: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const aiffPath = `${outWavPath}.aiff`;
  try {
    const preferredVoice = language === "vi" ? "Linh" : "Samantha";
    try {
      await exec("/usr/bin/say", ["-v", preferredVoice, "-r", "182", "-o", aiffPath, text], { timeout: 30_000 });
    } catch {
      await exec("/usr/bin/say", ["-r", "180", "-o", aiffPath, text], { timeout: 30_000 });
    }
    await exec(
      autoEditFfmpeg(),
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", aiffPath, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outWavPath],
      { timeout: 25_000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    await rm(aiffPath, { force: true }).catch(() => undefined);
  }
}

type SynthesizedSceneAudioResult = {
  paddedPath: string;
  spoken: string;
  leadPadMs: number;
  rawDurMs: number;
  totalSceneMs: number;
  backend: "omnivoice" | "macos-say" | "kinetic-silent";
};

export async function synthesizeAndLockPlanAudio(
  ownerFolder: string,
  job: CreateVideoJob,
  plan: CreateVideoPlan,
  jobDir: string,
  workDir: string,
): Promise<{ lockedPlan: CreateVideoPlan; audioInfo: CreateVideoAudioInfo }> {
  const audioDir = path.join(jobDir, "audio");
  const cacheDir = path.join(audioDir, "scene-cache");
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const masterWavPath = path.join(audioDir, "narration.wav");

  if (job.options.voiceMode === "kinetic_silent") {
    await rm(masterWavPath, { force: true }).catch(() => undefined);
    const computed = computeCreateVideoTimeline(plan, job.options.aspectRatio);
    return {
      lockedPlan: plan,
      audioInfo: {
        hasVoiceover: false,
        voiceBackend: "kinetic-silent",
        durationMs: computed.totalDurationMs,
        words: computed.words,
      },
    };
  }

  const chosenVoiceId = job.options.voiceId.trim() || (job.options.language === "en" ? "en-female-warm" : "vi-female-north");
  const results: SynthesizedSceneAudioResult[] = new Array(plan.scenes.length);
  const batchSize = 4;

  for (let batchStart = 0; batchStart < plan.scenes.length; batchStart += batchSize) {
    const batchEnd = Math.min(plan.scenes.length, batchStart + batchSize);
    const batchPromises: Array<Promise<void>> = [];

    for (let i = batchStart; i < batchEnd; i++) {
      batchPromises.push((async () => {
        const sc = plan.scenes[i];
        const spoken = (sc.narrationText || sc.subheadline || sc.headline).trim();
        const leadPadMs = i === 0 ? 120 : sc.stillnessBeforeClimaxMs ? 380 : 160;
        const tailPadMs = i === plan.scenes.length - 1 ? 450 : 240;

        const cacheKey = createHash("sha256")
          .update(`${job.options.voiceMode}|${chosenVoiceId}|${job.options.language}|${spoken}|${leadPadMs}|${tailPadMs}`)
          .digest("hex")
          .slice(0, 16);
        const omniCachePath = path.join(cacheDir, `${cacheKey}.omnivoice.wav`);
        const sayCachePath = path.join(cacheDir, `${cacheKey}.say.wav`);
        const legacyCachePath = path.join(cacheDir, `${cacheKey}.wav`);

        // Check persistent disk cache first (huge speedup on long-form tweaks & resumes)
        if (spoken) {
          const candidates: Array<{ file: string; cachedBackend: "omnivoice" | "macos-say" }> = [
            { file: omniCachePath, cachedBackend: "omnivoice" },
            { file: sayCachePath, cachedBackend: "macos-say" },
            { file: legacyCachePath, cachedBackend: "omnivoice" },
          ];
          for (const candidate of candidates) {
            const cachedExists = await access(candidate.file, constants.R_OK).then(() => true).catch(() => false);
            if (!cachedExists) continue;
            const cachedDur = await probeAudioDurationMs(candidate.file);
            if (cachedDur >= 400 + leadPadMs + tailPadMs) {
              results[i] = {
                paddedPath: candidate.file,
                spoken,
                leadPadMs,
                rawDurMs: cachedDur - leadPadMs - tailPadMs,
                totalSceneMs: cachedDur,
                backend: candidate.cachedBackend,
              };
              return;
            }
          }
        }

        const rawVoicePath = path.join(workDir, `sc_${i}_raw.wav`);
        const paddedTempPath = path.join(workDir, `sc_${i}_padded.wav`);
        let synthesizedOk = false;
        let backend: "omnivoice" | "macos-say" | "kinetic-silent" = "kinetic-silent";

        if (spoken) {
          try {
            await synthesizeOmniVoice(spoken, chosenVoiceId, job.options.language, rawVoicePath);
            synthesizedOk = true;
            backend = "omnivoice";
          } catch {
            const macOk = await synthesizeMacosLocalSayWav(spoken, job.options.language, rawVoicePath);
            if (macOk) {
              synthesizedOk = true;
              backend = "macos-say";
            }
          }
        }

        let rawDurMs = synthesizedOk ? await probeAudioDurationMs(rawVoicePath) : 0;
        if (rawDurMs < 400) {
          synthesizedOk = false;
          backend = "kinetic-silent";
          rawDurMs = Math.max(2_400, estimateReadingDurationMs(spoken, job.options.language, 3_200) - leadPadMs - tailPadMs);
        }

        const totalSceneMs = rawDurMs + leadPadMs + tailPadMs;
        if (synthesizedOk) {
          await exec(
            autoEditFfmpeg(),
            [
              "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
              "-i", rawVoicePath,
              "-af", `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,adelay=${leadPadMs}|${leadPadMs},apad=pad_dur=${(tailPadMs / 1000).toFixed(3)}`,
              "-t", (totalSceneMs / 1000).toFixed(3),
              "-c:a", "pcm_s16le",
              paddedTempPath,
            ],
            { timeout: 35_000 },
          );
          const targetCachePath = backend === "macos-say" ? sayCachePath : omniCachePath;
          const atomicTemp = path.join(cacheDir, `.${cacheKey}.${randomUUID()}.tmp.wav`);
          try {
            await copyFile(paddedTempPath, atomicTemp);
            await rename(atomicTemp, targetCachePath);
          } finally {
            await rm(atomicTemp, { force: true }).catch(() => undefined);
          }
          results[i] = { paddedPath: targetCachePath, spoken, leadPadMs, rawDurMs, totalSceneMs, backend };
        } else {
          await exec(
            autoEditFfmpeg(),
            [
              "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi",
              "-t", (totalSceneMs / 1000).toFixed(3),
              "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
              "-c:a", "pcm_s16le",
              paddedTempPath,
            ],
            { timeout: 25_000 },
          );
          results[i] = { paddedPath: paddedTempPath, spoken, leadPadMs, rawDurMs, totalSceneMs, backend };
        }
      })());
    }

    await Promise.all(batchPromises);
    await updateCreateVideoJob(ownerFolder, job.id, (latest) => ({
      ...latest,
      progress: `Đang tổng hợp giọng đọc song song & khoá Audio-Clock (${batchEnd}/${plan.scenes.length} cảnh)...`,
    }));
  }

  const segmentPaths: string[] = [];
  const updatedScenes: CreateVideoScene[] = [];
  const alignedWords: CreateVideoWord[] = [];
  let cursorMs = 0;
  let usedBackend: "omnivoice" | "macos-say" | "kinetic-silent" = "kinetic-silent";
  let wordIdx = 1;

  for (let i = 0; i < plan.scenes.length; i++) {
    const sc = plan.scenes[i];
    const r = results[i];
    if (r.backend === "omnivoice") usedBackend = "omnivoice";
    else if (r.backend === "macos-say" && usedBackend === "kinetic-silent") usedBackend = "macos-say";

    segmentPaths.push(r.paddedPath);

    const tokens = r.spoken.split(/\s+/u).filter(Boolean);
    if (tokens.length) {
      const weights = tokens.map((tok) => Math.max(2, tok.length) + (/[,.!?;:]/u.test(tok) ? 2.5 : 0));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let wCursor = cursorMs + r.leadPadMs;
      tokens.forEach((tok, tIdx) => {
        const span = (r.rawDurMs * weights[tIdx]) / Math.max(1, totalWeight);
        const startMs = Math.round(wCursor);
        const endMs = Math.round(Math.max(startMs + 45, wCursor + span - 10));
        alignedWords.push({
          id: `cw_${wordIdx++}`,
          sceneId: sc.id,
          text: tok,
          startMs,
          endMs,
        });
        wCursor += span;
      });
    }

    updatedScenes.push({
      ...sc,
      durationMs: r.totalSceneMs,
    });
    cursorMs += r.totalSceneMs;
  }

  if (usedBackend !== "kinetic-silent" && segmentPaths.length > 0) {
    const concatListPath = path.join(workDir, "voice_concat.txt");
    const concatText = segmentPaths
      .map((p) => `file '${p.replace(/'/gu, "'\\''")}'`)
      .join("\n");
    await writeFile(concatListPath, concatText, "utf8");

    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", concatListPath,
        "-af", "loudnorm=I=-15:TP=-1.2:LRA=9,aresample=48000",
        "-c:a", "pcm_s16le",
        masterWavPath,
      ],
      { timeout: 360_000, maxBuffer: 8_000_000 },
    );
  } else {
    await rm(masterWavPath, { force: true }).catch(() => undefined);
  }

  const lockedPlan: CreateVideoPlan = {
    ...plan,
    scenes: updatedScenes,
  };

  return {
    lockedPlan,
    audioInfo: {
      hasVoiceover: usedBackend !== "kinetic-silent",
      voiceBackend: usedBackend,
      durationMs: cursorMs,
      words: alignedWords,
    },
  };
}

async function processSingleCreateVideoJob(ownerFolder: string, jobId: string) {
  const release = await claimJobLock(ownerFolder, jobId);
  if (!release) return;

  let workDir = "";
  try {
    const initial = await readJobByFolder(ownerFolder, jobId);
    if (!initial || !isActiveCreateVideoJob(initial) || initial.status === "rendering") {
      return;
    }

    const jobDir = path.join(createVideoRoot, ownerFolder, "jobs", jobId);
    const imagesDir = path.join(jobDir, "images");
    await mkdir(imagesDir, { recursive: true, mode: 0o700 });
    workDir = await mkdtemp(path.join(tmpdir(), "storyai-motion-video-"));

    const mergedImages = [...initial.images];
    let sourceBrief = initial.sourceBrief;
    let sourceBodyText = initial.harvestedText || initial.options.rawContent;

    if (!initial.harvestedText) {
      if (initial.options.inputMode === "article_url" && initial.options.sourceUrl) {
        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          status: "ingesting_source",
          progress: "Đang truy cập bài viết, bóc tách luận điểm & chụp giao diện 3D...",
        }));

        const harvested = await harvestArticleUrlForCreateVideo(initial.options.sourceUrl, imagesDir);
        sourceBrief = harvested.brief;
        sourceBodyText = harvested.articleBody;
        const existingIds = new Set(mergedImages.map((img) => img.id));
        for (const cap of harvested.capturedImages) {
          if (!existingIds.has(cap.id)) mergedImages.unshift(cap);
        }
      } else if (initial.options.inputMode === "keyword") {
        sourceBrief = {
          sourceTitle: initial.options.topicQuery || "Chủ đề Video Mới",
          extractedSummary: initial.options.direction || initial.options.topicQuery,
          keyBullets: [],
        };
        sourceBodyText = `${initial.options.topicQuery}\n${initial.options.direction}`.trim();
      } else {
        const firstLine = initial.options.rawContent.split(/\r?\n/u).find((l) => l.trim().length > 3)?.trim() || "Nội dung Kịch bản";
        sourceBrief = {
          sourceTitle: firstLine.slice(0, 110),
          extractedSummary: initial.options.rawContent.slice(0, 360),
          keyBullets: [],
        };
      }

      await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
        ...latest,
        sourceBrief,
        harvestedText: sourceBodyText.slice(0, 120_000),
        images: mergedImages,
      }));
    }

    const guide = await readCreateVideoGuide();
    const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === initial.options.preset) || CREATE_VIDEO_PRESETS[0];
    const imagePathsForVision = mergedImages.slice(0, 4).map((img) => path.join(imagesDir, img.filename));
    const activePref = await resolveActiveAgentPreference(initial.agentPreference);

    const useChapterPipeline =
      initial.options.targetDurationSec > 150 || initial.options.workflowMode === "review_outline";

    let draftPlan: CreateVideoPlan;

    if (!useChapterPipeline) {
      // Short-form 1-pass director
      await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
        ...latest,
        status: "scripting_scenes",
        progress: "Code Agent đang viết kịch bản phân cảnh & đạo diễn Three.js / GSAP / HyperFrames...",
      }));

      const promptPayload = {
        task: "Hãy viết kịch bản lời bình và thiết kế trọn bộ phân cảnh Motion Graphics theo chuẩn create-video-plan.v1.",
        inputMode: initial.options.inputMode,
        language: initial.options.language,
        targetDurationSec: initial.options.targetDurationSec,
        aspectRatio: initial.options.aspectRatio,
        voiceMode: initial.options.voiceMode,
        preset: {
          id: presetMeta.id,
          label: presetMeta.label,
          dominantVector: presetMeta.dominantVector,
          defaultPalette: presetMeta.defaultPalette,
          directorRules: presetMeta.directorRules,
        },
        userDirection: initial.options.direction || undefined,
        sourceBrief,
        sourceContent: sourceBodyText.slice(0, 24_000),
        availableImages: mergedImages.map((img) => ({
          id: img.id,
          label: img.label,
          source: img.source,
          width: img.width,
          height: img.height,
        })),
        availableSfxLibrary: SFX_CATALOG.map((item) => ({
          id: item.id,
          category: item.category,
          usage: item.usage,
        })),
      };

      const fullPrompt = `${guide}\n\n---\n\n## DỮ LIỆU ĐẦU VÀO CỦA DỰ ÁN MOTION VIDEO\n\`\`\`json\n${JSON.stringify(promptPayload, null, 2)}\n\`\`\`\n\nChỉ trả về duy nhất 1 JSON object theo cấu trúc create-video-plan.v1.`;

      try {
        if (!activePref) throw new Error("NO_ACTIVE_CODING_AGENT_CLI");
        const generated = await generateWithCodingAgent(activePref.agent, fullPrompt, {
          model: activePref.model,
          quality: activePref.quality,
          speed: activePref.speed,
          imagePaths: imagePathsForVision.length ? imagePathsForVision : undefined,
        });
        draftPlan = normalizeAgentCreateVideoPlan(generated.result, initial.options, mergedImages);
      } catch (agentErr) {
        console.warn("[motion-video] Agent CLI fallback triggered:", agentErr instanceof Error ? agentErr.message : agentErr);
        draftPlan = buildFallbackCreateVideoPlan(
          initial.options,
          sourceBodyText || initial.options.topicQuery,
          sourceBrief?.sourceTitle || initial.options.topicQuery,
          mergedImages,
        );
      }
    } else {
      // Long-Form Chaptered Pipeline (supports 2.5 - 30 min & Optional 2-Step Outline Approval)
      let outline: CreateVideoOutline | undefined = initial.outline;

      if (!outline || !outline.chapters.length) {
        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          status: "planning_outline",
          progress: `Code Agent đang lập Dàn ý phân Chương cho video ${Math.round(initial.options.targetDurationSec / 60 * 10) / 10} phút...`,
        }));

        const idealChapters = Math.min(20, Math.max(2, Math.round(initial.options.targetDurationSec / 75)));
        const outlinePrompt = `Bạn là Tổng Đạo diễn Nội dung Phim Phân tích Dài (Long-Form Motion Documentary).\nHãy chia chủ đề/tài liệu dưới đây thành ${idealChapters} Chương mạch lạc với tổng thời lượng xấp xỉ ${initial.options.targetDurationSec} giây (${Math.round(initial.options.targetDurationSec / 60 * 10) / 10} phút).\n\nNgôn ngữ: ${initial.options.language}\nPhong cách: ${presetMeta.label} (${presetMeta.directorRules})\nChỉ dẫn thêm: ${initial.options.direction || "Không có"}\nNguồn: ${JSON.stringify(sourceBrief)}\nNội dung nguồn (trích đoạn):\n${sourceBodyText.slice(0, 40_000)}\n\nChỉ trả về DUY NHẤT 1 JSON object hợp lệ:\n{\n  "title": "Tiêu đề tổng của video",\n  "summary": "Tóm tắt mạch truyện xuyên suốt các chương",\n  "dominantVector": "${presetMeta.dominantVector}",\n  "chapters": [\n    {\n      "id": "chap_01",\n      "title": "Tên chương ngắn gọn giàu sức gợi",\n      "summary": "Trọng tâm nội dung của chương này",\n      "targetDurationSec": ${Math.round(initial.options.targetDurationSec / idealChapters)},\n      "keyPoints": ["Luận điểm 1", "Luận điểm 2", "Luận điểm 3"],\n      "palette": "${presetMeta.defaultPalette}",\n      "dominantVector": "${presetMeta.dominantVector}"\n    }\n  ]\n}`;

        try {
          if (!activePref) throw new Error("NO_ACTIVE_CODING_AGENT_CLI");
          const rawOutline = await generateWithCodingAgent(activePref.agent, outlinePrompt, {
            model: activePref.model,
            quality: activePref.quality,
            speed: activePref.speed,
          });
          outline = normalizeAgentCreateVideoOutline(
            rawOutline.result,
            initial.options,
            sourceBrief?.sourceTitle || initial.options.topicQuery,
          );
        } catch (outlineErr) {
          console.warn("[motion-video] Outline fallback triggered:", outlineErr instanceof Error ? outlineErr.message : outlineErr);
          outline = buildFallbackOutline(
            initial.options,
            sourceBodyText || initial.options.topicQuery,
            sourceBrief?.sourceTitle || initial.options.topicQuery,
          );
        }

        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          outline,
        }));
      }

      if (initial.options.workflowMode === "review_outline" && !initial.outlineApproved) {
        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          outline,
          status: "awaiting_outline_approval",
          progress: `Đã lập xong Dàn ý ${outline!.chapters.length} Chương! Hãy kiểm tra hoặc chỉnh sửa rồi bấm Duyệt & Dựng Phân cảnh.`,
        }));
        return;
      }

      // Per-Chapter Scene Scripting with Checkpoints
      const completedMap: Record<string, CreateVideoScene[]> = { ...(initial.completedChapterScenes || {}) };
      const allScenes: CreateVideoScene[] = [];
      const chapterHighlightsMap = new Map<string, CreateVideoPlan["keywordHighlights"][number]>();
      let previousChapterTail = "";

      for (let cIdx = 0; cIdx < outline.chapters.length; cIdx++) {
        const chap = outline.chapters[cIdx];
        const existingScenes = completedMap[chap.id];

        if (existingScenes && existingScenes.length > 0) {
          allScenes.push(...existingScenes);
          previousChapterTail = existingScenes[existingScenes.length - 1]?.narrationText || chap.summary;
          continue;
        }

        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          status: "scripting_scenes",
          progress: `Code Agent đang viết kịch bản Chương ${cIdx + 1}/${outline!.chapters.length}: ${chap.title}...`,
        }));

        const targetSceneCount = Math.max(4, Math.min(18, Math.round(chap.targetDurationSec / 5.2)));
        const chunkStart = Math.floor((cIdx * sourceBodyText.length) / outline.chapters.length);
        const chunkEnd = Math.min(sourceBodyText.length, chunkStart + 16_000);
        const sourceChunk = sourceBodyText.slice(chunkStart, chunkEnd);

        const chapterPayload = {
          task: `Viết kịch bản & thiết kế ${targetSceneCount} phân cảnh Motion cho CHƯƠNG ${cIdx + 1}/${outline.chapters.length}.`,
          overallTitle: outline.title,
          overallSummary: outline.summary,
          chapterIndex: cIdx,
          totalChapters: outline.chapters.length,
          chapterOutline: chap,
          previousChapterTail: previousChapterTail || "Đây là chương mở đầu.",
          chapterRules: [
            cIdx === 0
              ? "Phân cảnh đầu tiên của Chương 1 PHẢI là kind: 'kinetic_hook'."
              : `Phân cảnh đầu tiên của Chương ${cIdx + 1} PHẢI là kind: 'chapter_card' với badge: 'CHƯƠNG ${String(cIdx + 1).padStart(2, "0")}' và headline: '${chap.title.toUpperCase()}'.`,
            cIdx === outline.chapters.length - 1
              ? "Phân cảnh cuối cùng của chương cuối PHẢI là kind: 'cta_climax'."
              : "Kết thúc chương bằng một câu chuyển mượt mà dẫn sang chương kế tiếp (không dùng cta_climax).",
            "Không lặp lại lời mở đầu hay luận điểm đã nói ở previousChapterTail.",
          ],
          language: initial.options.language,
          aspectRatio: initial.options.aspectRatio,
          voiceMode: initial.options.voiceMode,
          preset: {
            id: presetMeta.id,
            dominantVector: chap.dominantVector,
            defaultPalette: chap.palette,
            directorRules: presetMeta.directorRules,
          },
          sourceContentSlice: sourceChunk,
          availableImages: mergedImages.map((img) => ({
            id: img.id,
            label: img.label,
            source: img.source,
          })),
          availableSfxLibrary: SFX_CATALOG.map((item) => ({
            id: item.id,
            category: item.category,
            usage: item.usage,
          })),
        };

        const chapterPrompt = `${guide}\n\n---\n\n## DỮ LIỆU CHƯƠNG ${cIdx + 1}/${outline.chapters.length}\n\`\`\`json\n${JSON.stringify(chapterPayload, null, 2)}\n\`\`\`\n\nChỉ trả về duy nhất 1 JSON object theo cấu trúc create-video-plan.v1 cho riêng Chương này.`;

        let chapScenes: CreateVideoScene[];
        try {
          if (!activePref) throw new Error("NO_ACTIVE_CODING_AGENT_CLI");
          const chapRes = await generateWithCodingAgent(activePref.agent, chapterPrompt, {
            model: activePref.model,
            quality: activePref.quality,
            speed: activePref.speed,
            imagePaths: cIdx === 0 && imagePathsForVision.length ? imagePathsForVision : undefined,
          });
          const normalizedChap = normalizeAgentCreateVideoPlan(chapRes.result, initial.options, mergedImages);
          chapScenes = normalizedChap.scenes;
          for (const hl of normalizedChap.keywordHighlights) {
            const key = hl.word.trim().toLowerCase();
            if (key && !chapterHighlightsMap.has(key) && chapterHighlightsMap.size < 48) {
              chapterHighlightsMap.set(key, hl);
            }
          }
        } catch (chapErr) {
          console.warn(`[motion-video] Chapter ${cIdx + 1} fallback:`, chapErr instanceof Error ? chapErr.message : chapErr);
          chapScenes = buildFallbackChapterScenes(chap, cIdx, outline.chapters.length, initial.options, sourceChunk, mergedImages);
        }

        const prefixedScenes = chapScenes.map((sc, sIdx) => ({
          ...sc,
          id: `c${String(cIdx + 1).padStart(2, "0")}_${String(sIdx + 1).padStart(2, "0")}`,
          chapterIndex: cIdx,
          chapterTitle: chap.title,
        }));

        completedMap[chap.id] = prefixedScenes;
        allScenes.push(...prefixedScenes);
        previousChapterTail = prefixedScenes[prefixedScenes.length - 1]?.narrationText || chap.summary;

        await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
          ...latest,
          completedChapterScenes: completedMap,
        }));
      }

      draftPlan = {
        schema: "create-video-plan.v1",
        title: outline.title,
        summary: outline.summary,
        dominantVector: outline.dominantVector,
        captionStyle: initial.options.captionStyle,
        scenes: allScenes,
        keywordHighlights: [...chapterHighlightsMap.values()].slice(0, 48),
        directorNotes: [
          `Cấu trúc ${outline.chapters.length} Chương liền mạch (${allScenes.length} phân cảnh) với Vector ${outline.dominantVector.toUpperCase()}.`,
        ],
      };
    }

    await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
      ...latest,
      status: "synthesizing_voice",
      plan: draftPlan,
      progress: initial.options.voiceMode === "omnivoice"
        ? `Đang tổng hợp giọng đọc song song cho ${draftPlan.scenes.length} phân cảnh...`
        : "Đang tính toán nhịp Kinetic Motion & hiệu ứng âm thanh...",
    }));

    const refreshed = (await readJobByFolder(ownerFolder, jobId)) || initial;
    const { lockedPlan, audioInfo } = await synthesizeAndLockPlanAudio(ownerFolder, refreshed, draftPlan, jobDir, workDir);

    await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
      ...latest,
      status: "ready",
      sourceBrief,
      images: mergedImages,
      plan: lockedPlan,
      audio: audioInfo,
      progress: `Đã hoàn tất kịch bản ${lockedPlan.scenes.length} phân cảnh! Bạn có thể xem trước, chỉnh sửa hoặc xuất MP4.`,
      error: undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể hoàn tất khởi tạo Motion Video.";
    await updateCreateVideoJob(ownerFolder, jobId, (latest) => ({
      ...latest,
      status: "failed",
      progress: "Tạm dừng do gặp sự cố.",
      error: message,
    }));
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await release();
  }
}

export async function tweakCreateVideoWithAgent(
  owner: string,
  id: string,
  instruction: string,
  chapterIndex?: number,
): Promise<CreateVideoJob> {
  const folder = createVideoOwnerFolder(owner);
  const job = await readJobByFolder(folder, id);
  if (!job || !job.plan) {
    throw new Error("Không tìm thấy kịch bản Motion để chỉnh sửa.");
  }
  if (isActiveCreateVideoJob(job)) {
    throw new Error("Dự án đang được xử lý hoặc đang kết xuất MP4. Vui lòng đợi hoàn tất trước khi chỉnh sửa.");
  }

  const guide = await readCreateVideoGuide();
  const prevNarrationSig = job.plan.scenes.map((s) => `${s.id}:${s.narrationText.trim()}`).join("|");

  const storedPref = await getCodingAgentPreference(owner).catch(() => job.agentPreference);
  const activePref = await resolveActiveAgentPreference(storedPref);
  if (!activePref) {
    throw new Error("Chưa kết nối Code Agent CLI (Codex / Claude Code / Antigravity) trong mục Cài đặt.");
  }

  let nextPlan: CreateVideoPlan;

  // Long-form chapter-scoped tweaking when > 32 scenes so Agent CLI never exceeds output tokens
  if (job.plan.scenes.length > 32) {
    const targetChapIdx = typeof chapterIndex === "number" && chapterIndex >= 0 ? chapterIndex : 0;
    const chapterScenes = job.plan.scenes.filter((s) => (s.chapterIndex ?? 0) === targetChapIdx);
    const scopedScenes = chapterScenes.length ? chapterScenes : job.plan.scenes.slice(0, 18);
    const scopedPlan: CreateVideoPlan = {
      ...job.plan,
      scenes: scopedScenes,
    };

    const prompt = `${guide}\n\n---\n\n## PHÂN CẢNH CỦA CHƯƠNG ${targetChapIdx + 1} CẦN CHỈNH SỬA\n\`\`\`json\n${JSON.stringify(scopedPlan, null, 2)}\n\`\`\`\n\n## DANH SÁCH ẢNH HIỆN CÓ\n\`\`\`json\n${JSON.stringify(job.images, null, 2)}\n\`\`\`\n\n## YÊU CẦU CHỈNH SỬA TỪ NGƯỜI DÙNG\n${instruction}\n\nHãy cập nhật JSON create-video-plan.v1 cho Chương này theo đúng yêu cầu trên và chỉ trả về duy nhất 1 JSON object hợp lệ.`;

    const generated = await generateWithCodingAgent(activePref.agent, prompt, {
      model: activePref.model,
      quality: activePref.quality,
      speed: activePref.speed,
    });
    const normalizedChunk = normalizeAgentCreateVideoPlan(generated.result, job.options, job.images);
    const chapterTitle = scopedScenes[0]?.chapterTitle;
    const splicedChunk = normalizedChunk.scenes.map((sc, idx) => ({
      ...sc,
      id: `c${String(targetChapIdx + 1).padStart(2, "0")}_${String(idx + 1).padStart(2, "0")}_${Date.now().toString(36).slice(-2)}`,
      chapterIndex: targetChapIdx,
      chapterTitle,
    }));

    const scopedIdSet = new Set(scopedScenes.map((s) => s.id));
    const firstPos = job.plan.scenes.findIndex((s) => scopedIdSet.has(s.id));
    const mergedScenes: CreateVideoScene[] = [];
    let inserted = false;
    for (let i = 0; i < job.plan.scenes.length; i++) {
      if (i === firstPos) {
        mergedScenes.push(...splicedChunk);
        inserted = true;
      }
      if (!scopedIdSet.has(job.plan.scenes[i].id)) {
        mergedScenes.push(job.plan.scenes[i]);
      }
    }
    if (!inserted) mergedScenes.push(...splicedChunk);

    const hlMap = new Map(job.plan.keywordHighlights.map((h) => [h.word.toLowerCase(), h]));
    for (const h of normalizedChunk.keywordHighlights) {
      const k = h.word.toLowerCase();
      if (!hlMap.has(k) && hlMap.size < 48) hlMap.set(k, h);
    }

    nextPlan = {
      ...job.plan,
      scenes: mergedScenes,
      keywordHighlights: [...hlMap.values()],
    };
  } else {
    const prompt = `${guide}\n\n---\n\n## KỊCH BẢN & SÂN KHẤU MOTION HIỆN TẠI\n\`\`\`json\n${JSON.stringify(job.plan, null, 2)}\n\`\`\`\n\n## DANH SÁCH ẢNH HIỆN CÓ\n\`\`\`json\n${JSON.stringify(job.images, null, 2)}\n\`\`\`\n\n## YÊU CẦU CHỈNH SỬA TỪ NGƯỜI DÙNG\n${instruction}\n\nHãy cập nhật JSON create-video-plan.v1 theo đúng yêu cầu trên (giữ nguyên các cảnh tốt không bị yêu cầu đổi) và chỉ trả về duy nhất 1 JSON object hợp lệ.`;

    const generated = await generateWithCodingAgent(activePref.agent, prompt, {
      model: activePref.model,
      quality: activePref.quality,
      speed: activePref.speed,
    });
    nextPlan = normalizeAgentCreateVideoPlan(generated.result, job.options, job.images);
  }

  const nextNarrationSig = nextPlan.scenes.map((s) => `${s.id}:${s.narrationText.trim()}`).join("|");
  let nextAudio = job.audio;

  if (nextNarrationSig !== prevNarrationSig) {
    const workDir = await mkdtemp(path.join(tmpdir(), "storyai-mv-tweak-"));
    try {
      const jobDir = createVideoJobDir(owner, job.id);
      const locked = await synthesizeAndLockPlanAudio(folder, job, nextPlan, jobDir, workDir);
      nextPlan = locked.lockedPlan;
      nextAudio = locked.audioInfo;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const saved = await updateCreateVideoJob(folder, id, (latest) => ({
    ...latest,
    plan: nextPlan,
    audio: nextAudio,
    status: latest.status === "rendered" ? "ready" : latest.status,
    render: latest.render
      ? { ...latest.render, status: latest.render.status === "ready" ? "idle" : latest.render.status, updatedAt: new Date().toISOString() }
      : undefined,
  }));

  if (!saved) throw new Error("Không lưu được bản cập nhật Motion Video.");
  return saved;
}

export async function runCreateVideoQueue(): Promise<void> {
  queue.dirty = true;
  if (queue.worker) return queue.worker;

  queue.worker = (async () => {
    while (queue.dirty) {
      queue.dirty = false;
      let ownerFolders: string[] = [];
      try {
        const entries = await readdir(createVideoRoot, { withFileTypes: true });
        ownerFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        break;
      }

      for (const folder of ownerFolders) {
        const jobs = await listJobsByFolder(folder).catch(() => [] as CreateVideoJob[]);

        // Recover interrupted intermediate jobs & orphaned renders on boot if their lock is free
        for (const job of jobs) {
          if (job.status === "ingesting_source" || job.status === "planning_outline" || job.status === "scripting_scenes" || job.status === "synthesizing_voice") {
            const release = await claimJobLock(folder, job.id);
            if (release) {
              await updateCreateVideoJob(folder, job.id, (latest) => (
                latest.status === "ingesting_source" ||
                latest.status === "planning_outline" ||
                latest.status === "scripting_scenes" ||
                latest.status === "synthesizing_voice"
                  ? { ...latest, status: "queued" }
                  : undefined
              ));
              await release();
            }
          } else if (job.status === "rendering") {
            const live = await hasLiveCreateVideoRenderLock(folder, job.id);
            if (!live) {
              const now = new Date().toISOString();
              await updateCreateVideoJob(folder, job.id, (latest) => (
                latest.status === "rendering"
                  ? {
                      ...latest,
                      status: latest.plan ? "ready" : "failed",
                      progress: "Tiến trình xuất MP4 trước đó bị gián đoạn khi khởi động lại máy chủ. Bạn có thể bấm Xuất Video MP4 lại.",
                      render: {
                        ...latest.render,
                        status: "failed",
                        error: "Tiến trình xuất MP4 bị gián đoạn trước khi hoàn tất.",
                        updatedAt: now,
                      },
                    }
                  : undefined
              ));
            }
          }
        }

        const refreshedJobs = await listJobsByFolder(folder).catch(() => [] as CreateVideoJob[]);
        const candidates = refreshedJobs
          .filter((j) => isActiveCreateVideoJob(j) && j.status !== "rendering")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        for (const candidate of candidates) {
          await processSingleCreateVideoJob(folder, candidate.id);
        }
      }
    }
  })().finally(() => {
    queue.worker = undefined;
  });

  return queue.worker;
}

import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateWithCodingAgent } from "./coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "./coding-agent-preferences";
import {
  AUTO_EDIT_PRESETS,
  buildCandidateSegments,
  computeAutoEditTimeline,
  normalizeAgentAutoEditEdl,
  type AutoEditEdl,
  type AutoEditJob,
  type AutoEditJobSummary,
  type AutoEditOptions,
  type AutoEditProductImage,
  type AutoEditSourceVideo,
} from "./auto-edit";
import { analyzeAutoEditMedia, type ContactSheetEvidence } from "./auto-edit-media";
import { autoEditJobMediaDir, autoEditOwnerFolder, autoEditRoot, isValidUuid } from "./auto-edit-upload";
import { pickDefaultOverlaySfx, SFX_CATALOG } from "./sfx-library";

const maxActiveJobsPerUser = 5;
const staleJobLockMs = 30 * 60_000;
const guideCandidates = [
  path.join(process.cwd(), "prompts", "auto-edit-code-agent-guide.md"),
  path.resolve(process.cwd(), "..", "..", "prompts", "auto-edit-code-agent-guide.md"),
];

const runtime = globalThis as typeof globalThis & {
  storyAiAutoEdit?: {
    bootId: string;
    dirty: boolean;
    worker?: Promise<void>;
    writes: Promise<unknown>;
    pendingRenders: Set<string>;
  };
};
const queue = (runtime.storyAiAutoEdit ??= {
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

function isActiveJob(job: AutoEditJob) {
  return job.status === "queued" || job.status === "analyzing_media" || job.status === "directing" || job.status === "rendering";
}

function serializeWrite<T>(write: () => Promise<T>) {
  const pending = queue.writes.then(write);
  queue.writes = pending.catch(() => undefined);
  return pending;
}

function ownerJobsFileDir(ownerFolder: string) {
  return path.join(autoEditRoot, ownerFolder);
}

async function readJobByFolder(folder: string, id: string): Promise<AutoEditJob | undefined> {
  if (!isValidUuid(id)) return undefined;
  try {
    return JSON.parse(await readFile(path.join(ownerJobsFileDir(folder), `${id}.json`), "utf8")) as AutoEditJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function saveJobByFolder(folder: string, job: AutoEditJob) {
  const dir = ownerJobsFileDir(folder);
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

async function listJobsByFolder(folder: string): Promise<AutoEditJob[]> {
  try {
    const entries = await readdir(ownerJobsFileDir(folder), { withFileTypes: true });
    const jobs = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => readJobByFolder(folder, e.name.slice(0, -5))),
    );
    return jobs.filter((j): j is AutoEditJob => Boolean(j));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function claimJobLock(folder: string, id: string) {
  const lockPath = path.join(ownerJobsFileDir(folder), `.${id}.lock`);
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
      const alive = isPidAlive(ownerPid);
      if (alive || !details || Date.now() - details.mtimeMs < staleJobLockMs) return undefined;
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  return undefined;
}

export function markAutoEditRenderPending(jobId: string) {
  queue.pendingRenders.add(jobId);
}

export function clearAutoEditRenderPending(jobId: string) {
  queue.pendingRenders.delete(jobId);
}

export async function hasLiveAutoEditRenderLock(folder: string, id: string): Promise<boolean> {
  if (queue.pendingRenders.has(id)) return true;
  const lockPath = path.join(ownerJobsFileDir(folder), `.${id}.render.lock`);
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown; bootId?: unknown };
    const pid = Number(parsed.pid);
    return parsed.bootId === queue.bootId && isPidAlive(pid);
  } catch {
    return false;
  }
}

export async function claimAutoEditRenderLock(folder: string, id: string) {
  const lockPath = path.join(ownerJobsFileDir(folder), `.${id}.render.lock`);
  await mkdir(ownerJobsFileDir(folder), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, bootId: queue.bootId, claimedAt: new Date().toISOString() }),
        );
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
      if (bootId === queue.bootId && isPidAlive(pid)) {
        return undefined;
      }
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  return undefined;
}

export async function getAutoEditJob(owner: string, id: string) {
  const folder = autoEditOwnerFolder(owner);
  const job = await readJobByFolder(folder, id);
  if (job && isActiveJob(job)) {
    void runAutoEditQueue().catch(() => undefined);
  }
  return job;
}

export async function listAutoEditJobs(owner: string): Promise<AutoEditJobSummary[]> {
  const jobs = await listJobsByFolder(autoEditOwnerFolder(owner));
  if (jobs.some(isActiveJob)) {
    void runAutoEditQueue().catch(() => undefined);
  }
  return jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map((job) => {
      const computed = job.edl
        ? computeAutoEditTimeline(job.edl, job.analysis?.words || [], job.options.aspectRatio, job.analysis?.rawDurationMs)
        : undefined;
      return {
        id: job.id,
        title: job.edl?.title || job.options.title || job.options.productName || job.videos[0]?.filename || "Video Auto Edit",
        preset: job.options.preset,
        aspectRatio: job.options.aspectRatio,
        status: job.status,
        progress: job.progress,
        error: job.error,
        videoCount: job.videos.length,
        imageCount: job.images.length,
        rawDurationMs: job.analysis?.rawDurationMs,
        editedDurationMs: computed?.totalDurationMs,
        cutCount: computed?.cutCount,
        renderReady: job.render?.status === "ready" && Boolean(job.render.outputPath),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    });
}

export async function canEnqueueAutoEditJob(owner: string): Promise<boolean> {
  const folder = autoEditOwnerFolder(owner);
  const allJobs = await listJobsByFolder(folder);
  return allJobs.filter(isActiveJob).length < maxActiveJobsPerUser;
}

export function createQueuedAutoEditJob(
  owner: string,
  jobId: string,
  options: AutoEditOptions,
  videos: AutoEditSourceVideo[],
  images: AutoEditProductImage[],
  agentPreferenceInput?: CodingAgentPreference,
) {
  return serializeWrite(async () => {
    const folder = autoEditOwnerFolder(owner);
    const existing = await readJobByFolder(folder, jobId);
    if (existing) return existing.id;
    const allJobs = await listJobsByFolder(folder);
    if (allJobs.filter(isActiveJob).length >= maxActiveJobsPerUser) return undefined;
    const agentPreference = agentPreferenceInput ?? await getCodingAgentPreference(owner).catch(() => undefined);
    const now = new Date().toISOString();
    const job: AutoEditJob = {
      id: jobId,
      options,
      status: "queued",
      progress: "Đang chờ tới lượt xử lý trong hàng đợi...",
      agentPreference,
      videos,
      images,
      createdAt: now,
      updatedAt: now,
    };
    await saveJobByFolder(folder, job);
    return job.id;
  });
}

export function updateAutoEditJob(
  ownerFolder: string,
  jobId: string,
  updater: (latest: AutoEditJob) => AutoEditJob | undefined,
): Promise<AutoEditJob | undefined> {
  return serializeWrite(async () => {
    const latest = await readJobByFolder(ownerFolder, jobId);
    if (!latest) return undefined;
    const next = updater(latest);
    if (!next) return latest;
    const saved: AutoEditJob = { ...next, updatedAt: new Date().toISOString() };
    await saveJobByFolder(ownerFolder, saved);
    return saved;
  });
}

export function updateAutoEditJobEdl(
  owner: string,
  id: string,
  edl: AutoEditEdl,
  optionsPatch?: Partial<AutoEditOptions>,
) {
  return updateAutoEditJob(autoEditOwnerFolder(owner), id, (job) => {
    const nextOptions: AutoEditOptions = optionsPatch
      ? { ...job.options, ...optionsPatch }
      : job.options;
    const now = new Date().toISOString();
    return {
      ...job,
      options: nextOptions,
      edl,
      status: job.status === "rendered" ? "ready" : job.status,
      render: job.render ? { ...job.render, status: job.render.status === "ready" ? "idle" : job.render.status, updatedAt: now } : undefined,
      updatedAt: now,
    };
  });
}

export function saveAutoEditJobState(ownerFolder: string, job: AutoEditJob) {
  return serializeWrite(async () => {
    const latest = await readJobByFolder(ownerFolder, job.id);
    const merged: AutoEditJob = latest
      ? { ...latest, ...job, updatedAt: new Date().toISOString() }
      : { ...job, updatedAt: new Date().toISOString() };
    await saveJobByFolder(ownerFolder, merged);
  });
}

export function retryAutoEditJob(owner: string, id: string) {
  return serializeWrite(async () => {
    const folder = autoEditOwnerFolder(owner);
    const job = await readJobByFolder(folder, id);
    if (!job) return "missing" as const;
    if (isActiveJob(job)) return "busy" as const;
    const latestPref = await getCodingAgentPreference(owner).catch(() => job.agentPreference);
    await saveJobByFolder(folder, {
      ...job,
      agentPreference: latestPref ?? job.agentPreference,
      status: "queued",
      progress: "Đã đưa lại vào hàng đợi phân tích & dựng tự động...",
      error: undefined,
      updatedAt: new Date().toISOString(),
    });
    return "queued" as const;
  });
}

function buildHeuristicFallbackEdl(
  job: AutoEditJob,
  candidateSegments: ReturnType<typeof buildCandidateSegments>,
): AutoEditEdl {
  const presetInfo = AUTO_EDIT_PRESETS.find((p) => p.id === job.options.preset) || AUTO_EDIT_PRESETS[0];
  const kept = candidateSegments.filter((s) => s.keep);
  const subjectLabel = job.options.productName || job.options.title || presetInfo.badge;
  const hookTitle = job.options.productName
    ? job.options.preset === "tutorial-saas" || job.options.preset === "edu-course"
      ? `HƯỚNG DẪN ${job.options.productName.toUpperCase()} TỪ A→Z`
      : job.options.preset === "news-recap"
        ? `TIÊU ĐIỂM: ${job.options.productName.toUpperCase()}`
        : `${job.options.productName.toUpperCase()} CÓ GÌ ĐẶC BIỆT?`
    : (job.options.title || presetInfo.label.replace(/^[^\p{L}\p{N}]+/gu, "")).toUpperCase().slice(0, 60);

  const hookEmoji =
    job.options.preset === "tutorial-saas" ? "💻"
      : job.options.preset === "podcast-talk" ? "🎙️"
        : job.options.preset === "edu-course" ? "🎓"
          : job.options.preset === "real-estate" ? "🏢"
            : job.options.preset === "food-mukbang" ? "🍜"
              : job.options.preset === "vlog-travel" ? "✈️"
                : job.options.preset === "gaming-highlight" ? "🎮"
                  : job.options.preset === "news-recap" ? "📰"
                    : job.options.preset === "minimal-aesthetic" ? "✨"
                      : "🔥";

  const overlays: AutoEditEdl["overlays"] = [
    {
      id: "ov_hook_01",
      kind: "hook_banner",
      anchorSegmentId: kept[0]?.id,
      offsetMs: 0,
      durationMs: 2_800,
      layout: "center-pop",
      badge: presetInfo.badge.toUpperCase().slice(0, 32),
      title: hookTitle,
      subtitle: job.options.productHighlights.split(/\r?\n|[,;•]/u)[0]?.trim().slice(0, 80) || undefined,
      emoji: hookEmoji,
      accentColor:
        job.options.preset === "minimal-aesthetic" || job.options.preset === "tutorial-saas" || job.options.preset === "edu-course"
          ? "cyan"
          : job.options.preset === "real-estate"
            ? "emerald"
            : "amber",
      sfxId: job.options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "hook_banner" }, 0, job.options.preset) : undefined,
    },
  ];

  job.images.forEach((img, index) => {
    const targetSeg = kept[Math.min(kept.length - 1, Math.max(0, Math.floor(((index + 1) * kept.length) / (job.images.length + 1))))];
    const layout =
      presetInfo.preferredCardLayout === "stage-3d"
        ? "stage-3d"
        : presetInfo.preferredCardLayout === "split-top"
          ? "split-top"
          : index % 2 === 0
            ? "floating-right"
            : "floating-left";
    overlays.push({
      id: `ov_prod_${index + 1}`,
      kind: "product_card",
      anchorSegmentId: targetSeg?.id,
      offsetMs: index === 0 ? 1_200 : 400,
      durationMs: 3_600,
      imageId: img.id,
      layout,
      badge: subjectLabel.slice(0, 36) || "ĐIỂM NHẤN",
      title: img.label || job.options.productName || `Điểm nhấn #${index + 1}`,
      subtitle: job.options.productHighlights.split(/\r?\n|[•;]/u)[index]?.trim().slice(0, 90) || "Chi tiết thực tế",
      emoji: index % 2 === 0 ? "✨" : "⚡",
      accentColor: index % 2 === 0 ? "emerald" : "amber",
      sfxId: job.options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "product_card", title: img.label }, index, job.options.preset) : undefined,
      hyperframesHtml: "<div class=\"hf-meter\"><div class=\"hf-meter-bar\"></div></div>",
      hyperframesCss: ".hf-meter{height:5px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:6px}.hf-meter-bar{height:100%;width:calc(var(--hf-progress,1)*100%);background:linear-gradient(90deg,#34d399,#fbbf24)}",
    });
  });

  // Add topic-specific Pro FX annotations when suitable segments exist
  if ((job.options.preset === "tutorial-saas" || job.options.preset === "edu-course") && kept.length >= 3) {
    const midSeg = kept[Math.floor(kept.length * 0.45)];
    overlays.push({
      id: "ov_auto_spot",
      kind: "spotlight_box",
      anchorSegmentId: midSeg?.id,
      offsetMs: 400,
      durationMs: 2_600,
      layout: "center-pop",
      title: "Thao tác quan trọng",
      emoji: "👆",
      accentColor: "amber",
      targetX: 0.5,
      targetY: 0.54,
      targetW: 0.28,
      targetH: 0.14,
      sfxId: job.options.autoSfx !== false ? "mouse-clicks" : undefined,
    });
  } else if ((job.options.preset === "gaming-highlight" || job.options.preset === "tech-unbox") && kept.length >= 2) {
    const climaxSeg = kept[kept.length - 1];
    overlays.push({
      id: "ov_auto_freeze",
      kind: "freeze_frame",
      anchorSegmentId: climaxSeg?.id,
      offsetMs: 200,
      durationMs: 1_500,
      layout: "center-pop",
      badge: "HIGHLIGHT FOCUS",
      title: subjectLabel.slice(0, 48),
      accentColor: "cyan",
      sfxId: job.options.autoSfx !== false ? "camera-shutter" : undefined,
    });
  }

  // Pick top frequent meaningful words to highlight (capped at 48 chars per word)
  const freq = new Map<string, number>();
  for (const w of job.analysis?.words || []) {
    const clean = w.text.replace(/[.,!?;:"'()[\]{}]+/gu, "").trim().slice(0, 48);
    if (clean.length >= 4 && !w.filler) freq.set(clean, (freq.get(clean) || 0) + 1);
  }
  const keywordHighlights = [...freq.entries()]
    .slice(0, 12)
    .map(([word], idx) => ({
      word: word.slice(0, 48),
      color: (["amber", "emerald", "cyan", "rose"] as const)[idx % 4],
      emoji: job.options.preset === "vlog-travel" || job.options.preset === "minimal-aesthetic" ? undefined : idx % 3 === 0 ? "✨" : undefined,
    }));

  return {
    schema: "auto-edit-edl.v1",
    title: job.options.title || job.options.productName || `Bản dựng ${presetInfo.label}`,
    summary: `Template "${presetInfo.label}": Đã lọc ${candidateSegments.filter((s) => !s.keep).length} khoảng lặng/từ thừa, luân phiên Dynamic Zoom và dàn dựng ${overlays.length} lớp đồ hoạ.`,
    hookHeadline: hookTitle,
    hookEmoji,
    captionStyle: presetInfo.defaultCaptionStyle,
    segments: candidateSegments,
    overlays,
    keywordHighlights,
    directorNotes: [
      `Áp dụng quy chuẩn Template "${presetInfo.label}" (${presetInfo.badge}).`,
      presetInfo.directorRules,
    ],
  };
}

async function readDirectorGuide(): Promise<string> {
  for (const candidate of guideCandidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try next path candidate
    }
  }
  return "";
}

async function buildDirectorPrompt(
  job: AutoEditJob,
  candidateSegments: ReturnType<typeof buildCandidateSegments>,
  contactSheets: readonly ContactSheetEvidence[],
  attachedImageNote: string[],
  tweakInstruction?: string,
) {
  const guide = await readDirectorGuide();
  const presetInfo = AUTO_EDIT_PRESETS.find((p) => p.id === job.options.preset) || AUTO_EDIT_PRESETS[0];

  const compactWords = (job.analysis?.words || []).slice(0, 900).map((w) => ({
    clip: w.clipId,
    w: w.text,
    s: w.startMs,
    e: w.endMs,
    ...(w.filler ? { filler: true } : {}),
  }));

  const payload = {
    task: tweakInstruction ? "REFINE_EXISTING_AUTO_EDIT_EDL" : "CREATE_AUTO_EDIT_EDL",
    language: job.options.language,
    aspectRatio: job.options.aspectRatio,
    safeZoneGuard: job.options.safeZoneGuard,
    preset: {
      id: presetInfo.id,
      category: presetInfo.category,
      badge: presetInfo.badge,
      label: presetInfo.label,
      summary: presetInfo.summary,
      defaultCaptionStyle: presetInfo.defaultCaptionStyle,
      preferredCardLayout: presetInfo.preferredCardLayout,
      directorRules: presetInfo.directorRules,
    },
    userBrief: {
      title: job.options.title,
      productName: job.options.productName,
      productHighlights: job.options.productHighlights,
      direction: job.options.direction,
      ...(tweakInstruction ? { userTweakRequest: tweakInstruction } : {}),
    },
    sourceVideos: job.videos.map((v) => ({
      clipId: v.id,
      filename: v.filename,
      durationMs: v.durationMs,
      aspectRatio: v.aspectRatio,
      hasAudio: v.hasAudio,
    })),
    productImages: job.images.map((img) => ({
      imageId: img.id,
      filename: img.filename,
      label: img.label,
      dimensions: `${img.width}x${img.height}`,
    })),
    availableSfxLibrary: job.options.autoSfx !== false
      ? SFX_CATALOG.map((s) => ({ id: s.id, category: s.category, durationMs: s.durationMs, usage: s.usage }))
      : [],
    attachedVisualOrder: attachedImageNote,
    contactSheetRows: contactSheets.map((s, idx) => ({ sheetIndex: idx + 1, rows: s.rows })),
    transcriptEvidence: {
      kind: job.analysis?.transcriptKind || "acoustic_only",
      whisperBackend: job.analysis?.whisperBackend || "none",
      wordCount: job.analysis?.words.length || 0,
      wordsSample: compactWords,
      detectedPauses: (job.analysis?.pauses || []).slice(0, 120),
    },
    candidateSegments,
    ...(tweakInstruction && job.edl ? { currentEdl: job.edl } : {}),
  };

  return [
    guide,
    "\n--- DỮ LIỆU ĐẦU VÀO CỦA JOB CẦN DỰNG ---\n",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

async function resolveOwnerAgent(job: AutoEditJob): Promise<CodingAgentPreference | undefined> {
  // Respect user's stored Agent/Model/Quality/Speed preference when CLI is available
  const { getCodingAgentCliStatuses } = await import("./coding-agent-cli");
  const statuses = await getCodingAgentCliStatuses({ includeModels: false });
  const available = statuses.filter((s) => s.available);
  if (!available.length) return undefined;

  const stored = job.agentPreference;
  if (stored && available.some((s) => s.id === stored.agent)) {
    return stored;
  }

  const envPinned = process.env.STORYAI_SALES_UGC_AGENT?.trim();
  const preferred = available.find((s) => s.id === envPinned) || available[0];
  return {
    agent: preferred.id,
    model: "",
    quality: "auto",
    speed: "standard",
  };
}

export async function tweakAutoEditJobWithAgent(
  owner: string,
  jobId: string,
  instruction: string,
): Promise<AutoEditJob> {
  const folder = autoEditOwnerFolder(owner);
  const job = await readJobByFolder(folder, jobId);
  if (!job || !job.edl || !job.analysis) {
    throw new Error("Bản dựng chưa sẵn sàng để chỉnh sửa bằng AI Co-pilot.");
  }

  const pref = await getCodingAgentPreference(owner);
  const { getCodingAgentCliStatuses } = await import("./coding-agent-cli");
  const statuses = await getCodingAgentCliStatuses({ includeModels: false });
  const activeAgent: CodingAgentPreference | undefined =
    pref && statuses.some((s) => s.id === pref.agent && s.available)
      ? pref
      : statuses.find((s) => s.available)
        ? { agent: statuses.find((s) => s.available)!.id, model: "", quality: "auto", speed: "standard" }
        : undefined;

  if (!activeAgent) {
    throw new Error("Chưa kết nối Code Agent CLI (Codex / Claude Code / Antigravity) trong mục Cài đặt.");
  }

  const mediaDir = autoEditJobMediaDir(owner, job.id);
  const imageFiles = job.images.slice(0, 20).map((img) => path.join(mediaDir, "images", `${img.id}.png`));
  const imageNotes = job.images.slice(0, 20).map((img, i) => `Attached image #${i + 1}: ${img.id} (${img.label})`);
  const candidateSegments = job.edl.segments;

  const prompt = await buildDirectorPrompt(job, candidateSegments, [], imageNotes, instruction);
  const response = await generateWithCodingAgent(activeAgent.agent, prompt, {
    model: activeAgent.model,
    quality: activeAgent.quality,
    speed: activeAgent.speed,
    imagePaths: imageFiles,
  });

  const normalizedEdl = normalizeAgentAutoEditEdl(
    response.result,
    job.videos,
    job.images,
    job.analysis.words,
    candidateSegments,
    job.options,
  );

  const updated: AutoEditJob = {
    ...job,
    agentLabel: response.model,
    edl: normalizedEdl,
    status: "ready",
    render: job.render ? { ...job.render, status: "idle", updatedAt: new Date().toISOString() } : undefined,
    updatedAt: new Date().toISOString(),
  };
  await serializeWrite(() => saveJobByFolder(folder, updated));
  return updated;
}

async function processSingleQueuedJob(folder: string, jobId: string) {
  const release = await claimJobLock(folder, jobId);
  if (!release) return;

  const workDir = await mkdtemp(path.join(tmpdir(), "storyai-autoedit-"));
  try {
    const job = await readJobByFolder(folder, jobId);
    if (!job || job.status !== "queued") return;

    const jobMediaDir = path.join(autoEditRoot, folder, "jobs", job.id);

    await saveAutoEditJobState(folder, {
      ...job,
      status: "analyzing_media",
      progress: "Đang trích xuất âm thanh Whisper word-level, đo khoảng lặng VAD & tạo Contact Sheet...",
      error: undefined,
    });

    const { videos, analysis, contactSheets } = await analyzeAutoEditMedia(jobMediaDir, workDir, job.videos, job.options);
    const candidateSegments = buildCandidateSegments(videos, analysis.words, analysis.pauses, job.options.silenceThresholdMs);

    await saveAutoEditJobState(folder, {
      ...job,
      videos,
      analysis,
      status: "directing",
      progress: "Code Agent CLI đang phân tích lỗi nói vấp, chọn góc Punch-in & thiết kế thẻ sản phẩm HyperFrames...",
    });

    const agentPref = await resolveOwnerAgent(job);
    let finalEdl: AutoEditEdl;
    let agentLabel = "Smart Acoustic + Heuristic Director";

    if (agentPref) {
      try {
        const attachedPaths: string[] = [];
        const attachedNotes: string[] = [];
        for (const sheet of contactSheets.slice(0, 4)) {
          attachedPaths.push(sheet.imagePath);
          attachedNotes.push(`Attached image #${attachedPaths.length}: Video frame contact sheet (${sheet.rows.map((r) => r.clipId).join(", ")})`);
        }
        for (const img of job.images.slice(0, 20)) {
          const p = path.join(jobMediaDir, "images", `${img.id}.png`);
          attachedPaths.push(p);
          attachedNotes.push(`Attached image #${attachedPaths.length}: Product/Illustration ${img.id} — "${img.label}"`);
        }

        const prompt = await buildDirectorPrompt(
          { ...job, videos, analysis },
          candidateSegments,
          contactSheets,
          attachedNotes,
        );
        const generated = await generateWithCodingAgent(agentPref.agent, prompt, {
          model: agentPref.model,
          quality: agentPref.quality,
          speed: agentPref.speed,
          imagePaths: attachedPaths,
        });
        finalEdl = normalizeAgentAutoEditEdl(
          generated.result,
          videos,
          job.images,
          analysis.words,
          candidateSegments,
          job.options,
        );
        agentLabel = generated.model;
      } catch (agentError) {
        console.warn("[auto-edit] Agent CLI fallback to heuristic EDL:", agentError);
        finalEdl = buildHeuristicFallbackEdl({ ...job, videos, analysis }, candidateSegments);
        agentLabel = "Acoustic VAD Fallback (Code Agent bận hoặc chưa phản hồi)";
      }
    } else {
      finalEdl = buildHeuristicFallbackEdl({ ...job, videos, analysis }, candidateSegments);
    }

    await saveAutoEditJobState(folder, {
      ...job,
      videos,
      analysis,
      edl: finalEdl,
      agentLabel,
      status: "ready",
      progress: undefined,
      error: undefined,
    });
  } catch (error) {
    const current = await readJobByFolder(folder, jobId).catch(() => undefined);
    if (current) {
      await saveAutoEditJobState(folder, {
        ...current,
        status: "failed",
        progress: undefined,
        error: error instanceof Error ? error.message : "Không thể xử lý tự động tệp video này.",
      });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await release();
  }
}

export function runAutoEditQueue() {
  queue.dirty = true;
  if (queue.worker) return queue.worker;

  queue.worker = (async () => {
    while (queue.dirty) {
      queue.dirty = false;
      let ownerFolders: string[] = [];
      try {
        const entries = await readdir(autoEditRoot, { withFileTypes: true });
        ownerFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        ownerFolders = [];
      }

      for (const folder of ownerFolders) {
        const jobs = await listJobsByFolder(folder);
        // Recover interrupted intermediate states after a server restart if lock is free
        for (const job of jobs) {
          if (job.status === "analyzing_media" || job.status === "directing") {
            const release = await claimJobLock(folder, job.id);
            if (release) {
              await updateAutoEditJob(folder, job.id, (latest) => (
                latest.status === "analyzing_media" || latest.status === "directing"
                  ? { ...latest, status: "queued" }
                  : undefined
              ));
              await release();
            }
          } else if (job.status === "rendering") {
            const liveRender = await hasLiveAutoEditRenderLock(folder, job.id);
            if (!liveRender) {
              const now = new Date().toISOString();
              await updateAutoEditJob(folder, job.id, (latest) => {
                if (latest.status !== "rendering") return undefined;
                return {
                  ...latest,
                  status: "ready",
                  progress: undefined,
                  render: {
                    ...latest.render,
                    status: "failed",
                    error: "Tiến trình xuất MP4 bị gián đoạn khi máy chủ khởi động lại. Bạn có thể bấm Xuất MP4 lại.",
                    updatedAt: now,
                  },
                  updatedAt: now,
                };
              });
            }
          }
        }
        const queued = (await listJobsByFolder(folder))
          .filter((j) => j.status === "queued")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        for (const next of queued) {
          await processSingleQueuedJob(folder, next.id);
          queue.dirty = true;
        }
      }
    }
  })().finally(() => {
    queue.worker = undefined;
  });

  return queue.worker;
}

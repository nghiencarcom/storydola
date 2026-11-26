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
const guidePath = path.join(process.cwd(), "prompts", "auto-edit-code-agent-guide.md");

const runtime = globalThis as typeof globalThis & {
  storyAiAutoEdit?: { dirty: boolean; worker?: Promise<void>; writes: Promise<unknown> };
};
const queue = (runtime.storyAiAutoEdit ??= { dirty: false, writes: Promise.resolve() });

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
      let alive = false;
      if (Number.isInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
          alive = true;
        } catch (cause) {
          alive = (cause as NodeJS.ErrnoException).code === "EPERM";
        }
      }
      if (alive || !details || Date.now() - details.mtimeMs < staleJobLockMs) return undefined;
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  return undefined;
}

export function getAutoEditJob(owner: string, id: string) {
  return readJobByFolder(autoEditOwnerFolder(owner), id);
}

export async function listAutoEditJobs(owner: string): Promise<AutoEditJobSummary[]> {
  const jobs = await listJobsByFolder(autoEditOwnerFolder(owner));
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

export function createQueuedAutoEditJob(
  owner: string,
  jobId: string,
  options: AutoEditOptions,
  videos: AutoEditSourceVideo[],
  images: AutoEditProductImage[],
) {
  return serializeWrite(async () => {
    const folder = autoEditOwnerFolder(owner);
    const existing = await readJobByFolder(folder, jobId);
    if (existing) return existing.id;
    const allJobs = await listJobsByFolder(folder);
    if (allJobs.filter(isActiveJob).length >= maxActiveJobsPerUser) return undefined;
    const now = new Date().toISOString();
    const job: AutoEditJob = {
      id: jobId,
      options,
      status: "queued",
      progress: "Đang chờ tới lượt xử lý trong hàng đợi...",
      videos,
      images,
      createdAt: now,
      updatedAt: now,
    };
    await saveJobByFolder(folder, job);
    return job.id;
  });
}

export function updateAutoEditJobEdl(
  owner: string,
  id: string,
  edl: AutoEditEdl,
  optionsPatch?: Partial<AutoEditOptions>,
) {
  return serializeWrite(async () => {
    const folder = autoEditOwnerFolder(owner);
    const job = await readJobByFolder(folder, id);
    if (!job) return undefined;
    const nextOptions: AutoEditOptions = optionsPatch
      ? { ...job.options, ...optionsPatch }
      : job.options;
    const updated: AutoEditJob = {
      ...job,
      options: nextOptions,
      edl,
      status: job.status === "rendered" ? "ready" : job.status,
      render: job.render ? { ...job.render, status: job.render.status === "ready" ? "idle" : job.render.status, updatedAt: new Date().toISOString() } : undefined,
      updatedAt: new Date().toISOString(),
    };
    await saveJobByFolder(folder, updated);
    return updated;
  });
}

export function saveAutoEditJobState(ownerFolder: string, job: AutoEditJob) {
  return serializeWrite(() => saveJobByFolder(ownerFolder, { ...job, updatedAt: new Date().toISOString() }));
}

export function retryAutoEditJob(owner: string, id: string) {
  return serializeWrite(async () => {
    const folder = autoEditOwnerFolder(owner);
    const job = await readJobByFolder(folder, id);
    if (!job) return "missing" as const;
    if (isActiveJob(job)) return "busy" as const;
    await saveJobByFolder(folder, {
      ...job,
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
  const kept = candidateSegments.filter((s) => s.keep);
  const hookTitle = job.options.productName
    ? `${job.options.productName.toUpperCase()} CÓ ĐÁNG TIỀN?`
    : (job.options.title || "BẢN DỰNG TỰ ĐỘNG NỔI BẬT").toUpperCase().slice(0, 60);

  const overlays: AutoEditEdl["overlays"] = [
    {
      id: "ov_hook_01",
      kind: "hook_banner",
      anchorSegmentId: kept[0]?.id,
      offsetMs: 0,
      durationMs: 2_800,
      layout: "center-pop",
      badge: job.options.productName || "AUTO EDIT",
      title: hookTitle,
      subtitle: job.options.productHighlights.split(/\r?\n|[,;•]/u)[0]?.trim().slice(0, 80) || undefined,
      emoji: "🔥",
      accentColor: job.options.preset === "minimal-aesthetic" ? "cyan" : "amber",
      sfxId: job.options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "hook_banner" }, 0, job.options.preset) : undefined,
    },
  ];

  job.images.forEach((img, index) => {
    const targetSeg = kept[Math.min(kept.length - 1, Math.max(0, Math.floor(((index + 1) * kept.length) / (job.images.length + 1))))];
    overlays.push({
      id: `ov_prod_${index + 1}`,
      kind: "product_card",
      anchorSegmentId: targetSeg?.id,
      offsetMs: index === 0 ? 1_200 : 400,
      durationMs: 3_400,
      imageId: img.id,
      layout: index % 2 === 0 ? "floating-right" : "floating-left",
      badge: job.options.productName || "SẢN PHẨM",
      title: img.label || job.options.productName || `Điểm nhấn #${index + 1}`,
      subtitle: job.options.productHighlights.split(/\r?\n|[•;]/u)[index]?.trim().slice(0, 90) || "Chi tiết thực tế",
      emoji: index % 2 === 0 ? "✨" : "⚡",
      accentColor: index % 2 === 0 ? "emerald" : "amber",
      sfxId: job.options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "product_card", title: img.label }, index, job.options.preset) : undefined,
      hyperframesHtml: "<div class=\"hf-meter\"><div class=\"hf-meter-bar\"></div></div>",
      hyperframesCss: ".hf-meter{height:5px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:6px}.hf-meter-bar{height:100%;width:calc(var(--hf-progress,1)*100%);background:linear-gradient(90deg,#34d399,#fbbf24)}",
    });
  });

  // Pick top frequent meaningful words to highlight
  const freq = new Map<string, number>();
  for (const w of job.analysis?.words || []) {
    const clean = w.text.replace(/[.,!?;:"'()[\]{}]+/gu, "").trim();
    if (clean.length >= 4 && !w.filler) freq.set(clean, (freq.get(clean) || 0) + 1);
  }
  const keywordHighlights = [...freq.entries()]
    .slice(0, 12)
    .map(([word], idx) => ({
      word,
      color: (["amber", "emerald", "cyan", "rose"] as const)[idx % 4],
      emoji: idx % 3 === 0 ? "✨" : undefined,
    }));

  return {
    schema: "auto-edit-edl.v1",
    title: job.options.title || job.options.productName || "Bản dựng Auto Edit",
    summary: `Đã tự động lọc ${candidateSegments.filter((s) => !s.keep).length} khoảng lặng/từ thừa, luân phiên Dynamic Zoom giấu vết cắt và chèn ${job.images.length} ảnh minh hoạ.`,
    hookHeadline: hookTitle,
    hookEmoji: "🔥",
    captionStyle: job.options.preset === "minimal-aesthetic" ? "clean-pill" : "karaoke-pop",
    segments: candidateSegments,
    overlays,
    keywordHighlights,
    directorNotes: [
      "Tự động cắt khoảng chết đầu/cuối clip và các khoảng nghỉ vượt ngưỡng cài đặt.",
      "Tự động gán Punch-in Zoom xen kẽ trên các đoạn cắt liên tiếp.",
    ],
  };
}

async function buildDirectorPrompt(
  job: AutoEditJob,
  candidateSegments: ReturnType<typeof buildCandidateSegments>,
  contactSheets: readonly ContactSheetEvidence[],
  attachedImageNote: string[],
  tweakInstruction?: string,
) {
  const guide = await readFile(guidePath, "utf8").catch(() => "");
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
    preset: { id: presetInfo.id, label: presetInfo.label, summary: presetInfo.summary },
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

async function resolveOwnerAgent(ownerFolder: string): Promise<CodingAgentPreference | undefined> {
  // Check stored preference or default to available CLI agent
  const { getCodingAgentCliStatuses } = await import("./coding-agent-cli");
  const statuses = await getCodingAgentCliStatuses({ includeModels: false });
  const available = statuses.filter((s) => s.available);
  if (!available.length) return undefined;

  // Owner preferences are keyed by raw owner ID when called from API, or fallback to first available CLI
  void ownerFolder;
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

    const agentPref = await resolveOwnerAgent(folder);
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
              await saveAutoEditJobState(folder, { ...job, status: "queued" });
              await release();
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

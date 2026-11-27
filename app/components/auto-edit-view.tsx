"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AUTO_EDIT_PRESET_CATEGORIES,
  AUTO_EDIT_PRESETS,
  computeAutoEditTimeline,
  type AutoEditAspectRatio,
  type AutoEditCardLayout,
  type AutoEditCutReason,
  type AutoEditEdl,
  type AutoEditJob,
  type AutoEditJobSummary,
  type AutoEditOverlay,
  type AutoEditPresetCategory,
  type AutoEditPresetId,
  type AutoEditStage,
  type AutoEditVerticalFit,
} from "../lib/auto-edit";
import { AutoEditRemotionComposition } from "./auto-edit-remotion-composition";
import { SFX_CATALOG, SFX_CATEGORY_LABELS, type SfxCategory } from "../lib/sfx-library";
import { Icon } from "./ui-icon";

const uploadChunkSize = 32 * 1024 * 1024;

function formatBytesHuman(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const statusLabels: Record<AutoEditStage, string> = {
  uploading: "Đang nạp tệp",
  queued: "Đang chờ",
  analyzing_media: "Whisper + VAD đang gỡ băng",
  directing: "Code Agent đang dựng",
  ready: "Sẵn sàng duyệt",
  rendering: "Đang xuất MP4",
  rendered: "Đã xuất MP4",
  failed: "Thất bại",
};

const statusBadgeClasses: Record<AutoEditStage, string> = {
  uploading: "processing",
  queued: "draft",
  analyzing_media: "processing",
  directing: "processing",
  ready: "ready",
  rendering: "processing",
  rendered: "ready",
  failed: "failed",
};

const cutReasonLabels: Record<AutoEditCutReason, string> = {
  silence: "Khoảng lặng",
  hesitation: "Nói vấp / Từ đệm",
  retake: "Nói lặp / Take hỏng",
  dead_air: "Khoảng chết đầu/cuối",
  off_topic: "Cảnh thừa",
  manual: "Đã cắt tay",
};

function formatTimeMs(ms: number) {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${secs}`;
}

async function apiAutoEdit<T>(init?: RequestInit, id?: string): Promise<T> {
  const url = `/api/auto-edit${id ? `?id=${encodeURIComponent(id)}` : ""}`;
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) {
    throw new Error(payload?.message || "Không thể kết nối máy chủ Auto Edit.");
  }
  return payload;
}

type PendingImageItem = { file: File; label: string };
type LocalPickedVideo = { token: string; filename: string; displayPath: string; size: number };
type LocalPickedImage = { token: string; filename: string; displayPath: string; size: number; label: string };

export function AutoEditView({ initialJobId = "" }: { initialJobId?: string }) {
  const playerRef = useRef<PlayerRef>(null);
  const studioRef = useRef<HTMLElement>(null);

  const [jobs, setJobs] = useState<AutoEditJobSummary[]>([]);
  const [selectedId, setSelectedId] = useState(initialJobId);
  const [job, setJob] = useState<AutoEditJob>();
  const [draftEdl, setDraftEdl] = useState<AutoEditEdl>();
  const [dirtyEdl, setDirtyEdl] = useState(false);

  // Local Zero-Copy vs URL & Browser fallback state
  const [isLocalRuntime, setIsLocalRuntime] = useState(true);
  const [sourceMode, setSourceMode] = useState<"local" | "url">("local");
  const [sourceUrl, setSourceUrl] = useState("");
  const [localVideos, setLocalVideos] = useState<LocalPickedVideo[]>([]);
  const [localImages, setLocalImages] = useState<LocalPickedImage[]>([]);
  const [manualLocalPath, setManualLocalPath] = useState("");
  const [pickingLocal, setPickingLocal] = useState<"video" | "image" | null>(null);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [imageItems, setImageItems] = useState<PendingImageItem[]>([]);
  const [presetCategory, setPresetCategory] = useState<"all" | AutoEditPresetCategory>("all");
  const [preset, setPreset] = useState<AutoEditPresetId>("ugc-review");
  const [aspectRatio, setAspectRatio] = useState<AutoEditAspectRatio>("9:16");
  const [verticalFit, setVerticalFit] = useState<AutoEditVerticalFit>("auto");
  const [language, setLanguage] = useState<"vi" | "en">("vi");
  const [silenceThresholdMs, setSilenceThresholdMs] = useState(450);
  const [voiceTargetPeakDb, setVoiceTargetPeakDb] = useState(-1.2);
  const [autoSfx, setAutoSfx] = useState(true);
  const [sfxVolumeDb, setSfxVolumeDb] = useState(-8.5);
  const [motionBlur, setMotionBlur] = useState(true);
  const [safeZoneGuard, setSafeZoneGuard] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ doneBytes: number; totalBytes: number; label: string }>();

  // Studio controls (including live Output Aspect Ratio & Vertical Fit override)
  const [studioAspectRatio, setStudioAspectRatio] = useState<AutoEditAspectRatio>("9:16");
  const [studioVerticalFit, setStudioVerticalFit] = useState<AutoEditVerticalFit>("auto");
  const [studioMotionBlur, setStudioMotionBlur] = useState(true);
  const [showSafeZoneGuide, setShowSafeZoneGuide] = useState(false);
  const [savingEdl, setSavingEdl] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [studioNotice, setStudioNotice] = useState("");

  const selectedSummary = jobs.find((j) => j.id === selectedId);
  const selectedUpdatedAt = selectedSummary?.updatedAt;

  useEffect(() => {
    if (initialJobId) setSelectedId(initialJobId);
  }, [initialJobId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const h = window.location.hostname.toLowerCase();
      setIsLocalRuntime(h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function pollList() {
      try {
        const data = await apiAutoEdit<{ jobs: AutoEditJobSummary[] }>({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setJobs(data.jobs);
        if (!selectedId && data.jobs[0]) {
          setSelectedId(data.jobs[0].id);
        }
      } catch {
        // Keep polling quietly
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(pollList, 3000);
      }
    }
    void pollList();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void apiAutoEdit<{ job: AutoEditJob }>({ signal: controller.signal }, selectedId)
      .then(({ job: fetched }) => {
        if (controller.signal.aborted) return;
        setJob(fetched);
        if (fetched.id !== job?.id || !dirtyEdl) {
          setStudioAspectRatio(fetched.options.aspectRatio);
          setStudioVerticalFit(fetched.options.verticalFit || "auto");
          setStudioMotionBlur(fetched.options.motionBlur ?? true);
        }
        setDraftEdl((prev) => {
          if (!fetched.edl) return undefined;
          if (!prev || fetched.id !== job?.id || !dirtyEdl) return fetched.edl;
          return prev;
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [selectedId, selectedUpdatedAt, revision, dirtyEdl, job?.id]);

  const computedTimeline = useMemo(() => {
    if (!job || !draftEdl) return undefined;
    return computeAutoEditTimeline(
      draftEdl,
      job.analysis?.words || [],
      studioAspectRatio,
      job.analysis?.rawDurationMs,
      { autoSfx: job.options.autoSfx, sfxVolumeDb: job.options.sfxVolumeDb },
    );
  }, [job, draftEdl, studioAspectRatio]);

  const sfxGroups = useMemo(() => {
    const grouped = new Map<SfxCategory, typeof SFX_CATALOG[number][]>();
    for (const item of SFX_CATALOG) {
      const list = grouped.get(item.category) || [];
      list.push(item);
      grouped.set(item.category, list);
    }
    return [...grouped.entries()];
  }, []);

  function previewSfxSound(sfxId?: string) {
    if (!sfxId || sfxId === "none") return;
    const audio = new Audio(`/api/auto-edit/sfx/${encodeURIComponent(sfxId)}`);
    audio.volume = 0.55;
    void audio.play().catch(() => undefined);
  }

  function addVideos(files: FileList | null) {
    if (!files?.length) return;
    setVideoFiles((prev) => [...prev, ...Array.from(files)].slice(0, Math.max(0, 20 - localVideos.length)));
  }

  function addImages(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).map((file) => ({
      file,
      label: file.name.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ").trim().slice(0, 60),
    }));
    setImageItems((prev) => [...prev, ...next].slice(0, Math.max(0, 20 - localImages.length)));
  }

  function applyTemplatePreset(item: (typeof AUTO_EDIT_PRESETS)[number]) {
    setPreset(item.id);
    setAspectRatio(item.recommendedAspect);
    setVerticalFit(item.recommendedVerticalFit);
    setSilenceThresholdMs(item.recommendedSilenceMs);
  }

  async function handlePickNativeLocalFiles(kind: "video" | "image") {
    setPickingLocal(kind);
    setError("");
    try {
      const res = await fetch("/api/auto-edit/local-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind === "video" ? "pick-videos" : "pick-images" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload) {
        throw new Error(payload?.message || "Không mở được hộp thoại chọn tệp trên máy.");
      }
      if (payload.cancelled || !Array.isArray(payload.files) || !payload.files.length) return;

      if (kind === "video") {
        setLocalVideos((prev) => {
          const merged = [...prev];
          for (const f of payload.files as LocalPickedVideo[]) {
            if (!merged.some((m) => m.displayPath === f.displayPath) && merged.length < 20) {
              merged.push(f);
            }
          }
          return merged;
        });
      } else {
        setLocalImages((prev) => {
          const merged = [...prev];
          for (const f of payload.files as Array<Omit<LocalPickedImage, "label">>) {
            if (!merged.some((m) => m.displayPath === f.displayPath) && merged.length < 20) {
              merged.push({
                ...f,
                label: f.filename.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ").trim().slice(0, 60),
              });
            }
          }
          return merged;
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPickingLocal(null);
    }
  }

  async function handleAddManualLocalPath() {
    const raw = manualLocalPath.trim();
    if (!raw) return;
    setPickingLocal("video");
    setError("");
    try {
      const paths = raw.split(/\r?\n/u).map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/auto-edit/local-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-paths", kind: "video", paths }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.files) {
        throw new Error(payload?.message || "Không đọc được đường dẫn tệp video trên máy.");
      }
      setLocalVideos((prev) => {
        const merged = [...prev];
        for (const f of payload.files as LocalPickedVideo[]) {
          if (!merged.some((m) => m.displayPath === f.displayPath) && merged.length < 20) {
            merged.push(f);
          }
        }
        return merged;
      });
      setManualLocalPath("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPickingLocal(null);
    }
  }

  async function handleStartAutoEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sourceMode === "local" && !localVideos.length && !videoFiles.length) {
      setError("Hãy chọn ít nhất 1 video trên máy để dựng.");
      return;
    }
    if (sourceMode === "url" && !sourceUrl.trim()) {
      setError("Hãy dán link video công khai (YouTube, TikTok, Facebook...).");
      return;
    }

    const form = event.currentTarget;
    const fd = new FormData(form);
    const options = {
      title: String(fd.get("title") || ""),
      sourceUrl: sourceMode === "url" ? sourceUrl.trim() : "",
      preset,
      aspectRatio,
      verticalFit,
      language,
      productName: String(fd.get("productName") || ""),
      productHighlights: String(fd.get("productHighlights") || ""),
      direction: String(fd.get("direction") || ""),
      manualTranscript: String(fd.get("manualTranscript") || ""),
      silenceThresholdMs,
      voiceTargetPeakDb,
      autoSfx,
      sfxVolumeDb,
      motionBlur,
      safeZoneGuard,
    };

    setUploading(true);
    setError("");

    if (sourceMode === "url") {
      try {
        const totalAttachedImages = localImages.length + imageItems.length;
        setUploadProgress({
          doneBytes: 35,
          totalBytes: 100,
          label: totalAttachedImages > 0
            ? `Đang tải video từ link & gắn ${totalAttachedImages} ảnh minh hoạ...`
            : "Đang tải video & phụ đề từ link...",
        });
        let createdId: string;
        if (imageItems.length > 0) {
          const urlForm = new FormData();
          urlForm.set("options", JSON.stringify(options));
          urlForm.set("localImages", JSON.stringify(localImages.map((it) => ({ token: it.token, label: it.label }))));
          urlForm.set("imageLabels", JSON.stringify(imageItems.map((it) => it.label)));
          for (const item of imageItems) {
            urlForm.append("images", item.file);
          }
          const created = await apiAutoEdit<{ id: string }>({
            method: "POST",
            body: urlForm,
          });
          createdId = created.id;
        } else {
          const created = await apiAutoEdit<{ id: string }>({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              options,
              localImages: localImages.map((it) => ({ token: it.token, label: it.label })),
            }),
          });
          createdId = created.id;
        }
        setSourceUrl("");
        setLocalImages([]);
        setImageItems([]);
        form.reset();
        setDirtyEdl(false);
        setSelectedId(createdId);
        setRevision((r) => r + 1);
        setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
        setUploadProgress(undefined);
      }
      return;
    }

    // Fast path: Pure Local Zero-Copy videos (no HTTP video upload, instant symlink, unlimited GB!)
    if (localVideos.length > 0 && videoFiles.length === 0) {
      try {
        setUploadProgress({
          doneBytes: 85,
          totalBytes: 100,
          label: `Đang gắn trực tiếp ${localVideos.length} video trên máy (Zero-Copy · 0 giây copy)...`,
        });
        let createdId: string;
        if (imageItems.length > 0) {
          const localForm = new FormData();
          localForm.set("options", JSON.stringify(options));
          localForm.set("videoTokens", JSON.stringify(localVideos.map((v) => v.token)));
          localForm.set("localImages", JSON.stringify(localImages.map((it) => ({ token: it.token, label: it.label }))));
          localForm.set("imageLabels", JSON.stringify(imageItems.map((it) => it.label)));
          for (const item of imageItems) {
            localForm.append("images", item.file);
          }
          const res = await fetch("/api/auto-edit/local-files", { method: "POST", body: localForm });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.id) throw new Error(data?.message || "Không thể gắn tệp local vào hàng đợi.");
          createdId = data.id;
        } else {
          const res = await fetch("/api/auto-edit/local-files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create-job",
              options,
              videoTokens: localVideos.map((v) => v.token),
              localImages: localImages.map((it) => ({ token: it.token, label: it.label })),
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.id) throw new Error(data?.message || "Không thể khởi tạo bản dựng từ tệp local.");
          createdId = data.id;
        }

        setLocalVideos([]);
        setLocalImages([]);
        setImageItems([]);
        form.reset();
        setDirtyEdl(false);
        setSelectedId(createdId);
        setRevision((r) => r + 1);
        setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
        setUploadProgress(undefined);
      }
      return;
    }

    const totalBytes =
      videoFiles.reduce((sum, f) => sum + f.size, 0) +
      imageItems.reduce((sum, item) => sum + item.file.size, 0);
    let doneBytes = 0;

    try {
      const beginRes = await fetch("/api/auto-edit/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "begin",
          options,
          videos: videoFiles.map((f) => ({ filename: f.name, size: f.size })),
        }),
      });
      const beginPayload = await beginRes.json().catch(() => null);
      if (!beginRes.ok || !beginPayload?.session) {
        throw new Error(beginPayload?.message || "Không thể khởi tạo phiên tải lên.");
      }

      const sessionId: string = beginPayload.session.sessionId;
      const sessionVideos: Array<{ id: string; filename: string; size: number }> = beginPayload.session.videos;

      // 1. Upload videos in 8 MiB chunks
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const targetClip = sessionVideos[i];
        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + uploadChunkSize);
          setUploadProgress({
            doneBytes,
            totalBytes,
            label: `Đang tải video ${i + 1}/${videoFiles.length}: ${file.name}`,
          });
          const putRes = await fetch(
            `/api/auto-edit/upload?sessionId=${encodeURIComponent(sessionId)}&clipId=${encodeURIComponent(targetClip.id)}&offset=${offset}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: slice,
            },
          );
          const putData = await putRes.json().catch(() => null);
          if (!putRes.ok) {
            throw new Error(putData?.message || `Lỗi khi tải lên "${file.name}".`);
          }
          offset += slice.size;
          doneBytes += slice.size;
        }
      }

      // 2. Upload product / illustration images
      for (let i = 0; i < imageItems.length; i++) {
        const item = imageItems[i];
        setUploadProgress({
          doneBytes,
          totalBytes,
          label: `Đang tải ảnh minh hoạ ${i + 1}/${imageItems.length}: ${item.file.name}`,
        });
        const imgForm = new FormData();
        imgForm.set("sessionId", sessionId);
        imgForm.set("label", item.label);
        imgForm.set("file", item.file);
        const imgRes = await fetch("/api/auto-edit/upload", { method: "POST", body: imgForm });
        const imgData = await imgRes.json().catch(() => null);
        if (!imgRes.ok) {
          throw new Error(imgData?.message || `Lỗi khi tải ảnh "${item.file.name}".`);
        }
        doneBytes += item.file.size;
      }

      // 3. Finalize & enqueue job
      const finRes = await fetch("/api/auto-edit/upload", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const finData = await finRes.json().catch(() => null);
      if (!finRes.ok || !finData?.id) {
        throw new Error(finData?.message || "Chưa đưa được job vào hàng đợi Auto Edit.");
      }

      setVideoFiles([]);
      setImageItems([]);
      form.reset();
      setDirtyEdl(false);
      setSelectedId(finData.id);
      setRevision((r) => r + 1);
      setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 180);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      setUploadProgress(undefined);
    }
  }

  function toggleSegmentKeep(segId: string) {
    if (!draftEdl) return;
    const nextSegments = draftEdl.segments.map((s) => {
      if (s.id !== segId) return s;
      const nextKeep = !s.keep;
      return {
        ...s,
        keep: nextKeep,
        cutReason: nextKeep ? undefined : (s.cutReason || "manual"),
      };
    });
    if (!nextSegments.some((s) => s.keep)) {
      setStudioNotice("Phải giữ lại ít nhất 1 phân đoạn trong video.");
      return;
    }
    setDraftEdl({ ...draftEdl, segments: nextSegments });
    setDirtyEdl(true);
    setStudioNotice("");
  }

  function cycleSegmentZoom(segId: string) {
    if (!draftEdl) return;
    const levels = [1, 1.12, 1.2];
    setDraftEdl({
      ...draftEdl,
      segments: draftEdl.segments.map((s) => {
        if (s.id !== segId) return s;
        const currentIdx = levels.findIndex((lv) => Math.abs(lv - s.zoom) < 0.04);
        const nextZoom = levels[(currentIdx + 1) % levels.length];
        return { ...s, zoom: nextZoom };
      }),
    });
    setDirtyEdl(true);
  }

  function seekToSegment(segId: string) {
    if (!computedTimeline || !playerRef.current) return;
    const target = computedTimeline.keptSegments.find((s) => s.id === segId);
    if (!target) return;
    const frame = Math.round((target.timelineStartMs / 1000) * computedTimeline.fps);
    playerRef.current.seekTo(frame);
  }

  function addProductOverlayCard(presetKind: AutoEditOverlay["kind"] = "product_card", layoutOverride?: AutoEditCardLayout) {
    if (!draftEdl || !job) return;
    const firstKept = draftEdl.segments.find((s) => s.keep);
    const defaultImg = job.images[0]?.id;
    const resolvedKind = presetKind === "product_card" && !defaultImg && !layoutOverride ? "callout_pill" : presetKind;
    const newOv: AutoEditOverlay =
      resolvedKind === "spotlight_box"
        ? {
          id: `ov_spot_${Date.now().toString(36)}`,
          kind: "spotlight_box",
          anchorSegmentId: firstKept?.id,
          offsetMs: 600,
          durationMs: 2800,
          layout: "center-pop",
          title: "Bấm chọn tại đây",
          emoji: "👆",
          accentColor: "amber",
          sfxId: "mouse-clicks",
          targetX: 0.5,
          targetY: 0.52,
          targetW: 0.28,
          targetH: 0.14,
        }
        : resolvedKind === "highlighter"
          ? {
            id: `ov_hl_${Date.now().toString(36)}`,
            kind: "highlighter",
            anchorSegmentId: firstKept?.id,
            offsetMs: 600,
            durationMs: 2600,
            layout: "center-pop",
            title: "Điểm quan trọng",
            emoji: "✨",
            accentColor: "cyan",
            sfxId: "swoosh",
            targetX: 0.5,
            targetY: 0.5,
            targetW: 0.34,
            targetH: 0.065,
          }
          : resolvedKind === "freeze_frame"
            ? {
              id: `ov_frz_${Date.now().toString(36)}`,
              kind: "freeze_frame",
              anchorSegmentId: firstKept?.id,
              offsetMs: 400,
              durationMs: 2200,
              layout: "center-pop",
              badge: "SNAPSHOT FOCUS",
              title: job.options.productName || "Chi tiết quan trọng",
              accentColor: "cyan",
              sfxId: "camera-shutter",
            }
            : {
              id: `ov_manual_${Date.now().toString(36)}`,
              kind: resolvedKind,
              anchorSegmentId: firstKept?.id,
              offsetMs: 500,
              durationMs: 3400,
              imageId: defaultImg,
              layout: layoutOverride || "floating-right",
              badge: job.options.productName || "ĐIỂM NHẤN",
              title: job.images[0]?.label || job.options.productName || "Chi tiết nổi bật",
              subtitle: "",
              emoji: "✨",
              accentColor: "emerald",
              sfxId: layoutOverride === "stage-3d" ? "reveal-sparkle" : undefined,
              hyperframesHtml: "<div class=\"hf-bar\"><div class=\"hf-fill\"></div></div>",
              hyperframesCss: ".hf-bar{height:5px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:6px}.hf-fill{height:100%;width:calc(var(--hf-progress,1)*100%);background:linear-gradient(90deg,#34d399,#fbbf24)}",
            };
    setDraftEdl({ ...draftEdl, overlays: [...draftEdl.overlays, newOv] });
    setDirtyEdl(true);
  }

  function updateOverlayField(ovId: string, patch: Partial<AutoEditOverlay>) {
    if (!draftEdl) return;
    setDraftEdl({
      ...draftEdl,
      overlays: draftEdl.overlays.map((ov) => (ov.id === ovId ? { ...ov, ...patch } : ov)),
    });
    setDirtyEdl(true);
  }

  function removeOverlay(ovId: string) {
    if (!draftEdl) return;
    setDraftEdl({
      ...draftEdl,
      overlays: draftEdl.overlays.filter((ov) => ov.id !== ovId),
    });
    setDirtyEdl(true);
  }

  async function saveEdlChanges() {
    if (!job || !draftEdl) return false;
    setSavingEdl(true);
    setStudioNotice("");
    try {
      const { job: updated } = await apiAutoEdit<{ job: AutoEditJob }>({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "update-edl",
          edl: draftEdl,
          optionsPatch: { aspectRatio: studioAspectRatio, verticalFit: studioVerticalFit, motionBlur: studioMotionBlur },
        }),
      });
      setJob(updated);
      setStudioAspectRatio(updated.options.aspectRatio);
      setStudioVerticalFit(updated.options.verticalFit || "auto");
      setStudioMotionBlur(updated.options.motionBlur ?? true);
      setDraftEdl(updated.edl);
      setDirtyEdl(false);
      setStudioNotice("Đã lưu thay đổi timeline.");
      setRevision((r) => r + 1);
      return true;
    } catch (err) {
      setStudioNotice((err as Error).message);
      return false;
    } finally {
      setSavingEdl(false);
    }
  }

  async function handleCopilotTweak() {
    if (!job || !copilotPrompt.trim()) return;
    setCopilotBusy(true);
    setStudioNotice("");
    try {
      if (dirtyEdl) {
        const saved = await saveEdlChanges();
        if (!saved) return;
      }
      const { job: updated } = await apiAutoEdit<{ job: AutoEditJob }>({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, action: "copilot-tweak", instruction: copilotPrompt.trim() }),
      });
      setJob(updated);
      setDraftEdl(updated.edl);
      setDirtyEdl(false);
      setCopilotPrompt("");
      setStudioNotice("Code Agent đã cập nhật kịch bản cắt & đồ hoạ HyperFrames!");
      setRevision((r) => r + 1);
    } catch (err) {
      setStudioNotice((err as Error).message);
    } finally {
      setCopilotBusy(false);
    }
  }

  async function handleExportMp4() {
    if (!job || !draftEdl) return;
    setRendering(true);
    setStudioNotice("");
    try {
      if (dirtyEdl) {
        const ok = await saveEdlChanges();
        if (!ok) return;
      }
      await apiAutoEdit({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "render",
          optionsPatch: { aspectRatio: studioAspectRatio, verticalFit: studioVerticalFit, motionBlur: studioMotionBlur },
        }),
      });
      setStudioNotice(`Đã bắt đầu xuất MP4 tỷ lệ ${studioAspectRatio} (FFmpeg + HyperFrames). Tiến trình sẽ tự cập nhật sau ít giây.`);
      setRevision((r) => r + 1);
    } catch (err) {
      setStudioNotice((err as Error).message);
    } finally {
      setRendering(false);
    }
  }

  async function handleRetryJob() {
    if (!job) return;
    try {
      await apiAutoEdit({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id, action: "retry" }),
      });
      setDirtyEdl(false);
      setRevision((r) => r + 1);
    } catch (err) {
      setStudioNotice((err as Error).message);
    }
  }

  const totalFrames = computedTimeline
    ? Math.max(30, Math.round((computedTimeline.totalDurationMs / 1000) * computedTimeline.fps))
    : 90;

  return (
    <div className="auto-edit-workspace">
      {/* Top Intake & Upload Panel */}
      <section className="card auto-edit-intake-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">Whisper · Remotion · HyperFrames · Three.js · Local Zero-Copy</span>
            <h1>Auto Edit Video thông minh (12 Chủ đề)</h1>
            <p className="auto-edit-lead">
              Chọn trực tiếp video trên ổ cứng máy tính <strong>không giới hạn dung lượng (0 giây copy)</strong> hoặc dán link mạng xã hội, kết hợp kho <strong>12 Template đa chủ đề</strong>, <strong>59 SFX</strong>, hiệu ứng 3D/Khoanh vùng Pro FX và chuẩn hoá giọng đọc <strong>0 đến -3 dB</strong>.
            </p>
          </div>
        </div>

        <form onSubmit={handleStartAutoEdit} className="auto-edit-form">
          <div className="remake-source-tabs" role="tablist" aria-label="Nguồn video Auto Edit">
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === "local"}
              onClick={() => setSourceMode("local")}
            >
              Chọn video trực tiếp trên máy (Local · Không giới hạn GB)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === "url"}
              onClick={() => setSourceMode("url")}
            >
              Dán link YouTube / TikTok / Facebook
            </button>
          </div>

          <div className="auto-edit-upload-grid">
            {/* Multi-video local picker / dropbox or URL input */}
            <div className="auto-edit-dropzone">
              {sourceMode === "url" ? (
                <>
                  <div className="auto-edit-dropzone-header">
                    <strong><Icon name="link" size={17} /> 1. Link video công khai cần Auto Edit</strong>
                  </div>
                  <small>Hỗ trợ YouTube, YouTube Shorts, TikTok, Facebook Reels, Instagram, Douyin.</small>
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    style={{ height: 40, padding: "0 12px", borderRadius: 9, border: "1px solid #cbd5e1", fontSize: 13.5 }}
                  />
                </>
              ) : (
                <>
                  <div className="auto-edit-dropzone-header">
                    <strong><Icon name="scene" size={17} /> 1. Chọn Video trên máy (1–20 clip · Không giới hạn GB)</strong>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {isLocalRuntime && (
                        <button
                          type="button"
                          className="primary-button auto-edit-pick-btn"
                          disabled={pickingLocal !== null}
                          onClick={() => handlePickNativeLocalFiles("video")}
                          title="Mở Finder/Explorer chọn trực tiếp file gốc trên máy tính — 0 giây copy, không giới hạn dung lượng"
                        >
                          <Icon name="folder" size={15} />
                          {pickingLocal === "video" ? "Đang mở hộp thoại..." : "Chọn trên máy (0s Copy)"}
                        </button>
                      )}
                      <label className="secondary-button auto-edit-pick-btn" title="Kéo thả hoặc chọn qua trình duyệt (không giới hạn GB)">
                        <Icon name="upload" size={15} /> Kéo thả / Trình duyệt
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.m4v"
                          multiple
                          hidden
                          onChange={(e) => {
                            addVideos(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <small>
                    Chạy trực tiếp trên máy bạn: gắn thẳng đường dẫn file gốc (MP4, MOV, MKV, WebM) không cần upload lại, kể cả file quay màn hình / 4K nặng hàng chục GB.
                  </small>

                  {isLocalRuntime && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={manualLocalPath}
                        onChange={(e) => setManualLocalPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleAddManualLocalPath();
                          }
                        }}
                        placeholder="Hoặc dán đường dẫn file trên máy (VD: ~/Movies/video-quay.mov) rồi nhấn Enter..."
                        style={{ flex: 1, height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12.5, background: "#fff" }}
                      />
                      <button
                        type="button"
                        className="secondary-button auto-edit-pick-btn"
                        disabled={!manualLocalPath.trim() || pickingLocal !== null}
                        onClick={handleAddManualLocalPath}
                      >
                        Gắn đường dẫn
                      </button>
                    </div>
                  )}

                  {localVideos.length > 0 || videoFiles.length > 0 ? (
                    <ul className="auto-edit-asset-list">
                      {localVideos.map((item, idx) => (
                        <li key={item.token} title={item.displayPath}>
                          <span className="auto-edit-asset-badge is-zerocopy">⚡ Local {idx + 1}</span>
                          <span className="auto-edit-asset-name">{item.filename}</span>
                          <small>{formatBytesHuman(item.size)} · 0s Copy</small>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Bỏ chọn video"
                            onClick={() => setLocalVideos((prev) => prev.filter((v) => v.token !== item.token))}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </li>
                      ))}
                      {videoFiles.map((file, idx) => (
                        <li key={`${file.name}_${idx}`}>
                          <span className="auto-edit-asset-badge">Clip {localVideos.length + idx + 1}</span>
                          <span className="auto-edit-asset-name">{file.name}</span>
                          <small>{formatBytesHuman(file.size)}</small>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Xoá video"
                            onClick={() => setVideoFiles((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="auto-edit-empty-drop">Chưa chọn tệp video nào (Bấm &ldquo;Chọn trên máy (0s Copy)&rdquo; để đọc thẳng từ ổ cứng)</div>
                  )}
                </>
              )}
            </div>

            {/* Product / Illustration Images dropbox */}
            <div className="auto-edit-dropzone">
              <div className="auto-edit-dropzone-header">
                <strong><Icon name="image" size={17} /> 2. Ảnh sản phẩm / Minh hoạ (Tuỳ chọn, tối đa 20 ảnh)</strong>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {isLocalRuntime && (
                    <button
                      type="button"
                      className="secondary-button auto-edit-pick-btn"
                      disabled={pickingLocal !== null}
                      onClick={() => handlePickNativeLocalFiles("image")}
                    >
                      <Icon name="folder" size={15} /> Chọn ảnh trên máy
                    </button>
                  )}
                  <label className="secondary-button auto-edit-pick-btn">
                    <Icon name="plus" size={15} /> Kéo thả ảnh
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      hidden
                      onChange={(e) => {
                        addImages(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
              <small>Đặt nhãn ngắn gọn cho từng ảnh để Code Agent tự khớp đúng giây người nói nhắc tới.</small>

              {localImages.length > 0 || imageItems.length > 0 ? (
                <ul className="auto-edit-asset-list">
                  {localImages.map((item, idx) => (
                    <li key={item.token} title={item.displayPath}>
                      <span className="auto-edit-asset-badge is-zerocopy">⚡ Ảnh {idx + 1}</span>
                      <input
                        type="text"
                        value={item.label}
                        placeholder="Mô tả ảnh (VD: Bảng thành phần, Giá 199K...)"
                        onChange={(e) => {
                          const val = e.target.value;
                          setLocalImages((prev) => prev.map((it) => (it.token === item.token ? { ...it, label: val } : it)));
                        }}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Xoá ảnh"
                        onClick={() => setLocalImages((prev) => prev.filter((it) => it.token !== item.token))}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </li>
                  ))}
                  {imageItems.map((item, idx) => (
                    <li key={`${item.file.name}_${idx}`}>
                      <span className="auto-edit-asset-badge">Ảnh {localImages.length + idx + 1}</span>
                      <input
                        type="text"
                        value={item.label}
                        placeholder="Mô tả ảnh (VD: Bảng thành phần, Giá 199K...)"
                        onChange={(e) => {
                          const val = e.target.value;
                          setImageItems((prev) => prev.map((it, i) => (i === idx ? { ...it, label: val } : it)));
                        }}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Xoá ảnh"
                        onClick={() => setImageItems((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="auto-edit-empty-drop">Chưa thêm ảnh minh hoạ (Agent vẫn tự động cắt dựng + phụ đề + khoanh vùng Pro FX)</div>
              )}
            </div>
          </div>

          {/* 12 Multi-Topic Templates with Category Filter */}
          <div className="auto-edit-templates-section">
            <div className="auto-edit-templates-head">
              <div>
                <strong>3. Chọn Template Chủ đề Video ({AUTO_EDIT_PRESETS.length} mẫu chuyên biệt)</strong>
                <small>Khi chọn Template, hệ thống tự động tối ưu nhịp cắt khoảng lặng, tỷ lệ khung, kiểu phụ đề, hiệu ứng Pro FX và SFX theo đúng thể loại.</small>
              </div>
              <div className="auto-edit-cat-pills" role="tablist" aria-label="Nhóm chủ đề Template">
                {AUTO_EDIT_PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={presetCategory === cat.id}
                    className={`auto-edit-cat-pill ${presetCategory === cat.id ? "is-active" : ""}`}
                    onClick={() => setPresetCategory(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="auto-edit-preset-grid" role="radiogroup" aria-label="Template Auto Edit">
              {AUTO_EDIT_PRESETS
                .filter((item) => presetCategory === "all" || item.category === presetCategory)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`auto-edit-preset-card ${preset === item.id ? "is-selected" : ""}`}
                    onClick={() => applyTemplatePreset(item)}
                  >
                    <div className="auto-edit-preset-top">
                      <span className="auto-edit-preset-badge">{item.badge}</span>
                      <span className="auto-edit-preset-meta">
                        {item.recommendedAspect} · {item.recommendedSilenceMs}ms
                      </span>
                    </div>
                    <strong>{item.label}</strong>
                    <span>{item.summary}</span>
                  </button>
                ))}
            </div>
          </div>

          {/* Options row */}
          <div className="form-grid auto-edit-options-grid">
            <label className="form-field">
              <span>Tiêu đề bản dựng / Tên sản phẩm</span>
              <input name="productName" type="text" placeholder="VD: Kem chống nắng kiềm dầu SkinAqua..." />
            </label>
            <label className="form-field">
              <span>Tỷ lệ Video Output (Đầu ra)</span>
              <div className="auto-edit-ratio-pills" role="radiogroup" aria-label="Tỷ lệ Video Output">
                {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`auto-edit-ratio-btn ${aspectRatio === ratio ? "is-active" : ""}`}
                    onClick={() => setAspectRatio(ratio)}
                  >
                    {ratio === "9:16" ? "9:16 Dọc" : ratio === "16:9" ? "16:9 Ngang" : "1:1 Vuông"}
                  </button>
                ))}
              </div>
            </label>
            <label className="form-field">
              <span>Phông nền / Khung sân khấu Video</span>
              <select value={verticalFit} onChange={(e) => setVerticalFit(e.target.value as AutoEditVerticalFit)}>
                <option value="auto">Tự động (Nền mờ nếu clip ngang xuất 9:16)</option>
                <option value="aurora-3d">🌌 Sân khấu 3D Aurora + Three.js Particles</option>
                {aspectRatio === "9:16" && (
                  <>
                    <option value="blur-fit">Khung ngang giữa + Nền mờ Cinema (Không mất chữ)</option>
                    <option value="fill-crop">Cắt dọc lấp đầy 9:16 (Cho video quay người nói)</option>
                  </>
                )}
              </select>
            </label>
            <label className="form-field">
              <span>Ngôn ngữ lời thoại</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "vi")}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">Tiếng Anh (English)</option>
              </select>
            </label>
            <label className="form-field">
              <span>Ngưỡng cắt khoảng lặng ({silenceThresholdMs}ms)</span>
              <input
                type="range"
                min={250}
                max={1200}
                step={50}
                value={silenceThresholdMs}
                onChange={(e) => setSilenceThresholdMs(Number(e.target.value))}
              />
            </label>
            <label className="form-field">
              <span>Chuẩn hoá đỉnh giọng đọc ({voiceTargetPeakDb.toFixed(1)} dB · Chuẩn 0 đến -3 dB)</span>
              <input
                type="range"
                min={-3.0}
                max={-0.5}
                step={0.1}
                value={voiceTargetPeakDb}
                onChange={(e) => setVoiceTargetPeakDb(Number(e.target.value))}
              />
            </label>
            <label className="form-field">
              <span>Điểm nổi bật / Giá / Ưu đãi cần chèn lên thẻ HyperFrames</span>
              <textarea
                name="productHighlights"
                rows={2}
                placeholder="VD: Thấm ráo sau 10s, không nâng tông giả, giá dùng thử 219K..."
              />
            </label>
            <label className="form-field">
              <span>Chỉ dẫn thêm cho Code Agent CLI</span>
              <textarea
                name="direction"
                rows={2}
                placeholder="VD: Giữ giọng nói tự nhiên, đoạn mở hộp cắt thật nhanh, nhấn mạnh câu kết..."
              />
            </label>
          </div>

          <details className="remake-long-section">
            <summary>Tuỳ chọn nâng cao (Safe-Zone & Transcript thủ công nếu không dùng Whisper)</summary>
            <div className="auto-edit-advanced-inner">
              <label className="auto-edit-checkbox">
                <input
                  type="checkbox"
                  checked={autoSfx}
                  onChange={(e) => setAutoSfx(e.target.checked)}
                />
                <span>Tự động chèn hiệu ứng âm thanh từ kho 59 SFX (Whoosh, Pop, Sparkle, Ding, Click...)</span>
              </label>
              {autoSfx && (
                <label className="form-field">
                  <span>Độ lớn hiệu ứng SFX ({sfxVolumeDb} dB · Rõ nét dưới giọng đọc 0 đến -3 dB)</span>
                  <input
                    type="range"
                    min={-22}
                    max={-4}
                    step={0.5}
                    value={sfxVolumeDb}
                    onChange={(e) => setSfxVolumeDb(Number(e.target.value))}
                  />
                </label>
              )}
              <label className="auto-edit-checkbox">
                <input
                  type="checkbox"
                  checked={motionBlur}
                  onChange={(e) => setMotionBlur(e.target.checked)}
                />
                <span>Bật Cinematic Motion Blur cho chuyển động thẻ & chữ (Chuẩn Pro Video FX)</span>
              </label>
              <label className="auto-edit-checkbox">
                <input
                  type="checkbox"
                  checked={safeZoneGuard}
                  onChange={(e) => setSafeZoneGuard(e.target.checked)}
                />
                <span>Bật bảo vệ vùng an toàn TikTok / Reels / Shorts (Tránh đè chữ vào giỏ hàng & nút tim)</span>
              </label>
              <label className="form-field">
                <span>Lời thoại / Kịch bản gốc (Bỏ trống để Whisper tự động nhận diện từng từ)</span>
                <textarea
                  name="manualTranscript"
                  rows={3}
                  placeholder="Chỉ nhập khi máy chưa cài Whisper hoặc video quay trong môi trường quá ồn..."
                />
              </label>
            </div>
          </details>

          {uploadProgress && (
            <div className="remake-upload-progress">
              <progress value={uploadProgress.doneBytes} max={Math.max(1, uploadProgress.totalBytes)} />
              <small>
                {uploadProgress.label} ({Math.round((uploadProgress.doneBytes / Math.max(1, uploadProgress.totalBytes)) * 100)}%)
              </small>
            </div>
          )}

          {error && <p className="auto-edit-error">{error}</p>}

          <div className="remake-actions">
            <button type="submit" className="primary-button" disabled={uploading}>
              <Icon name="spark" size={16} />
              {uploading ? "Đang tải tệp & khởi tạo..." : "Phân tích & Dựng tự động ngay"}
            </button>
          </div>
        </form>
      </section>

      {/* Recent Auto-Edit Queue Strip */}
      {jobs.length > 0 && (
        <section className="card auto-edit-queue-card">
          <div className="card-heading">
            <h2>Danh sách bản dựng ({jobs.length})</h2>
          </div>
          <div className="auto-edit-job-pills">
            {jobs.map((item) => {
              const savedPct =
                item.rawDurationMs && item.editedDurationMs && item.rawDurationMs > item.editedDurationMs
                  ? Math.round(((item.rawDurationMs - item.editedDurationMs) / item.rawDurationMs) * 100)
                  : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`auto-edit-job-pill ${selectedId === item.id ? "is-active" : ""}`}
                  onClick={() => {
                    setDirtyEdl(false);
                    setSelectedId(item.id);
                    setStudioNotice("");
                  }}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.videoCount} clip · {item.imageCount} ảnh · {item.aspectRatio}
                      {savedPct > 0 ? ` · Đã gọt -${savedPct}%` : ""}
                    </small>
                  </div>
                  <span className={`project-status ${statusBadgeClasses[item.status]}`}>
                    {statusLabels[item.status]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 3-Column Interactive Studio */}
      {job && (
        <section ref={studioRef} className="card auto-edit-studio-card">
          <div className="card-heading auto-edit-studio-header">
            <div>
              <span className="eyebrow">
                {job.agentLabel || "Auto-Edit Pipeline"}
                {job.analysis?.whisperBackend ? ` · Whisper (${job.analysis.whisperBackend})` : ""}
              </span>
              <h2>{draftEdl?.title || job.options.title || "Bản dựng Auto Edit"}</h2>
              {draftEdl?.summary && <p className="auto-edit-summary">{draftEdl.summary}</p>}
            </div>

            <div className="auto-edit-header-actions">
              <span className={`project-status ${statusBadgeClasses[job.status]}`}>
                {statusLabels[job.status]}
              </span>
              {(job.status === "failed" || job.status === "ready" || job.status === "rendered") && (
                <button type="button" className="secondary-button" onClick={handleRetryJob}>
                  <Icon name="refresh" size={15} /> Chạy phân tích lại
                </button>
              )}
              {draftEdl && (
                <div className="auto-edit-ratio-pills" role="group" aria-label="Chọn tỷ lệ xuất MP4">
                  {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      className={`auto-edit-ratio-btn ${studioAspectRatio === ratio ? "is-active" : ""}`}
                      onClick={() => {
                        setStudioAspectRatio(ratio);
                        setDirtyEdl(true);
                      }}
                      title={`Đổi tỷ lệ xuất sang ${ratio}`}
                    >
                      Out {ratio}
                    </button>
                  ))}
                </div>
              )}
              {dirtyEdl && (
                <button type="button" className="secondary-button" disabled={savingEdl} onClick={saveEdlChanges}>
                  <Icon name="save" size={15} /> {savingEdl ? "Đang lưu..." : "Lưu chỉnh sửa"}
                </button>
              )}
              {draftEdl && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={rendering || job.status === "rendering"}
                  onClick={handleExportMp4}
                >
                  <Icon name="bolt" size={15} />
                  {job.status === "rendering" || rendering ? "Đang xuất MP4..." : `Xuất MP4 (${studioAspectRatio})`}
                </button>
              )}
              {job.render?.status === "ready" && job.render.outputPath && (
                <a
                  className="secondary-button"
                  href={`/api/auto-edit/${encodeURIComponent(job.id)}/media?kind=render&download=1`}
                >
                  <Icon name="download" size={15} /> Tải MP4 ({((job.render.sizeBytes || 0) / (1024 * 1024)).toFixed(1)} MB)
                </a>
              )}
            </div>
          </div>

          {job.progress && <div className="auto-edit-progress-banner">{job.progress}</div>}
          {job.error && <div className="auto-edit-error-banner">{job.error}</div>}
          {job.render?.status === "failed" && job.render.error && (
            <div className="auto-edit-error-banner">Lỗi xuất MP4: {job.render.error}</div>
          )}
          {studioNotice && <div className="auto-edit-notice-banner">{studioNotice}</div>}

          {draftEdl && computedTimeline && (
            <>
              {/* Metrics bar */}
              <div className="auto-edit-metrics-bar">
                <div>
                  <span>Thời lượng gốc</span>
                  <strong>{formatTimeMs(computedTimeline.rawDurationMs)}</strong>
                </div>
                <div>
                  <span>Sau khi cắt dựng</span>
                  <strong>{formatTimeMs(computedTimeline.totalDurationMs)}</strong>
                </div>
                <div>
                  <span>Đã loại bỏ</span>
                  <strong>
                    {computedTimeline.cutCount} đoạn thừa (-{formatTimeMs(computedTimeline.savedDurationMs)})
                  </strong>
                </div>
                <div>
                  <span>Đồ hoạ & Âm thanh SFX</span>
                  <strong>{computedTimeline.overlays.length} thẻ · {computedTimeline.sfxEvents.length} SFX</strong>
                </div>
                <div>
                  <span>Độ lớn Giọng đọc (Voice dB)</span>
                  <strong>
                    {job.render?.maxVolumeDb !== undefined
                      ? `Peak ${job.render.maxVolumeDb.toFixed(1)} dB · Thoại ${job.render.speechPeakDb?.toFixed(1) ?? job.render.maxVolumeDb.toFixed(1)} dB ✓`
                      : job.analysis?.inputMaxVolumeDb !== undefined
                        ? `Gốc ${job.analysis.inputMaxVolumeDb.toFixed(1)} dB → Sẽ nâng lên ${job.options.voiceTargetPeakDb?.toFixed(1) ?? "-1.2"} dB`
                        : "Tự động khoá 0 đến -3 dB"}
                  </strong>
                </div>
              </div>

              <div className="auto-edit-studio-columns">
                {/* Column 1: Descript-style Transcript Cut Editor */}
                <div className="auto-edit-col auto-edit-transcript-col">
                  <div className="auto-edit-col-head">
                    <h3>1. Cắt dựng theo Lời thoại & Phân đoạn</h3>
                    <small>Bấm &ldquo;Giữ / Cắt&rdquo; để khôi phục hoặc loại bỏ tức thì trên bản xem trước.</small>
                  </div>

                  <div className="auto-edit-segment-list">
                    {draftEdl.segments.map((seg) => (
                      <div
                        key={seg.id}
                        className={`auto-edit-seg-item ${seg.keep ? "is-kept" : "is-cut"}`}
                      >
                        <div className="auto-edit-seg-top">
                          <button
                            type="button"
                            className="auto-edit-seg-time"
                            onClick={() => seg.keep && seekToSegment(seg.id)}
                            title={seg.keep ? "Nhảy tới mốc này trên trình phát" : "Đoạn này đang bị cắt bỏ"}
                          >
                            {seg.clipId} · {formatTimeMs(seg.sourceStartMs)} → {formatTimeMs(seg.sourceEndMs)}
                          </button>

                          <div className="auto-edit-seg-controls">
                            {seg.keep && (
                              <button
                                type="button"
                                className="auto-edit-mini-btn"
                                onClick={() => cycleSegmentZoom(seg.id)}
                                title="Đổi mức Punch-in Zoom giấu vết cắt"
                              >
                                Zoom {seg.zoom.toFixed(2)}x
                              </button>
                            )}
                            {!seg.keep && seg.cutReason && (
                              <span className="auto-edit-cut-tag">
                                {cutReasonLabels[seg.cutReason]}
                              </span>
                            )}
                            <button
                              type="button"
                              className={`auto-edit-toggle-btn ${seg.keep ? "keep" : "cut"}`}
                              onClick={() => toggleSegmentKeep(seg.id)}
                            >
                              {seg.keep ? "Đang giữ" : "Đã cắt"}
                            </button>
                          </div>
                        </div>

                        <p className="auto-edit-seg-text">
                          {seg.transcriptText || <em>(Khoảng lặng / B-roll không lời thoại)</em>}
                        </p>
                        {seg.note && <small className="auto-edit-seg-note">{seg.note}</small>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column 2: Live Remotion <Player> */}
                <div className="auto-edit-col auto-edit-player-col">
                  <div className="auto-edit-col-head">
                    <h3>2. Xem trước trực tiếp (Remotion Player)</h3>
                    <div className="auto-edit-player-toggles">
                      <select
                        value={draftEdl.captionStyle}
                        onChange={(e) => {
                          setDraftEdl({
                            ...draftEdl,
                            captionStyle: e.target.value as AutoEditEdl["captionStyle"],
                          });
                          setDirtyEdl(true);
                        }}
                      >
                        <option value="karaoke-pop">Phụ đề Karaoke Pop</option>
                        <option value="clean-pill">Phụ đề Hộp mờ Clean Pill</option>
                        <option value="minimal-line">Phụ đề Tối giản</option>
                      </select>
                      <select
                        value={studioVerticalFit}
                        onChange={(e) => {
                          setStudioVerticalFit(e.target.value as AutoEditVerticalFit);
                          setDirtyEdl(true);
                        }}
                        title="Chọn phông nền sân khấu hoặc chế độ chuyển 16:9 -> 9:16"
                      >
                        <option value="auto">Khung: Tự động</option>
                        <option value="aurora-3d">🌌 3D Aurora Stage</option>
                        {studioAspectRatio === "9:16" && (
                          <>
                            <option value="blur-fit">Giữ trọn khung + Nền mờ</option>
                            <option value="fill-crop">Cắt dọc đầy màn hình</option>
                          </>
                        )}
                      </select>
                      <label className="auto-edit-safezone-toggle" title="Bật hiệu ứng nhòe chuyển động điện ảnh khi thẻ bay vào">
                        <input
                          type="checkbox"
                          checked={studioMotionBlur}
                          onChange={(e) => {
                            setStudioMotionBlur(e.target.checked);
                            setDirtyEdl(true);
                          }}
                        />
                        <span>Motion Blur</span>
                      </label>
                      {studioAspectRatio === "9:16" && (
                        <label className="auto-edit-safezone-toggle">
                          <input
                            type="checkbox"
                            checked={showSafeZoneGuide}
                            onChange={(e) => setShowSafeZoneGuide(e.target.checked)}
                          />
                          <span>Khung Safe-Zone</span>
                        </label>
                      )}
                    </div>
                  </div>

                  <div className={`auto-edit-player-stage ratio-${studioAspectRatio.replace(":", "-")}`}>
                    <Player
                      ref={playerRef}
                      component={AutoEditRemotionComposition}
                      inputProps={{
                        jobId: job.id,
                        timeline: computedTimeline,
                        videos: job.videos,
                        captionStyle: draftEdl.captionStyle,
                        safeZoneGuard: job.options.safeZoneGuard,
                        showSafeZoneGuide,
                        aspectRatio: studioAspectRatio,
                        verticalFit: studioVerticalFit,
                        motionBlur: studioMotionBlur,
                      }}
                      durationInFrames={totalFrames}
                      fps={computedTimeline.fps}
                      compositionWidth={computedTimeline.width}
                      compositionHeight={computedTimeline.height}
                      controls
                      style={{
                        width: "100%",
                        maxHeight: studioAspectRatio === "9:16" ? 580 : 420,
                        borderRadius: 14,
                        overflow: "hidden",
                      }}
                    />
                  </div>

                  {job.render?.status === "ready" && job.render.outputPath && (
                    <details className="remake-long-section" style={{ marginTop: 12 }}>
                      <summary>Xem tệp MP4 đã xuất cuối cùng</summary>
                      <video
                        controls
                        preload="metadata"
                        src={`/api/auto-edit/${encodeURIComponent(job.id)}/media?kind=render&v=${encodeURIComponent(job.render.updatedAt)}`}
                        style={{ width: "100%", maxHeight: 420, borderRadius: 10, background: "#000" }}
                      />
                    </details>
                  )}
                </div>

                {/* Column 3: AI Co-pilot Chat + HyperFrames Overlays Inspector */}
                <div className="auto-edit-col auto-edit-inspector-col">
                  <div className="auto-edit-copilot-box">
                    <h3><Icon name="spark" size={16} /> 3. Tinh chỉnh với Code Agent CLI</h3>
                    <p>Yêu cầu Agent cắt nhanh hơn, đổi câu Hook, thêm giá bán hoặc viết hiệu ứng CSS HyperFrames mới.</p>
                    <textarea
                      rows={3}
                      value={copilotPrompt}
                      onChange={(e) => setCopilotPrompt(e.target.value)}
                      placeholder="VD: Đổi Hook đầu thành 'SAI LẦM KHI BÔI KEM CHỐNG NẮNG 😱', thêm giá 219K vào thẻ sản phẩm đầu tiên..."
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={copilotBusy || !copilotPrompt.trim()}
                      onClick={handleCopilotTweak}
                    >
                      {copilotBusy ? "Code Agent đang cập nhật..." : "Gửi lệnh cho Code Agent"}
                    </button>
                  </div>

                  <div className="auto-edit-overlays-box">
                    <div className="auto-edit-overlays-header" style={{ flexWrap: "wrap", gap: 6 }}>
                      <h4>Đồ hoạ Pro FX & HyperFrames ({draftEdl.overlays.length})</h4>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        <button type="button" className="auto-edit-mini-btn" onClick={() => addProductOverlayCard("product_card", "stage-3d")}>
                          + Thẻ 3D
                        </button>
                        <button type="button" className="auto-edit-mini-btn" onClick={() => addProductOverlayCard("spotlight_box")}>
                          + Khoanh vùng
                        </button>
                        <button type="button" className="auto-edit-mini-btn" onClick={() => addProductOverlayCard("highlighter")}>
                          + Dạ quang
                        </button>
                        <button type="button" className="auto-edit-mini-btn" onClick={() => addProductOverlayCard("freeze_frame")}>
                          + Freeze HUD
                        </button>
                      </div>
                    </div>

                    <div className="auto-edit-overlay-list">
                      {draftEdl.overlays.map((ov) => (
                        <div key={ov.id} className="auto-edit-ov-card">
                          <div className="auto-edit-ov-row">
                            <span className="auto-edit-asset-badge">{ov.kind}</span>
                            <select
                              value={ov.layout}
                              onChange={(e) => updateOverlayField(ov.id, { layout: e.target.value as AutoEditCardLayout })}
                            >
                              <option value="stage-3d">✨ Khung nổi 3D Stage</option>
                              <option value="floating-right">Nổi góc phải</option>
                              <option value="floating-left">Nổi góc trái</option>
                              <option value="split-top">Nửa trên (Split Top)</option>
                              <option value="center-pop">Giữa màn hình</option>
                            </select>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Xoá thẻ"
                              onClick={() => removeOverlay(ov.id)}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          </div>

                          <div className="auto-edit-ov-fields">
                            <input
                              type="text"
                              value={ov.title}
                              placeholder="Tiêu đề chính..."
                              onChange={(e) => updateOverlayField(ov.id, { title: e.target.value })}
                            />
                            <input
                              type="text"
                              value={ov.subtitle || ""}
                              placeholder="Mô tả phụ / Phụ đề thẻ (tuỳ chọn)..."
                              onChange={(e) => updateOverlayField(ov.id, { subtitle: e.target.value })}
                            />
                            <div className="auto-edit-ov-inline">
                              <input
                                type="text"
                                value={ov.emoji || ""}
                                placeholder="Emoji"
                                style={{ maxWidth: 68 }}
                                onChange={(e) => updateOverlayField(ov.id, { emoji: e.target.value })}
                              />
                              <input
                                type="text"
                                value={ov.badge || ""}
                                placeholder="Nhãn (Badge)"
                                onChange={(e) => updateOverlayField(ov.id, { badge: e.target.value })}
                              />
                              <input
                                type="text"
                                value={ov.priceTag || ""}
                                placeholder="Giá (VD: 199K)"
                                onChange={(e) => updateOverlayField(ov.id, { priceTag: e.target.value })}
                              />
                            </div>
                            <div className="auto-edit-ov-inline">
                              <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, fontSize: 11.5 }}>
                                <span>Trễ mốc (giây)</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={600}
                                  step={0.1}
                                  value={Number((ov.offsetMs / 1000).toFixed(2))}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const nextOffsetMs = Number.isFinite(val)
                                      ? Math.min(600_000, Math.max(0, Math.round(val * 1000)))
                                      : 0;
                                    updateOverlayField(ov.id, { offsetMs: nextOffsetMs });
                                  }}
                                />
                              </label>
                              <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, fontSize: 11.5 }}>
                                <span>Thời lượng (giây)</span>
                                <input
                                  type="number"
                                  min={0.5}
                                  max={25}
                                  step={0.1}
                                  value={Number((ov.durationMs / 1000).toFixed(2))}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const nextDurMs = Number.isFinite(val)
                                      ? Math.min(25_000, Math.max(500, Math.round(val * 1000)))
                                      : 3_000;
                                    updateOverlayField(ov.id, { durationMs: nextDurMs });
                                  }}
                                />
                              </label>
                            </div>
                            {(ov.kind === "spotlight_box" || ov.kind === "highlighter") && (
                              <div className="auto-edit-ov-inline" style={{ flexWrap: "wrap", gap: 6 }}>
                                <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 45%", fontSize: 11 }}>
                                  <span>Tâm X ({Math.round((ov.targetX ?? 0.5) * 100)}%)</span>
                                  <input
                                    type="range"
                                    min={5}
                                    max={95}
                                    value={Math.round((ov.targetX ?? 0.5) * 100)}
                                    onChange={(e) => updateOverlayField(ov.id, { targetX: Number(e.target.value) / 100 })}
                                  />
                                </label>
                                <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 45%", fontSize: 11 }}>
                                  <span>Tâm Y ({Math.round((ov.targetY ?? 0.52) * 100)}%)</span>
                                  <input
                                    type="range"
                                    min={5}
                                    max={95}
                                    value={Math.round((ov.targetY ?? 0.52) * 100)}
                                    onChange={(e) => updateOverlayField(ov.id, { targetY: Number(e.target.value) / 100 })}
                                  />
                                </label>
                                <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 45%", fontSize: 11 }}>
                                  <span>Rộng ({Math.round((ov.targetW ?? 0.28) * 100)}%)</span>
                                  <input
                                    type="range"
                                    min={8}
                                    max={85}
                                    value={Math.round((ov.targetW ?? 0.28) * 100)}
                                    onChange={(e) => updateOverlayField(ov.id, { targetW: Number(e.target.value) / 100 })}
                                  />
                                </label>
                                <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 45%", fontSize: 11 }}>
                                  <span>Cao ({Math.round((ov.targetH ?? 0.13) * 100)}%)</span>
                                  <input
                                    type="range"
                                    min={4}
                                    max={65}
                                    value={Math.round((ov.targetH ?? 0.13) * 100)}
                                    onChange={(e) => updateOverlayField(ov.id, { targetH: Number(e.target.value) / 100 })}
                                  />
                                </label>
                              </div>
                            )}
                            {job.images.length > 0 && ov.kind === "product_card" && (
                              <select
                                value={ov.imageId || ""}
                                onChange={(e) => updateOverlayField(ov.id, { imageId: e.target.value || undefined })}
                              >
                                <option value="">-- Không gắn ảnh --</option>
                                {job.images.map((img) => (
                                  <option key={img.id} value={img.id}>
                                    {img.id}: {img.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="auto-edit-ov-inline">
                              <select
                                value={ov.sfxId || "none"}
                                onChange={(e) => updateOverlayField(ov.id, { sfxId: e.target.value })}
                                aria-label="Hiệu ứng âm thanh SFX"
                              >
                                <option value="none">🔇 Không phát SFX</option>
                                {sfxGroups.map(([cat, list]) => (
                                  <optgroup key={cat} label={SFX_CATEGORY_LABELS[cat]}>
                                    {list.map((sfx) => (
                                      <option key={sfx.id} value={sfx.id}>
                                        🔊 {sfx.label} ({(sfx.durationMs / 1000).toFixed(1)}s)
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="auto-edit-mini-btn"
                                disabled={!ov.sfxId || ov.sfxId === "none"}
                                onClick={() => previewSfxSound(ov.sfxId)}
                                title="Nghe thử SFX này"
                              >
                                Nghe
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {draftEdl.directorNotes.length > 0 && (
                    <div className="auto-edit-notes-box">
                      <h4>Ghi chú của Đạo diễn AI</h4>
                      <ul>
                        {draftEdl.directorNotes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CREATE_VIDEO_PRESET_CATEGORIES,
  CREATE_VIDEO_PRESETS,
  computeCreateVideoTimeline,
  type CreateVideoAspectRatio,
  type CreateVideoCaptionStyle,
  type CreateVideoChapter,
  type CreateVideoHighlightColor,
  type CreateVideoInputMode,
  type CreateVideoJob,
  type CreateVideoJobSummary,
  type CreateVideoOutline,
  type CreateVideoPalette,
  type CreateVideoPlan,
  type CreateVideoPresetCategory,
  type CreateVideoPresetId,
  type CreateVideoScene,
  type CreateVideoSceneKind,
  type CreateVideoSeamTechnique,
  type CreateVideoStage,
  type CreateVideoVector,
  type CreateVideoVoiceMode,
  type CreateVideoWorkflowMode,
} from "../lib/motion-video";
import { SFX_CATALOG, SFX_CATEGORY_LABELS, type SfxCategory } from "../lib/sfx-library";
import { MotionVideoRemotionComposition } from "./motion-video-remotion-composition";
import { Icon, type IconName } from "./ui-icon";

const statusLabels: Record<CreateVideoStage, string> = {
  queued: "Đang chờ",
  ingesting_source: "Đang đọc URL & chụp 3D",
  planning_outline: "Agent đang chia Chương",
  awaiting_outline_approval: "Chờ duyệt Dàn ý Chương",
  scripting_scenes: "Agent đang viết kịch bản & Motion",
  synthesizing_voice: "Đang tạo giọng đọc & khoá nhịp",
  ready: "Sẵn sàng duyệt",
  rendering: "Đang xuất MP4",
  rendered: "Đã xuất MP4",
  failed: "Thất bại",
};

const statusBadgeClasses: Record<CreateVideoStage, string> = {
  queued: "draft",
  ingesting_source: "processing",
  planning_outline: "processing",
  awaiting_outline_approval: "draft",
  scripting_scenes: "processing",
  synthesizing_voice: "processing",
  ready: "ready",
  rendering: "processing",
  rendered: "ready",
  failed: "failed",
};

const sceneKindLabels: Record<CreateVideoSceneKind, string> = {
  kinetic_hook: "Kinetic Waterfall Hook",
  chapter_card: "Thẻ Mở đầu Chương",
  browser_3d_showcase: "Sân khấu Web / Bài viết 3D",
  stat_counter_3d: "Biểu đồ Khối & Số đếm 3D",
  comparison_split: "Đối chiếu 2 Cột (Nudge Curve)",
  quote_editorial: "Trích dẫn Báo chí kiểu Vox",
  hyperframes_custom: "HyperFrames HTML/CSS Card",
  cta_climax: "Cao trào CTA (Inverse-Zoom)",
};

const sceneKindIcons: Record<CreateVideoSceneKind, IconName> = {
  kinetic_hook: "bolt", chapter_card: "stack", browser_3d_showcase: "external",
  stat_counter_3d: "grid", comparison_split: "layers", quote_editorial: "file",
  hyperframes_custom: "spark", cta_climax: "arrow",
};

const categoryIcons: Record<string, IconName> = { all: "grid", launch: "motion", knowledge: "file", social: "bolt" };
const presetIcons: Record<string, IconName> = {
  "apple-launch": "motion", "article-recap": "file", "vox-explainer": "file",
  "tech-news": "bolt", "finance-data": "grid", "commerce-promo": "image",
  "viral-hook": "bolt", "minimal-brand": "spark",
};
const withoutLeadingEmoji = (value: string) => value.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\s)+/u, "");

const seamTechniqueLabels: Record<CreateVideoSeamTechnique, string> = {
  "cut-the-curve": "Cut-the-Curve (Khớp vận tốc)",
  "zoom-through": "Zoom-Through (Xuyên trục Z+)",
  "inverse-zoom": "Inverse-Zoom (Hạ cánh Z-)",
  "waterfall-cut": "Waterfall Cut (Đổ thác)",
  "whip-blur": "Whip-Blur (Lướt mờ tốc độ)",
};

const DURATION_QUICK_PRESETS = [
  { sec: 45, label: "45s" },
  { sec: 90, label: "90s" },
  { sec: 180, label: "3 phút" },
  { sec: 300, label: "5 phút" },
  { sec: 600, label: "10 phút" },
  { sec: 900, label: "15 phút" },
  { sec: 1200, label: "20 phút" },
  { sec: 1800, label: "30 phút" },
];

function formatTimeMs(ms: number) {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${secs}`;
}

function formatDurationSummary(rawSec: string) {
  const sec = Math.min(1800, Math.max(15, Math.round(Number(rawSec) || 45)));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  const timeText = mins > 0 ? `${mins} phút${rem > 0 ? ` ${rem} giây` : ""}` : `${sec} giây`;
  if (sec > 150) {
    const chaps = Math.min(20, Math.max(2, Math.round(sec / 75)));
    return `${timeText} · Tự chia ~${chaps} chương`;
  }
  return `${timeText} · Video ngắn 1 lượt`;
}

async function apiMotionVideo<T>(init?: RequestInit, id?: string): Promise<T> {
  const url = `/api/motion-video${id ? `?id=${encodeURIComponent(id)}` : ""}`;
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) {
    throw new Error(payload?.message || "Không thể kết nối máy chủ Motion Video.");
  }
  return payload;
}

type VoiceOption = { id: string; name: string; language?: string };
type PendingUploadImage = { file: File; label: string };

export function MotionVideoView({ initialJobId = "" }: { initialJobId?: string }) {
  const playerRef = useRef<PlayerRef>(null);
  const loadedJobIdRef = useRef<string | undefined>(undefined);

  const [jobs, setJobs] = useState<CreateVideoJobSummary[]>([]);
  const [selectedId, setSelectedId] = useState(initialJobId);
  const [job, setJob] = useState<CreateVideoJob>();
  const [draftPlan, setDraftPlan] = useState<CreateVideoPlan>();
  const [dirtyPlan, setDirtyPlan] = useState(false);
  const [draftOutline, setDraftOutline] = useState<CreateVideoOutline>();
  const [approvingOutline, setApprovingOutline] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState("");
  const [chapterFilter, setChapterFilter] = useState<number | "all">("all");

  // Creation intake state
  const [inputMode, setInputMode] = useState<CreateVideoInputMode>("article_url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [topicQuery, setTopicQuery] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [direction, setDirection] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);

  const [presetCategory, setPresetCategory] = useState<"all" | CreateVideoPresetCategory>("all");
  const [preset, setPreset] = useState<CreateVideoPresetId>("article-recap");
  const [aspectRatio, setAspectRatio] = useState<CreateVideoAspectRatio>("9:16");
  const [targetDurationSec, setTargetDurationSec] = useState("45");
  const [workflowMode, setWorkflowMode] = useState<CreateVideoWorkflowMode>("auto_one_click");
  const [language, setLanguage] = useState<"vi" | "en">("vi");
  const [voiceMode, setVoiceMode] = useState<CreateVideoVoiceMode>("omnivoice");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [captionStyle, setCaptionStyle] = useState<CreateVideoCaptionStyle>("clean-pill");
  const [motionBlur, setMotionBlur] = useState(true);
  const [safeZoneGuard, setSafeZoneGuard] = useState(true);
  const [autoSfx, setAutoSfx] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Studio controls
  const [studioAspectRatio, setStudioAspectRatio] = useState<CreateVideoAspectRatio>("9:16");
  const [studioMotionBlur, setStudioMotionBlur] = useState(true);
  const [showSafeZoneGuide, setShowSafeZoneGuide] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedSummary = jobs.find((j) => j.id === selectedId);
  const selectedUpdatedAt = selectedSummary?.updatedAt;

  useEffect(() => {
    fetch("/api/omnivoice/voices")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.voices)) {
          const mapped: VoiceOption[] = (data.voices as unknown[])
            .filter((v): v is { id: string; name?: string; language?: string } =>
              Boolean(v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string"),
            )
            .map((v) => ({ id: v.id, name: v.name || v.id, language: v.language }));
          setVoices(mapped);
          if (mapped[0] && !voiceId) setVoiceId(mapped[0].id);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function pollList() {
      try {
        const data = await apiMotionVideo<{ jobs: CreateVideoJobSummary[] }>({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setJobs(data.jobs);
        if (!selectedId && data.jobs[0]) {
          setSelectedId(data.jobs[0].id);
        }
      } catch {
        // Silent polling
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
    void apiMotionVideo<{ job: CreateVideoJob }>({ signal: controller.signal }, selectedId)
      .then(({ job: fetched }) => {
        if (controller.signal.aborted) return;
        const isJobSwitch = fetched.id !== loadedJobIdRef.current;
        loadedJobIdRef.current = fetched.id;
        setJob(fetched);
        if (isJobSwitch || !dirtyPlan) {
          setStudioAspectRatio(fetched.options.aspectRatio);
          setStudioMotionBlur(fetched.options.motionBlur ?? true);
        }
        if (fetched.outline && (isJobSwitch || fetched.status === "awaiting_outline_approval")) {
          setDraftOutline((prev) => (isJobSwitch || !prev ? fetched.outline : prev));
        }
        setDraftPlan((prev) => {
          if (!fetched.plan) return undefined;
          if (!prev || isJobSwitch || !dirtyPlan) {
            if (fetched.plan.scenes[0] && isJobSwitch) {
              setActiveSceneId(fetched.plan.scenes[0].id);
              setChapterFilter("all");
            }
            return fetched.plan;
          }
          return prev;
        });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [selectedId, selectedUpdatedAt, revision, dirtyPlan]);

  const computedTimeline = useMemo(() => {
    if (!job || !draftPlan) return undefined;
    return computeCreateVideoTimeline(
      draftPlan,
      studioAspectRatio,
      job.audio?.words || [],
      { autoSfx: job.options.autoSfx, sfxVolumeDb: job.options.sfxVolumeDb },
    );
  }, [job, draftPlan, studioAspectRatio]);

  const chapterTabs = useMemo(() => {
    if (!computedTimeline) return [];
    const seen = new Map<number, { index: number; title: string; count: number; firstMs: number }>();
    for (const sc of computedTimeline.scenes) {
      if (typeof sc.chapterIndex !== "number") continue;
      const existing = seen.get(sc.chapterIndex);
      if (existing) {
        existing.count++;
      } else {
        seen.set(sc.chapterIndex, {
          index: sc.chapterIndex,
          title: sc.chapterTitle || `Chương ${sc.chapterIndex + 1}`,
          count: 1,
          firstMs: sc.timelineStartMs,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.index - b.index);
  }, [computedTimeline]);

  const visibleScenes = useMemo(() => {
    if (!computedTimeline) return [];
    if (chapterFilter === "all") return computedTimeline.scenes;
    return computedTimeline.scenes.filter((s) => s.chapterIndex === chapterFilter);
  }, [computedTimeline, chapterFilter]);

  const sfxGroups = useMemo(() => {
    const grouped = new Map<SfxCategory, typeof SFX_CATALOG[number][]>();
    for (const item of SFX_CATALOG) {
      const list = grouped.get(item.category) || [];
      list.push(item);
      grouped.set(item.category, list);
    }
    return [...grouped.entries()];
  }, []);

  const filteredPresets = useMemo(
    () => (presetCategory === "all" ? CREATE_VIDEO_PRESETS : CREATE_VIDEO_PRESETS.filter((p) => p.category === presetCategory)),
    [presetCategory],
  );

  const selectedScene = useMemo(
    () => draftPlan?.scenes.find((s) => s.id === activeSceneId) || draftPlan?.scenes[0],
    [draftPlan, activeSceneId],
  );

  function applyPreset(item: (typeof CREATE_VIDEO_PRESETS)[number]) {
    setPreset(item.id);
    setAspectRatio(item.recommendedAspect);
    setCaptionStyle(item.defaultCaptionStyle);
  }

  function addUploadImages(files: FileList | null) {
    if (!files?.length) return;
    const items = Array.from(files).map((file) => ({
      file,
      label: file.name.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ").trim().slice(0, 60),
    }));
    setPendingImages((prev) => [...prev, ...items].slice(0, 12));
  }

  function previewSfxSound(sfxId?: string) {
    if (!sfxId || sfxId === "none") return;
    const audio = new Audio(`/api/auto-edit/sfx/${encodeURIComponent(sfxId)}`);
    audio.volume = 0.55;
    void audio.play().catch(() => undefined);
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);

    try {
      const parsedDuration = Math.min(1800, Math.max(15, Math.round(Number(targetDurationSec) || 45)));
      const optionsPayload = {
        inputMode,
        sourceUrl: sourceUrl.trim(),
        topicQuery: topicQuery.trim(),
        rawContent: rawContent.trim(),
        direction: direction.trim(),
        targetDurationSec: parsedDuration,
        workflowMode,
        preset,
        aspectRatio,
        language,
        voiceMode,
        voiceId,
        captionStyle,
        motionBlur,
        safeZoneGuard,
        autoSfx,
        sfxVolumeDb: -9.0,
      };

      let created: { id: string };
      if (pendingImages.length > 0) {
        const form = new FormData();
        form.set("options", JSON.stringify(optionsPayload));
        form.set("imageLabels", JSON.stringify(pendingImages.map((p) => p.label)));
        for (const item of pendingImages) {
          form.append("images", item.file);
        }
        created = await apiMotionVideo<{ id: string }>({ method: "POST", body: form });
      } else {
        created = await apiMotionVideo<{ id: string }>({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: optionsPayload }),
        });
      }

      setDirtyPlan(false);
      setDraftOutline(undefined);
      setSelectedId(created.id);
      setPendingImages([]);
      setRevision((r) => r + 1);
      setNotice(
        workflowMode === "review_outline"
          ? "Đã khởi tạo! Code Agent đang lập Dàn ý Chương để bạn kiểm tra trước khi dựng chi tiết."
          : "Đã khởi tạo dự án Motion Video! Code Agent đang chia Chương, viết kịch bản và dựng sân khấu 3D + GSAP...",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function updateDraftChapter(idx: number, updater: (ch: CreateVideoChapter) => CreateVideoChapter) {
    if (!draftOutline) return;
    setDraftOutline({
      ...draftOutline,
      chapters: draftOutline.chapters.map((ch, i) => (i === idx ? updater(ch) : ch)),
    });
  }

  function handleAddOutlineChapter() {
    if (!draftOutline || draftOutline.chapters.length >= 24) return;
    const idx = draftOutline.chapters.length;
    const base = draftOutline.chapters[0];
    setDraftOutline({
      ...draftOutline,
      chapters: [
        ...draftOutline.chapters,
        {
          id: `chap_${String(idx + 1).padStart(2, "0")}_${Date.now().toString(36).slice(-2)}`,
          index: idx,
          title: `Chương ${idx + 1}: Luận điểm bổ sung`,
          summary: "Phân tích chuyên sâu nội dung mở rộng.",
          targetDurationSec: 75,
          keyPoints: ["Luận điểm chính của chương mới"],
          palette: base?.palette || "midnight-cyan",
          dominantVector: base?.dominantVector || draftOutline.dominantVector,
        },
      ],
    });
  }

  function handleMoveOutlineChapter(idx: number, dir: -1 | 1) {
    if (!draftOutline) return;
    const target = idx + dir;
    if (target < 0 || target >= draftOutline.chapters.length) return;
    const copy = [...draftOutline.chapters];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setDraftOutline({
      ...draftOutline,
      chapters: copy.map((c, i) => ({ ...c, index: i })),
    });
  }

  function handleDeleteOutlineChapter(idx: number) {
    if (!draftOutline || draftOutline.chapters.length <= 2) return;
    setDraftOutline({
      ...draftOutline,
      chapters: draftOutline.chapters.filter((_, i) => i !== idx).map((c, i) => ({ ...c, index: i })),
    });
  }

  async function handleApproveOutline() {
    if (!job || !draftOutline) return;
    setApprovingOutline(true);
    setError("");
    setNotice("");
    const sanitizedOutline: CreateVideoOutline = {
      ...draftOutline,
      chapters: draftOutline.chapters.map((c) => ({
        ...c,
        keyPoints: c.keyPoints.map((s) => s.trim()).filter(Boolean),
      })),
    };
    try {
      const res = await apiMotionVideo<{ job: CreateVideoJob }>({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "approve-outline",
          outline: sanitizedOutline,
        }),
      });
      setJob(res.job);
      setRevision((r) => r + 1);
      setNotice("Đã duyệt Dàn ý Chương! Code Agent đang viết kịch bản chi tiết từng Chương và tạo giọng đọc song song...");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingOutline(false);
    }
  }

  function patchScene(sceneId: string, updater: (scene: CreateVideoScene) => CreateVideoScene) {
    if (!draftPlan) return;
    setDirtyPlan(true);
    setDraftPlan({
      ...draftPlan,
      scenes: draftPlan.scenes.map((sc) => (sc.id === sceneId ? updater(sc) : sc)),
    });
  }

  function handleAddScene() {
    if (!draftPlan) return;
    const nextIdx = draftPlan.scenes.length + 1;
    const newId = `scene_${String(nextIdx).padStart(2, "0")}_${Date.now().toString(36).slice(-3)}`;
    const activeChap = chapterFilter !== "all" ? chapterFilter : selectedScene?.chapterIndex;
    const activeChapTitle = typeof activeChap === "number"
      ? chapterTabs.find((c) => c.index === activeChap)?.title
      : undefined;
    const newScene: CreateVideoScene = {
      id: newId,
      kind: "hyperframes_custom",
      chapterIndex: activeChap,
      chapterTitle: activeChapTitle,
      badge: "ĐIỂM MỚI",
      headline: `LUẬN ĐIỂM BỔ SUNG #${nextIdx}`,
      subheadline: "Chi tiết trực quan hoá trên sân khấu 3D",
      narrationText: "Nội dung thuyết minh cho phân cảnh mới.",
      durationMs: 4200,
      palette: draftPlan.scenes[0]?.palette || "midnight-cyan",
      accentColor: "cyan",
      emoji: "✨",
      seamOut: {
        technique: "cut-the-curve",
        vector: draftPlan.dominantVector,
        durationMs: 300,
        sfxId: "transition-sweep",
      },
    };
    const nextScenes = [...draftPlan.scenes];
    if (typeof activeChap === "number") {
      const selectedPos = selectedScene ? nextScenes.findIndex((s) => s.id === selectedScene.id) : -1;
      if (selectedPos >= 0 && nextScenes[selectedPos].chapterIndex === activeChap) {
        nextScenes.splice(selectedPos + 1, 0, newScene);
      } else {
        let lastChapPos = -1;
        for (let i = nextScenes.length - 1; i >= 0; i--) {
          if (nextScenes[i].chapterIndex === activeChap) {
            lastChapPos = i;
            break;
          }
        }
        if (lastChapPos >= 0) nextScenes.splice(lastChapPos + 1, 0, newScene);
        else nextScenes.push(newScene);
      }
    } else {
      nextScenes.push(newScene);
    }
    setDirtyPlan(true);
    setDraftPlan({ ...draftPlan, scenes: nextScenes });
    setActiveSceneId(newId);
  }

  function handleDeleteScene(sceneId: string) {
    if (!draftPlan || draftPlan.scenes.length <= 1) return;
    const remaining = draftPlan.scenes.filter((s) => s.id !== sceneId);
    setDirtyPlan(true);
    setDraftPlan({ ...draftPlan, scenes: remaining });
    if (activeSceneId === sceneId && remaining[0]) {
      setActiveSceneId(remaining[0].id);
    }
  }

  async function handleSavePlan() {
    if (!job || !draftPlan) return;
    setSavingPlan(true);
    setError("");
    setNotice("");
    try {
      const res = await apiMotionVideo<{ job: CreateVideoJob }>({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "update-plan",
          plan: draftPlan,
          optionsPatch: {
            aspectRatio: studioAspectRatio,
            motionBlur: studioMotionBlur,
          },
        }),
      });
      setJob(res.job);
      setDraftPlan(res.job.plan);
      setDirtyPlan(false);
      setNotice("Đã lưu kịch bản phân cảnh & đồng bộ lại Audio-Clock.");
      setRevision((r) => r + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleCopilotTweak(event: FormEvent) {
    event.preventDefault();
    if (!job || !copilotPrompt.trim()) return;
    setCopilotBusy(true);
    setError("");
    setNotice("");
    try {
      const scopedChapter = chapterFilter !== "all"
        ? chapterFilter
        : selectedScene?.chapterIndex;
      const res = await apiMotionVideo<{ job: CreateVideoJob }>({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "copilot-tweak",
          instruction: copilotPrompt.trim(),
          chapterIndex: scopedChapter,
        }),
      });
      setJob(res.job);
      setDraftPlan(res.job.plan);
      setDirtyPlan(false);
      setCopilotPrompt("");
      setNotice("Code Agent đã cập nhật kịch bản, hiệu ứng 3D/GSAP và đồng bộ lại nhịp Audio!");
      setRevision((r) => r + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCopilotBusy(false);
    }
  }

  async function handleRenderMp4() {
    if (!job || !draftPlan) return;
    setRendering(true);
    setError("");
    setNotice("");
    try {
      if (dirtyPlan) {
        await apiMotionVideo({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: job.id,
            action: "update-plan",
            plan: draftPlan,
            optionsPatch: { aspectRatio: studioAspectRatio, motionBlur: studioMotionBlur },
          }),
        });
        setDirtyPlan(false);
      }
      await apiMotionVideo({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          action: "render",
          optionsPatch: { aspectRatio: studioAspectRatio, motionBlur: studioMotionBlur },
        }),
      });
      setNotice("Đang kết xuất MP4 bằng Chromium WebGL + Three.js + GSAP + FFmpeg...");
      setRevision((r) => r + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRendering(false);
    }
  }

  async function handleRetryJob(id: string) {
    setError("");
    try {
      await apiMotionVideo({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "retry" }),
      });
      setRevision((r) => r + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function seekPlayerToMs(ms: number) {
    if (!playerRef.current || !computedTimeline) return;
    const targetFrame = Math.min(
      computedTimeline.totalFrames - 1,
      Math.max(0, Math.round((ms / 1000) * computedTimeline.fps)),
    );
    playerRef.current.seekTo(targetFrame);
  }

  const playerMaxWidth = studioAspectRatio === "16:9" ? 680 : studioAspectRatio === "1:1" ? 440 : 340;
  const outlineTotalSec = draftOutline
    ? draftOutline.chapters.reduce((sum, c) => sum + c.targetDurationSec, 0)
    : 0;

  return (
    <div className="auto-edit-workspace motion-video-workspace">
      {/* 1. PROJECT QUEUE */}
      {jobs.length > 0 && (
        <section className="card auto-edit-queue-card">
          <div className="auto-edit-templates-head">
            <div>
              <strong>Dự án Motion Video ({jobs.length})</strong>
            </div>
          </div>
          <div className="auto-edit-job-pills">
            {jobs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`auto-edit-job-pill ${selectedId === item.id ? "is-active" : ""}`}
                onClick={() => {
                  setDirtyPlan(false);
                  setDraftOutline(undefined);
                  setSelectedId(item.id);
                }}
              >
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.aspectRatio}
                    {item.chapterCount ? ` · ${item.chapterCount} chương` : ""}
                    {item.sceneCount ? ` · ${item.sceneCount} cảnh` : ""}
                    {item.durationMs ? ` · ${formatTimeMs(item.durationMs)}` : ""}
                  </small>
                </div>
                <span className={`status-pill ${statusBadgeClasses[item.status]}`}>
                  {statusLabels[item.status]}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 2. ACTIVE JOB PROGRESS (Excluding awaiting_outline_approval which renders Outline Editor) */}
      {job &&
        job.status !== "awaiting_outline_approval" &&
        job.status !== "ready" &&
        job.status !== "rendered" &&
        job.status !== "rendering" && (
          <section className="card auto-edit-studio-card">
            <div className="auto-edit-studio-header">
              <div>
                <span className={`status-pill ${statusBadgeClasses[job.status]}`}>{statusLabels[job.status]}</span>
                <h2 style={{ marginTop: 8 }}>
                  {job.plan?.title || job.outline?.title || job.sourceBrief?.sourceTitle || job.options.topicQuery || "Đang khởi tạo Motion Video..."}
                </h2>
                <p className="auto-edit-summary">{job.progress}</p>
              </div>
              {job.status === "failed" && (
                <button type="button" className="button primary" onClick={() => handleRetryJob(job.id)}>
                  <Icon name="refresh" size={16} />
                  <span>Chạy lại dự án</span>
                </button>
              )}
            </div>
            {job.error && <div className="auto-edit-error-banner" style={{ marginTop: 12 }}>{job.error}</div>}
          </section>
        )}

      {/* 3. STEP 2A: OUTLINE REVIEW & APPROVAL EDITOR */}
      {job && job.status === "awaiting_outline_approval" && draftOutline && (
        <section className="card auto-edit-studio-card motion-video-outline-card">
          <div className="auto-edit-studio-header">
            <div>
              <span className={`status-pill ${statusBadgeClasses[job.status]}`}>{statusLabels[job.status]}</span>
              <h2 style={{ marginTop: 8 }}>Duyệt Dàn ý Chương trước khi Dựng Phân cảnh</h2>
              <p className="auto-edit-summary">
                Video dự kiến <strong>{draftOutline.chapters.length} chương</strong> · Tổng thời lượng khoảng{" "}
                <strong>{Math.floor(outlineTotalSec / 60)} phút {outlineTotalSec % 60} giây</strong>. Bạn có thể sửa tên, thời lượng hoặc luận điểm từng chương rồi bấm Duyệt.
              </p>
            </div>
            <div className="auto-edit-header-actions">
              <button type="button" className="button ghost" onClick={handleAddOutlineChapter} disabled={draftOutline.chapters.length >= 24}>
                + Thêm Chương
              </button>
              <button type="button" className="button primary" onClick={handleApproveOutline} disabled={approvingOutline}>
                <Icon name="check" size={16} />
                <span>{approvingOutline ? "Đang gửi duyệt..." : "Duyệt Dàn ý & Dựng Toàn bộ Phân cảnh"}</span>
              </button>
            </div>
          </div>

          <div className="motion-video-outline-meta">
            <label className="field">
              <span>Tiêu đề tổng của Video</span>
              <input
                type="text"
                value={draftOutline.title}
                onChange={(e) => setDraftOutline({ ...draftOutline, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Tóm tắt mạch truyện xuyên suốt</span>
              <input
                type="text"
                value={draftOutline.summary}
                onChange={(e) => setDraftOutline({ ...draftOutline, summary: e.target.value })}
              />
            </label>
          </div>

          <div className="motion-video-outline-list">
            {draftOutline.chapters.map((chap, idx) => (
              <div key={chap.id} className="motion-video-outline-item">
                <div className="motion-video-outline-item-head">
                  <strong>Chương {String(idx + 1).padStart(2, "0")}</strong>
                  <div className="auto-edit-seg-controls">
                    <button
                      type="button"
                      className="auto-edit-mini-btn"
                      onClick={() => handleMoveOutlineChapter(idx, -1)}
                      disabled={idx === 0}
                      title="Đưa lên"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="auto-edit-mini-btn"
                      onClick={() => handleMoveOutlineChapter(idx, 1)}
                      disabled={idx === draftOutline.chapters.length - 1}
                      title="Đưa xuống"
                    >
                      ↓
                    </button>
                    {draftOutline.chapters.length > 2 && (
                      <button
                        type="button"
                        className="auto-edit-mini-btn"
                        onClick={() => handleDeleteOutlineChapter(idx)}
                        title="Xoá chương"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="motion-video-outline-fields">
                  <label className="motion-video-mini-field" style={{ flex: 2 }}>
                    <span>Tên Chương</span>
                    <input
                      type="text"
                      value={chap.title}
                      onChange={(e) => updateDraftChapter(idx, (c) => ({ ...c, title: e.target.value }))}
                    />
                  </label>

                  <label className="motion-video-mini-field" style={{ width: 120 }}>
                    <span>Thời lượng (giây)</span>
                    <input
                      type="number"
                      min={25}
                      max={240}
                      value={chap.targetDurationSec}
                      onChange={(e) =>
                        updateDraftChapter(idx, (c) => ({
                          ...c,
                          targetDurationSec: Math.min(240, Math.max(25, Number(e.target.value) || 60)),
                        }))
                      }
                    />
                  </label>

                  <label className="motion-video-mini-field" style={{ width: 160 }}>
                    <span>Bảng màu 3D</span>
                    <select
                      value={chap.palette}
                      onChange={(e) =>
                        updateDraftChapter(idx, (c) => ({ ...c, palette: e.target.value as CreateVideoPalette }))
                      }
                    >
                      <option value="midnight-cyan">Midnight Cyan</option>
                      <option value="aurora-violet">Aurora Violet</option>
                      <option value="emerald-tech">Emerald Tech</option>
                      <option value="crimson-energy">Crimson Energy</option>
                      <option value="amber-editorial">Amber Editorial</option>
                      <option value="slate-minimal">Slate Minimal</option>
                    </select>
                  </label>
                </div>

                <div className="motion-video-outline-fields">
                  <label className="motion-video-mini-field" style={{ flex: 1 }}>
                    <span>Trọng tâm chương</span>
                    <input
                      type="text"
                      value={chap.summary}
                      onChange={(e) => updateDraftChapter(idx, (c) => ({ ...c, summary: e.target.value }))}
                    />
                  </label>
                  <label className="motion-video-mini-field" style={{ flex: 1.2 }}>
                    <span>Các luận điểm chính (mỗi dòng 1 ý)</span>
                    <textarea
                      rows={2}
                      className="motion-video-inspector-textarea"
                      value={chap.keyPoints.join("\n")}
                      onChange={(e) =>
                        updateDraftChapter(idx, (c) => ({
                          ...c,
                          keyPoints: e.target.value.split(/\r?\n/u),
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. 3-COLUMN MOTION STUDIO */}
      {job && draftPlan && computedTimeline && (
        <section className="card auto-edit-studio-card">
          <div className="auto-edit-studio-header">
            <div>
              <span className={`status-pill ${statusBadgeClasses[job.status]}`}>{statusLabels[job.status]}</span>
              <h2 style={{ marginTop: 6 }}>{draftPlan.title}</h2>
              <p className="auto-edit-summary">{draftPlan.summary}</p>
            </div>

            <div className="auto-edit-header-actions">
              {dirtyPlan && (
                <button type="button" className="button ghost" onClick={handleSavePlan} disabled={savingPlan}>
                  <Icon name="save" size={16} />
                  <span>{savingPlan ? "Đang lưu & đồng bộ..." : "Lưu thay đổi"}</span>
                </button>
              )}

              <button
                type="button"
                className="button primary"
                onClick={handleRenderMp4}
                disabled={rendering || job.status === "rendering"}
              >
                <Icon name="play" size={16} />
                <span>{job.status === "rendering" ? "Đang kết xuất MP4..." : "Xuất Video MP4"}</span>
              </button>

              {job.render?.status === "ready" && (
                <a
                  className="button ghost"
                  href={`/api/motion-video/${encodeURIComponent(job.id)}/media?kind=render&download=1&t=${encodeURIComponent(job.render.updatedAt)}`}
                >
                  <Icon name="download" size={16} />
                  <span>Tải MP4</span>
                </a>
              )}
            </div>
          </div>

          {job.status === "rendering" && (
            <div className="auto-edit-progress-banner">{job.progress}</div>
          )}

          <div className="auto-edit-metrics-bar">
            <div>
              <span>Tổng thời lượng</span>
              <strong>{formatTimeMs(computedTimeline.totalDurationMs)} ({computedTimeline.totalFrames} frames)</strong>
            </div>
            <div>
              <span>Phân cảnh &amp; Chương</span>
              <strong>
                {chapterTabs.length ? `${chapterTabs.length} Chương · ` : ""}
                {computedTimeline.scenes.length} Scenes · 30 FPS
              </strong>
            </div>
            <div>
              <span>Dòng chảy Camera (Current)</span>
              <strong>Vector {draftPlan.dominantVector.toUpperCase()}</strong>
            </div>
            <div>
              <span>Âm thanh &amp; Giọng đọc</span>
              <strong>
                {job.audio?.hasVoiceover
                  ? `Có Voice (${job.audio.voiceBackend === "omnivoice" ? "OmniVoice" : "System TTS"})`
                  : "Kinetic Promo"} · {computedTimeline.sfxEvents.length} SFX
              </strong>
            </div>
            <div>
              <span>Tư liệu hình ảnh</span>
              <strong>{job.images.length} ảnh trên Stage 3D</strong>
            </div>
          </div>

          <div className="auto-edit-studio-columns">
            {/* LEFT COLUMN: Chapter Filter + Scene List */}
            <div className="auto-edit-col">
              <div className="auto-edit-overlays-header">
                <div className="auto-edit-col-head">
                  <h3>1. Kịch bản Phân cảnh</h3>
                  <small>Bấm vào từng phân cảnh để xem trước và tinh chỉnh đồ hoạ</small>
                </div>
                <button type="button" className="auto-edit-mini-btn" onClick={handleAddScene}>
                  + Thêm cảnh
                </button>
              </div>

              {chapterTabs.length > 0 && (
                <div className="motion-video-chapter-pills">
                  <button
                    type="button"
                    className={`auto-edit-cat-pill ${chapterFilter === "all" ? "is-active" : ""}`}
                    onClick={() => setChapterFilter("all")}
                  >
                    Tất cả ({computedTimeline.scenes.length})
                  </button>
                  {chapterTabs.map((ch) => (
                    <button
                      key={ch.index}
                      type="button"
                      className={`auto-edit-cat-pill ${chapterFilter === ch.index ? "is-active" : ""}`}
                      onClick={() => {
                        setChapterFilter(ch.index);
                        seekPlayerToMs(ch.firstMs + 80);
                      }}
                      title={ch.title}
                    >
                      Ch.{ch.index + 1} ({ch.count})
                    </button>
                  ))}
                </div>
              )}

              <div className="auto-edit-segment-list">
                {visibleScenes.map((sc) => {
                  const isSelected = selectedScene?.id === sc.id;
                  return (
                    <div
                      key={sc.id}
                      className={`auto-edit-seg-item motion-video-scene-card ${isSelected ? "is-selected" : ""}`}
                      onClick={() => {
                        setActiveSceneId(sc.id);
                        seekPlayerToMs(sc.timelineStartMs + 120);
                      }}
                    >
                      <div className="auto-edit-seg-top">
                        <button
                          type="button"
                          className="auto-edit-seg-time"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSceneId(sc.id);
                            seekPlayerToMs(sc.timelineStartMs + 60);
                          }}
                        >
                          #{sc.index + 1} · {formatTimeMs(sc.timelineStartMs)} → {formatTimeMs(sc.timelineEndMs)}
                        </button>
                        <div className="auto-edit-seg-controls">
                          <span className="motion-video-kind-pill"><Icon name={sceneKindIcons[sc.kind]} size={13} /> {sceneKindLabels[sc.kind]}</span>
                          {draftPlan.scenes.length > 1 && (
                            <button
                              type="button"
                              className="auto-edit-mini-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteScene(sc.id);
                              }}
                              aria-label={`Xoá cảnh ${sc.index + 1}`}
                              title="Xoá phân cảnh này"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      <strong className="motion-video-scene-headline">
                        {sc.headline}
                      </strong>
                      <p className="auto-edit-seg-text">{sc.narrationText}</p>
                      <small className="auto-edit-seg-note">
                        Seam ra: <strong>{sc.seamOut.technique}</strong> ({sc.seamOut.vector} · {sc.seamOut.durationMs}ms)
                      </small>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CENTER COLUMN: Remotion + Three.js + GSAP Live Preview */}
            <div className="auto-edit-col motion-video-preview">
              <div className="auto-edit-col-head">
                <h3>2. Xem trước</h3>
              </div>

              <div className="auto-edit-player-toggles">
                <select
                  aria-label="Tỷ lệ khung hình xem trước"
                  value={studioAspectRatio}
                  onChange={(e) => {
                    setStudioAspectRatio(e.target.value as CreateVideoAspectRatio);
                    setDirtyPlan(true);
                  }}
                >
                  <option value="9:16">Khung dọc 9:16 (1080×1920)</option>
                  <option value="16:9">Khung ngang 16:9 (1920×1080)</option>
                  <option value="1:1">Khung vuông 1:1 (1080×1080)</option>
                </select>

                <label className="auto-edit-safezone-toggle">
                  <input
                    type="checkbox"
                    checked={studioMotionBlur}
                    onChange={(e) => {
                      setStudioMotionBlur(e.target.checked);
                      setDirtyPlan(true);
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

              <div className="auto-edit-player-stage">
                <div style={{ width: "100%", maxWidth: playerMaxWidth }}>
                  <Player
                    ref={playerRef}
                    component={MotionVideoRemotionComposition}
                    inputProps={{
                      jobId: job.id,
                      timeline: computedTimeline,
                      hasVoiceover: Boolean(job.audio?.hasVoiceover),
                      audioRevision: job.updatedAt,
                      imageIds: job.images.map((img) => img.id),
                      captionStyle: draftPlan.captionStyle,
                      keywordHighlights: draftPlan.keywordHighlights,
                      dominantVector: draftPlan.dominantVector,
                      aspectRatio: studioAspectRatio,
                      safeZoneGuard: job.options.safeZoneGuard,
                      showSafeZoneGuide,
                      motionBlur: studioMotionBlur,
                    }}
                    durationInFrames={computedTimeline.totalFrames}
                    fps={computedTimeline.fps}
                    compositionWidth={computedTimeline.width}
                    compositionHeight={computedTimeline.height}
                    style={{ width: "100%", borderRadius: 12, overflow: "hidden" }}
                    controls
                    acknowledgeRemotionLicense
                  />
                </div>
              </div>

              {job.render?.status === "ready" && (
                <div className="auto-edit-notes-box">
                  <h4><Icon name="check" size={16} /> File MP4 đã kết xuất ({Math.round(((job.render.sizeBytes || 0) / 1024 / 1024) * 10) / 10} MB)</h4>
                  <video
                    controls
                    preload="metadata"
                    style={{ width: "100%", maxHeight: 280, borderRadius: 10, background: "#000" }}
                    src={`/api/motion-video/${encodeURIComponent(job.id)}/media?kind=render&t=${encodeURIComponent(job.render.updatedAt)}`}
                  />
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: AI Copilot & Active Scene Inspector */}
            <div className="auto-edit-col motion-video-inspector">
              <form className="auto-edit-copilot-box" onSubmit={handleCopilotTweak}>
                <h3>
                  <Icon name="spark" size={16} />
                  <span>
                    AI Motion Copilot
                    {chapterTabs.length > 0 && (chapterFilter !== "all" || typeof selectedScene?.chapterIndex === "number")
                      ? ` (Chương ${(chapterFilter !== "all" ? chapterFilter : (selectedScene?.chapterIndex ?? 0)) + 1})`
                      : ""}
                  </span>
                </h3>
                <p>
                  Nhập yêu cầu chỉnh sửa. Giọng đọc chỉ tổng hợp lại ở những câu có lời thoại thay đổi.
                </p>
                <textarea
                  aria-label="Yêu cầu chỉnh sửa bằng AI"
                  rows={3}
                  placeholder="Ví dụ: Đổi cảnh 2 sang biểu đồ khối 3D với con số 450%, viết câu kết ngắn và bốc hơn..."
                  value={copilotPrompt}
                  onChange={(e) => setCopilotPrompt(e.target.value)}
                />
                <button className="button primary" type="submit" disabled={copilotBusy || !copilotPrompt.trim()}>
                  <Icon name="bolt" size={15} />
                  <span>{copilotBusy ? "Code Agent đang dàn dựng lại..." : "Áp dụng bằng AI Copilot"}</span>
                </button>
              </form>

              {selectedScene && (
                <div className="auto-edit-overlays-box">
                  <h4><Icon name="scene" size={16} /> Tuỳ chỉnh Cảnh #{computedTimeline.scenes.findIndex((s) => s.id === selectedScene.id) + 1}</h4>
                  <div className="auto-edit-ov-fields">
                    <label className="motion-video-mini-field">
                      <span>Loại sân khấu (Scene Archetype)</span>
                      <select
                        value={selectedScene.kind}
                        onChange={(e) =>
                          patchScene(selectedScene.id, (sc) => ({ ...sc, kind: e.target.value as CreateVideoSceneKind }))
                        }
                      >
                        {Object.entries(sceneKindLabels).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="motion-video-mini-field">
                      <span>Tiêu đề hiển thị trên màn hình (Headline)</span>
                      <input
                        type="text"
                        value={selectedScene.headline}
                        onChange={(e) => patchScene(selectedScene.id, (sc) => ({ ...sc, headline: e.target.value }))}
                      />
                    </label>

                    <label className="motion-video-mini-field">
                      <span>Dòng phụ / Trích dẫn (Subheadline)</span>
                      <input
                        type="text"
                        value={selectedScene.subheadline || ""}
                        onChange={(e) => patchScene(selectedScene.id, (sc) => ({ ...sc, subheadline: e.target.value }))}
                      />
                    </label>

                    <label className="motion-video-mini-field">
                      <span>Lời bình thuyết minh (Narration)</span>
                      <textarea
                        rows={3}
                        className="motion-video-inspector-textarea"
                        value={selectedScene.narrationText}
                        onChange={(e) => patchScene(selectedScene.id, (sc) => ({ ...sc, narrationText: e.target.value }))}
                      />
                    </label>

                    <div className="auto-edit-ov-inline">
                      <label className="motion-video-mini-field" style={{ flex: 1 }}>
                        <span>Bảng màu 3D</span>
                        <select
                          value={selectedScene.palette}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({ ...sc, palette: e.target.value as CreateVideoPalette }))
                          }
                        >
                          <option value="midnight-cyan">Midnight Cyan</option>
                          <option value="aurora-violet">Aurora Violet</option>
                          <option value="emerald-tech">Emerald Tech</option>
                          <option value="crimson-energy">Crimson Energy</option>
                          <option value="amber-editorial">Amber Editorial</option>
                          <option value="slate-minimal">Slate Minimal</option>
                        </select>
                      </label>

                      <label className="motion-video-mini-field" style={{ flex: 1 }}>
                        <span>Màu điểm nhấn</span>
                        <select
                          value={selectedScene.accentColor}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({
                              ...sc,
                              accentColor: e.target.value as CreateVideoHighlightColor,
                            }))
                          }
                        >
                          <option value="cyan">Cyan</option>
                          <option value="emerald">Emerald</option>
                          <option value="amber">Amber</option>
                          <option value="rose">Rose</option>
                          <option value="violet">Violet</option>
                        </select>
                      </label>
                    </div>

                    {job.images.length > 0 && selectedScene.kind === "browser_3d_showcase" && (
                      <label className="motion-video-mini-field">
                        <span>Ảnh trình chiếu trên khung Browser 3D</span>
                        <select
                          value={selectedScene.imageId || ""}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({ ...sc, imageId: e.target.value || undefined }))
                          }
                        >
                          <option value="">-- Khung giao diện động tự sinh --</option>
                          {job.images.map((img) => (
                            <option key={img.id} value={img.id}>
                              {img.label} ({img.width}×{img.height})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {selectedScene.kind === "hyperframes_custom" && (
                      <label className="motion-video-mini-field">
                        <span>Mã HTML HyperFrames (hỗ trợ biến --hf-progress)</span>
                        <textarea
                          rows={3}
                          className="motion-video-inspector-textarea"
                          placeholder="<div class='step'>Bước 1: Phân tích tự động</div>"
                          value={selectedScene.hyperframesHtml || ""}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({ ...sc, hyperframesHtml: e.target.value }))
                          }
                        />
                      </label>
                    )}

                    <div className="auto-edit-ov-inline">
                      <label className="motion-video-mini-field" style={{ flex: 1 }}>
                        <span>Kỹ thuật Seam chuyển cảnh</span>
                        <select
                          value={selectedScene.seamOut.technique}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({
                              ...sc,
                              seamOut: { ...sc.seamOut, technique: e.target.value as CreateVideoSeamTechnique },
                            }))
                          }
                        >
                          {Object.entries(seamTechniqueLabels).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="motion-video-mini-field" style={{ width: 110 }}>
                        <span>Hướng Vector</span>
                        <select
                          value={selectedScene.seamOut.vector}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({
                              ...sc,
                              seamOut: { ...sc.seamOut, vector: e.target.value as CreateVideoVector },
                            }))
                          }
                        >
                          <option value="left">← Trái</option>
                          <option value="up">↑ Lên</option>
                          <option value="z-push">⊕ Z-Push</option>
                          <option value="z-pull">⊖ Z-Pull</option>
                        </select>
                      </label>
                    </div>

                    <div className="auto-edit-ov-inline" style={{ alignItems: "flex-end" }}>
                      <label className="motion-video-mini-field" style={{ flex: 1 }}>
                        <span>Hiệu ứng âm thanh mở cảnh (SFX)</span>
                        <select
                          value={selectedScene.revealSfxId || ""}
                          onChange={(e) =>
                            patchScene(selectedScene.id, (sc) => ({ ...sc, revealSfxId: e.target.value || undefined }))
                          }
                        >
                          <option value="">Tự động theo loại cảnh</option>
                          <option value="none">Tắt SFX cảnh này</option>
                          {sfxGroups.map(([cat, list]) => (
                            <optgroup key={cat} label={SFX_CATEGORY_LABELS[cat]}>
                              {list.map((sfx) => (
                                <option key={sfx.id} value={sfx.id}>
                                  {sfx.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="auto-edit-mini-btn"
                        style={{ height: 30, padding: "0 10px" }}
                        onClick={() => previewSfxSound(selectedScene.revealSfxId || "reveal-sparkle")}
                        aria-label="Nghe thử hiệu ứng âm thanh"
                        title="Nghe thử hiệu ứng âm thanh"
                      >
                        <Icon name="volume" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {draftPlan.directorNotes.length > 0 && (
                <div className="auto-edit-notes-box">
                  <h4><Icon name="file" size={16} /> Ghi chú Đạo diễn Motion</h4>
                  <ul>
                    {draftPlan.directorNotes.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 5. INTAKE & BRIEF BUILDER */}
      <section className="card auto-edit-intake-card">
        <div className="auto-edit-studio-header">
          <div>
            <h1>Motion Video Studio</h1>
            <p className="auto-edit-lead">
              Tạo video Motion Graphics từ 15 giây đến <strong>30 phút</strong> bằng Remotion, Three.js, GSAP &amp; HyperFrames. Hỗ trợ cả chế độ <strong>Tự động 1 chạm</strong> lẫn <strong>Duyệt Dàn ý Chương 2 bước</strong>.
            </p>
          </div>
        </div>

        <form className="auto-edit-form" onSubmit={handleCreateSubmit}>
          <div className="motion-video-mode-tabs" role="group" aria-label="Nguồn nội dung">
            <button
              type="button"
              className={`motion-video-mode-tab ${inputMode === "article_url" ? "is-active" : ""}`}
              aria-pressed={inputMode === "article_url"}
              onClick={() => setInputMode("article_url")}
            >
              <Icon name="link" size={16} />
              <div>
                <strong>Link Bài viết / Website</strong>
                <small>Tự bóc nội dung dài &amp; chụp giao diện đưa vào 3D</small>
              </div>
            </button>
            <button
              type="button"
              className={`motion-video-mode-tab ${inputMode === "keyword" ? "is-active" : ""}`}
              aria-pressed={inputMode === "keyword"}
              onClick={() => setInputMode("keyword")}
            >
              <Icon name="spark" size={16} />
              <div>
                <strong>Từ khoá / Tiêu đề</strong>
                <small>Agent CLI tự chia Chương, lập luận điểm &amp; viết kịch bản</small>
              </div>
            </button>
            <button
              type="button"
              className={`motion-video-mode-tab ${inputMode === "raw_content" ? "is-active" : ""}`}
              aria-pressed={inputMode === "raw_content"}
              onClick={() => setInputMode("raw_content")}
            >
              <Icon name="file" size={16} />
              <div>
                <strong>Nội dung / Dàn ý có sẵn</strong>
                <small>Dán tài liệu tới 150.000 ký tự để dựng video chuyên sâu</small>
              </div>
            </button>
          </div>

          <div className="motion-video-source-panel">
            {inputMode === "article_url" && (
              <label className="field">
                <span>Đường dẫn bài viết hoặc website</span>
                <input
                  type="url"
                  placeholder="https://example.com/bai-viet-cong-nghe-hoac-trang-san-pham..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  required
                />
              </label>
            )}

            {inputMode === "keyword" && (
              <label className="field">
                <span>Chủ đề hoặc từ khoá</span>
                <input
                  type="text"
                  placeholder="Ví dụ: Toàn cảnh AI Agent & Tự động hoá Doanh nghiệp 2026..."
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  required
                />
              </label>
            )}

            {inputMode === "raw_content" && (
              <label className="field">
                <span>Nội dung hoặc dàn ý</span>
                <textarea
                  rows={5}
                  placeholder="Dán nội dung bài viết dài, báo cáo phân tích, thông số sản phẩm hoặc dàn ý chi tiết tại đây..."
                  value={rawContent}
                  onChange={(e) => setRawContent(e.target.value)}
                  required
                />
              </label>
            )}

            <div className="motion-video-sub-inputs">
              <label className="field">
                <span>Chỉ dẫn thêm (tuỳ chọn)</span>
                <input
                  type="text"
                  placeholder="Ví dụ: Giọng văn phân tích kiểu Vox, nhấn mạnh số liệu tăng trưởng 300%..."
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                />
              </label>

              <div className="field">
                <span>Ảnh minh hoạ (tuỳ chọn)</span>
                <div className="motion-video-upload-inline">
                  <label className="button ghost auto-edit-pick-btn">
                    <Icon name="image" size={15} />
                    <span>Chọn ảnh ({pendingImages.length}/12)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      hidden
                      onChange={(e) => addUploadImages(e.target.files)}
                    />
                  </label>
                  {pendingImages.map((img, idx) => (
                    <span key={`${img.file.name}-${idx}`} className="motion-video-img-chip">
                      {img.label}
                      <button
                        type="button"
                        onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Xoá ảnh"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="auto-edit-templates-section">
            <div className="auto-edit-templates-head">
              <div>
                <strong>Phong cách video</strong>
              </div>
              <div className="auto-edit-cat-pills">
                {CREATE_VIDEO_PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`auto-edit-cat-pill ${presetCategory === cat.id ? "is-active" : ""}`}
                    aria-pressed={presetCategory === cat.id}
                    onClick={() => setPresetCategory(cat.id)}
                  >
                    <Icon name={categoryIcons[cat.id] || "grid"} size={14} /> {withoutLeadingEmoji(cat.label)}
                  </button>
                ))}
              </div>
            </div>

            <div className="auto-edit-preset-grid">
              {filteredPresets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`auto-edit-preset-card ${preset === item.id ? "is-selected" : ""}`}
                  aria-pressed={preset === item.id}
                  onClick={() => applyPreset(item)}
                >
                  <div className="auto-edit-preset-top">
                    <span className="auto-edit-preset-badge">{item.badge}</span>
                    <span className="auto-edit-preset-meta">{item.recommendedAspect} · {item.dominantVector}</span>
                  </div>
                  <strong className="motion-video-preset-title"><Icon name={presetIcons[item.id] || "spark"} size={15} /> {withoutLeadingEmoji(item.label)}</strong>
                  <span>{item.summary}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="motion-video-config-grid">
            <div className="field">
              <span>Tỷ lệ khung hình</span>
              <div className="auto-edit-ratio-pills">
                {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`auto-edit-ratio-btn ${aspectRatio === ratio ? "is-active" : ""}`}
                    aria-pressed={aspectRatio === ratio}
                    onClick={() => setAspectRatio(ratio)}
                  >
                    {ratio === "9:16" ? "9:16 Dọc" : ratio === "16:9" ? "16:9 Ngang" : "1:1 Vuông"}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>Thời lượng mục tiêu (15s – 30 phút)</span>
              <div className="motion-video-duration-chips">
                {DURATION_QUICK_PRESETS.map((opt) => (
                  <button
                    key={opt.sec}
                    type="button"
                    className={`auto-edit-cat-pill ${Number(targetDurationSec) === opt.sec ? "is-active" : ""}`}
                    onClick={() => setTargetDurationSec(String(opt.sec))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={15}
                max={1800}
                step={5}
                inputMode="numeric"
                required
                value={targetDurationSec}
                onChange={(e) => setTargetDurationSec(e.target.value)}
                style={{ marginTop: 6 }}
              />
              <small>{formatDurationSummary(targetDurationSec)}</small>
            </div>

            <label className="field">
              <span>Quy trình xử lý</span>
              <select value={workflowMode} onChange={(e) => setWorkflowMode(e.target.value as CreateVideoWorkflowMode)}>
                <option value="auto_one_click">Tự động 1 chạm (Tự chia Chương &amp; dựng thẳng)</option>
                <option value="review_outline">Duyệt Dàn ý Chương trước (2 bước · Sửa chương rồi mới dựng)</option>
              </select>
            </label>

            <label className="field">
              <span>Giọng đọc</span>
              <select value={voiceMode} onChange={(e) => setVoiceMode(e.target.value as CreateVideoVoiceMode)}>
                <option value="omnivoice">Giọng đọc AI + Khớp nhịp từ</option>
                <option value="kinetic_silent">Kinetic Promo (Không lời bình · Chỉ SFX)</option>
              </select>
            </label>

            {voiceMode === "omnivoice" && (
              <label className="field">
                <span>Giọng đọc OmniVoice</span>
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  {voices.length === 0 && <option value="">Tự động theo ngôn ngữ (Có dự phòng Local Voice)</option>}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.language ? `(${v.language})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              <span>Ngôn ngữ kịch bản</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as "vi" | "en")}>
                <option value="vi">🇻🇳 Tiếng Việt</option>
                <option value="en">🇺🇸 English</option>
              </select>
            </label>

            <label className="field">
              <span>Kiểu phụ đề</span>
              <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as CreateVideoCaptionStyle)}>
                <option value="clean-pill">Hộp mờ sang trọng (Clean Pill)</option>
                <option value="karaoke-pop">Nảy từng từ (Karaoke Pop)</option>
                <option value="minimal-line">Tối giản thanh mảnh (Minimal)</option>
                <option value="none">Ẩn phụ đề đáy (Chỉ dùng chữ trên Scene)</option>
              </select>
            </label>
          </div>

          <div className="motion-video-submit-row">
            <div className="motion-video-toggles-inline">
              <label className="auto-edit-checkbox">
                <input type="checkbox" checked={motionBlur} onChange={(e) => setMotionBlur(e.target.checked)} />
                <span>Làm mờ chuyển động</span>
              </label>
              <label className="auto-edit-checkbox">
                <input type="checkbox" checked={autoSfx} onChange={(e) => setAutoSfx(e.target.checked)} />
                <span>Tự động thêm hiệu ứng âm thanh</span>
              </label>
              <label className="auto-edit-checkbox">
                <input type="checkbox" checked={safeZoneGuard} onChange={(e) => setSafeZoneGuard(e.target.checked)} />
                <span>Giữ vùng an toàn TikTok / Reels</span>
              </label>
            </div>

            <button className="button primary" type="submit" disabled={submitting}>
              <Icon name="motion" size={17} />
              <span>{submitting ? "Đang tạo dự án..." : "Tạo Motion Video"}</span>
            </button>
          </div>
        </form>

        {error && <div className="auto-edit-error-banner" style={{ marginTop: 12 }}>{error}</div>}
        {notice && <div className="auto-edit-notice-banner">{notice}</div>}
      </section>
    </div>
  );
}

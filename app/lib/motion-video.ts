import { z } from "zod";
import type { CodingAgentPreference } from "./coding-agent-preferences";
import { getSfxById, isValidSfxId } from "./sfx-library";

export const SAFE_CREATE_SCENE_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeCreateSceneId(raw: string | undefined, fallback: string): string {
  const trimmed = (raw || "").trim();
  if (SAFE_CREATE_SCENE_ID_REGEX.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 64);
  return cleaned && SAFE_CREATE_SCENE_ID_REGEX.test(cleaned) ? cleaned : fallback;
}

export function sanitizeCreateHyperframesMarkup(
  rawHtml?: string,
  rawCss?: string,
): { html?: string; css?: string } {
  let html = (rawHtml || "").trim();
  let css = (rawCss || "").trim();

  if (html) {
    html = html
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<(?:script|iframe|object|embed|form|input|button|textarea|select|link|meta|style|svg|math|video|audio|img|canvas|base)[\s\S]*?(?:<\/(?:script|iframe|object|embed|form|input|button|textarea|select|link|meta|style|svg|math|video|audio|img|canvas|base)>|\/>|>)/giu, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .replace(/\s(?:href|src|xlink:href|formaction|srcdoc)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .replace(/url\s*\([^)]*\)/giu, "none")
      .replace(/expression\s*\([^)]*\)/giu, "none")
      .replace(/javascript\s*:/giu, "")
      .slice(0, 4_500)
      .trim();
  }

  if (css) {
    css = css
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/@import[^;]+;?/giu, "")
      .replace(/@charset[^;]+;?/giu, "")
      .replace(/url\s*\([^)]*\)/giu, "none")
      .replace(/expression\s*\([^)]*\)/giu, "none")
      .replace(/javascript\s*:/giu, "")
      .replace(/<\/?style[^>]*>/giu, "")
      .slice(0, 4_500)
      .trim();
  }

  return {
    html: html || undefined,
    css: css || undefined,
  };
}

export type CreateVideoInputMode = "article_url" | "keyword" | "raw_content";
export type CreateVideoVoiceMode = "omnivoice" | "kinetic_silent";
export type CreateVideoWorkflowMode = "auto_one_click" | "review_outline";
export type CreateVideoAspectRatio = "9:16" | "16:9" | "1:1";
export type CreateVideoCaptionStyle = "karaoke-pop" | "clean-pill" | "minimal-line" | "none";
export type CreateVideoHighlightColor = "amber" | "emerald" | "rose" | "cyan" | "violet";
export type CreateVideoPalette = "midnight-cyan" | "aurora-violet" | "emerald-tech" | "crimson-energy" | "amber-editorial" | "slate-minimal";

export type CreateVideoStage =
  | "queued"
  | "ingesting_source"
  | "planning_outline"
  | "awaiting_outline_approval"
  | "scripting_scenes"
  | "synthesizing_voice"
  | "ready"
  | "rendering"
  | "rendered"
  | "failed";

export type CreateVideoSceneKind =
  | "kinetic_hook"
  | "chapter_card"
  | "browser_3d_showcase"
  | "stat_counter_3d"
  | "comparison_split"
  | "quote_editorial"
  | "hyperframes_custom"
  | "cta_climax";

export type CreateVideoSeamTechnique =
  | "cut-the-curve"
  | "zoom-through"
  | "inverse-zoom"
  | "waterfall-cut"
  | "whip-blur";

export type CreateVideoVector = "left" | "up" | "z-push" | "z-pull";

export type CreateVideoPresetCategory = "launch" | "knowledge" | "social";

export const CREATE_VIDEO_PRESET_CATEGORIES: ReadonlyArray<{ id: "all" | CreateVideoPresetCategory; label: string }> = [
  { id: "all", label: "Tất cả phong cách (8)" },
  { id: "launch", label: "🚀 Sản phẩm · SaaS · Bán hàng" },
  { id: "knowledge", label: "🎓 Giải thích · Báo chí · Số liệu" },
  { id: "social", label: "⚡ Tin nhanh · Viral · Thương hiệu" },
];

export const CREATE_VIDEO_PRESETS = [
  {
    id: "apple-launch",
    category: "launch" as CreateVideoPresetCategory,
    badge: "SaaS · Product Launch",
    label: "🚀 Ra mắt Sản phẩm & Web 3D",
    summary: "Phong cách Apple/Linear: Khung trình duyệt 3D cuộn mượt, con trỏ phóng đại click mở tính năng và chuyển cảnh Z-push xuyên chiều sâu.",
    recommendedAspect: "16:9" as const,
    defaultCaptionStyle: "clean-pill" as const,
    dominantVector: "z-push" as CreateVideoVector,
    defaultPalette: "midnight-cyan" as CreateVideoPalette,
    directorRules: "Mở đầu bằng kinetic_hook sắc bén, trình diễn trang web/sản phẩm bằng browser_3d_showcase có con trỏ click + spotlight_box, chứng minh hiệu quả bằng stat_counter_3d và kết bằng cta_climax inverse-zoom.",
  },
  {
    id: "article-recap",
    category: "knowledge" as CreateVideoPresetCategory,
    badge: "Blog · Báo chí · Substack",
    label: "📰 Chuyển Bài viết / Báo sang Video",
    summary: "Tự chụp giao diện bài viết thật lồng vào sân khấu 3D, quét bút dạ quang câu đắt giá và tóm tắt luận điểm trực quan.",
    recommendedAspect: "9:16" as const,
    defaultCaptionStyle: "clean-pill" as const,
    dominantVector: "left" as CreateVideoVector,
    defaultPalette: "amber-editorial" as CreateVideoPalette,
    directorRules: "Khai thác tối đa ảnh chụp bài viết thật (img_hero, img_scroll): mở đầu giật tít sự kiện, dùng browser_3d_showcase cuộn dọc bài báo kết hợp quote_editorial quét dạ quang trích dẫn quan trọng và thẻ tổng kết HyperFrames.",
  },
  {
    id: "vox-explainer",
    category: "knowledge" as CreateVideoPresetCategory,
    badge: "Vox · Kiến thức · Chuyên sâu",
    label: "🎓 Giải thích Kiến thức kiểu Vox",
    summary: "Bút dạ quang quét thuật ngữ, so sánh đối xứng 2 góc nhìn, biểu đồ khối 3D và hiệu ứng đèn chụp phân tích.",
    recommendedAspect: "16:9" as const,
    defaultCaptionStyle: "clean-pill" as const,
    dominantVector: "left" as CreateVideoVector,
    defaultPalette: "aurora-violet" as CreateVideoPalette,
    directorRules: "Mạch kể chuyện logic Đặt câu hỏi -> Nguyên nhân -> Số liệu 3D (stat_counter_3d) -> Đối chiếu (comparison_split) -> Trích dẫn đắt giá (quote_editorial) -> Kết luận mở.",
  },
  {
    id: "tech-news",
    category: "social" as CreateVideoPresetCategory,
    badge: "AI · Tech News 60s",
    label: "⚡ Điểm tin Công nghệ & AI Nhịp nhanh",
    summary: "Nhịp 60s dồn dập không giây chết, tiêu đề đổ thác GSAP Waterfall, thẻ thông số HyperFrames và chuyển cảnh lướt nhanh.",
    recommendedAspect: "9:16" as const,
    defaultCaptionStyle: "karaoke-pop" as const,
    dominantVector: "left" as CreateVideoVector,
    defaultPalette: "emerald-tech" as CreateVideoPalette,
    directorRules: "Mỗi cảnh 3.5-5s gọn gàng: mở màn bằng tin nóng bất ngờ, nêu ngay 3 thay đổi cốt lõi qua browser_3d_showcase, stat_counter_3d và hyperframes_custom kèm SFX công nghệ sắc nét.",
  },
  {
    id: "finance-data",
    category: "knowledge" as CreateVideoPresetCategory,
    badge: "Tài chính · Thị trường · Case Study",
    label: "📊 Phân tích Số liệu & Case Study",
    summary: "Tôn vinh các con số biết nói: biểu đồ cột nổi 3D, đồng hồ đếm tăng trưởng và bảng đối chiếu chiến lược.",
    recommendedAspect: "16:9" as const,
    defaultCaptionStyle: "clean-pill" as const,
    dominantVector: "up" as CreateVideoVector,
    defaultPalette: "emerald-tech" as CreateVideoPalette,
    directorRules: "Đặt con số ấn tượng nhất lên đầu (kinetic_hook hoặc stat_counter_3d), phân tách bài học thành công/thất bại bằng comparison_split và sơ đồ bước thực thi bằng hyperframes_custom.",
  },
  {
    id: "commerce-promo",
    category: "launch" as CreateVideoPresetCategory,
    badge: "TikTok · Reels · Chốt đơn",
    label: "🛍️ Quảng cáo Sản phẩm & Ưu đãi",
    summary: "Xoáy thẳng nỗi đau 3s đầu, so sánh Trước/Sau thuyết phục, sân khấu 3D tôn sản phẩm kèm nhãn giá nổi bật.",
    recommendedAspect: "9:16" as const,
    defaultCaptionStyle: "karaoke-pop" as const,
    dominantVector: "z-push" as CreateVideoVector,
    defaultPalette: "crimson-energy" as CreateVideoPalette,
    directorRules: "Cấu trúc AIDA chuyển đổi cao: Nỗi đau (kinetic_hook) -> Giải pháp Trước/Sau (comparison_split) -> Cận cảnh tính năng & giá ưu đãi (browser_3d_showcase / hyperframes_custom) -> Kêu gọi mua ngay (cta_climax).",
  },
  {
    id: "viral-hook",
    category: "social" as CreateVideoPresetCategory,
    badge: "Shorts · Reels · Bắt Trend",
    label: "🔥 Short Viral Năng lượng Cao",
    summary: "Chữ Kinetic kích thước lớn giữa màn hình, đổi nhịp thị giác liên tục mỗi 3–4 giây, phụ đề Karaoke bật màu rực rỡ.",
    recommendedAspect: "9:16" as const,
    defaultCaptionStyle: "karaoke-pop" as const,
    dominantVector: "z-push" as CreateVideoVector,
    defaultPalette: "crimson-energy" as CreateVideoPalette,
    directorRules: "Câu ngắn 8-14 chữ, nhịp dứt khoát, chuyển cảnh zoom-through và whip-blur năng lượng cao, dùng nhiều con số cụ thể và kết bằng câu hỏi kích thích bình luận.",
  },
  {
    id: "minimal-brand",
    category: "social" as CreateVideoPresetCategory,
    badge: "Luxury · Manifesto · Aesthetic",
    label: "✨ Tối giản Thương hiệu Cao cấp",
    summary: "Khoảng thở tinh tế, font chữ thanh thoát, chuyển cảnh êm mượt và ánh sáng kính mờ sang trọng.",
    recommendedAspect: "16:9" as const,
    defaultCaptionStyle: "minimal-line" as const,
    dominantVector: "left" as CreateVideoVector,
    defaultPalette: "slate-minimal" as CreateVideoPalette,
    directorRules: "Tiết chế chữ trên màn hình (tối đa 5 từ mỗi tiêu đề), ưu tiên quote_editorial, browser_3d_showcase góc nghiêng nhẹ và SFX whoosh-soft / reveal-chime thanh lịch.",
  },
] as const;

export type CreateVideoPresetId = (typeof CREATE_VIDEO_PRESETS)[number]["id"];

export const createVideoPresetSchema = z.enum([
  "apple-launch",
  "article-recap",
  "vox-explainer",
  "tech-news",
  "finance-data",
  "commerce-promo",
  "viral-hook",
  "minimal-brand",
]);

export const createVideoInputModeSchema = z.enum(["article_url", "keyword", "raw_content"]);
export const createVideoVoiceModeSchema = z.enum(["omnivoice", "kinetic_silent"]);
export const createVideoWorkflowModeSchema = z.enum(["auto_one_click", "review_outline"]);
export const createVideoAspectSchema = z.enum(["9:16", "16:9", "1:1"]);
export const createVideoCaptionStyleSchema = z.enum(["karaoke-pop", "clean-pill", "minimal-line", "none"]);

export const createVideoOptionsSchema = z.object({
  inputMode: createVideoInputModeSchema.default("keyword"),
  sourceUrl: z.string().trim().max(1_200).default(""),
  topicQuery: z.string().trim().max(400).default(""),
  rawContent: z.string().trim().max(150_000).default(""),
  direction: z.string().trim().max(2_000).default(""),
  targetDurationSec: z.number().int().min(15).max(1_800).default(45),
  workflowMode: createVideoWorkflowModeSchema.default("auto_one_click"),
  preset: createVideoPresetSchema.default("apple-launch"),
  aspectRatio: createVideoAspectSchema.default("9:16"),
  language: z.enum(["vi", "en"]).default("vi"),
  voiceMode: createVideoVoiceModeSchema.default("omnivoice"),
  voiceId: z.string().trim().max(160).default(""),
  captionStyle: createVideoCaptionStyleSchema.default("clean-pill"),
  motionBlur: z.boolean().default(true),
  safeZoneGuard: z.boolean().default(true),
  autoSfx: z.boolean().default(true),
  sfxVolumeDb: z.number().min(-24).max(-4).default(-9.0),
});

export type CreateVideoOptions = z.infer<typeof createVideoOptionsSchema>;

export type CreateVideoChapter = {
  id: string;
  index: number;
  title: string;
  summary: string;
  targetDurationSec: number;
  keyPoints: string[];
  palette: CreateVideoPalette;
  dominantVector: CreateVideoVector;
};

export type CreateVideoOutline = {
  title: string;
  summary: string;
  dominantVector: CreateVideoVector;
  chapters: CreateVideoChapter[];
};

export type CreateVideoAssetImage = {
  id: string;
  filename: string;
  width: number;
  height: number;
  label: string;
  source: "captured_hero" | "captured_scroll" | "captured_article" | "uploaded";
};

export type CreateVideoWord = {
  id: string;
  sceneId: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type CreateVideoStatItem = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  color?: CreateVideoHighlightColor;
};

export type CreateVideoComparisonItem = {
  leftLabel: string;
  rightLabel: string;
};

export type CreateVideoAnnotation = {
  kind: "none" | "spotlight_box" | "highlighter" | "oversized_cursor" | "freeze_hud";
  label?: string;
  targetX: number; // 0.1 .. 0.9
  targetY: number; // 0.1 .. 0.9
  targetW: number; // 0.08 .. 0.85
  targetH: number; // 0.05 .. 0.65
};

export type CreateVideoSeam = {
  technique: CreateVideoSeamTechnique;
  vector: CreateVideoVector;
  durationMs: number;
  sfxId?: string;
};

export type CreateVideoScene = {
  id: string;
  kind: CreateVideoSceneKind;
  chapterIndex?: number;
  chapterTitle?: string;
  badge?: string;
  headline: string;
  subheadline?: string;
  narrationText: string;
  durationMs: number;
  palette: CreateVideoPalette;
  accentColor: CreateVideoHighlightColor;
  emoji?: string;
  imageId?: string;
  /** Scroll range [0..1] when displaying tall article/website capture inside 3D browser */
  scrollStart?: number;
  scrollEnd?: number;
  /** Parametric data for stat_counter_3d */
  stats?: CreateVideoStatItem[];
  /** Parametric data for comparison_split */
  leftTitle?: string;
  rightTitle?: string;
  comparisons?: CreateVideoComparisonItem[];
  /** Quote author/source for quote_editorial */
  quoteSource?: string;
  /** CTA button label & URL/hint for cta_climax */
  ctaButtonText?: string;
  ctaHint?: string;
  /** Optional GSAP/SVG editorial annotation inside scene */
  annotation?: CreateVideoAnnotation;
  /** Optional safe HyperFrames HTML/CSS custom infographic card */
  hyperframesHtml?: string;
  hyperframesCss?: string;
  /** Dramatic pause before climax reveal (ms) */
  stillnessBeforeClimaxMs?: number;
  /** Entry SFX when key reveal lands inside scene */
  revealSfxId?: string;
  /** Outgoing velocity-matched seam to next scene */
  seamOut: CreateVideoSeam;
  note?: string;
};

export type CreateVideoKeywordHighlight = {
  word: string;
  color: CreateVideoHighlightColor;
  emoji?: string;
};

export type CreateVideoPlan = {
  schema: "create-video-plan.v1";
  title: string;
  summary: string;
  dominantVector: CreateVideoVector;
  captionStyle: CreateVideoCaptionStyle;
  scenes: CreateVideoScene[];
  keywordHighlights: CreateVideoKeywordHighlight[];
  directorNotes: string[];
};

export type CreateVideoSourceBrief = {
  sourceTitle: string;
  sourceDomain?: string;
  sourceUrl?: string;
  extractedSummary: string;
  keyBullets: string[];
  themeColor?: string;
};

export type CreateVideoAudioInfo = {
  hasVoiceover: boolean;
  voiceBackend?: "omnivoice" | "macos-say" | "kinetic-silent";
  whisperBackend?: string;
  durationMs: number;
  words: CreateVideoWord[];
};

export type CreateVideoRenderInfo = {
  status: "idle" | "rendering" | "ready" | "failed";
  outputPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  sizeBytes?: number;
  updatedAt: string;
  error?: string;
};

export type CreateVideoJob = {
  id: string;
  options: CreateVideoOptions;
  status: CreateVideoStage;
  progress: string;
  error?: string;
  agentPreference?: CodingAgentPreference;
  sourceBrief?: CreateVideoSourceBrief;
  harvestedText?: string;
  outline?: CreateVideoOutline;
  outlineApproved?: boolean;
  completedChapterScenes?: Record<string, CreateVideoScene[]>;
  images: CreateVideoAssetImage[];
  plan?: CreateVideoPlan;
  audio?: CreateVideoAudioInfo;
  render?: CreateVideoRenderInfo;
  createdAt: string;
  updatedAt: string;
};

export type CreateVideoJobSummary = {
  id: string;
  title: string;
  inputMode: CreateVideoInputMode;
  workflowMode?: CreateVideoWorkflowMode;
  preset: CreateVideoPresetId;
  aspectRatio: CreateVideoAspectRatio;
  voiceMode: CreateVideoVoiceMode;
  status: CreateVideoStage;
  progress: string;
  error?: string;
  sceneCount: number;
  chapterCount?: number;
  durationMs?: number;
  renderReady: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ComputedCreateVideoScene = CreateVideoScene & {
  index: number;
  timelineStartMs: number;
  timelineEndMs: number;
  seamIn?: CreateVideoSeam;
  showCaptionRail: boolean;
};

export type ComputedCreateVideoSfxEvent = {
  id: string;
  sfxId: string;
  filename: string;
  timelineMs: number;
  volumeDb: number;
};

export type ComputedCreateVideoTimeline = {
  fps: number;
  width: number;
  height: number;
  totalDurationMs: number;
  totalFrames: number;
  scenes: ComputedCreateVideoScene[];
  words: CreateVideoWord[];
  sfxEvents: ComputedCreateVideoSfxEvent[];
};

export function dimensionsForCreateAspect(aspectRatio: CreateVideoAspectRatio): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

export function defaultSeamSfx(technique: CreateVideoSeamTechnique): string {
  if (technique === "zoom-through") return "transition-rise";
  if (technique === "inverse-zoom") return "transition-bass";
  if (technique === "whip-blur") return "swoosh";
  if (technique === "waterfall-cut") return "whoosh-soft";
  return "transition-sweep";
}

export function defaultSceneRevealSfx(kind: CreateVideoSceneKind, annotationKind?: CreateVideoAnnotation["kind"]): string {
  if (annotationKind === "oversized_cursor" || annotationKind === "spotlight_box") return "mouse-clicks";
  if (annotationKind === "freeze_hud") return "camera-shutter";
  if (annotationKind === "highlighter") return "swoosh";
  if (kind === "chapter_card") return isValidSfxId("transition-chord") ? "transition-chord" : "transition-sweep";
  if (kind === "stat_counter_3d") return "reveal-ping";
  if (kind === "comparison_split") return "reveal-pop";
  if (kind === "quote_editorial") return "camera-shutter";
  if (kind === "cta_climax") return "tada";
  if (kind === "browser_3d_showcase") return "reveal-sparkle";
  if (kind === "hyperframes_custom") return "reveal-chime";
  return "reveal-woosh";
}

export function estimateReadingDurationMs(text: string, language: "vi" | "en", minMs = 3_200): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  if (!words) return minMs;
  const wps = language === "vi" ? 2.85 : 2.6;
  const spokenMs = Math.round((words / wps) * 1000) + 520;
  return Math.min(18_000, Math.max(minMs, spokenMs));
}

export function computeCreateVideoTimeline(
  plan: CreateVideoPlan,
  aspectRatio: CreateVideoAspectRatio,
  audioWords: readonly CreateVideoWord[] = [],
  opts: { autoSfx?: boolean; sfxVolumeDb?: number } = {},
): ComputedCreateVideoTimeline {
  const fps = 30;
  const { width, height } = dimensionsForCreateAspect(aspectRatio);
  const autoSfx = opts.autoSfx ?? true;
  const baseSfxDb = opts.sfxVolumeDb ?? -9.0;

  let cursorMs = 0;
  const scenes: ComputedCreateVideoScene[] = [];
  const sfxEvents: ComputedCreateVideoSfxEvent[] = [];

  for (let i = 0; i < plan.scenes.length; i++) {
    const raw = plan.scenes[i];
    const durMs = Math.max(1_800, Math.round(raw.durationMs || 4_000));
    const startMs = cursorMs;
    const endMs = startMs + durMs;
    const prevSeam = i > 0 ? plan.scenes[i - 1].seamOut : undefined;
    const showCaptionRail =
      plan.captionStyle !== "none" &&
      raw.kind !== "kinetic_hook" &&
      raw.kind !== "chapter_card" &&
      raw.kind !== "cta_climax";

    scenes.push({
      ...raw,
      index: i,
      timelineStartMs: startMs,
      timelineEndMs: endMs,
      seamIn: prevSeam,
      showCaptionRail,
    });

    if (autoSfx) {
      const revealId = raw.revealSfxId && isValidSfxId(raw.revealSfxId)
        ? raw.revealSfxId
        : defaultSceneRevealSfx(raw.kind, raw.annotation?.kind);
      const revealMeta = getSfxById(revealId);
      if (revealMeta) {
        const revealOffset = raw.annotation?.kind === "oversized_cursor"
          ? Math.min(durMs - 300, 920)
          : i === 0
            ? 80
            : Math.min(durMs - 300, 380);
        sfxEvents.push({
          id: `sfx_reveal_${raw.id}_${i}`,
          sfxId: revealMeta.id,
          filename: revealMeta.filename,
          timelineMs: Math.max(0, startMs + revealOffset),
          volumeDb: baseSfxDb,
        });
      }

      if (i < plan.scenes.length - 1) {
        const seamSfxId = raw.seamOut.sfxId && isValidSfxId(raw.seamOut.sfxId)
          ? raw.seamOut.sfxId
          : defaultSeamSfx(raw.seamOut.technique);
        const seamMeta = getSfxById(seamSfxId);
        if (seamMeta) {
          const seamStart = Math.max(startMs + 400, endMs - Math.round((raw.seamOut.durationMs || 320) * 0.65));
          sfxEvents.push({
            id: `sfx_seam_${raw.id}_${i}`,
            sfxId: seamMeta.id,
            filename: seamMeta.filename,
            timelineMs: seamStart,
            volumeDb: Math.max(-24, baseSfxDb - 1.5),
          });
        }
      }
    }

    cursorMs = endMs;
  }

  const totalDurationMs = Math.max(3_000, cursorMs);
  const totalFrames = Math.max(90, Math.ceil((totalDurationMs / 1000) * fps));

  const words: CreateVideoWord[] = [...audioWords];
  if (!words.length) {
    let wCounter = 1;
    for (const sc of scenes) {
      const tokens = (sc.narrationText || "").trim().split(/\s+/u).filter(Boolean);
      if (!tokens.length) continue;
      const padStart = sc.timelineStartMs + 140;
      const padEnd = Math.max(padStart + 300, sc.timelineEndMs - (sc.stillnessBeforeClimaxMs || 180));
      const step = (padEnd - padStart) / tokens.length;
      tokens.forEach((tok, idx) => {
        const wStart = Math.round(padStart + idx * step);
        const wEnd = Math.round(Math.max(wStart + 45, padStart + (idx + 1) * step - 12));
        words.push({
          id: `cw_${wCounter++}`,
          sceneId: sc.id,
          text: tok,
          startMs: wStart,
          endMs: wEnd,
        });
      });
    }
  }

  sfxEvents.sort((a, b) => a.timelineMs - b.timelineMs);
  const filteredSfx: ComputedCreateVideoSfxEvent[] = [];
  for (const ev of sfxEvents) {
    const prev = filteredSfx[filteredSfx.length - 1];
    if (prev && ev.timelineMs - prev.timelineMs < 260) continue;
    filteredSfx.push(ev);
  }

  return {
    fps,
    width,
    height,
    totalDurationMs,
    totalFrames,
    scenes,
    words,
    sfxEvents: filteredSfx,
  };
}

const VALID_SCENE_KINDS = new Set<CreateVideoSceneKind>([
  "kinetic_hook",
  "chapter_card",
  "browser_3d_showcase",
  "stat_counter_3d",
  "comparison_split",
  "quote_editorial",
  "hyperframes_custom",
  "cta_climax",
]);

const VALID_PALETTES = new Set<CreateVideoPalette>([
  "midnight-cyan",
  "aurora-violet",
  "emerald-tech",
  "crimson-energy",
  "amber-editorial",
  "slate-minimal",
]);

const VALID_COLORS = new Set<CreateVideoHighlightColor>(["amber", "emerald", "rose", "cyan", "violet"]);
const VALID_TECHNIQUES = new Set<CreateVideoSeamTechnique>([
  "cut-the-curve",
  "zoom-through",
  "inverse-zoom",
  "waterfall-cut",
  "whip-blur",
]);
const VALID_VECTORS = new Set<CreateVideoVector>(["left", "up", "z-push", "z-pull"]);

export function normalizeAgentCreateVideoPlan(
  raw: unknown,
  options: CreateVideoOptions,
  availableImages: readonly CreateVideoAssetImage[],
): CreateVideoPlan {
  const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === options.preset) || CREATE_VIDEO_PRESETS[0];
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const validImageIds = new Set(availableImages.map((img) => img.id));
  const scrollImage = availableImages.find((img) => img.source === "captured_scroll") || availableImages[0];
  const heroImage = availableImages.find((img) => img.source === "captured_hero") || availableImages[0];

  const dominantVector: CreateVideoVector =
    typeof obj.dominantVector === "string" && VALID_VECTORS.has(obj.dominantVector as CreateVideoVector)
      ? (obj.dominantVector as CreateVideoVector)
      : presetMeta.dominantVector;

  const captionStyle: CreateVideoCaptionStyle =
    typeof obj.captionStyle === "string" && ["karaoke-pop", "clean-pill", "minimal-line", "none"].includes(obj.captionStyle)
      ? (obj.captionStyle as CreateVideoCaptionStyle)
      : options.captionStyle;

  const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  const scenes: CreateVideoScene[] = rawScenes
    .slice(0, 320)
    .map((item, idx): CreateVideoScene | null => {
      if (!item || typeof item !== "object") return null;
      const sc = item as Record<string, unknown>;
      const id = sanitizeCreateSceneId(typeof sc.id === "string" ? sc.id : undefined, `scene_${String(idx + 1).padStart(2, "0")}`);
      const kind: CreateVideoSceneKind =
        typeof sc.kind === "string" && VALID_SCENE_KINDS.has(sc.kind as CreateVideoSceneKind)
          ? (sc.kind as CreateVideoSceneKind)
          : idx === 0
            ? "kinetic_hook"
            : idx === rawScenes.length - 1
              ? "cta_climax"
              : "hyperframes_custom";

      const chapterIndex =
        typeof sc.chapterIndex === "number" && Number.isInteger(sc.chapterIndex) && sc.chapterIndex >= 0
          ? sc.chapterIndex
          : undefined;
      const chapterTitle =
        typeof sc.chapterTitle === "string" && sc.chapterTitle.trim()
          ? sc.chapterTitle.trim().slice(0, 120)
          : undefined;

      const narrationText = String(sc.narrationText || sc.spokenText || sc.transcript || "").trim().slice(0, 650);
      const headline = String(sc.headline || sc.visualHeadline || sc.title || narrationText.split(/\s+/u).slice(0, 6).join(" ") || `Điểm nhấn #${idx + 1}`)
        .trim()
        .slice(0, 110);
      const subheadline = typeof sc.subheadline === "string" && sc.subheadline.trim()
        ? sc.subheadline.trim().slice(0, 180)
        : undefined;

      const palette: CreateVideoPalette =
        typeof sc.palette === "string" && VALID_PALETTES.has(sc.palette as CreateVideoPalette)
          ? (sc.palette as CreateVideoPalette)
          : presetMeta.defaultPalette;

      const accentColor: CreateVideoHighlightColor =
        typeof sc.accentColor === "string" && VALID_COLORS.has(sc.accentColor as CreateVideoHighlightColor)
          ? (sc.accentColor as CreateVideoHighlightColor)
          : idx % 3 === 0
            ? "cyan"
            : idx % 3 === 1
              ? "emerald"
              : "amber";

      let imageId = typeof sc.imageId === "string" && validImageIds.has(sc.imageId) ? sc.imageId : undefined;
      if (!imageId && kind === "browser_3d_showcase" && (scrollImage || heroImage)) {
        imageId = (scrollImage || heroImage)?.id;
      }

      const rawStats = Array.isArray(sc.stats) ? sc.stats : [];
      const stats: CreateVideoStatItem[] = rawStats
        .slice(0, 4)
        .map((st): CreateVideoStatItem | null => {
          if (!st || typeof st !== "object") return null;
          const s = st as Record<string, unknown>;
          const val = Number(s.value);
          if (!Number.isFinite(val)) return null;
          return {
            label: String(s.label || "").trim().slice(0, 48) || "Chỉ số",
            value: val,
            prefix: typeof s.prefix === "string" ? s.prefix.trim().slice(0, 10) : undefined,
            suffix: typeof s.suffix === "string" ? s.suffix.trim().slice(0, 14) : undefined,
            color: typeof s.color === "string" && VALID_COLORS.has(s.color as CreateVideoHighlightColor)
              ? (s.color as CreateVideoHighlightColor)
              : accentColor,
          };
        })
        .filter((v): v is CreateVideoStatItem => Boolean(v));

      const rawComps = Array.isArray(sc.comparisons) ? sc.comparisons : [];
      const comparisons: CreateVideoComparisonItem[] = rawComps
        .slice(0, 4)
        .map((cp): CreateVideoComparisonItem | null => {
          if (!cp || typeof cp !== "object") return null;
          const c = cp as Record<string, unknown>;
          const leftLabel = String(c.leftLabel || c.before || "").trim().slice(0, 80);
          const rightLabel = String(c.rightLabel || c.after || "").trim().slice(0, 80);
          if (!leftLabel && !rightLabel) return null;
          return { leftLabel: leftLabel || "Trước đây", rightLabel: rightLabel || "Giải pháp mới" };
        })
        .filter((v): v is CreateVideoComparisonItem => Boolean(v));

      let annotation: CreateVideoAnnotation | undefined;
      if (sc.annotation && typeof sc.annotation === "object") {
        const an = sc.annotation as Record<string, unknown>;
        const akind = String(an.kind || "none");
        if (["spotlight_box", "highlighter", "oversized_cursor", "freeze_hud"].includes(akind)) {
          annotation = {
            kind: akind as CreateVideoAnnotation["kind"],
            label: typeof an.label === "string" ? an.label.trim().slice(0, 60) : undefined,
            targetX: Math.min(0.88, Math.max(0.12, Number(an.targetX) || 0.52)),
            targetY: Math.min(0.84, Math.max(0.16, Number(an.targetY) || 0.48)),
            targetW: Math.min(0.8, Math.max(0.12, Number(an.targetW) || 0.36)),
            targetH: Math.min(0.55, Math.max(0.06, Number(an.targetH) || 0.12)),
          };
        }
      }

      const rawSeam = (sc.seamOut && typeof sc.seamOut === "object" ? sc.seamOut : {}) as Record<string, unknown>;
      const technique: CreateVideoSeamTechnique =
        typeof rawSeam.technique === "string" && VALID_TECHNIQUES.has(rawSeam.technique as CreateVideoSeamTechnique)
          ? (rawSeam.technique as CreateVideoSeamTechnique)
          : idx === rawScenes.length - 2
            ? "inverse-zoom"
            : dominantVector === "z-push"
              ? "zoom-through"
              : "cut-the-curve";

      const vector: CreateVideoVector =
        typeof rawSeam.vector === "string" && VALID_VECTORS.has(rawSeam.vector as CreateVideoVector)
          ? (rawSeam.vector as CreateVideoVector)
          : technique === "inverse-zoom"
            ? "z-pull"
            : technique === "zoom-through"
              ? "z-push"
              : dominantVector;

      const sanitizedHf = sanitizeCreateHyperframesMarkup(
        typeof sc.hyperframesHtml === "string" ? sc.hyperframesHtml : undefined,
        typeof sc.hyperframesCss === "string" ? sc.hyperframesCss : undefined,
      );

      const estimatedMs = narrationText
        ? estimateReadingDurationMs(narrationText, options.language)
        : 3_600;
      const rawDur = Number(sc.durationMs);
      const durationMs = options.voiceMode === "kinetic_silent" && Number.isFinite(rawDur) && rawDur >= 2_000
        ? Math.min(12_000, Math.round(rawDur))
        : Math.max(2_600, Math.min(16_000, Number.isFinite(rawDur) && rawDur >= 2_400 ? Math.round(rawDur) : estimatedMs));

      return {
        id,
        kind,
        chapterIndex,
        chapterTitle,
        badge: typeof sc.badge === "string" && sc.badge.trim() ? sc.badge.trim().slice(0, 48) : undefined,
        headline,
        subheadline,
        narrationText,
        durationMs,
        palette,
        accentColor,
        emoji: typeof sc.emoji === "string" && sc.emoji.trim() ? sc.emoji.trim().slice(0, 12) : undefined,
        imageId,
        scrollStart: typeof sc.scrollStart === "number" ? Math.min(1, Math.max(0, sc.scrollStart)) : 0,
        scrollEnd: typeof sc.scrollEnd === "number" ? Math.min(1, Math.max(0, sc.scrollEnd)) : 0.55,
        stats: stats.length ? stats : undefined,
        leftTitle: typeof sc.leftTitle === "string" ? sc.leftTitle.trim().slice(0, 48) : undefined,
        rightTitle: typeof sc.rightTitle === "string" ? sc.rightTitle.trim().slice(0, 48) : undefined,
        comparisons: comparisons.length ? comparisons : undefined,
        quoteSource: typeof sc.quoteSource === "string" ? sc.quoteSource.trim().slice(0, 80) : undefined,
        ctaButtonText: typeof sc.ctaButtonText === "string" ? sc.ctaButtonText.trim().slice(0, 48) : undefined,
        ctaHint: typeof sc.ctaHint === "string" ? sc.ctaHint.trim().slice(0, 90) : undefined,
        annotation,
        hyperframesHtml: sanitizedHf.html,
        hyperframesCss: sanitizedHf.css,
        stillnessBeforeClimaxMs: idx === rawScenes.length - 1 ? 420 : undefined,
        revealSfxId: typeof sc.revealSfxId === "string" && isValidSfxId(sc.revealSfxId) ? sc.revealSfxId : undefined,
        seamOut: {
          technique,
          vector,
          durationMs: Math.min(520, Math.max(220, Number(rawSeam.durationMs) || 320)),
          sfxId: typeof rawSeam.sfxId === "string" && isValidSfxId(rawSeam.sfxId) ? rawSeam.sfxId : undefined,
        },
        note: typeof sc.note === "string" ? sc.note.trim().slice(0, 240) : undefined,
      };
    })
    .filter((v): v is CreateVideoScene => Boolean(v));

  if (!scenes.length) {
    throw new Error("Agent chưa tạo được danh sách phân cảnh hợp lệ.");
  }

  const rawHighlights = Array.isArray(obj.keywordHighlights) ? obj.keywordHighlights : [];
  const keywordHighlights: CreateVideoKeywordHighlight[] = rawHighlights
    .slice(0, 120)
    .map((kw): CreateVideoKeywordHighlight | null => {
      if (!kw || typeof kw !== "object") return null;
      const k = kw as Record<string, unknown>;
      const word = String(k.word || "").trim().slice(0, 40);
      if (!word) return null;
      return {
        word,
        color: typeof k.color === "string" && VALID_COLORS.has(k.color as CreateVideoHighlightColor)
          ? (k.color as CreateVideoHighlightColor)
          : "amber",
        emoji: typeof k.emoji === "string" && k.emoji.trim() ? k.emoji.trim().slice(0, 12) : undefined,
      };
    })
    .filter((v): v is CreateVideoKeywordHighlight => Boolean(v));

  const rawNotes = Array.isArray(obj.directorNotes) ? obj.directorNotes : [];
  const directorNotes = rawNotes
    .map((n) => String(n || "").trim().slice(0, 280))
    .filter(Boolean)
    .slice(0, 12);

  return {
    schema: "create-video-plan.v1",
    title: String(obj.title || options.topicQuery || "Video Motion AI").trim().slice(0, 160),
    summary: String(obj.summary || "Bản dựng Motion tự động kết hợp Remotion, Three.js, GSAP và HyperFrames.").trim().slice(0, 900),
    dominantVector,
    captionStyle,
    scenes,
    keywordHighlights,
    directorNotes,
  };
}

export function normalizeAgentCreateVideoOutline(
  raw: unknown,
  options: CreateVideoOptions,
  fallbackTitle = "",
): CreateVideoOutline {
  const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === options.preset) || CREATE_VIDEO_PRESETS[0];
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dominantVector: CreateVideoVector =
    typeof obj.dominantVector === "string" && VALID_VECTORS.has(obj.dominantVector as CreateVideoVector)
      ? (obj.dominantVector as CreateVideoVector)
      : presetMeta.dominantVector;

  const rawChapters = Array.isArray(obj.chapters) ? obj.chapters : [];
  const chapters: CreateVideoChapter[] = rawChapters
    .slice(0, 24)
    .map((item, idx): CreateVideoChapter | null => {
      if (!item || typeof item !== "object") return null;
      const ch = item as Record<string, unknown>;
      const title = String(ch.title || `Chương ${idx + 1}`).trim().slice(0, 120);
      const summary = String(ch.summary || title).trim().slice(0, 400);
      const rawSec = Number(ch.targetDurationSec);
      const targetDurationSec = Number.isFinite(rawSec)
        ? Math.min(240, Math.max(25, Math.round(rawSec)))
        : 75;
      const rawPoints = Array.isArray(ch.keyPoints) ? ch.keyPoints : [];
      const keyPoints = rawPoints
        .map((p) => String(p || "").trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 6);
      const palette: CreateVideoPalette =
        typeof ch.palette === "string" && VALID_PALETTES.has(ch.palette as CreateVideoPalette)
          ? (ch.palette as CreateVideoPalette)
          : presetMeta.defaultPalette;
      const chVec: CreateVideoVector =
        typeof ch.dominantVector === "string" && VALID_VECTORS.has(ch.dominantVector as CreateVideoVector)
          ? (ch.dominantVector as CreateVideoVector)
          : dominantVector;

      return {
        id: sanitizeCreateSceneId(typeof ch.id === "string" ? ch.id : undefined, `chap_${String(idx + 1).padStart(2, "0")}`),
        index: idx,
        title,
        summary,
        targetDurationSec,
        keyPoints: keyPoints.length ? keyPoints : [summary],
        palette,
        dominantVector: chVec,
      };
    })
    .filter((v): v is CreateVideoChapter => Boolean(v));

  if (chapters.length < 2) {
    throw new Error("Dàn ý cần tối thiểu 2 chương hợp lệ.");
  }

  const sumSec = chapters.reduce((acc, c) => acc + c.targetDurationSec, 0);
  if (sumSec > 0 && Math.abs(sumSec - options.targetDurationSec) > options.targetDurationSec * 0.25) {
    const ratio = options.targetDurationSec / sumSec;
    for (const c of chapters) {
      c.targetDurationSec = Math.min(240, Math.max(25, Math.round(c.targetDurationSec * ratio)));
    }
  }

  return {
    title: String(obj.title || fallbackTitle || options.topicQuery || "Video Motion Chuyên Sâu").trim().slice(0, 160),
    summary: String(obj.summary || "Dàn ý phân chương cho video Motion dài.").trim().slice(0, 900),
    dominantVector,
    chapters,
  };
}

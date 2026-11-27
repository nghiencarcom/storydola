import { z } from "zod";
import type { CodingAgentPreference } from "./coding-agent-preferences";
import { getSfxById, isValidSfxId, pickDefaultOverlaySfx } from "./sfx-library";

export const SAFE_OVERLAY_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeOverlayId(raw: string | undefined, fallback: string): string {
  const trimmed = (raw || "").trim();
  if (SAFE_OVERLAY_ID_REGEX.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 64);
  return cleaned && SAFE_OVERLAY_ID_REGEX.test(cleaned) ? cleaned : fallback;
}

export function resolveHttpByteRange(
  rangeHeader: string,
  total: number,
): { ok: true; start: number; end: number } | { ok: false } {
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || (!match[1] && !match[2]) || total <= 0) {
    return { ok: false };
  }

  let start: number;
  let end: number;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { ok: false };
    }
    start = Math.max(0, total - suffixLength);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
    return { ok: false };
  }

  return { ok: true, start, end };
}

export type AutoEditPresetCategory = "commerce" | "knowledge" | "lifestyle";

export const AUTO_EDIT_PRESET_CATEGORIES: ReadonlyArray<{ id: "all" | AutoEditPresetCategory; label: string }> = [
  { id: "all", label: "Tất cả chủ đề (12)" },
  { id: "commerce", label: "🛍️ Bán hàng · Review · BĐS · F&B" },
  { id: "knowledge", label: "🎓 Hướng dẫn · Podcast · Giáo dục · Tin tức" },
  { id: "lifestyle", label: "🎬 Công nghệ · Vlog · Gaming · Thẩm mỹ" },
];

export const AUTO_EDIT_PRESETS = [
  {
    id: "ugc-review",
    category: "commerce" as AutoEditPresetCategory,
    badge: "Affiliate · TikTok Shop",
    label: "🛍️ UGC Review & Bán hàng",
    summary: "Giữ nhịp nói chân thật, lọc sạch câu vấp/lặp ý, Hook 3s đối trọng và thẻ sản phẩm 3D đúng lúc nhắc giá.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "auto" as const,
    recommendedSilenceMs: 420,
    defaultCaptionStyle: "karaoke-pop" as const,
    preferredCardLayout: "stage-3d" as const,
    directorRules: "Tập trung chuyển đổi đơn hàng: mở đầu bằng nỗi đau hoặc kết quả thật trong 3s đầu, hiện product_card (layout stage-3d) ngay giây nhắc tên/công dụng/giá bán kèm SFX reveal-sparkle hoặc ding.",
  },
  {
    id: "fast-tiktok",
    category: "commerce" as AutoEditPresetCategory,
    badge: "Short · Reels · Viral",
    label: "⚡ Nhịp Nhanh Bắt Trend",
    summary: "Cắt cực sát khoảng nghỉ (300ms), Punch-in Zoom liên tục mỗi câu, phụ đề Karaoke & Emoji nảy mạnh.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "fill-crop" as const,
    recommendedSilenceMs: 300,
    defaultCaptionStyle: "karaoke-pop" as const,
    preferredCardLayout: "center-pop" as const,
    directorRules: "Nhịp Hormozi tốc độ cao: cắt triệt để mọi khoảng thở >300ms, đổi zoom 1.0x <-> 1.16x liên tục giữa các câu, nhiều keywordHighlights rực rỡ và callout_pill/emoji_burst mỗi 6-8 giây.",
  },
  {
    id: "tutorial-saas",
    category: "knowledge" as AutoEditPresetCategory,
    badge: "Screencast · Phần mềm · AI",
    label: "💻 Hướng dẫn Web / Phần mềm / AI",
    summary: "Cắt đoạn chờ tải trang/gõ nhầm, tự động khoanh vùng nút bấm (Spotlight Box), tô dạ quang thông số & thẻ bước 3D.",
    recommendedAspect: "16:9" as const,
    recommendedVerticalFit: "aurora-3d" as const,
    recommendedSilenceMs: 450,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "stage-3d" as const,
    directorRules: "Video hướng dẫn thao tác màn hình: cắt gọn đoạn chờ cài đặt hoặc thao tác nhầm; ưu tiên dùng spotlight_box khoanh sáng vùng bấm nút (kèm sfx mouse-clicks), highlighter tô sáng tên model/thông số và thẻ tổng kết từng bước.",
  },
  {
    id: "podcast-talk",
    category: "knowledge" as AutoEditPresetCategory,
    badge: "Podcast · Talkshow · Chuyên gia",
    label: "🎙️ Podcast & Trích đoạn Đối thoại",
    summary: "Giữ nhịp nghỉ có chiều sâu (600ms), lọc từ thừa 'ờ, à', tô sáng câu trích dẫn đắt giá và phụ đề hộp mờ sang trọng.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "aurora-3d" as const,
    recommendedSilenceMs: 600,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "split-top" as const,
    directorRules: "Giữ nhịp điềm tĩnh và chiều sâu cảm xúc của cuộc trò chuyện: chỉ cắt đoạn ngập ngừng/nói lắp hoặc khoảng lặng quá dài; dùng zoom 1.12x nhẹ nhàng vào câu kết luận đắt giá kèm highlighter/callout_pill tinh tế.",
  },
  {
    id: "edu-course",
    category: "knowledge" as AutoEditPresetCategory,
    badge: "Giáo dục · Tài chính · Vox",
    label: "🎓 Bài giảng & Giải thích Kiến thức",
    summary: "Phong cách Vox Documentary: bút dạ quang nhấn khái niệm cốt lõi, thẻ tóm tắt công thức và đóng băng phân tích số liệu.",
    recommendedAspect: "16:9" as const,
    recommendedVerticalFit: "aurora-3d" as const,
    recommendedSilenceMs: 460,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "stage-3d" as const,
    directorRules: "Phong cách giải thích trực quan kiểu Vox: chia mạch bài giảng theo luận điểm rõ ràng, dùng highlighter quét sáng thuật ngữ/con số quan trọng, product_card đóng vai trò thẻ ghi nhớ kiến thức và freeze_frame khi chốt kết luận.",
  },
  {
    id: "news-recap",
    category: "knowledge" as AutoEditPresetCategory,
    badge: "Điểm tin · Recap Phim 60s",
    label: "📰 Bản tin Nhanh & Tóm tắt Sự kiện",
    summary: "Nhịp bản tin dứt khoát (320ms), tiêu đề Hook báo chí nổi bật, chuyển mục mượt với hiệu ứng lướt âm thanh.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "blur-fit" as const,
    recommendedSilenceMs: 320,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "split-top" as const,
    directorRules: "Nhịp bản tin 60s cô đọng, không một giây chết: Hook mở đầu giật tít sự kiện chính, chèn thẻ tóm tắt từng diễn biến ở nửa trên (split-top) kèm SFX transition-sweep khi chuyển ý.",
  },
  {
    id: "real-estate",
    category: "commerce" as AutoEditPresetCategory,
    badge: "BĐS · Nội thất · Showroom",
    label: "🏢 Bất động sản & Không gian Luxury",
    summary: "Tôn vinh khung hình rộng, thẻ thông số diện tích/vị trí/giá dạng kính nổi 3D và âm thanh chuông thanh lịch.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "blur-fit" as const,
    recommendedSilenceMs: 540,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "stage-3d" as const,
    directorRules: "Phong cách sang trọng: giữ các cú lia máy không gian mượt mà, không cắt vụn; hiển thị thông số diện tích, hướng nhà, vị trí, pháp lý và giá bán trên thẻ stage-3d thanh lịch kèm SFX reveal-chime nhẹ nhàng.",
  },
  {
    id: "food-mukbang",
    category: "commerce" as AutoEditPresetCategory,
    badge: "Ẩm thực · Quán ngon · Nấu ăn",
    label: "🍜 Food Tour · Mukbang & Công thức",
    summary: "Nhịp tươi vui kích thích vị giác, giữ cảm thán ngon miệng, nổi bật thẻ tên món + giá bán + địa chỉ quán.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "fill-crop" as const,
    recommendedSilenceMs: 380,
    defaultCaptionStyle: "karaoke-pop" as const,
    preferredCardLayout: "floating-right" as const,
    directorRules: "Tạo cảm giác thèm ăn & năng lượng tích cực: giữ lại khoảnh khắc thử món và cảm thán tự nhiên, tô màu amber/rose cho tính từ miêu tả hương vị, gắn thẻ tên món - mức giá - chấm điểm và địa chỉ quán.",
  },
  {
    id: "tech-unbox",
    category: "lifestyle" as AutoEditPresetCategory,
    badge: "Gear · Điện thoại · So sánh",
    label: "📱 Unbox Công nghệ & Bảng Spec",
    summary: "Nhấn cận cảnh thiết kế, bảng thông số Spec Card HyperFrames có thanh tiến trình và Freeze HUD soi chi tiết.",
    recommendedAspect: "16:9" as const,
    recommendedVerticalFit: "aurora-3d" as const,
    recommendedSilenceMs: 400,
    defaultCaptionStyle: "karaoke-pop" as const,
    preferredCardLayout: "stage-3d" as const,
    directorRules: "Review công nghệ sắc nét: dùng thẻ stage-3d hiển thị chip/pin/màn hình/giá bán với thanh điểm số --hf-progress, chèn spotlight_box hoặc freeze_frame khi soi cổng kết nối/camera và phân tách rõ ưu - nhược điểm.",
  },
  {
    id: "vlog-travel",
    category: "lifestyle" as AutoEditPresetCategory,
    badge: "Daily Vlog · Hành trình",
    label: "✈️ Vlog Đời sống & Du lịch Điện ảnh",
    summary: "Giữ khoảnh khắc cảm xúc và cảnh đẹp B-roll, phụ đề Minimal thoáng mắt, nhãn địa điểm & thời gian tinh gọn.",
    recommendedAspect: "16:9" as const,
    recommendedVerticalFit: "blur-fit" as const,
    recommendedSilenceMs: 580,
    defaultCaptionStyle: "minimal-line" as const,
    preferredCardLayout: "floating-left" as const,
    directorRules: "Chất điện ảnh nhẹ nhàng: tôn trọng khoảng nghỉ cảm xúc và cảnh quay thiên nhiên/đường phố đẹp, dùng phụ đề minimal-line thoáng khung hình, nhãn địa điểm nhỏ gọn và hạn chế tối đa emoji/SFX ồn ào.",
  },
  {
    id: "gaming-highlight",
    category: "lifestyle" as AutoEditPresetCategory,
    badge: "Gaming · Stream · Reaction",
    label: "🎮 Gaming Highlight & Pha Gay Cấn",
    summary: "Lọc sạch lúc chạy map trống từ file quay hàng chục GB, giữ trọn pha cao trào kèm Zoom gắt, Freeze HUD & SFX Wow.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "aurora-3d" as const,
    recommendedSilenceMs: 280,
    defaultCaptionStyle: "karaoke-pop" as const,
    preferredCardLayout: "center-pop" as const,
    directorRules: "Cắt bỏ mạnh tay toàn bộ thời gian chết/chờ trận, dồn nhịp vào các pha giao tranh và biểu cảm hài hước: kết hợp zoom 1.2x đột ngột, freeze_frame ngay khoảnh khắc thắng/thua bất ngờ và SFX omg-wow, buzzer, tada.",
  },
  {
    id: "minimal-aesthetic",
    category: "lifestyle" as AutoEditPresetCategory,
    badge: "Spa · Thời trang · Thương hiệu",
    label: "✨ Tối giản Tinh tế (Aesthetic Brand)",
    summary: "Chuyển cảnh êm ái, thẻ kính mờ HyperFrames thanh lịch, màu chữ trang nhã và tiết chế hiệu ứng nảy.",
    recommendedAspect: "9:16" as const,
    recommendedVerticalFit: "blur-fit" as const,
    recommendedSilenceMs: 520,
    defaultCaptionStyle: "clean-pill" as const,
    preferredCardLayout: "floating-right" as const,
    directorRules: "Thẩm mỹ tối giản cao cấp cho thời trang, mỹ phẩm luxury, spa: nhịp cắt êm, câu chữ súc tích, không lạm dụng emoji sặc sỡ, chỉ dùng SFX whoosh-soft và reveal-bubble thật khẽ.",
  },
] as const;

export type AutoEditPresetId = (typeof AUTO_EDIT_PRESETS)[number]["id"];
export type AutoEditAspectRatio = "9:16" | "16:9" | "1:1";
export type AutoEditStage = "uploading" | "queued" | "analyzing_media" | "directing" | "ready" | "rendering" | "rendered" | "failed";
export type AutoEditTranscriptKind = "whisper_words" | "whisper_segments" | "manual" | "acoustic_only";
export type AutoEditCutReason = "silence" | "hesitation" | "retake" | "dead_air" | "off_topic" | "manual";
export type AutoEditOverlayKind =
  | "hook_banner"
  | "product_card"
  | "callout_pill"
  | "emoji_burst"
  | "spotlight_box"
  | "highlighter"
  | "freeze_frame";
export type AutoEditCardLayout = "floating-right" | "floating-left" | "split-top" | "center-pop" | "stage-3d";
export type AutoEditHighlightColor = "amber" | "emerald" | "rose" | "cyan";

export const autoEditPresetSchema = z.enum([
  "ugc-review",
  "fast-tiktok",
  "tutorial-saas",
  "podcast-talk",
  "edu-course",
  "news-recap",
  "real-estate",
  "food-mukbang",
  "tech-unbox",
  "vlog-travel",
  "gaming-highlight",
  "minimal-aesthetic",
]);
export const autoEditAspectSchema = z.enum(["9:16", "16:9", "1:1"]);
export const autoEditVerticalFitSchema = z.enum(["auto", "blur-fit", "aurora-3d", "fill-crop"]);
export type AutoEditVerticalFit = z.infer<typeof autoEditVerticalFitSchema>;

export const autoEditOptionsSchema = z.object({
  title: z.string().trim().max(180).default(""),
  sourceUrl: z.string().trim().max(1_000).default(""),
  preset: autoEditPresetSchema.default("ugc-review"),
  aspectRatio: autoEditAspectSchema.default("9:16"),
  verticalFit: autoEditVerticalFitSchema.default("auto"),
  motionBlur: z.boolean().default(true),
  language: z.enum(["vi", "en"]).default("vi"),
  productName: z.string().trim().max(160).default(""),
  productHighlights: z.string().trim().max(2_000).default(""),
  direction: z.string().trim().max(2_000).default(""),
  manualTranscript: z.string().trim().max(24_000).default(""),
  silenceThresholdMs: z.number().int().min(250).max(2_000).default(450),
  voiceTargetPeakDb: z.number().min(-3).max(-0.3).default(-1.2),
  autoSfx: z.boolean().default(true),
  sfxVolumeDb: z.number().min(-24).max(-4).default(-8.5),
  safeZoneGuard: z.boolean().default(true),
});

export type AutoEditOptions = z.infer<typeof autoEditOptionsSchema>;

export type AutoEditSourceVideo = {
  id: string;
  filename: string;
  extension: string;
  size: number;
  order: number;
  durationMs?: number;
  width?: number;
  height?: number;
  aspectRatio?: AutoEditAspectRatio;
  hasAudio?: boolean;
};

export type AutoEditProductImage = {
  id: string;
  filename: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  label: string;
};

export type AutoEditWord = {
  id: string;
  clipId: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  filler?: boolean;
};

export type AutoEditPause = {
  clipId: string;
  startMs: number;
  endMs: number;
  reason: "silence" | "dead_air";
};

export type AutoEditSegment = {
  id: string;
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  keep: boolean;
  cutReason?: AutoEditCutReason;
  zoom: number;
  zoomFocusY: number;
  transcriptText: string;
  note?: string;
};

export type AutoEditKeywordHighlight = {
  word: string;
  color: AutoEditHighlightColor;
  emoji?: string;
};

export type AutoEditOverlay = {
  id: string;
  kind: AutoEditOverlayKind;
  anchorSegmentId?: string;
  offsetMs: number;
  durationMs: number;
  imageId?: string;
  layout: AutoEditCardLayout;
  badge?: string;
  title: string;
  subtitle?: string;
  priceTag?: string;
  emoji?: string;
  accentColor?: AutoEditHighlightColor;
  /** Normalized [0..1] target region for spotlight_box & highlighter annotations. */
  targetX?: number;
  targetY?: number;
  targetW?: number;
  targetH?: number;
  /** ID from assets/sfx/catalog.json, or "none" to mute SFX on this overlay. */
  sfxId?: string;
  sfxVolumeDb?: number;
  /** Optional safe HyperFrames HTML fragment using CSS var(--hf-progress) for deterministic frame seeking. */
  hyperframesHtml?: string;
  hyperframesCss?: string;
};

export type AutoEditSfxCue = {
  id: string;
  sfxId: string;
  anchorSegmentId?: string;
  offsetMs: number;
  volumeDb?: number;
  note?: string;
};

export type AutoEditEdl = {
  schema: "auto-edit-edl.v1";
  title: string;
  summary: string;
  hookHeadline: string;
  hookSubtext?: string;
  hookEmoji?: string;
  captionStyle: "karaoke-pop" | "clean-pill" | "minimal-line";
  segments: AutoEditSegment[];
  overlays: AutoEditOverlay[];
  sfxCues?: AutoEditSfxCue[];
  keywordHighlights: AutoEditKeywordHighlight[];
  directorNotes: string[];
};

export type AutoEditAnalysis = {
  transcriptKind: AutoEditTranscriptKind;
  whisperBackend?: string;
  rawDurationMs: number;
  inputMaxVolumeDb?: number;
  inputMeanVolumeDb?: number;
  words: AutoEditWord[];
  pauses: AutoEditPause[];
};

export type AutoEditRenderInfo = {
  status: "idle" | "rendering" | "ready" | "failed";
  outputPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  sizeBytes?: number;
  maxVolumeDb?: number;
  speechPeakDb?: number;
  meanVolumeDb?: number;
  updatedAt: string;
  error?: string;
};

export type AutoEditJob = {
  id: string;
  options: AutoEditOptions;
  status: AutoEditStage;
  progress?: string;
  error?: string;
  agentLabel?: string;
  agentPreference?: CodingAgentPreference;
  videos: AutoEditSourceVideo[];
  images: AutoEditProductImage[];
  analysis?: AutoEditAnalysis;
  edl?: AutoEditEdl;
  render?: AutoEditRenderInfo;
  createdAt: string;
  updatedAt: string;
};

export type AutoEditJobSummary = {
  id: string;
  title: string;
  preset: AutoEditPresetId;
  aspectRatio: AutoEditAspectRatio;
  status: AutoEditStage;
  progress?: string;
  error?: string;
  videoCount: number;
  imageCount: number;
  rawDurationMs?: number;
  editedDurationMs?: number;
  cutCount?: number;
  renderReady: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ComputedTimelineSegment = AutoEditSegment & {
  timelineStartMs: number;
  timelineEndMs: number;
  durationMs: number;
};

export type ComputedTimelineWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
  highlightColor?: AutoEditHighlightColor;
  emoji?: string;
};

export type ComputedTimelineOverlay = AutoEditOverlay & {
  timelineStartMs: number;
  timelineEndMs: number;
};

export type ComputedTimelineSfxEvent = {
  id: string;
  sfxId: string;
  filename: string;
  label: string;
  timelineStartMs: number;
  durationMs: number;
  peakDb: number;
  volumeDb: number;
};

export type ComputedAutoEditTimeline = {
  fps: number;
  width: number;
  height: number;
  totalDurationMs: number;
  rawDurationMs: number;
  savedDurationMs: number;
  cutCount: number;
  keptSegments: ComputedTimelineSegment[];
  words: ComputedTimelineWord[];
  overlays: ComputedTimelineOverlay[];
  sfxEvents: ComputedTimelineSfxEvent[];
};

export const agentAutoEditGenerationSchema = z.object({
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1_200),
  hookHeadline: z.string().trim().min(1).max(90),
  hookSubtext: z.string().trim().max(120).optional().default(""),
  hookEmoji: z.string().trim().max(16).optional().default("🔥"),
  captionStyle: z.enum(["karaoke-pop", "clean-pill", "minimal-line"]).default("karaoke-pop"),
  segments: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    clipId: z.string().trim().min(1).max(64),
    sourceStartMs: z.number().min(0),
    sourceEndMs: z.number().min(1),
    keep: z.boolean(),
    cutReason: z.enum(["silence", "hesitation", "retake", "dead_air", "off_topic", "manual"]).optional(),
    zoom: z.number().min(1).max(1.35).optional().default(1),
    zoomFocusY: z.number().min(0.15).max(0.85).optional().default(0.38),
    transcriptText: z.string().trim().max(4_000).default(""),
    note: z.string().trim().max(260).optional(),
  }).refine((seg) => seg.sourceEndMs > seg.sourceStartMs, {
    message: "sourceEndMs must be greater than sourceStartMs",
  })).min(1).max(1_200),
  overlays: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    kind: z.enum(["hook_banner", "product_card", "callout_pill", "emoji_burst", "spotlight_box", "highlighter", "freeze_frame"]),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000).default(0),
    durationMs: z.number().min(600).max(20_000).default(3_000),
    imageId: z.string().trim().max(64).optional(),
    layout: z.enum(["floating-right", "floating-left", "split-top", "center-pop", "stage-3d"]).optional().default("floating-right"),
    badge: z.string().trim().max(48).optional(),
    title: z.string().trim().max(110).default(""),
    subtitle: z.string().trim().max(160).optional(),
    priceTag: z.string().trim().max(48).optional(),
    emoji: z.string().trim().max(16).optional(),
    accentColor: z.enum(["amber", "emerald", "rose", "cyan"]).optional().default("amber"),
    targetX: z.number().min(0.02).max(0.98).optional(),
    targetY: z.number().min(0.02).max(0.98).optional(),
    targetW: z.number().min(0.04).max(0.92).optional(),
    targetH: z.number().min(0.03).max(0.85).optional(),
    sfxId: z.string().trim().max(80).optional(),
    sfxVolumeDb: z.number().min(-24).max(-4).optional(),
    hyperframesHtml: z.string().max(4_000).optional(),
    hyperframesCss: z.string().max(4_000).optional(),
  })).max(60).default([]),
  sfxCues: z.array(z.object({
    id: z.string().trim().min(1).max(64).optional(),
    sfxId: z.string().trim().min(1).max(80),
    anchorSegmentId: z.string().trim().max(64).optional(),
    offsetMs: z.number().min(0).max(600_000).default(0),
    volumeDb: z.number().min(-24).max(-4).optional(),
    note: z.string().trim().max(160).optional(),
  })).max(60).default([]),
  keywordHighlights: z.array(z.object({
    word: z.string().trim().min(1).max(48),
    color: z.enum(["amber", "emerald", "rose", "cyan"]).default("amber"),
    emoji: z.string().trim().max(16).optional(),
  })).max(40).default([]),
  directorNotes: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
});

export function autoEditDimensions(aspectRatio: AutoEditAspectRatio) {
  if (aspectRatio === "16:9") return { width: 1280, height: 720, fps: 30 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080, fps: 30 };
  return { width: 720, height: 1280, fps: 30 };
}

const VIETNAMESE_FILLERS = new Set([
  "ờ", "ờm", "à", "ừm", "ưm", "uh", "um", "erm", "hmm", "kiểu",
]);

export function isLikelyFillerWord(word: string) {
  const cleaned = word.toLowerCase().replace(/[.,!?;:"'()[\]{}…—–-]+/gu, "").trim();
  return VIETNAMESE_FILLERS.has(cleaned);
}

const ALLOWED_HYPERFRAMES_TAGS = new Set(["div", "span", "strong", "em", "b", "i", "small", "p", "br"]);

function sanitizeInlineStyleAttr(raw: string): string {
  return raw
    .replace(/@import[^;{}]*;?/giu, "")
    .replace(/url\s*\([^)]*\)/giu, "none")
    .replace(/expression\s*\([^)]*\)/giu, "none")
    .replace(/javascript\s*:/giu, "")
    .replace(/[<>"]/gu, "")
    .trim();
}

function stripUnbalancedCssBraces(raw: string): string {
  const chars: string[] = [];
  const openBraceIndices: number[] = [];
  let inSingle = false;
  let inDouble = false;
  let inComment = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inComment) {
      chars.push(ch);
      if (ch === "*" && next === "/") {
        chars.push("/");
        i += 1;
        inComment = false;
      }
      continue;
    }
    if (inSingle) {
      chars.push(ch);
      if (ch === "\\" && next !== undefined) {
        chars.push(next);
        i += 1;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      chars.push(ch);
      if (ch === "\\" && next !== undefined) {
        chars.push(next);
        i += 1;
      } else if (ch === "\"") {
        inDouble = false;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      chars.push("/", "*");
      i += 1;
      inComment = true;
      continue;
    }
    if (ch === "'") {
      chars.push(ch);
      inSingle = true;
      continue;
    }
    if (ch === "\"") {
      chars.push(ch);
      inDouble = true;
      continue;
    }
    if (ch === "{") {
      openBraceIndices.push(chars.length);
      chars.push(ch);
      continue;
    }
    if (ch === "}") {
      if (openBraceIndices.length > 0) {
        openBraceIndices.pop();
        chars.push(ch);
      }
      continue;
    }
    chars.push(ch);
  }

  if (inSingle) chars.push("'");
  if (inDouble) chars.push("\"");
  if (inComment) chars.push("*", "/");

  if (openBraceIndices.length > 0) {
    const toRemove = new Set(openBraceIndices);
    return chars.filter((_, idx) => !toRemove.has(idx)).join("").trim();
  }
  return chars.join("").trim();
}

/**
 * Sanitizes HyperFrames HTML/CSS authored by Code Agent so only safe, deterministic
 * markup and styles render inside the preview & headless Chromium compositor.
 */
export function sanitizeHyperframesMarkup(html?: string, css?: string): { html?: string; css?: string } {
  let cleanHtml: string | undefined;
  if (html) {
    const strippedDangerous = html
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<\s*(script|style|iframe|object|embed|svg|math|template|noscript|textarea|title|form|button|select)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/giu, "")
      .replace(/<\s*\/?\s*(?:script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math|template|noscript|title)\b[^>]*\/?\s*>/giu, "")
      .replace(/(?:^|[\s/"'<])on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/giu, (m) => (m.startsWith("<") ? "<" : " "))
      .replace(/(?:href|src|xlink:href|srcdoc|formaction|action)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/giu, "");

    const tokens: string[] = [];
    let lastIdx = 0;
    const tagRegex = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)([^<>]*)>/gu;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(strippedDangerous)) !== null) {
      if (match.index > lastIdx) {
        tokens.push(strippedDangerous.slice(lastIdx, match.index).replace(/</gu, "&lt;").replace(/>/gu, "&gt;"));
      }
      lastIdx = tagRegex.lastIndex;
      const isClosing = match[1] === "/";
      const tag = match[2].toLowerCase();
      const rawAttrs = match[3] || "";
      if (!ALLOWED_HYPERFRAMES_TAGS.has(tag)) {
        continue;
      }
      if (isClosing) {
        if (tag !== "br") tokens.push(`</${tag}>`);
        continue;
      }
      if (tag === "br") {
        tokens.push("<br />");
        continue;
      }
      const cleanedAttrSource = rawAttrs
        .replace(/(?:^|[\s/"'<])on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/giu, " ")
        .replace(/(?:href|src|xlink:href|srcdoc|formaction|action)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/giu, " ");
      const safeAttrs: string[] = [];
      const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(cleanedAttrSource)) !== null) {
        const attrName = attrMatch[1].toLowerCase();
        if (attrName.startsWith("on")) continue;
        const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
        if (attrName === "class") {
          const safeClass = attrVal.replace(/[^A-Za-z0-9_\-\s]/gu, "").trim();
          if (safeClass) safeAttrs.push(`class="${safeClass}"`);
        } else if (attrName === "style") {
          const safeStyle = sanitizeInlineStyleAttr(attrVal);
          if (safeStyle) safeAttrs.push(`style="${safeStyle}"`);
        } else if (attrName.startsWith("data-") && /^[a-z0-9-]+$/u.test(attrName)) {
          const safeData = attrVal.replace(/[<>"'&]/gu, "").trim();
          safeAttrs.push(`data-${attrName.slice(5)}="${safeData}"`);
        }
      }
      tokens.push(`<${tag}${safeAttrs.length ? ` ${safeAttrs.join(" ")}` : ""}>`);
    }
    if (lastIdx < strippedDangerous.length) {
      tokens.push(strippedDangerous.slice(lastIdx).replace(/</gu, "&lt;").replace(/>/gu, "&gt;"));
    }
    cleanHtml = tokens.join("").trim().slice(0, 4_000);
  }

  let cleanCss: string | undefined;
  if (css) {
    const preCleaned = css
      .replace(/@import[^;{}]*;?/giu, "")
      .replace(/url\s*\([^)]*\)/giu, "none")
      .replace(/expression\s*\([^)]*\)/giu, "none")
      .replace(/javascript\s*:/giu, "")
      .replace(/<\s*\/?\s*style[^>]*>/giu, "")
      .replace(/[<>]/gu, "")
      .trim()
      .slice(0, 4_000);
    cleanCss = stripUnbalancedCssBraces(preCleaned);
  }

  return {
    html: cleanHtml || undefined,
    css: cleanCss || undefined,
  };
}

function normalizeLookupToken(value: string) {
  return value.toLowerCase().replace(/[.,!?;:"'()[\]{}…—–-]+/gu, "").trim();
}

export function computeAutoEditTimeline(
  edl: AutoEditEdl,
  words: readonly AutoEditWord[],
  aspectRatio: AutoEditAspectRatio,
  rawDurationMsInput?: number,
  sfxOptions?: { autoSfx?: boolean; sfxVolumeDb?: number },
): ComputedAutoEditTimeline {
  const { width, height, fps } = autoEditDimensions(aspectRatio);
  let cursorMs = 0;
  const keptSegments: ComputedTimelineSegment[] = [];
  let cutCount = 0;
  let computedRawMs = 0;

  for (const seg of edl.segments) {
    const segDur = Math.max(0, Math.round(seg.sourceEndMs - seg.sourceStartMs));
    computedRawMs += segDur;
    if (!seg.keep || segDur < 120) {
      if (!seg.keep) cutCount += 1;
      continue;
    }
    const timelineStartMs = cursorMs;
    const timelineEndMs = cursorMs + segDur;
    keptSegments.push({
      ...seg,
      timelineStartMs,
      timelineEndMs,
      durationMs: segDur,
    });
    cursorMs = timelineEndMs;
  }

  const totalDurationMs = Math.max(cursorMs, 0);
  const rawDurationMs = Math.max(rawDurationMsInput || 0, computedRawMs, totalDurationMs);
  const savedDurationMs = Math.max(0, rawDurationMs - totalDurationMs);

  const highlightMap = new Map<string, AutoEditKeywordHighlight>();
  for (const item of edl.keywordHighlights) {
    for (const token of item.word.split(/\s+/u)) {
      const normalized = normalizeLookupToken(token);
      if (normalized.length >= 2 && !highlightMap.has(normalized)) {
        highlightMap.set(normalized, item);
      }
    }
  }

  const mappedWords: ComputedTimelineWord[] = [];
  for (const seg of keptSegments) {
    const clipWords = words.filter(
      (word) => word.clipId === seg.clipId && word.endMs > seg.sourceStartMs + 20 && word.startMs < seg.sourceEndMs - 20,
    );
    for (const word of clipWords) {
      const clampedStart = Math.max(seg.sourceStartMs, word.startMs);
      const clampedEnd = Math.min(seg.sourceEndMs, Math.max(clampedStart + 40, word.endMs));
      const outStart = seg.timelineStartMs + (clampedStart - seg.sourceStartMs);
      const outEnd = Math.min(seg.timelineEndMs, seg.timelineStartMs + (clampedEnd - seg.sourceStartMs));
      const normalized = normalizeLookupToken(word.text);
      const highlight = highlightMap.get(normalized);
      mappedWords.push({
        id: `${seg.id}_${word.id}`,
        text: word.text.startsWith(" ") ? word.text : ` ${word.text}`,
        startMs: Math.round(outStart),
        endMs: Math.round(Math.max(outStart + 40, outEnd)),
        confidence: word.confidence ?? 0.95,
        highlightColor: highlight?.color,
        emoji: highlight?.emoji,
      });
    }
  }

  const segmentById = new Map(keptSegments.map((seg) => [seg.id, seg]));
  const resolveAnchorStartMs = (
    anchorSegmentId: string | undefined,
    offsetMs: number,
  ): { startMs: number; usedFallback: boolean } => {
    const cleanOffset = Math.max(0, Math.round(offsetMs));
    if (!anchorSegmentId) {
      return { startMs: cleanOffset, usedFallback: false };
    }
    const direct = segmentById.get(anchorSegmentId);
    if (direct) {
      return { startMs: direct.timelineStartMs + cleanOffset, usedFallback: false };
    }
    const idxInEdl = edl.segments.findIndex((s) => s.id === anchorSegmentId);
    if (idxInEdl >= 0) {
      for (let f = idxInEdl + 1; f < edl.segments.length; f++) {
        const nextKept = segmentById.get(edl.segments[f].id);
        if (nextKept) {
          return { startMs: nextKept.timelineStartMs + cleanOffset, usedFallback: true };
        }
      }
      for (let b = idxInEdl - 1; b >= 0; b--) {
        const prevKept = segmentById.get(edl.segments[b].id);
        if (prevKept) {
          return { startMs: prevKept.timelineStartMs + cleanOffset, usedFallback: true };
        }
      }
    }
    return { startMs: cleanOffset, usedFallback: true };
  };

  const computedOverlays: ComputedTimelineOverlay[] = [];
  for (const overlay of edl.overlays) {
    if (totalDurationMs <= 0) continue;
    const reqDur = Math.max(600, Math.round(overlay.durationMs));
    const resolved = resolveAnchorStartMs(overlay.anchorSegmentId, overlay.offsetMs);
    let startMs = resolved.startMs;
    if (resolved.usedFallback && startMs >= totalDurationMs - 350 && totalDurationMs >= 350) {
      startMs = Math.max(0, totalDurationMs - Math.min(totalDurationMs, reqDur));
    }
    if (startMs >= totalDurationMs) continue;
    const endMs = Math.min(totalDurationMs, startMs + reqDur);
    if (endMs - startMs < 350) continue;
    computedOverlays.push({
      ...overlay,
      timelineStartMs: startMs,
      timelineEndMs: endMs,
    });
  }

  computedOverlays.sort((a, b) => a.timelineStartMs - b.timelineStartMs);

  const sfxEnabled = sfxOptions?.autoSfx !== false;
  const baseSfxDb = Math.min(-4, Math.max(-24, sfxOptions?.sfxVolumeDb ?? -8.5));
  const rawSfxCandidates: ComputedTimelineSfxEvent[] = [];

  if (sfxEnabled && totalDurationMs > 0) {
    // 1. Overlay-bound SFX (Hook Banner, HyperFrames Product Cards, Callouts, Emojis)
    for (const ov of computedOverlays) {
      if (ov.sfxId === "none") continue;
      const entry = getSfxById(ov.sfxId);
      if (!entry) continue;
      rawSfxCandidates.push({
        id: `sfx_ov_${ov.id}`,
        sfxId: entry.id,
        filename: entry.filename,
        label: entry.label,
        timelineStartMs: ov.timelineStartMs,
        durationMs: Math.min(entry.durationMs, 2_400),
        peakDb: entry.peakDb,
        volumeDb: ov.sfxVolumeDb ?? baseSfxDb,
      });
    }

    // 2. Explicit standalone Agent SFX cues
    for (let i = 0; i < (edl.sfxCues || []).length; i++) {
      const cue = edl.sfxCues![i];
      const entry = getSfxById(cue.sfxId);
      if (!entry) continue;
      const resolved = resolveAnchorStartMs(cue.anchorSegmentId, cue.offsetMs);
      let startMs = resolved.startMs;
      if (resolved.usedFallback && startMs >= totalDurationMs && totalDurationMs > 200) {
        startMs = Math.max(0, totalDurationMs - 200);
      }
      if (startMs >= totalDurationMs) continue;
      rawSfxCandidates.push({
        id: cue.id || `sfx_cue_${i + 1}`,
        sfxId: entry.id,
        filename: entry.filename,
        label: entry.label,
        timelineStartMs: startMs,
        durationMs: Math.min(entry.durationMs, 2_400),
        peakDb: entry.peakDb,
        volumeDb: cue.volumeDb ?? baseSfxDb,
      });
    }

    // 3. Subtle transition whoosh on spaced jump-cut punch-in zooms (>= 5s apart)
    const subtleWhoosh = getSfxById("whoosh-soft");
    if (subtleWhoosh) {
      let lastTransitionMs = -5_000;
      for (let i = 1; i < keptSegments.length; i++) {
        const prev = keptSegments[i - 1];
        const cur = keptSegments[i];
        if (Math.abs(cur.zoom - prev.zoom) >= 0.08 && cur.timelineStartMs - lastTransitionMs >= 5_500) {
          rawSfxCandidates.push({
            id: `sfx_zoom_${cur.id}`,
            sfxId: subtleWhoosh.id,
            filename: subtleWhoosh.filename,
            label: subtleWhoosh.label,
            timelineStartMs: Math.max(0, cur.timelineStartMs - 60),
            durationMs: Math.min(subtleWhoosh.durationMs, 900),
            peakDb: subtleWhoosh.peakDb,
            volumeDb: Math.max(-30, baseSfxDb - 3),
          });
          lastTransitionMs = cur.timelineStartMs;
        }
      }
    }
  }

  rawSfxCandidates.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  const sfxEvents: ComputedTimelineSfxEvent[] = [];
  for (const candidate of rawSfxCandidates) {
    // Prevent overlapping SFX clutter within 240ms
    const prev = sfxEvents[sfxEvents.length - 1];
    if (prev && Math.abs(candidate.timelineStartMs - prev.timelineStartMs) < 240) {
      continue;
    }
    sfxEvents.push(candidate);
  }

  return {
    fps,
    width,
    height,
    totalDurationMs,
    rawDurationMs,
    savedDurationMs,
    cutCount,
    keptSegments,
    words: mappedWords,
    overlays: computedOverlays,
    sfxEvents,
  };
}

/**
 * Splits raw clip durations + pauses + words into candidate baseline segments
 * before Code Agent refines semantic retakes, zoom levels, and overlays.
 */
export function buildCandidateSegments(
  videos: readonly AutoEditSourceVideo[],
  words: readonly AutoEditWord[],
  pauses: readonly AutoEditPause[],
  silenceThresholdMs = 450,
): AutoEditSegment[] {
  const segments: AutoEditSegment[] = [];
  let counter = 1;

  for (const video of videos) {
    const durationMs = Math.max(500, Math.round(video.durationMs || 5_000));
    const clipPauses = pauses
      .filter((pause) => pause.clipId === video.id && pause.endMs - pause.startMs >= silenceThresholdMs)
      .sort((a, b) => a.startMs - b.startMs);

    const clipWords = words.filter((word) => word.clipId === video.id);
    const textInRange = (startMs: number, endMs: number) =>
      clipWords
        .filter((w) => w.endMs > startMs + 30 && w.startMs < endMs - 30)
        .map((w) => w.text.trim())
        .filter(Boolean)
        .join(" ")
        .trim();

    let cursor = 0;
    let keptInClip = 0;

    for (const pause of clipPauses) {
      const pStart = Math.max(cursor, Math.min(durationMs, Math.round(pause.startMs)));
      const pEnd = Math.max(pStart, Math.min(durationMs, Math.round(pause.endMs)));
      if (pStart - cursor >= 260) {
        const text = textInRange(cursor, pStart);
        const onlyFiller = Boolean(text) && text.split(/\s+/u).length <= 2 && text.split(/\s+/u).every(isLikelyFillerWord);
        const keep = !onlyFiller;
        if (keep) keptInClip += 1;
        segments.push({
          id: `seg_${String(counter++).padStart(3, "0")}`,
          clipId: video.id,
          sourceStartMs: cursor,
          sourceEndMs: pStart,
          keep,
          cutReason: onlyFiller ? "hesitation" : undefined,
          zoom: keep && keptInClip % 2 === 0 ? 1.12 : 1,
          zoomFocusY: 0.38,
          transcriptText: text.slice(0, 4_000),
        });
      }
      if (pEnd - pStart >= silenceThresholdMs) {
        segments.push({
          id: `seg_${String(counter++).padStart(3, "0")}`,
          clipId: video.id,
          sourceStartMs: pStart,
          sourceEndMs: pEnd,
          keep: false,
          cutReason: pause.reason,
          zoom: 1,
          zoomFocusY: 0.38,
          transcriptText: "",
          note: pause.reason === "dead_air" ? "Khoảng chết đầu/cuối clip" : `Khoảng lặng ${((pEnd - pStart) / 1000).toFixed(1)}s`,
        });
      }
      cursor = pEnd;
    }

    if (durationMs - cursor >= 260) {
      const text = textInRange(cursor, durationMs);
      keptInClip += 1;
      segments.push({
        id: `seg_${String(counter++).padStart(3, "0")}`,
        clipId: video.id,
        sourceStartMs: cursor,
        sourceEndMs: durationMs,
        keep: true,
        zoom: keptInClip % 2 === 0 ? 1.12 : 1,
        zoomFocusY: 0.38,
        transcriptText: text.slice(0, 4_000),
      });
    }
  }

  // Never allow 0 kept segments: keep the longest segment as safety fallback.
  if (segments.length > 0 && segments.every((seg) => !seg.keep)) {
    let longest = segments[0];
    for (const seg of segments) {
      if (seg.sourceEndMs - seg.sourceStartMs > longest.sourceEndMs - longest.sourceStartMs) longest = seg;
    }
    longest.keep = true;
    longest.cutReason = undefined;
  }

  return segments;
}

export function normalizeAgentAutoEditEdl(
  raw: unknown,
  videos: readonly AutoEditSourceVideo[],
  images: readonly AutoEditProductImage[],
  words: readonly AutoEditWord[],
  fallbackSegments: readonly AutoEditSegment[],
  options: AutoEditOptions,
): AutoEditEdl {
  const parsed = agentAutoEditGenerationSchema.parse(raw);
  const validClips = new Map(videos.map((v) => [v.id, v]));
  const validImages = new Set(images.map((img) => img.id));

  const normalizedSegments: AutoEditSegment[] = [];
  let idx = 1;
  for (const seg of parsed.segments) {
    const clip = validClips.get(seg.clipId);
    if (!clip) continue;
    const clipMaxMs = Math.max(500, Math.round(clip.durationMs || 600_000));
    const startMs = Math.max(0, Math.min(clipMaxMs - 120, Math.round(seg.sourceStartMs)));
    const endMs = Math.max(startMs + 120, Math.min(clipMaxMs, Math.round(seg.sourceEndMs)));
    const derivedText = seg.transcriptText.trim() || words
      .filter((w) => w.clipId === clip.id && w.endMs > startMs + 30 && w.startMs < endMs - 30)
      .map((w) => w.text.trim())
      .join(" ")
      .trim();

    normalizedSegments.push({
      id: seg.id || `seg_${String(idx).padStart(3, "0")}`,
      clipId: clip.id,
      sourceStartMs: startMs,
      sourceEndMs: endMs,
      keep: seg.keep,
      cutReason: seg.keep ? undefined : (seg.cutReason || "hesitation"),
      zoom: seg.keep ? Math.min(1.28, Math.max(1, Number((seg.zoom || 1).toFixed(3)))) : 1,
      zoomFocusY: Math.min(0.8, Math.max(0.2, Number((seg.zoomFocusY ?? 0.38).toFixed(2)))),
      transcriptText: derivedText.slice(0, 4_000),
      note: seg.note,
    });
    idx += 1;
  }

  const finalSegments = normalizedSegments.some((s) => s.keep)
    ? normalizedSegments
    : fallbackSegments.map((s) => ({ ...s }));

  const allSegmentIds = new Set(finalSegments.map((s) => s.id));
  const overlays: AutoEditOverlay[] = parsed.overlays.map((ov, index) => {
    const sanitized = sanitizeHyperframesMarkup(ov.hyperframesHtml, ov.hyperframesCss);
    const resolvedImageId = ov.imageId && validImages.has(ov.imageId)
      ? ov.imageId
      : ov.kind === "product_card" && images[0]
        ? images[0].id
        : undefined;
    const resolvedAnchor = ov.anchorSegmentId && allSegmentIds.has(ov.anchorSegmentId) ? ov.anchorSegmentId : undefined;
    const chosenSfx = ov.sfxId && isValidSfxId(ov.sfxId)
      ? ov.sfxId
      : options.autoSfx !== false
        ? pickDefaultOverlaySfx(ov, index, options.preset)
        : undefined;
    return {
      id: sanitizeOverlayId(ov.id, `ov_${String(index + 1).padStart(2, "0")}`),
      kind: ov.kind,
      anchorSegmentId: resolvedAnchor,
      offsetMs: Math.max(0, Math.round(ov.offsetMs)),
      durationMs: Math.max(800, Math.min(15_000, Math.round(ov.durationMs))),
      imageId: resolvedImageId,
      layout: ov.layout || "floating-right",
      badge: ov.badge,
      title: ov.title || options.productName || parsed.hookHeadline,
      subtitle: ov.subtitle,
      priceTag: ov.priceTag,
      emoji: ov.emoji,
      accentColor: ov.accentColor || "amber",
      targetX: ov.targetX,
      targetY: ov.targetY,
      targetW: ov.targetW,
      targetH: ov.targetH,
      sfxId: chosenSfx,
      sfxVolumeDb: ov.sfxVolumeDb,
      hyperframesHtml: sanitized.html,
      hyperframesCss: sanitized.css,
    };
  });

  // Guarantee a 0–3s Hook Banner if none was explicitly placed at the opening
  if (!overlays.some((ov) => ov.kind === "hook_banner")) {
    overlays.unshift({
      id: "ov_hook_00",
      kind: "hook_banner",
      offsetMs: 0,
      durationMs: 2_900,
      layout: "center-pop",
      badge: options.productName || undefined,
      title: parsed.hookHeadline,
      subtitle: parsed.hookSubtext || undefined,
      emoji: parsed.hookEmoji || "🔥",
      accentColor: options.preset === "minimal-aesthetic" ? "cyan" : "amber",
      sfxId: options.autoSfx !== false ? pickDefaultOverlaySfx({ kind: "hook_banner" }, 0, options.preset) : undefined,
    });
  }

  const sfxCues: AutoEditSfxCue[] = (parsed.sfxCues || [])
    .filter((cue) => isValidSfxId(cue.sfxId) && cue.sfxId !== "none")
    .map((cue, idx) => ({
      id: sanitizeOverlayId(cue.id, `sfx_${String(idx + 1).padStart(2, "0")}`),
      sfxId: cue.sfxId.trim().toLowerCase(),
      anchorSegmentId: cue.anchorSegmentId && allSegmentIds.has(cue.anchorSegmentId) ? cue.anchorSegmentId : undefined,
      offsetMs: Math.max(0, Math.round(cue.offsetMs)),
      volumeDb: cue.volumeDb,
      note: cue.note,
    }));

  return {
    schema: "auto-edit-edl.v1",
    title: parsed.title || options.title || options.productName || "Auto Edit Video",
    summary: parsed.summary,
    hookHeadline: parsed.hookHeadline,
    hookSubtext: parsed.hookSubtext || undefined,
    hookEmoji: parsed.hookEmoji || "🔥",
    captionStyle: parsed.captionStyle,
    segments: finalSegments,
    overlays,
    sfxCues,
    keywordHighlights: parsed.keywordHighlights,
    directorNotes: parsed.directorNotes,
  };
}

import {
  CREATE_VIDEO_PRESETS,
  type CreateVideoPlan,
  type CreateVideoPresetId,
} from "./motion-video";
import {
  AUTO_EDIT_PRESETS,
  type AutoEditEdl,
  type AutoEditOverlay,
  type AutoEditPresetId,
  type AutoEditSegment,
  type AutoEditWord,
} from "./auto-edit";

export type MotionPresetPreviewMeta = {
  highlights: readonly string[];
  tempoLabel: string;
  sceneFlowLabel: string;
  accentHex: string;
};

export const MOTION_PRESET_PREVIEW_META: Record<CreateVideoPresetId, MotionPresetPreviewMeta> = {
  "apple-launch": {
    highlights: ["Khung Web 3D", "Con trỏ Click", "Số liệu 3D"],
    tempoLabel: "Nhịp ra mắt Apple",
    sceneFlowLabel: "Hook → Web 3D → CTA",
    accentHex: "#38bdf8",
  },
  "article-recap": {
    highlights: ["Cuộn bài viết 3D", "Bút dạ quang", "Trích dẫn Vox"],
    tempoLabel: "Mạch kể báo chí",
    sceneFlowLabel: "Tít → Cuộn bài → Trích dẫn",
    accentHex: "#fbbf24",
  },
  "vox-explainer": {
    highlights: ["So sánh 2 cột", "Biểu đồ 3D", "Dạ quang thuật ngữ"],
    tempoLabel: "Phân tích logic",
    sceneFlowLabel: "Câu hỏi → 3D Chart → Đối chiếu",
    accentHex: "#a78bfa",
  },
  "tech-news": {
    highlights: ["Đổ thác Waterfall", "Thẻ HyperFrames", "Nhịp 60s nhanh"],
    tempoLabel: "Nhanh · Không giây chết",
    sceneFlowLabel: "Tin nóng → Thông số → Kết",
    accentHex: "#34d399",
  },
  "finance-data": {
    highlights: ["Đồng hồ đếm 3D", "So sánh chiến lược", "Dữ liệu trực quan"],
    tempoLabel: "Đĩnh đạc · Chính xác",
    sceneFlowLabel: "Con số → Đối chiếu → Hành động",
    accentHex: "#34d399",
  },
  "commerce-promo": {
    highlights: ["Xoáy nỗi đau 3s", "Trước / Sau", "Chốt đơn CTA"],
    tempoLabel: "Chuyển đổi cao AIDA",
    sceneFlowLabel: "Nỗi đau → Trước/Sau → Mua ngay",
    accentHex: "#fb7185",
  },
  "viral-hook": {
    highlights: ["Chữ Kinetic lớn", "Karaoke Pop", "Zoom xuyên cảnh"],
    tempoLabel: "Bắt Trend 3–4s/cảnh",
    sceneFlowLabel: "Hook gắt → Nhịp nhanh → Thảo luận",
    accentHex: "#fb7185",
  },
  "minimal-brand": {
    highlights: ["Khoảng thở rộng", "Kính mờ sang trọng", "Chuyển cảnh êm"],
    tempoLabel: "Tinh tế · Cao cấp",
    sceneFlowLabel: "Tuyên ngôn → Trình diễn → CTA",
    accentHex: "#94a3b8",
  },
};

export type AutoEditDemoThemeKind =
  | "creator-commerce"
  | "fast-viral"
  | "screencast-ui"
  | "podcast-studio"
  | "vox-board"
  | "news-desk"
  | "luxury-estate"
  | "food-review"
  | "tech-bench"
  | "cinema-travel"
  | "gaming-hud"
  | "aesthetic-minimal";

export type AutoEditDemoTheme = {
  kind: AutoEditDemoThemeKind;
  presenterTitle: string;
  presenterSubtitle: string;
  accentHex: string;
};

export type AutoEditPresetPreviewMeta = {
  highlights: readonly string[];
  demoThemeKind: AutoEditDemoThemeKind;
  sampleTopic: string;
  accentHex: string;
};

export const AUTO_EDIT_PRESET_PREVIEW_META: Record<AutoEditPresetId, AutoEditPresetPreviewMeta> = {
  "ugc-review": {
    highlights: ["Gọt nói vấp", "Thẻ 3D + Giá", "Karaoke Pop"],
    demoThemeKind: "creator-commerce",
    sampleTopic: "Review Serum Kiềm Dầu",
    accentHex: "#fbbf24",
  },
  "fast-tiktok": {
    highlights: ["Cắt sát 300ms", "Zoom liên tục", "Chữ nảy + Emoji"],
    demoThemeKind: "fast-viral",
    sampleTopic: "3 Mẹo Chỉnh Màu Điện Thoại",
    accentHex: "#fb7185",
  },
  "tutorial-saas": {
    highlights: ["Spotlight Khoanh nút", "Dạ quang thông số", "Thẻ bước 3D"],
    demoThemeKind: "screencast-ui",
    sampleTopic: "Hướng dẫn Tự động hoá AI",
    accentHex: "#38bdf8",
  },
  "podcast-talk": {
    highlights: ["Nhịp sâu 600ms", "Hộp mờ Clean Pill", "Nhấn câu trích dẫn"],
    demoThemeKind: "podcast-studio",
    sampleTopic: "Podcast Xây dựng Sản phẩm",
    accentHex: "#a78bfa",
  },
  "edu-course": {
    highlights: ["Bút dạ quang Vox", "Thẻ ghi nhớ", "Freeze HUD kết luận"],
    demoThemeKind: "vox-board",
    sampleTopic: "Giải mã Lãi suất & Dòng tiền",
    accentHex: "#38bdf8",
  },
  "news-recap": {
    highlights: ["Nhịp tin 320ms", "Thẻ tóm tắt Split-Top", "SFX chuyển mục"],
    demoThemeKind: "news-desk",
    sampleTopic: "Điểm tin Công nghệ 60s",
    accentHex: "#fb7185",
  },
  "real-estate": {
    highlights: ["Giữ khung rộng", "Thẻ thông số 3D", "Âm thanh thanh lịch"],
    demoThemeKind: "luxury-estate",
    sampleTopic: "Penthouse View Sông Sài Gòn",
    accentHex: "#fbbf24",
  },
  "food-mukbang": {
    highlights: ["Giữ cảm thán thật", "Thẻ món + Giá", "Karaoke tươi vui"],
    demoThemeKind: "food-review",
    sampleTopic: "Bún Bò Huế Quán Hẻm 45K",
    accentHex: "#fbbf24",
  },
  "tech-unbox": {
    highlights: ["Bảng Spec Card", "Freeze HUD soi máy", "Thanh điểm số"],
    demoThemeKind: "tech-bench",
    sampleTopic: "Mở hộp Laptop AI 2026",
    accentHex: "#34d399",
  },
  "vlog-travel": {
    highlights: ["Phụ đề Minimal", "Giữ nhịp cảm xúc", "Nhãn địa điểm gọn"],
    demoThemeKind: "cinema-travel",
    sampleTopic: "Một buổi sáng ở Đà Lạt",
    accentHex: "#38bdf8",
  },
  "gaming-highlight": {
    highlights: ["Cắt chờ map 280ms", "Zoom gắt 1.2x", "Freeze HUD + Wow"],
    demoThemeKind: "gaming-hud",
    sampleTopic: "Pha Lật Kèo 1v4 Phút Cuối",
    accentHex: "#fb7185",
  },
  "minimal-aesthetic": {
    highlights: ["Kính mờ tinh tế", "Cắt êm 520ms", "Tiết chế SFX"],
    demoThemeKind: "aesthetic-minimal",
    sampleTopic: "Lookbook Thu Đông Tối giản",
    accentHex: "#e2e8f0",
  },
};

export function buildMotionVideoPresetDemoPlan(presetId: CreateVideoPresetId): CreateVideoPlan {
  const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === presetId) || CREATE_VIDEO_PRESETS[0];
  const palette = presetMeta.defaultPalette;
  const vector = presetMeta.dominantVector;
  const captionStyle = presetMeta.defaultCaptionStyle;

  switch (presetId) {
    case "apple-launch":
      return {
        schema: "create-video-plan.v1",
        title: "Ra mắt Trình dựng Video AI 3D",
        summary: "Mẫu giới thiệu sản phẩm SaaS & Web 3D kiểu Apple/Linear.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [
          { word: "click", color: "cyan", emoji: "⚡" },
          { word: "3D", color: "amber", emoji: "✨" },
        ],
        directorNotes: ["Mở đầu kinetic ngắn gọn, con trỏ click trên khung 3D, kết bằng CTA inverse-zoom."],
        scenes: [
          {
            id: "demo_apple_01",
            kind: "kinetic_hook",
            badge: "RA MẮT PHIÊN BẢN MỚI",
            headline: "DỰNG VIDEO 3D CHỈ TRONG 1 CLICK",
            subheadline: "Từ ý tưởng hoặc link web thành phim Motion Graphics sắc nét",
            narrationText: "Dựng video 3D chuyên nghiệp chỉ trong một cú click.",
            durationMs: 3200,
            palette,
            accentColor: "cyan",
            emoji: "🚀",
            seamOut: { technique: "zoom-through", vector: "z-push", durationMs: 340, sfxId: "transition-rise" },
          },
          {
            id: "demo_apple_02",
            kind: "browser_3d_showcase",
            badge: "TRÌNH DIỄN TRỰC TIẾP",
            headline: "Sân khấu Web 3D & Con trỏ Phóng đại",
            subheadline: "Tự động cuộn mượt, khoanh vùng tính năng và đồng bộ âm thanh.",
            narrationText: "Khung trình duyệt 3D tự động nghiêng theo nhịp chuyển động và bấm chọn tính năng.",
            durationMs: 4200,
            palette,
            accentColor: "cyan",
            quoteSource: "storyai.studio/launch-3d",
            annotation: {
              kind: "oversized_cursor",
              label: "Bật Tự động hoá",
              targetX: 0.54,
              targetY: 0.56,
              targetW: 0.28,
              targetH: 0.14,
            },
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 360, sfxId: "transition-bass" },
          },
          {
            id: "demo_apple_03",
            kind: "cta_climax",
            badge: "SẴN SÀNG TRẢI NGHIỆM",
            headline: "NHANH GẤP 10 LẦN QUY TRÌNH CŨ",
            subheadline: "Xuất MP4 chuẩn 60fps ngay trên máy của bạn",
            narrationText: "Trải nghiệm ngay hôm nay.",
            durationMs: 3200,
            palette,
            accentColor: "amber",
            ctaButtonText: "Dùng thử mẫu này",
            ctaHint: "Tự động áp dụng tỷ lệ 16:9 & Z-Push",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 300 },
          },
        ],
      };

    case "article-recap":
      return {
        schema: "create-video-plan.v1",
        title: "Chuyển Bài viết sang Video Báo chí",
        summary: "Tóm tắt bài viết dài với khung đọc bài 3D và trích dẫn quét dạ quang.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "đắt", color: "amber", emoji: "🖍️" }],
        directorNotes: ["Chuyển cảnh trượt ngang cut-the-curve liên tục theo mạch đọc."],
        scenes: [
          {
            id: "demo_article_01",
            kind: "kinetic_hook",
            badge: "ĐIỂM BÁO CHUYÊN SÂU",
            headline: "BÀI VIẾT 3.000 CHỮ GÓI GỌN TRONG 60 GIÂY",
            subheadline: "Giữ nguyên luận điểm sắc bén và dẫn chứng gốc từ bài báo",
            narrationText: "Biến bài viết dài thành video tóm tắt trực quan trong tích tắc.",
            durationMs: 3200,
            palette,
            accentColor: "amber",
            emoji: "📰",
            seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 320, sfxId: "transition-sweep" },
          },
          {
            id: "demo_article_02",
            kind: "browser_3d_showcase",
            badge: "BÀI VIẾT GỐC",
            headline: "Cuộn Giao diện Bài báo trên Stage 3D",
            subheadline: "Trích xuất đúng ý chính, tô sáng số liệu quan trọng bằng bút dạ quang.",
            narrationText: "Hệ thống tự bóc tách từng luận điểm và đánh dấu đoạn đắt giá.",
            durationMs: 4000,
            palette,
            accentColor: "amber",
            quoteSource: "news.storyai.vn/ai-trends",
            annotation: {
              kind: "highlighter",
              label: "Ý chính",
              targetX: 0.5,
              targetY: 0.52,
              targetW: 0.5,
              targetH: 0.08,
            },
            seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 320, sfxId: "transition-sweep" },
          },
          {
            id: "demo_article_03",
            kind: "quote_editorial",
            badge: "TRÍCH DẪN ĐẮT GIÁ",
            headline: "Tạp chí Công nghệ 2026",
            subheadline: "Người biết biến bài viết thành video ngắn đang giữ 82% lượng tiếp cận tự nhiên.",
            quoteSource: "Báo cáo Xu hướng Nội dung 2026",
            narrationText: "Đó là lý do video tóm tắt bài viết đang lên ngôi.",
            durationMs: 3400,
            palette,
            accentColor: "amber",
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 320 },
          },
        ],
      };

    case "vox-explainer":
      return {
        schema: "create-video-plan.v1",
        title: "Giải thích Kiến thức kiểu Vox",
        summary: "Biểu đồ số liệu 3D kết hợp bảng đối chiếu 2 góc nhìn trực quan.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "khác", color: "violet", emoji: "🎓" }],
        directorNotes: ["Kết hợp stat_counter_3d và comparison_split giúp người xem hiểu bản chất ngay."],
        scenes: [
          {
            id: "demo_vox_01",
            kind: "kinetic_hook",
            badge: "GIẢI MÃ CHUYÊN SÂU",
            headline: "VÌ SAO MÔ HÌNH NÀY THAY ĐỔI CUỘC CHƠI?",
            subheadline: "Phân tích từ dữ liệu thực tế thay vì cảm tính",
            narrationText: "Vì sao mô hình mới lại tạo ra khác biệt lớn đến vậy?",
            durationMs: 3200,
            palette,
            accentColor: "violet",
            emoji: "🎓",
            seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 320, sfxId: "transition-sweep" },
          },
          {
            id: "demo_vox_02",
            kind: "stat_counter_3d",
            badge: "DỮ LIỆU ĐỐI CHỨNG",
            headline: "Tăng trưởng Hiệu quả Sau 12 Tháng",
            subheadline: "Số liệu khảo sát trên 1.200 đội ngũ sáng tạo nội dung",
            narrationText: "Tốc độ sản xuất tăng 340% trong khi chi phí giảm hơn một nửa.",
            durationMs: 3800,
            palette,
            accentColor: "violet",
            stats: [
              { label: "Tốc độ sản xuất", value: 340, suffix: "%", color: "violet" },
              { label: "Tiết kiệm chi phí", value: 64, suffix: "%", color: "cyan" },
            ],
            seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 320, sfxId: "transition-sweep" },
          },
          {
            id: "demo_vox_03",
            kind: "comparison_split",
            badge: "ĐỐI CHIẾU GÓC NHÌN",
            headline: "Cách Làm Cũ vs Cách Làm Mới",
            leftTitle: "Thủ công rời rạc",
            rightTitle: "Hệ thống đồng bộ",
            comparisons: [
              { leftLabel: "Mất 4 giờ cắt ghép & làm phụ đề", rightLabel: "Hoàn thiện timeline chuẩn trong 3 phút" },
              { leftLabel: "Hình ảnh tĩnh thiếu chiều sâu", rightLabel: "Sân khấu 3D + Motion Blur mượt mà" },
            ],
            narrationText: "Sự khác biệt nằm ở cách hệ thống hoá quy trình.",
            durationMs: 3800,
            palette,
            accentColor: "cyan",
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 320 },
          },
        ],
      };

    case "tech-news":
      return {
        schema: "create-video-plan.v1",
        title: "Điểm tin Công nghệ & AI 60s",
        summary: "Nhịp tin nhanh không giây chết, thẻ thông số HyperFrames động.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "AI", color: "emerald", emoji: "⚡" }],
        directorNotes: ["Cắt nhịp dồn dập, tận dụng waterfall-cut và whip-blur."],
        scenes: [
          {
            id: "demo_tech_01",
            kind: "kinetic_hook",
            badge: "AI NEWS · 60S",
            headline: "3 CẬP NHẬT AI VỪA RA MẮT SÁNG NAY",
            subheadline: "Tóm tắt nhanh những thay đổi tác động trực tiếp tới công việc của bạn",
            narrationText: "Ba cập nhật AI mới nhất vừa ra mắt sáng nay cực kỳ đáng chú ý.",
            durationMs: 3000,
            palette,
            accentColor: "emerald",
            emoji: "⚡",
            seamOut: { technique: "whip-blur", vector: "left", durationMs: 260, sfxId: "swoosh" },
          },
          {
            id: "demo_tech_02",
            kind: "hyperframes_custom",
            badge: "BENCHMARK MỚI",
            headline: "Tốc độ Xử lý Tăng Vượt Trội",
            subheadline: "Thẻ tiến trình HyperFrames động bám sát nhịp đọc",
            narrationText: "Độ trễ phản hồi giảm xuống chỉ còn một phần ba so với thế hệ trước.",
            durationMs: 3800,
            palette,
            accentColor: "emerald",
            hyperframesHtml:
              '<div class="hf-demo-stack"><div class="hf-row"><span>Thế hệ mới 2026</span><strong>98%</strong></div><div class="hf-track"><div class="hf-bar-a"></div></div><div class="hf-row"><span>Phiên bản cũ</span><strong>42%</strong></div><div class="hf-track"><div class="hf-bar-b"></div></div></div>',
            hyperframesCss:
              ".hf-demo-stack{display:grid;gap:14px}.hf-row{display:flex;justify-content:space-between;font-weight:800;font-size:20px}.hf-track{height:14px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}.hf-bar-a{height:100%;width:calc(var(--hf-progress,1)*98%);background:linear-gradient(90deg,#34d399,#38bdf8)}.hf-bar-b{height:100%;width:calc(var(--hf-progress,1)*42%);background:#64748b}",
            seamOut: { technique: "waterfall-cut", vector: "left", durationMs: 280, sfxId: "whoosh-soft" },
          },
          {
            id: "demo_tech_03",
            kind: "cta_climax",
            badge: "THEO DÕI BẢN TIN",
            headline: "BẠN ẤN TƯỢNG TÍNH NĂNG NÀO NHẤT?",
            subheadline: "Lưu video để cập nhật bản tin công nghệ mỗi ngày",
            narrationText: "Theo dõi kênh để không bỏ lỡ bản tin tiếp theo.",
            durationMs: 3000,
            palette,
            accentColor: "emerald",
            ctaButtonText: "Xem tiếp bản tin",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 280 },
          },
        ],
      };

    case "finance-data":
      return {
        schema: "create-video-plan.v1",
        title: "Phân tích Số liệu & Case Study",
        summary: "Đặt con số ấn tượng lên đầu, biểu đồ khối 3D và so sánh chiến lược.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "tiền", color: "emerald", emoji: "📊" }],
        directorNotes: ["Chuyển cảnh hướng lên (vector up) tạo cảm giác tăng trưởng."],
        scenes: [
          {
            id: "demo_fin_01",
            kind: "stat_counter_3d",
            badge: "CASE STUDY THỊ TRƯỜNG",
            headline: "Con Số Quyết Định Biên Lợi Nhuận",
            subheadline: "Tổng hợp từ báo cáo tăng trưởng Quý III",
            narrationText: "Doanh thu tăng 215 phần trăm nhờ tối ưu chi phí vận hành.",
            durationMs: 3600,
            palette,
            accentColor: "emerald",
            stats: [
              { label: "Tăng trưởng doanh thu", value: 215, prefix: "+", suffix: "%", color: "emerald" },
              { label: "Tỷ lệ giữ chân", value: 91.4, suffix: "%", color: "amber" },
            ],
            seamOut: { technique: "cut-the-curve", vector: "up", durationMs: 320, sfxId: "transition-sweep" },
          },
          {
            id: "demo_fin_02",
            kind: "comparison_split",
            badge: "CHIẾN LƯỢC PHÂN BỔ",
            headline: "Mô hình Tăng trưởng Bền vững",
            leftTitle: "Đốt ngân sách ngắn hạn",
            rightTitle: "Tối ưu dòng tiền dài hạn",
            comparisons: [
              { leftLabel: "Phụ thuộc quảng cáo trả phí 100%", rightLabel: "Kết hợp nội dung hữu cơ & phễu tự động" },
              { leftLabel: "Biên lợi nhuận mỏng dưới 12%", rightLabel: "Biên lợi nhuận ròng ổn định 34%" },
            ],
            narrationText: "Khác biệt cốt lõi đến từ cấu trúc phân bổ dòng tiền.",
            durationMs: 3800,
            palette,
            accentColor: "emerald",
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 320, sfxId: "transition-bass" },
          },
          {
            id: "demo_fin_03",
            kind: "quote_editorial",
            badge: "BÀI HỌC CỐT LÕI",
            headline: "Nguyên tắc Dòng tiền",
            subheadline: "Tăng trưởng chỉ có ý nghĩa khi dòng tiền ròng dương và đo lường được theo từng tuần.",
            quoteSource: "Phân tích Case Study Tài chính",
            narrationText: "Luôn đo lường bằng số liệu thực tế trước khi mở rộng quy mô.",
            durationMs: 3200,
            palette,
            accentColor: "amber",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 300 },
          },
        ],
      };

    case "commerce-promo":
      return {
        schema: "create-video-plan.v1",
        title: "Quảng cáo Sản phẩm & Ưu đãi",
        summary: "Cấu trúc AIDA chuyển đổi cao: Nỗi đau 3s đầu → Trước/Sau → Chốt đơn.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "ưu", color: "rose", emoji: "🔥" }],
        directorNotes: ["Nhịp AIDA bùng nổ, nút CTA nổi bật kèm nhãn giá."],
        scenes: [
          {
            id: "demo_promo_01",
            kind: "kinetic_hook",
            badge: "ĐỪNG BỎ QUA NẾU BẠN GẶP LỖI NÀY",
            headline: "MẤT NỬA NGÀY CHỈ ĐỂ LÀM MỘT VIDEO BÁN HÀNG?",
            subheadline: "Giải pháp dựng tự động chuẩn chuyển đổi ngay trên trình duyệt",
            narrationText: "Đừng mất cả buổi chỉ để cắt dựng một video bán hàng nữa.",
            durationMs: 3200,
            palette,
            accentColor: "rose",
            emoji: "🛍️",
            seamOut: { technique: "zoom-through", vector: "z-push", durationMs: 300, sfxId: "transition-rise" },
          },
          {
            id: "demo_promo_02",
            kind: "comparison_split",
            badge: "SO SÁNH TRỰC TIẾP",
            headline: "Trước & Sau Khi Áp Dụng Mẫu Mới",
            leftTitle: "Video đơn điệu cũ",
            rightTitle: "Video Motion Chốt Đơn",
            comparisons: [
              { leftLabel: "3 giây đầu trôi tuột, thiếu điểm nhấn", rightLabel: "Hook giật giữ chân & phụ đề Karaoke" },
              { leftLabel: "Khách lướt qua không nhớ giá", rightLabel: "Thẻ ưu đãi nổi bật đúng nhịp nói" },
            ],
            narrationText: "Khác biệt rõ rệt ngay từ ba giây mở màn.",
            durationMs: 3600,
            palette,
            accentColor: "amber",
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 320, sfxId: "transition-bass" },
          },
          {
            id: "demo_promo_03",
            kind: "cta_climax",
            badge: "ƯU ĐÃI ĐẶC BIỆT HÔM NAY",
            headline: "SỞ HỮU TRỌN BỘ CHỈ TỪ 199K",
            subheadline: "Miễn phí vận chuyển toàn quốc · Bảo hành đổi mới 30 ngày",
            narrationText: "Bấm vào giỏ hàng để nhận ưu đãi ngay hôm nay.",
            durationMs: 3200,
            palette,
            accentColor: "rose",
            ctaButtonText: "Chốt đơn ngay · 199K",
            ctaHint: "Số lượng ưu đãi có hạn trong phiên livestream",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 300 },
          },
        ],
      };

    case "viral-hook":
      return {
        schema: "create-video-plan.v1",
        title: "Short Viral Năng lượng Cao",
        summary: "Chữ Kinetic lớn giữa màn hình, đổi nhịp mỗi 3s và phụ đề Karaoke rực rỡ.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "bí", color: "amber", emoji: "🔥" }],
        directorNotes: ["Câu cực ngắn, chữ to dễ đọc trên điện thoại, chuyển cảnh zoom-through."],
        scenes: [
          {
            id: "demo_viral_01",
            kind: "kinetic_hook",
            badge: "SỰ THẬT ÍT AI NÓI",
            headline: "90% NGƯỜI LÀM VIDEO ĐANG BỎ LỠ ĐIỀU NÀY",
            subheadline: "3 giây đầu quyết định 80% lượt xem hoàn tất",
            narrationText: "Chín mươi phần trăm người làm video ngắn đang bỏ lỡ bí mật này.",
            durationMs: 3000,
            palette,
            accentColor: "amber",
            emoji: "🔥",
            seamOut: { technique: "zoom-through", vector: "z-push", durationMs: 260, sfxId: "transition-rise" },
          },
          {
            id: "demo_viral_02",
            kind: "stat_counter_3d",
            badge: "TÍN HIỆU THUẬT TOÁN",
            headline: "Tỷ lệ Giữ Chân Tăng Đột Biến",
            subheadline: "Khi kết hợp chuyển cảnh đúng nhịp câu nói",
            narrationText: "Thời gian xem trung bình tăng vọt lên 142 phần trăm.",
            durationMs: 3400,
            palette,
            accentColor: "rose",
            stats: [
              { label: "Giữ chân 3s đầu", value: 78, suffix: "%", color: "amber" },
              { label: "Tăng đề xuất", value: 142, prefix: "+", suffix: "%", color: "rose" },
            ],
            seamOut: { technique: "whip-blur", vector: "left", durationMs: 260, sfxId: "swoosh" },
          },
          {
            id: "demo_viral_03",
            kind: "cta_climax",
            badge: "BÌNH LUẬN NGAY",
            headline: "BẠN ĐÃ ÁP DỤNG BƯỚC NÀO?",
            subheadline: "Lưu lại video này để thử cho clip tiếp theo của bạn",
            narrationText: "Bình luận ý kiến của bạn bên dưới nhé.",
            durationMs: 3000,
            palette,
            accentColor: "amber",
            ctaButtonText: "Lưu & Thử ngay",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 280 },
          },
        ],
      };

    case "minimal-brand":
    default:
      return {
        schema: "create-video-plan.v1",
        title: "Tối giản Thương hiệu Cao cấp",
        summary: "Khoảng thở tinh tế, chuyển cảnh êm mượt và ánh sáng kính mờ thanh lịch.",
        dominantVector: vector,
        captionStyle,
        keywordHighlights: [{ word: "tinh", color: "cyan", emoji: "✨" }],
        directorNotes: ["Tiết chế chữ, giữ nhịp thư thái và thanh lịch."],
        scenes: [
          {
            id: "demo_min_01",
            kind: "kinetic_hook",
            badge: "BRAND MANIFESTO",
            headline: "TINH GIẢN ĐỂ TỎA SÁNG",
            subheadline: "Ngôn ngữ thiết kế thanh thoát cho thương hiệu hiện đại",
            narrationText: "Sự tinh giản luôn tạo ra dấu ấn bền vững nhất.",
            durationMs: 3400,
            palette,
            accentColor: "cyan",
            emoji: "✨",
            seamOut: { technique: "cut-the-curve", vector: "left", durationMs: 380, sfxId: "whoosh-soft" },
          },
          {
            id: "demo_min_02",
            kind: "quote_editorial",
            badge: "TRIẾT LÝ THIẾT KẾ",
            headline: "Signature Collection",
            subheadline: "Mỗi khung hình đều có khoảng thở vừa đủ để sản phẩm và thông điệp tự lên tiếng.",
            quoteSource: "Atelier Studio",
            narrationText: "Ánh sáng kính mờ và nhịp chuyển êm giúp nâng tầm giá trị thương hiệu.",
            durationMs: 3800,
            palette,
            accentColor: "cyan",
            seamOut: { technique: "inverse-zoom", vector: "z-pull", durationMs: 380, sfxId: "reveal-chime" },
          },
          {
            id: "demo_min_03",
            kind: "cta_climax",
            badge: "BỘ SƯU TẬP 2026",
            headline: "KHÁM PHÁ KHÔNG GIAN MỚI",
            subheadline: "Trải nghiệm trọn vẹn bản sắc thương hiệu của bạn",
            narrationText: "Khám phá bộ sưu tập mới ngay hôm nay.",
            durationMs: 3400,
            palette,
            accentColor: "cyan",
            ctaButtonText: "Xem bộ sưu tập",
            seamOut: { technique: "cut-the-curve", vector, durationMs: 340 },
          },
        ],
      };
  }
}

export function buildAutoEditPresetDemoData(presetId: AutoEditPresetId): {
  edl: AutoEditEdl;
  words: AutoEditWord[];
  rawDurationMs: number;
  demoTheme: AutoEditDemoTheme;
} {
  const presetMeta = AUTO_EDIT_PRESETS.find((p) => p.id === presetId) || AUTO_EDIT_PRESETS[0];
  const previewMeta = AUTO_EDIT_PRESET_PREVIEW_META[presetId] || AUTO_EDIT_PRESET_PREVIEW_META["ugc-review"];

  const makeWords = (
    clipId: string,
    seg1Start: number,
    seg1End: number,
    seg1Words: string[],
    seg2Start: number,
    seg2End: number,
    seg2Words: string[],
  ): AutoEditWord[] => {
    const out: AutoEditWord[] = [];
    let counter = 1;
    const placeSegmentWords = (startBound: number, endBound: number, wordsList: string[]) => {
      if (!wordsList.length) return;
      const padStart = startBound + 160;
      const padEnd = Math.max(padStart + 200, endBound - 160);
      const step = (padEnd - padStart) / wordsList.length;
      wordsList.forEach((text, i) => {
        const startMs = Math.round(padStart + i * step);
        const nextStart = Math.round(padStart + (i + 1) * step);
        const endMs = Math.min(endBound - 40, Math.max(startMs + 60, nextStart - 20));
        out.push({ id: `dw_${counter++}`, clipId, text, startMs, endMs, confidence: 0.97 });
      });
    };
    placeSegmentWords(seg1Start, seg1End, seg1Words);
    placeSegmentWords(seg2Start, seg2End, seg2Words);
    return out;
  };

  type DemoConfig = {
    title: string;
    summary: string;
    hookHeadline: string;
    hookSubtext: string;
    hookEmoji: string;
    presenterTitle: string;
    presenterSubtitle: string;
    seg1Text: string;
    seg2Text: string;
    highlightWord: string;
    highlightColor: "amber" | "emerald" | "rose" | "cyan";
    highlightEmoji: string;
    extraOverlays: AutoEditOverlay[];
  };

  const configByPreset: Record<AutoEditPresetId, DemoConfig> = {
    "ugc-review": {
      title: "Review Serum Kiềm Dầu",
      summary: "Đã tự động cắt bỏ đoạn nói vấp đầu clip và khoảng lặng 1.6s.",
      hookHeadline: "KIỀM DẦU SAU 10 GIÂY?",
      hookSubtext: "Test thực tế trên da dầu dưới nắng 36°C",
      hookEmoji: "🛍️",
      presenterTitle: "Creator Review UGC",
      presenterSubtitle: "Đã lọc khoảng lặng & đoạn ờ à",
      seg1Text: "Chất gel thấm rất nhanh không bết dính",
      seg2Text: "Giá dùng thử hôm nay chỉ 199K thôi",
      highlightWord: "199K",
      highlightColor: "amber",
      highlightEmoji: "🔥",
      extraOverlays: [
        {
          id: "ov_demo_card",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 400,
          durationMs: 3600,
          layout: "stage-3d",
          badge: "DEAL HOT",
          title: "Serum Kiềm Dầu B5",
          subtitle: "Thấm ráo tức thì · Không nâng tông ảo",
          priceTag: "199K",
          emoji: "✨",
          accentColor: "amber",
          sfxId: "reveal-sparkle",
          hyperframesHtml: '<div class="hf-bar"><div class="hf-fill"></div></div>',
          hyperframesCss:
            ".hf-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden;margin-top:8px}.hf-fill{height:100%;width:calc(var(--hf-progress,1)*100%);background:linear-gradient(90deg,#fbbf24,#34d399)}",
        },
      ],
    },
    "fast-tiktok": {
      title: "3 Mẹo Chỉnh Màu Điện Thoại",
      summary: "Cắt cực sát 300ms, Punch-in Zoom liên tục 1.0x ↔ 1.18x.",
      hookHeadline: "3 GIÂY LÊN MÀU ĐIỆN ẢNH ⚡",
      hookSubtext: "Không cần app nặng, chỉnh trực tiếp",
      hookEmoji: "⚡",
      presenterTitle: "Short Viral Nhịp Nhanh",
      presenterSubtitle: "Jump-Cut 300ms · Karaoke Pop",
      seg1Text: "Giảm độ tương phản xuống âm mười lăm",
      seg2Text: "Kéo nhẹ ánh sáng ấm là xong ngay",
      highlightWord: "xong",
      highlightColor: "rose",
      highlightEmoji: "⚡",
      extraOverlays: [
        {
          id: "ov_demo_pill",
          kind: "callout_pill",
          anchorSegmentId: "seg_03",
          offsetMs: 500,
          durationMs: 2800,
          layout: "center-pop",
          title: "Bật HDR +15% Cực Nét!",
          emoji: "🔥",
          accentColor: "rose",
          sfxId: "reveal-pop",
        },
      ],
    },
    "tutorial-saas": {
      title: "Hướng dẫn Tạo Workflow AI",
      summary: "Cắt đoạn chờ tải trang, khoanh vùng nút bấm & tô dạ quang thông số.",
      hookHeadline: "TỰ ĐỘNG HOÁ TRONG 2 PHÚT",
      hookSubtext: "Thao tác từng bước trên giao diện thật",
      hookEmoji: "💻",
      presenterTitle: "Screencast Hướng Dẫn SaaS",
      presenterSubtitle: "Spotlight Box + Bút dạ quang",
      seg1Text: "Bấm vào nút Tạo Workflow ngay góc giữa",
      seg2Text: "Chọn model Gemini để tự động xử lý",
      highlightWord: "Workflow",
      highlightColor: "cyan",
      highlightEmoji: "💻",
      extraOverlays: [
        {
          id: "ov_demo_spot",
          kind: "spotlight_box",
          anchorSegmentId: "seg_01",
          offsetMs: 600,
          durationMs: 2800,
          layout: "center-pop",
          title: "Bấm nút này",
          emoji: "👆",
          accentColor: "cyan",
          sfxId: "mouse-clicks",
          targetX: 0.5,
          targetY: 0.52,
          targetW: 0.34,
          targetH: 0.14,
        },
        {
          id: "ov_demo_hl",
          kind: "highlighter",
          anchorSegmentId: "seg_03",
          offsetMs: 500,
          durationMs: 2600,
          layout: "center-pop",
          title: "Model Tự Động",
          emoji: "✨",
          accentColor: "amber",
          sfxId: "swoosh",
          targetX: 0.5,
          targetY: 0.66,
          targetW: 0.38,
          targetH: 0.075,
        },
      ],
    },
    "podcast-talk": {
      title: "Podcast Xây dựng Sản phẩm",
      summary: "Giữ nhịp nghỉ có chiều sâu 600ms, lọc từ thừa và nhấn câu trích dẫn.",
      hookHeadline: "ĐIỀU GIỮ CHÂN KHÁCH HÀNG LÂU NHẤT",
      hookSubtext: "Trích đoạn đối thoại Studio",
      hookEmoji: "🎙️",
      presenterTitle: "Podcast Studio · 2 Mic",
      presenterSubtitle: "Giữ nhịp tự nhiên · Phụ đề hộp mờ",
      seg1Text: "Khách hàng không mua tính năng phức tạp",
      seg2Text: "Họ chọn sản phẩm giải quyết đúng nỗi đau",
      highlightWord: "nỗi",
      highlightColor: "cyan",
      highlightEmoji: "💡",
      extraOverlays: [
        {
          id: "ov_demo_pod",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 400,
          durationMs: 3400,
          layout: "split-top",
          badge: "QUOTE ĐẮT GIÁ",
          title: "Giải quyết 1 vấn đề thật sâu",
          subtitle: "Tập 14 · Chuyện Làm Sản Phẩm",
          emoji: "🎙️",
          accentColor: "cyan",
          sfxId: "reveal-chime",
        },
      ],
    },
    "edu-course": {
      title: "Giải mã Dòng tiền & Lãi suất",
      summary: "Bút dạ quang nhấn khái niệm, thẻ ghi nhớ và Freeze HUD chốt kết luận.",
      hookHeadline: "HIỂU BẢN CHẤT TRONG 60 GIÂY",
      hookSubtext: "Bài giảng trực quan phong cách Vox",
      hookEmoji: "🎓",
      presenterTitle: "Bảng Giảng Giải Thích Vox",
      presenterSubtitle: "Highlighter + Freeze HUD",
      seg1Text: "Lãi kép chỉ phát huy khi bạn tái đầu tư",
      seg2Text: "Hãy nhớ quy tắc bảy hai để nhẩm nhanh",
      highlightWord: "kép",
      highlightColor: "cyan",
      highlightEmoji: "🎓",
      extraOverlays: [
        {
          id: "ov_demo_edu_hl",
          kind: "highlighter",
          anchorSegmentId: "seg_01",
          offsetMs: 650,
          durationMs: 2400,
          layout: "center-pop",
          title: "Lãi kép = Thời gian²",
          emoji: "🖍️",
          accentColor: "amber",
          sfxId: "swoosh",
          targetX: 0.5,
          targetY: 0.5,
          targetW: 0.42,
          targetH: 0.08,
        },
        {
          id: "ov_demo_edu_frz",
          kind: "freeze_frame",
          anchorSegmentId: "seg_03",
          offsetMs: 800,
          durationMs: 2400,
          layout: "center-pop",
          badge: "GHI NHỚ",
          title: "Quy tắc 72 ÷ Lãi suất",
          accentColor: "cyan",
          sfxId: "camera-shutter",
        },
      ],
    },
    "news-recap": {
      title: "Điểm tin Công nghệ 60s",
      summary: "Nhịp tin 320ms dứt khoát, thẻ tóm tắt Split-Top nổi bật.",
      hookHeadline: "TIN NÓNG CÔNG NGHỆ HÔM NAY",
      hookSubtext: "3 thay đổi lớn vừa được công bố",
      hookEmoji: "📰",
      presenterTitle: "Bản Tin Nhanh 60s",
      presenterSubtitle: "Split-Top Summary + Transition SFX",
      seg1Text: "Bản cập nhật mới hỗ trợ xử lý video ngay tại máy",
      seg2Text: "Tốc độ xuất file tăng gấp ba lần trước đây",
      highlightWord: "gấp",
      highlightColor: "rose",
      highlightEmoji: "📰",
      extraOverlays: [
        {
          id: "ov_demo_news",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 300,
          durationMs: 3200,
          layout: "split-top",
          badge: "ĐIỂM TIN #1",
          title: "Xử lý Local 0s Copy · Nhanh 3x",
          subtitle: "Cập nhật chính thức tháng 11",
          emoji: "⚡",
          accentColor: "rose",
          sfxId: "transition-sweep",
        },
      ],
    },
    "real-estate": {
      title: "Penthouse View Sông Sài Gòn",
      summary: "Giữ trọn cú lia máy không gian, thẻ thông số 3D thanh lịch.",
      hookHeadline: "PENTHOUSE 185M² TRUNG TÂM",
      hookSubtext: "Ban công Panorama · Sổ hồng riêng",
      hookEmoji: "🏢",
      presenterTitle: "Showroom & Bất Động Sản",
      presenterSubtitle: "Nền mờ Cinema · Thẻ 3D Luxury",
      seg1Text: "Phòng khách trần cao bốn mét đón nắng tự nhiên",
      seg2Text: "Bàn giao nội thất chuẩn châu Âu dọn vào ở ngay",
      highlightWord: "bốn",
      highlightColor: "amber",
      highlightEmoji: "🏢",
      extraOverlays: [
        {
          id: "ov_demo_estate",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 350,
          durationMs: 3600,
          layout: "stage-3d",
          badge: "BÀN GIAO NGAY",
          title: "185m² · 3 Phòng Ngủ",
          subtitle: "Hướng Đông Nam · View Sông",
          priceTag: "18.5 Tỷ",
          emoji: "✨",
          accentColor: "amber",
          sfxId: "reveal-chime",
        },
      ],
    },
    "food-mukbang": {
      title: "Food Tour Quán Ngon Sài Gòn",
      summary: "Giữ trọn biểu cảm thử món ngon miệng, nổi bật thẻ tên món + giá.",
      hookHeadline: "TÔ ĐẶC BIỆT FULL TOPPING 45K",
      hookSubtext: "Quán hẻm đông kín từ 6 giờ sáng",
      hookEmoji: "🍜",
      presenterTitle: "Review Ẩm Thực & Quán Ngon",
      presenterSubtitle: "Thẻ món ăn + Giá + Chấm điểm",
      seg1Text: "Nước dùng ninh xương đậm vị thơm mùi sả",
      seg2Text: "Chả cua mềm ngọt ăn một lần là ghiền luôn",
      highlightWord: "ghiền",
      highlightColor: "amber",
      highlightEmoji: "😋",
      extraOverlays: [
        {
          id: "ov_demo_food",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 300,
          durationMs: 3400,
          layout: "floating-right",
          badge: "9.5 / 10 ĐIỂM",
          title: "Bún Bò Đặc Biệt",
          subtitle: "Hẻm 128 · Mở cửa 06:00–13:00",
          priceTag: "45K",
          emoji: "🍜",
          accentColor: "amber",
          sfxId: "reveal-pop",
        },
      ],
    },
    "tech-unbox": {
      title: "Mở hộp Laptop AI 2026",
      summary: "Bảng Spec Card có thanh tiến trình điểm số & Freeze HUD soi cổng kết nối.",
      hookHeadline: "MỞ HỘP ULTRABOOK 980 GRAM",
      hookSubtext: "Pin 18 tiếng · Màn hình OLED 120Hz",
      hookEmoji: "📱",
      presenterTitle: "Bàn Review Gear & Tech",
      presenterSubtitle: "Spec Card 3D + Freeze HUD",
      seg1Text: "Thân máy hợp kim siêu nhẹ cầm một tay gọn bâng",
      seg2Text: "Hiệu năng xử lý đồ hoạ mát và êm bất ngờ",
      highlightWord: "nhẹ",
      highlightColor: "emerald",
      highlightEmoji: "📱",
      extraOverlays: [
        {
          id: "ov_demo_spec",
          kind: "product_card",
          anchorSegmentId: "seg_01",
          offsetMs: 700,
          durationMs: 3000,
          layout: "stage-3d",
          badge: "SPEC CARD",
          title: "OLED 120Hz · Pin 18h",
          subtitle: "Nặng 980g · Sạc nhanh 100W",
          priceTag: "29.9M",
          emoji: "⚡",
          accentColor: "emerald",
          sfxId: "reveal-ping",
          hyperframesHtml: '<div class="hf-bar"><div class="hf-fill"></div></div>',
          hyperframesCss:
            ".hf-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:8px}.hf-fill{height:100%;width:calc(var(--hf-progress,1)*94%);background:linear-gradient(90deg,#34d399,#38bdf8)}",
        },
        {
          id: "ov_demo_tech_frz",
          kind: "freeze_frame",
          anchorSegmentId: "seg_03",
          offsetMs: 700,
          durationMs: 2200,
          layout: "center-pop",
          badge: "CLOSE-UP",
          title: "2× Thunderbolt 5",
          accentColor: "emerald",
          sfxId: "camera-shutter",
        },
      ],
    },
    "vlog-travel": {
      title: "Một Buổi Sáng Ở Đà Lạt",
      summary: "Phụ đề Minimal thoáng khung hình, giữ nhịp cảm xúc và nhãn địa điểm.",
      hookHeadline: "ĐÀ LẠT 6 GIỜ SÁNG",
      hookSubtext: "Săn mây đồi chè & cà phê rang mộc",
      hookEmoji: "✈️",
      presenterTitle: "Vlog Du Lịch Điện Ảnh",
      presenterSubtitle: "Phụ đề Minimal · Giữ cảnh đẹp",
      seg1Text: "Sương sớm phủ trắng cả thung lũng yên bình",
      seg2Text: "Một ly cà phê nóng giữa tiết trời mười sáu độ",
      highlightWord: "yên",
      highlightColor: "cyan",
      highlightEmoji: "🌲",
      extraOverlays: [
        {
          id: "ov_demo_vlog",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 400,
          durationMs: 3200,
          layout: "floating-left",
          badge: "ĐỊA ĐIỂM",
          title: "Đồi Chè Cầu Đất",
          subtitle: "06:15 AM · 16°C",
          emoji: "📍",
          accentColor: "cyan",
          sfxId: "whoosh-soft",
        },
      ],
    },
    "gaming-highlight": {
      title: "Pha Lật Kèo 1v4 Phút Cuối",
      summary: "Lọc sạch đoạn chờ trận, giữ pha giao tranh kèm Zoom 1.2x & Freeze HUD.",
      hookHeadline: "LẬT KÈO 1V4 KHÔNG TƯỞNG 🎮",
      hookSubtext: "Từ file quay 12GB chỉ giữ 10s đỉnh nhất",
      hookEmoji: "🎮",
      presenterTitle: "Gaming Highlight · Aurora 3D",
      presenterSubtitle: "Cắt chờ trận 280ms · Freeze HUD",
      seg1Text: "Còn đúng một chấm máu vẫn né trọn chiêu cuối",
      seg2Text: "Quay ngược phản công quét sạch cả đội bạn",
      highlightWord: "quét",
      highlightColor: "rose",
      highlightEmoji: "🔥",
      extraOverlays: [
        {
          id: "ov_demo_game_frz",
          kind: "freeze_frame",
          anchorSegmentId: "seg_03",
          offsetMs: 450,
          durationMs: 2200,
          layout: "center-pop",
          badge: "CLUTCH MOMENT",
          title: "HP 3% · QUADRA KILL!",
          accentColor: "rose",
          sfxId: "camera-shutter",
        },
      ],
    },
    "minimal-aesthetic": {
      title: "Lookbook Thu Đông Tối giản",
      summary: "Chuyển cảnh êm ái, thẻ kính mờ thanh lịch và tiết chế hiệu ứng ồn.",
      hookHeadline: "CHẤT LIỆU TỪ THIÊN NHIÊN",
      hookSubtext: "Bộ sưu tập Linen & Len mịn 2026",
      hookEmoji: "✨",
      presenterTitle: "Aesthetic Brand & Spa",
      presenterSubtitle: "Nhịp cắt êm 520ms · Thẻ kính mờ",
      seg1Text: "Đường cắt tối giản tôn lên phom dáng tự nhiên",
      seg2Text: "Chất vải thoáng nhẹ phù hợp cả ngày dài",
      highlightWord: "tối",
      highlightColor: "cyan",
      highlightEmoji: "✨",
      extraOverlays: [
        {
          id: "ov_demo_aes",
          kind: "product_card",
          anchorSegmentId: "seg_03",
          offsetMs: 400,
          durationMs: 3400,
          layout: "floating-right",
          badge: "LOOK 01",
          title: "Áo Khoác Linen Tự Nhiên",
          subtitle: "3 gam màu trung tính",
          priceTag: "890K",
          emoji: "✨",
          accentColor: "cyan",
          sfxId: "whoosh-soft",
        },
      ],
    },
  };

  const cfg = configByPreset[presetId];
  const segments: AutoEditSegment[] = [
    {
      id: "seg_01",
      clipId: "clip_demo",
      sourceStartMs: 0,
      sourceEndMs: 4200,
      keep: true,
      zoom: 1,
      zoomFocusY: 0.38,
      transcriptText: cfg.seg1Text,
    },
    {
      id: "seg_02",
      clipId: "clip_demo",
      sourceStartMs: 4200,
      sourceEndMs: 6000,
      keep: false,
      cutReason: "silence",
      zoom: 1,
      zoomFocusY: 0.38,
      transcriptText: "ờm... (khoảng lặng 1.8s đã tự động cắt)",
    },
    {
      id: "seg_03",
      clipId: "clip_demo",
      sourceStartMs: 6000,
      sourceEndMs: 10500,
      keep: true,
      zoom: presetId === "fast-tiktok" || presetId === "gaming-highlight" ? 1.18 : 1.12,
      zoomFocusY: 0.36,
      transcriptText: cfg.seg2Text,
    },
  ];

  const words = makeWords(
    "clip_demo",
    0,
    4200,
    cfg.seg1Text.split(/\s+/u).filter(Boolean),
    6000,
    10500,
    cfg.seg2Text.split(/\s+/u).filter(Boolean),
  );

  const overlays: AutoEditOverlay[] = [
    {
      id: "ov_demo_hook",
      kind: "hook_banner",
      anchorSegmentId: "seg_01",
      offsetMs: 0,
      durationMs: 2800,
      layout: "center-pop",
      badge: presetMeta.badge,
      title: cfg.hookHeadline,
      subtitle: cfg.hookSubtext,
      emoji: cfg.hookEmoji,
      accentColor: cfg.highlightColor,
      sfxId: presetId === "minimal-aesthetic" || presetId === "vlog-travel" ? "whoosh-soft" : "reveal-pop",
    },
    ...cfg.extraOverlays,
  ];

  return {
    edl: {
      schema: "auto-edit-edl.v1",
      title: cfg.title,
      summary: cfg.summary,
      hookHeadline: cfg.hookHeadline,
      hookSubtext: cfg.hookSubtext,
      hookEmoji: cfg.hookEmoji,
      captionStyle: presetMeta.defaultCaptionStyle,
      segments,
      overlays,
      keywordHighlights: [
        { word: cfg.highlightWord, color: cfg.highlightColor, emoji: cfg.highlightEmoji },
      ],
      directorNotes: [presetMeta.directorRules],
    },
    words,
    rawDurationMs: 10_500,
    demoTheme: {
      kind: previewMeta.demoThemeKind,
      presenterTitle: cfg.presenterTitle,
      presenterSubtitle: cfg.presenterSubtitle,
      accentHex: previewMeta.accentHex,
    },
  };
}

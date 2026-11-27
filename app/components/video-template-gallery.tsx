"use client";

import { Player } from "@remotion/player";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  CREATE_VIDEO_PRESET_CATEGORIES,
  CREATE_VIDEO_PRESETS,
  computeCreateVideoTimeline,
  type CreateVideoAspectRatio,
  type CreateVideoCaptionStyle,
  type CreateVideoPresetCategory,
  type CreateVideoPresetId,
} from "../lib/motion-video";
import {
  AUTO_EDIT_PRESET_CATEGORIES,
  AUTO_EDIT_PRESETS,
  computeAutoEditTimeline,
  type AutoEditAspectRatio,
  type AutoEditPresetCategory,
  type AutoEditPresetId,
} from "../lib/auto-edit";
import {
  AUTO_EDIT_PRESET_PREVIEW_META,
  MOTION_PRESET_PREVIEW_META,
  buildAutoEditPresetDemoData,
  buildMotionVideoPresetDemoPlan,
} from "../lib/video-template-previews";
import { AutoEditRemotionComposition } from "./auto-edit-remotion-composition";
import { MotionVideoRemotionComposition } from "./motion-video-remotion-composition";
import { Icon } from "./ui-icon";

const withoutLeadingEmoji = (value: string) =>
  value.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\s)+/u, "");

const GALLERY_VIEW_EVENT = "storyai:gallery-view-change";

function useStoredGalleryViewMode(storageKey: string): ["grid" | "list", (mode: "grid" | "list") => void] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const handleStorage = (e: StorageEvent) => {
        if (!e.key || e.key === storageKey) onStoreChange();
      };
      const handleCustom = (e: Event) => {
        const detail = (e as CustomEvent<string>).detail;
        if (!detail || detail === storageKey) onStoreChange();
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener(GALLERY_VIEW_EVENT, handleCustom);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(GALLERY_VIEW_EVENT, handleCustom);
      };
    },
    [storageKey],
  );

  const getSnapshot = useCallback((): "grid" | "list" => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  }, [storageKey]);

  const viewMode = useSyncExternalStore<"grid" | "list">(subscribe, getSnapshot, () => "grid");

  const updateViewMode = useCallback(
    (mode: "grid" | "list") => {
      try {
        localStorage.setItem(storageKey, mode);
        window.dispatchEvent(new CustomEvent(GALLERY_VIEW_EVENT, { detail: storageKey }));
      } catch {
        // Ignore storage failures
      }
    },
    [storageKey],
  );

  return [viewMode, updateViewMode];
}

const captionStyleLabels: Record<CreateVideoCaptionStyle, string> = {
  "karaoke-pop": "Karaoke Pop",
  "clean-pill": "Hộp mờ Clean Pill",
  "minimal-line": "Minimal",
  none: "Ẩn phụ đề",
};

const verticalFitLabels: Record<string, string> = {
  auto: "Tự động theo clip",
  "aurora-3d": "Sân khấu 3D Aurora",
  "blur-fit": "Nền mờ Cinema",
  "fill-crop": "Cắt dọc đầy màn hình",
};

function MotionTemplateStageArtwork({ presetId, accentHex }: { presetId: CreateVideoPresetId; accentHex: string }) {
  switch (presetId) {
    case "apple-launch":
      return (
        <div className="vtp-art vtp-art-browser">
          <div className="vtp-browser-window" style={{ borderColor: `${accentHex}88` }}>
            <div className="vtp-browser-dots">
              <span /><span /><span />
            </div>
            <div className="vtp-browser-body">
              <div className="vtp-bar-accent" style={{ background: accentHex }} />
              <div className="vtp-browser-cards">
                <span /><span />
              </div>
            </div>
          </div>
          <div className="vtp-cursor-pointer" style={{ color: accentHex }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" stroke="#090d16" strokeWidth="2.2">
              <path d="M5 3l14 9-6.5 1.8L15 21l-3.5 1.5L9 15.3 5 19z" />
            </svg>
          </div>
        </div>
      );
    case "article-recap":
      return (
        <div className="vtp-art vtp-art-article">
          <div className="vtp-paper-card">
            <div className="vtp-paper-head" />
            <div className="vtp-paper-line" />
            <div className="vtp-paper-highlight" style={{ background: `${accentHex}cc` }} />
            <div className="vtp-paper-line short" />
          </div>
        </div>
      );
    case "vox-explainer":
      return (
        <div className="vtp-art vtp-art-vox">
          <div className="vtp-vox-col">
            <span className="vtp-vox-pill" style={{ borderColor: "#fb7185", color: "#fda4af" }}>CŨ</span>
            <div className="vtp-vox-bar muted" />
          </div>
          <div className="vtp-vox-col">
            <span className="vtp-vox-pill" style={{ borderColor: accentHex, color: accentHex }}>MỚI</span>
            <div className="vtp-vox-bar active" style={{ background: accentHex }} />
          </div>
        </div>
      );
    case "tech-news":
      return (
        <div className="vtp-art vtp-art-waterfall">
          <div className="vtp-wf-line" style={{ color: accentHex }}>AI NEWS · 60S</div>
          <div className="vtp-wf-track">
            <div className="vtp-wf-fill" style={{ background: accentHex }} />
          </div>
          <div className="vtp-wf-track small">
            <div className="vtp-wf-fill" style={{ background: "#38bdf8", width: "68%" }} />
          </div>
        </div>
      );
    case "finance-data":
      return (
        <div className="vtp-art vtp-art-stats">
          <div className="vtp-stat-number" style={{ color: accentHex }}>+215%</div>
          <div className="vtp-stat-bars">
            <span style={{ height: "36%" }} />
            <span style={{ height: "58%" }} />
            <span style={{ height: "86%", background: accentHex }} />
          </div>
        </div>
      );
    case "commerce-promo":
      return (
        <div className="vtp-art vtp-art-promo">
          <div className="vtp-promo-split">
            <span className="vtp-promo-old">Cũ</span>
            <span className="vtp-promo-new" style={{ borderColor: accentHex, color: accentHex }}>Chốt đơn</span>
          </div>
          <div className="vtp-promo-cta" style={{ background: accentHex }}>ƯU ĐÃI 199K →</div>
        </div>
      );
    case "viral-hook":
      return (
        <div className="vtp-art vtp-art-viral">
          <div className="vtp-viral-word">3 GIÂY ĐẦU</div>
          <div className="vtp-viral-word accent" style={{ color: "#fbbf24" }}>GIỮ CHÂN 90%</div>
        </div>
      );
    case "minimal-brand":
    default:
      return (
        <div className="vtp-art vtp-art-minimal">
          <div className="vtp-minimal-frame">
            <span className="vtp-minimal-kicker">ATELIER</span>
            <strong className="vtp-minimal-title">Tinh giản</strong>
            <i className="vtp-minimal-line" />
          </div>
        </div>
      );
  }
}

function AutoEditTemplateStageArtwork({ presetId, accentHex }: { presetId: AutoEditPresetId; accentHex: string }) {
  switch (presetId) {
    case "ugc-review":
    case "food-mukbang":
    case "real-estate":
      return (
        <div className="vtp-art vtp-art-ae-card">
          <div className="vtp-ae-avatar" style={{ borderColor: accentHex }}>
            <span />
          </div>
          <div className="vtp-ae-float-card" style={{ borderColor: accentHex }}>
            <i style={{ background: accentHex }}>{presetId === "real-estate" ? "185M²" : presetId === "food-mukbang" ? "45K" : "199K"}</i>
            <span />
          </div>
        </div>
      );
    case "tutorial-saas":
    case "edu-course":
      return (
        <div className="vtp-art vtp-art-ae-spot">
          <div className="vtp-ae-ui-box">
            <div className="vtp-ae-spotlight" style={{ borderColor: accentHex }}>
              <span className="vtp-ae-spot-label" style={{ background: accentHex }}>
                {presetId === "tutorial-saas" ? "Click" : "Ghi nhớ"}
              </span>
            </div>
          </div>
        </div>
      );
    case "podcast-talk":
      return (
        <div className="vtp-art vtp-art-ae-podcast">
          <div className="vtp-ae-wave">
            <span /><span style={{ background: accentHex }} /><span /><span style={{ background: accentHex }} /><span /><span />
          </div>
          <div className="vtp-ae-quote-pill">“Câu trích dẫn đắt giá”</div>
        </div>
      );
    case "tech-unbox":
    case "gaming-highlight":
      return (
        <div className="vtp-art vtp-art-ae-hud">
          <div className="vtp-hud-corners" style={{ borderColor: accentHex }}>
            <span className="vtp-hud-tag" style={{ background: accentHex }}>
              {presetId === "gaming-highlight" ? "CLUTCH 1v4" : "SPEC HUD"}
            </span>
          </div>
        </div>
      );
    case "fast-tiktok":
    case "news-recap":
      return (
        <div className="vtp-art vtp-art-ae-fast">
          <div className="vtp-ae-hook-pill" style={{ borderColor: accentHex }}>
            {presetId === "news-recap" ? "TIN NÓNG 60S" : "ZOOM 1.18x ⚡"}
          </div>
          <div className="vtp-ae-timeline-cuts">
            <span className="kept" /><span className="cut" /><span className="kept" style={{ background: accentHex }} />
          </div>
        </div>
      );
    case "vlog-travel":
    case "minimal-aesthetic":
    default:
      return (
        <div className="vtp-art vtp-art-minimal">
          <div className="vtp-minimal-frame">
            <span className="vtp-minimal-kicker">{presetId === "vlog-travel" ? "CINEMA VLOG" : "AESTHETIC"}</span>
            <strong className="vtp-minimal-title">{presetId === "vlog-travel" ? "Đà Lạt 06:15" : "Minimal Cut"}</strong>
            <i className="vtp-minimal-line" style={{ background: accentHex }} />
          </div>
        </div>
      );
  }
}

export function MotionTemplateStageThumb({
  presetId,
  compact = false,
}: {
  presetId: CreateVideoPresetId;
  compact?: boolean;
}) {
  const preset = CREATE_VIDEO_PRESETS.find((p) => p.id === presetId) || CREATE_VIDEO_PRESETS[0];
  const meta = MOTION_PRESET_PREVIEW_META[preset.id];
  return (
    <div className={`video-template-stage theme-${preset.defaultPalette}${compact ? " is-compact" : ""}`}>
      {!compact && (
        <div className="vtp-stage-top">
          <span className="vtp-pill-aspect">{preset.recommendedAspect}</span>
          <span className="vtp-pill-vector">{preset.dominantVector.toUpperCase()}</span>
        </div>
      )}
      <MotionTemplateStageArtwork presetId={preset.id} accentHex={meta.accentHex} />
      {!compact && (
        <div className="vtp-stage-bottom">
          <span className="vtp-caption-sample">{captionStyleLabels[preset.defaultCaptionStyle]}</span>
          <span className="vtp-preview-play-chip">
            <Icon name="play" size={11} /> Xem thử
          </span>
        </div>
      )}
    </div>
  );
}

export function AutoEditTemplateStageThumb({
  presetId,
  compact = false,
}: {
  presetId: AutoEditPresetId;
  compact?: boolean;
}) {
  const preset = AUTO_EDIT_PRESETS.find((p) => p.id === presetId) || AUTO_EDIT_PRESETS[0];
  const meta = AUTO_EDIT_PRESET_PREVIEW_META[preset.id];
  return (
    <div className={`video-template-stage theme-ae-${preset.id}${compact ? " is-compact" : ""}`}>
      {!compact && (
        <div className="vtp-stage-top">
          <span className="vtp-pill-aspect">{preset.recommendedAspect}</span>
          <span className="vtp-pill-vector">Gọt {preset.recommendedSilenceMs}ms</span>
        </div>
      )}
      <AutoEditTemplateStageArtwork presetId={preset.id} accentHex={meta.accentHex} />
      {!compact && (
        <div className="vtp-stage-bottom">
          <span className="vtp-caption-sample">{captionStyleLabels[preset.defaultCaptionStyle]}</span>
          <span className="vtp-preview-play-chip">
            <Icon name="play" size={11} /> Xem thử
          </span>
        </div>
      )}
    </div>
  );
}

export function MotionVideoTemplateGallery({
  selectedPresetId,
  category,
  onCategoryChange,
  onPreview,
  onSelect,
}: {
  selectedPresetId: CreateVideoPresetId;
  category: "all" | CreateVideoPresetCategory;
  onCategoryChange: (cat: "all" | CreateVideoPresetCategory) => void;
  onPreview: (id: CreateVideoPresetId) => void;
  onSelect: (id: CreateVideoPresetId) => void;
}) {
  const [viewMode, updateViewMode] = useStoredGalleryViewMode("storyai_motion_gallery_view");

  const filtered = useMemo(
    () => (category === "all" ? CREATE_VIDEO_PRESETS : CREATE_VIDEO_PRESETS.filter((p) => p.category === category)),
    [category],
  );

  return (
    <section className="card video-template-gallery" aria-label="Kho mẫu Motion Video">
      <div className="video-template-gallery-head">
        <div>
          <span className="section-kicker">BƯỚC 1 · CHỌN MẪU PHONG CÁCH</span>
          <h2>Xem trước &amp; Chọn mẫu Motion Video</h2>
          <p className="auto-edit-lead">
            Bấm <strong>Xem thử</strong> trên bất kỳ mẫu nào để chạy thử video chuyển động thật với Remotion, Three.js &amp; GSAP trước khi nhập nội dung.
          </p>
        </div>
        <div className="sales-template-gallery-actions">
          <div className="sales-view-mode-toggle" role="group" aria-label="Cách hiển thị mẫu">
            <button
              type="button"
              className={`sales-view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => updateViewMode("grid")}
              aria-pressed={viewMode === "grid"}
            >
              Thẻ Preview
            </button>
            <button
              type="button"
              className={`sales-view-mode-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => updateViewMode("list")}
              aria-pressed={viewMode === "list"}
            >
              Danh sách
            </button>
          </div>
          <span className="sales-template-count">{filtered.length}/{CREATE_VIDEO_PRESETS.length} mẫu</span>
        </div>
      </div>

      <div className="auto-edit-cat-pills" role="tablist" aria-label="Nhóm phong cách Motion Video">
        {CREATE_VIDEO_PRESET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            className={`auto-edit-cat-pill ${category === cat.id ? "is-active" : ""}`}
            onClick={() => onCategoryChange(cat.id)}
          >
            {withoutLeadingEmoji(cat.label)}
          </button>
        ))}
      </div>

      {viewMode === "grid" ? (
        <div className="video-template-grid">
          {filtered.map((item) => {
            const meta = MOTION_PRESET_PREVIEW_META[item.id];
            const isSelected = selectedPresetId === item.id;
            return (
              <article key={item.id} className={`video-template-card${isSelected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="video-template-stage-trigger"
                  onClick={() => onPreview(item.id)}
                  aria-label={`Xem thử video mẫu ${withoutLeadingEmoji(item.label)}`}
                >
                  <MotionTemplateStageThumb presetId={item.id} />
                </button>
                <div className="video-template-card-body">
                  <div className="auto-edit-preset-top">
                    <span className="auto-edit-preset-badge">{item.badge}</span>
                    <span className="auto-edit-preset-meta">{meta.tempoLabel}</span>
                  </div>
                  <h3>{withoutLeadingEmoji(item.label)}</h3>
                  <p>{item.summary}</p>
                  <div className="video-template-chips">
                    {meta.highlights.map((chip) => (
                      <span key={chip}>{chip}</span>
                    ))}
                  </div>
                </div>
                <div className="video-template-card-actions">
                  <button type="button" className="secondary-button compact" onClick={() => onPreview(item.id)}>
                    <Icon name="play" size={13} /> Xem thử
                  </button>
                  <button type="button" className="primary-button compact" onClick={() => onSelect(item.id)}>
                    Dùng mẫu này →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="video-template-list">
          {filtered.map((item) => {
            const meta = MOTION_PRESET_PREVIEW_META[item.id];
            const isSelected = selectedPresetId === item.id;
            return (
              <article key={item.id} className={`video-template-list-row${isSelected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="video-template-list-thumb-btn"
                  onClick={() => onPreview(item.id)}
                  aria-label={`Xem thử ${withoutLeadingEmoji(item.label)}`}
                >
                  <MotionTemplateStageThumb presetId={item.id} compact />
                </button>
                <div className="video-template-list-info">
                  <div className="auto-edit-preset-top">
                    <span className="auto-edit-preset-badge">{item.badge}</span>
                    <span className="auto-edit-preset-meta">{item.recommendedAspect} · {meta.sceneFlowLabel}</span>
                  </div>
                  <strong>{withoutLeadingEmoji(item.label)}</strong>
                  <span>{item.summary}</span>
                </div>
                <div className="video-template-list-actions">
                  <button type="button" className="secondary-button compact" onClick={() => onPreview(item.id)}>
                    <Icon name="play" size={13} /> Xem thử
                  </button>
                  <button type="button" className="primary-button compact" onClick={() => onSelect(item.id)}>
                    Dùng mẫu →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AutoEditTemplateGallery({
  selectedPresetId,
  category,
  onCategoryChange,
  onPreview,
  onSelect,
}: {
  selectedPresetId: AutoEditPresetId;
  category: "all" | AutoEditPresetCategory;
  onCategoryChange: (cat: "all" | AutoEditPresetCategory) => void;
  onPreview: (id: AutoEditPresetId) => void;
  onSelect: (id: AutoEditPresetId) => void;
}) {
  const [viewMode, updateViewMode] = useStoredGalleryViewMode("storyai_auto_edit_gallery_view");

  const filtered = useMemo(
    () => (category === "all" ? AUTO_EDIT_PRESETS : AUTO_EDIT_PRESETS.filter((p) => p.category === category)),
    [category],
  );

  return (
    <section className="card video-template-gallery" aria-label="Kho mẫu Auto Edit Video">
      <div className="video-template-gallery-head">
        <div>
          <span className="section-kicker">BƯỚC 1 · CHỌN MẪU DỰNG VIDEO</span>
          <h2>Xem trước &amp; Chọn mẫu Auto Edit</h2>
          <p className="auto-edit-lead">
            Mỗi mẫu đi kèm nhịp cắt khoảng lặng, hiệu ứng zoom, thẻ đồ hoạ HyperFrames và kiểu phụ đề riêng. Bấm <strong>Xem thử</strong> để xem video demo chạy thật trước khi tải clip lên.
          </p>
        </div>
        <div className="sales-template-gallery-actions">
          <div className="sales-view-mode-toggle" role="group" aria-label="Cách hiển thị mẫu">
            <button
              type="button"
              className={`sales-view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => updateViewMode("grid")}
              aria-pressed={viewMode === "grid"}
            >
              Thẻ Preview
            </button>
            <button
              type="button"
              className={`sales-view-mode-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => updateViewMode("list")}
              aria-pressed={viewMode === "list"}
            >
              Danh sách
            </button>
          </div>
          <span className="sales-template-count">{filtered.length}/{AUTO_EDIT_PRESETS.length} mẫu</span>
        </div>
      </div>

      <div className="auto-edit-cat-pills" role="tablist" aria-label="Nhóm chủ đề Auto Edit">
        {AUTO_EDIT_PRESET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            className={`auto-edit-cat-pill ${category === cat.id ? "is-active" : ""}`}
            onClick={() => onCategoryChange(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {viewMode === "grid" ? (
        <div className="video-template-grid">
          {filtered.map((item) => {
            const meta = AUTO_EDIT_PRESET_PREVIEW_META[item.id];
            const isSelected = selectedPresetId === item.id;
            return (
              <article key={item.id} className={`video-template-card${isSelected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="video-template-stage-trigger"
                  onClick={() => onPreview(item.id)}
                  aria-label={`Xem thử mẫu ${withoutLeadingEmoji(item.label)}`}
                >
                  <AutoEditTemplateStageThumb presetId={item.id} />
                </button>
                <div className="video-template-card-body">
                  <div className="auto-edit-preset-top">
                    <span className="auto-edit-preset-badge">{item.badge}</span>
                    <span className="auto-edit-preset-meta">
                      {item.recommendedAspect} · {item.recommendedSilenceMs}ms
                    </span>
                  </div>
                  <h3>{withoutLeadingEmoji(item.label)}</h3>
                  <p>{item.summary}</p>
                  <div className="video-template-chips">
                    {meta.highlights.map((chip) => (
                      <span key={chip}>{chip}</span>
                    ))}
                  </div>
                </div>
                <div className="video-template-card-actions">
                  <button type="button" className="secondary-button compact" onClick={() => onPreview(item.id)}>
                    <Icon name="play" size={13} /> Xem thử
                  </button>
                  <button type="button" className="primary-button compact" onClick={() => onSelect(item.id)}>
                    Dùng mẫu này →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="video-template-list">
          {filtered.map((item) => {
            const isSelected = selectedPresetId === item.id;
            return (
              <article key={item.id} className={`video-template-list-row${isSelected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="video-template-list-thumb-btn"
                  onClick={() => onPreview(item.id)}
                  aria-label={`Xem thử ${withoutLeadingEmoji(item.label)}`}
                >
                  <AutoEditTemplateStageThumb presetId={item.id} compact />
                </button>
                <div className="video-template-list-info">
                  <div className="auto-edit-preset-top">
                    <span className="auto-edit-preset-badge">{item.badge}</span>
                    <span className="auto-edit-preset-meta">
                      {item.recommendedAspect} · Ngưỡng cắt {item.recommendedSilenceMs}ms
                    </span>
                  </div>
                  <strong>{withoutLeadingEmoji(item.label)}</strong>
                  <span>{item.summary}</span>
                </div>
                <div className="video-template-list-actions">
                  <button type="button" className="secondary-button compact" onClick={() => onPreview(item.id)}>
                    <Icon name="play" size={13} /> Xem thử
                  </button>
                  <button type="button" className="primary-button compact" onClick={() => onSelect(item.id)}>
                    Dùng mẫu →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SelectedTemplateBanner({
  kind,
  presetId,
  onPreview,
  onChangeTemplate,
}: {
  kind: "motion" | "auto-edit";
  presetId: CreateVideoPresetId | AutoEditPresetId;
  onPreview: () => void;
  onChangeTemplate: () => void;
}) {
  if (kind === "motion") {
    const preset = CREATE_VIDEO_PRESETS.find((p) => p.id === presetId) || CREATE_VIDEO_PRESETS[0];
    const meta = MOTION_PRESET_PREVIEW_META[preset.id];
    return (
      <div className="video-template-selected-banner">
        <div className="video-template-selected-thumb">
          <MotionTemplateStageThumb presetId={preset.id} compact />
        </div>
        <div className="video-template-selected-copy">
          <span className="section-kicker">MẪU MOTION ĐANG DÙNG · {preset.badge}</span>
          <strong>{withoutLeadingEmoji(preset.label)}</strong>
          <p>{preset.summary}</p>
          <div className="video-template-chips">
            <span>Tỷ lệ gợi ý: {preset.recommendedAspect}</span>
            <span>Vector: {preset.dominantVector.toUpperCase()}</span>
            <span>Phụ đề: {captionStyleLabels[preset.defaultCaptionStyle]}</span>
            <span>{meta.sceneFlowLabel}</span>
          </div>
        </div>
        <div className="video-template-selected-actions">
          <button type="button" className="secondary-button compact" onClick={onPreview}>
            <Icon name="play" size={14} /> Xem thử mẫu
          </button>
          <button type="button" className="secondary-button compact" onClick={onChangeTemplate}>
            ← Đổi mẫu khác
          </button>
        </div>
      </div>
    );
  }

  const preset = AUTO_EDIT_PRESETS.find((p) => p.id === presetId) || AUTO_EDIT_PRESETS[0];
  return (
    <div className="video-template-selected-banner">
      <div className="video-template-selected-thumb">
        <AutoEditTemplateStageThumb presetId={preset.id} compact />
      </div>
      <div className="video-template-selected-copy">
        <span className="section-kicker">MẪU AUTO EDIT ĐANG DÙNG · {preset.badge}</span>
        <strong>{withoutLeadingEmoji(preset.label)}</strong>
        <p>{preset.summary}</p>
        <div className="video-template-chips">
          <span>Tỷ lệ gợi ý: {preset.recommendedAspect}</span>
          <span>Cắt lặng: {preset.recommendedSilenceMs}ms</span>
          <span>Phông nền: {verticalFitLabels[preset.recommendedVerticalFit] || preset.recommendedVerticalFit}</span>
          <span>Phụ đề: {captionStyleLabels[preset.defaultCaptionStyle]}</span>
        </div>
      </div>
      <div className="video-template-selected-actions">
        <button type="button" className="secondary-button compact" onClick={onPreview}>
          <Icon name="play" size={14} /> Xem thử mẫu
        </button>
        <button type="button" className="secondary-button compact" onClick={onChangeTemplate}>
          ← Đổi mẫu khác
        </button>
      </div>
    </div>
  );
}

type ModalProps =
  | {
      kind: "motion";
      presetId: CreateVideoPresetId | null;
      onClose: () => void;
      onNavigatePreset: (id: CreateVideoPresetId) => void;
      onApply: (id: CreateVideoPresetId, chosenAspect: CreateVideoAspectRatio) => void;
    }
  | {
      kind: "auto-edit";
      presetId: AutoEditPresetId | null;
      onClose: () => void;
      onNavigatePreset: (id: AutoEditPresetId) => void;
      onApply: (id: AutoEditPresetId, chosenAspect: AutoEditAspectRatio) => void;
    };

export function TemplateLivePreviewModal(props: ModalProps) {
  const { kind, presetId, onClose } = props;
  const [aspectOverride, setAspectOverride] = useState<{
    presetId: string;
    aspect: "9:16" | "16:9" | "1:1";
  } | null>(null);
  const [sfxEnabled, setSfxEnabled] = useState(false);

  const recommendedAspect = useMemo<"9:16" | "16:9" | "1:1">(() => {
    if (!presetId) return "9:16";
    if (kind === "motion") {
      return (CREATE_VIDEO_PRESETS.find((p) => p.id === presetId) || CREATE_VIDEO_PRESETS[0]).recommendedAspect;
    }
    return (AUTO_EDIT_PRESETS.find((p) => p.id === presetId) || AUTO_EDIT_PRESETS[0]).recommendedAspect;
  }, [kind, presetId]);

  const previewAspect =
    presetId && aspectOverride?.presetId === presetId ? aspectOverride.aspect : recommendedAspect;

  useEffect(() => {
    if (!presetId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [presetId, onClose]);

  const motionDemo = useMemo(() => {
    if (kind !== "motion" || !presetId) return null;
    const plan = buildMotionVideoPresetDemoPlan(presetId as CreateVideoPresetId);
    const timeline = computeCreateVideoTimeline(plan, previewAspect, [], {
      autoSfx: sfxEnabled,
      sfxVolumeDb: -11,
    });
    const presetMeta = CREATE_VIDEO_PRESETS.find((p) => p.id === presetId) || CREATE_VIDEO_PRESETS[0];
    return { plan, timeline, presetMeta, extraMeta: MOTION_PRESET_PREVIEW_META[presetMeta.id] };
  }, [kind, presetId, previewAspect, sfxEnabled]);

  const autoEditDemo = useMemo(() => {
    if (kind !== "auto-edit" || !presetId) return null;
    const data = buildAutoEditPresetDemoData(presetId as AutoEditPresetId);
    const timeline = computeAutoEditTimeline(data.edl, data.words, previewAspect, data.rawDurationMs, {
      autoSfx: sfxEnabled,
      sfxVolumeDb: -11,
    });
    const presetMeta = AUTO_EDIT_PRESETS.find((p) => p.id === presetId) || AUTO_EDIT_PRESETS[0];
    return { ...data, timeline, presetMeta, extraMeta: AUTO_EDIT_PRESET_PREVIEW_META[presetMeta.id] };
  }, [kind, presetId, previewAspect, sfxEnabled]);

  if (!presetId) return null;

  const listIds =
    kind === "motion"
      ? CREATE_VIDEO_PRESETS.map((p) => p.id)
      : AUTO_EDIT_PRESETS.map((p) => p.id);
  const currentIdx = Math.max(0, listIds.indexOf(presetId as never));
  const prevId = listIds[(currentIdx - 1 + listIds.length) % listIds.length];
  const nextId = listIds[(currentIdx + 1) % listIds.length];
  const playerMaxWidth = previewAspect === "16:9" ? 560 : previewAspect === "1:1" ? 380 : 285;

  return (
    <div
      className="video-template-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="video-template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-template-modal-title"
      >
        <header className="video-template-modal-header">
          <div>
            <span className="section-kicker">
              {kind === "motion" ? "XEM THỬ MẪU MOTION VIDEO" : "XEM THỬ MẪU AUTO EDIT"}
              {" · "}
              {kind === "motion" ? motionDemo?.presetMeta.badge : autoEditDemo?.presetMeta.badge}
            </span>
            <h2 id="video-template-modal-title">
              {withoutLeadingEmoji(
                kind === "motion" ? motionDemo?.presetMeta.label || "" : autoEditDemo?.presetMeta.label || "",
              )}
            </h2>
          </div>
          <div className="video-template-modal-nav">
            <button
              type="button"
              className="secondary-button compact"
              onClick={() =>
                kind === "motion"
                  ? props.onNavigatePreset(prevId as CreateVideoPresetId)
                  : props.onNavigatePreset(prevId as AutoEditPresetId)
              }
            >
              ← Mẫu trước
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() =>
                kind === "motion"
                  ? props.onNavigatePreset(nextId as CreateVideoPresetId)
                  : props.onNavigatePreset(nextId as AutoEditPresetId)
              }
            >
              Mẫu tiếp →
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Đóng xem thử mẫu"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        <div className="video-template-modal-body">
          <div className="video-template-modal-stage-col">
            <div className="video-template-modal-controls">
              <div className="auto-edit-ratio-pills" role="group" aria-label="Thử tỷ lệ khung hình">
                {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`auto-edit-ratio-btn ${previewAspect === ratio ? "is-active" : ""}`}
                    onClick={() => setAspectOverride({ presetId, aspect: ratio })}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              <label className="auto-edit-safezone-toggle">
                <input
                  type="checkbox"
                  checked={sfxEnabled}
                  onChange={(e) => setSfxEnabled(e.target.checked)}
                />
                <span>Âm thanh SFX</span>
              </label>
            </div>

            <div className="video-template-modal-player-wrap">
              <div style={{ width: "100%", maxWidth: playerMaxWidth }}>
                {kind === "motion" && motionDemo && (
                  <Player
                    key={`mv-preview-${presetId}-${previewAspect}-${sfxEnabled}`}
                    component={MotionVideoRemotionComposition}
                    inputProps={{
                      jobId: "template-preview",
                      timeline: motionDemo.timeline,
                      hasVoiceover: false,
                      imageIds: [],
                      captionStyle: motionDemo.plan.captionStyle,
                      keywordHighlights: motionDemo.plan.keywordHighlights,
                      dominantVector: motionDemo.plan.dominantVector,
                      aspectRatio: previewAspect,
                      safeZoneGuard: true,
                      showSafeZoneGuide: false,
                      motionBlur: true,
                    }}
                    durationInFrames={motionDemo.timeline.totalFrames}
                    fps={motionDemo.timeline.fps}
                    compositionWidth={motionDemo.timeline.width}
                    compositionHeight={motionDemo.timeline.height}
                    style={{ width: "100%", borderRadius: 12, overflow: "hidden" }}
                    autoPlay
                    loop
                    controls
                    acknowledgeRemotionLicense
                  />
                )}
                {kind === "auto-edit" && autoEditDemo && (
                  <Player
                    key={`ae-preview-${presetId}-${previewAspect}-${sfxEnabled}`}
                    component={AutoEditRemotionComposition}
                    inputProps={{
                      jobId: "template-preview",
                      timeline: autoEditDemo.timeline,
                      videos: [],
                      captionStyle: autoEditDemo.edl.captionStyle,
                      safeZoneGuard: true,
                      showSafeZoneGuide: false,
                      aspectRatio: previewAspect,
                      verticalFit: autoEditDemo.presetMeta.recommendedVerticalFit,
                      motionBlur: true,
                      demoTheme: autoEditDemo.demoTheme,
                    }}
                    durationInFrames={Math.max(30, Math.round((autoEditDemo.timeline.totalDurationMs / 1000) * autoEditDemo.timeline.fps))}
                    fps={autoEditDemo.timeline.fps}
                    compositionWidth={autoEditDemo.timeline.width}
                    compositionHeight={autoEditDemo.timeline.height}
                    style={{ width: "100%", borderRadius: 12, overflow: "hidden" }}
                    autoPlay
                    loop
                    controls
                    acknowledgeRemotionLicense
                  />
                )}
              </div>
            </div>
          </div>

          <aside className="video-template-modal-info-col">
            <div className="video-template-modal-summary">
              <h3>Mô tả phong cách</h3>
              <p>{kind === "motion" ? motionDemo?.presetMeta.summary : autoEditDemo?.presetMeta.summary}</p>
            </div>

            <div className="video-template-modal-specs">
              <h3>Thông số tự động áp dụng</h3>
              {kind === "motion" && motionDemo && (
                <ul>
                  <li><span>Tỷ lệ đề xuất</span><strong>{motionDemo.presetMeta.recommendedAspect}</strong></li>
                  <li><span>Dòng chảy Camera</span><strong>Vector {motionDemo.presetMeta.dominantVector.toUpperCase()}</strong></li>
                  <li><span>Kiểu phụ đề</span><strong>{captionStyleLabels[motionDemo.presetMeta.defaultCaptionStyle]}</strong></li>
                  <li><span>Nhịp dựng</span><strong>{motionDemo.extraMeta.tempoLabel}</strong></li>
                  <li><span>Cấu trúc cảnh</span><strong>{motionDemo.extraMeta.sceneFlowLabel}</strong></li>
                </ul>
              )}
              {kind === "auto-edit" && autoEditDemo && (
                <ul>
                  <li><span>Tỷ lệ đề xuất</span><strong>{autoEditDemo.presetMeta.recommendedAspect}</strong></li>
                  <li><span>Ngưỡng cắt khoảng lặng</span><strong>{autoEditDemo.presetMeta.recommendedSilenceMs} ms</strong></li>
                  <li><span>Phông nền sân khấu</span><strong>{verticalFitLabels[autoEditDemo.presetMeta.recommendedVerticalFit]}</strong></li>
                  <li><span>Kiểu phụ đề</span><strong>{captionStyleLabels[autoEditDemo.presetMeta.defaultCaptionStyle]}</strong></li>
                  <li><span>Bố cục thẻ mặc định</span><strong>{autoEditDemo.presetMeta.preferredCardLayout}</strong></li>
                </ul>
              )}
            </div>

            <div className="video-template-modal-director">
              <h3>Cách AI dàn dựng với mẫu này</h3>
              <p>
                {kind === "motion"
                  ? motionDemo?.presetMeta.directorRules
                  : autoEditDemo?.presetMeta.directorRules}
              </p>
            </div>

            <div className="video-template-modal-cta">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  if (kind === "motion") {
                    props.onApply(presetId as CreateVideoPresetId, previewAspect);
                  } else {
                    props.onApply(presetId as AutoEditPresetId, previewAspect);
                  }
                }}
              >
                <Icon name="check" size={16} /> Dùng mẫu này ({previewAspect}) →
              </button>
              <button type="button" className="secondary-button" onClick={onClose}>
                Đóng để xem mẫu khác
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

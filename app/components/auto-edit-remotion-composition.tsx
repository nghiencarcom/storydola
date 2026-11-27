"use client";

import { useMemo, type CSSProperties } from "react";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { evolvePath } from "@remotion/paths";
import { AbsoluteFill, Html5Audio, Html5Video, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  sanitizeOverlayId,
  type AutoEditHighlightColor,
  type AutoEditSourceVideo,
  type AutoEditVerticalFit,
  type ComputedAutoEditTimeline,
  type ComputedTimelineOverlay,
  type ComputedTimelineSegment,
} from "../lib/auto-edit";
import type { AutoEditDemoTheme } from "../lib/video-template-previews";
import { AutoEditThreeBackdrop } from "./auto-edit-three-stage";

export type AutoEditPlayerProps = {
  jobId: string;
  timeline: ComputedAutoEditTimeline;
  videos?: readonly AutoEditSourceVideo[];
  captionStyle: "karaoke-pop" | "clean-pill" | "minimal-line";
  safeZoneGuard: boolean;
  showSafeZoneGuide: boolean;
  aspectRatio: "9:16" | "16:9" | "1:1";
  verticalFit?: AutoEditVerticalFit;
  motionBlur?: boolean;
  demoTheme?: AutoEditDemoTheme;
};

function accentColorHex(color?: AutoEditHighlightColor) {
  if (color === "emerald") return "#34d399";
  if (color === "rose") return "#fb7185";
  if (color === "cyan") return "#38bdf8";
  return "#fbbf24";
}

function OverlayLayer({
  jobId,
  overlay,
  motionBlur = true,
}: {
  jobId: string;
  overlay: ComputedTimelineOverlay;
  motionBlur?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const relMs = (frame / fps) * 1000;
  const durMs = Math.max(300, overlay.timelineEndMs - overlay.timelineStartMs);
  const progress = Math.min(1, Math.max(0, relMs / durMs));
  const enter = interpolate(relMs, [0, 260], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exit = interpolate(relMs, [Math.max(0, durMs - 220), durMs], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const visibility = Math.min(enter, exit);
  const scale = 0.88 + 0.12 * visibility;
  const accent = accentColorHex(overlay.accentColor);
  const blurFilterId = `mblur-${sanitizeOverlayId(overlay.id, "ov")}`;
  const blurPx = motionBlur && relMs < 220 ? Number(((1 - relMs / 220) * 11).toFixed(1)) : 0;

  const customVars = {
    "--hf-progress": progress.toFixed(3),
    "--hf-enter": enter.toFixed(3),
    "--hf-accent": accent,
    opacity: visibility,
    filter: blurPx > 0.6 ? `url(#${blurFilterId})` : undefined,
  } as CSSProperties;

  const motionBlurDefs = blurPx > 0.6 ? (
    <svg width={0} height={0} style={{ position: "absolute" }}>
      <defs>
        <filter id={blurFilterId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation={`${blurPx},0`} />
        </filter>
      </defs>
    </svg>
  ) : null;

  // 1. Hand-drawn Spotlight Box + Curved Pointer Arrow (@remotion/paths evolvePath)
  if (overlay.kind === "spotlight_box") {
    const cx = Math.round((overlay.targetX ?? 0.5) * width);
    const cy = Math.round((overlay.targetY ?? 0.52) * height);
    const bw = Math.round((overlay.targetW ?? 0.28) * width);
    const bh = Math.round((overlay.targetH ?? 0.13) * height);
    const x0 = Math.max(12, cx - Math.round(bw / 2));
    const y0 = Math.max(12, cy - Math.round(bh / 2));
    const rx = Math.min(22, Math.round(Math.min(bw, bh) * 0.28));
    const drawT = interpolate(relMs, [0, 360], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const rectPath = `M ${x0 + rx} ${y0} H ${x0 + bw - rx} Q ${x0 + bw} ${y0} ${x0 + bw} ${y0 + rx} V ${y0 + bh - rx} Q ${x0 + bw} ${y0 + bh} ${x0 + bw - rx} ${y0 + bh} H ${x0 + rx} Q ${x0} ${y0 + bh} ${x0} ${y0 + bh - rx} V ${y0 + rx} Q ${x0} ${y0} ${x0 + rx} ${y0} Z`;
    const arrowStartY = Math.max(28, y0 - 58);
    const arrowPath = `M ${cx + 56} ${arrowStartY} Q ${cx + 32} ${y0 - 24} ${cx + 8} ${y0 - 6}`;
    const evolvedBox = evolvePath(drawT, rectPath);
    const evolvedArrow = evolvePath(Math.min(1, Math.max(0, (drawT - 0.25) / 0.75)), arrowPath);

    return (
      <AbsoluteFill style={{ opacity: visibility, pointerEvents: "none" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <path
            d={rectPath}
            fill="none"
            stroke={accent}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              ...evolvedBox,
              filter: `drop-shadow(0 0 12px ${accent})`,
            }}
          />
          <path
            d={arrowPath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={4}
            strokeLinecap="round"
            style={evolvedArrow}
          />
        </svg>
        {overlay.title && (
          <div
            style={{
              position: "absolute",
              left: Math.min(width - 260, Math.max(16, cx - 90)),
              top: Math.max(14, arrowStartY - 36),
              padding: "6px 14px",
              borderRadius: 999,
              background: accent,
              color: "#0f172a",
              fontSize: 16,
              fontWeight: 900,
              boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
              transform: `scale(${scale.toFixed(3)})`,
            }}
          >
            {overlay.emoji ? `${overlay.emoji} ` : ""}
            {overlay.title}
          </div>
        )}
      </AbsoluteFill>
    );
  }

  // 2. Vox-Style Neon Marker Highlighter
  if (overlay.kind === "highlighter") {
    const cx = Math.round((overlay.targetX ?? 0.5) * width);
    const cy = Math.round((overlay.targetY ?? 0.5) * height);
    const bw = Math.round((overlay.targetW ?? 0.34) * width);
    const bh = Math.round((overlay.targetH ?? 0.065) * height);
    const wipe = interpolate(relMs, [0, 280], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

    return (
      <AbsoluteFill style={{ opacity: visibility, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: cx - Math.round(bw / 2),
            top: cy - Math.round(bh / 2),
            width: bw,
            height: bh,
            borderRadius: 8,
            background: `linear-gradient(90deg, ${accent}88, ${accent}cc)`,
            boxShadow: `0 0 24px ${accent}66`,
            transform: `skewX(-8deg) scaleX(${wipe.toFixed(3)})`,
            transformOrigin: "0% 50%",
            mixBlendMode: "screen",
          }}
        />
        {overlay.title && (
          <div
            style={{
              position: "absolute",
              left: cx,
              top: Math.max(14, cy - Math.round(bh / 2) - 38),
              transform: "translateX(-50%)",
              padding: "4px 12px",
              borderRadius: 8,
              background: "rgba(15,23,42,0.92)",
              border: `1.5px solid ${accent}`,
              color: "#fff",
              fontSize: 15,
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            {overlay.emoji ? `${overlay.emoji} ` : ""}
            {overlay.title}
          </div>
        )}
      </AbsoluteFill>
    );
  }

  // 3. Editorial Freeze-Cut Shutter Flash + Viewfinder HUD Brackets
  if (overlay.kind === "freeze_frame") {
    const flashAlpha = Math.max(0, 1 - relMs / 190) * 0.72;
    const pad = Math.round(Math.min(width, height) * 0.06);
    const arm = 34;

    return (
      <AbsoluteFill style={{ opacity: visibility, pointerEvents: "none" }}>
        {flashAlpha > 0.01 && (
          <AbsoluteFill style={{ backgroundColor: `rgba(255,255,255,${flashAlpha.toFixed(3)})` }} />
        )}
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <path
            d={`M ${pad} ${pad + arm} V ${pad} H ${pad + arm} M ${width - pad - arm} ${pad} H ${width - pad} V ${pad + arm} M ${pad} ${height - pad - arm} V ${height - pad} H ${pad + arm} M ${width - pad - arm} ${height - pad} H ${width - pad} V ${height - pad - arm}`}
            fill="none"
            stroke={accent}
            strokeWidth={4}
            strokeLinecap="round"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            top: pad + 14,
            left: pad + 18,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 14px",
            borderRadius: 999,
            background: "rgba(15,23,42,0.88)",
            border: `1.5px solid ${accent}`,
            color: "#fff",
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 99, background: "#ef4444" }} />
          {overlay.badge || "SNAPSHOT FOCUS"} · {overlay.title}
        </div>
      </AbsoluteFill>
    );
  }

  if (overlay.kind === "hook_banner") {
    return (
      <>
        {motionBlurDefs}
        <div
          style={{
            ...customVars,
            position: "absolute",
            top: Math.round(height * 0.075),
            left: "50%",
            transform: `translateX(-50%) scale(${scale.toFixed(3)})`,
            maxWidth: "88%",
            padding: "14px 22px",
            borderRadius: 20,
            background: "rgba(15, 23, 42, 0.88)",
            border: `2px solid ${accent}`,
            boxShadow: "0 18px 40px rgba(0,0,0,0.42)",
            color: "#fff",
            textAlign: "center",
          }}
        >
          {overlay.badge && (
            <div
              style={{
                display: "inline-block",
                padding: "3px 10px",
                marginBottom: 6,
                borderRadius: 999,
                background: accent,
                color: "#0f172a",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {overlay.badge}
            </div>
          )}
          <div style={{ fontSize: width >= 1000 ? 34 : 27, fontWeight: 900, lineHeight: 1.2 }}>
            {overlay.emoji ? `${overlay.emoji} ` : ""}
            {overlay.title}
          </div>
          {overlay.subtitle && (
            <div style={{ marginTop: 5, color: "#e2e8f0", fontSize: 15 }}>{overlay.subtitle}</div>
          )}
        </div>
      </>
    );
  }

  if (overlay.kind === "product_card") {
    const isStage3d = overlay.layout === "stage-3d";
    const rotY = isStage3d ? Number((-13 + progress * 17).toFixed(2)) : 0;
    const rotX = isStage3d ? Number((7 - progress * 9).toFixed(2)) : 0;
    const posStyle: CSSProperties =
      overlay.layout === "floating-left"
        ? { top: Math.round(height * 0.16), left: 26, transform: `scale(${scale.toFixed(3)})` }
        : overlay.layout === "split-top"
          ? { top: Math.round(height * 0.08), left: "50%", width: "88%", maxWidth: "88%", transform: `translateX(-50%) scale(${scale.toFixed(3)})` }
          : overlay.layout === "center-pop"
            ? { top: Math.round(height * 0.22), left: "50%", transform: `translateX(-50%) scale(${scale.toFixed(3)})` }
            : isStage3d
              ? {
                top: Math.round(height * 0.15),
                right: 28,
                transform: `perspective(1050px) rotateY(${rotY}deg) rotateX(${rotX}deg) scale(${scale.toFixed(3)})`,
              }
              : { top: Math.round(height * 0.16), right: 26, transform: `scale(${scale.toFixed(3)})` };

    const imgUrl = overlay.imageId
      ? `/api/auto-edit/${encodeURIComponent(jobId)}/media?kind=image&imageId=${encodeURIComponent(overlay.imageId)}`
      : "";

    const safeDomId = `hf-live-${sanitizeOverlayId(overlay.id, "ov")}`;

    return (
      <>
        {motionBlurDefs}
        <div
          id={safeDomId}
          style={{
            ...customVars,
            ...posStyle,
            position: "absolute",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 16px",
            borderRadius: 22,
            background: isStage3d
              ? "linear-gradient(135deg, rgba(15,23,42,0.94) 0%, rgba(30,41,59,0.88) 100%)"
              : "rgba(15, 23, 42, 0.86)",
            border: `1.5px solid ${isStage3d ? accent : "rgba(255,255,255,0.22)"}`,
            boxShadow: isStage3d
              ? `0 26px 56px rgba(0,0,0,0.6), 0 0 28px ${accent}33`
              : "0 20px 44px rgba(0,0,0,0.45)",
            color: "#fff",
            overflow: "hidden",
            maxWidth: overlay.layout === "split-top" ? "88%" : Math.round(width * 0.78),
          }}
        >
          {isStage3d && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${Math.round(-35 + progress * 150)}%`,
                width: "32%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)",
                transform: "skewX(-22deg)",
                pointerEvents: "none",
              }}
            />
          )}
          {overlay.hyperframesCss && (
            <style>{`#${safeDomId} { ${overlay.hyperframesCss} }`}</style>
          )}
          {imgUrl && (
            <img
              src={imgUrl}
              alt={overlay.title}
              style={{
                width: width >= 1000 ? 114 : 94,
                height: width >= 1000 ? 114 : 94,
                borderRadius: 16,
                objectFit: "cover",
                background: "#fff",
                flexShrink: 0,
                border: `2px solid ${accent}`,
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
              {overlay.badge && (
                <span
                  style={{
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: accent,
                    color: "#0f172a",
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: "uppercase",
                  }}
                >
                  {overlay.badge}
                </span>
              )}
              {overlay.priceTag && (
                <span
                  style={{
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: "rgba(251,191,36,0.22)",
                    color: "#fde68a",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {overlay.priceTag}
                </span>
              )}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.22 }}>
              {overlay.emoji ? `${overlay.emoji} ` : ""}
              {overlay.title}
            </div>
            {overlay.subtitle && (
              <div style={{ marginTop: 4, color: "#cbd5e1", fontSize: 14, lineHeight: 1.35 }}>
                {overlay.subtitle}
              </div>
            )}
            {overlay.hyperframesHtml && (
              <div dangerouslySetInnerHTML={{ __html: overlay.hyperframesHtml }} />
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {motionBlurDefs}
      <div
        style={{
          ...customVars,
          position: "absolute",
          top: Math.round(height * 0.14),
          left: "50%",
          transform: `translateX(-50%) scale(${scale.toFixed(3)})`,
          padding: "10px 20px",
          borderRadius: 999,
          background: "rgba(15, 23, 42, 0.9)",
          border: `2px solid ${accent}`,
          color: "#fff",
          fontSize: 21,
          fontWeight: 800,
          boxShadow: "0 12px 28px rgba(0,0,0,0.38)",
          whiteSpace: "nowrap",
        }}
      >
        {overlay.emoji ? `${overlay.emoji} ` : ""}
        {overlay.title}
      </div>
    </>
  );
}

function DemoArollCanvas({
  demoTheme,
  segment,
  currentTimeMs,
  isPortrait,
  isBlurredBg = false,
}: {
  demoTheme: AutoEditDemoTheme;
  segment: ComputedTimelineSegment;
  currentTimeMs: number;
  isPortrait: boolean;
  isBlurredBg?: boolean;
}) {
  const accent = demoTheme.accentHex || "#38bdf8";
  const pulse = 0.5 + 0.5 * Math.sin(currentTimeMs / 360);
  const isScreencast = demoTheme.kind === "screencast-ui" || demoTheme.kind === "vox-board";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: `radial-gradient(circle at 22% 24%, ${accent}33, transparent 54%), radial-gradient(circle at 80% 78%, rgba(99,102,241,0.3), transparent 56%), linear-gradient(155deg, #0b1120 0%, #111827 52%, #090d16 100%)`,
        transform: `scale(${isBlurredBg ? 1.12 : segment.zoom})`,
        transformOrigin: `50% ${Math.round(segment.zoomFocusY * 100)}%`,
        filter: isBlurredBg ? "blur(24px) brightness(0.5)" : undefined,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: isPortrait ? "34px 28px" : "26px 46px",
        color: "#f8fafc",
      }}
    >
      {/* Subtle studio grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          pointerEvents: "none",
        }}
      />

      {!isBlurredBg && (
        <div
          style={{
            position: "absolute",
            top: isPortrait ? 20 : 16,
            left: 20,
            right: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 13,
            fontWeight: 800,
            color: "#cbd5e1",
            zIndex: 2,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 12px",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.78)",
              border: `1px solid ${accent}66`,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#ef4444", opacity: 0.55 + pulse * 0.45 }} />
            DEMO A-ROLL · {demoTheme.presenterTitle}
          </span>
          <span
            style={{
              padding: "5px 11px",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.78)",
              border: "1px solid rgba(255,255,255,0.16)",
              color: accent,
            }}
          >
            Zoom {segment.zoom.toFixed(2)}x
          </span>
        </div>
      )}

      {isScreencast ? (
        <div
          style={{
            position: "relative",
            width: isPortrait ? "92%" : "82%",
            borderRadius: 18,
            background: "rgba(15, 23, 42, 0.92)",
            border: `1.5px solid ${accent}66`,
            boxShadow: "0 24px 54px rgba(0,0,0,0.55)",
            padding: isPortrait ? 18 : 22,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 99, background: "#fb7185" }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: "#fbbf24" }} />
            <span style={{ width: 10, height: 10, borderRadius: 99, background: "#34d399" }} />
            <span style={{ marginLeft: 8, fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>
              {demoTheme.presenterSubtitle}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ width: "55%", height: 8, borderRadius: 99, background: "rgba(255,255,255,0.25)", marginBottom: 8 }} />
              <div style={{ width: "85%", height: 8, borderRadius: 99, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: `${accent}22`, border: `1.5px solid ${accent}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: accent }}>✦ Tạo Workflow AI</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4 }}>Tự động 1 chạm</div>
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Model: Gemini Auto Director</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: accent }}>Đang kích hoạt</span>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            width: isPortrait ? "88%" : "74%",
            display: "grid",
            justifyItems: "center",
            gap: 14,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: isPortrait ? 132 : 112,
              height: isPortrait ? 132 : 112,
              borderRadius: "50%",
              background: `linear-gradient(145deg, ${accent}55, rgba(15,23,42,0.95))`,
              border: `3px solid ${accent}`,
              boxShadow: `0 0 42px ${accent}44`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg width="56" height="56" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="18" r="8" fill="#f8fafc" fillOpacity="0.92" />
              <path d="M10 40c1.8-7.5 7.4-11 14-11s12.2 3.5 14 11" fill="#f8fafc" fillOpacity="0.88" />
            </svg>
          </div>

          <div style={{ fontSize: isPortrait ? 20 : 22, fontWeight: 900, color: "#ffffff", lineHeight: 1.25 }}>
            {demoTheme.presenterSubtitle}
          </div>

          {/* Animated voice waveform */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, height: 34 }}>
            {Array.from({ length: 16 }, (_, idx) => {
              const barH = Math.round(10 + 22 * Math.abs(Math.sin(currentTimeMs / 170 + idx * 0.7)));
              return (
                <span
                  key={idx}
                  style={{
                    width: 5,
                    height: barH,
                    borderRadius: 99,
                    background: idx % 3 === 0 ? accent : "rgba(248, 250, 252, 0.55)",
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function AutoEditRemotionComposition({
  jobId,
  timeline,
  videos = [],
  captionStyle,
  safeZoneGuard,
  showSafeZoneGuide,
  aspectRatio,
  verticalFit = "auto",
  motionBlur = true,
  demoTheme,
}: AutoEditPlayerProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;
  const clipMetaById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);

  const { enrichedPages } = useMemo(() => {
    const captions: Caption[] = timeline.words.map((w) => ({
      text: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: Math.round((w.startMs + w.endMs) / 2),
      confidence: w.confidence,
    }));
    const { pages } = createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: 1050,
    });
    const metaMap = new Map(timeline.words.map((w) => [`${w.startMs}:${w.text.trim()}`, w]));
    return {
      enrichedPages: pages.map((p) => ({
        startMs: p.startMs,
        endMs: p.startMs + p.durationMs,
        tokens: p.tokens.map((tok) => {
          const meta = metaMap.get(`${tok.fromMs}:${tok.text.trim()}`);
          return {
            ...tok,
            color: meta?.highlightColor ? accentColorHex(meta.highlightColor) : undefined,
            emoji: meta?.emoji,
          };
        }),
      })),
    };
  }, [timeline.words]);

  const activePage = enrichedPages.find((p) => currentTimeMs >= p.startMs && currentTimeMs <= p.endMs);
  const safeBottomPx = safeZoneGuard && aspectRatio === "9:16"
    ? Math.round(height * 0.22)
    : Math.round(height * 0.1);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0f19", overflow: "hidden" }}>
      {/* Layer 1: Smart-Cut Video Segments + Dynamic Punch-in Zoom & 16:9 -> 9:16 Blur-Fit */}
      {timeline.keptSegments.map((seg) => {
        const fromFrame = Math.round((seg.timelineStartMs / 1000) * fps);
        const endFrame = Math.round((seg.timelineEndMs / 1000) * fps);
        const durationInFrames = Math.max(1, endFrame - fromFrame);
        const startFrom = Math.round((seg.sourceStartMs / 1000) * fps);
        const endAt = Math.max(startFrom + 1, Math.round((seg.sourceEndMs / 1000) * fps));
        const isDemoMode = videos.length === 0 && Boolean(demoTheme);
        const videoSrc = `/api/auto-edit/${encodeURIComponent(jobId)}/media?kind=video&clipId=${encodeURIComponent(seg.clipId)}`;
        const clipMeta = clipMetaById.get(seg.clipId);
        const isLandscapeSource = isDemoMode
          ? true
          : clipMeta?.width && clipMeta?.height
            ? clipMeta.width > clipMeta.height * 1.12
            : clipMeta?.aspectRatio === "16:9";
        const useAuroraStage = verticalFit === "aurora-3d";
        const useVerticalBlurCanvas =
          !useAuroraStage &&
          aspectRatio === "9:16" &&
          (verticalFit === "blur-fit" || (verticalFit === "auto" && isLandscapeSource));
        const isPortraitCanvas = height > width;

        return (
          <Sequence key={seg.id} from={fromFrame} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#090d16" }}>
              {useAuroraStage ? (
                <>
                  <AutoEditThreeBackdrop width={width} height={height} />
                  <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: aspectRatio === "9:16" ? "0 14px" : "24px 44px" }}>
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: isDemoMode ? "16 / 9" : undefined,
                        borderRadius: 18,
                        overflow: "hidden",
                        border: "1.5px solid rgba(148, 163, 184, 0.32)",
                        boxShadow: "0 28px 64px rgba(0,0,0,0.68), 0 0 40px rgba(56,189,248,0.18)",
                        transform: `perspective(1200px) rotateY(${(Math.sin(currentTimeMs / 2400) * 3.2).toFixed(2)}deg) rotateX(${(Math.cos(currentTimeMs / 2800) * 2.1).toFixed(2)}deg)`,
                      }}
                    >
                      {isDemoMode && demoTheme ? (
                        <DemoArollCanvas
                          demoTheme={demoTheme}
                          segment={seg}
                          currentTimeMs={currentTimeMs}
                          isPortrait={false}
                        />
                      ) : (
                        <Html5Video
                          src={videoSrc}
                          startFrom={startFrom}
                          endAt={endAt}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                            transform: `scale(${seg.zoom})`,
                            transformOrigin: `50% ${Math.round(seg.zoomFocusY * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  </AbsoluteFill>
                </>
              ) : useVerticalBlurCanvas ? (
                <>
                  {isDemoMode && demoTheme ? (
                    <div style={{ position: "absolute", inset: 0 }}>
                      <DemoArollCanvas
                        demoTheme={demoTheme}
                        segment={seg}
                        currentTimeMs={currentTimeMs}
                        isPortrait={isPortraitCanvas}
                        isBlurredBg
                      />
                    </div>
                  ) : (
                    <Html5Video
                      src={videoSrc}
                      startFrom={startFrom}
                      endAt={endAt}
                      muted
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: "blur(26px) brightness(0.52)",
                        transform: "scale(1.12)",
                      }}
                    />
                  )}
                  <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: isDemoMode ? "16 / 9" : undefined,
                        overflow: "hidden",
                        boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
                      }}
                    >
                      {isDemoMode && demoTheme ? (
                        <DemoArollCanvas
                          demoTheme={demoTheme}
                          segment={seg}
                          currentTimeMs={currentTimeMs}
                          isPortrait={false}
                        />
                      ) : (
                        <Html5Video
                          src={videoSrc}
                          startFrom={startFrom}
                          endAt={endAt}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                            transform: `scale(${seg.zoom})`,
                            transformOrigin: `50% ${Math.round(seg.zoomFocusY * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  </AbsoluteFill>
                </>
              ) : isDemoMode && demoTheme ? (
                <DemoArollCanvas
                  demoTheme={demoTheme}
                  segment={seg}
                  currentTimeMs={currentTimeMs}
                  isPortrait={isPortraitCanvas}
                />
              ) : (
                <Html5Video
                  src={videoSrc}
                  startFrom={startFrom}
                  endAt={endAt}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: Boolean(isLandscapeSource) && width > height && seg.zoom <= 1.02 ? "contain" : "cover",
                    transform: `scale(${seg.zoom})`,
                    transformOrigin: `50% ${Math.round(seg.zoomFocusY * 100)}%`,
                  }}
                />
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Layer 1.5: Synchronized Sound Effects (SFX) from assets/sfx */}
      {timeline.sfxEvents.map((sfx) => {
        const fromFrame = Math.round((sfx.timelineStartMs / 1000) * fps);
        const durationInFrames = Math.max(3, Math.round((sfx.durationMs / 1000) * fps));
        const linearVol = Math.min(1, Math.max(0.02, Math.pow(10, (sfx.volumeDb - sfx.peakDb) / 20)));
        return (
          <Sequence key={sfx.id} from={fromFrame} durationInFrames={durationInFrames}>
            <Html5Audio
              src={`/api/auto-edit/sfx/${encodeURIComponent(sfx.sfxId)}`}
              volume={linearVol}
            />
          </Sequence>
        );
      })}

      {/* Layer 2: HyperFrames Product Cards, Hook Banners & Callouts */}
      {timeline.overlays.map((ov) => {
        const fromFrame = Math.round((ov.timelineStartMs / 1000) * fps);
        const endFrame = Math.round((ov.timelineEndMs / 1000) * fps);
        const durationInFrames = Math.max(1, endFrame - fromFrame);
        return (
          <Sequence key={ov.id} from={fromFrame} durationInFrames={durationInFrames}>
            <OverlayLayer jobId={jobId} overlay={ov} motionBlur={motionBlur} />
          </Sequence>
        );
      })}

      {/* Layer 3: Remotion Karaoke Word-by-Word Captions (Snug fit-content pill, never full-width) */}
      {activePage && activePage.tokens.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: "6%",
            right: safeZoneGuard && aspectRatio === "9:16" ? "14%" : "6%",
            bottom: safeBottomPx,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              width: "fit-content",
              maxWidth: "100%",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "center",
              gap: "8px 14px",
              textAlign: "center",
              ...(captionStyle === "clean-pill"
                ? {
                  padding: "9px 22px",
                  borderRadius: 16,
                  background: "rgba(10, 14, 24, 0.84)",
                  border: "1px solid rgba(255, 255, 255, 0.14)",
                  boxShadow: "0 10px 28px rgba(0, 0, 0, 0.42)",
                }
                : {}),
            }}
          >
            {activePage.tokens.map((tok, idx) => {
              const isCurrent = currentTimeMs >= tok.fromMs && currentTimeMs <= tok.toMs + 65;
              const activeColor = tok.color || "#fbbf24";
              return (
                <span
                  key={`${tok.fromMs}_${idx}`}
                  style={{
                    display: "inline-block",
                    fontSize: width >= 1000 ? 36 : 31,
                    fontWeight: 900,
                    lineHeight: 1.2,
                    color: isCurrent ? activeColor : "#ffffff",
                    transform: isCurrent && captionStyle === "karaoke-pop" ? "scale(1.12)" : "scale(1)",
                    transition: "transform 80ms ease-out",
                    textShadow:
                      "0 3px 0 #090d16, 0 -2px 0 #090d16, 3px 0 0 #090d16, -3px 0 0 #090d16, 0 8px 20px rgba(0,0,0,0.65)",
                  }}
                >
                  {tok.text.trim()}
                  {isCurrent && tok.emoji ? ` ${tok.emoji}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Optional Social Safe-Zone Guide Overlay */}
      {showSafeZoneGuide && aspectRatio === "9:16" && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: "20%",
              width: "14%",
              height: "38%",
              background: "rgba(244, 63, 94, 0.22)",
              borderLeft: "2px dashed rgba(251, 113, 133, 0.8)",
              borderTop: "2px dashed rgba(251, 113, 133, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fecdd3",
              fontSize: 13,
              fontWeight: 700,
              writingMode: "vertical-rl",
            }}
          >
            Cột nút Tim / Bình luận
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "20%",
              background: "rgba(244, 63, 94, 0.22)",
              borderTop: "2px dashed rgba(251, 113, 133, 0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fecdd3",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Vùng Caption & Giỏ hàng TikTok/Reels (Safe-Zone 20%)
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

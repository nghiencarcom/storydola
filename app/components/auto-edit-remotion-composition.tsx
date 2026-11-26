"use client";

import { useMemo, type CSSProperties } from "react";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { AbsoluteFill, Html5Video, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AutoEditHighlightColor,
  ComputedAutoEditTimeline,
  ComputedTimelineOverlay,
} from "../lib/auto-edit";

export type AutoEditPlayerProps = {
  jobId: string;
  timeline: ComputedAutoEditTimeline;
  captionStyle: "karaoke-pop" | "clean-pill" | "minimal-line";
  safeZoneGuard: boolean;
  showSafeZoneGuide: boolean;
  aspectRatio: "9:16" | "16:9" | "1:1";
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
}: {
  jobId: string;
  overlay: ComputedTimelineOverlay;
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

  const customVars = {
    "--hf-progress": progress.toFixed(3),
    "--hf-enter": enter.toFixed(3),
    "--hf-accent": accent,
    opacity: visibility,
  } as CSSProperties;

  if (overlay.kind === "hook_banner") {
    return (
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
    );
  }

  if (overlay.kind === "product_card") {
    const posStyle: CSSProperties =
      overlay.layout === "floating-left"
        ? { top: Math.round(height * 0.16), left: 26, transform: `scale(${scale.toFixed(3)})` }
        : overlay.layout === "split-top"
          ? { top: Math.round(height * 0.08), left: "50%", width: "88%", maxWidth: "88%", transform: `translateX(-50%) scale(${scale.toFixed(3)})` }
          : overlay.layout === "center-pop"
            ? { top: Math.round(height * 0.22), left: "50%", transform: `translateX(-50%) scale(${scale.toFixed(3)})` }
            : { top: Math.round(height * 0.16), right: 26, transform: `scale(${scale.toFixed(3)})` };

    const imgUrl = overlay.imageId
      ? `/api/auto-edit/${encodeURIComponent(jobId)}/media?kind=image&imageId=${encodeURIComponent(overlay.imageId)}`
      : "";

    return (
      <div
        id={`hf-live-${overlay.id}`}
        style={{
          ...customVars,
          ...posStyle,
          position: "absolute",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 16px",
          borderRadius: 22,
          background: "rgba(15, 23, 42, 0.86)",
          border: "1.5px solid rgba(255,255,255,0.22)",
          boxShadow: "0 20px 44px rgba(0,0,0,0.45)",
          color: "#fff",
          maxWidth: overlay.layout === "split-top" ? "88%" : Math.round(width * 0.78),
        }}
      >
        {overlay.hyperframesCss && (
          <style>{`#hf-live-${overlay.id} { ${overlay.hyperframesCss} }`}</style>
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
    );
  }

  return (
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
  );
}

export function AutoEditRemotionComposition({
  jobId,
  timeline,
  captionStyle,
  safeZoneGuard,
  showSafeZoneGuide,
  aspectRatio,
}: AutoEditPlayerProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

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
      {/* Layer 1: Smart-Cut Video Segments + Dynamic Punch-in Zoom */}
      {timeline.keptSegments.map((seg) => {
        const fromFrame = Math.round((seg.timelineStartMs / 1000) * fps);
        const durationInFrames = Math.max(1, Math.round((seg.durationMs / 1000) * fps));
        const startFrom = Math.round((seg.sourceStartMs / 1000) * fps);
        const endAt = Math.max(startFrom + 1, Math.round((seg.sourceEndMs / 1000) * fps));
        const videoSrc = `/api/auto-edit/${encodeURIComponent(jobId)}/media?kind=video&clipId=${encodeURIComponent(seg.clipId)}`;

        return (
          <Sequence key={seg.id} from={fromFrame} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Html5Video
                src={videoSrc}
                startFrom={startFrom}
                endAt={endAt}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: `scale(${seg.zoom})`,
                  transformOrigin: `50% ${Math.round(seg.zoomFocusY * 100)}%`,
                }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* Layer 2: HyperFrames Product Cards, Hook Banners & Callouts */}
      {timeline.overlays.map((ov) => {
        const fromFrame = Math.round((ov.timelineStartMs / 1000) * fps);
        const durationInFrames = Math.max(1, Math.round(((ov.timelineEndMs - ov.timelineStartMs) / 1000) * fps));
        return (
          <Sequence key={ov.id} from={fromFrame} durationInFrames={durationInFrames}>
            <OverlayLayer jobId={jobId} overlay={ov} />
          </Sequence>
        );
      })}

      {/* Layer 3: Remotion Karaoke Word-by-Word Captions + Keyword Emoji Pops */}
      {activePage && activePage.tokens.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: "6%",
            right: safeZoneGuard && aspectRatio === "9:16" ? "15%" : "6%",
            bottom: safeBottomPx,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "8px 10px",
            textAlign: "center",
            ...(captionStyle === "clean-pill"
              ? {
                padding: "10px 18px",
                borderRadius: 16,
                background: "rgba(10, 14, 24, 0.78)",
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
                  fontSize: width >= 1000 ? 38 : 33,
                  fontWeight: 900,
                  lineHeight: 1.18,
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

"use client";

import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { evolvePath } from "@remotion/paths";
import gsap from "gsap";
import { useMemo, type CSSProperties } from "react";
import { AbsoluteFill, Html5Audio, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import {
  sanitizeCreateSceneId,
  type ComputedCreateVideoScene,
  type ComputedCreateVideoTimeline,
  type CreateVideoAspectRatio,
  type CreateVideoCaptionStyle,
  type CreateVideoHighlightColor,
  type CreateVideoKeywordHighlight,
} from "../lib/motion-video";
import { MotionVideoThreeStage } from "./motion-video-three-stage";

const easePower4In = gsap.parseEase("power4.in");
const easePower4Out = gsap.parseEase("power4.out");
const easeBackOut = gsap.parseEase("back.out(1.55)");
const easeExpoOut = gsap.parseEase("expo.out");
const easePower3InOut = gsap.parseEase("power3.inOut");

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function accentColorHex(color?: CreateVideoHighlightColor): string {
  if (color === "emerald") return "#34d399";
  if (color === "rose") return "#fb7185";
  if (color === "cyan") return "#38bdf8";
  if (color === "violet") return "#a78bfa";
  return "#fbbf24";
}

function gsapNudgeCurve(t: number): number {
  const p = clamp01(t);
  if (p < 0.1) return gsap.parseEase("power2.in")(p / 0.1) * 0.08;
  if (p < 0.75) return 0.08 + easePower3InOut((p - 0.1) / 0.65) * 0.82;
  return 0.9 + easeExpoOut((p - 0.75) / 0.25) * 0.1;
}

function computeSeamMotion(
  scene: ComputedCreateVideoScene,
  localMs: number,
  width: number,
  height: number,
  enableMotionBlur: boolean,
): { transform: string; opacity: number; blurX: number; blurY: number } {
  const durMs = Math.max(500, scene.timelineEndMs - scene.timelineStartMs);
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let opacity = 1;
  let blurX = 0;
  let blurY = 0;

  if (scene.seamIn && localMs < scene.seamIn.durationMs) {
    const inDur = Math.max(180, scene.seamIn.durationMs);
    const p = clamp01(localMs / inDur);
    const inv = 1 - easePower4Out(p);
    const vec = scene.seamIn.vector;

    if (scene.seamIn.technique === "inverse-zoom" || vec === "z-pull") {
      scale *= 1 + 0.28 * inv;
      if (enableMotionBlur) {
        blurX = inv * 9;
        blurY = inv * 9;
      }
    } else if (scene.seamIn.technique === "zoom-through" || vec === "z-push") {
      scale *= 1 - 0.24 * inv;
      if (enableMotionBlur) {
        blurX = inv * 9;
        blurY = inv * 9;
      }
    } else if (vec === "up") {
      ty += height * 0.15 * inv;
      if (enableMotionBlur) blurY = inv * 16;
    } else {
      tx += width * 0.14 * inv;
      if (enableMotionBlur) blurX = inv * 18;
    }
    opacity = clamp01(0.35 + p * 1.35);
  }

  const remainingMs = durMs - localMs;
  if (scene.seamOut && remainingMs <= scene.seamOut.durationMs) {
    const outDur = Math.max(180, scene.seamOut.durationMs);
    const p = clamp01(1 - remainingMs / outDur);
    const curve = easePower4In(p);
    const vec = scene.seamOut.vector;

    if (scene.seamOut.technique === "inverse-zoom" || vec === "z-pull") {
      scale *= 1 - 0.24 * curve;
      if (enableMotionBlur) {
        blurX = Math.max(blurX, curve * 9);
        blurY = Math.max(blurY, curve * 9);
      }
    } else if (scene.seamOut.technique === "zoom-through" || vec === "z-push") {
      scale *= 1 + 0.30 * curve;
      if (enableMotionBlur) {
        blurX = Math.max(blurX, curve * 9);
        blurY = Math.max(blurY, curve * 9);
      }
    } else if (vec === "up") {
      ty -= height * 0.15 * curve;
      if (enableMotionBlur) blurY = Math.max(blurY, curve * 16);
    } else {
      tx -= width * 0.14 * curve;
      if (enableMotionBlur) blurX = Math.max(blurX, curve * 18);
    }
  }

  return {
    transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`,
    opacity,
    blurX: Number(blurX.toFixed(1)),
    blurY: Number(blurY.toFixed(1)),
  };
}

function SceneAnnotationOverlay({
  scene,
  localMs,
  width,
  height,
  accent,
}: {
  scene: ComputedCreateVideoScene;
  localMs: number;
  width: number;
  height: number;
  accent: string;
}) {
  const ann = scene.annotation;
  if (!ann || ann.kind === "none") return null;

  const startDelay = 520;
  if (localMs < startDelay) return null;
  const elapsed = localMs - startDelay;
  const cx = Math.round(ann.targetX * width);
  const cy = Math.round(ann.targetY * height);
  const bw = Math.round(ann.targetW * width);
  const bh = Math.round(ann.targetH * height);

  if (ann.kind === "oversized_cursor") {
    const glide = easeExpoOut(clamp01(elapsed / 560));
    const startX = width * 0.84;
    const startY = height * 0.82;
    const curX = startX + (cx - startX) * glide;
    const curY = startY + (cy - startY) * glide;
    const clickElapsed = elapsed - 540;
    const isClicking = clickElapsed >= 0 && clickElapsed <= 240;
    const cursorScale = isClicking ? 0.82 + Math.abs(clickElapsed - 120) / 600 : 1;
    const rippleP = clamp01(clickElapsed / 520);

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 24 }}>
        {clickElapsed > 0 && rippleP < 1 && (
          <div
            style={{
              position: "absolute",
              left: cx - 54,
              top: cy - 54,
              width: 108,
              height: 108,
              borderRadius: "50%",
              border: `3.5px solid ${accent}`,
              opacity: (1 - rippleP) * 0.9,
              transform: `scale(${(0.35 + rippleP * 1.45).toFixed(3)})`,
              boxShadow: `0 0 28px ${accent}`,
            }}
          />
        )}
        {ann.label && clickElapsed > 80 && (
          <div
            style={{
              position: "absolute",
              left: Math.min(width - 260, Math.max(24, cx - 90)),
              top: Math.max(24, cy - 66),
              padding: "7px 16px",
              borderRadius: 999,
              background: accent,
              color: "#090d16",
              fontWeight: 900,
              fontSize: width >= 1200 ? 18 : 16,
              boxShadow: "0 14px 32px rgba(0,0,0,0.5)",
              transform: `scale(${easeBackOut(clamp01((clickElapsed - 80) / 280)).toFixed(3)})`,
            }}
          >
            ✦ {ann.label}
          </div>
        )}
        <svg
          width={68}
          height={68}
          viewBox="0 0 48 48"
          style={{
            position: "absolute",
            left: curX - 8,
            top: curY - 6,
            transform: `scale(${cursorScale.toFixed(3)})`,
            filter: "drop-shadow(0 12px 22px rgba(0,0,0,0.65))",
          }}
        >
          <path
            d="M8 5 L38 22 L24 25 L31 40 L24 43 L17 28 L8 36 Z"
            fill="#ffffff"
            stroke="#090d16"
            strokeWidth="3.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  if (ann.kind === "spotlight_box") {
    const x0 = Math.max(20, cx - Math.round(bw / 2));
    const y0 = Math.max(20, cy - Math.round(bh / 2));
    const rx = 18;
    const drawT = clamp01(elapsed / 380);
    const rectPath = `M ${x0 + rx} ${y0} H ${x0 + bw - rx} Q ${x0 + bw} ${y0} ${x0 + bw} ${y0 + rx} V ${y0 + bh - rx} Q ${x0 + bw} ${y0 + bh} ${x0 + bw - rx} ${y0 + bh} H ${x0 + rx} Q ${x0} ${y0 + bh} ${x0} ${y0 + bh - rx} V ${y0 + rx} Q ${x0} ${y0} ${x0 + rx} ${y0} Z`;
    const evolved = evolvePath(drawT, rectPath);

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 22 }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <path
            d={rectPath}
            fill="none"
            stroke={accent}
            strokeWidth={5}
            strokeLinecap="round"
            style={{ ...evolved, filter: `drop-shadow(0 0 14px ${accent})` }}
          />
        </svg>
        {ann.label && (
          <div
            style={{
              position: "absolute",
              left: x0,
              top: Math.max(18, y0 - 42),
              padding: "5px 14px",
              borderRadius: 999,
              background: accent,
              color: "#090d16",
              fontWeight: 900,
              fontSize: 16,
            }}
          >
            {ann.label}
          </div>
        )}
      </div>
    );
  }

  if (ann.kind === "highlighter") {
    const wipe = easeExpoOut(clamp01(elapsed / 340));
    return (
      <div
        style={{
          position: "absolute",
          left: cx - Math.round(bw / 2),
          top: cy - Math.round(bh / 2),
          width: bw,
          height: bh,
          borderRadius: 10,
          background: `linear-gradient(90deg, ${accent}77, ${accent}cc)`,
          transform: `skewX(-8deg) scaleX(${wipe.toFixed(3)})`,
          transformOrigin: "0% 50%",
          mixBlendMode: "screen",
          boxShadow: `0 0 28px ${accent}55`,
          pointerEvents: "none",
          zIndex: 20,
        }}
      />
    );
  }

  const flashAlpha = Math.max(0, 1 - elapsed / 200) * 0.65;
  const pad = Math.round(Math.min(width, height) * 0.055);
  const arm = 36;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 23 }}>
      {flashAlpha > 0.01 && (
        <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${flashAlpha.toFixed(3)})` }} />
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
    </div>
  );
}

function ActiveSceneVisual({
  scene,
  localMs,
  width,
  height,
  imageUrls,
  safeZoneGuard,
}: {
  scene: ComputedCreateVideoScene;
  localMs: number;
  width: number;
  height: number;
  imageUrls: Record<string, string>;
  safeZoneGuard: boolean;
}) {
  const durMs = Math.max(800, scene.timelineEndMs - scene.timelineStartMs);
  const progress = clamp01(localMs / durMs);
  const enter = clamp01(localMs / 360);
  const accent = accentColorHex(scene.accentColor);
  const isPortrait = height > width;
  const sidePad = isPortrait ? 58 : 110;
  const bottomSafePad = isPortrait && safeZoneGuard ? Math.round(height * 0.2) : Math.round(height * 0.11);

  // 0. CHAPTER CARD (Long-Form Chapter Opener)
  if (scene.kind === "chapter_card") {
    const chapNum = String((scene.chapterIndex ?? 0) + 1).padStart(2, "0");
    const badgeIn = easeBackOut(clamp01(localMs / 340));
    const titleIn = easeExpoOut(clamp01((localMs - 90) / 480));
    const lineWipe = easeExpoOut(clamp01((localMs - 220) / 620));

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${Math.round(height * 0.12)}px ${sidePad}px ${bottomSafePad}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            fontSize: isPortrait ? 270 : 340,
            fontWeight: 900,
            lineHeight: 0.9,
            color: `${accent}16`,
            letterSpacing: "-0.05em",
            userSelect: "none",
            transform: `scale(${(0.92 + 0.1 * progress).toFixed(3)})`,
          }}
        >
          {chapNum}
        </div>

        <div
          style={{
            position: "relative",
            zIndex: 2,
            padding: "8px 22px",
            borderRadius: 999,
            background: `${accent}26`,
            border: `1.5px solid ${accent}`,
            color: accent,
            fontWeight: 900,
            fontSize: isPortrait ? 20 : 18,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 22,
            transform: `translateY(${((1 - badgeIn) * 26).toFixed(1)}px)`,
            opacity: clamp01(badgeIn * 1.4),
          }}
        >
          {scene.badge || `CHƯƠNG ${chapNum}`}
        </div>

        <h2
          style={{
            position: "relative",
            zIndex: 2,
            fontSize: isPortrait ? 58 : 66,
            fontWeight: 900,
            color: "#ffffff",
            lineHeight: 1.12,
            maxWidth: isPortrait ? "92%" : "82%",
            textShadow: "0 12px 34px rgba(0,0,0,0.65)",
            opacity: clamp01(titleIn * 1.4),
            transform: `translateY(${((1 - titleIn) * 34).toFixed(1)}px)`,
          }}
        >
          {scene.headline}
        </h2>

        <div
          style={{
            position: "relative",
            zIndex: 2,
            marginTop: 26,
            height: 6,
            width: `${Math.round(lineWipe * (isPortrait ? 58 : 42))}%`,
            borderRadius: 99,
            background: `linear-gradient(90deg, transparent, ${accent}, #ffffff, transparent)`,
            boxShadow: `0 0 24px ${accent}88`,
          }}
        />

        {scene.subheadline && (
          <p
            style={{
              position: "relative",
              zIndex: 2,
              marginTop: 24,
              maxWidth: isPortrait ? "88%" : "68%",
              fontSize: isPortrait ? 26 : 25,
              lineHeight: 1.42,
              fontWeight: 600,
              color: "#cbd5e1",
              opacity: clamp01((localMs - 300) / 380),
            }}
          >
            {scene.subheadline}
          </p>
        )}
      </div>
    );
  }

  // 1. KINETIC HOOK (GSAP Waterfall Word Stagger)
  if (scene.kind === "kinetic_hook") {
    const words = scene.headline.split(/\s+/u).filter(Boolean);
    const perWordDelay = Math.min(58, Math.floor(420 / Math.max(1, words.length)));

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${Math.round(height * 0.12)}px ${sidePad}px ${bottomSafePad}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {scene.badge && (
          <div
            style={{
              padding: "8px 20px",
              borderRadius: 999,
              background: `${accent}24`,
              border: `1.5px solid ${accent}`,
              color: accent,
              fontWeight: 900,
              fontSize: isPortrait ? 20 : 18,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 24,
              transform: `translateY(${((1 - easeBackOut(clamp01(localMs / 320))) * 24).toFixed(1)}px)`,
              opacity: clamp01(localMs / 240),
            }}
          >
            {scene.emoji ? `${scene.emoji} ` : ""}{scene.badge}
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: isPortrait ? "12px 16px" : "14px 20px",
            maxWidth: isPortrait ? "94%" : "84%",
          }}
        >
          {words.map((w, idx) => {
            const wElapsed = Math.max(0, localMs - 70 - idx * perWordDelay);
            const wP = clamp01(wElapsed / 380);
            const eased = easeBackOut(wP);
            const isHighlightWord = idx >= words.length - 2;
            return (
              <span
                key={`${w}-${idx}`}
                style={{
                  display: "inline-block",
                  fontSize: isPortrait ? 66 : 76,
                  fontWeight: 900,
                  lineHeight: 1.08,
                  letterSpacing: "-0.02em",
                  color: isHighlightWord ? accent : "#ffffff",
                  textShadow: isHighlightWord
                    ? `0 0 38px ${accent}66, 0 8px 26px rgba(0,0,0,0.65)`
                    : "0 10px 30px rgba(0,0,0,0.65)",
                  opacity: clamp01(wP * 1.5),
                  transform: `translateY(${((1 - eased) * 52).toFixed(1)}px) scale(${(0.84 + 0.16 * eased).toFixed(3)})`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>

        {scene.subheadline && (
          <p
            style={{
              marginTop: 28,
              maxWidth: isPortrait ? "88%" : "70%",
              fontSize: isPortrait ? 27 : 26,
              lineHeight: 1.42,
              fontWeight: 600,
              color: "#cbd5e1",
              opacity: clamp01((localMs - 340) / 360),
              transform: `translateY(${((1 - easeExpoOut(clamp01((localMs - 340) / 480))) * 22).toFixed(1)}px)`,
            }}
          >
            {scene.subheadline}
          </p>
        )}
      </div>
    );
  }

  // 2. BROWSER 3D SHOWCASE
  if (scene.kind === "browser_3d_showcase") {
    const imgUrl = scene.imageId ? imageUrls[scene.imageId] : undefined;
    const rotY = -10 + progress * 15;
    const rotX = 6 - progress * 8;
    const cardScale = 0.9 + 0.1 * easeBackOut(enter);
    const s0 = scene.scrollStart ?? 0;
    const s1 = scene.scrollEnd ?? 0.55;
    const scrollPct = (s0 + (s1 - s0) * easePower3InOut(progress)) * 100;

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${isPortrait ? 86 : 56}px ${sidePad}px ${bottomSafePad + 24}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          alignItems: "center",
          gap: isPortrait ? 26 : 20,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "92%", zIndex: 5 }}>
          {scene.badge && (
            <span
              style={{
                display: "inline-block",
                padding: "5px 14px",
                borderRadius: 999,
                background: accent,
                color: "#090d16",
                fontWeight: 900,
                fontSize: 14,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              {scene.emoji ? `${scene.emoji} ` : ""}{scene.badge}
            </span>
          )}
          <h2
            style={{
              fontSize: isPortrait ? 42 : 44,
              fontWeight: 900,
              color: "#ffffff",
              lineHeight: 1.15,
              textShadow: "0 6px 24px rgba(0,0,0,0.55)",
            }}
          >
            {scene.headline}
          </h2>
        </div>

        <div
          style={{
            position: "relative",
            width: isPortrait ? "94%" : "78%",
            flex: 1,
            minHeight: 280,
            maxHeight: isPortrait ? 920 : 620,
            borderRadius: 24,
            background: "rgba(15, 23, 42, 0.92)",
            border: `2px solid ${accent}88`,
            boxShadow: `0 36px 80px rgba(0, 0, 0, 0.72), 0 0 42px ${accent}2e`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transform: `perspective(1350px) rotateY(${rotY.toFixed(2)}deg) rotateX(${rotX.toFixed(2)}deg) scale(${cardScale.toFixed(3)})`,
          }}
        >
          <div
            style={{
              height: 44,
              padding: "0 18px",
              background: "rgba(9, 13, 24, 0.95)",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#fb7185" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#34d399" }} />
            <div
              style={{
                marginLeft: 12,
                padding: "4px 16px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.07)",
                color: "#94a3b8",
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              🔒 {scene.quoteSource || "storyai.motion/live-source"}
            </div>
          </div>

          <div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#0b1120" }}>
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgUrl}
                alt=""
                style={{
                  width: "100%",
                  height: "auto",
                  minHeight: "100%",
                  objectFit: "cover",
                  transform: `translateY(-${scrollPct.toFixed(2)}%)`,
                  display: "block",
                }}
              />
            ) : (
              <div
                style={{
                  padding: isPortrait ? 38 : 48,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 20,
                  background: `radial-gradient(circle at 20% 20%, ${accent}22, transparent 60%), #0f172a`,
                }}
              >
                <div style={{ width: 140, height: 12, borderRadius: 99, background: accent }} />
                <div style={{ fontSize: isPortrait ? 34 : 36, fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }}>
                  {scene.subheadline || scene.narrationText}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 12 }}>
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      style={{
                        height: 86,
                        borderRadius: 16,
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        padding: 14,
                        display: "flex",
                        alignItems: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          height: 8,
                          width: `${Math.round((0.35 + idx * 0.25) * clamp01(progress * 1.4) * 100)}%`,
                          borderRadius: 99,
                          background: accent,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${Math.round(-40 + progress * 165)}%`,
                width: "28%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)",
                transform: "skewX(-22deg)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        <SceneAnnotationOverlay scene={scene} localMs={localMs} width={width} height={height} accent={accent} />
      </div>
    );
  }

  // 3. STAT COUNTER 3D
  if (scene.kind === "stat_counter_3d") {
    const items = scene.stats?.length
      ? scene.stats
      : [
          { label: "Hiệu suất", value: 300, suffix: "%", color: scene.accentColor },
          { label: "Thời gian tiết kiệm", value: 85, suffix: "%", color: "emerald" as const },
        ];
    const countP = easeExpoOut(clamp01((localMs - 140) / 1_150));

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${isPortrait ? 110 : 72}px ${sidePad}px ${bottomSafePad + 36}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "90%" }}>
          {scene.badge && (
            <div
              style={{
                display: "inline-block",
                padding: "6px 16px",
                borderRadius: 999,
                background: `${accent}26`,
                border: `1.5px solid ${accent}`,
                color: accent,
                fontWeight: 800,
                fontSize: 15,
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              {scene.emoji ? `${scene.emoji} ` : ""}{scene.badge}
            </div>
          )}
          <h2 style={{ fontSize: isPortrait ? 48 : 52, fontWeight: 900, color: "#fff", lineHeight: 1.14 }}>
            {scene.headline}
          </h2>
          {scene.subheadline && (
            <p style={{ marginTop: 12, fontSize: 23, color: "#cbd5e1", fontWeight: 500 }}>{scene.subheadline}</p>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isPortrait ? "1fr" : `repeat(${Math.min(3, items.length)}, minmax(0, 1fr))`,
            gap: 22,
            width: isPortrait ? "90%" : "86%",
          }}
        >
          {items.slice(0, 3).map((st, idx) => {
            const stHex = accentColorHex(st.color || scene.accentColor);
            const currentVal = Number.isInteger(st.value)
              ? Math.round(st.value * countP)
              : Number((st.value * countP).toFixed(1));
            const cardIn = easeBackOut(clamp01((localMs - idx * 120) / 420));

            return (
              <div
                key={`${st.label}-${idx}`}
                style={{
                  padding: isPortrait ? "26px 30px" : "32px 28px",
                  borderRadius: 24,
                  background: "rgba(15, 23, 42, 0.84)",
                  border: `2px solid ${stHex}88`,
                  boxShadow: `0 24px 52px rgba(0,0,0,0.55), 0 0 28px ${stHex}26`,
                  backdropFilter: "blur(12px)",
                  textAlign: "center",
                  transform: `translateY(${((1 - cardIn) * 38).toFixed(1)}px) scale(${(0.9 + 0.1 * cardIn).toFixed(3)})`,
                  opacity: clamp01(cardIn * 1.4),
                }}
              >
                <div
                  style={{
                    fontSize: isPortrait ? 64 : 68,
                    fontWeight: 900,
                    color: stHex,
                    lineHeight: 1.05,
                    textShadow: `0 0 28px ${stHex}55`,
                  }}
                >
                  {st.prefix || ""}{currentVal.toLocaleString("en-US")}{st.suffix || ""}
                </div>
                <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>
                  {st.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 4. COMPARISON SPLIT
  if (scene.kind === "comparison_split") {
    const rows = scene.comparisons?.length
      ? scene.comparisons
      : [{ leftLabel: "Thao tác thủ công rời rạc", rightLabel: "Tự động hoá đồng bộ chuẩn xác" }];
    const slideP = gsapNudgeCurve(clamp01(localMs / 580));

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${isPortrait ? 96 : 64}px ${sidePad}px ${bottomSafePad + 28}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: isPortrait ? 46 : 48, fontWeight: 900, color: "#fff" }}>
            {scene.emoji ? `${scene.emoji} ` : ""}{scene.headline}
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isPortrait ? "1fr" : "1fr 1fr",
            gap: 24,
            width: "100%",
          }}
        >
          <div
            style={{
              padding: 28,
              borderRadius: 24,
              background: "rgba(30, 16, 28, 0.84)",
              border: "1.5px solid rgba(251, 113, 133, 0.45)",
              transform: `translateX(${((1 - slideP) * -60).toFixed(1)}px)`,
              opacity: clamp01(slideP * 1.5),
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fb7185", textTransform: "uppercase", marginBottom: 16 }}>
              ✕ {scene.leftTitle || "Trước đây"}
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {rows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.05)",
                    color: "#e2e8f0",
                    fontSize: isPortrait ? 23 : 21,
                    fontWeight: 600,
                  }}
                >
                  {r.leftLabel}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: 28,
              borderRadius: 24,
              background: "rgba(10, 32, 36, 0.88)",
              border: `2px solid ${accent}`,
              boxShadow: `0 22px 54px rgba(0,0,0,0.5), 0 0 32px ${accent}33`,
              transform: `translateX(${((1 - slideP) * 60).toFixed(1)}px)`,
              opacity: clamp01(slideP * 1.5),
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 900, color: accent, textTransform: "uppercase", marginBottom: 16 }}>
              ✓ {scene.rightTitle || "Giải pháp mới"}
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {rows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: "14px 18px",
                    borderRadius: 14,
                    background: `${accent}1c`,
                    border: `1px solid ${accent}44`,
                    color: "#ffffff",
                    fontSize: isPortrait ? 23 : 21,
                    fontWeight: 800,
                  }}
                >
                  {r.rightLabel}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 5. QUOTE EDITORIAL
  if (scene.kind === "quote_editorial") {
    const quoteText = scene.subheadline || scene.narrationText || scene.headline;
    const wipe = easeExpoOut(clamp01((localMs - 380) / 560));

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${Math.round(height * 0.14)}px ${sidePad + 16}px ${bottomSafePad + 30}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            padding: isPortrait ? "44px 38px" : "52px 58px",
            borderRadius: 28,
            background: "rgba(15, 23, 42, 0.86)",
            borderLeft: `8px solid ${accent}`,
            boxShadow: "0 30px 70px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: 82, lineHeight: 0.7, fontWeight: 900, color: `${accent}66`, marginBottom: 18 }}>
            “
          </div>
          <div style={{ fontSize: isPortrait ? 38 : 42, fontWeight: 800, color: "#f8fafc", lineHeight: 1.36 }}>
            {quoteText}
          </div>
          <div
            style={{
              marginTop: 22,
              height: 8,
              width: `${Math.round(wipe * 68)}%`,
              borderRadius: 99,
              background: `linear-gradient(90deg, ${accent}, transparent)`,
            }}
          />
          <div style={{ marginTop: 18, fontSize: 19, fontWeight: 800, color: accent, letterSpacing: "0.04em" }}>
            — {scene.quoteSource || scene.badge || scene.headline}
          </div>
        </div>
      </div>
    );
  }

  // 6. CTA CLIMAX
  if (scene.kind === "cta_climax") {
    const holdMs = scene.stillnessBeforeClimaxMs ?? 380;
    const activeElapsed = Math.max(0, localMs - holdMs);
    const arrival = easeExpoOut(clamp01(activeElapsed / 520));
    const scale = 1.34 - 0.34 * arrival;
    const pulseClick = activeElapsed > 850 && activeElapsed < 1_120 ? 0.94 : 1;

    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: `${Math.round(height * 0.14)}px ${sidePad}px ${bottomSafePad}px`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          opacity: clamp01(localMs / 240),
          transform: `scale(${scale.toFixed(3)})`,
        }}
      >
        {scene.badge && (
          <div
            style={{
              padding: "7px 18px",
              borderRadius: 999,
              background: `${accent}26`,
              border: `1.5px solid ${accent}`,
              color: accent,
              fontWeight: 900,
              fontSize: 16,
              textTransform: "uppercase",
              marginBottom: 20,
            }}
          >
            {scene.emoji ? `${scene.emoji} ` : ""}{scene.badge}
          </div>
        )}
        <h2
          style={{
            fontSize: isPortrait ? 60 : 68,
            fontWeight: 900,
            color: "#ffffff",
            lineHeight: 1.1,
            maxWidth: "88%",
            textShadow: "0 10px 36px rgba(0,0,0,0.65)",
          }}
        >
          {scene.headline}
        </h2>
        {scene.subheadline && (
          <p style={{ marginTop: 20, fontSize: 25, color: "#cbd5e1", maxWidth: "78%", lineHeight: 1.4 }}>
            {scene.subheadline}
          </p>
        )}

        <div
          style={{
            marginTop: 36,
            padding: "20px 44px",
            borderRadius: 999,
            background: `linear-gradient(135deg, ${accent}, #ffffff)`,
            color: "#090d16",
            fontSize: 25,
            fontWeight: 900,
            boxShadow: `0 20px 50px ${accent}66`,
            transform: `scale(${pulseClick})`,
          }}
        >
          {scene.ctaButtonText || "Khám phá ngay"} →
        </div>
        {scene.ctaHint && (
          <div style={{ marginTop: 16, fontSize: 17, color: "#94a3b8", fontWeight: 600 }}>
            {scene.ctaHint}
          </div>
        )}
      </div>
    );
  }

  // 7. HYPERFRAMES CUSTOM INFOGRAPHIC CARD
  const scopeId = `hf-motion-${sanitizeCreateSceneId(scene.id, "sc")}`;
  const scopedCss = scene.hyperframesCss ? `#${scopeId} { ${scene.hyperframesCss} }` : "";

  return (
    <div
      id={scopeId}
      style={{
        position: "absolute",
        inset: 0,
        padding: `${isPortrait ? 96 : 68}px ${sidePad}px ${bottomSafePad + 28}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        "--hf-progress": progress.toFixed(3),
        "--hf-enter": enter.toFixed(3),
        "--hf-accent": accent,
      } as CSSProperties}
    >
      {scopedCss && <style dangerouslySetInnerHTML={{ __html: scopedCss }} />}
      <div style={{ textAlign: "center", maxWidth: "90%" }}>
        {scene.badge && (
          <span
            style={{
              display: "inline-block",
              padding: "5px 15px",
              borderRadius: 999,
              background: `${accent}26`,
              border: `1.5px solid ${accent}`,
              color: accent,
              fontWeight: 800,
              fontSize: 15,
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            {scene.emoji ? `${scene.emoji} ` : ""}{scene.badge}
          </span>
        )}
        <h2 style={{ fontSize: isPortrait ? 46 : 50, fontWeight: 900, color: "#fff", lineHeight: 1.15 }}>
          {scene.headline}
        </h2>
        {scene.subheadline && (
          <p style={{ marginTop: 12, fontSize: 23, color: "#cbd5e1" }}>{scene.subheadline}</p>
        )}
      </div>

      <div
        style={{
          width: isPortrait ? "92%" : "80%",
          padding: isPortrait ? 30 : 38,
          borderRadius: 26,
          background: "rgba(15, 23, 42, 0.86)",
          border: `1.5px solid ${accent}66`,
          boxShadow: "0 28px 64px rgba(0,0,0,0.58)",
          color: "#f8fafc",
          fontSize: 22,
          lineHeight: 1.5,
        }}
      >
        {scene.hyperframesHtml ? (
          <div dangerouslySetInnerHTML={{ __html: scene.hyperframesHtml }} />
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ fontSize: 25, fontWeight: 700, color: "#f8fafc" }}>{scene.narrationText}</div>
            <div style={{ height: 10, borderRadius: 99, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.round(progress * 100)}%`,
                  borderRadius: 99,
                  background: `linear-gradient(90deg, ${accent}, #ffffff)`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type MotionVideoStageCoreProps = {
  frame: number;
  fps: number;
  width: number;
  height: number;
  timeline: ComputedCreateVideoTimeline;
  imageUrls: Record<string, string>;
  captionStyle: CreateVideoCaptionStyle;
  keywordHighlights: readonly CreateVideoKeywordHighlight[];
  dominantVector: ComputedCreateVideoScene["seamOut"]["vector"];
  safeZoneGuard: boolean;
  showSafeZoneGuide?: boolean;
  motionBlur?: boolean;
};

export function MotionVideoStageCore({
  frame,
  fps,
  width,
  height,
  timeline,
  imageUrls,
  captionStyle,
  keywordHighlights,
  dominantVector,
  safeZoneGuard,
  showSafeZoneGuide = false,
  motionBlur = true,
}: MotionVideoStageCoreProps) {
  const timeMs = (frame / fps) * 1000;
  const timeSec = frame / fps;

  const activeScene = useMemo(() => {
    const found = timeline.scenes.find((s) => timeMs >= s.timelineStartMs && timeMs < s.timelineEndMs);
    return found || timeline.scenes[timeline.scenes.length - 1];
  }, [timeline.scenes, timeMs]);

  const captionPages = useMemo(() => {
    if (!timeline.words.length || captionStyle === "none") return [];
    const captions: Caption[] = timeline.words.map((w, idx) => ({
      text: idx === 0 ? w.text : ` ${w.text}`,
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: Math.round((w.startMs + w.endMs) / 2),
      confidence: 0.95,
    }));
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: 1_250,
    }).pages;
  }, [timeline.words, captionStyle]);

  const highlightLookup = useMemo(() => {
    const map = new Map<string, CreateVideoKeywordHighlight>();
    for (const item of keywordHighlights) {
      map.set(item.word.trim().toLowerCase(), item);
    }
    return map;
  }, [keywordHighlights]);

  if (!activeScene) return null;

  const localMs = Math.max(0, timeMs - activeScene.timelineStartMs);
  const sceneDurMs = Math.max(500, activeScene.timelineEndMs - activeScene.timelineStartMs);
  const sceneProgress = clamp01(localMs / sceneDurMs);

  const seam = computeSeamMotion(activeScene, localMs, width, height, motionBlur);
  const useSvgBlur = seam.blurX > 0.7 || seam.blurY > 0.7;
  const blurFilterId = `mv-seam-blur-${activeScene.index}`;

  const activePage = activeScene.showCaptionRail
    ? captionPages.find((p) => timeMs >= p.startMs && timeMs < p.startMs + p.durationMs)
    : undefined;

  const isPortrait = height > width;
  const captionBottomPx = isPortrait && safeZoneGuard ? Math.round(height * 0.14) : Math.round(height * 0.065);

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        backgroundColor: "#050814",
        fontFamily: "'StoryAINoto', 'Noto Sans', system-ui, -apple-system, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <MotionVideoThreeStage
        width={width}
        height={height}
        timeSec={timeSec}
        sceneProgress={sceneProgress}
        palette={activeScene.palette}
        sceneKind={activeScene.kind}
        dominantVector={dominantVector}
        stats={activeScene.stats}
      />

      {useSvgBlur && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <defs>
            <filter id={blurFilterId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation={`${seam.blurX},${seam.blurY}`} />
            </filter>
          </defs>
        </svg>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: seam.transform,
          opacity: seam.opacity,
          filter: useSvgBlur ? `url(#${blurFilterId})` : undefined,
          willChange: "transform, opacity",
        }}
      >
        <ActiveSceneVisual
          scene={activeScene}
          localMs={localMs}
          width={width}
          height={height}
          imageUrls={imageUrls}
          safeZoneGuard={safeZoneGuard}
        />
      </div>

      {activePage && captionStyle !== "none" && (
        <div
          style={{
            position: "absolute",
            left: "7%",
            right: isPortrait && safeZoneGuard ? "14%" : "7%",
            bottom: captionBottomPx,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "center",
              gap: "6px 11px",
              padding: captionStyle === "clean-pill" ? "11px 24px" : "4px 10px",
              borderRadius: captionStyle === "clean-pill" ? 18 : 0,
              background: captionStyle === "clean-pill" ? "rgba(9, 13, 24, 0.86)" : "transparent",
              border: captionStyle === "clean-pill" ? "1px solid rgba(255,255,255,0.16)" : "none",
              boxShadow: captionStyle === "clean-pill" ? "0 14px 36px rgba(0,0,0,0.5)" : "none",
              textAlign: "center",
            }}
          >
            {activePage.tokens.map((tok, i) => {
              const rawWord = tok.text.trim();
              const cleanLookup = rawWord.replace(/[.,!?;:"'()]/gu, "").toLowerCase();
              const hl = highlightLookup.get(cleanLookup);
              const isSpokenNow = timeMs >= tok.fromMs && timeMs < tok.toMs;
              const wordColor = isSpokenNow
                ? accentColorHex(hl?.color || activeScene.accentColor)
                : hl
                  ? accentColorHex(hl.color)
                  : "#ffffff";

              return (
                <span
                  key={`${tok.fromMs}-${i}`}
                  style={{
                    display: "inline-block",
                    fontSize: captionStyle === "minimal-line" ? 28 : isPortrait ? 36 : 34,
                    fontWeight: captionStyle === "minimal-line" ? 700 : 900,
                    color: wordColor,
                    transform: isSpokenNow && captionStyle === "karaoke-pop" ? "scale(1.13)" : "scale(1)",
                    textShadow: "0 3px 14px rgba(0,0,0,0.85)",
                  }}
                >
                  {rawWord}
                  {isSpokenNow && hl?.emoji ? ` ${hl.emoji}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {showSafeZoneGuide && isPortrait && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 40 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "20%",
              background: "rgba(244, 63, 94, 0.16)",
              borderTop: "2px dashed rgba(251, 113, 133, 0.75)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fda4af",
              fontSize: 18,
              fontWeight: 800,
            }}
          >
            VÙNG CAPTION & GIỎ HÀNG TIKTOK/REELS (20%)
          </div>
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: "20%",
              width: "14%",
              height: "36%",
              background: "rgba(251, 191, 36, 0.14)",
              borderLeft: "2px dashed rgba(251, 191, 36, 0.75)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export type MotionVideoPlayerProps = {
  jobId: string;
  timeline: ComputedCreateVideoTimeline;
  hasVoiceover: boolean;
  audioRevision?: string;
  imageIds: readonly string[];
  captionStyle: CreateVideoCaptionStyle;
  keywordHighlights: readonly CreateVideoKeywordHighlight[];
  dominantVector: ComputedCreateVideoScene["seamOut"]["vector"];
  aspectRatio: CreateVideoAspectRatio;
  safeZoneGuard: boolean;
  showSafeZoneGuide: boolean;
  motionBlur: boolean;
};

export function MotionVideoRemotionComposition({
  jobId,
  timeline,
  hasVoiceover,
  audioRevision = "",
  imageIds,
  captionStyle,
  keywordHighlights,
  dominantVector,
  safeZoneGuard,
  showSafeZoneGuide,
  motionBlur,
}: MotionVideoPlayerProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  const imageUrls = useMemo(() => {
    const map: Record<string, string> = {};
    for (const id of imageIds) {
      map[id] = `/api/motion-video/${encodeURIComponent(jobId)}/media?kind=image&imageId=${encodeURIComponent(id)}`;
    }
    return map;
  }, [jobId, imageIds]);

  // Windowed SFX virtualization: only mount <Sequence> near the current playhead so 30-min videos never overflow Chrome WebMediaPlayer limits
  const nearbySfx = timeline.sfxEvents.filter(
    (ev) => ev.timelineMs >= currentTimeMs - 4_000 && ev.timelineMs <= currentTimeMs + 8_000,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#050814" }}>
      <MotionVideoStageCore
        frame={frame}
        fps={fps}
        width={width}
        height={height}
        timeline={timeline}
        imageUrls={imageUrls}
        captionStyle={captionStyle}
        keywordHighlights={keywordHighlights}
        dominantVector={dominantVector}
        safeZoneGuard={safeZoneGuard}
        showSafeZoneGuide={showSafeZoneGuide}
        motionBlur={motionBlur}
      />

      {hasVoiceover && (
        <Html5Audio
          src={`/api/motion-video/${encodeURIComponent(jobId)}/media?kind=voice&rev=${encodeURIComponent(audioRevision)}`}
          volume={1}
        />
      )}

      {nearbySfx.map((ev) => {
        const fromFrame = Math.max(0, Math.round((ev.timelineMs / 1000) * fps));
        const linearVol = Math.min(1, Math.max(0.05, Math.pow(10, ev.volumeDb / 20)));
        return (
          <Sequence key={ev.id} from={fromFrame} layout="none">
            <Html5Audio src={`/api/auto-edit/sfx/${encodeURIComponent(ev.sfxId)}`} volume={linearVol} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

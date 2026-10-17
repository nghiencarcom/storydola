import type { RenderColorFilter, RenderSettings, RenderVisualEffect } from "./project-types";

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  // Keep StoryAI projects at normal playback speed unless a user changes it.
  speed: 1.0,
  enableRandomPanZoom: true,
  useRandomInterval: true,
  minInterval: 5,
  maxInterval: 10,
  interval: 5,
  maxPanX: 6,
  maxPanY: 3,
  minScale: 1.15,
  maxScale: 1.25,
  mirror: false,
  colorFilter: "None",
  trimStart: 0,
  trimEnd: null,
  reverse: false,
  titleText: "",
  titlePosition: "top",
  titleFontSize: 52,
  titleColor: "white",
  watermarkText: "",
  watermarkSpeed: 80,
  watermarkFontSize: 22,
  watermarkColor: "white",
  // MaiVideo FastEdit uses the same fixed 0.85 alpha when no custom opacity
  // control is supplied.  Keep the compatible default here.
  watermarkOpacity: 0.85,
  logo: "none",
  logoPath: null,
  logoPosition: "top-right",
  logoOpacity: 0.7,
  logoScale: 0.12,
  visualEffect: "none",
};

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T) {
  return values.includes(String(value) as T) ? String(value) as T : fallback;
}

export function normalizeRenderSettings(input?: Partial<RenderSettings> | null): RenderSettings {
  const raw = input || {};
  // FastEditTab exposes the safe crop envelope as 1.15–1.25×.  Keeping the
  // same bounds prevents a StoryAI project from silently rendering a much
  // stronger crop than the MaiVideo control that produced its settings.
  const minScale = Math.max(1.15, Math.min(1.25, finite(raw.minScale, DEFAULT_RENDER_SETTINGS.minScale)));
  const maxScale = Math.max(minScale, Math.min(1.25, finite(raw.maxScale, DEFAULT_RENDER_SETTINGS.maxScale)));
  const minInterval = Math.max(0.5, Math.min(30, finite(raw.minInterval, DEFAULT_RENDER_SETTINGS.minInterval)));
  const maxInterval = Math.max(minInterval + 0.2, Math.min(30, finite(raw.maxInterval, DEFAULT_RENDER_SETTINGS.maxInterval)));
  const trimStart = Math.max(0, Math.min(86_400, finite(raw.trimStart, DEFAULT_RENDER_SETTINGS.trimStart)));
  const rawTrimEndValue = (raw as Record<string, unknown>).trimEnd;
  const rawTrimEnd = rawTrimEndValue === null || rawTrimEndValue === undefined || rawTrimEndValue === ""
    ? null
    : Math.max(0, Math.min(86_400, finite(rawTrimEndValue, 0)));
  return {
    speed: Math.max(0.5, Math.min(3, finite(raw.speed, DEFAULT_RENDER_SETTINGS.speed))),
    enableRandomPanZoom: bool(raw.enableRandomPanZoom, DEFAULT_RENDER_SETTINGS.enableRandomPanZoom),
    useRandomInterval: bool(raw.useRandomInterval, DEFAULT_RENDER_SETTINGS.useRandomInterval),
    minInterval,
    maxInterval,
    interval: Math.max(0.5, Math.min(30, finite(raw.interval, DEFAULT_RENDER_SETTINGS.interval))),
    maxPanX: Math.max(0, Math.min(40, finite(raw.maxPanX, DEFAULT_RENDER_SETTINGS.maxPanX))),
    maxPanY: Math.max(0, Math.min(40, finite(raw.maxPanY, DEFAULT_RENDER_SETTINGS.maxPanY))),
    minScale,
    maxScale,
    mirror: bool(raw.mirror, DEFAULT_RENDER_SETTINGS.mirror),
    colorFilter: oneOf(raw.colorFilter, ["None", "Warm", "Cool", "Vintage", "B&W"] as const, DEFAULT_RENDER_SETTINGS.colorFilter) as RenderColorFilter,
    trimStart,
    trimEnd: rawTrimEnd !== null && rawTrimEnd > trimStart ? rawTrimEnd : null,
    reverse: bool(raw.reverse, DEFAULT_RENDER_SETTINGS.reverse),
    titleText: typeof raw.titleText === "string" ? raw.titleText.trim().slice(0, 240) : DEFAULT_RENDER_SETTINGS.titleText,
    titlePosition: oneOf(raw.titlePosition, ["top", "center", "bottom"] as const, DEFAULT_RENDER_SETTINGS.titlePosition),
    titleFontSize: Math.round(Math.max(18, Math.min(140, finite(raw.titleFontSize, DEFAULT_RENDER_SETTINGS.titleFontSize)))),
    titleColor: oneOf(raw.titleColor, ["white", "yellow", "cyan", "black"] as const, DEFAULT_RENDER_SETTINGS.titleColor),
    watermarkText: typeof raw.watermarkText === "string" ? raw.watermarkText.trim().slice(0, 160) : DEFAULT_RENDER_SETTINGS.watermarkText,
    watermarkSpeed: Math.round(Math.max(20, Math.min(400, finite(raw.watermarkSpeed, DEFAULT_RENDER_SETTINGS.watermarkSpeed)))),
    watermarkFontSize: Math.round(Math.max(12, Math.min(80, finite(raw.watermarkFontSize, DEFAULT_RENDER_SETTINGS.watermarkFontSize)))),
    watermarkColor: oneOf(raw.watermarkColor, ["white", "yellow", "cyan", "red"] as const, DEFAULT_RENDER_SETTINGS.watermarkColor),
    watermarkOpacity: Math.max(0.1, Math.min(1, finite(raw.watermarkOpacity, DEFAULT_RENDER_SETTINGS.watermarkOpacity))),
    logo: oneOf(raw.logo, ["none", "maivideo", "custom"] as const, DEFAULT_RENDER_SETTINGS.logo),
    logoPath: typeof raw.logoPath === "string" && raw.logoPath.startsWith("data/uploads/") ? raw.logoPath : null,
    logoPosition: oneOf(raw.logoPosition, ["top-left", "top-right", "center", "bottom-left", "bottom-right"] as const, DEFAULT_RENDER_SETTINGS.logoPosition),
    logoOpacity: Math.max(0.1, Math.min(1, finite(raw.logoOpacity, DEFAULT_RENDER_SETTINGS.logoOpacity))),
    logoScale: Math.max(0.05, Math.min(0.35, finite(raw.logoScale, DEFAULT_RENDER_SETTINGS.logoScale))),
    visualEffect: oneOf(raw.visualEffect, ["none", "fog", "rain", "fire", "fireflies", "snow"] as const, DEFAULT_RENDER_SETTINGS.visualEffect),
  };
}

function phase() {
  return Math.random() * Math.PI * 2;
}

/**
 * Port of MaiVideo FastEdit's safe random pan/zoom filter. It changes the
 * camera crop inside the existing frame and never changes the video timeline.
 */
export function buildRandomPanZoomFilter(settings: RenderSettings, width: number, height: number, fps = 30) {
  const minInterval = Math.max(0.5, settings.minInterval);
  const maxInterval = Math.max(minInterval + 0.2, settings.maxInterval);
  const fixedInterval = Math.max(0.5, settings.interval);
  const movementPeriod = Math.max(2, settings.useRandomInterval
    ? minInterval + Math.random() * (maxInterval - minInterval)
    : fixedInterval);
  const panX = Math.max(0, Math.min(40, settings.maxPanX));
  const panY = Math.max(0, Math.min(40, settings.maxPanY));
  const minScale = Math.max(1, settings.minScale);
  const maxScale = Math.max(minScale, settings.maxScale);
  const scaleMid = (minScale + maxScale) / 2;
  const scaleAmplitude = (maxScale - minScale) / 2;
  const zoomPeriod = movementPeriod * (0.9 + Math.random() * 0.2);
  const xPeriod = movementPeriod * (0.85 + Math.random() * 0.3);
  const yPeriod = movementPeriod * (0.85 + Math.random() * 0.3);
  const zoomFrames = (Math.max(2, zoomPeriod) * fps).toFixed(4);
  const xFrames = (Math.max(2, xPeriod) * fps).toFixed(4);
  const yFrames = (Math.max(2, yPeriod) * fps).toFixed(4);
  const zoom = `clip(${scaleMid.toFixed(4)}+${scaleAmplitude.toFixed(4)}*sin(2*PI*on/(${zoomFrames})+${phase().toFixed(4)}),${minScale.toFixed(4)},${maxScale.toFixed(4)})`;
  const xWave = `sin(2*PI*on/(${xFrames})+${phase().toFixed(4)})`;
  const yWave = `cos(2*PI*on/(${yFrames})+${phase().toFixed(4)})`;
  const safeX = `min(${(panX / 100).toFixed(4)},max(0,(1-1/zoom)/2-2/iw))`;
  const safeY = `min(${(panY / 100).toFixed(4)},max(0,(1-1/zoom)/2-2/ih))`;
  const x = `floor(clip(iw*(1-1/zoom)/2+iw*${safeX}*${xWave},0,max(0,iw*(1-1/zoom)-2)))`;
  const y = `floor(clip(ih*(1-1/zoom)/2+ih*${safeY}*${yWave},0,max(0,ih*(1-1/zoom)-2)))`;
  return `fps=${fps},setpts=PTS-STARTPTS,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${Math.max(2, width)}x${Math.max(2, height)}:fps=${fps}`;
}

export function normalizeVisualEffect(value: unknown): RenderVisualEffect {
  const normalized = String(value || "none").trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, RenderVisualEffect> = {
    mist: "fog",
    "sương mù": "fog",
    mưa: "rain",
    "ánh lửa": "fire",
    flame: "fire",
    "đom đóm": "fireflies",
    "đom-dom": "fireflies",
    "tuyết": "snow",
  };
  const resolved = aliases[normalized] || normalized;
  return ["none", "fog", "rain", "fire", "fireflies", "snow"].includes(resolved) ? resolved as RenderVisualEffect : "none";
}

/** Build the procedural overlay used by FastEdit, extended with fireflies/snow. */
export function buildProceduralOverlayFilter(effect: RenderVisualEffect, inputLabel: string, outputLabel: string, width: number, height: number, duration: number, fps = 30, overlayLabel = "[storyai_effect_overlay]") {
  const effectKey = normalizeVisualEffect(effect);
  if (effectKey === "none") return [];
  const effectWidth = 320;
  const effectHeight = 180;
  const effectDuration = Math.max(2, Math.min(86_400, Number(duration) || 60));
  const phaseOne = phase().toFixed(6);
  const phaseTwo = phase().toFixed(6);
  let source: string;
  if (effectKey === "fog") {
    source = `color=c=white@0.0:s=${effectWidth}x${effectHeight}:r=${fps}:d=${effectDuration.toFixed(3)},format=rgba,geq=r='255':g='255':b='255':a='clip(68+46*sin(2*PI*N/120+X/95+${phaseOne})+30*cos(2*PI*(Y/120+N/180)+${phaseTwo}),0,145)',gblur=sigma=15`;
  } else if (effectKey === "rain") {
    source = `color=c=black@0.0:s=${effectWidth}x${effectHeight}:r=${fps}:d=${effectDuration.toFixed(3)},format=rgba,geq=r='190':g='220':b='255':a='if(lt(mod(X*0.35-Y+N*14+${phaseOne},83),1.5),155,if(lt(mod(X*0.18-Y+N*10+${phaseTwo},67),1.0),95,0))',gblur=sigma=0.7`;
  } else if (effectKey === "fire") {
    source = `color=c=black@0.0:s=${effectWidth}x${effectHeight}:r=${fps}:d=${effectDuration.toFixed(3)},format=rgba,geq=r='255':g='clip(145+80*sin(2*PI*(X/120+N/180)+${phaseOne})+40*cos(2*PI*(Y/90-N/100)+${phaseTwo}),0,255)':b='clip(18+30*sin(2*PI*(X/80-N/90)+${phaseTwo}),0,255)':a='if(gt(Y/H,0.30),clip(170*(1-(Y/H-0.30)/0.70)*(0.7+0.3*sin(2*PI*(X/115+N/110)+${phaseOne})),0,190),0)',gblur=sigma=10`;
  } else if (effectKey === "fireflies") {
    source = `color=c=black@0.0:s=${effectWidth}x${effectHeight}:r=${fps}:d=${effectDuration.toFixed(3)},format=rgba,geq=r='255':g='214':b='90':a='if(lt(mod(X*0.37+Y*0.19+N*4+${phaseOne},97),1.2),clip(170+70*sin(N/18+X/40),0,255),if(lt(mod(X*0.12-Y*0.31+N*2+${phaseTwo},149),0.8),90,0))',gblur=sigma=2`;
  } else {
    source = `color=c=black@0.0:s=${effectWidth}x${effectHeight}:r=${fps}:d=${effectDuration.toFixed(3)},format=rgba,geq=r='255':g='255':b='255':a='if(lt(mod(X*0.41+Y*0.23+N*2+${phaseOne},37),1.4),clip(120+80*sin(N/23+X/45),0,230),if(lt(mod(X*0.19-Y*0.27+N*1.3+${phaseTwo},71),0.8),90,0))',gblur=sigma=1.2`;
  }
  return [`${source},scale=${Math.max(2, Math.round(width))}:${Math.max(2, Math.round(height))}:flags=bilinear${overlayLabel}`, `${inputLabel}${overlayLabel}overlay=eof_action=repeat:format=auto${outputLabel}`];
}

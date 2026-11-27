import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { chromium } from "playwright-core";
import { autoEditFfmpeg } from "./auto-edit-media";
import {
  computeCreateVideoTimeline,
  type ComputedCreateVideoTimeline,
  type CreateVideoJob,
} from "./motion-video";
import {
  createVideoJobDir,
  createVideoOwnerFolder,
  resolveCreateVideoBrowser,
} from "./motion-video-ingest";
import {
  claimCreateVideoRenderLock,
  clearCreateVideoRenderPending,
  getCreateVideoJob,
  updateCreateVideoJob,
} from "./motion-video-worker";
import { ensureOverlayFonts, overlayEmojiFontFile, overlayTextFontFile } from "./overlay-fonts";

const exec = promisify(execFile);

/**
 * Iterative Batched Audio Mixer:
 * Mixes SFX cues in batches of 24 directly onto the full bed so no SFX tail is chopped at window boundaries.
 */
async function buildMixedMotionAudio(
  job: CreateVideoJob,
  timeline: ComputedCreateVideoTimeline,
  jobDir: string,
  workDir: string,
): Promise<string> {
  const outWav = path.join(workDir, "master_audio.wav");
  const totalSec = Math.max(1, timeline.totalDurationMs / 1000).toFixed(3);
  const voicePath = path.join(jobDir, "audio", "narration.wav");
  const hasVoiceFile = job.audio?.hasVoiceover
    ? await access(voicePath, constants.R_OK).then(() => true).catch(() => false)
    : false;

  const sfxRoot = path.join(process.cwd(), "assets", "sfx");
  const validSfx: Array<{ filePath: string; delayMs: number; volumeDb: number }> = [];
  for (const ev of timeline.sfxEvents) {
    const candidate = path.join(sfxRoot, ev.filename);
    const exists = await access(candidate, constants.R_OK).then(() => true).catch(() => false);
    if (exists) {
      validSfx.push({ filePath: candidate, delayMs: Math.max(0, Math.round(ev.timelineMs)), volumeDb: ev.volumeDb });
    }
  }

  const baseBedPath = path.join(workDir, "base_bed.wav");
  if (hasVoiceFile) {
    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", voicePath,
        "-af", `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad=whole_dur=${totalSec}`,
        "-t", totalSec,
        "-c:a", "pcm_s16le",
        baseBedPath,
      ],
      { timeout: 180_000 },
    );
  } else {
    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi",
        "-t", totalSec,
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-c:a", "pcm_s16le",
        baseBedPath,
      ],
      { timeout: 60_000 },
    );
  }

  if (!validSfx.length) {
    return baseBedPath;
  }

  const batchSize = 24;
  let currentBedPath = baseBedPath;
  const totalBatches = Math.ceil(validSfx.length / batchSize);

  for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
    const batch = validSfx.slice(bIdx * batchSize, (bIdx + 1) * batchSize);
    const isLastBatch = bIdx === totalBatches - 1;
    const nextPath = isLastBatch ? outWav : path.join(workDir, `mix_batch_${bIdx}.wav`);

    const inputArgs: string[] = ["-i", currentBedPath];
    const filterParts: string[] = ["[0:a]volume=1.0[bed]"];
    const mixInputs: string[] = ["[bed]"];

    batch.forEach((sfx, idx) => {
      const inIdx = idx + 1;
      inputArgs.push("-i", sfx.filePath);
      const label = `s${inIdx}`;
      filterParts.push(
        `[${inIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${sfx.volumeDb.toFixed(1)}dB,adelay=${sfx.delayMs}|${sfx.delayMs}[${label}]`,
      );
      mixInputs.push(`[${label}]`);
    });

    filterParts.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.92[aout]`,
    );

    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[aout]",
        "-t", totalSec,
        "-c:a", "pcm_s16le",
        nextPath,
      ],
      { timeout: 240_000, maxBuffer: 8_000_000 },
    );

    if (currentBedPath !== baseBedPath) {
      await rm(currentBedPath, { force: true }).catch(() => undefined);
    }
    currentBedPath = nextPath;
  }

  return currentBedPath;
}

function buildStageHtml(payloadJson: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "StoryAINoto";
    src: url("http://motion-stage.local/fonts/text.ttf") format("truetype");
    font-weight: 100 900;
  }
  @font-face {
    font-family: "StoryAIEmoji";
    src: url("http://motion-stage.local/fonts/emoji.ttf") format("truetype");
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    overflow: hidden;
    background: #050814;
    font-family: "StoryAINoto", "StoryAIEmoji", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
</style>
<script src="http://motion-stage.local/vendor/gsap.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="module">
import * as THREE from "http://motion-stage.local/vendor/three.module.js";

const DATA = ${payloadJson};
const W = DATA.width;
const H = DATA.height;
const FPS = DATA.fps;
const isPortrait = H > W;

document.body.style.width = W + "px";
document.body.style.height = H + "px";
const root = document.getElementById("root");
root.style.position = "relative";
root.style.width = W + "px";
root.style.height = H + "px";
root.style.overflow = "hidden";

const bgWrap = document.createElement("div");
bgWrap.style.cssText = "position:absolute;inset:0;overflow:hidden";
const webglCanvas = document.createElement("canvas");
webglCanvas.width = W;
webglCanvas.height = H;
webglCanvas.style.cssText = "width:100%;height:100%;display:block";
bgWrap.appendChild(webglCanvas);
root.appendChild(bgWrap);

const svgFilterWrap = document.createElement("div");
root.appendChild(svgFilterWrap);

const carrier = document.createElement("div");
carrier.style.cssText = "position:absolute;inset:0;will-change:transform,opacity";
root.appendChild(carrier);

const captionWrap = document.createElement("div");
root.appendChild(captionWrap);

const PALETTE = {
  "midnight-cyan": { bgA:"#040814", bgB:"#0b1933", glowA:"rgba(56,189,248,0.36)", glowB:"rgba(99,102,241,0.34)", meshA:0x38bdf8, meshB:0x818cf8, grid:0x1e3a5f },
  "aurora-violet": { bgA:"#090518", bgB:"#1a103d", glowA:"rgba(167,139,250,0.38)", glowB:"rgba(244,114,182,0.30)", meshA:0xa78bfa, meshB:0xf472b6, grid:0x312063 },
  "emerald-tech": { bgA:"#03110d", bgB:"#082822", glowA:"rgba(52,211,153,0.35)", glowB:"rgba(56,189,248,0.28)", meshA:0x34d399, meshB:0x38bdf8, grid:0x114237 },
  "crimson-energy": { bgA:"#14050b", bgB:"#2b0c19", glowA:"rgba(251,113,133,0.38)", glowB:"rgba(251,191,36,0.30)", meshA:0xfb7185, meshB:0xfbbf24, grid:0x4c1729 },
  "amber-editorial": { bgA:"#120d05", bgB:"#261b0a", glowA:"rgba(251,191,36,0.34)", glowB:"rgba(56,189,248,0.24)", meshA:0xfbbf24, meshB:0x38bdf8, grid:0x423012 },
  "slate-minimal": { bgA:"#070a12", bgB:"#131b2e", glowA:"rgba(148,163,184,0.26)", glowB:"rgba(99,102,241,0.22)", meshA:0x94a3b8, meshB:0x6366f1, grid:0x243049 }
};

function accentHex(c) {
  if (c === "emerald") return "#34d399";
  if (c === "rose") return "#fb7185";
  if (c === "cyan") return "#38bdf8";
  if (c === "violet") return "#a78bfa";
  return "#fbbf24";
}
function statNumHex(c) {
  if (c === "emerald") return 0x34d399;
  if (c === "rose") return 0xfb7185;
  if (c === "cyan") return 0x38bdf8;
  if (c === "violet") return 0xa78bfa;
  return 0xfbbf24;
}
function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function clamp01(v) { return Math.min(1, Math.max(0, v)); }

const easePower4In = window.gsap.parseEase("power4.in");
const easePower4Out = window.gsap.parseEase("power4.out");
const easeBackOut = window.gsap.parseEase("back.out(1.55)");
const easeExpoOut = window.gsap.parseEase("expo.out");
const easePower3InOut = window.gsap.parseEase("power3.inOut");
const easePower2In = window.gsap.parseEase("power2.in");

function gsapNudgeCurve(t) {
  const p = clamp01(t);
  if (p < 0.1) return easePower2In(p / 0.1) * 0.08;
  if (p < 0.75) return 0.08 + easePower3InOut((p - 0.1) / 0.65) * 0.82;
  return 0.9 + easeExpoOut((p - 0.75) / 0.25) * 0.1;
}

let threeCtx = null;
try {
  const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 60);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.55);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xfbbf24, 0.95);
  rimLight.position.set(-4, -2, 4);
  scene.add(rimLight);
  const gridHelper = new THREE.GridHelper(22, 22, 0x38bdf8, 0x1e3a5f);
  gridHelper.position.set(0, -2.55, -2.5);
  scene.add(gridHelper);
  const heroPrism = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 0), new THREE.MeshStandardMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.34 }));
  scene.add(heroPrism);
  const accentTorus = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 14, 36), new THREE.MeshStandardMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.3 }));
  scene.add(accentTorus);
  const particles = [];
  for (let i = 0; i < 22; i++) {
    const sc = 0.04 + (i % 4) * 0.022;
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(sc, 0), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.55, transparent: true, opacity: 0.58 }));
    scene.add(mesh);
    particles.push({ mesh, baseX: ((i * 41) % 100) / 11 - 4.5, baseY: ((i * 59) % 100) / 13 - 3.8, baseZ: -1.2 - ((i * 31) % 50) / 10, speed: 0.35 + (i % 5) * 0.14 });
  }
  const barsGroup = new THREE.Group();
  const barMeshes = [];
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1, 0.68), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.25, metalness: 0.55, transparent: true, opacity: 0.48 }));
    barsGroup.add(bar);
    barMeshes.push(bar);
  }
  scene.add(barsGroup);
  threeCtx = { renderer, scene, camera, rimLight, gridHelper, heroPrism, accentTorus, particles, barsGroup, barMeshes };
} catch (e) {
  threeCtx = null;
}

const preloadedImages = new Map();
await Promise.all(Object.entries(DATA.imageUrls).map(([id, url]) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => { preloadedImages.set(id, url); resolve(true); };
  img.onerror = () => resolve(false);
  img.src = url;
})));
if (document.fonts && document.fonts.ready) {
  await document.fonts.ready;
}

const hlMap = new Map();
for (const h of DATA.keywordHighlights) {
  hlMap.set(String(h.word || "").trim().toLowerCase(), h);
}

window.__seekMotionFrame = function(frame) {
  const timeMs = (frame / FPS) * 1000;
  const timeSec = frame / FPS;
  const activeScene = DATA.scenes.find((s) => timeMs >= s.timelineStartMs && timeMs < s.timelineEndMs) || DATA.scenes[DATA.scenes.length - 1];
  if (!activeScene) return;

  const localMs = Math.max(0, timeMs - activeScene.timelineStartMs);
  const durMs = Math.max(500, activeScene.timelineEndMs - activeScene.timelineStartMs);
  const progress = clamp01(localMs / durMs);
  const enter = clamp01(localMs / 360);
  const cfg = PALETTE[activeScene.palette] || PALETTE["midnight-cyan"];
  const shiftX = Math.round((progress - 0.5) * 26);
  const shiftY = Math.round((0.5 - progress) * 20);

  bgWrap.style.background =
    "radial-gradient(circle at " + (26 + shiftX) + "% " + (24 + shiftY) + "%, " + cfg.glowA + ", transparent 54%)," +
    "radial-gradient(circle at " + (76 - shiftX) + "% " + (74 - shiftY) + "%, " + cfg.glowB + ", transparent 56%)," +
    "linear-gradient(145deg, " + cfg.bgA + " 0%, " + cfg.bgB + " 56%, " + cfg.bgA + " 100%)";

  if (threeCtx) {
    const domVec = DATA.dominantVector;
    const camX = domVec === "left" ? (0.5 - progress) * 0.75 : (progress - 0.5) * 0.35;
    const camY = domVec === "up" ? (progress - 0.5) * 0.55 : 0.15;
    const camZ = domVec === "z-push" ? 5.4 - progress * 0.85 : domVec === "z-pull" ? 4.6 + progress * 0.75 : 5.1;
    threeCtx.camera.position.set(camX, camY, camZ);
    threeCtx.camera.lookAt(0, 0, -1.2);
    threeCtx.heroPrism.material.color.setHex(cfg.meshA);
    threeCtx.accentTorus.material.color.setHex(cfg.meshB);
    threeCtx.rimLight.color.setHex(cfg.meshB);
    const spreadX = isPortrait ? 1.85 : 3.15;
    threeCtx.heroPrism.position.set(-spreadX, 1.65 - progress * 0.35, -1.5);
    threeCtx.heroPrism.rotation.set(timeSec * 0.42, timeSec * 0.62, 0.18);
    threeCtx.accentTorus.position.set(spreadX, -1.55 + progress * 0.35, -1.7);
    threeCtx.accentTorus.rotation.set(timeSec * 0.5, -timeSec * 0.38, 0.4);
    threeCtx.gridHelper.visible = activeScene.kind === "stat_counter_3d" || activeScene.kind === "browser_3d_showcase";
    threeCtx.gridHelper.position.z = -2.5 + ((timeSec * 0.85) % 1);
    for (let i = 0; i < threeCtx.particles.length; i++) {
      const p = threeCtx.particles[i];
      const tz = ((p.baseZ + timeSec * p.speed * 1.4) % 5.5) - 4.2;
      p.mesh.position.set(p.baseX * (isPortrait ? 0.68 : 1), p.baseY, tz);
      p.mesh.rotation.set(timeSec * 0.65 + i, timeSec * 0.45, 0);
      p.mesh.material.color.setHex(i % 2 === 0 ? cfg.meshA : cfg.meshB);
      p.mesh.material.emissive.setHex(i % 2 === 0 ? cfg.meshA : cfg.meshB);
    }
    if (activeScene.kind === "stat_counter_3d" && activeScene.stats && activeScene.stats.length > 0) {
      threeCtx.barsGroup.visible = true;
      const cnt = Math.min(4, activeScene.stats.length);
      const maxV = Math.max(1, ...activeScene.stats.slice(0, cnt).map((s) => Math.abs(s.value)));
      const riseP = clamp01(progress / 0.52);
      const easedRise = 1 - Math.pow(1 - riseP, 3);
      const sp = isPortrait ? 0.95 : 1.35;
      for (let i = 0; i < threeCtx.barMeshes.length; i++) {
        const m = threeCtx.barMeshes[i];
        if (i >= cnt) { m.visible = false; continue; }
        m.visible = true;
        const it = activeScene.stats[i];
        const h = Math.max(0.12, (0.55 + (Math.abs(it.value) / maxV) * 2.15) * easedRise);
        m.scale.set(1, h, 1);
        m.position.set((i - (cnt - 1) / 2) * sp, -2.35 + h / 2, -1.6);
        m.rotation.set(0, -0.28 + progress * 0.36, 0);
        m.material.color.setHex(statNumHex(it.color));
      }
    } else {
      threeCtx.barsGroup.visible = false;
    }
    threeCtx.renderer.render(threeCtx.scene, threeCtx.camera);
  }

  let tx = 0, ty = 0, sc = 1, op = 1, bx = 0, by = 0;
  if (activeScene.seamIn && localMs < activeScene.seamIn.durationMs) {
    const p = clamp01(localMs / Math.max(180, activeScene.seamIn.durationMs));
    const inv = 1 - easePower4Out(p);
    const v = activeScene.seamIn.vector;
    if (activeScene.seamIn.technique === "inverse-zoom" || v === "z-pull") { sc *= 1 + 0.28 * inv; if (DATA.motionBlur) bx = by = inv * 9; }
    else if (activeScene.seamIn.technique === "zoom-through" || v === "z-push") { sc *= 1 - 0.24 * inv; if (DATA.motionBlur) bx = by = inv * 9; }
    else if (v === "up") { ty += H * 0.15 * inv; if (DATA.motionBlur) by = inv * 16; }
    else { tx += W * 0.14 * inv; if (DATA.motionBlur) bx = inv * 18; }
    op = clamp01(0.35 + p * 1.35);
  }
  const remMs = durMs - localMs;
  if (activeScene.seamOut && remMs <= activeScene.seamOut.durationMs) {
    const p = clamp01(1 - remMs / Math.max(180, activeScene.seamOut.durationMs));
    const curve = easePower4In(p);
    const v = activeScene.seamOut.vector;
    if (activeScene.seamOut.technique === "inverse-zoom" || v === "z-pull") { sc *= 1 - 0.24 * curve; if (DATA.motionBlur) { bx = Math.max(bx, curve * 9); by = Math.max(by, curve * 9); } }
    else if (activeScene.seamOut.technique === "zoom-through" || v === "z-push") { sc *= 1 + 0.30 * curve; if (DATA.motionBlur) { bx = Math.max(bx, curve * 9); by = Math.max(by, curve * 9); } }
    else if (v === "up") { ty -= H * 0.15 * curve; if (DATA.motionBlur) by = Math.max(by, curve * 16); }
    else { tx -= W * 0.14 * curve; if (DATA.motionBlur) bx = Math.max(bx, curve * 18); }
  }

  if (bx > 0.7 || by > 0.7) {
    svgFilterWrap.innerHTML = '<svg width="0" height="0" style="position:absolute"><defs><filter id="mblur"><feGaussianBlur in="SourceGraphic" stdDeviation="' + bx.toFixed(1) + ',' + by.toFixed(1) + '" /></filter></defs></svg>';
    carrier.style.filter = "url(#mblur)";
  } else {
    svgFilterWrap.innerHTML = "";
    carrier.style.filter = "";
  }
  carrier.style.transform = "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0) scale(" + sc.toFixed(4) + ")";
  carrier.style.opacity = op.toFixed(3);

  const accent = accentHex(activeScene.accentColor);
  const sidePad = isPortrait ? 58 : 110;
  const bottomPad = isPortrait && DATA.safeZoneGuard ? Math.round(H * 0.2) : Math.round(H * 0.11);

  if (activeScene.kind === "chapter_card") {
    const chapNum = String((activeScene.chapterIndex || 0) + 1).padStart(2, "0");
    const badgeIn = easeBackOut(clamp01(localMs / 340));
    const titleIn = easeExpoOut(clamp01((localMs - 90) / 480));
    const lineWipe = Math.round(easeExpoOut(clamp01((localMs - 220) / 620)) * (isPortrait ? 58 : 42));
    carrier.innerHTML =
      '<div style="position:absolute;inset:0;padding:' + Math.round(H * 0.12) + 'px ' + sidePad + 'px ' + bottomPad + 'px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">' +
        '<div style="position:absolute;font-size:' + (isPortrait ? 270 : 340) + 'px;font-weight:900;line-height:0.9;color:' + accent + '16;transform:scale(' + (0.92 + 0.1 * progress).toFixed(3) + ')">' + chapNum + '</div>' +
        '<div style="position:relative;z-index:2;padding:8px 22px;border-radius:999px;background:' + accent + '26;border:1.5px solid ' + accent + ';color:' + accent + ';font-weight:900;font-size:' + (isPortrait ? 20 : 18) + 'px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:22px;transform:translateY(' + ((1 - badgeIn) * 26).toFixed(1) + 'px)">' + esc(activeScene.badge || ("CHƯƠNG " + chapNum)) + '</div>' +
        '<h2 style="position:relative;z-index:2;font-size:' + (isPortrait ? 58 : 66) + 'px;font-weight:900;color:#fff;line-height:1.12;max-width:' + (isPortrait ? '92%' : '82%') + ';opacity:' + clamp01(titleIn * 1.4).toFixed(2) + ';transform:translateY(' + ((1 - titleIn) * 34).toFixed(1) + 'px)">' + esc(activeScene.headline) + '</h2>' +
        '<div style="position:relative;z-index:2;margin-top:26px;height:6px;width:' + lineWipe + '%;border-radius:99px;background:linear-gradient(90deg,transparent,' + accent + ',#fff,transparent)"></div>' +
        (activeScene.subheadline ? '<p style="position:relative;z-index:2;margin-top:24px;max-width:' + (isPortrait ? '88%' : '68%') + ';font-size:' + (isPortrait ? 26 : 25) + 'px;line-height:1.42;font-weight:600;color:#cbd5e1;opacity:' + clamp01((localMs - 300) / 380).toFixed(2) + '">' + esc(activeScene.subheadline) + '</p>' : '') +
      '</div>';
  } else if (activeScene.kind === "kinetic_hook") {
    const words = String(activeScene.headline || "").split(/\\s+/u).filter(Boolean);
    const delay = Math.min(58, Math.floor(420 / Math.max(1, words.length)));
    const badgeHtml = activeScene.badge
      ? '<div style="padding:8px 20px;border-radius:999px;background:' + accent + '24;border:1.5px solid ' + accent + ';color:' + accent + ';font-weight:900;font-size:' + (isPortrait ? 20 : 18) + 'px;text-transform:uppercase;margin-bottom:24px;opacity:' + clamp01(localMs / 240).toFixed(2) + ';transform:translateY(' + ((1 - easeBackOut(clamp01(localMs / 320))) * 24).toFixed(1) + 'px)">' + (activeScene.emoji ? esc(activeScene.emoji) + ' ' : '') + esc(activeScene.badge) + '</div>'
      : '';
    const wordsHtml = words.map((w, idx) => {
      const wP = clamp01(Math.max(0, localMs - 70 - idx * delay) / 380);
      const ez = easeBackOut(wP);
      const isHl = idx >= words.length - 2;
      return '<span style="display:inline-block;font-size:' + (isPortrait ? 66 : 76) + 'px;font-weight:900;line-height:1.08;color:' + (isHl ? accent : '#fff') + ';text-shadow:0 10px 30px rgba(0,0,0,.65);opacity:' + clamp01(wP * 1.5).toFixed(2) + ';transform:translateY(' + ((1 - ez) * 52).toFixed(1) + 'px) scale(' + (0.84 + 0.16 * ez).toFixed(3) + ')">' + esc(w) + '</span>';
    }).join('');
    const subHtml = activeScene.subheadline
      ? '<p style="margin-top:28px;max-width:' + (isPortrait ? '88%' : '70%') + ';font-size:' + (isPortrait ? 27 : 26) + 'px;line-height:1.42;font-weight:600;color:#cbd5e1;opacity:' + clamp01((localMs - 340) / 360).toFixed(2) + '">' + esc(activeScene.subheadline) + '</p>'
      : '';
    carrier.innerHTML = '<div style="position:absolute;inset:0;padding:' + Math.round(H * 0.12) + 'px ' + sidePad + 'px ' + bottomPad + 'px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">' + badgeHtml + '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:' + (isPortrait ? '12px 16px' : '14px 20px') + ';max-width:' + (isPortrait ? '94%' : '84%') + '">' + wordsHtml + '</div>' + subHtml + '</div>';
  } else if (activeScene.kind === "browser_3d_showcase") {
    const imgUrl = activeScene.imageId ? preloadedImages.get(activeScene.imageId) : null;
    const rotY = (-10 + progress * 15).toFixed(2);
    const rotX = (6 - progress * 8).toFixed(2);
    const cScale = (0.9 + 0.1 * easeBackOut(enter)).toFixed(3);
    const s0 = activeScene.scrollStart ?? 0;
    const s1 = activeScene.scrollEnd ?? 0.55;
    const scrollPct = ((s0 + (s1 - s0) * easePower3InOut(progress)) * 100).toFixed(2);
    const bodyHtml = imgUrl
      ? '<img src="' + imgUrl + '" style="width:100%;height:auto;min-height:100%;object-fit:cover;transform:translateY(-' + scrollPct + '%);display:block" />'
      : '<div style="padding:42px;height:100%;display:flex;flex-direction:column;justify-content:center;gap:20px;background:#0f172a"><div style="width:140px;height:12px;border-radius:99px;background:' + accent + '"></div><div style="font-size:34px;font-weight:800;color:#f8fafc;line-height:1.3">' + esc(activeScene.subheadline || activeScene.narrationText) + '</div></div>';
    let annHtml = "";
    const ann = activeScene.annotation;
    if (ann && ann.kind && ann.kind !== "none" && localMs >= 520) {
      const el = localMs - 520;
      const cx = Math.round((ann.targetX || 0.52) * W);
      const cy = Math.round((ann.targetY || 0.48) * H);
      if (ann.kind === "oversized_cursor") {
        const gl = easeExpoOut(clamp01(el / 560));
        const sx = W * 0.84, sy = H * 0.82;
        const curX = sx + (cx - sx) * gl, curY = sy + (cy - sy) * gl;
        const ce = el - 540;
        const ripP = clamp01(ce / 520);
        if (ce > 0 && ripP < 1) {
          annHtml += '<div style="position:absolute;left:' + (cx - 54) + 'px;top:' + (cy - 54) + 'px;width:108px;height:108px;border-radius:50%;border:3.5px solid ' + accent + ';opacity:' + ((1 - ripP) * 0.9).toFixed(2) + ';transform:scale(' + (0.35 + ripP * 1.45).toFixed(2) + ')"></div>';
        }
        if (ann.label && ce > 80) {
          annHtml += '<div style="position:absolute;left:' + Math.min(W - 260, Math.max(24, cx - 90)) + 'px;top:' + Math.max(24, cy - 66) + 'px;padding:7px 16px;border-radius:999px;background:' + accent + ';color:#090d16;font-weight:900;font-size:17px">✦ ' + esc(ann.label) + '</div>';
        }
        annHtml += '<svg width="68" height="68" viewBox="0 0 48 48" style="position:absolute;left:' + (curX - 8).toFixed(1) + 'px;top:' + (curY - 6).toFixed(1) + 'px;filter:drop-shadow(0 12px 22px rgba(0,0,0,.65))"><path d="M8 5 L38 22 L24 25 L31 40 L24 43 L17 28 L8 36 Z" fill="#fff" stroke="#090d16" stroke-width="3.2" stroke-linejoin="round"/></svg>';
      } else if (ann.kind === "highlighter") {
        const bw = Math.round((ann.targetW || 0.36) * W), bh = Math.round((ann.targetH || 0.1) * H);
        const wp = easeExpoOut(clamp01(el / 340)).toFixed(3);
        annHtml += '<div style="position:absolute;left:' + (cx - Math.round(bw / 2)) + 'px;top:' + (cy - Math.round(bh / 2)) + 'px;width:' + bw + 'px;height:' + bh + 'px;border-radius:10px;background:' + accent + '99;transform:skewX(-8deg) scaleX(' + wp + ');transform-origin:0% 50%"></div>';
      } else if (ann.kind === "spotlight_box") {
        const bw = Math.round((ann.targetW || 0.36) * W), bh = Math.round((ann.targetH || 0.14) * H);
        const x0 = Math.max(20, cx - Math.round(bw / 2));
        const y0 = Math.max(20, cy - Math.round(bh / 2));
        const rx = 18;
        const perim = 2 * (bw + bh);
        const drawT = clamp01(el / 380);
        const dashOff = Math.round(perim * (1 - drawT));
        annHtml += '<svg width="' + W + '" height="' + H + '" style="position:absolute;inset:0;pointer-events:none;z-index:22"><rect x="' + x0 + '" y="' + y0 + '" width="' + bw + '" height="' + bh + '" rx="' + rx + '" ry="' + rx + '" fill="none" stroke="' + accent + '" stroke-width="5" stroke-dasharray="' + perim + '" stroke-dashoffset="' + dashOff + '" style="filter:drop-shadow(0 0 14px ' + accent + ')" /></svg>';
        if (ann.label) {
          annHtml += '<div style="position:absolute;left:' + x0 + 'px;top:' + Math.max(18, y0 - 42) + 'px;padding:5px 14px;border-radius:999px;background:' + accent + ';color:#090d16;font-weight:900;font-size:16px;z-index:22">' + esc(ann.label) + '</div>';
        }
      } else if (ann.kind === "freeze_hud") {
        const flashA = Math.max(0, 1 - el / 200) * 0.65;
        const pad = Math.round(Math.min(W, H) * 0.055);
        const arm = 36;
        if (flashA > 0.01) {
          annHtml += '<div style="position:absolute;inset:0;background:rgba(255,255,255,' + flashA.toFixed(3) + ');pointer-events:none;z-index:23"></div>';
        }
        const bracketsD = 'M ' + pad + ' ' + (pad + arm) + ' V ' + pad + ' H ' + (pad + arm) +
          ' M ' + (W - pad - arm) + ' ' + pad + ' H ' + (W - pad) + ' V ' + (pad + arm) +
          ' M ' + pad + ' ' + (H - pad - arm) + ' V ' + (H - pad) + ' H ' + (pad + arm) +
          ' M ' + (W - pad - arm) + ' ' + (H - pad) + ' H ' + (W - pad) + ' V ' + (H - pad - arm);
        annHtml += '<svg width="' + W + '" height="' + H + '" style="position:absolute;inset:0;pointer-events:none;z-index:23"><path d="' + bracketsD + '" fill="none" stroke="' + accent + '" stroke-width="4" stroke-linecap="round" /></svg>';
      }
    }
    carrier.innerHTML =
      '<div style="position:absolute;inset:0;padding:' + (isPortrait ? 86 : 56) + 'px ' + sidePad + 'px ' + (bottomPad + 24) + 'px;display:flex;flex-direction:column;align-items:center;gap:22px">' +
        '<div style="text-align:center;max-width:92%">' +
          (activeScene.badge ? '<span style="display:inline-block;padding:5px 14px;border-radius:999px;background:' + accent + ';color:#090d16;font-weight:900;font-size:14px;text-transform:uppercase;margin-bottom:10px">' + esc(activeScene.badge) + '</span>' : '') +
          '<h2 style="font-size:' + (isPortrait ? 42 : 44) + 'px;font-weight:900;color:#fff;line-height:1.15">' + esc(activeScene.headline) + '</h2>' +
        '</div>' +
        '<div style="position:relative;width:' + (isPortrait ? '94%' : '78%') + ';flex:1;max-height:' + (isPortrait ? 920 : 620) + 'px;border-radius:24px;background:rgba(15,23,42,.92);border:2px solid ' + accent + '88;box-shadow:0 36px 80px rgba(0,0,0,.72);overflow:hidden;display:flex;flex-direction:column;transform:perspective(1350px) rotateY(' + rotY + 'deg) rotateX(' + rotX + 'deg) scale(' + cScale + ')">' +
          '<div style="height:44px;padding:0 18px;background:rgba(9,13,24,.95);display:flex;align-items:center;gap:10px"><span style="width:12px;height:12px;border-radius:50%;background:#fb7185"></span><span style="width:12px;height:12px;border-radius:50%;background:#fbbf24"></span><span style="width:12px;height:12px;border-radius:50%;background:#34d399"></span></div>' +
          '<div style="position:relative;flex:1;overflow:hidden;background:#0b1120">' + bodyHtml + '</div>' +
        '</div>' +
        annHtml +
      '</div>';
  } else if (activeScene.kind === "stat_counter_3d") {
    const items = (activeScene.stats && activeScene.stats.length) ? activeScene.stats : [{ label: "Hiệu suất", value: 300, suffix: "%", color: activeScene.accentColor }];
    const countP = easeExpoOut(clamp01((localMs - 140) / 1150));
    const cardsHtml = items.slice(0, 3).map((st, idx) => {
      const sh = accentHex(st.color || activeScene.accentColor);
      const val = Number.isInteger(st.value) ? Math.round(st.value * countP) : Number((st.value * countP).toFixed(1));
      const cin = easeBackOut(clamp01((localMs - idx * 120) / 420));
      return '<div style="padding:28px;border-radius:24px;background:rgba(15,23,42,.86);border:2px solid ' + sh + '88;text-align:center;transform:translateY(' + ((1 - cin) * 38).toFixed(1) + 'px)"><div style="font-size:' + (isPortrait ? 64 : 68) + 'px;font-weight:900;color:' + sh + '">' + esc(st.prefix || '') + val.toLocaleString("en-US") + esc(st.suffix || '') + '</div><div style="margin-top:10px;font-size:22px;font-weight:700;color:#f1f5f9">' + esc(st.label) + '</div></div>';
    }).join('');
    carrier.innerHTML = '<div style="position:absolute;inset:0;padding:' + (isPortrait ? 110 : 72) + 'px ' + sidePad + 'px ' + (bottomPad + 36) + 'px;display:flex;flex-direction:column;justify-content:space-between;align-items:center"><div style="text-align:center;max-width:90%"><h2 style="font-size:' + (isPortrait ? 48 : 52) + 'px;font-weight:900;color:#fff">' + esc(activeScene.headline) + '</h2></div><div style="display:grid;grid-template-columns:' + (isPortrait ? '1fr' : 'repeat(' + Math.min(3, items.length) + ',minmax(0,1fr))') + ';gap:22px;width:' + (isPortrait ? '90%' : '86%') + '">' + cardsHtml + '</div></div>';
  } else if (activeScene.kind === "comparison_split") {
    const rows = (activeScene.comparisons && activeScene.comparisons.length) ? activeScene.comparisons : [{ leftLabel: "Thao tác thủ công", rightLabel: "Tự động hoá 3D" }];
    const sp = gsapNudgeCurve(clamp01(localMs / 580));
    const leftRows = rows.map((r) => '<div style="padding:14px 18px;border-radius:14px;background:rgba(255,255,255,.05);color:#e2e8f0;font-size:22px;font-weight:600">' + esc(r.leftLabel) + '</div>').join('');
    const rightRows = rows.map((r) => '<div style="padding:14px 18px;border-radius:14px;background:' + accent + '1c;border:1px solid ' + accent + '44;color:#fff;font-size:22px;font-weight:800">' + esc(r.rightLabel) + '</div>').join('');
    carrier.innerHTML = '<div style="position:absolute;inset:0;padding:' + (isPortrait ? 96 : 64) + 'px ' + sidePad + 'px ' + (bottomPad + 28) + 'px;display:flex;flex-direction:column;justify-content:center;gap:28px"><h2 style="text-align:center;font-size:' + (isPortrait ? 46 : 48) + 'px;font-weight:900;color:#fff">' + esc(activeScene.headline) + '</h2><div style="display:grid;grid-template-columns:' + (isPortrait ? '1fr' : '1fr 1fr') + ';gap:24px"><div style="padding:28px;border-radius:24px;background:rgba(30,16,28,.86);border:1.5px solid rgba(251,113,133,.45);transform:translateX(' + ((1 - sp) * -60).toFixed(1) + 'px)"><div style="font-size:18px;font-weight:900;color:#fb7185;text-transform:uppercase;margin-bottom:16px">✕ ' + esc(activeScene.leftTitle || "Trước đây") + '</div><div style="display:grid;gap:14px">' + leftRows + '</div></div><div style="padding:28px;border-radius:24px;background:rgba(10,32,36,.9);border:2px solid ' + accent + ';transform:translateX(' + ((1 - sp) * 60).toFixed(1) + 'px)"><div style="font-size:18px;font-weight:900;color:' + accent + ';text-transform:uppercase;margin-bottom:16px">✓ ' + esc(activeScene.rightTitle || "Giải pháp mới") + '</div><div style="display:grid;gap:14px">' + rightRows + '</div></div></div></div>';
  } else if (activeScene.kind === "quote_editorial") {
    const q = activeScene.subheadline || activeScene.narrationText || activeScene.headline;
    const wp = Math.round(easeExpoOut(clamp01((localMs - 380) / 560)) * 68);
    carrier.innerHTML = '<div style="position:absolute;inset:0;padding:' + Math.round(H * 0.14) + 'px ' + (sidePad + 16) + 'px ' + (bottomPad + 30) + 'px;display:flex;flex-direction:column;justify-content:center"><div style="padding:48px;border-radius:28px;background:rgba(15,23,42,.88);border-left:8px solid ' + accent + '"><div style="font-size:82px;line-height:0.7;font-weight:900;color:' + accent + '66;margin-bottom:18px">“</div><div style="font-size:' + (isPortrait ? 38 : 42) + 'px;font-weight:800;color:#f8fafc;line-height:1.36">' + esc(q) + '</div><div style="margin-top:22px;height:8px;width:' + wp + '%;border-radius:99px;background:linear-gradient(90deg,' + accent + ',transparent)"></div><div style="margin-top:18px;font-size:19px;font-weight:800;color:' + accent + '">— ' + esc(activeScene.quoteSource || activeScene.badge || activeScene.headline) + '</div></div></div>';
  } else if (activeScene.kind === "cta_climax") {
    const hold = activeScene.stillnessBeforeClimaxMs ?? 380;
    const ae = Math.max(0, localMs - hold);
    const arr = easeExpoOut(clamp01(ae / 520));
    const csc = (1.34 - 0.34 * arr).toFixed(3);
    carrier.innerHTML = '<div style="position:absolute;inset:0;padding:' + Math.round(H * 0.14) + 'px ' + sidePad + 'px ' + bottomPad + 'px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;transform:scale(' + csc + ')"><h2 style="font-size:' + (isPortrait ? 60 : 68) + 'px;font-weight:900;color:#fff;line-height:1.1;max-width:88%">' + esc(activeScene.headline) + '</h2>' + (activeScene.subheadline ? '<p style="margin-top:20px;font-size:25px;color:#cbd5e1;max-width:78%">' + esc(activeScene.subheadline) + '</p>' : '') + '<div style="margin-top:36px;padding:20px 44px;border-radius:999px;background:linear-gradient(135deg,' + accent + ',#fff);color:#090d16;font-size:25px;font-weight:900">' + esc(activeScene.ctaButtonText || "Khám phá ngay") + ' →</div></div>';
  } else {
    const scopeId = "hf-sc-" + activeScene.index;
    const scopedStyle = activeScene.hyperframesCss ? "<style>#" + scopeId + "{" + activeScene.hyperframesCss + "}</style>" : "";
    const innerHf = activeScene.hyperframesHtml
      ? activeScene.hyperframesHtml
      : '<div style="display:grid;gap:18px"><div style="font-size:25px;font-weight:700;color:#f8fafc">' + esc(activeScene.narrationText) + '</div><div style="height:10px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden"><div style="height:100%;width:' + Math.round(progress * 100) + '%;background:linear-gradient(90deg,' + accent + ',#fff)"></div></div></div>';
    carrier.innerHTML = scopedStyle + '<div id="' + scopeId + '" style="position:absolute;inset:0;padding:' + (isPortrait ? 96 : 68) + 'px ' + sidePad + 'px ' + (bottomPad + 28) + 'px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:24px;--hf-progress:' + progress.toFixed(3) + ';--hf-enter:' + enter.toFixed(3) + ';--hf-accent:' + accent + '"><h2 style="text-align:center;font-size:' + (isPortrait ? 46 : 50) + 'px;font-weight:900;color:#fff">' + esc(activeScene.headline) + '</h2><div style="width:' + (isPortrait ? '92%' : '80%') + ';padding:34px;border-radius:26px;background:rgba(15,23,42,.88);border:1.5px solid ' + accent + '66;color:#f8fafc;font-size:22px">' + innerHf + '</div></div>';
  }

  if (activeScene.showCaptionRail && DATA.captionStyle !== "none") {
    const page = DATA.captionPages.find((p) => timeMs >= p.startMs && timeMs < p.startMs + p.durationMs);
    if (page) {
      const capBottom = isPortrait && DATA.safeZoneGuard ? Math.round(H * 0.14) : Math.round(H * 0.065);
      const pillCss = DATA.captionStyle === "clean-pill"
        ? "padding:11px 24px;border-radius:18px;background:rgba(9,13,24,.86);border:1px solid rgba(255,255,255,.16);box-shadow:0 14px 36px rgba(0,0,0,.5)"
        : "padding:4px 10px";
      const toks = page.tokens.map((tok) => {
        const rawW = String(tok.text || "").trim();
        const cl = rawW.replace(/[.,!?;:"'()]/gu, "").toLowerCase();
        const hl = hlMap.get(cl);
        const active = timeMs >= tok.fromMs && timeMs < tok.toMs;
        const col = active ? accentHex((hl && hl.color) || activeScene.accentColor) : (hl ? accentHex(hl.color) : "#fff");
        const scTok = active && DATA.captionStyle === "karaoke-pop" ? "scale(1.13)" : "scale(1)";
        return '<span style="display:inline-block;font-size:' + (DATA.captionStyle === "minimal-line" ? 28 : (isPortrait ? 36 : 34)) + 'px;font-weight:900;color:' + col + ';transform:' + scTok + ';text-shadow:0 3px 14px rgba(0,0,0,.85)">' + esc(rawW) + (active && hl && hl.emoji ? ' ' + esc(hl.emoji) : '') + '</span>';
      }).join('');
      captionWrap.innerHTML = '<div style="position:absolute;left:7%;right:' + (isPortrait && DATA.safeZoneGuard ? '14%' : '7%') + ';bottom:' + capBottom + 'px;display:flex;justify-content:center;pointer-events:none;z-index:30"><div style="display:inline-flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 11px;text-align:center;' + pillCss + '">' + toks + '</div></div>';
    } else {
      captionWrap.innerHTML = "";
    }
  } else {
    captionWrap.innerHTML = "";
  }
};

window.__stageReady = true;
</script>
</body>
</html>`;
}

export async function renderMotionVideoMp4(owner: string, id: string): Promise<void> {
  const ownerFolder = createVideoOwnerFolder(owner);
  const release = await claimCreateVideoRenderLock(ownerFolder, id);
  if (!release) {
    clearCreateVideoRenderPending(id);
    return;
  }

  let workDir = "";
  let browser;
  try {
    const job = await getCreateVideoJob(owner, id);
    if (!job || !job.plan) {
      throw new Error("Bản dựng Motion Video chưa có kịch bản để xuất MP4.");
    }

    const browserPath = await resolveCreateVideoBrowser();
    if (!browserPath) {
      throw new Error("Không tìm thấy trình duyệt Chrome/Chromium trên máy để render đồ hoạ 3D & GSAP.");
    }

    await ensureOverlayFonts();
    const jobDir = createVideoJobDir(owner, job.id);
    const rendersDir = path.join(jobDir, "renders");
    await mkdir(rendersDir, { recursive: true, mode: 0o700 });
    workDir = await mkdtemp(path.join(tmpdir(), "storyai-motion-render-"));

    const timeline = computeCreateVideoTimeline(
      job.plan,
      job.options.aspectRatio,
      job.audio?.words || [],
      { autoSfx: job.options.autoSfx, sfxVolumeDb: job.options.sfxVolumeDb },
    );

    await updateCreateVideoJob(ownerFolder, id, (latest) => ({
      ...latest,
      status: "rendering",
      progress: "Đang hoà âm giọng đọc AI & hiệu ứng âm thanh theo chương...",
    }));

    const mixedAudioPath = await buildMixedMotionAudio(job, timeline, jobDir, workDir);

    const captions: Caption[] = timeline.words.map((w, idx) => ({
      text: idx === 0 ? w.text : ` ${w.text}`,
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: Math.round((w.startMs + w.endMs) / 2),
      confidence: 0.95,
    }));
    const captionPages = captions.length
      ? createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 1_250 }).pages
      : [];

    const imageUrls: Record<string, string> = {};
    for (const img of job.images) {
      imageUrls[img.id] = `http://motion-stage.local/images/${encodeURIComponent(img.filename)}`;
    }

    const stageData = {
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      dominantVector: job.plan.dominantVector,
      captionStyle: job.plan.captionStyle,
      keywordHighlights: job.plan.keywordHighlights,
      safeZoneGuard: job.options.safeZoneGuard,
      motionBlur: job.options.motionBlur,
      scenes: timeline.scenes,
      captionPages,
      imageUrls,
    };

    const stageHtml = buildStageHtml(JSON.stringify(stageData).replace(/</gu, "\\u003c"));
    const gsapMinBytes = await readFile(path.join(process.cwd(), "node_modules", "gsap", "dist", "gsap.min.js"));
    const threeModuleBytes = await readFile(path.join(process.cwd(), "node_modules", "three", "build", "three.module.js"));
    const threeCoreBytes = await readFile(path.join(process.cwd(), "node_modules", "three", "build", "three.core.js"));
    const textFontBytes = await readFile(overlayTextFontFile);
    const emojiFontBytes = await readFile(overlayEmojiFontFile);

    const imageBytesCache = new Map<string, Buffer>();
    for (const img of job.images) {
      const b = await readFile(path.join(jobDir, "images", path.basename(img.filename))).catch(() => null);
      if (b) imageBytesCache.set(path.basename(img.filename), b);
    }

    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    });

    // Build parallel frame shards (max 2,700 frames = 90s per shard; concurrency 1..3)
    const maxShardFrames = timeline.totalFrames >= 5_400 ? 2_700 : 1_800;
    const shards: Array<{ index: number; startFrame: number; endFrame: number; outMp4: string }> = [];
    for (let sIdx = 0, start = 0; start < timeline.totalFrames; sIdx++, start += maxShardFrames) {
      const end = Math.min(timeline.totalFrames, start + maxShardFrames);
      shards.push({
        index: sIdx,
        startFrame: start,
        endFrame: end,
        outMp4: path.join(workDir, `shard_${String(sIdx).padStart(3, "0")}.mp4`),
      });
    }

    const activeBrowser = browser;
    const concurrency = timeline.totalFrames >= 5_400 ? 3 : timeline.totalFrames >= 1_800 ? 2 : 1;
    let nextShardIdx = 0;
    let renderedFrames = 0;
    let lastProgressUpdateMs = 0;

    async function renderShard(shard: { index: number; startFrame: number; endFrame: number; outMp4: string }) {
      const context = await activeBrowser.newContext({
        viewport: { width: timeline.width, height: timeline.height },
        deviceScaleFactor: 1,
      });

      try {
        await context.route("**/*", async (route) => {
          const reqUrl = new URL(route.request().url());
          if (reqUrl.origin !== "http://motion-stage.local") {
            await route.abort();
            return;
          }
          const p = reqUrl.pathname;
          if (p === "/index.html") {
            await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: stageHtml });
            return;
          }
          if (p === "/vendor/gsap.min.js") {
            await route.fulfill({ status: 200, contentType: "application/javascript", body: gsapMinBytes });
            return;
          }
          if (p === "/vendor/three.module.js") {
            await route.fulfill({ status: 200, contentType: "application/javascript", body: threeModuleBytes });
            return;
          }
          if (p === "/vendor/three.core.js") {
            await route.fulfill({ status: 200, contentType: "application/javascript", body: threeCoreBytes });
            return;
          }
          if (p === "/fonts/text.ttf") {
            await route.fulfill({ status: 200, contentType: "font/ttf", body: textFontBytes });
            return;
          }
          if (p === "/fonts/emoji.ttf") {
            await route.fulfill({ status: 200, contentType: "font/ttf", body: emojiFontBytes });
            return;
          }
          if (p.startsWith("/images/")) {
            const fname = path.basename(decodeURIComponent(p.slice("/images/".length)));
            const fileBytes = imageBytesCache.get(fname);
            if (fileBytes) {
              await route.fulfill({ status: 200, contentType: "image/png", body: fileBytes });
              return;
            }
          }
          await route.fulfill({ status: 404, body: "Not found" });
        });

        const page = await context.newPage();
        await page.goto("http://motion-stage.local/index.html", { waitUntil: "load", timeout: 30_000 });
        await page.waitForFunction(() => Boolean((window as unknown as { __stageReady?: boolean }).__stageReady), undefined, {
          timeout: 20_000,
        });

        const ffmpegProc = spawn(
          autoEditFfmpeg(),
          [
            "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-framerate", String(timeline.fps),
            "-i", "pipe:0",
            "-an",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-video_track_timescale", "15360",
            shard.outMp4,
          ],
          { stdio: ["pipe", "ignore", "pipe"] },
        );

        let ffmpegStderr = "";
        ffmpegProc.stderr?.on("data", (chunk: Buffer) => {
          ffmpegStderr = (ffmpegStderr + chunk.toString("utf8")).slice(-2_000);
        });

        const ffmpegDone = new Promise<void>((resolve, reject) => {
          ffmpegProc.on("error", reject);
          ffmpegProc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg shard ${shard.index} thoát với mã ${code}: ${ffmpegStderr}`));
          });
        });

        for (let frame = shard.startFrame; frame < shard.endFrame; frame++) {
          await page.evaluate((f) => {
            (window as unknown as { __seekMotionFrame: (n: number) => void }).__seekMotionFrame(f);
          }, frame);
          const jpegBuf = await page.screenshot({ type: "jpeg", quality: 91 });

          const canContinue = ffmpegProc.stdin.write(jpegBuf);
          if (!canContinue) {
            await new Promise<void>((resolve) => ffmpegProc.stdin.once("drain", resolve));
          }

          renderedFrames++;
          const nowMs = Date.now();
          if (nowMs - lastProgressUpdateMs > 1_500 || renderedFrames === timeline.totalFrames) {
            lastProgressUpdateMs = nowMs;
            const pct = Math.min(99, Math.round((renderedFrames / timeline.totalFrames) * 100));
            void updateCreateVideoJob(ownerFolder, id, (latest) => ({
              ...latest,
              progress: concurrency > 1
                ? `Đang kết xuất song song ${concurrency} luồng (${pct}% · ${renderedFrames}/${timeline.totalFrames} frames)...`
                : `Đang kết xuất khung hình Three.js + GSAP (${pct}% · ${renderedFrames}/${timeline.totalFrames} frames)...`,
            }));
          }
        }

        ffmpegProc.stdin.end();
        await ffmpegDone;
      } finally {
        await context.close().catch(() => undefined);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, shards.length) }, async () => {
      while (true) {
        const idx = nextShardIdx++;
        if (idx >= shards.length) break;
        await renderShard(shards[idx]);
      }
    });

    await Promise.all(workers);

    await browser.close().catch(() => undefined);
    browser = undefined;

    await updateCreateVideoJob(ownerFolder, id, (latest) => ({
      ...latest,
      progress: "Đang ghép các phân đoạn MP4 và đồng bộ âm thanh tổng...",
    }));

    const tempMp4 = path.join(workDir, "rendered.mp4");
    const finalMp4 = path.join(rendersDir, `motion-video-${job.id}.mp4`);
    const shardsTxt = path.join(workDir, "shards_concat.txt");
    await writeFile(
      shardsTxt,
      shards.map((s) => `file '${s.outMp4.replace(/'/gu, "'\\''")}'`).join("\n"),
      "utf8",
    );

    await exec(
      autoEditFfmpeg(),
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", shardsTxt,
        "-i", mixedAudioPath,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        tempMp4,
      ],
      { timeout: 300_000, maxBuffer: 8_000_000 },
    );

    await copyFile(tempMp4, finalMp4);
    const details = await stat(finalMp4);
    const now = new Date().toISOString();

    await updateCreateVideoJob(ownerFolder, id, (latest) => ({
      ...latest,
      status: "rendered",
      progress: "Đã xuất thành công tệp MP4 Motion Video chất lượng cao!",
      render: {
        status: "ready",
        outputPath: path.relative(jobDir, finalMp4),
        durationMs: timeline.totalDurationMs,
        width: timeline.width,
        height: timeline.height,
        fps: timeline.fps,
        sizeBytes: details.size,
        updatedAt: now,
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Xuất MP4 Motion Video thất bại.";
    const now = new Date().toISOString();
    await updateCreateVideoJob(ownerFolder, id, (latest) => ({
      ...latest,
      status: "ready",
      progress: "Xuất MP4 gặp lỗi — bạn có thể thử xuất lại.",
      error: message,
      render: {
        status: "failed",
        updatedAt: now,
        error: message,
      },
    }));
  } finally {
    clearCreateVideoRenderPending(id);
    if (browser) await browser.close().catch(() => undefined);
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    await release();
  }
}

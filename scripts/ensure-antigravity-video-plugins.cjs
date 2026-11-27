#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const isWindows = process.platform === "win32";
const gitExecutable = isWindows ? "git.exe" : "git";

const HYPERFRAMES_REPO = "https://github.com/heygen-com/hyperframes.git";
const REMOTION_SKILLS_REPO = "https://github.com/remotion-dev/skills.git";

const HYPERFRAMES_MANIFEST = {
  name: "hyperframes",
  displayName: "HyperFrames",
  version: "0.9.97",
  description:
    "HyperFrames by HeyGen — write HTML/CSS and GSAP animations to render deterministic MP4 videos, captions overlays, motion cards, and video compositions.",
  logo: "assets/logo.svg",
  suggestedPrompts: [
    "Create an animated HyperFrames product callout card with smooth entrance",
    "Add word-by-word captions overlay and cut-the-curve transitions",
    "Convert a Remotion composition into a single-file HyperFrames scene",
  ],
  author: {
    name: "HeyGen",
    url: "https://hyperframes.heygen.com",
  },
  homepage: "https://hyperframes.heygen.com",
  repository: "https://github.com/heygen-com/hyperframes",
};

const HYPERFRAMES_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="14" y="14" width="100" height="100" rx="24" fill="#111827" stroke="#818CF8" stroke-width="4"/>
  <path d="M38 40v48M62 40v48M38 64h24M74 40h20M74 62h16M74 40v48" stroke="#FBBF24" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`;

const REMOTION_MANIFEST = {
  name: "remotion",
  displayName: "Remotion",
  version: "4.0.547",
  description:
    "Official Remotion skills for building programmatic React videos, interactive <Player> previews, @remotion/captions TikTok subtitles, and MP4 rendering.",
  logo: "assets/logo.svg",
  suggestedPrompts: [
    "Build a Remotion <Player> preview with TikTok-style word captions",
    "Create a multi-clip Sequence timeline with spring zoom transitions",
    "Optimize Remotion video playback and frame-accurate trimming",
  ],
  author: {
    name: "Remotion",
    url: "https://www.remotion.dev",
  },
  homepage: "https://www.remotion.dev",
  repository: "https://github.com/remotion-dev/skills",
};

const REMOTION_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="14" y="14" width="100" height="100" rx="24" fill="#0B84F3"/>
  <path d="M48 39.5c0-3.2 3.5-5.2 6.3-3.5l41 24.5c2.7 1.6 2.7 5.4 0 7l-41 24.5c-2.8 1.7-6.3-.3-6.3-3.5v-49z" fill="#FFFFFF"/>
</svg>
`;

const WHISPER_MANIFEST = {
  name: "whisper-auto-edit",
  displayName: "Whisper & Auto-Edit Video",
  version: "1.0.0",
  description:
    "Word-level speech transcription (WhisperKit / whisper.cpp), FFmpeg acoustic VAD silence & retake cutting, and automated video editing workflows.",
  logo: "assets/logo.svg",
  suggestedPrompts: [
    "Transcribe a raw video with Whisper word-level timestamps and cut retakes",
    "Detect dead air, spoken hesitations, and punch-in zoom points with FFmpeg",
    "Refine an Auto-Edit Video EDL with product cards and safe-zone captions",
  ],
  author: {
    name: "StoryAI",
  },
};

const WHISPER_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="14" y="14" width="100" height="100" rx="24" fill="#064E3B" stroke="#34D399" stroke-width="4"/>
  <path d="M34 64v12M48 46v36M64 34v60M80 48v32M94 58v16" stroke="#34D399" stroke-width="8" stroke-linecap="round"/>
</svg>
`;

const THREE_GSAP_MANIFEST = {
  name: "threejs-gsap-fx",
  displayName: "Three.js, GSAP & Pro Video FX",
  version: "1.0.0",
  description:
    "3D Device/Product Stages with Three.js & @remotion/three, Aurora WebGL/Canvas Shaders, GSAP + @remotion/paths hand-drawn spotlight annotations, and cinematic motion blur.",
  logo: "assets/logo.svg",
  suggestedPrompts: [
    "Render a 3D floating product or browser stage with Three.js and Aurora shader",
    "Add an animated hand-drawn spotlight circle and Vox highlighter to a video",
    "Apply camera motion blur, freeze-frame flash, and GSAP elastic card reveals",
  ],
  author: {
    name: "StoryAI",
  },
};

const THREE_GSAP_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="14" y="14" width="100" height="100" rx="24" fill="#0F172A" stroke="#38BDF8" stroke-width="4"/>
  <polygon points="64,28 96,84 32,84" fill="none" stroke="#38BDF8" stroke-width="6" stroke-linejoin="round"/>
  <polygon points="64,46 82,78 46,78" fill="none" stroke="#FBBF24" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="64" cy="66" r="5" fill="#34D399"/>
</svg>
`;

const THREE_GSAP_SKILL_MD = `---
name: threejs-video-fx
description: >-
  Author deterministic 3D scenes, floating device/product stages, Aurora shaders,
  GSAP/@remotion/paths spotlight annotations, and cinematic motion blur in StoryAI.
---

# Three.js, GSAP & Pro Video FX Workflow

- Drive all Three.js meshes, Aurora shaders, and SVG stroke evolutions deterministically from frame time (\`frame / fps\` or \`var(--hf-progress)\`).
- Use \`spotlight_box\` for hand-drawn circles/boxes + pointer arrows, \`highlighter\` for Vox neon marker sweeps, \`freeze_frame\` for camera-shutter flash + HUD brackets, and \`stage-3d\` / \`aurora-3d\` for 3D perspective stages.
`;

const WHISPER_SKILL_MD = `---
name: whisper-auto-edit
description: >-
  Word-level speech transcription with WhisperKit / whisper.cpp / OpenAI Whisper,
  FFmpeg PCM silence & hesitation VAD, semantic retake elimination, and StoryAI Auto-Edit EDL authoring.
---

# Whisper & Auto-Edit Video Workflow

Use this skill when transcribing raw video/audio with word-level timestamps, cutting spoken hesitations/false-starts/dead-air, and orchestrating FFmpeg + Remotion + HyperFrames auto-editing pipelines.

## Local CLI Backends Supported

1. **Apple Silicon WhisperKit CLI (\`whisperkit-cli\`)**:
   \`\`\`bash
   whisperkit-cli transcribe --audio-path audio.wav --language vi --word-timestamps --report --report-path ./out --model base
   \`\`\`
2. **whisper.cpp (\`whisper-cli\`)**:
   \`\`\`bash
   whisper-cli -m ggml-base.bin -f audio.wav -l vi -ojf -of ./out/transcript
   \`\`\`
3. **FFmpeg 16kHz Mono Extraction & EBU R128 Loudness Mastering**:
   - Extract 16kHz WAV for Whisper: \`ffmpeg -i input.mp4 -vn -ac 1 -ar 16000 audio.wav\`
   - Normalize edited dialogue loudness: \`-af loudnorm=I=-15:TP=-1.5:LRA=11\` with \`25ms\` micro-fades (\`afade\`) on segment boundaries to eliminate jump-cut audio pops.

## Smart-Cut Rules for Raw Talking-Head & UGC Footage

- **3-Layer Cut Detection**:
  1. Strip leading/trailing camera-setup \`dead_air\`.
  2. Strip internal \`silence\` exceeding threshold (\`450ms\`) while preserving a \`65ms\` natural breath pad on speech edges.
  3. Eliminate \`retake\` / false starts semantically: when a speaker stumbles and repeats a clause, keep only the final clean take.
- **Jump-Cut Concealment**:
  - Alternate punch-in zoom (\`1.0x\` ↔ \`1.14x\`) anchored around eye-line (\`zoomFocusY: 0.38\`) or bridge the cut with a B-roll / HyperFrames product card.
`;

function defaultPluginsDirectory() {
  const override = process.env.STORYAI_ANTIGRAVITY_PLUGINS_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".gemini", "config", "plugins");
}

function runGit(args, cwd, timeout = 90_000) {
  const res = spawnSync(gitExecutable, args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout,
    shell: isWindows,
    windowsHide: true,
  });
  return res.status === 0;
}

function hasGit() {
  return runGit(["--version"], os.tmpdir(), 8_000);
}

function cloneSkillsSubtree(repoUrl, targetDir, sparsePaths) {
  // Fast sparse checkout first (~200 KB download instead of full repo)
  if (
    sparsePaths.length > 0 &&
    runGit(["clone", "--depth", "1", "--filter=blob:none", "--sparse", repoUrl, targetDir], os.tmpdir(), 90_000) &&
    runGit(["sparse-checkout", "set", ...sparsePaths], targetDir, 45_000)
  ) {
    return true;
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  return runGit(["clone", "--depth", "1", repoUrl, targetDir], os.tmpdir(), 120_000);
}

function copyChildDirectories(sourceParent, destParent, filterNames) {
  if (!fs.existsSync(sourceParent)) return 0;
  fs.mkdirSync(destParent, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(sourceParent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (filterNames && !filterNames.has(entry.name)) continue;
    const srcSkillMd = path.join(sourceParent, entry.name, "SKILL.md");
    if (!fs.existsSync(srcSkillMd)) continue;
    fs.cpSync(path.join(sourceParent, entry.name), path.join(destParent, entry.name), {
      recursive: true,
      force: true,
    });
    count += 1;
  }
  return count;
}

function isPluginHealthy(pluginDir, markerSkill) {
  return (
    fs.existsSync(path.join(pluginDir, "plugin.json")) &&
    fs.existsSync(path.join(pluginDir, "skills", markerSkill, "SKILL.md"))
  );
}

function writePluginBundleMeta(pluginDir, manifest, logoSvg) {
  fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "assets", "logo.svg"), logoSvg, "utf8");
  fs.writeFileSync(path.join(pluginDir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function ensureWhisperPlugin(pluginsDir, force, log) {
  const targetDir = path.join(pluginsDir, "whisper-auto-edit");
  if (!force && isPluginHealthy(targetDir, "whisper-auto-edit")) {
    return { id: "whisper-auto-edit", action: "present" };
  }
  const skillDir = path.join(targetDir, "skills", "whisper-auto-edit");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), WHISPER_SKILL_MD, "utf8");
  writePluginBundleMeta(targetDir, WHISPER_MANIFEST, WHISPER_LOGO);
  log("[antigravity-plugins] Installed Whisper & Auto-Edit Video plugin.");
  return { id: "whisper-auto-edit", action: "installed" };
}

function ensureHyperframesPlugin(pluginsDir, force, log) {
  const targetDir = path.join(pluginsDir, "hyperframes");
  if (!force && isPluginHealthy(targetDir, "hyperframes")) {
    return { id: "hyperframes", action: "present" };
  }
  if (!hasGit()) {
    log("[antigravity-plugins] Skipping HyperFrames GitHub sync because Git is not in PATH.");
    return { id: "hyperframes", action: "skipped_no_git" };
  }

  const tmpClone = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-hf-plugin-"));
  const stagingDir = `${targetDir}.staging-${process.pid}`;
  try {
    log("[antigravity-plugins] Downloading official HyperFrames skills from GitHub (heygen-com/hyperframes)...");
    if (!cloneSkillsSubtree(HYPERFRAMES_REPO, tmpClone, ["skills", ".agents/skills"])) {
      log("[antigravity-plugins] Could not reach GitHub for HyperFrames; will retry next time.");
      return { id: "hyperframes", action: "skipped_offline" };
    }

    fs.rmSync(stagingDir, { recursive: true, force: true });
    const skillsDest = path.join(stagingDir, "skills");
    const primaryCount = copyChildDirectories(path.join(tmpClone, "skills"), skillsDest);
    const extraMotionSkills = new Set(["captions-overlay", "cut-the-curve", "motion-doctrine", "seam-craft"]);
    const extraCount = copyChildDirectories(path.join(tmpClone, ".agents", "skills"), skillsDest, extraMotionSkills);

    if (primaryCount + extraCount === 0) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return { id: "hyperframes", action: "skipped_empty" };
    }

    writePluginBundleMeta(stagingDir, HYPERFRAMES_MANIFEST, HYPERFRAMES_LOGO);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetDir);
    log(`[antigravity-plugins] Installed HyperFrames plugin (${primaryCount + extraCount} skills).`);
    return { id: "hyperframes", action: "installed", skills: primaryCount + extraCount };
  } finally {
    fs.rmSync(tmpClone, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function ensureRemotionPlugin(pluginsDir, force, log) {
  const targetDir = path.join(pluginsDir, "remotion");
  if (!force && isPluginHealthy(targetDir, "remotion-best-practices")) {
    return { id: "remotion", action: "present" };
  }
  if (!hasGit()) {
    log("[antigravity-plugins] Skipping Remotion GitHub sync because Git is not in PATH.");
    return { id: "remotion", action: "skipped_no_git" };
  }

  const tmpClone = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-remotion-plugin-"));
  const stagingDir = `${targetDir}.staging-${process.pid}`;
  try {
    log("[antigravity-plugins] Downloading official Remotion skills from GitHub (remotion-dev/skills)...");
    if (!cloneSkillsSubtree(REMOTION_SKILLS_REPO, tmpClone, ["skills"])) {
      log("[antigravity-plugins] Could not reach GitHub for Remotion skills; will retry next time.");
      return { id: "remotion", action: "skipped_offline" };
    }

    fs.rmSync(stagingDir, { recursive: true, force: true });
    const count = copyChildDirectories(path.join(tmpClone, "skills"), path.join(stagingDir, "skills"));
    if (count === 0) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return { id: "remotion", action: "skipped_empty" };
    }

    writePluginBundleMeta(stagingDir, REMOTION_MANIFEST, REMOTION_LOGO);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetDir);
    log(`[antigravity-plugins] Installed Remotion plugin (${count} skills).`);
    return { id: "remotion", action: "installed", skills: count };
  } finally {
    fs.rmSync(tmpClone, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function ensureThreeGsapPlugin(pluginsDir, force, log) {
  const targetDir = path.join(pluginsDir, "threejs-gsap-fx");
  if (!force && isPluginHealthy(targetDir, "threejs-video-fx")) {
    return { id: "threejs-gsap-fx", action: "present" };
  }
  const skillDir = path.join(targetDir, "skills", "threejs-video-fx");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), THREE_GSAP_SKILL_MD, "utf8");
  writePluginBundleMeta(targetDir, THREE_GSAP_MANIFEST, THREE_GSAP_LOGO);
  log("[antigravity-plugins] Installed Three.js, GSAP & Pro Video FX plugin.");
  return { id: "threejs-gsap-fx", action: "installed" };
}

function ensureAntigravityVideoPlugins(options = {}) {
  const pluginsDir = options.pluginsDir || defaultPluginsDirectory();
  const force = Boolean(options.force);
  const log = typeof options.logger === "function" ? options.logger : (msg) => console.log(msg);

  try {
    fs.mkdirSync(pluginsDir, { recursive: true });
    const results = [
      ensureWhisperPlugin(pluginsDir, force, log),
      ensureThreeGsapPlugin(pluginsDir, force, log),
      ensureHyperframesPlugin(pluginsDir, force, log),
      ensureRemotionPlugin(pluginsDir, force, log),
    ];
    return { ok: true, pluginsDir, results };
  } catch (error) {
    log(`[antigravity-plugins] Non-fatal plugin bootstrap warning: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, pluginsDir, results: [] };
  }
}

module.exports = { ensureAntigravityVideoPlugins, defaultPluginsDirectory };

if (require.main === module) {
  const force = process.argv.includes("--force");
  const outcome = ensureAntigravityVideoPlugins({ force });
  if (!outcome.ok) process.exitCode = 1;
}

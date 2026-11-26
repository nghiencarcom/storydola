const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTsModule(relPath, mocks = {}) {
  const fullPath = path.join(__dirname, "..", relPath);
  const source = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: fullPath,
  });

  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier.startsWith("./")) {
      const targetRel = path.relative(
        path.join(__dirname, ".."),
        path.resolve(path.dirname(fullPath), `${specifier}.ts`),
      );
      return loadTsModule(targetRel, mocks);
    }
    return require(specifier);
  };

  const fn = new Function("exports", "require", "module", "__filename", "__dirname", outputText);
  fn(mod.exports, customRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

const autoEdit = loadTsModule("app/lib/auto-edit.ts");
const autoEditMedia = loadTsModule("app/lib/auto-edit-media.ts");

// 1. Verify Whisper JSON word-level parser
{
  const whisperPayload = {
    segments: [
      {
        start: 0.4,
        end: 2.9,
        text: "ờm kem chống nắng thấm ráo",
        words: [
          { word: "ờm", start: 0.4, end: 0.72, probability: 0.78 },
          { word: "kem", start: 1.0, end: 1.35, probability: 0.96 },
          { word: "chống", start: 1.36, end: 1.7, probability: 0.97 },
          { word: "nắng", start: 1.71, end: 2.1, probability: 0.98 },
          { word: "thấm", start: 2.15, end: 2.5, probability: 0.99 },
          { word: "ráo", start: 2.52, end: 2.9, probability: 0.95 },
        ],
      },
    ],
  };

  const parsed = autoEditMedia.parseWhisperJsonWords(whisperPayload, "clip_01");
  assert.equal(parsed.kind, "whisper_words");
  assert.equal(parsed.words.length, 6);
  assert.equal(parsed.words[0].filler, true);
  assert.equal(parsed.words[4].text, "thấm");
  assert.equal(parsed.words[4].startMs, 2150);
}

// 2. Verify PCM acoustic silence & dead-air extraction
{
  const sampleRate = 1000;
  const totalSec = 4;
  const pcm = Buffer.alloc(sampleRate * totalSec * 2);
  // 0.0s - 0.6s: dead air (zeros)
  // 0.6s - 1.8s: loud speech
  // 1.8s - 2.6s: internal pause (800ms)
  // 2.6s - 3.6s: loud speech
  // 3.6s - 4.0s: trailing dead air (400ms)
  for (let i = 600; i < 1800; i++) pcm.writeInt16LE(12000, i * 2);
  for (let i = 2600; i < 3600; i++) pcm.writeInt16LE(11000, i * 2);

  const pauses = autoEditMedia.extractPcmSilencePauses(pcm, sampleRate, "clip_01", 4000, 450);
  assert.ok(pauses.length >= 2, "Expected leading dead_air and internal silence pauses");
  assert.equal(pauses[0].reason, "dead_air");
  assert.equal(pauses[0].startMs, 0);
  assert.ok(pauses.some((p) => p.reason === "silence" && p.startMs >= 1800 && p.endMs <= 2600));
}

// 3. Verify EDL normalization, HyperFrames sanitization, and timeline computation
{
  const videos = [{ id: "clip_01", filename: "raw.mp4", extension: ".mp4", size: 1000, order: 0, durationMs: 8000 }];
  const images = [{ id: "img_01", filename: "sp.png", extension: ".png", size: 500, width: 800, height: 800, label: "Chai serum" }];
  const words = [
    { id: "w1", clipId: "clip_01", text: "ờm", startMs: 100, endMs: 400, filler: true },
    { id: "w2", clipId: "clip_01", text: "Chất", startMs: 1200, endMs: 1600 },
    { id: "w3", clipId: "clip_01", text: "gel", startMs: 1620, endMs: 2050 },
    { id: "w4", clipId: "clip_01", text: "thấm", startMs: 4200, endMs: 4700 },
    { id: "w5", clipId: "clip_01", text: "nhanh", startMs: 4720, endMs: 5300 },
  ];
  const pauses = [{ clipId: "clip_01", startMs: 2200, endMs: 4000, reason: "silence" }];
  const fallback = autoEdit.buildCandidateSegments(videos, words, pauses, 450);

  const rawAgentOutput = {
    title: "Review Serum Kiềm Dầu",
    summary: "Đã cắt đoạn nói vấp đầu clip và khoảng nghỉ 1.8s.",
    hookHeadline: "KIỀM DẦU TRONG 10 GIÂY?",
    hookEmoji: "😱",
    captionStyle: "karaoke-pop",
    segments: [
      { id: "seg_01", clipId: "clip_01", sourceStartMs: 0, sourceEndMs: 1000, keep: false, cutReason: "hesitation", transcriptText: "ờm" },
      { id: "seg_02", clipId: "clip_01", sourceStartMs: 1000, sourceEndMs: 2200, keep: true, zoom: 1.0, transcriptText: "Chất gel" },
      { id: "seg_03", clipId: "clip_01", sourceStartMs: 2200, sourceEndMs: 4000, keep: false, cutReason: "silence", transcriptText: "" },
      { id: "seg_04", clipId: "clip_01", sourceStartMs: 4000, sourceEndMs: 6000, keep: true, zoom: 1.15, transcriptText: "thấm nhanh" },
    ],
    overlays: [
      {
        id: "ov_card",
        kind: "product_card",
        anchorSegmentId: "seg_04",
        offsetMs: 200,
        durationMs: 1500,
        imageId: "img_01",
        layout: "floating-right",
        title: "Gel thấm ráo",
        hyperframesHtml: "<script>alert(1)</script><div onclick=\"evil()\" class=\"bar\">OK</div>",
        hyperframesCss: "@import url('https://evil.example/x.css'); .bar { width: calc(var(--hf-progress) * 100%); }",
      },
    ],
    keywordHighlights: [{ word: "thấm", color: "emerald", emoji: "✨" }],
    directorNotes: ["Luân phiên zoom 1.0x -> 1.15x"],
  };

  const options = autoEdit.autoEditOptionsSchema.parse({ productName: "Serum" });
  const edl = autoEdit.normalizeAgentAutoEditEdl(rawAgentOutput, videos, images, words, fallback, options);

  // Security check: script, onclick, @import, and url() stripped from HyperFrames markup
  const card = edl.overlays.find((o) => o.kind === "product_card");
  assert.ok(card);
  assert.ok(!card.hyperframesHtml.includes("<script"));
  assert.ok(!card.hyperframesHtml.includes("onclick"));
  assert.ok(!card.hyperframesCss.includes("@import"));
  assert.ok(card.hyperframesCss.includes("--hf-progress"));

  const timeline = autoEdit.computeAutoEditTimeline(edl, words, "9:16", 8000);
  assert.equal(timeline.keptSegments.length, 2);
  assert.equal(timeline.totalDurationMs, 3200); // 1200ms + 2000ms
  assert.equal(timeline.savedDurationMs, 4800);
  assert.equal(timeline.cutCount, 2);

  // Word timestamps remapped seamlessly across cut!
  const thamWord = timeline.words.find((w) => w.text.trim() === "thấm");
  assert.ok(thamWord);
  // seg_04 starts at source 4000ms -> timeline 1200ms; word at 4200ms -> 1400ms!
  assert.equal(thamWord.startMs, 1400);
  assert.equal(thamWord.highlightColor, "emerald");
  assert.equal(thamWord.emoji, "✨");

  // Anchored product card shifted automatically to seg_04's timeline start (1200ms + 200ms = 1400ms)
  const timelineCard = timeline.overlays.find((o) => o.kind === "product_card");
  assert.ok(timelineCard);
  assert.equal(timelineCard.timelineStartMs, 1400);
}

// 4. Verify Voice dB measurement (0 to -3 dB zone check)
{
  const sampleRate = 8000;
  const pcm = Buffer.alloc(sampleRate * 2 * 2); // 2 seconds
  // Amplitude 0.87 => 20 * log10(0.87) ≈ -1.2 dB (inside 0 to -3 dB target zone)
  const targetSample = Math.round(0.87 * 32767);
  for (let i = 1000; i < 14000; i++) {
    pcm.writeInt16LE(i % 2 === 0 ? targetSample : -targetSample, i * 2);
  }
  const levels = autoEditMedia.measurePcmVoiceLevelsDb(pcm, sampleRate);
  assert.ok(levels.maxVolumeDb <= 0 && levels.maxVolumeDb >= -3, `Expected maxVolumeDb in [-3, 0], got ${levels.maxVolumeDb}`);
  assert.ok(levels.speechPeakDb <= 0 && levels.speechPeakDb >= -3, `Expected speechPeakDb in [-3, 0], got ${levels.speechPeakDb}`);
}

console.log("auto-edit-engine tests passed!");

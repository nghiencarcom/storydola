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
    if (specifier.endsWith(".json")) {
      return require(path.resolve(path.dirname(fullPath), specifier));
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
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

const os = require("node:os");
const autoEdit = loadTsModule("app/lib/auto-edit.ts");
const autoEditMedia = loadTsModule("app/lib/auto-edit-media.ts");
const autoEditRender = loadTsModule("app/lib/auto-edit-render.ts", {
  "playwright-core": { chromium: { executablePath: () => "", launch: async () => ({}) } },
  "next/server": { NextResponse: { json: (b, i) => ({ body: b, init: i }) } },
});
const sfxRoute = loadTsModule("app/api/auto-edit/sfx/[sfxId]/route.ts", {
  "next/server": {
    NextResponse: class MockRes {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.headers = init.headers || {};
      }
      static json(body, init = {}) {
        return { body, status: init.status || 200, headers: init.headers || {} };
      }
    },
  },
  "../../../../lib/auth-server": { getCurrentUserId: async () => "test-user" },
});

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

// 5. Verify 59 Google Drive SFX catalog & automatic timeline SFX placement
{
  const sfxLib = loadTsModule("app/lib/sfx-library.ts");
  assert.equal(sfxLib.SFX_CATALOG.length, 59);
  for (const item of sfxLib.SFX_CATALOG) {
    const fileOnDisk = path.join(__dirname, "..", "assets", "sfx", item.filename);
    assert.ok(fs.existsSync(fileOnDisk), `Missing SFX file on disk: ${item.filename}`);
  }

  const videos = [{ id: "clip_01", filename: "raw.mp4", extension: ".mp4", size: 1000, order: 0, durationMs: 10000 }];
  const images = [{ id: "img_01", filename: "sp.png", extension: ".png", size: 500, width: 800, height: 800, label: "SP" }];
  const options = autoEdit.autoEditOptionsSchema.parse({ productName: "SP", autoSfx: true, sfxVolumeDb: -16 });
  const edl = autoEdit.normalizeAgentAutoEditEdl(
    {
      title: "Test SFX",
      summary: "SFX check",
      hookHeadline: "HOOK SFX",
      captionStyle: "karaoke-pop",
      segments: [{ id: "seg_01", clipId: "clip_01", sourceStartMs: 0, sourceEndMs: 8000, keep: true, zoom: 1 }],
      overlays: [
        { id: "ov_p1", kind: "product_card", anchorSegmentId: "seg_01", offsetMs: 2000, durationMs: 2500, imageId: "img_01", title: "Giá 199K", priceTag: "199K" },
      ],
      sfxCues: [
        { id: "cue_1", sfxId: "tada", anchorSegmentId: "seg_01", offsetMs: 6500 },
      ],
      keywordHighlights: [],
      directorNotes: [],
    },
    videos,
    images,
    [],
    [],
    options,
  );

  const timeline = autoEdit.computeAutoEditTimeline(edl, [], "9:16", 10000, { autoSfx: true, sfxVolumeDb: -8.5 });
  assert.ok(timeline.sfxEvents.length >= 3, `Expected >= 3 SFX events (hook + product card + tada cue), got ${timeline.sfxEvents.length}`);
  assert.ok(timeline.sfxEvents.some((e) => e.sfxId === "tada" && e.timelineStartMs === 6500));

  // Verify YouTube json3 roll-up caption parser produces zero overlapping word timestamps
  const sampleJson3 = {
    events: [
      { tStartMs: 1800, dDurationMs: 5600, segs: [{ utf8: "Hướng dẫn ", tOffsetMs: 0 }, { utf8: "mọi người", tOffsetMs: 900 }] },
      { tStartMs: 4900, dDurationMs: 4300, segs: [{ utf8: "cài đặt ", tOffsetMs: 0 }, { utf8: "StoryAI", tOffsetMs: 600 }] },
    ],
  };
  const ytWords = autoEditMedia.parseYoutubeJson3Words(sampleJson3, "clip_01");
  assert.ok(ytWords.length >= 4);
  for (let i = 1; i < ytWords.length; i++) {
    assert.ok(
      ytWords[i].startMs >= ytWords[i - 1].endMs,
      `Word overlap detected between ${ytWords[i - 1].text}[${ytWords[i - 1].endMs}] and ${ytWords[i].text}[${ytWords[i].startMs}]`,
    );
  }
}

// 6. Verify hardened HyperFrames HTML/CSS sanitizer, overlay.id allowlist, and EDL bounds
{
  const sanitized = autoEdit.sanitizeHyperframesMarkup(
    `<div/onload=alert(1) class="hf-box"><img src=x onerror=alert(1)><svg onload=evil()><path/></svg><strong"onclick="steal()">Giảm 50%</strong><br><a href="https://evil.test">Click</a></div>`,
    `} body { display: none !important } .hf-box { width: calc(var(--hf-progress, 1) * 100%); {`,
  );
  assert.ok(sanitized.html);
  assert.ok(!/on[a-z0-9_-]+\s*=/iu.test(sanitized.html), `Unexpected event handler in ${sanitized.html}`);
  assert.ok(!sanitized.html.includes("<img") && !sanitized.html.includes("<svg") && !sanitized.html.includes("<a"));
  assert.ok(sanitized.html.includes('<div class="hf-box">'));
  assert.ok(sanitized.html.includes("<strong>Giảm 50%</strong>"));
  assert.ok(sanitized.html.includes("<br />"));

  // Check balanced {} in CSS (depth never < 0 and ends at 0)
  assert.ok(sanitized.css);
  let depth = 0;
  for (const ch of sanitized.css) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    assert.ok(depth >= 0, `Negative brace depth in sanitized CSS: ${sanitized.css}`);
  }
  assert.equal(depth, 0, `Unbalanced braces remaining in sanitized CSS: ${sanitized.css}`);

  // Overlay ID restricted to /^[A-Za-z0-9_-]{1,64}$/
  const cleanId = autoEdit.sanitizeOverlayId("bad}{</style><script>", "ov_fallback");
  assert.ok(autoEdit.SAFE_OVERLAY_ID_REGEX.test(cleanId));

  // Segment sourceEndMs > sourceStartMs & transcriptText up to 4000 chars & sfxVolumeDb up to -4
  assert.throws(() =>
    autoEdit.agentAutoEditGenerationSchema.parse({
      title: "T",
      summary: "S",
      hookHeadline: "H",
      segments: [{ id: "s1", clipId: "c1", sourceStartMs: 2000, sourceEndMs: 2000, keep: true }],
    }),
  );
  const longText = "a".repeat(3500);
  const validParsed = autoEdit.agentAutoEditGenerationSchema.parse({
    title: "T",
    summary: "S",
    hookHeadline: "H",
    segments: [{ id: "s1", clipId: "c1", sourceStartMs: 500, sourceEndMs: 3500, keep: true, transcriptText: longText }],
    overlays: [{ id: "ov_1", kind: "callout_pill", title: "OK", sfxVolumeDb: -4 }],
  });
  assert.equal(validParsed.segments[0].transcriptText.length, 3500);
  assert.equal(validParsed.overlays[0].sfxVolumeDb, -4);
}

// 7. Verify computeAutoEditTimeline graceful fallback when anchorSegmentId is cut (keep: false)
{
  const edlWithCutAnchors = {
    schema: "auto-edit-edl.v1",
    title: "Cut Anchor Test",
    summary: "Ensure hook_banner & product_card survive when anchored segment is cut",
    hookHeadline: "HOOK KHÔNG BIẾN MẤT",
    captionStyle: "karaoke-pop",
    segments: [
      { id: "seg_01", clipId: "clip_01", sourceStartMs: 0, sourceEndMs: 1500, keep: false, cutReason: "manual", zoom: 1, zoomFocusY: 0.38, transcriptText: "" },
      { id: "seg_02", clipId: "clip_01", sourceStartMs: 1500, sourceEndMs: 5500, keep: true, zoom: 1, zoomFocusY: 0.38, transcriptText: "Đoạn chính" },
      { id: "seg_03", clipId: "clip_01", sourceStartMs: 5500, sourceEndMs: 7000, keep: false, cutReason: "silence", zoom: 1, zoomFocusY: 0.38, transcriptText: "" },
    ],
    overlays: [
      { id: "ov_hook_01", kind: "hook_banner", anchorSegmentId: "seg_01", offsetMs: 0, durationMs: 2500, layout: "center-pop", title: "HOOK ĐẦU" },
      { id: "ov_prod_01", kind: "product_card", anchorSegmentId: "seg_03", offsetMs: 400, durationMs: 2000, layout: "floating-right", title: "Thẻ cuối" },
      { id: "ov_unknown", kind: "callout_pill", anchorSegmentId: "seg_missing", offsetMs: 800, durationMs: 1200, layout: "center-pop", title: "Fallback offset" },
    ],
    keywordHighlights: [],
    directorNotes: [],
  };

  const timeline = autoEdit.computeAutoEditTimeline(edlWithCutAnchors, [], "9:16", 7000, { autoSfx: false });
  assert.equal(timeline.totalDurationMs, 4000);
  const hook = timeline.overlays.find((o) => o.id === "ov_hook_01");
  assert.ok(hook, "Expected hook_banner anchored to cut seg_01 to survive via fallback");
  assert.equal(hook.timelineStartMs, 0);

  const prod = timeline.overlays.find((o) => o.id === "ov_prod_01");
  assert.ok(prod, "Expected product_card anchored to trailing cut seg_03 to survive via previous kept segment");
  assert.equal(prod.timelineStartMs, 400);

  const unknown = timeline.overlays.find((o) => o.id === "ov_unknown");
  assert.ok(unknown);
  assert.equal(unknown.timelineStartMs, 800);
}

// 8. Verify FFmpeg post-scale crop expressions, orientation framing, blur-canvas fgH, silent guard & Pango escape
{
  // Vertical 9:16 source inside 1:1 or 16:9 MUST stay "cover" at 1.0x (never switch from contain sidebars to cover!)
  const vertInSquare1x = autoEditRender.buildSegmentFramingFilter({
    width: 1080,
    height: 1080,
    fps: 30,
    zoom: 1.0,
    zoomFocusY: 0.38,
    isLandscapeSource: false,
    verticalFit: "auto",
    clipWidth: 720,
    clipHeight: 1280,
  });
  assert.equal(vertInSquare1x.mode, "cover");
  assert.ok(vertInSquare1x.vf.includes("(iw-1080)/2"));
  assert.ok(vertInSquare1x.vf.includes("min(ih-1080\\,max(0\\,(ih-1080)*0.380))"));

  const vertInWide1x = autoEditRender.buildSegmentFramingFilter({
    width: 1280,
    height: 720,
    fps: 30,
    zoom: 1.0,
    zoomFocusY: 0.38,
    isLandscapeSource: false,
    verticalFit: "auto",
    clipWidth: 720,
    clipHeight: 1280,
  });
  assert.equal(vertInWide1x.mode, "cover");

  // Landscape 16:9 source inside 16:9 at 1.0x uses "contain", and at 1.12x uses "cover"
  const landInWide1x = autoEditRender.buildSegmentFramingFilter({
    width: 1280,
    height: 720,
    fps: 30,
    zoom: 1.0,
    zoomFocusY: 0.38,
    isLandscapeSource: true,
    verticalFit: "auto",
    clipWidth: 1920,
    clipHeight: 1080,
  });
  assert.equal(landInWide1x.mode, "contain");

  // Landscape 16:9 in 9:16 blur-fit keeps fgH constant across zoom 1.0x and 1.2x
  const blur1x = autoEditRender.buildSegmentFramingFilter({
    width: 720,
    height: 1280,
    fps: 30,
    zoom: 1.0,
    zoomFocusY: 0.4,
    isLandscapeSource: true,
    verticalFit: "blur-fit",
    clipWidth: 1920,
    clipHeight: 1080,
  });
  const blur12x = autoEditRender.buildSegmentFramingFilter({
    width: 720,
    height: 1280,
    fps: 30,
    zoom: 1.2,
    zoomFocusY: 0.4,
    isLandscapeSource: true,
    verticalFit: "blur-fit",
    clipWidth: 1920,
    clipHeight: 1080,
  });
  assert.equal(blur1x.mode, "blur-canvas");
  assert.equal(blur12x.mode, "blur-canvas");
  assert.equal(blur1x.fgH, 406);
  assert.equal(blur12x.fgH, 406);
  assert.ok(blur12x.filterComplex.includes("crop=720:406:(iw-720)/2:min(ih-406\\,max(0\\,(ih-406)*0.400))"));

  // Silent / quiet room guard
  assert.equal(
    autoEditRender.shouldSkipVoiceNormalization({
      videos: [{ id: "c1", filename: "a.mp4", extension: ".mp4", size: 1, order: 0, hasAudio: false }],
      analysis: { transcriptKind: "acoustic_only", rawDurationMs: 3000, words: [], pauses: [] },
    }),
    true,
  );
  assert.equal(
    autoEditRender.shouldSkipVoiceNormalization({
      videos: [{ id: "c1", filename: "a.mp4", extension: ".mp4", size: 1, order: 0, hasAudio: true }],
      analysis: { transcriptKind: "acoustic_only", rawDurationMs: 3000, inputMaxVolumeDb: -52, words: [], pauses: [] },
    }),
    true,
  );
  assert.equal(
    autoEditRender.shouldSkipVoiceNormalization({
      videos: [{ id: "c1", filename: "a.mp4", extension: ".mp4", size: 1, order: 0, hasAudio: true }],
      analysis: {
        transcriptKind: "whisper_words",
        rawDurationMs: 3000,
        inputMaxVolumeDb: -18,
        words: [{ id: "w1", clipId: "c1", text: "Alo", startMs: 100, endMs: 400 }],
        pauses: [],
      },
    }),
    false,
  );

  // Pango XML escape
  assert.equal(autoEditRender.escapePangoText("Mua 1 & Tặng <2> > 50%"), "Mua 1 &amp; Tặng &lt;2&gt; &gt; 50%");
}

// 9. Verify rotation metadata, WhisperKit array report + offline model discovery, and SFX suffix byte-range
(async () => {
  // Stream rotation from non-first side_data_list item and tags.rotate fallback
  assert.equal(
    autoEditMedia.extractStreamRotationDegrees({
      side_data_list: [{}, { rotation: -90 }],
    }),
    -90,
  );
  assert.equal(
    autoEditMedia.extractStreamRotationDegrees({
      side_data_list: [{}],
      tags: { rotate: "270" },
    }),
    270,
  );

  // WhisperKit array report with <|startoftranscript|> tokens
  const wkReport = [
    {
      segments: [
        {
          start: 0,
          end: 1.5,
          words: [
            { word: "<|startoftranscript|><|vi|><|0.00|> Xin", start: 0.1, end: 0.5, probability: 0.96 },
            { word: " chào<|1.50|><|endoftext|>", start: 0.52, end: 1.1, probability: 0.98 },
          ],
        },
      ],
    },
  ];
  const wkParsed = autoEditMedia.parseWhisperJsonWords(wkReport, "clip_01");
  assert.equal(wkParsed.kind, "whisper_words");
  assert.deepEqual(wkParsed.words.map((w) => w.text), ["Xin", "chào"]);

  // WhisperKit local HuggingFace CoreML model auto-discovery (preferring large > medium > small > base)
  const tmpHf = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-wk-test-"));
  try {
    const baseDir = path.join(tmpHf, "openai_whisper-base");
    const largeDir = path.join(tmpHf, "openai_whisper-large-v3_turbo");
    const incompleteDir = path.join(tmpHf, "openai_whisper-large-v3_empty");
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, "config.json"), "{}");
    fs.mkdirSync(largeDir, { recursive: true });
    fs.writeFileSync(path.join(largeDir, "config.json"), "{}");
    fs.mkdirSync(incompleteDir, { recursive: true });

    const chosen = await autoEditMedia.resolveWhisperKitModelDir("", tmpHf);
    assert.equal(chosen, largeDir);
  } finally {
    fs.rmSync(tmpHf, { recursive: true, force: true });
  }

  // SFX byte-range parser & route handler: suffix bytes=-500 and 416 cases
  const suffixRange = autoEdit.resolveHttpByteRange("bytes=-500", 2000);
  assert.deepEqual(suffixRange, { ok: true, start: 1500, end: 1999 });
  const clampedSuffix = autoEdit.resolveHttpByteRange("bytes=-5000", 1200);
  assert.deepEqual(clampedSuffix, { ok: true, start: 0, end: 1199 });
  assert.deepEqual(autoEdit.resolveHttpByteRange("bytes=-0", 2000), { ok: false });
  assert.deepEqual(autoEdit.resolveHttpByteRange("bytes=-", 2000), { ok: false });
  assert.deepEqual(autoEdit.resolveHttpByteRange("bytes=2500-3000", 2000), { ok: false });
  assert.deepEqual(autoEdit.resolveHttpByteRange("bytes=900-400", 2000), { ok: false });

  const suffixRes = await sfxRoute.GET(
    { headers: new Headers({ range: "bytes=-500" }) },
    { params: Promise.resolve({ sfxId: "tada" }) },
  );
  assert.equal(suffixRes.status, 206);
  assert.equal(suffixRes.body.byteLength, 500);

  const invalidRangeRes = await sfxRoute.GET(
    { headers: new Headers({ range: "bytes=999999999-999999999" }) },
    { params: Promise.resolve({ sfxId: "tada" }) },
  );
  assert.equal(invalidRangeRes.status, 416);

  // 10. Verify Pro Visual Pack: stage-3d, spotlight_box, highlighter, freeze_frame & aurora-3d framing
  {
    const videos = [{ id: "clip_01", filename: "tut.mp4", extension: ".mp4", size: 1000, order: 0, durationMs: 12000 }];
    const images = [{ id: "img_01", filename: "ui.png", extension: ".png", size: 500, width: 800, height: 600, label: "UI" }];
    const options = autoEdit.autoEditOptionsSchema.parse({
      productName: "StoryAI",
      verticalFit: "aurora-3d",
      motionBlur: true,
      autoSfx: true,
    });
    assert.equal(options.verticalFit, "aurora-3d");
    assert.equal(options.motionBlur, true);

    const edl = autoEdit.normalizeAgentAutoEditEdl(
      {
        title: "Pro FX Test",
        summary: "Test 3D stage & hand-drawn spotlight annotations",
        hookHeadline: "PRO FX DEMO",
        segments: [{ id: "seg_01", clipId: "clip_01", sourceStartMs: 0, sourceEndMs: 10000, keep: true, zoom: 1 }],
        overlays: [
          { id: "ov_3d", kind: "product_card", anchorSegmentId: "seg_01", offsetMs: 1000, durationMs: 3000, imageId: "img_01", layout: "stage-3d", title: "Thẻ 3D" },
          { id: "ov_spot", kind: "spotlight_box", anchorSegmentId: "seg_01", offsetMs: 4200, durationMs: 2500, title: "Bấm nút này", targetX: 0.32, targetY: 0.78, targetW: 0.24, targetH: 0.12 },
          { id: "ov_hl", kind: "highlighter", anchorSegmentId: "seg_01", offsetMs: 6800, durationMs: 2000, title: "Wan 3.0", targetX: 0.3, targetY: 0.82, targetW: 0.22, targetH: 0.06 },
          { id: "ov_frz", kind: "freeze_frame", anchorSegmentId: "seg_01", offsetMs: 8900, durationMs: 1000, title: "Hoàn tất kết nối" },
        ],
      },
      videos,
      images,
      [],
      [],
      options,
    );

    const spot = edl.overlays.find((o) => o.id === "ov_spot");
    assert.ok(spot);
    assert.equal(spot.targetX, 0.32);
    assert.ok(["mouse-clicks", "reveal-click"].includes(spot.sfxId));

    const frz = edl.overlays.find((o) => o.id === "ov_frz");
    assert.ok(frz);
    assert.equal(frz.sfxId, "camera-shutter");

    const card3d = edl.overlays.find((o) => o.id === "ov_3d");
    assert.ok(card3d);
    assert.equal(card3d.layout, "stage-3d");

    const auroraFilter = autoEditRender.buildSegmentFramingFilter({
      width: 720,
      height: 1280,
      fps: 30,
      zoom: 1.0,
      zoomFocusY: 0.4,
      isLandscapeSource: true,
      verticalFit: "aurora-3d",
      clipWidth: 1662,
      clipHeight: 1080,
    });
    assert.equal(auroraFilter.mode, "aurora-stage");
    assert.ok(auroraFilter.filterComplex.includes("colorbalance="));
    assert.ok(auroraFilter.filterComplex.includes("overlay=(W-w)/2:(H-h)/2"));
  }

  // 11. Verify 12 Multi-Topic Templates & Local Zero-Copy unlimited GB staging
  {
    assert.equal(autoEdit.AUTO_EDIT_PRESETS.length, 12);
    const sfxLib = loadTsModule("app/lib/sfx-library.ts");
    for (const tpl of autoEdit.AUTO_EDIT_PRESETS) {
      const parsed = autoEdit.autoEditOptionsSchema.parse({ preset: tpl.id });
      assert.equal(parsed.preset, tpl.id);
      const sfx = sfxLib.pickDefaultOverlaySfx({ kind: "product_card", title: "Demo" }, 0, tpl.id);
      assert.ok(sfxLib.isValidSfxId(sfx), `Invalid SFX ${sfx} for template ${tpl.id}`);
    }

    const uploadLib = loadTsModule("app/lib/auto-edit-upload.ts");
    assert.equal(uploadLib.maxAutoEditVideoBytes, Number.MAX_SAFE_INTEGER);

    const localFilesLib = loadTsModule("app/lib/auto-edit-local-files.ts");
    assert.equal(
      localFilesLib.isLocalLoopbackRequest(new Request("http://localhost:3012/api/auto-edit/local-files", { headers: { host: "localhost:3012", origin: "http://localhost:3012" } })),
      true,
    );
    assert.equal(
      localFilesLib.isLocalLoopbackRequest(new Request("https://storyai.example.com/api/auto-edit/local-files", { headers: { host: "storyai.example.com" } })),
      false,
    );

    // Verify Zero-Copy symlink staging against a real MP4 deliverable without copying bytes
    const sampleVideo = path.join(__dirname, "..", "deliverables", "auto-edit-ongQkJLhMqo.mp4");
    if (fs.existsSync(sampleVideo)) {
      const picked = await localFilesLib.resolvePastedLocalPaths("unit-test-owner", [sampleVideo], "video");
      assert.equal(picked.length, 1);
      assert.ok(picked[0].token.startsWith("lf_"));
      const testJobId = "00000000-0000-4000-8000-000000009999";
      const jobDir = uploadLib.autoEditJobMediaDir("unit-test-owner", testJobId);
      try {
        const staged = await localFilesLib.stageZeroCopyLocalAutoEditJob("unit-test-owner", testJobId, [picked[0].token], [], []);
        assert.equal(staged.videos.length, 1);
        const linkedClip = path.join(jobDir, "videos", "clip_01.mp4");
        const lstat = fs.lstatSync(linkedClip);
        assert.equal(lstat.isSymbolicLink(), true, "Expected clip_01.mp4 to be a zero-copy symlink");
        const probed = await autoEditMedia.probeAutoEditVideo(linkedClip);
        assert.ok(probed.durationMs > 1000);
      } finally {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    }
  }

  // 12. Verify Motion Video (8) & Auto Edit (12) Template Preview Demo Builders
  {
    const motionVideo = loadTsModule("app/lib/motion-video.ts");
    const previewLib = loadTsModule("app/lib/video-template-previews.ts");

    assert.equal(motionVideo.CREATE_VIDEO_PRESETS.length, 8);
    for (const preset of motionVideo.CREATE_VIDEO_PRESETS) {
      assert.ok(previewLib.MOTION_PRESET_PREVIEW_META[preset.id], `Missing preview meta for Motion preset ${preset.id}`);
      const plan = previewLib.buildMotionVideoPresetDemoPlan(preset.id);
      assert.equal(plan.schema, "create-video-plan.v1");
      assert.ok(plan.scenes.length >= 3, `Expected >= 3 demo scenes for ${preset.id}`);
      const timeline = motionVideo.computeCreateVideoTimeline(plan, preset.recommendedAspect, [], { autoSfx: true });
      assert.ok(timeline.totalFrames >= 90, `Expected >= 90 frames for ${preset.id}`);
      assert.equal(timeline.scenes.length, plan.scenes.length);
      const tokenSet = new Set(
        timeline.words.map((w) => w.text.replace(/[.,!?;:"'()]/gu, "").trim().toLowerCase()),
      );
      for (const hl of plan.keywordHighlights) {
        assert.ok(
          tokenSet.has(hl.word.trim().toLowerCase()),
          `Motion demo highlight "${hl.word}" not found in timeline words for ${preset.id}`,
        );
      }
    }

    assert.equal(autoEdit.AUTO_EDIT_PRESETS.length, 12);
    for (const preset of autoEdit.AUTO_EDIT_PRESETS) {
      assert.ok(previewLib.AUTO_EDIT_PRESET_PREVIEW_META[preset.id], `Missing preview meta for Auto Edit preset ${preset.id}`);
      const demo = previewLib.buildAutoEditPresetDemoData(preset.id);
      assert.equal(demo.edl.schema, "auto-edit-edl.v1");
      assert.ok(demo.words.length >= 4, `Expected >= 4 demo words for ${preset.id}`);
      assert.ok(demo.edl.overlays.every((ov) => !ov.imageId), `Demo overlays should not reference imageId for ${preset.id}`);
      const timeline = autoEdit.computeAutoEditTimeline(demo.edl, demo.words, preset.recommendedAspect, demo.rawDurationMs, { autoSfx: true });
      assert.ok(timeline.keptSegments.length >= 2, `Expected >= 2 kept segments for ${preset.id}`);
      assert.ok(timeline.cutCount >= 1, `Expected >= 1 cut segment for ${preset.id}`);
      assert.ok(timeline.overlays.length >= 2, `Expected >= 2 overlays for ${preset.id}`);
      assert.equal(
        timeline.words.length,
        demo.words.length,
        `Expected all demo words to survive segment clamping for ${preset.id}`,
      );
      assert.ok(
        timeline.words.some((w) => Boolean(w.highlightColor)),
        `Expected at least one highlighted word in ${preset.id}`,
      );
    }
  }

  console.log("auto-edit-engine tests passed!");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

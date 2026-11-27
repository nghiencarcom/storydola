const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadModule(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    URL,
    Buffer,
    process,
    AbortSignal,
    DOMException,
    setTimeout,
    clearTimeout,
    console,
    require: (id) => imports[id] ?? require(id),
  });
  return exports;
}

const { makeRemakeWindows, mergeRemakeWindows, remakeInputSchema } = loadModule("video-remake", {
  "./ai-drama-scene-timing": loadModule("ai-drama-scene-timing"),
  "./project-types": loadModule("project-types"),
});

for (const [sourceSeconds, step, expected] of [
  [5.06, 5, [5]],
  [12, 5, [5, 5, 5]],
  [24, 10, [10, 10, 5]],
  [25.06, 15, [15, 10]],
  [25.8, 15, [15, 15]],
  [0.08, 10, [5]],
  [120, 15, [15, 15, 15, 15, 15, 15, 15, 15]],
]) {
  const windows = makeRemakeWindows(sourceSeconds, step);
  assert.deepEqual(Array.from(windows, ({ duration }) => duration), expected);
  assert.equal(windows.at(-1).sourceEnd, sourceSeconds);
  for (const [index, window] of windows.entries()) {
    assert.equal(window.sourceStart, windows[index - 1]?.sourceEnd || 0);
    assert.equal(window.start, windows[index - 1]?.end || 0);
    assert.equal(window.end - window.start, window.duration);
  }
}

assert.equal(makeRemakeWindows(7200, 5).length, 1440);
const source = makeRemakeWindows(27.4, 5);
const merged = mergeRemakeWindows(source, [3, 2, 1]);
assert.deepEqual(Array.from(merged, ({ duration }) => duration), [15, 10, 5]);
assert.equal(merged.at(-1).sourceEnd, 27.4);
assert.throws(() => mergeRemakeWindows(source, [1]));
assert.throws(() => mergeRemakeWindows(source, [3, 3, 1]));

const { classifyRemakeSource } = loadModule("video-remake-source");
for (const [value, platform, canonical, short] of [
  ["https://youtu.be/jNQXAC9IVRw?si=a", "youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw", false],
  ["https://m.facebook.com/example/videos/topic/123456/", "facebook", "https://www.facebook.com/watch/?v=123456", false],
  ["https://facebook.com/reel/123456?tracking=a", "facebook", "https://www.facebook.com/reel/123456/", false],
  ["https://fb.watch/a_bc/?tracking=a", "facebook", "https://fb.watch/a_bc/", true],
  ["https://www.facebook.com/share/r/abcdef/", "facebook", "https://www.facebook.com/share/r/abcdef/", true],
  ["https://www.tiktok.com/@example/video/123456789", "tiktok", "https://www.tiktok.com/@example/video/123456789", false],
  ["https://m.tiktok.com/v/7123456789.html", "tiktok", "https://www.tiktok.com/share/video/7123456789", false],
  ["https://m.tiktok.com/v/7123456789/", "tiktok", "https://www.tiktok.com/share/video/7123456789", false],
  ["https://vm.tiktok.com/ZX123/", "tiktok", "https://vm.tiktok.com/ZX123/", true],
  ["https://www.iesdouyin.com/share/video/123456/", "douyin", "https://www.douyin.com/video/123456", false],
  ["https://v.douyin.com/ZX123/", "douyin", "https://v.douyin.com/ZX123/", true],
  ["https://instagram.com/reel/ABC123/?igsh=a", "instagram", "https://www.instagram.com/reel/ABC123/", false],
]) {
  const result = classifyRemakeSource(new URL(value));
  assert.equal(result.platform, platform);
  assert.equal(result.url, canonical);
  assert.equal(result.short, short);
}
assert.equal(classifyRemakeSource(new URL("https://facebook.com.example.test/video.mp4")), undefined);
assert.throws(() => classifyRemakeSource(new URL("https://www.facebook.com/flx/warn/?u=https://example.test")));
assert.throws(() => classifyRemakeSource(new URL("https://www.youtube.com/playlist?list=PL123")));
assert.throws(() => classifyRemakeSource(new URL("https://user@example.test/file.mp4")));

const input = { url: "https://example.test/video.mp4", language: "vi" };
assert.equal(remakeInputSchema.safeParse(input).success, true);
assert.equal(remakeInputSchema.parse({ ...input, sceneSeconds: 5 }).sceneSeconds, undefined);
assert.equal(remakeInputSchema.safeParse({ ...input, url: "http://localhost/video.mp4" }).success, false);
assert.equal(remakeInputSchema.safeParse({ ...input, url: "not-a-url" }).success, false);

async function runAsyncChecks() {
  const EventEmitter = require("node:events");
  let mockProbeOutput = {};
  let mockHttpHandler = () => ({ statusCode: 200, headers: {} });
  const observedFamilies = [];

  const mediaModule = loadModule("video-remake-media", {
    "node:child_process": {
      execFile: (_cmd, _args, _opts, cb) => {
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(null, { stdout: JSON.stringify(mockProbeOutput), stderr: "" });
      },
    },
    "node:dns/promises": {
      lookup: async () => [
        { address: "2606:4700:4700::1111", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ],
    },
    "node:https": {
      get: (url, options, onResponse) => {
        observedFamilies.push(options.family);
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.destroy = () => {};
        process.nextTick(() => {
          try {
            const res = mockHttpHandler(url);
            res.destroy = () => {};
            onResponse(res);
          } catch (err) {
            req.emit("error", err);
          }
        });
        return req;
      },
    },
    sharp: () => ({}),
    "./public-product-page": { isPublicIp: () => true },
    "./source-ingest": { ingestSourceUrl: async () => undefined },
    "./video-remake": { makeRemakeWindows },
    "./video-remake-source": { classifyRemakeSource },
    "./video-remake-maivideo": { downloadFromMaiVideo: async () => "" },
  });

  // iPhone Dolby Vision HDR: rotation is on side_data_list[1], not side_data_list[0].
  mockProbeOutput = {
    format: { duration: "12.5" },
    streams: [{
      codec_type: "video",
      width: 1920,
      height: 1080,
      duration: "12.5",
      side_data_list: [{ side_data_type: "DOVI configuration record" }, { rotation: -90 }],
    }],
  };
  const hdrVideo = await mediaModule.probeVideo("/tmp/iphone-hdr.mov");
  assert.equal(hdrVideo.aspectRatio, "9:16");

  // Legacy rotate tag fallback.
  mockProbeOutput = {
    format: { duration: "8.0" },
    streams: [{
      codec_type: "video",
      width: 1920,
      height: 1080,
      tags: { rotate: "90" },
    }],
  };
  const rotatedTagVideo = await mediaModule.probeVideo("/tmp/rotated-tag.mp4");
  assert.equal(rotatedTagVideo.aspectRatio, "9:16");

  // Prefer IPv4 when DNS returns both AAAA and A records, and fall back to classified short link on login redirect or failure.
  const fbShort = classifyRemakeSource(new URL("https://www.facebook.com/share/r/abcdef/"));
  mockHttpHandler = () => ({ statusCode: 302, headers: { location: "https://www.facebook.com/login/?next=abc" } });
  const fbFallback = await mediaModule.resolvePlatformLink(fbShort);
  assert.equal(fbFallback.url, "https://www.facebook.com/share/r/abcdef/");
  assert.equal(observedFamilies[0], 4);

  mockHttpHandler = () => { throw new Error("ETIMEDOUT"); };
  const tiktokShort = classifyRemakeSource(new URL("https://vm.tiktok.com/ZX123/"));
  const tiktokFallback = await mediaModule.resolvePlatformLink(tiktokShort);
  assert.equal(tiktokFallback.url, "https://vm.tiktok.com/ZX123/");

  mockHttpHandler = () => ({ statusCode: 302, headers: { location: "https://www.facebook.com/reel/987654321/" } });
  const fbResolved = await mediaModule.resolvePlatformLink(fbShort);
  assert.equal(fbResolved.url, "https://www.facebook.com/reel/987654321/");
  assert.equal(fbResolved.short, false);

  // Muted audio track handling: all-silent PCM returns [] and silent windows never emit [0, duration] pauses.
  const sampleRate = 500;
  const twoWindows = makeRemakeWindows(10, 5);
  const mutedPcm = Buffer.alloc(10 * sampleRate * 2, 0);
  assert.deepEqual(Array.from(mediaModule.extractAudioWindowCues(mutedPcm, sampleRate, twoWindows)), []);

  const halfMutedPcm = Buffer.alloc(10 * sampleRate * 2, 0);
  for (let i = 6 * sampleRate; i < 10 * sampleRate; i++) halfMutedPcm.writeInt16LE(4000, i * 2);
  const halfCues = mediaModule.extractAudioWindowCues(halfMutedPcm, sampleRate, twoWindows);
  assert.equal(halfCues.length, 2);
  assert.equal(halfCues[0].rmsDb, null);
  assert.deepEqual(Array.from(halfCues[0].pauses), []);
  assert.ok(halfCues[1].rmsDb !== null);

  // Continuity QA variable-duration AI Drama timeline check (5s + 10s + 5s + 15s = 35s, zero false timeline_gap).
  const { buildContinuityQaReport } = loadModule("continuity-qa", {
    "./scene-store": {
      readProjectScenes: async () => [
        { id: "S001", chunkId: "A01", start_sec: 0, end_sec: 5, continuity_in: "Start A", continuity_out: "Door opens" },
        { id: "S002", chunkId: "A01", start_sec: 5, end_sec: 15, continuity_in: "Door opens", continuity_out: "Hallway step" },
        { id: "S003", chunkId: "A01", start_sec: 15, end_sec: 20, continuity_in: "Hallway step", continuity_out: "Window light" },
        { id: "S004", chunkId: "A02", start_sec: 20, end_sec: 35, continuity_in: "Window light", continuity_out: "Final nod" },
      ],
    },
  });
  const qaReport = await buildContinuityQaReport({
    presetId: "ai-drama",
    totalScenes: 4,
    sceneDurationSec: 15,
  });
  assert.equal(qaReport.checks.timing, "pass");
  assert.equal(qaReport.issues.filter((i) => i.code === "timeline_gap").length, 0);
  assert.equal(qaReport.status, "passed");

  // AI Drama project preservation in updateProjectRecord when editing style/genre/dramaPlan on imported Remake project.
  const projectTypes = loadModule("project-types");
  const visualStyles = loadModule("visual-styles");
  const contentGenres = loadModule("content-genres");
  const { updateProjectRecord } = loadModule("server-store", {
    "next/headers": { headers: async () => new Map() },
    "./project-types": projectTypes,
    "./media-generation-settings": { resolveMediaGenerationSettings: (v) => v || {} },
    "./story-presets": { isFlowStoryOnlyPreset: () => false },
    "./script-utils": { getManualScriptMetrics: () => ({ durationSeconds: 0, sceneCount: 0 }) },
    "./story-context": { continuityContextFromOutput: () => undefined },
    "./visual-styles": visualStyles,
    "./content-genres": contentGenres,
    "./data-directory": { DATA_DIR: "/tmp/storyai-unused-test" },
  });
  const importedProject = {
    id: "project-1",
    slug: "remake-test",
    title: "Remake Phim",
    presetId: "ai-drama",
    scriptMode: "ai",
    scriptFormat: "plain_text",
    durationMode: "manual",
    durationSeconds: 610,
    durationMinutes: 10.167,
    sceneDurationSec: 15,
    chunkSize: 40,
    totalScenes: 119,
    completedScenes: 119,
    totalChunks: 3,
    completedChunks: 3,
    status: "needs_review",
    sourceUrl: "",
    sourceText: "CHAPTER PLAN",
    language: "vi",
    aspectRatio: "9:16",
    contentGenre: "comedy",
    secondaryGenres: [],
    storySetting: "modern",
    settingNotes: "",
    visualStyle: "Warm & emotional",
    imageStyle: "Stylized 3D",
    mediaSource: "maivideo-video",
    chunks: [
      { id: "A01", sceneStart: 1, sceneEnd: 57, generatedScenes: 57, status: "completed", outputPath: "data/outputs/remake-test/A01.json", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "A02", sceneStart: 58, sceneEnd: 117, generatedScenes: 60, status: "completed", outputPath: "data/outputs/remake-test/A02.json", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "A03", sceneStart: 118, sceneEnd: 119, generatedScenes: 2, status: "completed", outputPath: "data/outputs/remake-test/A03.json", updatedAt: "2026-01-01T00:00:00Z" },
    ],
    render: { status: "completed", outputPath: "data/renders/remake-test/final.mp4", updatedAt: "2026-01-01T00:00:00Z" },
  };
  const editedStyleProject = updateProjectRecord(importedProject, {
    imageStyle: "2D anime",
    contentGenre: "action",
    language: "en",
  });
  assert.equal(editedStyleProject.totalScenes, 119);
  assert.equal(editedStyleProject.completedScenes, 119);
  assert.equal(editedStyleProject.chunks.length, 3);
  assert.equal(editedStyleProject.chunks[0].outputPath, "data/outputs/remake-test/A01.json");
  assert.equal(editedStyleProject.status, "needs_review");
  assert.equal(editedStyleProject.render.stale, true);

  console.log("Passed remake windows, fractional boundaries, public platform links, HDR rotation, short-link fallback, muted audio, continuity QA and AI Drama preservation.");
}

runAsyncChecks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

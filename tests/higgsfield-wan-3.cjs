const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sharp = require("sharp");

const cache = new Map();
const stubs = {
  "./sales-video-checkpoint": { videoCheckpoint: async () => ({}) },
  "./provider-submission-checkpoint": { checkpointProviderSubmission: async () => {} },
  "./provider-request-retry": { providerRequestWithRetry: async (_signal, fn) => fn() },
  "./seedance-accounts": {
    getSeedanceApiKey: async () => "test-seedance-key",
    getSeedanceApiSessionToken: async () => "test-session-token",
  },
  "./maivideo-api-keys": { getMaiVideoApiKey: async () => "" },
  "./auth-server": { getCurrentUserId: async () => "test-user" },
  "./data-directory": { dataPath: (...parts) => path.join(process.cwd(), "data", ...parts) },
};

function loadTs(filePath) {
  const resolved = path.resolve(filePath);
  if (cache.has(resolved)) return cache.get(resolved);
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  const source = fs.readFileSync(resolved, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const dir = path.dirname(resolved);
  const fn = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${outputText}\n})`,
    { filename: resolved },
  );
  fn(
    module.exports,
    (id) => {
      if (stubs[id]) return stubs[id];
      if (id.startsWith(".")) {
        const tsCandidate = path.resolve(dir, `${id}.ts`);
        if (fs.existsSync(tsCandidate)) return loadTs(tsCandidate);
        const tsxCandidate = path.resolve(dir, `${id}.tsx`);
        if (fs.existsSync(tsxCandidate)) return loadTs(tsxCandidate);
      }
      return require(id);
    },
    module,
    resolved,
    dir,
  );
  cache.set(resolved, module.exports);
  return module.exports;
}

const settings = loadTs("app/lib/media-generation-settings.ts");
const provider = loadTs("app/lib/media-provider.ts");
const salesTemplates = loadTs("app/lib/sales-video-templates.ts");

(async () => {
  // 1. Settings & display names
  assert.equal(settings.HIGGSFIELD_WAN_3_MODEL_ID, "higgsfield-wan-3.0");
  assert.equal(settings.isHiggsfieldWanModel("higgsfield-wan-3.0"), true);
  assert.equal(settings.isHiggsfieldWanModel("wan3_0"), true);
  assert.equal(settings.isHiggsfieldWanModel("wan-3.0"), false);
  assert.equal(settings.isHiggsfieldSeedanceModel("higgsfield-wan-3.0", "higgsfield"), false);
  assert.equal(settings.isHiggsfieldSeedanceModel("higgsfield-seedance-2.0", "higgsfield"), true);
  assert.equal(settings.isHiggsfieldVideoModel("higgsfield-wan-3.0", "higgsfield"), true);
  assert.equal(settings.videoModelDisplayName("higgsfield-wan-3.0", "higgsfield"), "Wan 3.0 · Higgsfield");
  assert.equal(settings.videoModelDisplayName("higgsfield-seedance-2.0", "higgsfield"), "Seedance 2.0 · Higgsfield");

  const resolvedWan = settings.resolveMediaGenerationSettings({
    videoProvider: "higgsfield",
    videoModel: "higgsfield-wan-3.0",
    videoQuality: "1080p",
    videoDurationMode: "fixed",
    videoDurationSec: 25,
    videoAudio: true,
  });
  assert.equal(resolvedWan.videoProvider, "higgsfield");
  assert.equal(resolvedWan.videoModel, "higgsfield-wan-3.0");
  assert.equal(resolvedWan.videoQuality, "720p");
  assert.equal(resolvedWan.videoDurationSec, 25);
  assert.equal(resolvedWan.videoAudio, true);

  const resolvedDefaultWanQuality = settings.resolveMediaGenerationSettings({
    videoProvider: "higgsfield",
    videoModel: "higgsfield-wan-3.0",
    videoQuality: "480p",
    videoDurationSec: 1,
  });
  assert.equal(resolvedDefaultWanQuality.videoQuality, "720p");
  assert.equal(resolvedDefaultWanQuality.videoDurationSec, 2);

  const resolvedInferredProvider = settings.resolveMediaGenerationSettings({
    videoProvider: undefined,
    videoModel: "higgsfield-wan-3.0",
  });
  assert.equal(resolvedInferredProvider.videoProvider, "higgsfield");
  assert.equal(resolvedInferredProvider.videoModel, "higgsfield-wan-3.0");

  // 2. Catalog & sales video helper exposure
  const catalog = await provider.getMaiVideoModelCatalog("test-user");
  const wanCatalogModel = catalog.videoModels.find(
    (item) => item.provider === "higgsfield" && item.id === "higgsfield-wan-3.0",
  );
  assert.ok(wanCatalogModel, "Catalog must include Wan 3.0 · Higgsfield");
  assert.deepEqual(Array.from(wanCatalogModel.qualities), ["720p"]);
  assert.deepEqual(Array.from(wanCatalogModel.aspectRatios), ["16:9", "9:16", "1:1", "4:3", "3:4"]);
  assert.equal(wanCatalogModel.minDurationSec, 2);
  assert.equal(wanCatalogModel.maxDurationSec, 30);
  assert.equal(wanCatalogModel.maxReferenceImages, 10);
  assert.equal(wanCatalogModel.promptMaxLength, 12_000);
  assert.equal(wanCatalogModel.supportsAudio, true);

  const salesHiggsfieldModels = salesTemplates.salesVideoHiggsfieldModels(catalog.videoModels, undefined, "9:16", true);
  assert.ok(salesHiggsfieldModels.some((item) => item.id === "higgsfield-wan-3.0"));
  assert.deepEqual(
    Array.from(salesTemplates.salesVideoDurationOptions(wanCatalogModel, undefined, true, wanCatalogModel.id, "720p")),
    [15, 20, 25, 30, 45, 60],
  );
  assert.deepEqual(
    Array.from(salesTemplates.salesVideoProductSegments(30, wanCatalogModel, "720p")),
    [15, 15],
  );

  // 3. Mock fetch to verify multipart request sent to /api/higgsfield/video for Wan 3.0
  const originalFetch = global.fetch;
  const requests = [];
  const tinyPngDataUrl = "data:image/png;base64," + (await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer()).toString("base64");
  const outPath = path.join(process.cwd(), "data", "tmp-test-wan3-higgsfield.mp4");
  try {
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith("/api/higgsfield/video")) {
        const entries = [];
        for (const [key, val] of init.body.entries()) {
          entries.push([key, typeof val === "string" ? val : { name: val.name, type: val.type, size: val.size }]);
        }
        requests.push({ target, headers: init.headers, entries });
        return new Response(JSON.stringify({ success: true, job: { id: "hfvid_wan3_test", status: "queued" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (target.includes("/api/higgsfield/jobs/hfvid_wan3_test")) {
        return new Response(JSON.stringify({
          success: true,
          job: {
            id: "hfvid_wan3_test",
            status: "completed",
            input_images: [{ filename: "ref1.webp", file_url: "/static/uploads/library/ref1.webp", index: 1 }],
            result: { file_url: "https://maivideo.top/files/wan3-test.mp4" },
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target === "https://maivideo.top/files/wan3-test.mp4") {
        assert.equal(init.headers["X-Auth-Token"], "member-session-token", "Same-origin Higgsfield download must send X-Auth-Token");
        return new Response(Buffer.alloc(40_000, 1), { status: 200, headers: { "Content-Type": "video/mp4" } });
      }
      throw new Error("Unexpected fetch URL: " + target);
    };

    const asset = await provider.generateSalesVideoSegment({
      prompt: "A".repeat(11_500),
      outputPath: outPath,
      aspectRatio: "21:9",
      durationSec: 22,
      references: Array.from({ length: 10 }, () => tinyPngDataUrl),
      referenceNames: Array.from({ length: 10 }, (_, idx) => `Image${idx + 1}`),
      providerAuthToken: "member-session-token",
      signal: AbortSignal.timeout(10_000),
      audio: true,
      model: wanCatalogModel,
      quality: "1080p",
    });

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert.equal(req.headers["X-Auth-Token"], "member-session-token");
    const fields = new Map();
    const refFiles = [];
    for (const [k, v] of req.entries) {
      if (k === "reference_images") refFiles.push(v);
      else fields.set(k, v);
    }
    assert.equal(fields.get("model"), "wan3_0");
    assert.equal(fields.get("aspect_ratio"), "auto");
    assert.equal(fields.get("duration"), "22");
    assert.equal(fields.get("resolution"), "720p");
    assert.equal(fields.get("sound"), "true");
    assert.equal(fields.has("mode"), false, "Wan 3.0 must NOT send mode parameter");
    assert.equal(refFiles.length, 10, "Wan 3.0 must forward up to 10 reference images");
    assert.equal(asset.model, "higgsfield-wan-3.0");
    assert.equal(asset.quality, "720p");
    assert.equal(asset.durationSec, 22);
    assert.equal(asset.provider, "maivideo-video-higgsfield");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(outPath, { force: true });
  }

  console.log("Passed: Higgsfield Wan 3.0 settings, catalog, sales video helpers, and POST /api/higgsfield/video payload.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

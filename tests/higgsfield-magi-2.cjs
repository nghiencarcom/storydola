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
  assert.equal(settings.HIGGSFIELD_MAGI_2_MODEL_ID, "higgsfield-magi-2");
  assert.equal(settings.isHiggsfieldMagi2Model("higgsfield-magi-2"), true);
  assert.equal(settings.isHiggsfieldMagi2Model("magi_2"), true);
  assert.equal(settings.isHiggsfieldMagi2Model("magi-2"), true);
  assert.equal(settings.isHiggsfieldMagi2Model("magi2"), true);
  assert.equal(settings.isHiggsfieldSeedanceModel("higgsfield-magi-2", "higgsfield"), false);
  assert.equal(settings.isHiggsfieldWanModel("higgsfield-magi-2"), false);
  assert.equal(settings.isHiggsfieldVideoModel("higgsfield-magi-2", "higgsfield"), true);
  assert.equal(settings.videoModelDisplayName("higgsfield-magi-2", "higgsfield"), "MAGI-2 · Higgsfield");

  const resolvedMagi2 = settings.resolveMediaGenerationSettings({
    videoProvider: "higgsfield",
    videoModel: "higgsfield-magi-2",
    videoQuality: "720p",
    videoDurationMode: "fixed",
    videoDurationSec: 28,
    videoAudio: true,
  });
  assert.equal(resolvedMagi2.videoProvider, "higgsfield");
  assert.equal(resolvedMagi2.videoModel, "higgsfield-magi-2");
  assert.equal(resolvedMagi2.videoQuality, "1080p");
  assert.equal(resolvedMagi2.videoDurationSec, 28);
  assert.equal(resolvedMagi2.videoAudio, true);

  const resolvedMinDurationMagi2 = settings.resolveMediaGenerationSettings({
    videoProvider: "higgsfield",
    videoModel: "magi_2",
    videoDurationSec: 1,
  });
  assert.equal(resolvedMinDurationMagi2.videoModel, "higgsfield-magi-2");
  assert.equal(resolvedMinDurationMagi2.videoDurationSec, 4);
  assert.equal(resolvedMinDurationMagi2.videoQuality, "1080p");

  // 2. Catalog & sales video helper exposure
  const catalog = await provider.getMaiVideoModelCatalog("test-user");
  const magi2CatalogModel = catalog.videoModels.find(
    (item) => item.provider === "higgsfield" && item.id === "higgsfield-magi-2",
  );
  assert.ok(magi2CatalogModel, "Catalog must include MAGI-2 · Higgsfield");
  assert.deepEqual(Array.from(magi2CatalogModel.qualities), ["1080p"]);
  assert.deepEqual(Array.from(magi2CatalogModel.aspectRatios), ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  assert.equal(magi2CatalogModel.minDurationSec, 4);
  assert.equal(magi2CatalogModel.maxDurationSec, 30);
  assert.equal(magi2CatalogModel.maxReferenceImages, 9);
  assert.equal(magi2CatalogModel.promptMaxLength, 12_000);
  assert.equal(magi2CatalogModel.supportsAudio, true);

  const salesHiggsfieldModels = salesTemplates.salesVideoHiggsfieldModels(catalog.videoModels, undefined, "9:16", true);
  assert.deepEqual(salesHiggsfieldModels.map((item) => item.id), ["higgsfield-wan-3.0", "higgsfield-magi-2"]);
  assert.deepEqual(
    Array.from(salesTemplates.salesVideoDurationOptions(magi2CatalogModel, undefined, true, magi2CatalogModel.id, "1080p")),
    [10, 15, 20, 25, 30, 45, 60],
  );

  // 3. Mock fetch to verify multipart request sent to /api/higgsfield/video for MAGI-2
  const originalFetch = global.fetch;
  const requests = [];
  const tinyPngDataUrl = "data:image/png;base64," + (await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 128, b: 255 } },
  }).png().toBuffer()).toString("base64");
  const outPath = path.join(process.cwd(), "data", "tmp-test-magi2-higgsfield.mp4");
  try {
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith("/api/higgsfield/video")) {
        const entries = [];
        for (const [key, val] of init.body.entries()) {
          entries.push([key, typeof val === "string" ? val : { name: val.name, type: val.type, size: val.size }]);
        }
        requests.push({ target, headers: init.headers, entries });
        return new Response(JSON.stringify({ success: true, job: { id: "hfvid_magi2_test", status: "queued" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (target.includes("/api/higgsfield/jobs/hfvid_magi2_test")) {
        return new Response(JSON.stringify({
          success: true,
          job: { id: "hfvid_magi2_test", status: "completed", result: { file_url: "https://maivideo.top/files/magi2-test.mp4" } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target === "https://maivideo.top/files/magi2-test.mp4") {
        return new Response(Buffer.alloc(40_000, 1), { status: 200, headers: { "Content-Type": "video/mp4" } });
      }
      throw new Error("Unexpected fetch URL: " + target);
    };

    const asset = await provider.generateSalesVideoSegment({
      prompt: "B".repeat(11_500),
      outputPath: outPath,
      aspectRatio: "auto",
      durationSec: 18,
      references: Array.from({ length: 9 }, () => tinyPngDataUrl),
      referenceNames: Array.from({ length: 9 }, (_, idx) => `Image${idx + 1}`),
      providerAuthToken: "member-session-token",
      signal: AbortSignal.timeout(10_000),
      audio: true,
      model: magi2CatalogModel,
      quality: "720p",
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
    assert.equal(fields.get("model"), "magi_2");
    assert.equal(fields.get("aspect_ratio"), "16:9", "MAGI-2 does not support auto; must fall back to 16:9");
    assert.equal(fields.get("duration"), "18");
    assert.equal(fields.get("resolution"), "1080p");
    assert.equal(fields.get("sound"), "true");
    assert.equal(fields.has("mode"), false, "MAGI-2 must NOT send mode parameter");
    assert.equal(refFiles.length, 9, "MAGI-2 must forward up to 9 reference images");
    assert.equal(asset.model, "higgsfield-magi-2");
    assert.equal(asset.quality, "1080p");
    assert.equal(asset.durationSec, 18);
    assert.equal(asset.provider, "maivideo-video-higgsfield");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(outPath, { force: true });
  }

  console.log("Passed: Higgsfield MAGI-2 settings, catalog, sales video helpers, and POST /api/higgsfield/video payload.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

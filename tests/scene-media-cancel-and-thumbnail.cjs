const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const ts = require("typescript");
const sharp = require("sharp");

function loadTsModule(filePath, mocks = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  const dir = path.dirname(path.resolve(filePath));
  const customRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith(".")) {
      const candidateTs = path.resolve(dir, `${specifier}.ts`);
      if (fs.existsSync(candidateTs)) return loadTsModule(candidateTs, mocks);
      const candidateTsx = path.resolve(dir, `${specifier}.tsx`);
      if (fs.existsSync(candidateTsx)) return loadTsModule(candidateTsx, mocks);
    }
    return require(specifier);
  };
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", transpiled);
  fn(mod.exports, customRequire, mod, path.resolve(filePath), dir);
  return mod.exports;
}

async function run() {
  // 1. Test video-queue-runtime AbortController lifecycle
  const runtime = loadTsModule("app/lib/video-queue-runtime.ts");
  const testJobId = "vjob-test-cancel-1";
  assert.equal(runtime.claimVideoQueueJob(testJobId), true);
  assert.equal(runtime.claimVideoQueueJob(testJobId), false);
  assert.equal(runtime.isVideoQueueJobActive(testJobId), true);
  const sig = runtime.getVideoQueueJobSignal(testJobId);
  assert.ok(sig && sig.aborted === false);
  runtime.abortVideoQueueJob(testJobId, new Error("VIDEO_QUEUE_JOB_CANCELLED"));
  assert.equal(sig.aborted, true);
  runtime.releaseVideoQueueJob(testJobId);
  assert.equal(runtime.isVideoQueueJobActive(testJobId), false);
  assert.equal(runtime.claimVideoQueueJob(testJobId), true);
  runtime.releaseVideoQueueJob(testJobId);
  console.log("OK: video-queue-runtime abort lifecycle");

  // 2. Test thumbnail-overlay helpers & real PNG compositing with NotoSans-Bold
  const overlay = loadTsModule("app/lib/thumbnail-overlay.ts");
  assert.equal(
    overlay.resolveThumbnailOverlayPlacement("Chừa vùng tối trống bên phải cho chữ", "space on the right"),
    "right",
  );
  assert.equal(
    overlay.resolveThumbnailOverlayPlacement("Đặt chữ lớn ở vùng tối trống phía trên trái", ""),
    "top-left",
  );
  assert.equal(
    overlay.resolveThumbnailOverlayPlacement("Đặt “NGƯỜI NHÀ?” thật lớn ở vùng trống bên trái", ""),
    "left",
  );
  assert.equal(
    overlay.shouldUseRedOverlayBadge("trên mảng nền đỏ gọn để tăng tương phản"),
    true,
  );
  assert.equal(
    overlay.shouldUseRedOverlayBadge("có viền tối mảnh để tách nền"),
    false,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-thumb-test-"));
  try {
    const baseImg = path.join(tmpDir, "base.png");
    const outRight = path.join(tmpDir, "out-right.png");
    const outRedLeft = path.join(tmpDir, "out-red-left.png");
    await sharp({
      create: { width: 1280, height: 720, channels: 4, background: { r: 30, g: 55, b: 80, alpha: 1 } },
    }).png().toFile(baseImg);

    await overlay.renderThumbnailOverlay({
      baseImagePath: baseImg,
      outputPath: outRight,
      overlayText: "CÓ THẬT?",
      layoutNote: "Chừa vùng tối trống bên phải cho chữ sans-serif thẳng, rất lớn, đậm: “CÓ” trắng, “THẬT?” vàng.",
      prompt: "empty dark-green space on the right",
    });
    const meta1 = await sharp(outRight).metadata();
    assert.equal(meta1.width, 1280);
    assert.equal(meta1.height, 720);
    assert.ok(fs.statSync(outRight).size > fs.statSync(baseImg).size);

    await overlay.renderThumbnailOverlay({
      baseImagePath: baseImg,
      outputPath: outRedLeft,
      overlayText: "BỊ PHÁT HIỆN?",
      layoutNote: "Đặt chữ lớn ở vùng tối trống phía trên trái trên mảng nền đỏ gọn để tăng tương phản.",
      prompt: "reserve a clean darker area in the upper-left",
    });
    const meta2 = await sharp(outRedLeft).metadata();
    assert.equal(meta2.width, 1280);
    assert.equal(meta2.height, 720);
    assert.ok(fs.statSync(outRedLeft).size > fs.statSync(baseImg).size);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log("OK: thumbnail-overlay Vietnamese text & red badge compositing");

  // 3. Test matchThumbnailReferences (ordering, auto-backfill important characters, explicit override, location token fallback, cap)
  const mediaProvider = loadTsModule("app/lib/media-provider.ts", {
    "./sales-video-checkpoint": { videoCheckpoint: async () => {} },
    "./seedance-accounts": { getSeedanceApiKey: async () => "", getSeedanceApiSessionToken: async () => "" },
    "./maivideo-api-keys": { getMaiVideoApiKey: async () => "" },
    "./auth-server": { getCurrentUserId: async () => "" },
    "./gateway-reference-images": { prepareGatewayReferenceImageDataUrls: async () => [] },
    "@fal-ai/client": { createFalClient: () => ({}) },
  });

  const characters = [
    { id: "c1", name: "Khoang Nâu", description: "tan dog", referenceImagePath: "data/media/p/characters/c1.png", referenceImageName: "c1.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
    { id: "c2", name: "Mực Đen", description: "black dog", referenceImagePath: "data/media/p/characters/c2.png", referenceImageName: "c2.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
    { id: "c3", name: "Hổ Đen", description: "rottweiler", referenceImagePath: "data/media/p/characters/c3.png", referenceImageName: "c3.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
    { id: "c4", name: "Thảo Mây", description: "golden dog", referenceImagePath: "data/media/p/characters/c4.png", referenceImageName: "c4.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
    { id: "c5", name: "Bà Năm", description: "no image yet", referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "", createdAt: "", updatedAt: "" },
  ];
  const locations = [
    { id: "l1", name: "Red-Brick Threshing Courtyard", description: "courtyard", referenceImagePath: "data/media/p/locations/l1.png", referenceImageName: "l1.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
    { id: "l2", name: "Village Vegetable Path", description: "path", referenceImagePath: "data/media/p/locations/l2.png", referenceImageName: "l2.png", referenceImageMimeType: "image/png", createdAt: "", updatedAt: "" },
  ];

  // Explicit mention ordering (Hổ Đen first, then Khoang Nâu) + token-overlap location fallback ("red brick ... courtyard")
  const matched1 = mediaProvider.matchThumbnailReferences(
    "Make Hổ Đen dominant; behind him Khoang Nâu recoils in a red-brick courtyard.",
    characters,
    locations,
    9,
    { characterImportanceScores: { c1: 10, c2: 8, c3: 5, c4: 4 } },
  );
  assert.deepEqual(matched1.characters.map((c) => c.id), ["c3", "c1"]);
  assert.equal(matched1.location?.id, "l1");

  // Auto-backfill important characters when prompt doesn't name enough characters
  const matched2 = mediaProvider.matchThumbnailReferences(
    "Dramatic showdown at dusk between rival village dogs.",
    characters,
    locations,
    9,
    { characterImportanceScores: { c1: 12, c4: 9, c3: 7, c2: 2 }, minImportantCharacters: 3 },
  );
  assert.deepEqual(matched2.characters.map((c) => c.id), ["c1", "c4", "c3"]);

  // Explicit override preserves order and skips characters without referenceImagePath
  const matched3 = mediaProvider.matchThumbnailReferences(
    "Anything",
    characters,
    locations,
    2,
    { explicitCharacterIds: ["c4", "c5", "c1", "c3"] },
  );
  assert.deepEqual(matched3.characters.map((c) => c.id), ["c4", "c1"]);
  assert.equal(matched3.location, undefined);

  console.log("OK: matchThumbnailReferences auto-backfill, ordering, explicit override, and location fallback");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(filePath, stubs = {}, cache = new Map()) {
  const resolved = path.resolve(filePath);
  if (cache.has(resolved)) return cache.get(resolved);
  const module = { exports: {} };
  cache.set(resolved, module.exports);
  const source = fs.readFileSync(resolved, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
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
        if (fs.existsSync(tsCandidate)) return loadTs(tsCandidate, stubs, cache);
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

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-render-stale-"));
  const tmpDataDir = path.join(tmpRoot, "data");
  const slug = "remake-test-project";
  const mediaDir = path.join(tmpDataDir, "media", slug, "A01");
  const outputDir = path.join(tmpDataDir, "outputs", slug);
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const videoFile = path.join(mediaDir, "S001-maivideo-video.mp4");
  fs.writeFileSync(videoFile, Buffer.from("fake-mp4-bytes"));
  const refImageFile = path.join(mediaDir, "S001-maivideo-image.png");
  fs.writeFileSync(refImageFile, Buffer.from("fake-png-bytes"));

  const prevDataDir = process.env.STORYAI_DATA_DIR;
  process.env.STORYAI_DATA_DIR = tmpDataDir;

  try {
    const dataDirectory = loadTs("app/lib/data-directory.ts");
    assert.equal(dataDirectory.resolveStoredDataPath("data/media/foo/a.mp4"), path.join(tmpDataDir, "media/foo/a.mp4"));
    assert.equal(dataDirectory.resolveStoredDataPath("../../data/media/foo/a.mp4"), path.join(tmpDataDir, "media/foo/a.mp4"));
    assert.equal(dataDirectory.resolveStoredDataPath("../../../etc/passwd"), undefined);
    assert.equal(dataDirectory.resolveStoredDataPath("data/../secret.txt"), undefined);

    const chunkPayload = {
      schema: "scene-script.v1",
      chunk_id: "A01",
      scenes: [
        {
          id: "S001",
          start_sec: 0,
          end_sec: 10,
          duration_sec: 10,
          video_prompt: "A golden retriever runs across a sunny meadow.",
          media: {
            kind: "video",
            provider: "maivideo-video",
            status: "ready",
            stale: true,
            localPath: `../../data/media/${slug}/A01/S001-maivideo-video.mp4`,
          },
          videoReferenceImage: {
            kind: "image",
            provider: "maivideo-image",
            status: "ready",
            localPath: `../../data/media/${slug}/A01/S001-maivideo-image.png`,
          },
          mediaGeneration: {
            videoProvider: "maivideo",
            videoModel: "minimax-h3",
            videoQuality: "768p",
          },
        },
      ],
    };
    const chunkPath = path.join(outputDir, "A01.json");
    fs.writeFileSync(chunkPath, JSON.stringify(chunkPayload, null, 2));

    let currentPayload = chunkPayload;
    const serverStoreStub = {
      readChunkOutput: async () => currentPayload,
      saveChunkOutput: async (_slug, _chunkId, nextPayload) => {
        currentPayload = nextPayload;
        fs.writeFileSync(chunkPath, JSON.stringify(nextPayload, null, 2));
        return `../../data/outputs/${slug}/A01.json`;
      },
    };
    const projectTypes = loadTs("app/lib/project-types.ts");
    const mediaSettings = loadTs("app/lib/media-generation-settings.ts", { "./project-types": projectTypes });

    const renderService = loadTs("app/lib/render-service.ts", {
      "./data-directory": dataDirectory,
      "./project-types": projectTypes,
      "./server-store": serverStoreStub,
      "./media-generation-settings": mediaSettings,
      "./story-presets": { isFlowStoryOnlyPreset: () => false },
    });

    const project = {
      id: "p1",
      slug,
      title: "Test Remake",
      presetId: "ai-drama",
      language: "vi",
      aspectRatio: "16:9",
      sceneDurationSec: 10,
      chunks: [{ id: "A01", sceneStart: 1, sceneEnd: 1, generatedScenes: 1, status: "completed", outputPath: `../../data/outputs/${slug}/A01.json`, updatedAt: new Date().toISOString() }],
      characters: [],
      locations: [],
    };

    const sceneStore = loadTs("app/lib/scene-store.ts", {
      "./data-directory": dataDirectory,
      "./project-types": projectTypes,
      "./media-generation-settings": mediaSettings,
      "./story-presets": { isFlowStoryOnlyPreset: () => false },
      "./server-store": serverStoreStub,
    });

    const scenes = await sceneStore.readProjectScenes(project);
    assert.equal(scenes.length, 1);

    // 1. Stale ready video passes preflight when file exists on disk via ../../data/...
    await renderService.assertAiDramaVideosReady(project, scenes, 1);

    // 2. Non-ready / non-video / missing-file scenes still fail preflight
    await assert.rejects(
      () => renderService.assertAiDramaVideosReady(project, [{ ...scenes[0], media: { ...scenes[0].media, status: "failed" } }], 1),
      renderService.RenderMediaPreflightError,
    );
    await assert.rejects(
      () => renderService.assertAiDramaVideosReady(project, [{ ...scenes[0], media: { ...scenes[0].media, kind: "image" } }], 1),
      renderService.RenderMediaPreflightError,
    );
    await assert.rejects(
      () => renderService.assertAiDramaVideosReady(project, [{ ...scenes[0], media: { ...scenes[0].media, localPath: `../../data/media/${slug}/A01/missing.mp4` } }], 1),
      renderService.RenderMediaPreflightError,
    );

    // 3. buildRenderManifest uses the ready video even when stale === true
    const manifest = await renderService.buildRenderManifest(project, scenes);
    assert.equal(manifest.missingMedia, 0);
    assert.equal(manifest.scenes[0].source, "scene_media");
    assert.equal(manifest.scenes[0].mediaKind, "video");
    assert.ok(manifest.scenes[0].mediaPath);

    // 4. persistSceneMediaSettingsInChunks preserves ready media without marking it stale
    const cleanPayload = {
      ...chunkPayload,
      scenes: [{ ...chunkPayload.scenes[0], media: { ...chunkPayload.scenes[0].media, stale: false } }],
    };
    currentPayload = cleanPayload;
    const cleanScenes = await sceneStore.readProjectScenes(project);
    const nextSettings = mediaSettings.resolveMediaGenerationSettings({
      videoProvider: "higgsfield",
      videoModel: "higgsfield-magi-2",
      videoQuality: "1080p",
    }, { remake: true });
    await sceneStore.persistSceneMediaSettingsInChunks(project, cleanScenes, new Map([["S001", nextSettings]]));
    assert.equal(currentPayload.scenes[0].mediaGeneration.videoModel, "higgsfield-magi-2");
    assert.equal(currentPayload.scenes[0].media.stale, false);
    assert.equal(currentPayload.scenes[0].videoReferenceImage.stale, undefined);

    console.log("Passed: resolveStoredDataPath, stale ready video preflight/manifest, and media settings persistence.");
  } finally {
    if (prevDataDir === undefined) delete process.env.STORYAI_DATA_DIR;
    else process.env.STORYAI_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");

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

function run() {
  const mod = loadTsModule("app/lib/scene-submitted-video.ts");
  const { resolveLastSubmittedSceneVideo, submittedVideoModelDisplayName } = mod;

  // 1. Completed video + matching job merges media & job metadata
  const flowResolved = resolveLastSubmittedSceneVideo({
    media: {
      kind: "video",
      provider: "flow-video",
      status: "ready",
      model: "flow-omni-1.2-flash",
      quality: "720p",
      query: "A dog in the field",
      generatedFromJobId: "mjob-1",
      generatedAt: "2026-11-27T10:05:00.000Z",
    },
    jobs: [
      {
        id: "mjob-1",
        kind: "video",
        status: "completed",
        provider: "flow",
        submittedPrompt: "DURATION: 15s.\nA dog in the field",
        createdAt: "2026-11-27T10:00:00.000Z",
        updatedAt: "2026-11-27T10:05:00.000Z",
        mediaGeneration: {
          videoProvider: "flow",
          videoModel: "flow-omni-1.2-flash",
          videoQuality: "720p",
        },
      },
    ],
  });
  assert.equal(flowResolved.prompt, "DURATION: 15s.\nA dog in the field");
  assert.equal(flowResolved.model, "flow-omni-1.2-flash");
  assert.equal(flowResolved.provider, "flow");
  assert.equal(
    submittedVideoModelDisplayName({ model: flowResolved.model, provider: flowResolved.provider }),
    "Flow Omni 1.2 Flash",
  );

  // 2. Display name checks across providers, catalog labels, and legacy/hidden models
  assert.equal(
    submittedVideoModelDisplayName({ model: "muse-video", provider: "muse" }),
    "Muse.ai",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "higgsfield-seedance-2.0", provider: "higgsfield" }),
    "Seedance 2.0 · Higgsfield",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "higgsfield-wan-3.0", provider: "higgsfield" }),
    "Wan 3.0 · Higgsfield",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "seedance-2.0-fast", provider: "maivideo" }),
    "Seedance 2.0 · PixVerse",
  );
  assert.equal(
    submittedVideoModelDisplayName({
      model: "v6",
      provider: "maivideo",
      catalogModels: [{ id: "v6", provider: "maivideo", label: "PixVerse v6 Ultra" }],
    }),
    "PixVerse v6 Ultra",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "seedance-2.5", provider: "maivideo" }),
    "Seedance 2.5 · MaiVideo",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "seedance-2.5", provider: "seedance" }),
    "Seedance 2.5",
  );
  assert.equal(
    submittedVideoModelDisplayName({ model: "pixverse-v5.6", provider: "maivideo" }),
    "pixverse-v5.6",
  );

  // 3. Queued job without submittedPrompt must NOT replace previous submission's prompt or model
  const queuedNextJob = resolveLastSubmittedSceneVideo({
    media: {
      kind: "video",
      provider: "maivideo-video-muse",
      status: "ready",
      model: "Muse.ai",
      query: "Previous Muse prompt",
      generatedFromJobId: "mjob-old",
      generatedAt: "2026-11-27T10:02:00.000Z",
    },
    jobs: [
      {
        id: "mjob-new-queued",
        kind: "video",
        status: "queued",
        provider: "flow",
        createdAt: "2026-11-27T10:10:00.000Z",
        updatedAt: "2026-11-27T10:10:00.000Z",
        mediaGeneration: {
          videoProvider: "flow",
          videoModel: "flow-omni-1.2-flash",
        },
      },
      {
        id: "mjob-old",
        kind: "video",
        status: "completed",
        provider: "muse",
        submittedPrompt: "Previous Muse prompt",
        createdAt: "2026-11-27T10:00:00.000Z",
        updatedAt: "2026-11-27T10:02:00.000Z",
        mediaGeneration: {
          videoProvider: "muse",
          videoModel: "muse-video",
        },
      },
    ],
  });
  assert.equal(queuedNextJob.prompt, "Previous Muse prompt");
  assert.equal(
    submittedVideoModelDisplayName({ model: queuedNextJob.model, provider: queuedNextJob.provider }),
    "Muse.ai",
  );

  // 4. Running / failed / cancelled job with submittedPrompt supersedes older completed video
  const failedNewer = resolveLastSubmittedSceneVideo({
    media: {
      kind: "video",
      provider: "maivideo-video",
      status: "ready",
      model: "v6",
      query: "Old v6 prompt",
      generatedFromJobId: "mjob-v6",
      generatedAt: "2026-11-27T10:02:00.000Z",
    },
    jobs: [
      {
        id: "mjob-failed-wan",
        kind: "video",
        status: "failed",
        provider: "maivideo-video",
        submittedPrompt: "New Wan 3.0 prompt",
        createdAt: "2026-11-27T10:10:00.000Z",
        updatedAt: "2026-11-27T10:11:00.000Z",
        mediaGeneration: {
          videoProvider: "maivideo",
          videoModel: "wan-3.0",
          videoQuality: "1080p",
        },
      },
      {
        id: "mjob-v6",
        kind: "video",
        status: "completed",
        provider: "maivideo-video",
        submittedPrompt: "Old v6 prompt",
        createdAt: "2026-11-27T10:00:00.000Z",
        updatedAt: "2026-11-27T10:02:00.000Z",
        mediaGeneration: {
          videoProvider: "maivideo",
          videoModel: "v6",
        },
      },
    ],
  });
  assert.equal(failedNewer.prompt, "New Wan 3.0 prompt");
  assert.equal(failedNewer.model, "wan-3.0");
  assert.equal(
    submittedVideoModelDisplayName({ model: failedNewer.model, provider: failedNewer.provider }),
    "Wan 3.0",
  );

  // 5. Subsequent image generation job does not clobber last submitted video
  const withLaterImageJob = resolveLastSubmittedSceneVideo({
    media: {
      kind: "image",
      provider: "maivideo-image",
      status: "ready",
      model: "gemini-nano-banana-2.1",
      query: "image prompt",
      generatedAt: "2026-11-27T10:20:00.000Z",
    },
    jobs: [
      {
        id: "mjob-img",
        kind: "image",
        status: "completed",
        provider: "maivideo-image",
        createdAt: "2026-11-27T10:19:00.000Z",
        updatedAt: "2026-11-27T10:20:00.000Z",
      },
      {
        id: "mjob-vid",
        kind: "video",
        status: "completed",
        provider: "higgsfield",
        submittedPrompt: "Last video prompt before image refresh",
        createdAt: "2026-11-27T10:10:00.000Z",
        updatedAt: "2026-11-27T10:15:00.000Z",
        mediaGeneration: {
          videoProvider: "higgsfield",
          videoModel: "higgsfield-seedance-2.0",
        },
      },
    ],
  });
  assert.equal(withLaterImageJob.prompt, "Last video prompt before image refresh");
  assert.equal(
    submittedVideoModelDisplayName({ model: withLaterImageJob.model, provider: withLaterImageJob.provider }),
    "Seedance 2.0 · Higgsfield",
  );

  // 6. Uploaded video returns undefined unless a newer AI video job was submitted after upload
  const uploadedOnly = resolveLastSubmittedSceneVideo({
    media: {
      kind: "video",
      provider: "upload",
      status: "ready",
      generatedAt: "2026-11-27T10:30:00.000Z",
    },
    jobs: [
      {
        id: "mjob-before-upload",
        kind: "video",
        status: "completed",
        provider: "flow",
        submittedPrompt: "Older AI prompt",
        createdAt: "2026-11-27T10:10:00.000Z",
        updatedAt: "2026-11-27T10:15:00.000Z",
        mediaGeneration: {
          videoProvider: "flow",
          videoModel: "flow-omni-1.2-flash",
        },
      },
    ],
  });
  assert.equal(uploadedOnly, undefined);

  const uploadedThenAiSubmitted = resolveLastSubmittedSceneVideo({
    media: {
      kind: "video",
      provider: "upload",
      status: "ready",
      generatedAt: "2026-11-27T10:30:00.000Z",
    },
    jobs: [
      {
        id: "mjob-after-upload",
        kind: "video",
        status: "running",
        provider: "flow",
        submittedPrompt: "Newer AI prompt after upload",
        createdAt: "2026-11-27T10:35:00.000Z",
        updatedAt: "2026-11-27T10:35:05.000Z",
        mediaGeneration: {
          videoProvider: "flow",
          videoModel: "flow-omni-1.2-flash",
        },
      },
    ],
  });
  assert.equal(uploadedThenAiSubmitted.prompt, "Newer AI prompt after upload");
  assert.equal(
    submittedVideoModelDisplayName({
      model: uploadedThenAiSubmitted.model,
      provider: uploadedThenAiSubmitted.provider,
    }),
    "Flow Omni 1.2 Flash",
  );

  console.log("OK: scene-submitted-video tests passed");
}

run();

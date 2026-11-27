const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const cache = new Map();
const stubs = {
  "./sales-video-checkpoint": { videoCheckpoint: async () => ({}) },
  "./provider-submission-checkpoint": { checkpointProviderSubmission: async () => {} },
  "./provider-request-retry": { providerRequestWithRetry: async (_signal, fn) => fn() },
  "./seedance-accounts": {
    getSeedanceApiKey: async () => "test-seedance-key",
    getSeedanceApiSessionToken: async () => "test-session-token",
  },
  "./maivideo-api-keys": { getMaiVideoApiKey: async () => "test-maivideo-key" },
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
const policy = loadTs("app/lib/video-prompt-policy.ts");
const safety = loadTs("app/lib/visual-prompt-safety.ts");

(async () => {
  // 1. Muse 15s duration support
  assert.equal(settings.MUSE_VIDEO_MODEL_OPTION.maxDurationSec, 15);
  assert.deepEqual(Array.from(settings.MUSE_VIDEO_MODEL_OPTION.supportedDurationsSec), [5, 10, 15]);
  assert.deepEqual(Array.from(settings.videoDurationOptions(settings.MUSE_VIDEO_MODEL_OPTION)), [5, 10, 15]);
  assert.deepEqual(settings.videoDurationBoundsForModel(settings.MUSE_VIDEO_MODEL_OPTION), { min: 5, max: 15 });
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 15 }).videoDurationSec, 15);
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 10 }).videoDurationSec, 10);
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 5 }).videoDurationSec, 5);

  // 2. Character @ImageN injection + idempotence + safety
  const rawShot = "Khoang Nâu shifts paws while Mực Đen listens and Bánh Bao watches from behind.";
  const boundShot = provider.injectCharacterImageTokensIntoPrompt(rawShot, [
    { name: "Khoang Nâu", token: "@Image2" },
    { name: "Mực Đen", token: "@Image3" },
    { name: "Bánh Bao", token: "@Image4" },
  ]);
  assert.equal(
    boundShot,
    "Khoang Nâu (@Image2) shifts paws while Mực Đen (@Image3) listens and Bánh Bao (@Image4) watches from behind.",
  );
  assert.equal(
    provider.injectCharacterImageTokensIntoPrompt(boundShot, [
      { name: "Khoang Nâu", token: "@Image2" },
      { name: "Mực Đen", token: "@Image3" },
      { name: "Bánh Bao", token: "@Image4" },
    ]),
    boundShot,
    "Token injection must be idempotent",
  );
  assert.equal(policy.requireReferenceIdentityOnly(boundShot, ["Khoang Nâu", "Mực Đen", "Bánh Bao"]), boundShot);

  // 3. Voice cue extraction without leaking age/appearance prose
  assert.equal(
    provider.extractCharacterVoiceCue("Male, earnest youthful voice. Cheerful, lovesick tan-and-white dog."),
    "Male, earnest youthful voice",
  );
  assert.equal(
    provider.extractCharacterVoiceCue("Male, gruff deadpan low baritone voice. Stocky wrinkly gray bulldog mix."),
    "Male, gruff deadpan low baritone voice",
  );
  assert.equal(
    provider.extractCharacterVoiceCue("26-year-old woman; warm friendly voice. Wearing burgundy cardigan."),
    "warm friendly voice",
  );
  assert.equal(provider.extractCharacterVoiceCue("Silent background prop."), "");

  // 4. Filter off-screen dialogue-mentioned characters unless explicitly overridden
  const characters = [
    { id: "char-ai-1", name: "Khoang Nâu", description: "Male, earnest youthful voice. Tan-and-white village dog.", referenceImagePath: "chars/1.png" },
    { id: "char-ai-2", name: "Mực Đen", description: "Male, cautious steady mid-range voice. Sleek black dog.", referenceImagePath: "chars/2.png" },
    { id: "char-ai-3", name: "Bánh Bao", description: "Male, gruff deadpan low baritone voice. Gray bulldog.", referenceImagePath: "chars/3.png" },
    { id: "char-ai-9", name: "Thảo Mây", description: "Female, soft warm gentle voice. Golden-cream dog.", referenceImagePath: "chars/9.png" },
  ];
  const s001 = {
    id: "S001",
    start_sec: 0,
    end_sec: 15,
    duration_sec: 15,
    characters: ["Khoang Nâu", "Mực Đen", "Bánh Bao"],
    character_ids: ["char-ai-1", "char-ai-2", "char-ai-3", "char-ai-9"],
    location_id: "loc-1",
    video_prompt: "Khoang Nâu speaks to Mực Đen while Bánh Bao watches silently.",
    dialogue_segments: [
      { speaker_character: "Khoang Nâu", speaker_character_id: "char-ai-1", text: "Tớ mơ thấy một nàng cún tên Thảo Mây.", start_sec: 0.8, end_sec: 4.0 },
      { speaker_character: "Mực Đen", speaker_character_id: "char-ai-2", text: "Mơ thấy món gì ngon hả?", start_sec: 5.0, end_sec: 7.6 },
    ],
    videoReferenceImage: { kind: "image", status: "ready", localPath: "scene/S001.png" },
  };
  const filteredImplicit = provider.filterImplicitOnScreenSceneCharacters(s001, characters, false);
  assert.deepEqual(filteredImplicit.map((c) => c.id), ["char-ai-1", "char-ai-2", "char-ai-3"]);
  const keptExplicit = provider.filterImplicitOnScreenSceneCharacters(s001, characters, true);
  assert.deepEqual(keptExplicit.map((c) => c.id), ["char-ai-1", "char-ai-2", "char-ai-3", "char-ai-9"]);

  // 5. Preview prompt across Muse, Seedance, Flow, and MaiVideo
  const locations = [
    { id: "loc-1", name: "Haystack Field Ridge", description: "Golden dry hay mound beside green crop fields.", referenceImagePath: "locs/1.png" },
  ];
  for (const videoProvider of ["muse", "seedance", "flow", "maivideo"]) {
    const videoModel = videoProvider === "muse"
      ? "muse-video"
      : videoProvider === "seedance"
        ? "seedance-2.5"
        : videoProvider === "flow"
          ? "flow-omni-1.2-flash"
          : "v6";
    const composed = await provider.previewMaiVideoVideoPromptForScene({
      projectSlug: "test-project",
      chunkId: "A01",
      scene: s001,
      projectScenes: [s001],
      characters,
      locations,
      sceneIndex: 0,
      aspectRatio: "16:9",
      presetId: "ai-drama",
      videoSpokenLanguage: "vi",
      mediaGeneration: {
        videoProvider,
        videoModel,
        videoDurationMode: "scene",
        videoUseSceneImageReference: true,
        videoUseCharacterReferences: true,
        videoUseLocationReferences: true,
      },
    });
    if (videoProvider === "muse") {
      assert(composed.startsWith("SCENE VIDEO PROMPT (action and timing):\nDURATION: 15s."), "Muse must keep 15s scene duration");
      assert(
        composed.includes("MUSE OUTPUT REQUIREMENT: Render one complete 15-second final video artifact (16:9, exact 15s runtime; never output a shorter 5s or 10s draft clip)."),
        "Muse prompt must enforce exact 15s output requirement",
      );
      assert(
        composed.includes("Platform-safe non-graphic motion: perform choreography"),
        "Muse prompt must use clean non-graphic cast guidance",
      );
    }
    assert(composed.includes("Khoang Nâu (@Image2)"), `${videoProvider} shot description should bind @Image2`);
    assert(composed.includes("Mực Đen (@Image3)"), `${videoProvider} shot description should bind @Image3`);
    assert(composed.includes("Bánh Bao (@Image4)"), `${videoProvider} shot description should bind @Image4`);
    assert(!composed.includes("CHARACTER Thảo Mây"), `${videoProvider} must not attach off-screen Thảo Mây reference`);
    assert(composed.includes("Khoang Nâu [@Image2] (Male, earnest youthful voice; on-camera; lip-sync ONLY on @Image2, keep other characters' mouths/muzzles closed)"));
    assert(composed.includes("Mực Đen [@Image3] (Male, cautious steady mid-range voice; on-camera; lip-sync ONLY on @Image3, keep other characters' mouths/muzzles closed)"));
    assert(composed.includes("language: vi"));
    const expectedMapEntry = videoProvider === "seedance" ? "@Image2: CHARACTER Khoang Nâu" : "@Image2 (Image 2): CHARACTER Khoang Nâu";
    assert(composed.includes(expectedMapEntry), `${videoProvider} visual reference map entry missing`);
  }

  // 6. Safety exclusion regex must preserve "without blood or gore" cleanly
  const safeExclusion = "Keep the action intense without blood or gore during the chase.";
  assert.equal(safety.sanitizeDramaVisualPrompt(safeExclusion), safeExclusion);
  assert.deepEqual(safety.findUnsafeDramaPromptTerms(safeExclusion), []);

  // 7. Synchronized pixverse_prompt.py parity checks in StoryAI
  const pixverseCases = [
    ["A 14-year-old girl wearing a pussy-bow blouse.", "A young adult woman wearing a ribbon-bow blouse."],
    ["cô bé 12 tuổi mặc đồ thường ngày.", "cô gái trẻ mặc đồ thường ngày."],
    ["Show no children, teenagers, or minors anywhere.", "Show only mature adults in frame."],
    ["Pixar style animation with a blood orange under a shooting star.", "cinematic 3D animation style animation with a red-fleshed orange under a meteor streak."],
    ["She wears no underwear and has apparent age and body proportions.", "She wears fully dressed in casual attire and has character styling and character proportions."],
    ["Khoang Nâu (@Image1) runs past a sheer shirt shop.", "Khoang Nâu (@Image1) runs past a lightweight opaque shirt shop."],
  ];
  for (const [raw, expected] of pixverseCases) {
    assert.equal(safety.normalizePixversePrompt(raw).prompt, expected, `normalizePixversePrompt parity mismatch for: ${raw}`);
    assert.equal(safety.sanitizeDramaVisualPrompt(raw), expected, `sanitizeDramaVisualPrompt parity mismatch for: ${raw}`);
  }

  console.log("Passed: Muse 15s duration, @ImageN indexing, voice cues, mouth-closure lock, safety exclusions, PixVerse parity, and off-screen reference filtering.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

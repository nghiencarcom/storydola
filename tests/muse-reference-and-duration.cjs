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
const salesTemplates = loadTs("app/lib/sales-video-templates.ts");

(async () => {
  // 1. Muse 15s duration support
  assert.equal(settings.MUSE_VIDEO_MODEL_OPTION.maxDurationSec, 15);
  assert.deepEqual(Array.from(settings.MUSE_VIDEO_MODEL_OPTION.supportedDurationsSec), [5, 10, 15]);
  assert.deepEqual(Array.from(settings.videoDurationOptions(settings.MUSE_VIDEO_MODEL_OPTION)), [5, 10, 15]);
  assert.deepEqual(settings.videoDurationBoundsForModel(settings.MUSE_VIDEO_MODEL_OPTION), { min: 5, max: 15 });
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 15 }).videoDurationSec, 15);
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 10 }).videoDurationSec, 10);
  assert.equal(settings.resolveMediaGenerationSettings({ videoProvider: "muse", videoDurationSec: 5 }).videoDurationSec, 5);

  // 2. Character @ImageN / @imageN injection + allOccurrences + idempotence + safety
  const rawShot = "Khoang Nâu shifts paws while Mực Đen listens and Bánh Bao watches. Khoang Nâu later grins at Mực Đen.";
  const boundFirst = provider.injectCharacterImageTokensIntoPrompt(rawShot, [
    { name: "Khoang Nâu", token: "@Image2" },
    { name: "Mực Đen", token: "@Image3" },
    { name: "Bánh Bao", token: "@Image4" },
  ]);
  assert.equal(
    boundFirst,
    "Khoang Nâu (@Image2) shifts paws while Mực Đen (@Image3) listens and Bánh Bao (@Image4) watches. Khoang Nâu later grins at Mực Đen.",
  );
  const boundAll = provider.injectCharacterImageTokensIntoPrompt(rawShot, [
    { name: "Khoang Nâu", token: "@image2" },
    { name: "Mực Đen", token: "@image3" },
    { name: "Bánh Bao", token: "@image4" },
  ], { allOccurrences: true });
  assert.equal(
    boundAll,
    "Khoang Nâu (@image2) shifts paws while Mực Đen (@image3) listens and Bánh Bao (@image4) watches. Khoang Nâu (@image2) later grins at Mực Đen (@image3).",
  );
  assert.equal(
    provider.injectCharacterImageTokensIntoPrompt(boundAll, [
      { name: "Khoang Nâu", token: "@image2" },
      { name: "Mực Đen", token: "@image3" },
      { name: "Bánh Bao", token: "@image4" },
    ], { allOccurrences: true }),
    boundAll,
    "allOccurrences token injection must be idempotent",
  );
  assert.equal(policy.requireReferenceIdentityOnly(boundAll, ["Khoang Nâu", "Mực Đen", "Bánh Bao"]), boundAll);

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
  const prevScene = {
    id: "S000",
    location_id: "loc-1",
    videoReferenceImage: { kind: "image", status: "ready", localPath: "scene/S000.png" },
  };
  const continuityReference = { sceneId: "S000", image: prevScene.videoReferenceImage, persisted: true };
  for (const videoProvider of ["muse", "seedance", "flow", "maivideo"]) {
    const videoModel = videoProvider === "muse"
      ? "muse-video"
      : videoProvider === "seedance"
        ? "seedance-2.5"
        : videoProvider === "flow"
          ? "flow-omni-1.2-flash"
          : "minimax-h3";
    const composedRefs = [];
    const composed = await provider.previewMaiVideoVideoPromptForScene({
      projectSlug: "test-project",
      chunkId: "A01",
      scene: s001,
      projectScenes: [prevScene, s001],
      characters,
      locations,
      sceneIndex: 1,
      aspectRatio: "16:9",
      presetId: "ai-drama",
      videoSpokenLanguage: "vi",
      continuityReference,
      onVideoReferencesComposed: async (refs) => {
        composedRefs.push(...refs);
      },
      mediaGeneration: {
        videoProvider,
        videoModel,
        videoDurationMode: "scene",
        videoUseSceneImageReference: true,
        videoUseCharacterReferences: true,
        videoUseLocationReferences: true,
      },
    });
    const isMaiVideo = videoProvider === "maivideo";
    const tokPrefix = isMaiVideo ? "@image" : "@Image";
    // When Scene Frame is active on maivideo, Previous scene is omitted so character indices start at 2 instead of 3.
    const khoangToken = `${tokPrefix}${isMaiVideo ? 2 : 3}`;
    const mucToken = `${tokPrefix}${isMaiVideo ? 3 : 4}`;
    const banhBaoToken = `${tokPrefix}${isMaiVideo ? 4 : 5}`;
    if (isMaiVideo) {
      assert(!composed.includes("PREVIOUS SCENE S000"), "Scene-anchored MaiVideo must skip Previous scene reference");
      assert(!composedRefs.some((r) => r.name.includes("Previous scene")), "MaiVideo must not attach Previous scene image");
    } else {
      assert(composed.includes("PREVIOUS SCENE S000"), `${videoProvider} should retain persisted continuity scene`);
    }
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
    assert(composed.includes(`Khoang Nâu (${khoangToken})`), `${videoProvider} shot description should bind ${khoangToken}`);
    assert(composed.includes(`Mực Đen (${mucToken})`), `${videoProvider} shot description should bind ${mucToken}`);
    assert(composed.includes(`Bánh Bao (${banhBaoToken})`), `${videoProvider} shot description should bind ${banhBaoToken}`);
    assert(!composed.includes("CHARACTER Thảo Mây"), `${videoProvider} must not attach off-screen Thảo Mây reference`);
    assert(
      composed.includes(`Khoang Nâu [${khoangToken}] (Male, earnest youthful voice; on-camera; animate mouth/muzzle speech ONLY on ${khoangToken}; keep Mực Đen (${mucToken}), Bánh Bao (${banhBaoToken}) mouths/muzzles strictly closed`),
      `${videoProvider} missing explicit named silence lock for Khoang Nâu cue`,
    );
    assert(
      composed.includes(`Mực Đen [${mucToken}] (Male, cautious steady mid-range voice; on-camera; animate mouth/muzzle speech ONLY on ${mucToken}; keep Khoang Nâu (${khoangToken}), Bánh Bao (${banhBaoToken}) mouths/muzzles strictly closed`),
      `${videoProvider} missing explicit named silence lock for Mực Đen cue`,
    );
    assert(composed.includes("language: vi"));
    const expectedMapEntry = videoProvider === "seedance" ? `${khoangToken}: CHARACTER Khoang Nâu` : `${khoangToken} (Image ${isMaiVideo ? 2 : 3}): CHARACTER Khoang Nâu`;
    assert(composed.includes(expectedMapEntry), `${videoProvider} visual reference map entry missing`);
  }

  // 5b. Off-camera & distant-background cues on MaiVideo (S015 / S028 patterns) + kneel parity
  const s015AndS028Scene = {
    id: "S015",
    start_sec: 0,
    end_sec: 10,
    duration_sec: 10,
    characters: ["Khoang Nâu", "Mực Đen", "Bánh Bao"],
    character_ids: ["char-ai-1", "char-ai-2", "char-ai-3"],
    location_id: "loc-1",
    video_prompt: "0.0-4.6s: Bánh Bao speaks cheerfully (0.5-2.0s) while Khoang Nâu listens. 4.6-7.2s: Camera pushes in rapidly to a tight close-up of Khoang Nâu as Bánh Bao calls out inside (4.9-6.4s). 7.2-10.0s: Sudden barks echo off-screen; Khoang Nâu reacts (7.4-8.0s) while Mực Đen shouts urgently (8.2-9.4s) and bolts with Bánh Bao behind the outer brick wall.",
    dialogue_segments: [
      { speaker_character: "Bánh Bao", speaker_character_id: "char-ai-3", text: "Câu một.", start_sec: 0.5, end_sec: 2.0 },
      { speaker_character: "Bánh Bao", speaker_character_id: "char-ai-3", text: "Câu gọi từ trong nhà.", start_sec: 4.9, end_sec: 6.4 },
      { speaker_character: "Khoang Nâu", speaker_character_id: "char-ai-1", text: "Ôi trời!", start_sec: 7.4, end_sec: 8.0 },
      { speaker_character: "Mực Đen", speaker_character_id: "char-ai-2", text: "Mau nấp thôi!", start_sec: 8.2, end_sec: 9.4 },
    ],
    videoReferenceImage: { kind: "image", status: "ready", localPath: "scene/S015.png" },
  };
  const offCamPrompt = await provider.previewMaiVideoVideoPromptForScene({
    projectSlug: "test-project",
    chunkId: "A01",
    scene: s015AndS028Scene,
    projectScenes: [s015AndS028Scene],
    characters,
    locations,
    sceneIndex: 0,
    aspectRatio: "16:9",
    presetId: "ai-drama",
    videoSpokenLanguage: "vi",
    mediaGeneration: {
      videoProvider: "maivideo",
      videoModel: "minimax-h3",
      videoDurationMode: "scene",
      videoUseSceneImageReference: true,
      videoUseCharacterReferences: true,
      videoUseLocationReferences: true,
    },
  });
  assert(offCamPrompt.includes("0.500–2.000s · Bánh Bao [@image4] (Male, gruff deadpan low baritone voice; on-camera; animate mouth/muzzle speech ONLY on @image4"));
  assert(offCamPrompt.includes("4.900–6.400s · Bánh Bao [@image4] (Male, gruff deadpan low baritone voice; off-camera/distant voice; NO lip-sync on foreground frame"));
  assert(offCamPrompt.includes("7.400–8.000s · Khoang Nâu [@image2] (Male, earnest youthful voice; on-camera; animate mouth/muzzle speech ONLY on @image2"));
  assert(offCamPrompt.includes("8.200–9.400s · Mực Đen [@image3] (Male, cautious steady mid-range voice; off-camera/distant voice; NO lip-sync on foreground frame"));

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
    ["Trio faces kneeling Chị Lan who kneels smoothly.", "Trio faces crouching Chị Lan who crouches gently."],
  ];
  for (const [raw, expected] of pixverseCases) {
    assert.equal(safety.normalizePixversePrompt(raw).prompt, expected, `normalizePixversePrompt parity mismatch for: ${raw}`);
    assert.equal(safety.sanitizeDramaVisualPrompt(raw), expected, `sanitizeDramaVisualPrompt parity mismatch for: ${raw}`);
  }

  // 8. Seedance · PixVerse & MaiVideo lowercase @imageN / @videoN token normalization
  assert.equal(
    provider.normalizeMaiVideoReferenceTokens("Use @Image1, @Image2, @IMAGE3–@Image5, (@Video1 and @VIDEO2), keep contact@Image1.com untouched."),
    "Use @image1, @image2, @image3–@image5, (@video1 and @video2), keep contact@Image1.com untouched.",
  );
  const seedancePixverseScene = {
    id: "S099",
    start_sec: 0,
    end_sec: 10,
    duration_sec: 10,
    characters: ["Khoang Nâu"],
    character_ids: ["char-ai-1"],
    location_id: "loc-1",
    video_prompt: "Match motion from @Video1 while @Image1 stays centered; Khoang Nâu steps forward.",
    dialogue_segments: [{ speaker_character: "Khoang Nâu", speaker_character_id: "char-ai-1", text: "Đi thôi!", start_sec: 1.0, end_sec: 2.5 }],
    videoReferenceImage: { kind: "image", status: "ready", localPath: "scene/S099.png" },
  };
  const seedancePixversePrompt = await provider.previewMaiVideoVideoPromptForScene({
    projectSlug: "test-project",
    chunkId: "A01",
    scene: seedancePixverseScene,
    projectScenes: [seedancePixverseScene],
    characters,
    locations,
    sceneIndex: 0,
    aspectRatio: "16:9",
    presetId: "ai-drama",
    videoSpokenLanguage: "vi",
    mediaGeneration: {
      videoProvider: "maivideo",
      videoModel: settings.PIXVERSE_SEEDANCE_2_FAST_MODEL_ID,
      videoDurationMode: "scene",
      videoUseSceneImageReference: true,
      videoUseCharacterReferences: true,
      videoUseLocationReferences: true,
    },
  });
  assert(seedancePixversePrompt.includes("@video1"), "Seedance PixVerse preview must normalize @Video1 -> @video1");
  assert(seedancePixversePrompt.includes("@image1"), "Seedance PixVerse preview must normalize @Image1 -> @image1");
  assert(!/@Image\d+|@Video\d+/.test(seedancePixversePrompt), "Seedance PixVerse preview must not contain uppercase @ImageN or @VideoN");

  const lowerLock = salesTemplates.salesVideoProductReferenceLock(2, { lowercaseTokens: true });
  const lowerInstruction = salesTemplates.salesVideoProductInstructionForImages(2, { lowercaseTokens: true });
  assert(lowerLock.includes("@image1") && lowerLock.includes("@image2") && lowerLock.includes("@image3"), "Lowercase sales lock must include @image1..@image3");
  assert(!/@Image\d+/.test(lowerLock), "Lowercase sales lock must not include @Image");
  assert(lowerInstruction.includes("@image1") && lowerInstruction.includes("@image2") && lowerInstruction.includes("@image3"), "Lowercase sales instruction must include @image1..@image3");
  assert(!/@Image\d+/.test(lowerInstruction), "Lowercase sales instruction must not include @Image");

  console.log("Passed: Muse 15s duration, @ImageN indexing, voice cues, mouth-closure lock, safety exclusions, PixVerse parity, Seedance PixVerse @image/@video tokens, and off-screen reference filtering.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

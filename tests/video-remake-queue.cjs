const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, console, process, URL, require: (id) => imports[id] ?? require(id) });
  return exports;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-remake-queue-test-"));
async function main() {
  const remake = load("video-remake", { "./ai-drama-scene-timing": load("ai-drama-scene-timing") });
  const windows = remake.makeRemakeWindows(610, 5);
  const sheets = Array.from({ length: Math.ceil(windows.length / 4) }, (_, sheet) => ({
    imagePath: `sheet-${sheet + 1}`,
    rows: windows.slice(sheet * 4, sheet * 4 + 4).map(({ sourceStart }, index) => ({
      scene: sheet * 4 + index + 1, framesAt: [sourceStart + 1],
    })),
  }));
  const plan = {
    sourceSummary: "Nguồn", title: "Phiên bản mới", logline: "Mục tiêu", synopsis: "Câu chuyện",
    openingHook: "Mở đầu", turningPoint: "Bước ngoặt", ending: "Kết thúc", continuity: "Giữ đạo cụ",
    visualStyle: "Warm & emotional", imageStyle: "Stylized 3D", contentGenre: "comedy", storySetting: "modern",
    characters: [{ name: "Mai", description: "Người giao hàng", imagePrompt: "Full-body character design of a cheerful young courier, plain clean white studio background" }],
    locations: [
      { name: "Sân", description: "Sân ngoài trời", imagePrompt: "Outdoor sunlit stone courtyard, empty of people, no text" },
      { name: "Cổng gỗ", description: "Cổng gỗ đầu ngõ", imagePrompt: "Weathered wooden garden gate opening to cobblestone lane, empty of people, no text" },
      { name: "Hiên nhà", description: "Hiên nhà mái ngói", imagePrompt: "Shaded tiled veranda with wooden pillars and bench, empty of people, no text" },
      { name: "Bãi cỏ", description: "Bãi cỏ ven đường", imagePrompt: "Quiet green roadside meadow with low stone wall, empty of people, no text" },
    ],
  };
  const observed = [];
  let queue;
  let jobId;
  const entityName = load("entity-name");
  const aiDramaGuidance = load("ai-drama-video-prompt-guidance");
  const contentGenres = load("content-genres");
  const visualStyles = load("visual-styles");
  const videoPromptPolicy = load("video-prompt-policy");
  const dialoguePacing = load("dialogue-pacing", {
    "./dialogue-segments": load("dialogue-segments", { "./entity-name": entityName }),
  });
  queue = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": { prepareRemakeMedia: async () => ({
      windows, sheets, aspectRatio: "9:16", transcript: { kind: "captions",
        text: "1\n00:00:02,000 --> 00:00:04,000\nPHUDEDAU\n\n2\n00:10:05,000 --> 00:10:06,000\nPHUDECUOI" },
    }) },
    "./coding-agent-cli": { generateWithCodingAgent: async (_agent, prompt, { imagePaths }) => {
      const job = await queue.getRemakeJob("test-user", jobId);
      observed.push({ prompt, images: Array.from(imagePaths), completed: job.progress.completed });
      if (observed.length === 1) return { result: { ...plan, beats: Array.from({ length: 8 }, (_, i) => `Nhóm ${i + 1}`) } };
      const batchIndex = observed.length - 2;
      const start = batchIndex * 12;
      const size = Math.min(12, windows.length - start);
      const rhythm = start === 0 ? [3, 2, 1, 1, 1, 1, 1, 1, 1] : Array(size).fill(1);
      let sourceIndex = start;
      const usesNewLocation = batchIndex === 1;
      return { result: {
        ...(usesNewLocation ? { newLocations: [{ name: "Hành lang", description: "Hành lang gỗ", imagePrompt: "Narrow wooden corridor with warm wall lamps, empty of people, no text" }] } : {}),
        scenes: rhythm.map((sourceWindows, sceneIdx) => {
          sourceIndex += sourceWindows;
          const location = usesNewLocation && sceneIdx === 0 ? "Hành lang" : "Sân";
          return {
            sourceWindows,
            sourceVisuals: "Hình ảnh", sourceStory: "Nội dung", sourceRole: "Nhịp",
            purpose: "Mục đích", action: `Cảnh ${sourceIndex}`, characters: ["Mai"], location,
            dialogueMode: "visual_led",
            actingBeat: "@Mai scans the package carefully.",
            blocking: "@Mai stands center facing camera.",
            shotSize: "Medium Shot",
            cameraMovement: "02 Tracking Forward + Gentle Pan following @Mai toward the gate.",
            eyelineAction: "@Mai looks toward the wooden gate.",
            sfx: "Footsteps on stone courtyard.", vfx: "none",
            continuityIn: "Trước cảnh", continuityOut: `Sau cảnh ${sourceIndex}`,
            imagePrompt: `@Mai stands at ${location} holding a parcel, focused expression, 9:16 framing.`,
            videoPrompt: `PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. @Mai walks steadily toward the door. End state: @Mai reaches the latch.`,
            dialogue: [],
          };
        }),
      } };
    } },
  });
  jobId = await queue.addRemakeJob("test-user", {
    url: "https://example.test/video.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });

  await queue.runRemakeQueue();
  const job = await queue.getRemakeJob("test-user", jobId);
  assert.equal(job.status, "ready", job.error);
  assert.equal(job.result.windows.length, 119);
  assert.equal(job.result.draft.scenes.length, 119);
  assert.equal(job.result.draft.imageStyle, "Stylized 3D");
  assert.equal(job.result.draft.visualStyle, "Warm & emotional");
  assert.equal(job.result.draft.contentGenre, "comedy");
  assert.ok(job.result.draft.locations.some((loc) => loc.name === "Hành lang"));
  assert.deepEqual(Array.from(job.result.windows.slice(0, 3), ({ duration }) => duration), [15, 10, 5]);
  assert.equal(job.result.draft.scenes.at(-1).action, "Cảnh 122");
  assert.equal(observed.length, 12);
  assert.equal(observed[0].images.length, 12);
  assert.equal(observed[0].images.at(-1), "sheet-31");
  assert.match(observed[0].prompt, /requireReferenceIdentityOnly/);
  assert.match(observed[0].prompt, /180 ĐỘ/);
  assert.match(observed[2].prompt, /Trạng thái nối tiếp từ các cảnh ngay trước/);
  assert.ok(observed.slice(1, -1).every(({ images }) => images.length === 3));
  assert.deepEqual(observed.map(({ completed }) => completed), [0, 0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]);
  assert.match(observed[1].prompt, /PHUDEDAU/);
  assert.doesNotMatch(observed[1].prompt, /PHUDECUOI/);
  assert.match(observed.at(-1).prompt, /PHUDECUOI/);
  assert.match(observed.at(-1).prompt, /Sau cảnh 120/);
  const projects = [];
  const payloads = new Map();
  const projectTypes = load("project-types");
  const projectModule = load("video-remake-project", {
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./continuity-qa": { buildContinuityQaReport: async () => ({}) },
    "./drama-plan": { normalizeDramaPlan: (plan) => plan, dramaPlanSourceText: () => "Nguồn" },
    "./episode-locations": { reconcileEpisodeLocations: (locations, { scenes }) => ({ locations, scenes }) },
    "./episode-script-validation": load("episode-script-validation", {
      "./ai-drama-scene-timing": load("ai-drama-scene-timing"),
      "./dialogue-pacing": dialoguePacing,
    }),
    "./project-types": projectTypes,
    "./scene-ai-review": { evaluateChunkScenes: async ({ scenes }) => ({ scenes, summary: { needsChanges: 0 } }) },
    "./story-context": { continuityContextFromOutput: ({ chunkId }) => ({ chunkId }) },
    "./server-store": {
      createChunks: (count, size) => Array.from({ length: Math.ceil(count / size) }, (_, i) => ({
        id: `A${String(i + 1).padStart(2, "0")}`, sceneStart: i * size + 1, sceneEnd: Math.min(count, (i + 1) * size),
      })),
      makeActivity: (activity) => activity,
      makeProject: (input, slug) => ({ ...input, slug, createdAt: new Date().toISOString() }),
      saveChunkOutput: async (_slug, id, payload) => { payloads.set(id, payload); return id; },
      updateDataForUser: async (_owner, write) => write({ projects, activities: [] }),
    },
  });
  const slug = await projectModule.createRemakeProject("test-user", job);
  assert.equal(await projectModule.createRemakeProject("test-user", job), slug);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].imageStyle, "Stylized 3D");
  assert.equal(projects[0].visualStyle, "Warm & emotional");
  assert.equal(projects[0].contentGenre, "comedy");
  assert.equal(projects[0].storySetting, "modern");
  assert.equal(projects[0].durationSeconds, 610);
  assert.equal(projects[0].completedScenes, 119);
  assert.equal(projects[0].completedChunks, 2);
  assert.equal(payloads.get("A01").scenes[0].speaker_character, "NONE");
  assert.equal(payloads.get("A01").scenes[0].shot_size, "Medium Shot");
  assert.match(payloads.get("A01").scenes[0].video_prompt, /SFX:/);
  assert.equal(payloads.get("A01").scenes.at(-1).id, "S100");
  assert.equal(payloads.get("A02").scenes[0].id, "S101");
  assert.equal(payloads.get("A02").scenes.at(-1).end_sec, 610);

  // Verify reference-identity lock auto-repair, pacing auto-repair, and compactRetry preserving all batch sheets & transcript.
  const shortWindows = remake.makeRemakeWindows(15, 5);
  const shortSheets = [{ imagePath: "short-1", rows: shortWindows.map(({ sourceStart }, idx) => ({ scene: idx + 1, framesAt: [sourceStart + 0.5] })) }];
  let shortAttempt = 0;
  const repairObserved = [];
  const repairQueue = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": load("entity-name"),
    "./video-remake-media": { prepareRemakeMedia: async () => ({
      windows: shortWindows, sheets: shortSheets, aspectRatio: "16:9",
      transcript: { kind: "captions", text: "1\n00:00:01,000 --> 00:00:03,000\nCANHMO" },
    }) },
    "./coding-agent-cli": { generateWithCodingAgent: async (_agent, prompt, { imagePaths }) => {
      shortAttempt += 1;
      repairObserved.push({ prompt, images: Array.from(imagePaths) });
      if (shortAttempt === 1) {
        const err = new Error("AGENT_OUTPUT_INVALID_JSON");
        err.name = "AGENT_OUTPUT_INVALID_JSON";
        throw err;
      }
      const badIdentity = shortAttempt === 2;
      return { result: {
        ...plan,
        scenes: [{
          sourceWindows: 3,
          sourceVisuals: "Hình", sourceStory: "Nội dung", sourceRole: "Hook",
          purpose: "Mở đầu", action: "Mai mở cửa", characters: ["Mai"], location: "Sân",
          dialogueMode: "dialogue_led",
          actingBeat: "@Mai opens the door.", blocking: "@Mai screen-left.", shotSize: "Medium",
          cameraMovement: "02 Tracking Forward + Gentle Pan", eyelineAction: "@Mai looks inside.",
          sfx: "Door creak.", vfx: "none", continuityIn: "Bắt đầu", continuityOut: "Kết thúc",
          imagePrompt: badIdentity ? "A 22-year-old woman Mai opens the door." : "@Mai opens the wooden gate, wide eyes.",
          videoPrompt: "PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. @Mai speaks through the scene.",
          dialogue: badIdentity ? [
            { speaker: "Mai", text: "Ai ở đó?", start: 1.0, end: 2.8 },
            { speaker: "Mai", text: "Ra mặt đi!", start: 5.0, end: 8.0 },
            { speaker: "Mai", text: "Tôi nghe thấy rồi!", start: 10.2, end: 13.5 },
          ] : [
            { speaker: "Mai", text: "Ai ở đó?", start: 0.5, end: 3.8 },
            { speaker: "Mai", text: "Ra mặt đi, tôi thấy rồi!", start: 4.5, end: 8.5 },
            { speaker: "Mai", text: "Đừng trốn nữa, tôi nghe rõ tiếng bước chân!", start: 9.2, end: 13.5 },
          ],
        }],
      } };
    } },
  });
  const shortJobId = await repairQueue.addRemakeJob("test-user-2", {
    url: "https://example.test/short.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "creative", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });
  await repairQueue.runRemakeQueue();
  const shortJob = await repairQueue.getRemakeJob("test-user-2", shortJobId);
  assert.equal(shortJob.status, "ready", shortJob.error);
  assert.equal(shortAttempt, 3);
  assert.match(repairObserved[1].prompt, /CANHMO/);
  assert.deepEqual(repairObserved[1].images, ["short-1"]);
  assert.match(repairObserved[2].prompt, /tuổi\/ngoại hình/);
  console.log("Passed 10-minute queue, newLocations, style/genre mapping, reference lock repair, compactRetry preservation and two-episode handoff.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));

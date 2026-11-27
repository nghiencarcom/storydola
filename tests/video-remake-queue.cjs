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
  vm.runInNewContext(outputText, {
    exports,
    console,
    process,
    URL,
    Buffer,
    AbortController,
    AbortSignal,
    DOMException,
    setTimeout,
    clearTimeout,
    require: (id) => imports[id] ?? require(id),
  });
  return exports;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-remake-queue-test-"));
async function main() {
  const projectTypes = load("project-types");
  const remake = load("video-remake", {
    "./ai-drama-scene-timing": load("ai-drama-scene-timing"),
    "./project-types": projectTypes,
  });
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
    dialoguePolicy: "spoken",
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
  const visualPromptSafety = load("visual-prompt-safety");
  const dialoguePacing = load("dialogue-pacing", {
    "./dialogue-segments": load("dialogue-segments", { "./entity-name": entityName }),
  });
  queue = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./visual-prompt-safety": visualPromptSafety,
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
      const usesNewCharacter = batchIndex === 2;
      return { result: {
        ...(usesNewCharacter ? { newCharacters: [{ name: "Tơ Vàng", description: "Golden squirrel", imagePrompt: "Stylized 3D golden squirrel on plain clean white studio background" }] } : {}),
        ...(usesNewLocation ? { newLocations: [{ name: "Hành lang", description: "Hành lang gỗ", imagePrompt: "Narrow wooden corridor with warm wall lamps, empty of people, no text" }] } : {}),
        scenes: rhythm.map((sourceWindows, sceneIdx) => {
          sourceIndex += sourceWindows;
          const location = usesNewLocation && sceneIdx === 0 ? "Hành lang" : "Sân";
          const includeToVang = usesNewCharacter && sceneIdx === 0;
          return {
            sourceWindows,
            sourceVisuals: "Hình ảnh", sourceStory: "Nội dung", sourceRole: "Nhịp",
            purpose: "Mục đích", action: `Cảnh ${sourceIndex}`, characters: includeToVang ? ["Mai", "Tơ Vàng"] : ["Mai"], location,
            dialogueMode: "visual_led",
            actingBeat: "@Mai scans the package carefully.",
            blocking: "@Mai stands center facing camera.",
            shotSize: "Medium Shot",
            cameraMovement: "02 Tracking Forward + Gentle Pan following @Mai toward the gate.",
            eyelineAction: "@Mai looks toward the wooden gate.",
            sfx: "Footsteps on stone courtyard.", vfx: "none",
            continuityIn: "Trước cảnh", continuityOut: `Sau cảnh ${sourceIndex}`,
            imagePrompt: `@Mai${includeToVang ? " and To Vang" : ""} stands at ${location} holding a parcel, focused expression, 9:16 framing.`,
            videoPrompt: `PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. @Mai${includeToVang ? " and @ToVang" : ""} walks steadily toward the door. End state: @Mai reaches the latch.`,
            dialogue: [],
          };
        }),
      } };
    } },
  });
  jobId = await queue.addRemakeJob("test-user", {
    url: "https://example.test/video.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
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
  assert.ok(job.result.draft.characters.some((char) => char.name === "Tơ Vàng"));
  assert.match(observed[0].prompt, /NHỊP CẢNH ĐA DẠNG & PHỐI HỢP 5s · 10s · 15s/);
  assert.match(observed[0].prompt, /sourceWindows = 3/);
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
  const dramaPlanModule = load("drama-plan", {
    "./image-scene-guidance": load("image-scene-guidance"),
    "./ai-drama-reference-prompts": load("ai-drama-reference-prompts"),
    "./visual-prompt-safety": visualPromptSafety,
  });
  const projectModule = load("video-remake-project", {
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-remake": remake,
    "./entity-name": entityName,
    "./continuity-qa": { buildContinuityQaReport: async () => ({}) },
    "./drama-plan": dramaPlanModule,
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
  assert.match(projects[0].sourceText, /A01 · .* · S001–S057/);
  assert.match(projects[0].sourceText, /A02 · .* · S058–S117/);
  assert.match(projects[0].sourceText, /A03 · .* · S118–S119/);
  assert.equal(projects[0].imageStyle, "Stylized 3D");
  assert.equal(projects[0].visualStyle, "Warm & emotional");
  assert.equal(projects[0].contentGenre, "comedy");
  assert.equal(projects[0].storySetting, "modern");
  assert.equal(projects[0].durationSeconds, 610);
  assert.equal(projects[0].completedScenes, 119);
  assert.equal(projects[0].completedChunks, 3);
  assert.equal(payloads.get("A01").scenes[0].act, "Opening hook");
  assert.equal(payloads.get("A01").scenes.at(-1).act, "Episode end hook");
  assert.equal(payloads.get("A02").scenes[0].act, "Opening hook");
  assert.equal(payloads.get("A03").scenes.at(-1).act, "Payoff");
  assert.equal(payloads.get("A01").scenes[0].speaker_character, "NONE");
  assert.equal(payloads.get("A01").scenes[0].shot_size, "Medium Shot");
  assert.match(payloads.get("A01").scenes[0].image_keyword, /^[A-Za-z0-9 '-]+$/);
  assert.match(payloads.get("A01").scenes[0].video_prompt, /SFX:/);
  assert.equal(payloads.get("A01").scenes.at(-1).id, "S057");
  assert.equal(payloads.get("A02").scenes[0].id, "S058");
  assert.equal(payloads.get("A03").scenes.at(-1).end_sec, 610);

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
    "./visual-prompt-safety": visualPromptSafety,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
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
    remakeMode: "creative", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });
  await repairQueue.runRemakeQueue();
  const shortJob = await repairQueue.getRemakeJob("test-user-2", shortJobId);
  assert.equal(shortJob.status, "ready", shortJob.error);
  assert.equal(shortAttempt, 3);
  assert.match(repairObserved[1].prompt, /CANHMO/);
  assert.deepEqual(repairObserved[1].images, ["short-1"]);
  assert.match(repairObserved[2].prompt, /tuổi\/ngoại hình/);

  // Verify non-dialogue funny SFX+VFX auto workflow: audio spike/pause extraction, auto_silent detection, slapstick verb & timestamp repair.
  const { extractAudioWindowCues } = load("video-remake-media", {
    sharp: () => ({ resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.alloc(0) }) }) }),
    "./public-product-page": { isPublicIp: () => true },
    "./source-ingest": { ingestSourceUrl: async () => undefined },
    "./video-remake": remake,
    "./video-remake-source": { classifyRemakeSource: () => undefined },
    "./video-remake-maivideo": { downloadFromMaiVideo: async () => "" },
  });
  const sampleRate = 500;
  const pcm = Buffer.alloc(5 * sampleRate * 2, 0);
  // 0.0-1.4s silent comedic pause; 1.4-2.8s moderate foley; 1.8-2.0s sharp loud boing spike.
  for (let i = Math.floor(1.4 * sampleRate); i < 5 * sampleRate; i++) pcm.writeInt16LE(1500, i * 2);
  for (let i = Math.floor(1.8 * sampleRate); i < Math.floor(2.0 * sampleRate); i++) pcm.writeInt16LE(26000, i * 2);
  const funnyWindows = remake.makeRemakeWindows(5, 5);
  const audioCues = extractAudioWindowCues(pcm, sampleRate, funnyWindows);
  assert.equal(audioCues.length, 1);
  assert.ok(audioCues[0].pauses.some(([s, e]) => s === 0 && e >= 1.2));
  assert.ok(audioCues[0].peaksAt.some((t) => Math.abs(t - 1.9) <= 0.25));

  let funnyAttempt = 0;
  const funnyObserved = [];
  const funnyQueue = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./visual-prompt-safety": visualPromptSafety,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": { prepareRemakeMedia: async () => ({
      windows: funnyWindows,
      sheets: [{ imagePath: "funny-1", rows: [{ scene: 1, framesAt: [0.4, 1.75, 3.25, 4.5] }] }],
      aspectRatio: "9:16",
      transcript: { kind: "unavailable", text: "" },
      audioCues,
    }) },
    "./coding-agent-cli": { generateWithCodingAgent: async (_agent, prompt) => {
      funnyAttempt += 1;
      funnyObserved.push(prompt);
      const badSlapstick = funnyAttempt === 1;
      const badTimestampAndSpeech = funnyAttempt === 2;
      return { result: {
        ...plan,
        dialoguePolicy: "silent_sfx",
        contentGenre: "animal-adventure",
        characters: [{ name: "Barnaby", description: "Sóc đất", imagePrompt: "Stylized 3D desert squirrel on plain white background" }],
        locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Stylized 3D sandstone ledge, empty of animals, no text" }],
        scenes: [{
          sourceWindows: 1,
          sourceVisuals: "Sóc ấn nắp thùng", sourceStory: "Hài hình thể", sourceRole: "Comedic payoff",
          purpose: "Cú bật lò xo hài hước", action: "Barnaby bật lộn nhào vào đống cát",
          characters: ["Barnaby"], location: "Canyon",
          dialogueMode: "visual_led",
          actingBeat: "Barnaby freezes then tumbles in comic shock.",
          blocking: "Barnaby center-right rebounding screen-left.",
          shotSize: "Low-Angle Medium Shot",
          cameraMovement: "22 Push-In + Rapid Pull-Back",
          eyelineAction: "Barnaby squints at latch then eyes pop wide.",
          sfx: "0.0-1.2s comedic pause; 1.9s spring boing; 2.8s sand thump.",
          vfx: "1.9-2.7s spiral golden dust burst and brass coil motion trail fading by 2.7s.",
          continuityIn: "Barnaby rón rén bên thùng", continuityOut: "Barnaby ngồi choáng trên cát",
          imagePrompt: "Barnaby leans on tiptoe pressing a trembling crate latch on Canyon, 9:16 Stylized 3D.",
          videoPrompt: badSlapstick
            ? "0.0-2.0s: Fast cut to crate lid as Barnaby watches. 2.0-5.0s: Crate lid bounces Barnaby onto the sand."
            : badTimestampAndSpeech
              ? "10-20: Barnaby tumbles onto sand and speaks loudly."
              : "PRIMARY CAMERA COMBO: 22 Push-In + Rapid Pull-Back. 0.0-1.8s: Barnaby freezes in a silent pause and does not speak. 1.9-5.0s: Crate lid springs open, launching Barnaby bouncing playfully onto a soft sand dune, dizzy without talking.",
          dialogue: [],
        }],
      } };
    } },
  });
  const funnyJobId = await funnyQueue.addRemakeJob("test-user-3", {
    url: "https://example.test/funny.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });
  await funnyQueue.runRemakeQueue();
  const funnyJob = await funnyQueue.getRemakeJob("test-user-3", funnyJobId);
  assert.equal(funnyJob.status, "ready", funnyJob.error);
  assert.equal(funnyAttempt, 3);
  assert.match(funnyObserved[0], /TỰ ĐỘNG PHÁT HIỆN NGUỒN KHÔNG HỘI THOẠI/);
  assert.match(funnyObserved[0], /PHÂN BIỆT CHẤT LIỆU CHUYỂN ĐỘNG, NHỊP MÁY & SFX\/VFX THEO ĐÚNG THỂ LOẠI/);
  assert.match(funnyObserved[0], /HORROR \/ MYSTERY-THRILLER/);
  assert.match(funnyObserved[0], /DRAMA \/ ROMANCE/);
  assert.match(funnyObserved[0], /peaksAt/);
  assert.match(funnyObserved[0], /SPOILER FRAME-0/);
  assert.match(funnyObserved[1], /lệnh cắt cảnh/);
  assert.match(funnyObserved[2], /mốc thời gian trong videoPrompt sai/);
  const funnySlug = await projectModule.createRemakeProject("test-user-3", funnyJob);
  assert.ok(funnySlug.startsWith("remake-"));
  const funnyScene = payloads.get("A01").scenes[0];
  assert.equal(funnyScene.dialogue_mode, "visual_led");
  assert.equal(funnyScene.speaker_character, "NONE");
  assert.match(funnyScene.video_prompt, /SFX: 0\.0-1\.2s comedic pause/);
  assert.match(funnyScene.video_prompt, /VFX: 1\.9-2\.7s spiral golden dust burst/);

  // Verify case-sensitive mentionedCanonicalCharacters false-positive guard (Vietnamese & English common words).
  const canonical = ["Mai", "Yên", "Bình", "Nam", "Max", "Amber", "Shadow"];
  assert.deepEqual(
    Array.from(queue.mentionedCanonicalCharacters("Trời sáng mai yên tâm đặt chiếc bình về phía nam.", canonical)),
    [],
  );
  assert.deepEqual(
    Array.from(queue.mentionedCanonicalCharacters("Camera tracks at max speed through warm amber light as a tree casts a shadow.", canonical)),
    [],
  );
  assert.deepEqual(
    Array.from(queue.mentionedCanonicalCharacters("Mai và @nam chạy qua sân cùng Max.", canonical)),
    ["Mai", "Nam", "Max"],
  );
  assert.deepEqual(
    Array.from(queue.mentionedCanonicalCharacters("Sợi tơ vàng óng ánh dưới nắng sớm.", ["Tơ Vàng", "Ánh Kim"])),
    [],
  );
  assert.deepEqual(
    Array.from(queue.mentionedCanonicalCharacters("To Vang leaps beside @AnhKim across the stone ledge.", ["Tơ Vàng", "Ánh Kim"])),
    ["Tơ Vàng", "Ánh Kim"],
  );

  // Verify Docker PID-1 / dead-PID crash lock recovery, 8-sheet compactRetry preservation, sfx/vfx validation & full validateDraft repair.
  const eightSheetWindows = remake.makeRemakeWindows(120, 5); // 24 windows = 8 sheets
  const eightSheets = Array.from({ length: 8 }, (_, idx) => ({
    imagePath: `eight-sheet-${idx + 1}`,
    rows: eightSheetWindows.slice(idx * 3, idx * 3 + 3).map(({ sourceStart }, r) => ({
      scene: idx * 3 + r + 1,
      framesAt: [sourceStart + 0.5],
    })),
  }));
  let edgeAttempt = 0;
  const edgeImages = [];
  const edgePrompts = [];
  delete globalThis.storyAiRemake;
  const edgeQueue = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./visual-prompt-safety": visualPromptSafety,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": { prepareRemakeMedia: async () => ({
      windows: eightSheetWindows,
      sheets: eightSheets,
      aspectRatio: "16:9",
      transcript: { kind: "silent", text: "" },
      audioCues: [],
    }) },
    "./coding-agent-cli": { generateWithCodingAgent: async (_agent, prompt, { imagePaths }) => {
      edgeAttempt += 1;
      edgeImages.push(Array.from(imagePaths));
      edgePrompts.push(prompt);
      if (edgeAttempt === 1) {
        const err = new Error("AGENT_OUTPUT_INVALID_JSON");
        err.name = "AGENT_OUTPUT_INVALID_JSON";
        throw err;
      }
      const makeEightScenes = (overrideFirst = {}) => Array.from({ length: 8 }, (_, idx) => ({
        sourceWindows: 3,
        sourceVisuals: "Hình", sourceStory: "Truyện", sourceRole: "Beat",
        purpose: "Mục đích", action: `Barnaby bật nhảy nhịp ${idx + 1}`,
        characters: ["Barnaby"], location: "Canyon",
        dialogueMode: "visual_led",
        actingBeat: "Barnaby leaps playfully.", blocking: "Barnaby center.",
        shotSize: "Medium Shot", cameraMovement: "02 Tracking Forward + Gentle Pan",
        eyelineAction: "Barnaby looks ahead.",
        sfx: "1.0s soft sand thump.", vfx: "none",
        continuityIn: "Tiếp đà", continuityOut: "Đáp xuống",
        imagePrompt: "Barnaby crouches on Canyon sandstone rim, 16:9 Stylized 3D.",
        videoPrompt: "PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. 0.0-15.0s: Barnaby bounds across the sandstone rim without speaking.",
        dialogue: [],
        ...(idx === 0 ? overrideFirst : {}),
      }));
      if (edgeAttempt === 2) {
        // Trigger unknown location error -> must be caught by RemakeValidationError and repaired!
        return {
          result: {
            ...plan,
            dialoguePolicy: "silent_sfx",
            characters: [{ name: "Barnaby", description: "Sóc", imagePrompt: "Squirrel on white background" }],
            locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Sandstone ledge, empty" }],
            scenes: makeEightScenes({ location: "Địa điểm lạ" }),
          },
        };
      }
      if (edgeAttempt === 3) {
        // Trigger out-of-bounds timestamp inside SFX -> must be caught by sfx/vfx validation and repaired!
        return {
          result: {
            ...plan,
            dialoguePolicy: "silent_sfx",
            characters: [{ name: "Barnaby", description: "Sóc", imagePrompt: "Squirrel on white background" }],
            locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Sandstone ledge, empty" }],
            scenes: makeEightScenes({ sfx: "18.0-22.0s loud boulder rumble." }),
          },
        };
      }
      return {
        result: {
          ...plan,
          dialoguePolicy: "silent_sfx",
          characters: [{ name: "Barnaby", description: "Sóc", imagePrompt: "Squirrel on white background" }],
          locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Sandstone ledge, empty" }],
          scenes: makeEightScenes(),
        },
      };
    } },
  });

  const edgeUser = "docker-pid1-user";
  const edgeJobId = await edgeQueue.addRemakeJob(edgeUser, {
    url: "https://example.test/eight.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });
  // Plant a fresh lock from a "previous Docker container boot" with the SAME PID (simulating PID 1 restart).
  const edgeFolder = edgeQueue.remakeOwnerFolder(edgeUser);
  const plantedLock = path.join(root, "video-remake", edgeFolder, `.${edgeJobId}.lock`);
  fs.writeFileSync(plantedLock, JSON.stringify({
    pid: process.pid,
    bootId: "00000000-0000-4000-8000-000000000001",
    startedAt: new Date().toISOString(),
  }));
  await edgeQueue.runRemakeQueue();
  const edgeJob = await edgeQueue.getRemakeJob(edgeUser, edgeJobId);
  assert.equal(edgeJob.status, "ready", edgeJob.error);
  // compactRetry on 8 sheets must keep all 8 sheets!
  assert.equal(edgeImages[0].length, 8);
  assert.equal(edgeImages[1].length, 8);
  assert.match(edgePrompts[2], /bối cảnh nằm ngoài danh sách chuẩn/);
  assert.match(edgePrompts[3], /mốc thời gian trong videoPrompt sai/);

  // Verify local upload stale .upload.lock recovery, updated options/agent on finishRemakeUpload, upload auto-cleanup on ready, and deleteRemakeJob cancellation.
  delete globalThis.storyAiRemake;
  let cancelableStarted;
  const startedPromise = new Promise((resolve) => { cancelableStarted = resolve; });
  const localWorker = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./visual-prompt-safety": visualPromptSafety,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": {
      prepareRemakeMedia: async (input, _work, _dl, localSourceFile, signal) => {
        if (localSourceFile) assert.ok(fs.existsSync(localSourceFile));
        if (input.direction === "cancel-me") {
          cancelableStarted();
          await new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          });
        }
        return {
          windows: funnyWindows,
          sheets: [{ imagePath: "local-1", rows: [{ scene: 1, framesAt: [0.5] }] }],
          aspectRatio: "9:16",
          transcript: { kind: "silent", text: "" },
          audioCues: [],
        };
      },
    },
    "./coding-agent-cli": {
      generateWithCodingAgent: async (agentName, prompt) => {
        if (prompt.includes("timeout-me")) {
          const err = new Error("Command timed out");
          err.name = "AGENT_RUN_TIMEOUT";
          throw err;
        }
        assert.equal(agentName, "claude");
        return {
          result: {
            ...plan,
            dialoguePolicy: "silent_sfx",
            characters: [{ name: "Barnaby", description: "Sóc", imagePrompt: "Squirrel on white background" }],
            locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Sandstone ledge, empty" }],
            scenes: [{
              sourceWindows: 1,
              sourceVisuals: "Hình", sourceStory: "Truyện", sourceRole: "Hook",
              purpose: "Mục đích", action: "Barnaby nhảy qua đá",
              characters: ["Barnaby"], location: "Canyon",
              dialogueMode: "visual_led",
              actingBeat: "Barnaby jumps.", blocking: "Center.",
              shotSize: "Medium", cameraMovement: "02 Tracking Forward + Gentle Pan",
              eyelineAction: "Forward.", sfx: "0.5s sand thump.", vfx: "none",
              continuityIn: "Đầu", continuityOut: "Cuối",
              imagePrompt: "Barnaby on Canyon, 9:16 Stylized 3D.",
              videoPrompt: "PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. 0.0-5.0s: Barnaby hops across the ledge without speaking.",
              dialogue: [],
            }],
          },
        };
      },
    },
  });
  const uploadModule = load("video-remake-upload", {
    "./data-directory": { dataPath: (...parts) => path.join(root, ...parts) },
    "./video-remake-worker": localWorker,
  });
  const uploadOwner = "upload-user";
  const uploadFolder = localWorker.remakeOwnerFolder(uploadOwner);
  const payloadBytes = Buffer.from("fake-mp4-video-bytes");
  const begun = await uploadModule.beginRemakeUpload(uploadOwner, "clip.mp4", payloadBytes.length, {
    language: "vi", direction: "initial", transcript: "", remakeMode: "faithful",
    dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "codex", model: "", quality: "auto", speed: "standard" });

  // Plant a stale .upload.lock from a crashed PID and ensure writeRemakeUploadChunk recovers immediately.
  const staleUploadLock = path.join(root, "video-remake", uploadFolder, "uploads", begun.uploadId, ".upload.lock");
  fs.writeFileSync(staleUploadLock, JSON.stringify({ pid: 99999999, bootId: "dead", startedAt: new Date().toISOString() }));
  const chunkRes = await uploadModule.writeRemakeUploadChunk(uploadOwner, begun.uploadId, 0, payloadBytes);
  assert.equal(chunkRes.kind, "ok");

  // Finish upload with updated options + updated agent (claude instead of codex).
  const finished = await uploadModule.finishRemakeUpload(uploadOwner, begun.uploadId, {
    options: {
      language: "en", direction: "updated-direction", transcript: "", remakeMode: "creative",
      dialoguePolicy: "silent_sfx", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
    },
    agent: { agent: "claude", model: "claude-sonnet", quality: "high", speed: "standard" },
  });
  assert.equal(finished.kind, "queued");
  await localWorker.runRemakeQueue();
  const completedLocalJob = await localWorker.getRemakeJob(uploadOwner, finished.id);
  assert.equal(completedLocalJob.status, "ready", completedLocalJob.error);
  assert.equal(completedLocalJob.input.language, "en");
  assert.equal(completedLocalJob.input.direction, "updated-direction");
  assert.equal(completedLocalJob.agent.agent, "claude");
  // Upload directory must be cleaned up automatically once ready!
  assert.equal(fs.existsSync(path.join(root, "video-remake", uploadFolder, "uploads", begun.uploadId)), false);

  // Verify accurate timeout error message (not masked under login message).
  const timeoutJobId = await localWorker.addRemakeJob(uploadOwner, {
    url: "https://example.test/timeout.mp4", language: "vi", direction: "timeout-me", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" });
  await localWorker.runRemakeQueue();
  const timeoutJob = await localWorker.getRemakeJob(uploadOwner, timeoutJobId);
  assert.equal(timeoutJob.status, "failed");
  assert.match(timeoutJob.error, /quá thời gian chờ/);

  // Verify deleteRemakeJob aborts an in-flight local upload job and deletes json, lock, and upload directory.
  const cancelBegun = await uploadModule.beginRemakeUpload(uploadOwner, "cancel.mp4", payloadBytes.length, {
    language: "vi", direction: "cancel-me", transcript: "", remakeMode: "faithful",
    dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" });
  await uploadModule.writeRemakeUploadChunk(uploadOwner, cancelBegun.uploadId, 0, payloadBytes);
  const cancelQueued = await uploadModule.finishRemakeUpload(uploadOwner, cancelBegun.uploadId);
  const runningPromise = localWorker.runRemakeQueue();
  await startedPromise;
  const deleteStatus = await localWorker.deleteRemakeJob(uploadOwner, cancelQueued.id);
  assert.equal(deleteStatus, "deleted");
  await runningPromise;
  assert.equal(await localWorker.getRemakeJob(uploadOwner, cancelQueued.id), undefined);
  assert.equal(fs.existsSync(path.join(root, "video-remake", uploadFolder, "uploads", cancelBegun.uploadId)), false);
  assert.equal(fs.existsSync(path.join(root, "video-remake", uploadFolder, `.${cancelQueued.id}.lock`)), false);

  // Verify true parallel execution when a second job is added while a first job is already analyzing.
  let activeParallelCount = 0;
  let peakParallelCount = 0;
  let releaseBothJobs;
  const bothGate = new Promise((resolve) => { releaseBothJobs = resolve; });
  let firstEnteredResolve;
  const firstEntered = new Promise((resolve) => { firstEnteredResolve = resolve; });
  let secondEnteredResolve;
  const secondEntered = new Promise((resolve) => { secondEnteredResolve = resolve; });
  const parallelWorker = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./video-prompt-policy": videoPromptPolicy,
    "./visual-prompt-safety": visualPromptSafety,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, "parallel-data", ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": {
      prepareRemakeMedia: async () => ({
        windows: remake.makeRemakeWindows(5, 5),
        sheets: [{ imagePath: "s-1", rows: [{ scene: 1, framesAt: [0.5] }] }],
        aspectRatio: "16:9",
        transcript: { kind: "silent", text: "" },
        audioCues: [],
      }),
    },
    "./coding-agent-cli": {
      generateWithCodingAgent: async () => {
        activeParallelCount += 1;
        if (activeParallelCount > peakParallelCount) peakParallelCount = activeParallelCount;
        if (activeParallelCount === 1) firstEnteredResolve();
        if (activeParallelCount === 2) secondEnteredResolve();
        await bothGate;
        activeParallelCount -= 1;
        return {
          result: {
            ...plan,
            dialoguePolicy: "silent_sfx",
            characters: [{ name: "Barnaby", description: "Sóc", imagePrompt: "Squirrel on white background" }],
            locations: [{ name: "Canyon", description: "Mỏm đá", imagePrompt: "Sandstone ledge, empty" }],
            scenes: [{
              sourceWindows: 1,
              sourceVisuals: "Hình", sourceStory: "Truyện", sourceRole: "Hook",
              purpose: "Mục đích", action: "Barnaby nhảy qua đá",
              characters: ["Barnaby"], location: "Canyon",
              dialogueMode: "visual_led",
              actingBeat: "Barnaby jumps.", blocking: "Center.",
              shotSize: "Medium", cameraMovement: "02 Tracking Forward + Gentle Pan",
              eyelineAction: "Forward.", sfx: "0.5s sand thump.", vfx: "none",
              continuityIn: "Đầu", continuityOut: "Cuối",
              imagePrompt: "Barnaby on Canyon, 16:9 Stylized 3D.",
              videoPrompt: "PRIMARY CAMERA COMBO: 02 Tracking Forward + Gentle Pan. 0.0-5.0s: Barnaby hops across the ledge without speaking.",
              dialogue: [],
            }],
          },
        };
      },
    },
  });
  const pJob1 = await parallelWorker.addRemakeJob("parallel-user", {
    url: "https://example.test/p1.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" });
  const pQueuePromise = parallelWorker.runRemakeQueue();
  await firstEntered;
  const pJob2 = await parallelWorker.addRemakeJob("parallel-user", {
    url: "https://example.test/p2.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" });
  parallelWorker.runRemakeQueue();
  await secondEntered;
  assert.equal(peakParallelCount, 2);
  releaseBothJobs();
  await pQueuePromise;
  assert.equal((await parallelWorker.getRemakeJob("parallel-user", pJob1)).status, "ready");
  assert.equal((await parallelWorker.getRemakeJob("parallel-user", pJob2)).status, "ready");

  // Verify multi-genre execution guidance covers all 11 genres (including documentary/explainer) and sparse suspense dialogue.
  assert.equal(contentGenres.CONTENT_GENRES.length, 11);
  assert.ok(contentGenres.CONTENT_GENRES.some((g) => g.value === "documentary"));
  assert.match(contentGenres.remakeGenreExecutionGuidance(""), /DOCUMENTARY \/ EXPLAINER \/ VLOG/);
  for (const genre of contentGenres.CONTENT_GENRES) {
    const guided = contentGenres.remakeGenreExecutionGuidance(genre.value);
    assert.ok(guided.includes(`KỶ LUẬT THỂ LOẠI ĐÃ CHỌN (${genre.value})`), `missing genre header for ${genre.value}`);
  }
  let horrorPrompt = "";
  let shouldFailAnalyze = false;
  const horrorWorker = load("video-remake-worker", {
    "./ai-drama-video-prompt-guidance": aiDramaGuidance,
    "./content-genres": contentGenres,
    "./visual-styles": visualStyles,
    "./visual-prompt-safety": visualPromptSafety,
    "./video-prompt-policy": videoPromptPolicy,
    "./dialogue-pacing": dialoguePacing,
    "./data-directory": { dataPath: (...parts) => path.join(root, "horror-data", ...parts) },
    "./video-remake": remake,
    "./entity-name": entityName,
    "./video-remake-media": {
      prepareRemakeMedia: async () => ({
        windows: remake.makeRemakeWindows(10, 5),
        sheets: [{ imagePath: "/tmp/h.jpg", rows: [{ scene: 1, framesAt: [0.5] }, { scene: 2, framesAt: [5.5] }] }],
        aspectRatio: "16:9",
        transcript: { kind: "transcribed", text: "1\n00:00:06,400 --> 00:00:08,200\nAi đó?" },
        audioCues: [],
      }),
    },
    "./coding-agent-cli": {
      generateWithCodingAgent: async (_agent, prompt) => {
        if (!horrorPrompt) horrorPrompt = prompt;
        if (shouldFailAnalyze) {
          throw new Error("CLI auth expired, see https://docs.example.test/login for help");
        }
        return {
          result: {
            ...plan,
            visualStyle: "Dark suspense", imageStyle: "Realistic Film", contentGenre: "horror", storySetting: "modern",
            dialoguePolicy: "spoken",
            characters: [{ name: "Minh Anh", description: "Adult night guard, female, quiet steady voice, dark coat.", imagePrompt: "Full-body character design of an adult female guard in a dark coat, plain clean white studio background." }],
            locations: [{ name: "Dim Corridor", description: "Long narrow apartment corridor lit by a flickering ceiling bulb.", imagePrompt: "Long narrow corridor with flickering ceiling light, empty of characters, no text." }],
            scenes: [{
              sourceWindows: 2, sourceVisuals: "Shadow moves at corridor end.", sourceStory: "Guard checks corridor.", sourceRole: "Hook",
              purpose: "Tạo căng thẳng 6 giây im lặng trước một câu hỏi khẽ.", action: "Minh Anh bước chậm qua hành lang tối trong im lặng 6 giây rồi khẽ hỏi vào khe cửa.",
              characters: ["Minh Anh"], location: "Dim Corridor", dialogueMode: "visual_led",
              actingBeat: "Minh Anh creeps forward in tense silence, then whispers cautiously at the doorway.",
              blocking: "Center corridor.", shotSize: "Medium Shot", cameraMovement: "04 Slow Push-In + Rack Focus",
              eyelineAction: "Minh Anh stares toward the doorway.", sfx: "0.4s soft footsteps; 4.8s faint door creak.", vfx: "none",
              continuityIn: "Đầu", continuityOut: "Cuối",
              imagePrompt: "Dim Corridor, night. Medium shot. Minh Anh stands facing the half-open doorway holding a flashlight, 16:9 framing.",
              videoPrompt: "PRIMARY CAMERA COMBO: 04 Slow Push-In + Rack Focus. 0.0-5.8s: Minh Anh steps cautiously forward in tense silence as the flashlight beam sweeps the half-open doorway. 5.8-10.0s: Minh Anh stops still and whispers cautiously (6.4-8.2s).",
              dialogue: [{ speaker: "Minh Anh", text: "Có ai trong phòng kho đó không?", start: 6.4, end: 8.2 }],
            }],
          },
        };
      },
    },
  });
  const horrorJobId = await horrorWorker.addRemakeJob("horror-user", {
    url: "https://example.test/horror.mp4", language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "horror", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" });
  await horrorWorker.runRemakeQueue();
  const horrorJob = await horrorWorker.getRemakeJob("horror-user", horrorJobId);
  assert.equal(horrorJob.status, "ready", horrorJob.error);
  assert.match(horrorPrompt, /KỶ LUẬT THỂ LOẠI ĐÃ CHỌN \(horror\)/);
  assert.match(horrorPrompt, /scene MẪU E \(10s · sourceWindows = 2/);
  assert.doesNotMatch(horrorPrompt, /KỶ LUẬT THỂ LOẠI ĐÃ CHỌN \(comedy\)/);
  const horrorProjectSlug = await projectModule.createRemakeProject("horror-user", horrorJob);
  assert.ok(horrorProjectSlug.startsWith("remake-"));

  shouldFailAnalyze = true;
  const analyzeErrJobId = await horrorWorker.addLocalRemakeJob("horror-user", {
    language: "vi", direction: "", transcript: "",
    remakeMode: "faithful", dialoguePolicy: "auto", visualStyle: "", imageStyle: "", contentGenre: "horror", storySetting: "",
  }, { agent: "claude", model: "", quality: "auto", speed: "standard" }, { uploadId: "11111111-2222-3333-4444-555555555555", filename: "clip.mp4", extension: ".mp4" });
  await horrorWorker.runRemakeQueue();
  const analyzeErrJob = await horrorWorker.getRemakeJob("horror-user", analyzeErrJobId);
  assert.equal(analyzeErrJob.status, "failed");
  assert.doesNotMatch(analyzeErrJob.error, /Không đọc được tệp video/);
  assert.doesNotMatch(analyzeErrJob.error, /https:\/\//);
  assert.match(analyzeErrJob.error, /CLI auth expired/);

  console.log("Passed 10-minute queue, PID/bootId lock recovery, case-sensitive character matching, sfx/vfx & full draft repair, upload cleanup, job cancellation and episode range handoff.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));

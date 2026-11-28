const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    require: (id) => {
      if (imports[id]) return imports[id];
      if (id.startsWith("./")) {
        const tsCandidate = path.join(__dirname, "..", "app", "lib", `${id.slice(2)}.ts`);
        if (fs.existsSync(tsCandidate)) return load(id.slice(2), imports);
      }
      return require(id);
    },
  });
  return exports;
}

const projectTypes = load("project-types");
const mediaSettings = load("media-generation-settings", {
  "./project-types": projectTypes,
});

const uuid = "11111111-2222-3333-4444-555555555555";
assert.equal(mediaSettings.isRemakeProject({ slug: `remake-${uuid}` }), true);
assert.equal(mediaSettings.isRemakeProject({ slug: "custom", remakeJobId: uuid }), true);
assert.equal(mediaSettings.isRemakeProject({ slug: "remake-story-user1" }), false);
assert.equal(mediaSettings.defaultMediaGenerationSettings().videoUseSceneImageReference, true);
assert.equal(mediaSettings.defaultMediaGenerationSettings({ remake: true }).videoUseSceneImageReference, false);
assert.equal(mediaSettings.resolveMediaGenerationSettings({}, { remake: true }).videoUseSceneImageReference, false);
assert.equal(mediaSettings.shouldUseVideoLocationReference({ videoUseLocationReferences: true, videoUseSceneImageReference: true }, true), false);
assert.equal(mediaSettings.shouldUseVideoLocationReference({ videoUseLocationReferences: true, videoUseSceneImageReference: false }, true), true);
assert.equal(
  mediaSettings.resolveMediaGenerationSettings({ videoUseSceneImageReference: true }, { remake: true }).videoUseSceneImageReference,
  true,
);
assert.equal(
  mediaSettings.resolveMediaGenerationSettings({ videoProvider: "flow", flowReferenceMode: "frames" }, { remake: true }).videoUseSceneImageReference,
  true,
);

const store = load("server-store", {
  "next/headers": { headers: async () => new Map() },
  "./project-types": projectTypes,
  "./media-generation-settings": mediaSettings,
  "./story-presets": { isFlowStoryOnlyPreset: (p) => p === "ai-story" || p === "audio-story" },
  "./script-utils": { getManualScriptMetrics: () => ({ durationSeconds: 60, sceneCount: 4 }) },
  "./story-context": { continuityContextFromOutput: () => undefined },
  "./visual-styles": {
    DEFAULT_IMAGE_STYLE: "Stylized 3D",
    DEFAULT_VISUAL_STYLE: "Cinematic",
    normalizeProjectStyleSettings: (v, i) => ({ visualStyle: v || "Cinematic", imageStyle: i || "Stylized 3D" }),
  },
  "./content-genres": {
    DEFAULT_CONTENT_GENRE: "drama",
    DEFAULT_STORY_SETTING: "modern",
    normalizeContentGenre: (v) => v || "drama",
    normalizeSecondaryGenres: () => [],
    normalizeStorySetting: (v) => v || "modern",
  },
  "./data-directory": { DATA_DIR: "/tmp/storyai-test-data" },
});

const baseInput = {
  title: "Test",
  sourceUrl: "",
  sourceText: "",
  presetId: "ai-drama",
  durationMinutes: 1,
  chunkSize: 20,
  language: "vi",
  contentGenre: "drama",
  secondaryGenres: [],
  storySetting: "modern",
  settingNotes: "",
  visualStyle: "Cinematic",
  imageStyle: "Stylized 3D",
  aspectRatio: "16:9",
  voiceProvider: "omnivoice",
  voiceId: "",
  voiceName: "",
  voiceLanguage: "vi",
};

const remakeProject = store.makeProject({ ...baseInput, remakeJobId: uuid }, `remake-${uuid}`);
assert.equal(remakeProject.mediaGeneration.videoUseSceneImageReference, false);

const normalProject = store.makeProject(baseInput, "normal-project-user1");
assert.equal(normalProject.mediaGeneration.videoUseSceneImageReference, true);

const updatedRemake = store.updateProjectRecord(remakeProject, {
  mediaGeneration: { videoUseSceneImageReference: true },
});
assert.equal(updatedRemake.mediaGeneration.videoUseSceneImageReference, true);

console.log("Passed remake default videoUseSceneImageReference assertions.");

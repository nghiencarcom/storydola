const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relPath, imports = {}, envOverrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  const moduleObj = { exports };
  const fakeProcess = {
    ...process,
    env: { ...process.env, ...envOverrides },
  };
  vm.runInNewContext(outputText, {
    exports,
    module: moduleObj,
    console,
    process: fakeProcess,
    URL,
    Buffer,
    AbortController,
    AbortSignal,
    DOMException,
    setTimeout,
    clearTimeout,
    require: (id) => {
      if (Object.hasOwn(imports, id)) return imports[id];
      return require(id);
    },
  });
  return moduleObj.exports;
}

async function main() {
  // 1. generateWithScriptProvider always uses Code Agent CLI (even if OPENAI_API_KEY is set)
  {
    const calls = [];
    const scriptProvider = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": {
        getCodingAgentPreference: async (ownerId) => {
          assert.equal(ownerId, "user-123");
          return { agent: "antigravity", model: "gemini-4-carbon-medium", quality: "high", speed: "fast" };
        },
      },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [
          { id: "codex", label: "Codex", available: true, models: [] },
          { id: "antigravity", label: "Antigravity", available: true, models: [] },
        ],
        generateWithCodingAgent: async (agent, prompt, opts) => {
          calls.push({ agent, prompt, opts });
          return { model: "Antigravity · gemini-4-carbon-medium", result: { ok: true, answer: 42 } };
        },
      },
    }, { OPENAI_API_KEY: "sk-should-be-ignored" });

    const out = await scriptProvider.generateWithScriptProvider("hello world");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].agent, "antigravity");
    assert.equal(calls[0].prompt, "hello world");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].opts)), {
      promptOnlyJson: true,
      model: "gemini-4-carbon-medium",
      quality: "high",
      speed: "fast",
    });
    assert.equal(out.model, "Antigravity · gemini-4-carbon-medium");
    assert.deepEqual(JSON.parse(JSON.stringify(out.result)), { ok: true, answer: 42 });
    assert.equal(out.raw, JSON.stringify({ ok: true, answer: 42 }));

    const summary = await scriptProvider.getCodeAgentProviderSummary("user-123");
    assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
      baseUrl: "local-cli",
      primaryModel: "antigravity · gemini-4-carbon-medium",
      fallbackModels: ["Codex"],
      reasoningEffort: "high",
      serviceTier: "fast",
      standard: "code-agent-cli",
      keyConfigured: true,
    });
  }

  // 2. resolveConfiguredCodingAgent prefers MCP-installed available CLI when no preference exists
  {
    const scriptProvider = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-no-pref" },
      "./agent-config-manager": {
        getCodingAgentConfigStatuses: async () => ({
          codex: { installed: false, configPath: "~/.codex/config.toml" },
          claude: { installed: true, configPath: "~/.claude.json" },
        }),
      },
      "./coding-agent-preferences": {
        getCodingAgentPreference: async () => undefined,
      },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [
          { id: "codex", label: "Codex", available: true, models: [] },
          { id: "claude", label: "Claude Code", available: true, models: [] },
        ],
        generateWithCodingAgent: async () => ({ model: "Claude Code", result: {} }),
      },
    });

    const resolved = await scriptProvider.resolveConfiguredCodingAgent();
    assert.deepEqual(JSON.parse(JSON.stringify(resolved)), {
      agent: "claude",
      model: "",
      quality: "auto",
      speed: "standard",
    });
  }

  // 3. Throws SCRIPT_LLM_NOT_CONFIGURED when no CLI is available
  {
    const scriptProviderNoCli = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-1" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [
          { id: "codex", label: "Codex", available: false, models: [] },
        ],
        generateWithCodingAgent: async () => ({ model: "Codex", result: {} }),
      },
    });

    await assert.rejects(
      () => scriptProviderNoCli.generateWithScriptProvider("test"),
      (err) => Boolean(err) && err.message === "SCRIPT_LLM_NOT_CONFIGURED" && err.name === "SCRIPT_LLM_NOT_CONFIGURED",
    );
  }

  // 4. publishing-package POST succeeds without body.agent using Code Agent CLI,
  //    and returns 503 when no Code Agent CLI is available.
  {
    const makeNextResponse = () => ({
      NextResponse: {
        json(body, init = {}) {
          return { status: init.status || 200, body };
        },
      },
    });

    const baseProject = {
      slug: "demo-project",
      title: "Demo Project",
      presetId: "ai-drama",
      language: "vi",
      contentGenre: "drama",
      secondaryGenres: [],
      storySetting: "modern",
      settingNotes: "",
      imageStyle: "Cinematic",
      aspectRatio: "16:9",
      sourceText: "Một câu chuyện kịch tính.",
      chunks: [{ id: "E01", outputPath: "outputs/E01.json" }],
    };

    const agentCalls = [];
    const scriptProviderWithCli = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": {
        getCodingAgentPreference: async () => ({ agent: "antigravity", model: "gemini-4-carbon-medium", quality: "medium", speed: "standard" }),
      },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [{ id: "antigravity", label: "Antigravity", available: true, models: [] }],
        generateWithCodingAgent: async () => ({ model: "Antigravity", result: {} }),
      },
    });

    const routeWithAgent = loadTs("app/api/projects/[slug]/publishing-package/route.ts", {
      "next/server": makeNextResponse(),
      "../../../../lib/auth-server": { getCurrentUserId: async () => "user-123" },
      "../../../../lib/coding-agent-preferences": {
        getCodingAgentPreference: async () => ({ agent: "antigravity", model: "gemini-4-carbon-medium", quality: "medium", speed: "standard" }),
      },
      "../../../../lib/coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [{ id: "antigravity", label: "Antigravity", available: true, models: [] }],
        generateWithCodingAgent: async (agent, prompt, opts) => {
          agentCalls.push({ agent, prompt, opts });
          return {
            model: "Antigravity · gemini-4-carbon-medium",
            result: {
              titles: [{ title: "Bí mật đằng sau?", hook: "Vì sao anh ta giấu?", angle: "Bí ẩn" }],
              thumbnails: [{ concept: "Shocked face", prompt: "Dramatic portrait", overlay_text: "SỰ THẬT?", layout_note: "Left face" }],
            },
          };
        },
      },
      "../../../../lib/script-provider": scriptProviderWithCli,
      "../../../../lib/scene-store": { readProjectScenes: async () => [] },
      "../../../../lib/content-genres": {
        contentGenresLabel: () => "Drama",
        storySettingLabel: () => "Modern",
      },
      "../../../../lib/server-store": {
        makeActivity: (x) => x,
        now: () => "2026-11-27T07:00:00.000Z",
        readChunkOutput: async () => ({ chunk_summary: "Tóm tắt tập 1" }),
        readData: async () => ({ projects: [structuredClone(baseProject)], activities: [] }),
        updateData: async (fn) => {
          const workspace = { projects: [structuredClone(baseProject)], activities: [] };
          return fn(workspace);
        },
      },
    });

    const okReq = {
      headers: new Map([["x-storyai-user-id", "user-123"]]),
      json: async () => ({ scope: "series" }),
    };
    const okRes = await routeWithAgent.POST(okReq, { params: Promise.resolve({ slug: "demo-project" }) });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.ok, true);
    assert.equal(okRes.body.model, "Antigravity · gemini-4-carbon-medium");
    assert.equal(agentCalls.length, 1);
    assert.equal(agentCalls[0].agent, "antigravity");
    assert.deepEqual(JSON.parse(JSON.stringify(agentCalls[0].opts)), {
      promptOnlyJson: true,
      model: "gemini-4-carbon-medium",
      quality: "medium",
      speed: "standard",
    });

    const scriptProviderNone = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [],
        generateWithCodingAgent: async () => ({ model: "none", result: {} }),
      },
    });

    const routeWithoutAgent = loadTs("app/api/projects/[slug]/publishing-package/route.ts", {
      "next/server": makeNextResponse(),
      "../../../../lib/auth-server": { getCurrentUserId: async () => "user-123" },
      "../../../../lib/coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "../../../../lib/coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [],
        generateWithCodingAgent: async () => { throw new Error("should not run"); },
      },
      "../../../../lib/script-provider": scriptProviderNone,
      "../../../../lib/scene-store": { readProjectScenes: async () => [] },
      "../../../../lib/content-genres": {
        contentGenresLabel: () => "Drama",
        storySettingLabel: () => "Modern",
      },
      "../../../../lib/server-store": {
        makeActivity: (x) => x,
        now: () => "2026-11-27T07:00:00.000Z",
        readChunkOutput: async () => ({}),
        readData: async () => ({ projects: [structuredClone(baseProject)], activities: [] }),
        updateData: async () => baseProject,
      },
    });

    const failRes = await routeWithoutAgent.POST(okReq, { params: Promise.resolve({ slug: "demo-project" }) });
    assert.equal(failRes.status, 503);
    assert.match(failRes.body.message, /Code Agent CLI/);

    const explicitMissingReq = {
      headers: new Map([["x-storyai-user-id", "user-123"]]),
      json: async () => ({ scope: "series", agent: "claude" }),
    };
    const explicitFailRes = await routeWithoutAgent.POST(explicitMissingReq, { params: Promise.resolve({ slug: "demo-project" }) });
    assert.equal(explicitFailRes.status, 503);
    assert.match(explicitFailRes.body.message, /Code Agent CLI/);
  }

  // 5. drama-source POST rejects writerAgent: "api" (400) and returns 503 when no CLI is available
  {
    const makeNextResponse = () => ({
      NextResponse: {
        json(body, init = {}) {
          return { status: init.status || 200, body };
        },
      },
    });
    const scriptProviderNone = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [],
        generateWithCodingAgent: async () => ({ model: "none", result: {} }),
      },
    });
    const dramaSourceRoute = loadTs("app/api/story-script/drama-source/route.ts", {
      "next/server": makeNextResponse(),
      "../../../lib/project-types": { isValidProjectChunkSize: () => true },
      "../../../lib/drama-plan": { dramaPlanSourceText: () => "", normalizeDramaPlan: (v) => v },
      "../../../lib/omnivoice": { voiceLanguagePromptLabel: () => "Vietnamese" },
      "../../../lib/script-provider": scriptProviderNone,
      "../../../lib/coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [{ id: "codex", label: "Codex", available: false, models: [] }],
        generateWithCodingAgent: async () => ({ model: "none", result: {} }),
      },
      "../../../lib/coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "../../../lib/auth-server": { getCurrentUserId: async () => "user-123" },
      "../../../lib/visual-styles": { imageStylePrompt: () => "Photorealistic", visualStylePrompt: () => "Cinematic" },
      "../../../lib/content-genres": {
        contentGenrePrompt: () => "Drama",
        normalizeContentGenre: (v) => v || "drama",
        normalizeSecondaryGenres: () => [],
        normalizeStorySetting: (v) => v || "modern",
        storySettingPrompt: () => "Modern",
      },
    });

    const apiReq = {
      json: async () => ({
        projectTitle: "Test Drama",
        brief: "Một câu chuyện dài hơn 20 ký tự để kiểm tra API bị tắt.",
        writerAgent: "api",
      }),
    };
    const apiRes = await dramaSourceRoute.POST(apiReq);
    assert.equal(apiRes.status, 400);
    assert.equal(apiRes.body.code, "SCRIPT_API_DISABLED");

    const noCliReq = {
      json: async () => ({
        projectTitle: "Test Drama",
        brief: "Một câu chuyện dài hơn 20 ký tự để kiểm tra thiếu Code Agent CLI.",
      }),
    };
    const noCliRes = await dramaSourceRoute.POST(noCliReq);
    assert.equal(noCliRes.status, 503);
    assert.equal(noCliRes.body.code, "SCRIPT_LLM_NOT_CONFIGURED");

    const explicitMissingCliReq = {
      json: async () => ({
        projectTitle: "Test Drama",
        brief: "Một câu chuyện dài hơn 20 ký tự để kiểm tra CLI được chọn không có sẵn.",
        writerAgent: "codex",
      }),
    };
    const explicitMissingCliRes = await dramaSourceRoute.POST(explicitMissingCliReq);
    assert.equal(explicitMissingCliRes.status, 503);
    assert.equal(explicitMissingCliRes.body.code, "SCRIPT_LLM_NOT_CONFIGURED");
  }

  console.log("script-provider-coding-agent-cli tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

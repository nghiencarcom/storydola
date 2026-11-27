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
  // 1. generateWithScriptProvider uses saved CodingAgentPreference when OPENAI_API_KEY is empty
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
    }, { OPENAI_API_KEY: "" });

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
    }, { OPENAI_API_KEY: "" });

    const resolved = await scriptProvider.resolveConfiguredCodingAgent();
    assert.deepEqual(JSON.parse(JSON.stringify(resolved)), {
      agent: "claude",
      model: "",
      quality: "auto",
      speed: "standard",
    });
  }

  // 3. Throws SCRIPT_LLM_NOT_CONFIGURED when no CLI is available or allowCodingAgentFallback is false
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
    }, { OPENAI_API_KEY: "" });

    await assert.rejects(
      () => scriptProviderNoCli.generateWithScriptProvider("test"),
      (err) => Boolean(err) && err.message === "SCRIPT_LLM_NOT_CONFIGURED" && err.name === "SCRIPT_LLM_NOT_CONFIGURED",
    );

    const scriptProviderWithCli = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-1" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": {
        getCodingAgentPreference: async () => ({ agent: "codex", model: "", quality: "auto", speed: "standard" }),
      },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [{ id: "codex", label: "Codex", available: true, models: [] }],
        generateWithCodingAgent: async () => ({ model: "Codex", result: {} }),
      },
    }, { OPENAI_API_KEY: "" });

    await assert.rejects(
      () => scriptProviderWithCli.generateWithScriptProvider("test", { allowCodingAgentFallback: false }),
      (err) => Boolean(err) && err.message === "SCRIPT_LLM_NOT_CONFIGURED" && err.name === "SCRIPT_LLM_NOT_CONFIGURED",
    );
  }

  // 4. publishing-package POST succeeds without body.agent when Code Agent is configured,
  //    and returns 503 when neither OPENAI_API_KEY nor any Code Agent CLI is available.
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
    const scriptProviderWithFallback = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": {
        getCodingAgentPreference: async () => ({ agent: "antigravity", model: "gemini-4-carbon-medium", quality: "medium", speed: "standard" }),
      },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [{ id: "antigravity", label: "Antigravity", available: true, models: [] }],
        generateWithCodingAgent: async () => ({ model: "Antigravity", result: {} }),
      },
    }, { OPENAI_API_KEY: "" });

    const routeWithAgent = loadTs("app/api/projects/[slug]/publishing-package/route.ts", {
      "next/server": makeNextResponse(),
      "../../../../lib/auth-server": { getCurrentUserId: async () => "user-123" },
      "../../../../lib/coding-agent-preferences": {
        getCodingAgentPreference: async () => ({ agent: "antigravity", model: "gemini-4-carbon-medium", quality: "medium", speed: "standard" }),
      },
      "../../../../lib/coding-agent-cli": {
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
      "../../../../lib/script-provider": scriptProviderWithFallback,
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

    // Now test 503 when neither OPENAI_API_KEY nor any Code Agent CLI is available
    const scriptProviderNone = loadTs("app/lib/script-provider.ts", {
      "./auth-server": { getCurrentUserId: async () => "user-123" },
      "./agent-config-manager": { getCodingAgentConfigStatuses: async () => ({}) },
      "./coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "./coding-agent-cli": {
        getCodingAgentCliStatuses: async () => [],
        generateWithCodingAgent: async () => ({ model: "none", result: {} }),
      },
    }, { OPENAI_API_KEY: "" });

    const routeWithoutAgent = loadTs("app/api/projects/[slug]/publishing-package/route.ts", {
      "next/server": makeNextResponse(),
      "../../../../lib/auth-server": { getCurrentUserId: async () => "user-123" },
      "../../../../lib/coding-agent-preferences": { getCodingAgentPreference: async () => undefined },
      "../../../../lib/coding-agent-cli": { generateWithCodingAgent: async () => { throw new Error("should not run"); } },
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
  }

  console.log("script-provider-coding-agent-fallback tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

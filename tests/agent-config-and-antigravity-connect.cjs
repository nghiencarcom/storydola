const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relPath, imports = {}, envOverrides = {}, platformOverride = process.platform) {
  const source = fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  const moduleObj = { exports };
  const fakeProcess = {
    ...process,
    platform: platformOverride,
    env: { ...process.env, ...envOverrides },
  };
  vm.runInNewContext(outputText, {
    exports,
    module: moduleObj,
    console,
    process: fakeProcess,
    Buffer,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    require: (id) => {
      if (Object.hasOwn(imports, id)) return imports[id];
      return require(id);
    },
  });
  return moduleObj.exports;
}

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storyai-agent-cfg-"));
}

function fakeOsWithHome(homeDir) {
  return {
    ...os,
    homedir: () => homeDir,
  };
}

function fakeChildProcessNoop() {
  return {
    execFile: (_file, _args, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      if (typeof callback === "function") callback(null, "", "");
    },
    spawn: () => {
      throw new Error("spawn should not be called in unit test");
    },
  };
}

async function main() {
  // 1. Empty / whitespace mcp_config.json should not trigger INVALID_JSON and should install cleanly
  {
    const homeDir = makeTempHome();
    try {
      const configDir = path.join(homeDir, ".gemini", "config");
      const configPath = path.join(configDir, "mcp_config.json");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, "   \n\t  ", "utf8");

      const manager = loadTs("app/lib/agent-config-manager.ts", {
        "node:os": fakeOsWithHome(homeDir),
        "node:child_process": fakeChildProcessNoop(),
      });

      const statuses = await manager.getCodingAgentConfigStatuses("storyai_mcp_tok1");
      assert.equal(statuses.antigravity.installed, false);
      assert.equal(statuses.antigravity.error, undefined);

      const installed = await manager.installCodingAgentConfig({
        agent: "antigravity",
        nodePath: process.execPath,
        scriptPath: "/app/scripts/storyai-mcp.mjs",
        baseUrl: "http://127.0.0.1:3012",
        token: "storyai_mcp_tok1",
      });
      assert.equal(installed.configPath, configPath);

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.equal(parsed.mcpServers.storyai.env.STORYAI_MCP_TOKEN, "storyai_mcp_tok1");
      assert.equal(parsed.mcpServers.storyai.timeoutSeconds, 1800);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  }

  // 2. UTF-16LE BOM mcp_config.json should parse, preserve existing servers, back up, and rewrite as UTF-8
  {
    const homeDir = makeTempHome();
    try {
      const configDir = path.join(homeDir, ".gemini", "config");
      const configPath = path.join(configDir, "mcp_config.json");
      fs.mkdirSync(configDir, { recursive: true });
      const utf16Content = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(JSON.stringify({ mcpServers: { other: { command: "npx", args: ["other-mcp"] } } }, null, 2), "utf16le"),
      ]);
      fs.writeFileSync(configPath, utf16Content);

      const manager = loadTs("app/lib/agent-config-manager.ts", {
        "node:os": fakeOsWithHome(homeDir),
        "node:child_process": fakeChildProcessNoop(),
      });

      const statuses = await manager.getCodingAgentConfigStatuses("storyai_mcp_tok2");
      assert.equal(statuses.antigravity.installed, false);
      assert.equal(statuses.antigravity.error, undefined);

      const installed = await manager.installCodingAgentConfig({
        agent: "antigravity",
        nodePath: process.execPath,
        scriptPath: "/app/scripts/storyai-mcp.mjs",
        baseUrl: "http://127.0.0.1:3012",
        token: "storyai_mcp_tok2",
      });
      assert.ok(installed.backupPath && fs.existsSync(installed.backupPath));

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.deepEqual(parsed.mcpServers.other, { command: "npx", args: ["other-mcp"] });
      assert.equal(parsed.mcpServers.storyai.env.STORYAI_MCP_TOKEN, "storyai_mcp_tok2");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  }

  // 3. JSONC comments + URLs inside strings + trailing commas should parse cleanly and back up on write
  {
    const homeDir = makeTempHome();
    try {
      const configDir = path.join(homeDir, ".gemini", "config");
      const configPath = path.join(configDir, "mcp_config.json");
      fs.mkdirSync(configDir, { recursive: true });
      const jsonc = `{
  // Antigravity MCP servers
  "mcpServers": {
    /* keep URL intact */
    "remote": {
      "url": "https://mcp.example.com/mcp", // inline comment
    },
  },
}
`;
      fs.writeFileSync(configPath, jsonc, "utf8");

      const manager = loadTs("app/lib/agent-config-manager.ts", {
        "node:os": fakeOsWithHome(homeDir),
        "node:child_process": fakeChildProcessNoop(),
      });

      const statuses = await manager.getCodingAgentConfigStatuses("storyai_mcp_tok3");
      assert.equal(statuses.antigravity.installed, false);
      assert.equal(statuses.antigravity.error, undefined);

      const installed = await manager.installCodingAgentConfig({
        agent: "antigravity",
        nodePath: process.execPath,
        scriptPath: "/app/scripts/storyai-mcp.mjs",
        baseUrl: "http://127.0.0.1:3012",
        token: "storyai_mcp_tok3",
      });
      assert.ok(installed.backupPath && fs.existsSync(installed.backupPath));

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.equal(parsed.mcpServers.remote.url, "https://mcp.example.com/mcp");
      assert.equal(parsed.mcpServers.storyai.env.STORYAI_MCP_TOKEN, "storyai_mcp_tok3");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  }

  // 4. Corrupt mcp_config.json reports INVALID_JSON and repairInvalidConfig backs it up and recovers
  {
    const homeDir = makeTempHome();
    try {
      const configDir = path.join(homeDir, ".gemini", "config");
      const configPath = path.join(configDir, "mcp_config.json");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, "{ broken json", "utf8");

      const manager = loadTs("app/lib/agent-config-manager.ts", {
        "node:os": fakeOsWithHome(homeDir),
        "node:child_process": fakeChildProcessNoop(),
      });

      const statuses = await manager.getCodingAgentConfigStatuses("storyai_mcp_tok4");
      assert.equal(statuses.antigravity.installed, false);
      assert.equal(statuses.antigravity.error, "INVALID_JSON");

      const installed = await manager.installCodingAgentConfig({
        agent: "antigravity",
        nodePath: process.execPath,
        scriptPath: "/app/scripts/storyai-mcp.mjs",
        baseUrl: "http://127.0.0.1:3012",
        token: "storyai_mcp_tok4",
        repairInvalidConfig: true,
      });
      assert.ok(installed.backupPath && fs.existsSync(installed.backupPath));
      assert.equal(fs.readFileSync(installed.backupPath, "utf8"), "{ broken json");

      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.equal(parsed.mcpServers.storyai.env.STORYAI_MCP_TOKEN, "storyai_mcp_tok4");
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  }

  // 5. Antigravity Desktop / IDE executable makes mcpTargetAvailable=true even when agy CLI is missing
  {
    const homeDir = makeTempHome();
    try {
      const cli = loadTs(
        "app/lib/coding-agent-cli.ts",
        {
          "node:os": fakeOsWithHome(homeDir),
          "./antigravity-acp": { runAntigravityImages: async () => "" },
          "./coding-agent-models": { codingAgentModelPresets: { codex: [], claude: [], antigravity: [] } },
        },
        {
          PATH: "",
          HOME: homeDir,
          USERPROFILE: homeDir,
          LOCALAPPDATA: path.join(homeDir, "AppData", "Local"),
          APPDATA: path.join(homeDir, "AppData", "Roaming"),
          ProgramFiles: path.join(homeDir, "Program Files"),
          STORYAI_CODEX_CLI_PATH: path.join(homeDir, "missing-codex.exe"),
          STORYAI_CLAUDE_CLI_PATH: path.join(homeDir, "missing-claude.exe"),
          STORYAI_ANTIGRAVITY_CLI_PATH: path.join(homeDir, "missing-agy.exe"),
        },
        "win32",
      );

      const beforeStatuses = await cli.getCodingAgentCliStatuses({ includeModels: false });
      const antigravityBefore = beforeStatuses.find((item) => item.id === "antigravity");
      const codexBefore = beforeStatuses.find((item) => item.id === "codex");

      assert.ok(antigravityBefore);
      assert.equal(antigravityBefore.available, false);
      assert.equal(antigravityBefore.mcpTargetAvailable, false);
      assert.ok(codexBefore);
      assert.equal(codexBefore.available, false);
      assert.equal(codexBefore.mcpTargetAvailable, false);

      const desktopExe = path.join(homeDir, "AppData", "Local", "Programs", "Antigravity", "Antigravity.exe");
      fs.mkdirSync(path.dirname(desktopExe), { recursive: true });
      fs.writeFileSync(desktopExe, "", "utf8");

      const afterStatuses = await cli.getCodingAgentCliStatuses({ includeModels: false });
      const antigravityAfter = afterStatuses.find((item) => item.id === "antigravity");
      const codexAfter = afterStatuses.find((item) => item.id === "codex");

      assert.ok(antigravityAfter);
      assert.equal(antigravityAfter.available, false);
      assert.equal(antigravityAfter.mcpTargetAvailable, true);
      assert.ok(codexAfter);
      assert.equal(codexAfter.available, false);
      assert.equal(codexAfter.mcpTargetAvailable, false);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  }

  console.log("agent-config-and-antigravity-connect tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

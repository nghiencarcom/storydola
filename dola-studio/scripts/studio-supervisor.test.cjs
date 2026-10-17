const { test } = require("node:test");
const assert = require("node:assert/strict");
const { supervise } = require("./studio-supervisor.cjs");

test("captures failure and limits repeated crash restarts", { timeout: 5000 }, async () => {
  const logs = [];
  await new Promise(resolve => {
    supervise({ command: process.execPath, args: ["-e", "console.error('test crash');process.exit(2)"],
      env: process.env, log: line => logs.push(line), portBusy: async () => false,
      onFailure: code => { assert.equal(code, 1); resolve(); },
      maxRestarts: 2, baseDelay: 10, output: false });
  });
  assert.equal(logs.filter(line => line.startsWith("Next.js spawned")).length, 3);
  assert.ok(logs.some(line => line.includes("test crash")));
  assert.ok(logs.some(line => line.includes("code=2")));
});

test("intentional stop never restarts", { timeout: 5000 }, async () => {
  const logs = [];
  let supervisor;
  await new Promise(resolve => {
    supervisor = supervise({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"],
      env: process.env, portBusy: async () => false, output: false,
      onFailure: () => assert.fail("intentional stop must not fail"),
      log: line => { logs.push(line); if (line.includes("intentional=true")) resolve(); } });
    supervisor.stop();
  });
  assert.equal(logs.filter(line => line.startsWith("Restart ")).length, 0);
});

test("does not restart over a replacement listener", { timeout: 5000 }, async () => {
  const logs = [];
  await new Promise(resolve => {
    supervise({ command: process.execPath, args: ["-e", "process.exit(1)"],
      env: process.env, portBusy: async () => true, output: false, baseDelay: 10,
      log: line => logs.push(line), onFailure: code => { assert.equal(code, 0); resolve(); } });
  });
  assert.equal(logs.filter(line => line.startsWith("Next.js spawned")).length, 1);
});

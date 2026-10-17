const assert = require("node:assert/strict");
const { test } = require("node:test");
const { shouldRestartGateway } = require("./gateway-restart-policy.cjs");

test("production restarts Gateway even when durable tasks are active", () => {
  assert.equal(shouldRestartGateway({
    production: true,
    pendingTasks: 15,
    autoRestartStaleGateway: false,
  }), true);
});

test("dev keeps an active shared Gateway unless explicitly enabled", () => {
  assert.equal(shouldRestartGateway({
    production: false,
    pendingTasks: 15,
    autoRestartStaleGateway: true,
  }), false);
});

test("dev can reload a stale Gateway when idle and explicitly enabled", () => {
  assert.equal(shouldRestartGateway({
    production: false,
    pendingTasks: 0,
    autoRestartStaleGateway: true,
  }), true);
});

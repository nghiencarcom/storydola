const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadModule(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, require: (id) => imports[id] ?? require(id) });
  return exports;
}

const { makeRemakeWindows, mergeRemakeWindows, remakeInputSchema } = loadModule("video-remake", {
  "./ai-drama-scene-timing": loadModule("ai-drama-scene-timing"),
  "./project-types": loadModule("project-types"),
});

for (const [sourceSeconds, step, expected] of [
  [5.06, 5, [5]],
  [12, 5, [5, 5, 5]],
  [24, 10, [10, 10, 5]],
  [25.06, 15, [15, 10]],
  [25.8, 15, [15, 15]],
  [0.08, 10, [5]],
  [120, 15, [15, 15, 15, 15, 15, 15, 15, 15]],
]) {
  const windows = makeRemakeWindows(sourceSeconds, step);
  assert.deepEqual(Array.from(windows, ({ duration }) => duration), expected);
  assert.equal(windows.at(-1).sourceEnd, sourceSeconds);
  for (const [index, window] of windows.entries()) {
    assert.equal(window.sourceStart, windows[index - 1]?.sourceEnd || 0);
    assert.equal(window.start, windows[index - 1]?.end || 0);
    assert.equal(window.end - window.start, window.duration);
  }
}

assert.equal(makeRemakeWindows(7200, 5).length, 1440);
const source = makeRemakeWindows(27.4, 5);
const merged = mergeRemakeWindows(source, [3, 2, 1]);
assert.deepEqual(Array.from(merged, ({ duration }) => duration), [15, 10, 5]);
assert.equal(merged.at(-1).sourceEnd, 27.4);
assert.throws(() => mergeRemakeWindows(source, [1]));
assert.throws(() => mergeRemakeWindows(source, [3, 3, 1]));

const { classifyRemakeSource } = loadModule("video-remake-source");
for (const [value, platform, canonical, short] of [
  ["https://youtu.be/jNQXAC9IVRw?si=a", "youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw", false],
  ["https://m.facebook.com/example/videos/topic/123456/", "facebook", "https://www.facebook.com/watch/?v=123456", false],
  ["https://facebook.com/reel/123456?tracking=a", "facebook", "https://www.facebook.com/reel/123456/", false],
  ["https://fb.watch/a_bc/?tracking=a", "facebook", "https://fb.watch/a_bc/", true],
  ["https://www.facebook.com/share/r/abcdef/", "facebook", "https://www.facebook.com/share/r/abcdef/", true],
  ["https://www.tiktok.com/@example/video/123456789", "tiktok", "https://www.tiktok.com/@example/video/123456789", false],
  ["https://vm.tiktok.com/ZX123/", "tiktok", "https://vm.tiktok.com/ZX123/", true],
  ["https://www.iesdouyin.com/share/video/123456/", "douyin", "https://www.douyin.com/video/123456", false],
  ["https://v.douyin.com/ZX123/", "douyin", "https://v.douyin.com/ZX123/", true],
  ["https://instagram.com/reel/ABC123/?igsh=a", "instagram", "https://www.instagram.com/reel/ABC123/", false],
]) {
  const result = classifyRemakeSource(new URL(value));
  assert.equal(result.platform, platform);
  assert.equal(result.url, canonical);
  assert.equal(result.short, short);
}
assert.equal(classifyRemakeSource(new URL("https://facebook.com.example.test/video.mp4")), undefined);
assert.throws(() => classifyRemakeSource(new URL("https://www.facebook.com/flx/warn/?u=https://example.test")));
assert.throws(() => classifyRemakeSource(new URL("https://www.youtube.com/playlist?list=PL123")));
assert.throws(() => classifyRemakeSource(new URL("https://user@example.test/file.mp4")));

const input = { url: "https://example.test/video.mp4", language: "vi" };
assert.equal(remakeInputSchema.safeParse(input).success, true);
assert.equal(remakeInputSchema.parse({ ...input, sceneSeconds: 5 }).sceneSeconds, undefined);
assert.equal(remakeInputSchema.safeParse({ ...input, url: "http://localhost/video.mp4" }).success, false);
assert.equal(remakeInputSchema.safeParse({ ...input, url: "not-a-url" }).success, false);
console.log("Passed remake windows, fractional boundaries, public platform links and input constraints.");

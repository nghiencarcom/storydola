const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const context = { exports, require: name => load(path.resolve(path.dirname(file), `${name}.ts`)) };
  vm.createContext(context);
  vm.runInContext(ts.transpile(fs.readFileSync(file, 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context);
  return exports;
}
const { validateDialoguePacing: check, validateDialogueBoundary: boundary } = load('app/lib/dialogue-pacing.ts');
const text = n => Array(n).fill('từ').join(' ');
const scene = (n, start, end) => ({dialogue_segments: [{text: text(n), start_sec: start, end_sec: end}]});
let result = check(scene(28, 2, 12), 15);
assert.equal(result.errors.length, 0);
assert.equal(result.silenceSec, 5);
assert.equal(result.warnings.length, 1);
// Individual cue speed never blocks; scene-level speed only warns.
result = check({dialogue_segments: [{text: text(30), start_sec: 0, end_sec: 2}, {text: text(20), start_sec: 4, end_sec: 15}]}, 15);
assert.equal(result.errors.length, 0);
assert(result.warnings.some(e => e.includes('từ/giây toàn cảnh')));
assert(check(scene(28, 1, 11), 15).errors.some(e => e.includes('liên tục')));
assert(check(scene(28, 3, 13), 15).errors.length === 0);
assert(check(scene(28, 3.01, 13), 15).errors.some(e => e.includes('liên tục')));
assert(check(scene(20, 1, 8), 10).errors.length === 0);
assert(check(scene(20, 2, 7.9), 10).errors.some(e => e.includes('tổng nghỉ')));
assert(check({dialogue_segments: [{text: text(10), start_sec: 2, end_sec: 6}, {text: text(10), start_sec: 8.1, end_sec: 12}]}, 15).errors.some(e => e.includes('tổng nghỉ')));
assert(check({dialogue_segments: []}, 15).errors.length > 0);
for (const mode of ['visual_led', 'silent', 'intentional_silence']) assert.equal(check({dialogue_mode: mode, dialogue_segments: []}, 15).errors.length, 0);
// Overlapping coverage is counted once.
assert.equal(check({dialogue_segments: [{text: 'a', start_sec: 2, end_sec: 8}, {text: 'b', start_sec: 6, end_sec: 12}]}, 15).silenceSec, 5);
console.log('Passed: mandatory continuous/total silence boundaries, exemptions, merged coverage; scene word/rate warnings only.');

assert.equal(check(scene(20, 1.5, 7.8), 10).errors.length, 0);
assert(Math.abs(check(scene(20, 1.5, 7.8), 10).silenceSec - 3.7) < 0.001);
const timed = (start, a, b, mode = 'dialogue_led') => ({...scene(20, a, b), start_sec: start, end_sec: start + 10, dialogue_mode: mode});
assert.equal(boundary(timed(0, 0, 8), timed(10, 1, 10)).length, 0);
assert(boundary(timed(0, 0, 7.8), timed(10, 1.5, 10)).length > 0);
assert(boundary(timed(0, 0, 8), timed(11, 1, 10)).length > 0);
assert.equal(boundary(timed(0, 0, 7), timed(10, 3, 10, 'visual_led')).length, 0);
assert.equal(boundary(timed(0, 0, 7, 'silent'), timed(10, 3, 10)).length, 0);
console.log('Passed: 1.5–7.8s regression, 4s total/10s, inter-scene 3s boundaries and exemptions.');

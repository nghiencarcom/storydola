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
const { AI_DRAMA_JSON_TEMPLATE, createEpisodeScriptTemplate } = load('app/lib/project-script-templates.ts');
const initial = JSON.parse(AI_DRAMA_JSON_TEMPLATE);
const episode = JSON.parse(createEpisodeScriptTemplate('a03', 81, 83, 640, { contentGenre: 'comedy', secondaryGenres: ['drama'], language: 'vi', imageStyle: 'Photorealistic' }));
assert.deepEqual(initial.prompt_guidance, episode.prompt_guidance, 'New-project JSON and episode modal must carry the same complete instructions');
assert.deepEqual(initial, JSON.parse(createEpisodeScriptTemplate('A01', 1, 1)), 'Both entry points must use the same instruction-only skeleton');
assert(!/paper boat|puddle|raindrop|thuyền giấy/i.test(JSON.stringify(initial)), 'No fixed sample story in new-project JSON');
assert(!/paper boat|puddle|raindrop|thuyền giấy/i.test(JSON.stringify(episode)), 'No fixed sample story in episode JSON');
assert(initial.scenes[0].video_prompt.includes('['));
assert(initial.scenes[0].video_prompt.includes('end on an earned turn'));
assert.equal(episode.chunk_id, 'A03');
assert.deepEqual(episode.scenes.map(s => s.id), ['S081', 'S082', 'S083']);
assert.equal(episode.scenes[0].start_sec, 640);
assert.equal(episode.project_context.contentGenre, 'comedy');
assert.equal(episode.project_context.language, 'vi');
for (const template of [initial, episode]) {
  const guide = template.prompt_guidance;
  assert(guide.dialogue.includes('EACH continuous gap must be <=3s'));
  assert(guide.dialogue.includes('TOTAL silence must be <=4s per 10s scene or <=5s per 15s scene'));
  assert(guide.dialogue.includes('Word counts and scene-level speaking rate are warnings only'));
  assert(guide.episode_locations.includes('never to meet a count'));
  assert(guide.episode_locations.includes('top-level location_bible'));
  assert(guide.episode_locations.includes('starts generating missing location reference images'));
  assert(guide.natural_timing.includes('not equal divisions'));
  assert(guide.natural_timing.includes('do not randomize timestamps arbitrarily'));
  assert(guide.camera_precision.includes('one concrete target'));
  assert(guide.action_and_visibility.includes('visible in the chosen framing'));
  assert(guide.prop_continuity.includes('exact ending state'));
  assert(guide.sound_and_vfx.includes('never blanket-replace them with none'));
  assert(guide.reference_rules.includes('Character images bind face, apparent age'));
  assert(guide.reference_rules.includes('Location images bind layout'));
  assert(guide.prompt_budget.includes('below 5000'));
  for (const scene of template.scenes) {
    assert(!/\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?s/.test(scene.video_prompt), 'No fixed example beat ranges in copied scene instructions');
    assert(!scene.video_prompt.includes('hold its composition for the first 0.5'));
    assert.equal(scene.end_sec - scene.start_sec, scene.duration_sec);
  }
}
console.log('Passed: shared full guidance for new-project and episode JSON, variable natural timing, camera/action/prop/VFX/reference constraints, project context, IDs and timeline anchor.');

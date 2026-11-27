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

const {characterReferencePrompt, locationReferencePrompt} = load('app/lib/ai-drama-reference-prompts.ts');
const {sanitizeDramaVisualPrompt, rewriteKineticActionPromptSafely} = load('app/lib/visual-prompt-safety.ts');
const {AI_DRAMA_JSON_TEMPLATE} = load('app/lib/project-script-templates.ts');
const character = characterReferencePrompt('Mai', 'Mai, apparent age 32, blue blouse, black shoes.');
assert.equal(characterReferencePrompt('Mai', character), character, 'Managed instructions must not accumulate');
assert(character.includes('plain white or neutral background'));
assert(character.includes('one person repeated across those panels'));
const creature = characterReferencePrompt('Thiết Giáp', 'Photorealistic 3D creature design of a massive horned triceratops dinosaur, mossy slate-green armored hide, natural animal anatomy without human clothes.');
assert.equal(characterReferencePrompt('Thiết Giáp', creature), creature, 'Creature reference instructions must be idempotent');
assert(creature.includes('plain white or neutral background'));
assert(creature.includes('one creature/animal subject'));
assert(creature.includes('Do NOT anthropomorphize into a human or add human clothing'));
assert(!creature.includes('modest age-appropriate clothing, footwear'));
for (const [breedName, breedPrompt] of [
  ['Xám Phệ', 'Photorealistic full-body portrait of a stocky slate-grey English Bulldog standing naturally on four paws, natural canine anatomy without clothes, plain clean white studio background.'],
  ['Hổ Đen', 'Photorealistic full-body portrait of a large muscular black-and-tan Rottweiler standing naturally on four paws, natural canine anatomy without clothes, plain clean white studio background.'],
  ['Ánh Kim', 'Photorealistic full-body portrait of a sturdy Golden Retriever standing naturally on four paws, natural canine anatomy without clothes, plain clean white studio background.'],
  ['Thiết Tượng Mamut', 'Photorealistic full-body creature design of a towering prehistoric woolly mammoth, natural proboscidean anatomy without harness or clothes, plain clean white studio background.'],
]) {
  const ref = characterReferencePrompt(breedName, breedPrompt);
  assert(ref.includes('one creature/animal subject'), `${breedName} must use creature/animal sheet template`);
  assert(!ref.includes('one person repeated across those panels'), `${breedName} must NOT use human person sheet template`);
}
const location = locationReferencePrompt('Shop', 'Shop. Door on north wall, window on east wall. Physical label OPEN on the counter.');
assert(location.includes('upper-left NORTH, upper-right EAST, lower-left SOUTH, lower-right WEST'));
assert(location.includes('Door on north wall'));
assert(location.includes('Physical labels or signage are allowed'));
assert.equal(locationReferencePrompt('Shop', location), location);
const longBase = 'Original stable appearance. ' + 'Detailed canonical costume. '.repeat(100) + 'Unique silver ring on left hand.';
assert(characterReferencePrompt('Mai', longBase).includes('Unique silver ring on left hand.'), 'Never silently truncate a canonical detail');
assert.throws(() => characterReferencePrompt('Mai', 'x'.repeat(10000)), /REFERENCE_PROMPT_TOO_LONG/);
assert.equal(sanitizeDramaVisualPrompt('No blood, gore. Hit the button.'), 'No blood, gore. Hit the button.');
assert.equal(
  sanitizeDramaVisualPrompt('Tail hits the wet stone pillar; a violent shockwave ripples across the pool.'),
  'Tail hits the wet stone pillar; a violent shockwave ripples across the pool.',
);
assert(!sanitizeDramaVisualPrompt('A violent attack.').includes('violent attack'));
const rewrittenKinetic = rewriteKineticActionPromptSafely('Hổ Vương counterattacks and punches Thiết Giáp violently.');
assert(!rewrittenKinetic.includes('tense non-contact confrontation'));
assert.equal(sanitizeDramaVisualPrompt(rewrittenKinetic), rewrittenKinetic);
const guide = JSON.parse(AI_DRAMA_JSON_TEMPLATE).prompt_guidance;
assert(guide.visual_variety.includes('do not stage every event in the initial room'));
assert(guide.visual_variety.includes('never relabel an existing room'));
assert(guide.visual_variety.includes('do not randomize camera angles'));
const provider = fs.readFileSync('app/lib/media-provider.ts', 'utf8');
assert(provider.includes('Do not use a neutral studio background or turn the room into an isolated miniature'));
assert(provider.includes('SCENE_IMAGE_PROMPT_TOO_LONG'));
assert(provider.includes('Diegetic text on a required prop'));
const store = fs.readFileSync('app/lib/scene-store.ts', 'utf8');
assert(store.includes('previous.chunkId !== scene.chunkId'));
console.log('Passed: reference idempotence, floor-plan views, no detail truncation, safe exclusions, variety guidance and prompt integration.');

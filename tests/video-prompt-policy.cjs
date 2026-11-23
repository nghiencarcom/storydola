const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function moduleFrom(file) {
  const context = { exports: {} };
  vm.createContext(context);
  vm.runInContext(ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context);
  return context.exports;
}
const policy = moduleFrom('app/lib/video-prompt-policy.ts');
const timing = moduleFrom('app/lib/ai-drama-scene-timing.ts');
const reports = moduleFrom('app/lib/video-prompt-compaction.ts');
const source = fs.readFileSync('app/lib/media-provider.ts', 'utf8');
const context = { ...policy, sanitizeDramaVisualPrompt: value => value.trim() };
vm.createContext(context);
vm.runInContext(ts.transpile(source.slice(source.indexOf('function requireVideoPromptWithinLimit'), source.indexOf('function configuredSeedanceVideoTimeoutMs')), { target: ts.ScriptTarget.ES2022 }), context);

for (const duration of [5, 10, 15]) {
  const scene = `DURATION: ${duration}s. One continuous shot. Mai turns toward Hạnh; camera tracks her. VFX: sparkle at 2.1s, fading by 2.7s.`;
  const dialogue = '0.731–3.947s | Mai: "Mẹ nhìn này."';
  for (const drama of [false, true]) {
    const result = context.composeVideoApiPrompt('S001', scene, [{ text: dialogue, sanitize: false }, 'STYLE: Cinematic; preserve blue light.'], drama, 12000);
    assert(result.includes(scene));
    assert(result.includes(dialogue));
    assert(result.includes('STYLE: Cinematic; preserve blue light.'));
    assert(result.length < 5000);
    assert(!result.includes('hold the opening frame for 0.5'));
  }
  const normalized = timing.normalizeAiDramaSceneTimings([{ start_sec: 0, end_sec: duration, video_prompt: 'Dialogue cue: 0.7–3.9s; continuous camera throughout.' }]);
  assert.equal(normalized[0].duration_sec, duration, 'A dialogue cue must not shorten the clip');
}
assert.throws(() => context.composeVideoApiPrompt('S001', 'Continuous shot.', ['Required style ' + 'x'.repeat(5000)], true, 12000), /Không gửi API/);
assert.throws(() => context.composeVideoApiPrompt('S001', 'x'.repeat(5000), [], true, 12000), /vượt giới hạn/);
const short = context.composeVideoApiPrompt('S001', 'x'.repeat(3900), ['STYLE: keep this.'], false, 12000);
assert(short.includes('x'.repeat(3900)), 'Do not shorten scene prose merely to save characters');

const legacy = 'Hold the exact opening image and all visible positions for the first 0.5 seconds. Then Mai raises her phone. Camera: #04 Slow Push-In + Rack Focus — hold the exact opening frame for 0.5 seconds, then begin a slow forward push. VFX: glow 1.2–2.9s.';
const natural = policy.naturalizeLegacyOpeningHold(legacy);
assert(!natural.includes('0.5'));
assert(natural.includes('Mai raises her phone'));
assert(natural.includes('begin a slow forward push'));
assert(natural.includes('VFX: glow 1.2–2.9s.'));
assert.equal(policy.naturalizeLegacyOpeningHold('Hold her gaze for two seconds, then turn.'), 'Hold her gaze for two seconds, then turn.');
for (const description of ['Mai, 35 years old, turns.', 'Mai has an oval face.', 'Mai có khuôn mặt trái xoan.', 'Mai is a young woman.']) {
  assert.throws(() => policy.requireReferenceIdentityOnly(description, ['Mai']), /ảnh nhân vật/);
  assert.equal(policy.requireReferenceIdentityOnly(description, []), description);
}
assert.equal(policy.requireReferenceIdentityOnly('Mai smiles, looks down and avoids Hạnh’s eyes.', ['Mai']), 'Mai smiles, looks down and avoids Hạnh’s eyes.');
assert.equal(policy.requireReferenceIdentityOnly(policy.VIDEO_REFERENCE_RULES, ['Mai']), policy.VIDEO_REFERENCE_RULES);
assert(policy.VIDEO_REFERENCE_RULES.includes('Character images bind face, apparent age, skin tone, hair, proportions and costume'));
assert(policy.VIDEO_REFERENCE_RULES.includes('Location images bind layout'));
assert.equal(reports.videoPromptCompactionReport(true).omittedSections.length, 0);

// The real structural reviewer must accept uninterrupted shots without camera ranges.
const reviewSource = fs.readFileSync('app/lib/scene-ai-review.ts', 'utf8');
const reviewer = {
  isAiDramaSceneDuration: timing.isAiDramaSceneDuration,
  countScriptWords: text => text.split(/\s+/).filter(Boolean).length,
  MAX_TTS_WORDS_PER_SECOND: 3,
  readDialogueSegments: () => [],
  dialogueSegmentsText: () => '',
};
vm.createContext(reviewer);
vm.runInContext(ts.transpile(reviewSource.slice(reviewSource.indexOf('function asRecord'), reviewSource.indexOf('function reviewInput')), { target: ts.ScriptTarget.ES2022 }), reviewer);
for (const duration of [5, 10, 15]) {
  const base = { id: 'S001', start_sec: 0, end_sec: duration, duration_sec: duration, dialogue_mode: 'visual_led', purpose: 'A visual reveal.', video_prompt: 'One continuous shot: track Mai as she opens the door and reacts.', continuity_in: 'Door closed.', continuity_out: 'Door open.' };
  assert.equal(reviewer.structuralReview(base, 0, { sceneStart: 1 }, true).checks.camera, 'pass');
  assert.equal(reviewer.structuralReview({ ...base, video_prompt: `0–${duration}s: one uninterrupted tracking shot.` }, 0, { sceneStart: 1 }, true).checks.camera, 'pass');
  assert.equal(reviewer.structuralReview({ ...base, video_prompt: `0–${duration + 1}s: tracking shot.` }, 0, { sceneStart: 1 }, true).checks.camera, 'fail');
}
console.log('Passed: natural 5/10/15s shots, structural review, duration inference, exact dialogue/camera/VFX preservation, no silent context loss, <5000 limit, reference appearance guard, legacy hold compatibility.');

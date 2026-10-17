const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const directory = path.join(__dirname, '../extensions/dola30');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));

test('generation extension matches the original 30s GitHub version byte for byte', () => {
  const originalRevision = 'ce1ebc0c4630d2afe0a03ca62490b4a3c92ea2d4';
  for (const file of ['service-worker.js', 'dola-skill-pack-response.json', 'doubao-skill-pack-response.json', 'manifest.json']) {
    // latin1 preserves every byte, including the original skill-pack encoding.
    const original = execFileSync('git', ['show', `${originalRevision}:extensions/dola30/${file}`], {cwd: path.join(directory, '../..')}).toString('latin1');
    const expected = original;
    assert.equal(fs.readFileSync(path.join(directory, file)).toString('latin1'), expected, file);
  }
});

test('restored extension references only existing scripts', () => {
  const scripts = [manifest.background.service_worker,
    ...manifest.content_scripts.flatMap(entry => entry.js)];
  for (const script of scripts) assert.ok(fs.existsSync(path.join(directory, script)), script);
  assert.ok(!scripts.includes('extension-ready.js'));
});

test('Master HD Media is visible and vertically centered on the right', () => {
  const source = fs.readFileSync(path.join(directory, 'content-panel.js'), 'utf8');
  assert.ok(!source.includes('host.style.setProperty("display", "none", "important")'));
  assert.match(source, /right: 16px;/);
  assert.match(source, /top: 50%;/);
  assert.match(source, /bottom: auto;/);
  assert.match(source, /transform: translateY\(-50%\);/);
  assert.match(source, /max-height: min\(420px, calc\(100vh - 32px\)\);/);
});

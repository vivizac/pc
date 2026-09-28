const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('monorepo transition directories exist without removing legacy PC root', () => {
  assert.equal(fs.existsSync('index.html'), true, 'legacy PC root must stay intact during transition');
  assert.equal(fs.existsSync('apps/pc/index.html'), true, 'PC snapshot must exist under apps/pc');
  assert.equal(fs.existsSync('packages/common/olli-command-schedule-common.js'), true);
  assert.equal(fs.existsSync('packages/common/olli-command-router-common.js'), true);
  assert.equal(fs.existsSync('packages/common/olli-attendance-data.js'), true);
  assert.equal(fs.existsSync('packages/common/olli-realtime-common.js'), true);
});

test('common transition snapshot starts identical to the current PC single source', () => {
  for (const file of [
    'olli-command-schedule-common.js',
    'olli-command-router-common.js',
    'olli-attendance-data.js',
    'olli-realtime-common.js'
  ]) {
    assert.equal(
      fs.readFileSync('packages/common/' + file, 'utf8'),
      fs.readFileSync(file, 'utf8'),
      file + ' must start from the exact current PC source'
    );
  }
});

test('Mobile history bridge is explicitly declared as apps/mobile submodule', () => {
  const gitmodules = fs.readFileSync('.gitmodules', 'utf8');
  assert.match(gitmodules, /\[submodule "apps\/mobile"\]/);
  assert.match(gitmodules, /path\s*=\s*apps\/mobile/);
  assert.match(gitmodules, /url\s*=\s*https:\/\/github\.com\/vivizac\/mobile\.git/);
});

test('transition metadata records both original repositories and runtime cutover guard', () => {
  const doc = fs.readFileSync('MONOREPO_TRANSITION.md', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('packages/common/source-manifest.json', 'utf8'));
  assert.match(doc, /Existing root PC runtime remains untouched/);
  assert.match(doc, /Vercel projects stay separate/);
  assert.equal(manifest.source_repository, 'vivizac/pc');
  assert.equal(manifest.mobile_repository, 'vivizac/mobile');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 40);
});

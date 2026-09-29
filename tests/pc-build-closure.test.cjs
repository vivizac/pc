'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PC = path.join(ROOT, 'apps', 'pc');
const COMMON = path.join(ROOT, 'packages', 'common');
const MANIFEST = path.join(COMMON, 'pc-runtime-manifest.json');
const { stageCommon } = require(path.join(PC, 'scripts', 'stage-common.cjs'));

function localRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) refs.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi)) refs.push(m[1]);
  return refs
    .map(raw => String(raw || '').trim())
    .filter(raw => raw && !/^(?:https?:|data:|blob:|javascript:|#|mailto:|tel:)/i.test(raw))
    .map(raw => raw.split('#')[0].split('?')[0].replace(/^\/+/, ''));
}

test('PC build remains closed after removing tracked common parity copies and staging canonical common files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-pc-closure-'));
  const tempPc = path.join(tempRoot, 'pc');
  try {
    fs.cpSync(PC, tempPc, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

    // Emulate the future state where apps/pc no longer tracks duplicate common files.
    for (const file of manifest.files) {
      fs.rmSync(path.join(tempPc, file), { force: true });
    }

    for (const file of manifest.files) {
      assert.equal(fs.existsSync(path.join(tempPc, file)), false, 'tracked parity copy still present in emulation: ' + file);
    }

    const staged = stageCommon({ pcDir: tempPc, commonDir: COMMON, manifestPath: MANIFEST });
    assert.equal(staged.count, 48);

    for (const file of manifest.files) {
      assert.equal(fs.existsSync(path.join(tempPc, file)), true, 'staged common file missing: ' + file);
      assert.equal(
        fs.readFileSync(path.join(tempPc, file)).equals(fs.readFileSync(path.join(COMMON, file))),
        true,
        'staged common byte mismatch: ' + file
      );
    }

    const html = fs.readFileSync(path.join(tempPc, 'index.html'), 'utf8');
    const refs = localRefs(html);
    const missing = [...new Set(refs)].filter(file => !fs.existsSync(path.join(tempPc, file)));
    assert.deepEqual(missing, [], 'missing PC local entry assets after common staging: ' + missing.join(', '));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('all local PC entry scripts parse after canonical common staging', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-pc-entry-'));
  const tempPc = path.join(tempRoot, 'pc');
  try {
    fs.cpSync(PC, tempPc, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const file of manifest.files) fs.rmSync(path.join(tempPc, file), { force: true });
    stageCommon({ pcDir: tempPc, commonDir: COMMON, manifestPath: MANIFEST });

    const html = fs.readFileSync(path.join(tempPc, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)]
      .map(m => String(m[1] || '').split('#')[0].split('?')[0].replace(/^\/+/, ''))
      .filter(src => src && !/^(?:https?:|data:|blob:)/i.test(src));

    const failures = [];
    for (const script of [...new Set(scripts)]) {
      const file = path.join(tempPc, script);
      assert.equal(fs.existsSync(file), true, 'missing PC script: ' + script);
      if (!/\.(?:js|cjs)$/i.test(file)) continue;
      const result = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) failures.push({
        script,
        stderr: String(result.stderr || result.stdout || '').trim().slice(0, 1200)
      });
    }
    assert.deepEqual(failures, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('PC index has no missing Common source for a staged common reference', () => {
  const html = fs.readFileSync(path.join(PC, 'index.html'), 'utf8');
  const refs = new Set(localRefs(html));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const usedCommon = manifest.files.filter(file => refs.has(file));
  assert.ok(usedCommon.length >= 35, 'unexpectedly small set of directly referenced common files');
  for (const file of usedCommon) {
    assert.equal(fs.existsSync(path.join(COMMON, file)), true, 'missing packages/common source: ' + file);
  }
});

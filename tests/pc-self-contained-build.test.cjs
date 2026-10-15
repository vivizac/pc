'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PC = path.join(ROOT, 'apps', 'pc');
const COMMON = path.join(ROOT, 'packages', 'common');
const MANIFEST = path.join(COMMON, 'pc-runtime-manifest.json');
const CONFIG = path.join(PC, 'vercel.json');
const { stageCommon } = require(path.join(PC, 'scripts', 'stage-common.cjs'));

test('PC common runtime manifest is the single tracked source for all 67 shared files', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.equal(manifest.files.length, 67);
  assert.equal(new Set(manifest.files).size, 67);
  for (const file of manifest.files) {
    assert.equal(fs.existsSync(path.join(COMMON, file)), true, 'missing common source: ' + file);
    assert.equal(fs.existsSync(path.join(PC, file)), false, 'duplicate tracked PC common file remains: ' + file);
  }
});

test('PC common staging materializes all canonical bytes into an empty app target', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-pc-common-'));
  try {
    const result = stageCommon({ pcDir: temp, commonDir: COMMON, manifestPath: MANIFEST });
    assert.equal(result.count, 67);
    for (const file of result.files) {
      assert.equal(
        fs.readFileSync(path.join(temp, file)).equals(fs.readFileSync(path.join(COMMON, file))),
        true,
        'staged byte mismatch: ' + file
      );
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('PC staging refuses to overwrite a divergent app-owned file', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-pc-divergent-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const first = manifest.files[0];
    fs.writeFileSync(path.join(temp, first), 'divergent');
    assert.throws(
      () => stageCommon({ pcDir: temp, commonDir: COMMON, manifestPath: MANIFEST }),
      /Refusing to overwrite a different PC source file/
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('future PC app-root deployment invokes common staging before serving', () => {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/stage-common.cjs');
});

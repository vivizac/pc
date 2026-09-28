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
const { stageCommon } = require(path.join(PC, 'scripts', 'stage-common.cjs'));

test('PC common runtime manifest contains the audited 48 files', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.equal(manifest.files.length, 48);
  assert.equal(new Set(manifest.files).size, 48);
  for (const file of manifest.files) {
    assert.equal(fs.existsSync(path.join(COMMON, file)), true, 'missing common source: ' + file);
    assert.equal(fs.existsSync(path.join(PC, file)), true, 'missing current PC parity copy: ' + file);
    assert.equal(
      fs.readFileSync(path.join(COMMON, file)).equals(fs.readFileSync(path.join(PC, file))),
      true,
      'PC/common parity mismatch: ' + file
    );
  }
});

test('PC common staging copies canonical bytes without changing behavior', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-pc-common-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const file of manifest.files) {
      const target = path.join(temp, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(PC, file), target);
    }
    const result = stageCommon({ pcDir: temp, commonDir: COMMON, manifestPath: MANIFEST });
    assert.equal(result.count, 48);
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

test('PC staging refuses to overwrite a divergent tracked copy', () => {
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

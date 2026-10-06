'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PC = path.join(ROOT, 'apps', 'pc');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');

test('active monorepo app roots and common package exist', () => {
  assert.equal(fs.existsSync(path.join(PC, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(MOBILE, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(MOBILE, 'api')), true);
  assert.equal(fs.existsSync(path.join(COMMON, 'pc-runtime-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(COMMON, 'mobile-runtime-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(ROOT, '.gitmodules')), false);
});

test('legacy root runtime entrypoints are removed', () => {
  for (const file of [
    'index.html',
    'olli-app-startup.js',
    'pc-timetable.js',
    'olli-command-router-common.js',
    'olli-realtime-common.js'
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, 'legacy root runtime remains: ' + file);
  }
});

test('shared runtime source exists only in packages/common, not tracked under apps/pc', () => {
  const pcManifest = JSON.parse(fs.readFileSync(path.join(COMMON, 'pc-runtime-manifest.json'), 'utf8'));
  const mobileManifest = JSON.parse(fs.readFileSync(path.join(COMMON, 'mobile-runtime-manifest.json'), 'utf8'));
  assert.equal(pcManifest.files.length, 51);
  assert.equal(mobileManifest.files.length, 48);

  for (const file of pcManifest.files) {
    assert.equal(fs.existsSync(path.join(COMMON, file)), true, 'missing common source: ' + file);
    assert.equal(fs.existsSync(path.join(PC, file)), false, 'tracked PC common duplicate remains: ' + file);
  }
});

test('source manifest records the completed active monorepo topology', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(COMMON, 'source-manifest.json'), 'utf8'));
  assert.equal(manifest.cutover_status, 'completed');
  assert.equal(manifest.active_repository, 'vivizac/pc');
  assert.equal(manifest.active_pc_root, 'apps/pc');
  assert.equal(manifest.active_mobile_root, 'apps/mobile');
  assert.equal(manifest.common_source, 'packages/common');
  assert.equal(manifest.provenance.mobile_history_repository, 'vivizac/mobile');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 40);
});

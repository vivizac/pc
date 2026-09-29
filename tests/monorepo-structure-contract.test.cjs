'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');

test('monorepo transition directories exist while legacy PC root stays intact', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'pc', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(MOBILE, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(MOBILE, 'api')), true);
  assert.equal(fs.existsSync(path.join(ROOT, '.gitmodules')), false);
});

test('transitional common package starts identical to the current PC source', () => {
  for (const file of [
    'olli-command-schedule-common.js',
    'olli-command-router-common.js',
    'olli-attendance-data.js',
    'olli-realtime-common.js'
  ]) {
    assert.equal(
      fs.readFileSync(path.join(COMMON, file), 'utf8'),
      fs.readFileSync(path.join(ROOT, file), 'utf8'),
      file + ' must match the current PC source during the parity stage'
    );
  }
});

test('Mobile common runtime manifest is available from the monorepo package', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(COMMON, 'mobile-runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 45);
  assert.equal(new Set(manifest.files).size, 45);
  for (const file of manifest.files) {
    assert.equal(fs.existsSync(path.join(COMMON, file)), true, 'missing common runtime source: ' + file);
  }
});

test('transition metadata records the current self-contained stage without claiming Production cutover', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'MONOREPO_TRANSITION.md'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(COMMON, 'source-manifest.json'), 'utf8'));
  assert.match(doc, /self-contained snapshot/i);
  assert.match(doc, /Production Mobile remains unchanged/i);
  assert.match(doc, /Vercel projects stay separate/i);
  assert.equal(manifest.source_repository, 'vivizac/pc');
  assert.equal(manifest.mobile_repository, 'vivizac/mobile');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 40);
});

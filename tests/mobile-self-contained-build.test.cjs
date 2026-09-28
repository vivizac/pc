'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'apps', 'mobile');
const COMMON = path.join(ROOT, 'packages', 'common');
const MANIFEST_PATH = path.join(COMMON, 'mobile-runtime-manifest.json');
const CONFIG_PATH = path.join(MOBILE, 'vercel.json');
const { stageCommon } = require(path.join(MOBILE, 'scripts', 'stage-common.cjs'));

test('materialized Mobile source exists and the old gitlink metadata is gone', () => {
  assert.ok(fs.existsSync(path.join(MOBILE, 'index.html')));
  assert.ok(fs.existsSync(path.join(MOBILE, 'api')));
  assert.equal(fs.existsSync(path.join(ROOT, '.gitmodules')), false);
});

test('Mobile runtime manifest is unique and fully backed by packages/common', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.files.length, 45);
  assert.equal(new Set(manifest.files).size, 45);
  for (const file of manifest.files) {
    assert.ok(fs.existsSync(path.join(COMMON, file)), 'missing common source: ' + file);
  }
});

test('monorepo Mobile Vercel config has no external PC raw runtime rewrites', () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/stage-common.cjs');
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes('raw.githubusercontent.com/vivizac/pc/'), false);
  assert.equal(Array.isArray(config.headers), true);
  assert.equal(config.headers.length, 68);
});

test('staging copies exactly the canonical common bytes and never needs a tracked duplicate', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-mobile-common-'));
  try {
    const result = stageCommon({ mobileDir: temp, commonDir: COMMON, manifestPath: MANIFEST_PATH });
    assert.equal(result.count, 45);
    for (const file of result.files) {
      const source = fs.readFileSync(path.join(COMMON, file));
      const target = fs.readFileSync(path.join(temp, file));
      assert.equal(target.equals(source), true, 'byte mismatch: ' + file);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test('staged Mobile index has a closed set of local static dependencies', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'olli-mobile-build-'));
  const tempMobile = path.join(tempRoot, 'mobile');
  try {
    fs.cpSync(MOBILE, tempMobile, { recursive: true });
    stageCommon({ mobileDir: tempMobile, commonDir: COMMON, manifestPath: MANIFEST_PATH });

    const html = fs.readFileSync(path.join(tempMobile, 'index.html'), 'utf8');
    const refs = [];
    const attrPattern = /\b(?:src|href)=["']([^"'<>]+)["']/gi;
    let match;
    while ((match = attrPattern.exec(html))) {
      const raw = String(match[1] || '').trim();
      if (!raw || /^(?:https?:|data:|blob:|javascript:|#|mailto:|tel:)/i.test(raw)) continue;
      const clean = raw.split('#')[0].split('?')[0].replace(/^\/+/, '');
      if (clean) refs.push(clean);
    }

    assert.ok(refs.length > 0, 'index.html should contain local static references');
    const missing = [...new Set(refs)].filter(file => !fs.existsSync(path.join(tempMobile, file)));
    assert.deepEqual(missing, [], 'missing staged Mobile assets: ' + missing.join(', '));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

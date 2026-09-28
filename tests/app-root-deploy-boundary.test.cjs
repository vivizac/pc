'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(app) {
  return fs.readFileSync(path.join(ROOT, 'apps', app, '.vercelignore'), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

test('PC app-root deployment excludes repository-only trees without excluding common staging', () => {
  const patterns = read('pc');
  assert.deepEqual(patterns, [
    '.github/',
    'tests/',
    'supabase/',
    'scripts/*.py',
    '.monorepo-source.json',
    '.vercel-redeploy-trigger'
  ]);
  assert.equal(patterns.includes('scripts/'), false);
  assert.equal(patterns.includes('scripts/stage-common.cjs'), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'pc', 'scripts', 'stage-common.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'pc', 'api')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'pc', 'assets')), true);
});

test('Mobile app-root deployment excludes repository-only trees without excluding runtime/API/staging', () => {
  const patterns = read('mobile');
  assert.deepEqual(patterns, [
    '.github/',
    'tests/',
    'supabase/',
    '.deploy-check-*.txt'
  ]);
  assert.equal(patterns.includes('scripts/'), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'mobile', 'scripts', 'stage-common.cjs')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'mobile', 'api')), true);
  assert.equal(fs.existsSync(path.join(ROOT, 'apps', 'mobile', 'assets')), true);
});

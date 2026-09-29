'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '..', '..');
const vercel = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'vercel.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'common', 'mobile-runtime-manifest.json'), 'utf8'));

test('monorepo Mobile stages secured auth sources from packages/common without PC raw runtime URLs', () => {
  assert.equal(vercel.buildCommand, 'node scripts/stage-common.cjs');
  assert.equal(JSON.stringify(vercel).includes('raw.githubusercontent.com/vivizac/pc/'), false);
  assert.ok(manifest.files.includes('olli-auth-academy-access.js'));
  assert.ok(manifest.files.includes('olli-auth-teacher-membership.js'));
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'common', 'olli-auth-academy-access.js')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'common', 'olli-auth-teacher-membership.js')), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const runtime = fs.readFileSync(path.join(root,'kinder-feedback.js'),'utf8');
const index = fs.readFileSync(path.join(root,'index.html'),'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot,'packages','common','mobile-runtime-manifest.json'),'utf8'));

test('mobile feedback photo upload uses shared signed storage helper',()=> {
  assert.doesNotMatch(runtime,/storage\/v1\/object\/\$\{bucket\}\/\$\{objectPath\}/);
  assert.doesNotMatch(runtime,/storage\/v1\/object\/public\/\$\{bucket\}/);
  assert.match(runtime,/OlliFeedbackPhotoStorage/);
  assert.match(runtime,/image_url: null/);
  assert.match(runtime,/thumbnail_url: null/);
  assert.match(runtime,/getSignedPhotoUrls/);
});

test('mobile does not persist expiring signed thumbnail URLs in live session',()=> {
  assert.match(runtime,/thumbnailUrl:''/);
  assert.doesNotMatch(runtime,/thumbnailUrl:safeUrl\(source\.thumbnailUrl\)/);
});

test('mobile loads shared signed photo helper before local feedback runtime',()=> {
  const helperPos=index.indexOf('olli-feedback-photo-storage-common.js');
  const runtimePos=index.indexOf('kinder-feedback.js?v=20260926-input-autogrow-1');
  assert.ok(helperPos >= 0 && runtimePos > helperPos);
  assert.equal(JSON.stringify(vercel).includes('raw.githubusercontent.com/vivizac/pc/'), false);
  assert.ok(manifest.files.includes('olli-feedback-photo-storage-common.js'));
  assert.equal(fs.existsSync(path.join(repoRoot,'packages','common','olli-feedback-photo-storage-common.js')), true);
});

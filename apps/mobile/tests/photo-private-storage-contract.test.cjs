const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root,'kinder-feedback.js'),'utf8');
const index = fs.readFileSync(path.join(root,'index.html'),'utf8');
const vercel = fs.readFileSync(path.join(root,'vercel.json'),'utf8');

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
  assert.match(vercel,/pc\/main\/olli-feedback-photo-storage-common\.js/);
});

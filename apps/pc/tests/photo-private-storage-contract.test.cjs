const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const helper = fs.readFileSync(path.join(root,'olli-feedback-photo-storage-common.js'),'utf8');
const runtime = fs.readFileSync(path.join(root,'pc-kinder-feedback.js'),'utf8');
const edge = fs.readFileSync(path.join(root,'supabase/functions/olli-feedback-photo-storage/index.ts'),'utf8');
const index = fs.readFileSync(path.join(root,'index.html'),'utf8');

test('photo storage helper uses Edge Function signed upload/read only',()=> {
  assert.match(helper,/functions\/v1\/olli-feedback-photo-storage/);
  assert.match(helper,/sign-upload/);
  assert.match(helper,/sign-read/);
  assert.match(helper,/method: 'PUT'/);
  assert.match(helper,/x-upsert/);
  assert.doesNotMatch(helper,/object\/public\/student_feedback_photos/);
});

test('PC photo upload no longer writes directly with anon storage credentials',()=> {
  assert.doesNotMatch(runtime,/storage\/v1\/object\/\$\{bucket\}\/\$\{objectPath\}/);
  assert.doesNotMatch(runtime,/storage\/v1\/object\/public\/\$\{bucket\}/);
  assert.match(runtime,/OlliFeedbackPhotoStorage/);
  assert.match(runtime,/image_url: null/);
  assert.match(runtime,/thumbnail_url: null/);
  assert.match(runtime,/getSignedPhotoUrls/);
});

test('PC loads common signed photo helper before feedback runtime',()=> {
  const helperPos=index.indexOf('olli-feedback-photo-storage-common.js');
  const runtimePos=index.indexOf('pc-kinder-feedback.js');
  assert.ok(helperPos >= 0 && runtimePos > helperPos);
});

test('Edge Function validates Olli session, academy membership, path ownership, and active metadata',()=> {
  assert.match(edge,/olli_account_id_from_session/);
  assert.match(edge,/academy_members/);
  assert.match(edge,/academies/);
  assert.match(edge,/objectPath\.startsWith\(academyId \+ "\/"\)/);
  assert.match(edge,/createSignedUploadUrl/);
  assert.match(edge,/createSignedUrls/);
  assert.match(edge,/feedback_photos/);
  assert.match(edge,/eq\("is_deleted", false\)/);
});

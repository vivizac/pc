const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const storage = fs.readFileSync(path.join(root,'olli-storage-core.js'),'utf8');
const memoStorage = fs.readFileSync(path.join(root,'observation-memo-storage-common.js'),'utf8');
const photoRuntime = fs.readFileSync(path.join(root,'pc-kinder-feedback.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'supabase/migrations/20260928044928_secure_observation_archive_photo_access.sql'),'utf8');

function featureBlock(feature){
  const start=storage.indexOf(`feature: '${feature}'`);
  assert.notEqual(start,-1,`${feature} missing`);
  const b0=storage.lastIndexOf('FeatureRegistry.register({',start);
  const b1=storage.indexOf('\n  });',start);
  return storage.slice(b0,b1+6);
}

test('photo metadata and note archive use account-session RPC transport',()=>{
  const expected={
    feedback_photo:'olli_feedback_photo_data_access',
    feedback_photo_student_link:'olli_feedback_photo_data_access',
    student_note_archive:'olli_note_archive_data_access'
  };
  Object.entries(expected).forEach(([feature,rpc])=>{
    const block=featureBlock(feature);
    assert.match(block,/transport: 'session_rpc'/);
    assert.match(block,new RegExp(`rpc: '${rpc}'`));
  });
});

test('observation memo draft read uses protected RPC while CAS write remains unchanged',()=>{
  assert.match(memoStorage,/rpc\/olli_note_draft_read/);
  assert.match(memoStorage,/olli_account_session_token_v1/);
  assert.doesNotMatch(memoStorage,/supabase\('GET', `\$\{path\}&select=\*&limit=1`\)/);
  const saveCommon = fs.readFileSync(path.join(root,'observation-memo-save-common.js'),'utf8');
  assert.match(saveCommon,/rpc\/olli_note_draft_save_cas/);
});

test('photo file upload is still a separately tracked storage risk, not disguised as secured metadata',()=>{
  assert.match(photoRuntime,/storage\/v1\/object\/\$\{bucket\}\/\$\{objectPath\}/);
  assert.match(photoRuntime,/KCF_PHOTO_BUCKET = 'student_feedback_photos'/);
  assert.match(photoRuntime,/saveOlliData\(KCF_PHOTO_COMMON_FEATURE/);
});

test('secure observation/archive/photo migration validates custom session and restricts function execute',()=>{
  assert.match(migration,/olli_account_id_from_session\(p_session_token\)/);
  assert.match(migration,/academy_members/);
  assert.match(migration,/a\.status='active'/);
  assert.match(migration,/revoke all on function public\.olli_note_draft_read/);
  assert.match(migration,/revoke all on function public\.olli_note_archive_data_access/);
  assert.match(migration,/revoke all on function public\.olli_feedback_photo_data_access/);
  assert.match(migration,/PHOTO_PATH_ACADEMY_MISMATCH/);
});

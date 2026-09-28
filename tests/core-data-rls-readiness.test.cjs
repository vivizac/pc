const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

function read(name){return fs.readFileSync(path.join(root,name),'utf8');}

test('stabilization branch core data paths do not use direct table REST',()=>{
  const files=[
    'olli-data-student-operations.js',
    'olli-data-attendance-feedback.js',
    'observation-memo-storage-common.js',
    'pc-kinder-feedback.js',
    'olli-settings-common-core.js',
    'olli-settings-account-runtime.js',
    'olli-settings-access.js',
    'olli-settings-storage.js'
  ];
  const forbidden=[
    /supabase\('GET',[^\n]*students\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*feedbacks\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*fail_feedbacks\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*summary_feedbacks\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*feedback_photos\?/,
    /supabase\('GET',[^\n]*student_note_drafts\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*student_note_archives\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*risk_signals\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*academies\?/,
    /supabase\('(?:GET|POST|PATCH|DELETE)',[^\n]*academy_members\?/
  ];
  files.forEach(name=>{
    const source=read(name);
    forbidden.forEach(pattern=>assert.doesNotMatch(source,pattern,name+' still has direct core-data REST: '+pattern));
  });
});

test('stabilization branch uses explicit account-session RPC contracts',()=>{
  const storage=read('olli-storage-core.js');
  const note=read('observation-memo-storage-common.js');
  const settings=read('olli-settings-common-core.js');
  const members=read('olli-settings-storage.js');
  const risk=read('supabase/migrations/20260928075224_harden_admin_risk_and_legacy_rpcs.sql');

  [
    'olli_student_data_access',
    'olli_general_feedback_data_access',
    'olli_growth_feedback_data_access',
    'olli_summary_feedback_data_access',
    'olli_feedback_photo_data_access',
    'olli_note_archive_data_access'
  ].forEach(name=>assert.match(storage,new RegExp(name)));

  assert.match(note,/rpc\/olli_note_draft_read/);
  assert.match(settings,/olli_academy_settings_get/);
  assert.match(settings,/olli_academy_settings_update/);
  assert.match(members,/olli_list_academy_members/);
  assert.match(risk,/olli_risk_signals_list/);
  assert.match(risk,/olli_risk_signal_save/);
});

test('final RLS plan revokes direct table privileges for every core academy table',()=>{
  const sql=read('supabase/rls-plans/final_core_data_lockdown_after_main.sql');
  [
    'students','feedbacks','fail_feedbacks','summary_feedbacks','feedback_photos',
    'student_note_drafts','student_note_archives','risk_signals','academies','academy_members'
  ].forEach(table=>{
    assert.match(sql,new RegExp('revoke all on table public\\.'+table+' from anon, authenticated'));
  });
  assert.match(sql,/DO NOT APPLY TO PRODUCTION BEFORE PC\/MOBILE WORK BRANCHES/);
});

test('final RLS plan closes old feedback and student RPC bypasses',()=>{
  const sql=read('supabase/rls-plans/final_core_data_lockdown_after_main.sql');
  [
    'create_student_for_academy',
    'save_feedback_for_academy',
    'save_summary_feedback_for_academy',
    'olli_feedback_insert_idempotent',
    'olli_growth_feedback_insert_idempotent',
    'olli_summary_feedback_insert_idempotent'
  ].forEach(name=>assert.match(sql,new RegExp('revoke all on function public\\.'+name)));
});

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const roster=read('apps/mobile/kcf-auto-mode-runtime.js');
const submit=read('packages/common/olli-feedback-registration-runtime.js');
const feedback=read('apps/mobile/kinder-feedback.js');
const migration=read('supabase/migrations/20261008154000_quicknote_trial_feedback_retention.sql');

test('trial guest has a stable virtual roster identity without pretending to be students.id',()=>{
  assert.match(roster,/row\.is_guest === true && clean\(row\.session_type\) === 'trial'/);
  assert.match(roster,/id: 'trial:' \+ sessionId/);
  assert.match(roster,/__olliTrialSessionId:sessionId/);
  assert.match(roster,/button\.textContent = item\.name \+ \(item\.trialSessionId \? ' · 체험' : ''\)/);
  assert.match(roster,/trialSessionId: clean\(item\.trialSessionId\)/);
});
test('trial roster selection resolves to a student-like display object with NO real student FK',()=>{
  assert.match(submit,/if \(autoSelection && autoSelection\.trialSessionId\)/);
  assert.match(submit,/id:'', name:String\(autoSelection\.studentName/);
  assert.match(submit,/trialSessionId: String\(student\.__olliTrialSessionId \|\| ''\)/);
});
test('trial AI result saves to a separate academy-scoped Supabase RPC',()=>{
  assert.match(feedback,/function saveKcfTrialFeedbackOnServer|async function saveKcfTrialFeedbackOnServer/);
  assert.match(feedback,/rpc\/olli_trial_feedback_save/);
  assert.match(feedback,/rpc\/olli_trial_feedback_update/);
  assert.match(feedback,/if \(item\.trialSessionId\)/);
  assert.match(feedback,/item\.savedSourceTable = 'olli_trial_feedbacks'/);
  assert.match(feedback,/trialSessionId:String\(options\.trialSessionId \|\| ''\)/);
  assert.match(feedback,/trialSessionId:String\(item\.trialSessionId \|\| ''\)/);
});
test('trial feedback SQL requires session and academy authority checks',()=>{
  assert.match(migration,/create table if not exists public\.olli_trial_feedbacks/);
  assert.match(migration,/trial_session_id uuid not null references public\.olli_schedule_one_time_sessions\(id\) on delete cascade/);
  assert.match(migration,/alter table public\.olli_trial_feedbacks enable row level security;/);
  assert.match(migration,/m\.academy_id = p_academy_id/);
  assert.match(migration,/s\.academy_id=p_academy_id/);
  assert.match(migration,/s\.session_type='trial'/);
});
test('six month retention only purges trial sessions and their audit snapshots',()=>{
  assert.match(migration,/session_type='trial' and s\.student_id is null/);
  assert.match(migration,/interval '6 months'/);
  assert.match(migration,/delete from public\.olli_schedule_one_time_sessions/);
  assert.match(migration,/delete from public\.olli_schedule_audit_log/);
  assert.match(migration,/cron\.schedule\(/);
  assert.doesNotMatch(migration,/delete from public\.students/);
  assert.doesNotMatch(migration,/delete from public\.feedbacks/);
});

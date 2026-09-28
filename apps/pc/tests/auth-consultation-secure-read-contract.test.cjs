const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');

function read(name){ return fs.readFileSync(path.join(root,name),'utf8'); }

test('account academy lookup is RPC-only and session-bound',()=>{
  const source=read('olli-auth-academy-access.js');
  assert.match(source,/olli_lookup_academy_by_code/);
  assert.match(source,/p_session_token: sessionToken/);
  assert.doesNotMatch(source,/academies\?select=/);
  assert.doesNotMatch(source,/supabase\('GET'/);
});

test('account session and approved teacher membership no longer read academy tables directly',()=>{
  const account=read('olli-auth-account-session.js');
  const teacher=read('olli-auth-teacher-membership.js');
  assert.match(account,/olli_get_my_academies/);
  assert.doesNotMatch(account,/academies\?select=/);
  assert.match(teacher,/olli_get_my_academies/);
  assert.doesNotMatch(teacher,/academies\?select=/);
  assert.doesNotMatch(teacher,/academy_members\?select=/);
});

test('consultation feedback reads use secure ServerAdapter features',()=>{
  const summary=read('olli-data-consultation-summary.js');
  const runtime=read('olli-consultation-runtime.js');
  for(const source of [summary,runtime]){
    assert.match(source,/general_feedback_records_read/);
    assert.match(source,/growth_feedback_records_read/);
    assert.match(source,/summary_feedback_records_read/);
    assert.match(source,/ServerAdapter\.read/);
    assert.doesNotMatch(source,/supabase\('GET',[^\n]*(?:feedbacks|fail_feedbacks|summary_feedbacks)/);
  }
});

test('settings backup member list uses secure membership RPC',()=>{
  const source=read('olli-settings-storage.js');
  assert.match(source,/olli_list_academy_members/);
  assert.doesNotMatch(source,/academy_members\?select=/);
});

test('academy lookup migration requires account session and closes PUBLIC execute',()=>{
  const source=read('supabase/migrations/20260928065820_harden_account_academy_lookup.sql');
  assert.match(source,/olli_account_id_from_session/);
  assert.match(source,/revoke all on function public\.olli_lookup_academy_by_code\(text,text\) from public/);
  assert.match(source,/grant execute on function public\.olli_lookup_academy_by_code\(text,text\) to anon, authenticated/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const access=fs.readFileSync(path.join(root,'olli-settings-access.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260928075224_harden_admin_risk_and_legacy_rpcs.sql'),'utf8');

test('academy access writes use platform-admin RPC and separate constrained auto-expiry RPC',()=>{
  assert.match(access,/olli_admin_set_academy_access/);
  assert.match(access,/olli_mark_academy_trial_expired_if_due/);
  assert.doesNotMatch(access,/supabase\('PATCH',[^\n]*academies/);
  assert.match(access,/hasAuthoritativeServerAccess \? \{ \.\.\.local, \.\.\.server \}/);
});

test('risk signals have account-session RPCs while legacy writer is closed',()=>{
  assert.match(migration,/olli_risk_signals_list/);
  assert.match(migration,/olli_risk_signal_save/);
  assert.match(migration,/olli_account_id_from_session/);
  assert.match(migration,/revoke all on function public\.save_risk_signal_for_academy/);
});

test('legacy test RPC execution is revoked',()=>{
  [
    'test_approve_teacher_request',
    'test_reject_teacher_request',
    'test_list_teacher_approval_requests',
    'test_list_academy_members',
    'test_check_teacher_approval_status',
    'test_owner_login',
    'test_create_academy_with_password'
  ].forEach(name=>assert.match(migration,new RegExp('revoke all on function public\\.'+name)));
});

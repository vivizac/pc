const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const migration=read('supabase/migrations/20261110073449_preserve_teacher_membership_history_on_unlink.sql');
const core=read('packages/common/olli-settings-common-core.js');
const members=read('packages/common/olli-settings-members.js');

test('unlink validates owner, current academy, target teacher and self-protection',()=>{
  assert.match(migration,/olli_account_id_from_session\(p_session_token\)/);
  assert.match(migration,/m\.academy_id=p_academy_id/);
  assert.match(migration,/m\.role='owner' and m\.status='active'/);
  assert.match(migration,/v_target\.account_id=v_reviewer_account_id/);
  assert.match(migration,/v_target\.role not in \('teacher','manager'\)/);
});

test('unlink revokes only the requested academy, not teacher account or history',()=>{
  assert.match(migration,/update public\.academy_members/);
  assert.match(migration,/set status='disabled'/);
  assert.match(migration,/device_status='not_registered'/);
  assert.match(migration,/where id=v_target\.id and academy_id=p_academy_id/);
  assert.match(migration,/delete from public\.device_sessions\s+where academy_id=p_academy_id and member_id=v_target\.id/);
  assert.match(migration,/update public\.olli_team_chat_push_subscriptions/);
  assert.doesNotMatch(migration,/delete from public\.academy_members/i);
  assert.doesNotMatch(migration,/delete from public\.olli_team_chat_messages/i);
  assert.doesNotMatch(migration,/delete from public\.olli_team_material_requests/i);
  assert.doesNotMatch(migration,/update public\.olli_account_sessions/i);
});

test('settings list hides disconnected account membership only after server confirmation',()=>{
  assert.match(core,/if \(isSettingsAccountMembershipMember\(row\) && status === 'disabled'\) return false/);
  assert.match(core,/filter\(member=>String\(member\?\.status\|\|'active'\)/);
  assert.match(members,/result\.removed !== true \|\| result\.status !== 'disabled'/);
  assert.match(members,/await settingsLoadTeacherManagementMembers\(\)/);
  assert.doesNotMatch(members,/olliSettingsState\.members = \(olliSettingsState\.members \|\| \[\]\)\.filter/);
});
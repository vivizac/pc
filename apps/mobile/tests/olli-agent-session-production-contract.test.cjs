'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const session=fs.readFileSync(path.join(root,'api/_lib/olli-agent/session.cjs'),'utf8');
const migration=fs.readFileSync(path.resolve(root,'../../supabase/migrations/20261002073232_agent_session_store.sql'),'utf8');

test('session adapter implements the Agents SDK persistence contract',()=>{
  for(const method of ['getSessionId','getItems','addItems','popItem','clearSession']){
    assert.match(session,new RegExp('async\\s+'+method+'\\s*\\('));
  }
  assert.match(session,/olli_agent_session_access/);
  assert.match(session,/p_academy_id/);
  assert.match(session,/p_member_id/);
  assert.match(session,/p_surface/);
  assert.match(session,/team_talk/);
});

test('session store is private and service-role only',()=>{
  assert.match(migration,/private\.olli_agent_sessions/);
  assert.match(migration,/private\.olli_agent_session_items/);
  assert.match(migration,/private\.olli_agent_subject_refs/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on table private\.olli_agent_sessions from public, anon, authenticated/);
  assert.match(migration,/revoke all on function public\.olli_agent_session_access\([\s\S]*?from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.olli_agent_session_access\([\s\S]*?to service_role/);
  assert.match(migration,/security invoker/i);
  assert.doesNotMatch(migration,/security definer/i);
});

test('session access verifies the authenticated academy member on every call',()=>{
  assert.match(migration,/public\.olli_account_id_from_session\(p_session_token\)/);
  assert.match(migration,/m\.id = p_member_id/);
  assert.match(migration,/m\.academy_id = p_academy_id/);
  assert.match(migration,/m\.account_id = v_account_id/);
  assert.match(migration,/m\.status = 'active'/);
  assert.match(migration,/a\.status = 'active'/);
});

test('session item writes are serialized, retry-safe, and bounded',()=>{
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/unique \(session_id, batch_key, batch_index\)/);
  assert.match(migration,/on conflict \(session_id, batch_key, batch_index\) do nothing/);
  assert.match(migration,/offset 160/);
  assert.match(migration,/limit v_limit/);
});

test('subject references keep real ids in the private store only',()=>{
  assert.match(migration,/unique \(session_id, subject_ref\)/);
  assert.match(migration,/unique \(session_id, label\)/);
  assert.match(migration,/unique \(session_id, student_id\)/);
  assert.match(migration,/st\.academy_id = p_academy_id/);
  assert.match(session,/enumerable:\s*false/);
  assert.match(session,/studentId/);
});

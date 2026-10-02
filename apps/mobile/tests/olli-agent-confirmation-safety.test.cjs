'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const {
  CONFIRMATION_INVARIANTS,
  ACTION_SOTS,
  STALE_SENSITIVE_ACTIONS,
}=require('../api/_lib/olli-agent/confirmation-safety.cjs');

const repoRoot=path.resolve(__dirname,'../../..');
const endpoint=fs.readFileSync(path.join(repoRoot,'apps/mobile/api/olli-agent.js'),'utf8');
const pc=fs.readFileSync(path.join(repoRoot,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(repoRoot,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(repoRoot,'supabase/migrations/20261002070047_team_chat_attendance_status_agent_action.sql'),
  'utf8'
);

test('confirmation safety invariants remain explicit and all enabled',()=>{
  assert.ok(Object.keys(CONFIRMATION_INVARIANTS).length>=8);
  for(const value of Object.values(CONFIRMATION_INVARIANTS)) assert.equal(value,true);
});

test('Agent endpoint can prepare cards but cannot execute mutations',()=>{
  assert.doesNotMatch(endpoint,/olli_team_chat_action_execute/);
  assert.match(endpoint,/run[A-Za-z]+Prepare/);
});

test('PC and Mobile execute only from pending confirmation cards and guard double clicks',()=>{
  const pcCard=pc.slice(pc.indexOf('function makeActionCard'),pc.indexOf('function olliReplyTargetIds'));
  assert.match(pcCard,/status !== 'pending'/);
  assert.match(pcCard,/execute\.addEventListener\('click', \(\) => handleActionCard\(action, 'execute'\)\)/);
  assert.match(pc,/state\.actionBusy\.has\(actionId\)/);
  assert.match(pc,/state\.actionBusy\.add\(actionId\)/);

  const mobileCard=mobile.slice(
    mobile.indexOf('function createOlliTalkActionCard'),
    mobile.indexOf('function getOlliTalkReplyTargetIds')
  );
  assert.match(mobileCard,/status!=='pending'/);
  assert.match(mobileCard,/execute\.addEventListener\('click',\(\)=>handleOlliTalkActionCard\(action,'execute'\)\)/);
  assert.match(mobile,/olliTalkActionBusy\.has\(actionId\)/);
  assert.match(mobile,/olliTalkActionBusy\.add\(actionId\)/);
});

test('confirmation executor serializes one action resolution and refuses non-pending actions',()=>{
  assert.match(migration,/where a\.id=p_action_id and a\.academy_id=p_academy_id\s+for update;/);
  assert.match(migration,/if v_action\.status <> 'pending' then/);
  assert.match(migration,/이미 처리된 작업입니다/);
});

test('executor marks completed only after authoritative SOT returns ok',()=>{
  const resultCheck=migration.indexOf("if coalesce((v_result->>'ok')::boolean,false) is not true then");
  const completed=migration.indexOf("set status='completed'");
  assert.ok(resultCheck>=0);
  assert.ok(completed>resultCheck);
  assert.match(migration,/set status='failed'/);
  assert.match(migration,/revision=revision\+1/);
});

test('confirmation card persistence is retry-safe and rejects key reuse with a different payload',()=>{
  assert.match(migration,/on conflict \(academy_id,client_message_id\) do nothing/);
  assert.match(migration,/on conflict \(academy_id,message_id\) do nothing/);
  assert.match(migration,/v_action\.action_type <> v_action_type or v_action\.action_payload <> v_payload/);
  assert.match(migration,/같은 요청 키가 다른 작업에 이미 사용되었습니다/);
});

test('stale-sensitive one-time changes re-read current source state at confirmation',()=>{
  assert.match(migration,/from public\.olli_schedule_one_time_sessions o/);
  assert.match(migration,/o\.status <> 'cancelled'/);
  assert.match(migration,/v_source_session_type is null/);
  assert.match(migration,/olli_schedule_update_one_time_session/);
});

test('all current confirmation action types have a declared authoritative SOT',()=>{
  const allowedBlock=migration.slice(
    migration.lastIndexOf("if v_action_type not in ("),
    migration.lastIndexOf(") then raise exception '지원하지 않는 작업입니다.'")
  );
  const types=Array.from(allowedBlock.matchAll(/'([a-z_]+)'/g)).map((m)=>m[1]);
  const missing=Array.from(new Set(types)).filter((type)=>!ACTION_SOTS[type]);
  assert.deepEqual(missing,[]);
});

test('stale-sensitive manifest only references known confirmation actions',()=>{
  for(const action of STALE_SENSITIVE_ACTIONS){
    assert.ok(ACTION_SOTS[action],action);
  }
});

test('executor routes critical stale-sensitive actions back through existing SOTs at confirmation',()=>{
  for(const token of [
    'olli_schedule_execute(',
    'olli_schedule_update_one_time_session(',
    'olli_schedule_update_waitlist_target(',
    'olli_schedule_resolve_waitlist(',
    'olli_schedule_save_pickup_v3(',
    'olli_schedule_save_pickup_arrival(',
    'olli_schedule_register_pickup_dropoff(',
    'olli_schedule_remove_pickup(',
    'olli_schedule_remove_pickup_dropoff(',
    'olli_schedule_set_attendance_session_status_v2(',
    'olli_schedule_set_class_teacher(',
    'olli_schedule_set_teacher_override(',
    'olli_schedule_set_session_order(',
    'olli_schedule_set_normal_class_day(',
    'olli_schedule_set_kinder_class_split(',
  ]){
    assert.ok(migration.includes(token),token);
  }
});

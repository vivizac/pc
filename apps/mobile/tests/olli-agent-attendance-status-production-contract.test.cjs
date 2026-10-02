const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/attendance-status-prepare-tools.cjs'),'utf8');
const migration=fs.readFileSync(path.resolve(root,'../../supabase/migrations/20261002070000_team_chat_attendance_status_agent_action.sql'),'utf8');

test('production endpoint exposes only source-bound attendance status prepare',()=>{
  assert.match(endpoint,/'attendance_status_prepare'/);
  assert.match(endpoint,/OLLI_AGENT_ATTENDANCE_STATUS_SOURCE_REQUIRED/);
  assert.match(endpoint,/runAttendanceStatusPrepare/);
  assert.doesNotMatch(endpoint,/attendance_status_prepare_probe/);
});

test('runtime reparses stored source and requires one private subject before creating a card',()=>{
  const start=runtime.indexOf('function parseAttendanceStatusSource');
  const end=runtime.indexOf('\n\nmodule.exports = {',start);
  const block=runtime.slice(start,end);
  assert.ok(block.includes('parseAttendanceStatusMutationIntent'));
  assert.ok(block.includes('validatePickupSourceMessage'));
  assert.ok(block.includes('subjectRefs.length!==1'));
  assert.ok(block.includes("toolChoice:'prepare_attendance_status'"));
  assert.ok(block.includes("requestId:'team-chat-message:'+sourceId"));
  assert.ok(block.includes('persistedMessage'));
});

test('prepare tool only reads schedule/register and stores a pending Team Chat action',()=>{
  assert.ok(tool.includes("callRpc('olli_schedule_week'"));
  assert.ok(tool.includes("callRpc('olli_schedule_attendance_month'"));
  assert.ok(tool.includes("callRpc('olli_team_chat_send_action'"));
  assert.equal(tool.includes("callRpc('olli_schedule_set_attendance_session_status_v2'"),false);
  assert.equal(tool.includes("callRpc('olli_schedule_execute'"),false);
  const start=tool.indexOf("name:'prepare_attendance_status'");
  const end=tool.indexOf('async execute()',start);
  assert.match(tool.slice(start,end),/parameters:z\.object\(\{\}\)/);
});

test('database sender and executor support only the new confirmation action path',()=>{
  assert.ok(migration.includes("'set_attendance_status'::text"));
  assert.ok(migration.includes("'set_attendance_status'"));
  assert.ok(migration.includes("elsif v_type='set_attendance_status' then"));
  const branch=migration.slice(migration.indexOf("elsif v_type='set_attendance_status' then"),migration.indexOf("elsif v_type='mark_absent' then"));
  assert.ok(branch.includes('public.olli_schedule_set_attendance_session_status_v2'));
  assert.ok(branch.includes("v_payload->>'sessionKind'"));
  assert.ok(branch.includes("v_payload->>'status'"));
  assert.equal(branch.includes('olli_schedule_execute'),false);
});

test('direct attendance status completion message uses timetable label helper for half-hour compatibility',()=>{
  const start=migration.indexOf("when 'set_attendance_status' then");
  const block=migration.slice(start,start+1200);
  assert.ok(block.includes('private.olli_schedule_time_slot_label'));
  assert.ok(block.includes("when 'present' then '출석'"));
  assert.ok(block.includes("when 'absent' then '결석'"));
  assert.ok(block.includes("when 'makeup' then '보강'"));
});

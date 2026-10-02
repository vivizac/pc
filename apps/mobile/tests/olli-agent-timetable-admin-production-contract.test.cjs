const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const tool=fs.readFileSync(path.join(root,'api/_lib/olli-agent/tools/timetable-admin-prepare-tools.cjs'),'utf8');
const executorMigration=fs.readFileSync(path.resolve(root,'../../supabase/migrations/20261002033226_team_chat_timetable_admin_agent_actions.sql'),'utf8');
const senderMigration=fs.readFileSync(path.resolve(root,'../../supabase/migrations/20261002151000_allow_timetable_admin_team_chat_actions.sql'),'utf8');

test('production endpoint exposes only source-bound timetable admin prepare',()=>{
  assert.match(endpoint,/'timetable_admin_prepare'/);
  assert.match(endpoint,/OLLI_AGENT_TIMETABLE_ADMIN_SOURCE_REQUIRED/);
  assert.match(endpoint,/runTimetableAdminPrepare/);
  assert.doesNotMatch(endpoint,/timetable_admin_prepare_probe/);
});

test('runtime reparses the stored source with shared admin parsers before creating a card',()=>{
  const start=runtime.indexOf('function parseTimetableAdminSource');
  const end=runtime.indexOf('\n\nmodule.exports = {',start);
  const block=runtime.slice(start,end);
  for(const parser of [
    'parseClassLayoutMutationIntent',
    'parseTeacherAssignmentMutationIntent',
    'parseSessionOrderMutationIntent',
    'parseNormalClassDayMutationIntent',
  ]) assert.ok(block.includes(parser),parser);
  assert.ok(block.includes('validatePickupSourceMessage'));
  assert.ok(block.includes("toolChoice:'prepare_timetable_admin'"));
  assert.ok(block.includes("requestId:'team-chat-message:'+sourceId"));
  assert.ok(block.includes('persistedMessage'));
});

test('prepare tool only stores a Team Chat pending action and contains no direct mutation calls',()=>{
  assert.ok(tool.includes("callRpc('olli_team_chat_send_action'"));
  for(const mutation of [
    "callRpc('olli_schedule_execute'",
    "callRpc('olli_schedule_set_class_teacher'",
    "callRpc('olli_schedule_set_teacher_override'",
    "callRpc('olli_schedule_set_session_order'",
    "callRpc('olli_schedule_set_normal_class_day'",
    "callRpc('olli_schedule_set_kinder_class_split'",
  ]) assert.equal(tool.includes(mutation),false,mutation);
});

test('database action executor allows and executes all timetable admin action types',()=>{
  for(const type of [
    'set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'
  ]){
    assert.ok(executorMigration.includes("'"+type+"'::text"),type+' constraint');
    assert.ok(executorMigration.includes("v_type='"+type+"'"),type+' executor');
  }
  for(const rpc of [
    'olli_schedule_set_kinder_class_split',
    'olli_schedule_set_class_teacher',
    'olli_schedule_set_teacher_override',
    'olli_schedule_set_session_order',
    'olli_schedule_set_normal_class_day',
  ]) assert.ok(executorMigration.includes(rpc),rpc);
  assert.ok(executorMigration.includes("then 'split_class' else 'merge_class' end"));
});


test('database action sender accepts every timetable admin action type',()=>{
  const start=senderMigration.indexOf('CREATE OR REPLACE FUNCTION public.olli_team_chat_send_action');
  assert.ok(start>=0,'send_action definition missing');
  const block=senderMigration.slice(start);
  for(const type of [
    'set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'
  ]) assert.ok(block.includes("'"+type+"'"),type+' send allowlist');
});

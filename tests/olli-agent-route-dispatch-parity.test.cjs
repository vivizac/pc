'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.resolve(__dirname,'..');
const COMMON=path.join(ROOT,'packages','common');
const pc=fs.readFileSync(path.join(ROOT,'apps','pc','pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(ROOT,'apps','mobile','olli-talk-beta.js'),'utf8');
const classifier=fs.readFileSync(path.join(COMMON,'olli-team-talk-agent-route-common.js'),'utf8');

test('current classifier only exposes attendance status and two history reads',()=>{
  assert.match(classifier,/attendance_status/);
  assert.match(classifier,/attendance_read/);
  assert.match(classifier,/pickup_read/);
  for(const token of ['batch_write','timetable_admin','trial_add','makeup_add','waitlist_add','move_cancel','timetable_read','schedule_read']){
    assert.doesNotMatch(classifier,new RegExp(token));
  }
});

test('PC and Mobile still keep compatibility shared dispatch behind the narrow classifier',()=>{
  assert.match(pc,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(pc,/async function resolveSharedAgentRouteTurn/);
  assert.match(mobile,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(mobile,/async function resolveOlliTalkSharedAgentRouteTurn/);
});

test('deterministic batch and timetable-admin rule routes run before classifier',()=>{
  for(const source of [pc,mobile]){
    const classifierPos=source.indexOf('const routeClassifier=');
    assert.ok(classifierPos>=0);
    assert.ok(source.indexOf("interpreterRoute==='rule' && interpreterIntent==='batch_write'")<classifierPos);
    assert.ok(source.indexOf("['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)")<classifierPos);
  }
});

test('legacy fallback executors remain compatibility safety nets after current rule paths',()=>{
  assert.match(pc,/router\.prepareAction\(commandText/);
  assert.match(pc,/router\.runQuery\(commandText/);
  assert.match(mobile,/router\.prepareAction\(commandText/);
  assert.match(mobile,/router\.runQuery\(commandText/);
});

test('common classifier remains classification-only',()=>{
  assert.doesNotMatch(classifier,/fetch\s*\(/);
  assert.doesNotMatch(classifier,/supabase/i);
  assert.doesNotMatch(classifier,/olli_team_chat_action_execute/);
});

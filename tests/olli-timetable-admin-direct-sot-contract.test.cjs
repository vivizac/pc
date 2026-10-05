'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const runtime=fs.readFileSync(path.join(__dirname,'../apps/mobile/api/_lib/olli-agent/runtime.cjs'),'utf8');
const endpoint=fs.readFileSync(path.join(__dirname,'../apps/mobile/api/olli-agent.js'),'utf8');

test('timetable admin initial prepare is deterministic after the single Luna interpretation',()=>{
  const start=runtime.indexOf('async function runTimetableAdminPrepare');
  const end=runtime.indexOf('async function runStructuredTimetableAdminPrepare',start);
  const block=runtime.slice(start,end);
  assert.match(block,/parseTimetableAdminSource/);
  assert.match(block,/prepareTimetableAdminAction/);
  assert.match(block,/allowChoice:true/);
  assert.doesNotMatch(block,/assertOpenAiKey\s*\(/);
  assert.doesNotMatch(block,/loadAgentsSdk\s*\(/);
  assert.doesNotMatch(block,/new Agent\s*\(/);
  assert.doesNotMatch(block,/agentModel\s*\(/);
});

test('all requested timetable admin families stay on the same deterministic SOT',()=>{
  const start=runtime.indexOf('async function runTimetableAdminPrepare');
  const end=runtime.indexOf('async function runStructuredTimetableAdminPrepare',start);
  const block=runtime.slice(start,end);
  for(const intent of [
    'set_class_teacher',
    'set_teacher_override',
    'set_session_order',
    'set_normal_class_day'
  ]) assert.match(block,new RegExp("'"+intent+"'"));
});

test('API does not create an Agents SDK context for timetable_admin_prepare',()=>{
  const start=endpoint.indexOf("if (mode === 'timetable_admin_prepare')");
  const end=endpoint.indexOf("if (mode === 'structured_timetable_admin_prepare')",start);
  const block=endpoint.slice(start,end);
  assert.match(block,/runTimetableAdminPrepare/);
  assert.doesNotMatch(block,/toAgentRunContext/);
});

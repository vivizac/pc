'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(root,'api/_lib/olli-agent/privacy.cjs'),'utf8');

test('source-bound read endpoint keeps one academy-member session only for private subject binding',()=>{
  assert.match(endpoint,/createOlliAgentSession/);
  assert.match(endpoint,/surface:'team_talk'/);
  assert.match(endpoint,/runKey:'team-chat-message:'\+String\(sourceMessageId\)/);
  assert.match(endpoint,/const subjectSession=/);
  assert.match(endpoint,/prepareAgentReadPrivacyInput/);
  assert.match(endpoint,/\{session:subjectSession\}/);
  assert.doesNotMatch(endpoint,/session:agentSession/);
  assert.match(endpoint,/sourceValidated:true/);
  assert.ok(
    endpoint.indexOf('validatePickupSourceMessage') < endpoint.indexOf('prepareAgentReadPrivacyInput'),
    'stored Team Chat source must be validated before persistent subject context changes'
  );
});

test('session failures fall back to the previous explicit-subject privacy path',()=>{
  assert.match(endpoint,/startsWith\('OLLI_AGENT_SESSION_'\)/);
  assert.match(endpoint,/prepared=await privacyModule\.prepareAgentPrivacyInput\(message,requestContext\)/);
});

test('production source-bound reads do not attach SDK Session history after privacy resolution',()=>{
  const start=endpoint.indexOf("if (mode === 'context_read' || mode === 'timetable_read'");
  const end=endpoint.indexOf("if (mode === 'timetable_admin_prepare')",start);
  assert.ok(start>=0 && end>start);
  const readBlock=endpoint.slice(start,end);
  assert.doesNotMatch(readBlock,/session:agentSession/);

  for(const call of [
    'runtimeModule.runTimetableRead({',
    'runtimeModule.runStudentScheduleRead({',
    'runtimeModule.runAttendanceRead({',
    'runtimeModule.runPickupRead({',
  ]){
    const callStart=readBlock.indexOf(call);
    assert.ok(callStart>=0,call+' missing');
    const callEnd=readBlock.indexOf('});',callStart);
    assert.ok(callEnd>callStart);
    const args=readBlock.slice(callStart,callEnd);
    assert.doesNotMatch(args,/session:/);
  }
});

test('runtime Session support remains available for probes and non-production callers',()=>{
  for(const fn of [
    'runStudentScheduleProbe',
    'runAttendanceProbe',
    'runPickupProbe',
    'runTimetableRead',
  ]){
    const start=runtime.indexOf('async function '+fn);
    assert.ok(start>=0,fn+' missing');
    const nextAsync=runtime.indexOf('\nasync function ',start+20);
    const nextFn=runtime.indexOf('\nfunction ',start+20);
    let end=runtime.length;
    for(const value of [nextAsync,nextFn]){
      if(value>=0 && value<end) end=value;
    }
    const block=runtime.slice(start,end);
    assert.match(block,/session=null/);
    assert.match(block,/if\(session\) runOptions\.session=session/);
    if(fn.endsWith('Read')) assert.match(block,/sourceValidated=false/);
  }
});

test('persistent context is deliberately single-subject and resets on an explicit subject switch',()=>{
  assert.match(privacy,/Persistent read context is intentionally single-subject first/);
  assert.match(privacy,/await session\.clearSession\(\)/);
  assert.match(privacy,/label:'학생A'/);
  assert.match(privacy,/isContextualStudentReference/);
  assert.match(privacy,/if\(sameBinding\)[\s\S]*?else\{[\s\S]*?bindSubjectBindings/);
  const contextualStart=privacy.indexOf("if(\n    bindings.length===1\n    && clean(bindings[0]?.label)==='학생A'\n    && (isContextualStudentReference(text) || allowBoundSubjectContinuation)");
  const contextualEnd=privacy.indexOf("return Object.freeze({",contextualStart);
  assert.ok(contextualStart>=0 && contextualEnd>contextualStart);
  assert.doesNotMatch(privacy.slice(contextualStart,contextualEnd),/bindSubjectBindings/);
  assert.match(privacy,/prepareAgentContextReadPrivacyInput/);
  assert.match(privacy,/allowBoundSubjectContinuation:true/);
});

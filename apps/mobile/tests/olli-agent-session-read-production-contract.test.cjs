'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const endpoint=fs.readFileSync(path.join(root,'api/olli-agent.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'api/_lib/olli-agent/runtime.cjs'),'utf8');
const privacy=fs.readFileSync(path.join(root,'api/_lib/olli-agent/privacy.cjs'),'utf8');

test('source-bound read endpoint creates one academy-member Team Chat session',()=>{
  assert.match(endpoint,/createOlliAgentSession/);
  assert.match(endpoint,/surface:'team_talk'/);
  assert.match(endpoint,/runKey:'team-chat-message:'\+String\(sourceMessageId\)/);
  assert.match(endpoint,/prepareAgentReadPrivacyInput/);
  assert.match(endpoint,/session:agentSession/);
  assert.match(endpoint,/sourceValidated:true/);
  assert.ok(
    endpoint.indexOf('validatePickupSourceMessage') < endpoint.indexOf('prepareAgentReadPrivacyInput'),
    'stored Team Chat source must be validated before persistent session context changes'
  );
});

test('session failures fall back to the previous explicit-subject privacy path',()=>{
  assert.match(endpoint,/startsWith\('OLLI_AGENT_SESSION_'\)/);
  assert.match(endpoint,/prepared=await privacyModule\.prepareAgentPrivacyInput\(message,requestContext\)/);
});

test('read runtimes pass the Session object to the Agents SDK only when enabled',()=>{
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
});

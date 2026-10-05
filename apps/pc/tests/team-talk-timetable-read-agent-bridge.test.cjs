'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC removes obsolete local read candidate duplicates',()=>{
  for(const token of [
    'parseTimetableReadAgentCandidate',
    'isStudentAttendanceReadCandidate',
    'isStudentPickupReadCandidate',
    'isStudentScheduleReadCandidate'
  ]) assert.doesNotMatch(talk,new RegExp('function '+token+'\\b'));
});

test('PC shared Agent dispatch only keeps classifier-reachable read cases',()=>{
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveContextualMakeupTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(dispatch,/case 'attendance_read'/);
  assert.match(dispatch,/case 'pickup_read'/);
  assert.doesNotMatch(dispatch,/case 'timetable_read'/);
  assert.doesNotMatch(dispatch,/case 'schedule_read'/);
});

test('PC remaining source-bound read bridge saves only the Agent answer',()=>{
  const start=talk.indexOf('async function resolveSourceBoundReadAgentTurn');
  const end=talk.indexOf('async function resolveBatchAgentTurn',start);
  const block=talk.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/readIntent/);
  assert.match(block,/saveAssistantReply\(current,replyText,sourceMessageId\)/);
  assert.match(block,/recordAi:false/);
});

test('PC deterministic timetable and schedule reads stay outside current Agent classifier path',()=>{
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.match(ai,/interpretOlliSystemLanguage\(/);
  assert.match(ai,/sharedRoute=interpreterRoute==='agent'/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.doesNotMatch(ai,/mode:'context_read'/);
  assert.doesNotMatch(ai,/mode:'context_resolve'/);
  assert.match(ai,/if\(interpreterRoute==='rule'\)/);
});

test('PC Bot path stays independent from remaining Agent reads',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/attendance_read|pickup_read|resolveSourceBoundReadAgentTurn/);
});

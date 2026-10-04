const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable memo add/delete routes through memo_prepare before legacy prepareAction — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_memo'/);
  assert.match(dispatch,/case 'batch_write'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC memo bridge sends server-side memo note and consumes persisted action',()=>{
  const start=talk.indexOf('async function resolveTimetableMemoAgentTurn');
  const end=talk.indexOf('async function resolveMakeupAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/memoNote:clean\(parsed\?\.memoNote\)/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC batch is detected before individual writes and missing reasons are collected — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_memo'/);
  assert.match(dispatch,/case 'batch_write'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC batch uses batch_prepare and renders multiple persisted cards',()=>{
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/assistantMessages\.slice\(1\)\.forEach/);
  assert.match(talk,/appendPersistedMessage\(message,current\.memberId\)/);
});

test('PC batch collects missing makeup date/time after reason turns',()=>{
  assert.match(talk,/function batchCommandNeedsClarification/);
  assert.match(talk,/function batchClarificationPrompt/);
  assert.match(talk,/function applyBatchClarification/);
  assert.match(talk,/보강 날짜와 시간을 함께 알려주세요/);
  assert.match(talk,/clarificationMessageId/);
});

test('PC timetable memo class choice resumes through deterministic structured memo prepare',()=>{
  const start=talk.indexOf('async function resolveStructuredTimetableMemoTurn');
  const end=talk.indexOf('function isSafeMakeupClarification',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_memo_prepare'/);
  assert.match(block,/memoNote/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'memo_prepare'/);
});

test('PC structured memo resume can persist a second memoId choice without another Agent turn',()=>{
  const start=talk.indexOf('async function resolveStructuredTimetableMemoTurn');
  const end=talk.indexOf('function isSafeMakeupClarification',start);
  const block=talk.slice(start,end);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
  assert.match(block,/mode:'structured_memo_prepare'/);
});

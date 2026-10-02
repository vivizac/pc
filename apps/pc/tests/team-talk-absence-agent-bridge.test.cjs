const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC absence candidate uses shared absence parser and requires a named student',()=>{
  const start=talk.indexOf('function parseAbsenceAgentCandidate');
  const end=talk.indexOf('function isClassOnceAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseAbsenceMutationIntent\(commandText\)/);
  assert.match(block,/=== 'mark_absent'/);
  assert.match(block,/parsed\?\.studentName/);
  assert.doesNotMatch(block,/prepareAction|parseMakeupMutationIntent/);
});

test('PC inline absence reason routes directly to source-bound Agent — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'absence'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);
  assert.match(ai,/__absenceAgent/);
});
test('PC two-turn absence keeps existing reason prompt then uses Agent for the second message',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  assert.match(block,/pendingPayload\.__absenceAgent/);
  assert.match(block,/const pendingAbsence = state\.pendingActionReason\.__absenceAgent/);
  assert.match(block,/return resolveAbsenceAgentTurn\(\{/);
  assert.match(block,/reasonText:clean\(commandText\)/);
  assert.match(block,/reasonMessageId:Number\(replyToMessageId \|\| 0\)/);
});

test('PC absence resolver binds both messages and never stores a second action client-side',()=>{
  const start=talk.indexOf('async function resolveAbsenceAgentTurn');
  const end=talk.indexOf('async function resolveClassOnceAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'absence_prepare'/);
  assert.match(block,/sourceMessageId:sourceId/);
  assert.match(block,/reasonMessageId:reasonId/);
  assert.match(block,/reasonMessageText:clean\(reasonMessageText\)/);
  assert.match(block,/reason:clean\(reasonText\)/);
  assert.match(block,/action_type\) !== 'mark_absent'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from absence Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveAbsenceAgentTurn|parseAbsenceAgentCandidate|absence_prepare/);
});

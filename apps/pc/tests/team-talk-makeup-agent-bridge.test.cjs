const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const talk = fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC AI makeup add is routed before legacy action preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'makeup_add'/);
  assert.match(dispatch,/case 'makeup_cancel'/);
  assert.match(dispatch,/case 'makeup_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);
  assert.match(ai,/__makeupCancelAgent/);
});
test('PC makeup Agent gate uses shared add_makeup parser only as candidate detection', () => {
  assert.match(talk,/parseMakeupMutationIntent\(commandText\)/);
  const start=talk.indexOf('function isMakeupAddAgentCandidate');
  const end=talk.indexOf('function parseMakeupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/=== 'add_makeup'/);
  assert.doesNotMatch(block,/parseMakeupCancelMutationIntent|cancel_makeup|update_makeup/);
});

test('PC makeup bridge uses source message id and shared Agent response handler', () => {
  const start=talk.indexOf('async function resolveMakeupAddAgentTurn');
  const end=talk.indexOf('async function resolveMakeupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  const helperStart=talk.indexOf('async function resolveMakeupAgentResponse');
  const helperEnd=talk.indexOf('async function resolveMakeupAddAgentTurn',helperStart);
  const helper=talk.slice(helperStart,helperEnd);
  assert.match(block,/mode:'makeup_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/return resolveMakeupAgentResponse/);
  assert.match(helper,/action_type\) !== 'add_makeup'/);
  assert.match(helper,/assistantMessage:data\.message/);
  assert.match(helper,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC bot path remains independent from makeup Agent production routing', () => {
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveMakeupAddAgentTurn|resolveMakeupCancelAgentTurn|resolveMakeupUpdateAgentTurn|isMakeupAddAgentCandidate|isMakeupCancelAgentCandidate|isMakeupUpdateAgentCandidate|makeup_prepare|makeup_cancel_prepare|makeup_update_prepare/);
});


test('PC makeup cancel preserves inline and two-turn reason Agent routing — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'makeup_add'/);
  assert.match(dispatch,/case 'makeup_cancel'/);
  assert.match(dispatch,/case 'makeup_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);
  assert.match(ai,/__makeupCancelAgent/);
});
test('PC makeup cancel Agent gate uses only the shared cancel parser as candidate detection', () => {
  const start=talk.indexOf('function parseMakeupCancelAgentCandidate');
  const end=talk.indexOf('function isMakeupUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMakeupCancelMutationIntent\(commandText\)/);
  assert.match(block,/=== 'cancel_makeup'/);
  assert.doesNotMatch(block,/parseMakeupMutationIntent|add_makeup|update_makeup/);
});

test('PC makeup cancel bridge binds command and reason messages to server Agent', () => {
  const start=talk.indexOf('async function resolveMakeupCancelAgentTurn');
  const end=talk.indexOf('async function resolveMakeupUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'makeup_cancel_prepare'/);
  assert.match(block,/sourceMessageId:sourceId/);
  assert.match(block,/reasonMessageId:reasonId/);
  assert.match(block,/reasonMessageText:clean\(reasonMessageText\)/);
  assert.match(block,/reason:clean\(reasonText\)/);
  assert.match(block,/action_type\) !== 'cancel_makeup'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});


test('PC AI makeup update is routed before legacy action preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'makeup_add'/);
  assert.match(dispatch,/case 'makeup_cancel'/);
  assert.match(dispatch,/case 'makeup_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);
  assert.match(ai,/__makeupCancelAgent/);
});
test('PC makeup update gate uses only shared update parser as candidate detection', () => {
  const start=talk.indexOf('function isMakeupUpdateAgentCandidate');
  const end=talk.indexOf('function isPickupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMakeupUpdateMutationIntent\(commandText\)/);
  assert.match(block,/=== 'update_makeup'/);
  assert.doesNotMatch(block,/parseMakeupMutationIntent|parseMakeupCancelMutationIntent|add_makeup|cancel_makeup/);
});

test('PC makeup update bridge uses source message id and server-persisted update action', () => {
  const start=talk.indexOf('async function resolveMakeupUpdateAgentTurn');
  const end=talk.indexOf('async function resolvePickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'makeup_update_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'update_makeup'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});


test('PC makeup clarification and blocked outcomes remain in contextual continuation', () => {
  assert.match(talk,/pendingMakeupDialogue/);
  assert.match(talk,/\['needs_clarification','blocked'\]\.includes\(interactionStatus\)/);
  assert.match(talk,/state\.pendingMakeupDialogue=\{ active:true, status:interactionStatus, prompt:aiReply \};/);
  assert.match(talk,/mode:'context_makeup_prepare'/);
  assert.match(talk,/conversation:state\.aiConversationMessages\.map/);
  assert.match(talk,/resolveContextualMakeupTurn/);
});


test('PC pending makeup dialogue owns the next turn until explicit cancellation', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('if (state.pendingActionReason)',start);
  const block=talk.slice(start,end);
  assert.match(block,/if \(state\.pendingMakeupDialogue\)/);
  assert.match(block,/isPendingReasonCancel\(commandText\)/);
  assert.match(block,/보강 등록 준비를 취소했어요/);

  const contextStart=talk.indexOf('async function resolveContextualMakeupTurn');
  const contextEnd=talk.indexOf('async function resolveContextualReadTurn',contextStart);
  const contextBlock=talk.slice(contextStart,contextEnd);
  assert.match(contextBlock,/data\?\.handled!==true/);
  assert.match(contextBlock,/보강 등록을 이어서 진행 중이에요/);
  assert.doesNotMatch(contextBlock,/data\?\.handled!==true\)[\s\S]{0,120}state\.pendingMakeupDialogue=null/);
});

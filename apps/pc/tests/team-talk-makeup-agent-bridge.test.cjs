const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const talk = fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC AI makeup add is routed before legacy action preparation', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const makeup=block.indexOf('if (isMakeupAddAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(makeup>=0);
  assert.ok(legacy>makeup);
  assert.match(block,/return resolveMakeupAddAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC makeup Agent gate uses shared add_makeup parser only as candidate detection', () => {
  assert.match(talk,/parseMakeupMutationIntent\(commandText\)/);
  const start=talk.indexOf('function isMakeupAddAgentCandidate');
  const end=talk.indexOf('function parseMakeupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/=== 'add_makeup'/);
  assert.doesNotMatch(block,/parseMakeupCancelMutationIntent|cancel_makeup|update_makeup/);
});

test('PC makeup bridge uses source message id and consumes server-persisted action directly', () => {
  const start=talk.indexOf('async function resolveMakeupAddAgentTurn');
  const end=talk.indexOf('async function resolveMakeupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'makeup_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'add_makeup'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC bot path remains independent from makeup Agent production routing', () => {
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveMakeupAddAgentTurn|resolveMakeupCancelAgentTurn|resolveMakeupUpdateAgentTurn|isMakeupAddAgentCandidate|isMakeupCancelAgentCandidate|isMakeupUpdateAgentCandidate|makeup_prepare|makeup_cancel_prepare|makeup_update_prepare/);
});


test('PC makeup cancel preserves inline and two-turn reason Agent routing', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  assert.match(block,/const makeupCancelCandidate = parseMakeupCancelAgentCandidate/);
  assert.match(block,/clean\(makeupCancelCandidate\.reason\)/);
  assert.match(block,/pendingPayload\.__makeupCancelAgent/);
  assert.match(block,/const pendingMakeupCancel = state\.pendingActionReason\.__makeupCancelAgent/);
  assert.match(block,/return resolveMakeupCancelAgentTurn\(\{/);
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


test('PC AI makeup update is routed before legacy action preparation', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const update=block.indexOf('if (isMakeupUpdateAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(update>=0);
  assert.ok(legacy>update);
  assert.match(block,/return resolveMakeupUpdateAgentTurn\(commandText, current, replyToMessageId\)/);
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

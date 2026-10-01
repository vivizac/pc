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
  const end=talk.indexOf('function isPickupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/=== 'add_makeup'/);
  assert.doesNotMatch(block,/parseMakeupCancelMutationIntent|cancel_makeup|update_makeup/);
});

test('PC makeup bridge uses source message id and consumes server-persisted action directly', () => {
  const start=talk.indexOf('async function resolveMakeupAddAgentTurn');
  const end=talk.indexOf('async function resolvePickupCancelAgentTurn',start);
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
  assert.doesNotMatch(block,/resolveMakeupAddAgentTurn|isMakeupAddAgentCandidate|makeup_prepare/);
});

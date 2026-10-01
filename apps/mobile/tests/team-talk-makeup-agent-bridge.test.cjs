const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const talk = fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile AI makeup add is routed before legacy action preparation', () => {
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const makeup=block.indexOf('if(isOlliTalkMakeupAddAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(makeup>=0);
  assert.ok(legacy>makeup);
  assert.match(block,/return resolveOlliTalkMakeupAddAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile makeup Agent gate uses shared add_makeup parser only as candidate detection', () => {
  assert.match(talk,/parseMakeupMutationIntent\(commandText\)/);
  const start=talk.indexOf('function isOlliTalkMakeupAddAgentCandidate');
  const end=talk.indexOf('function isOlliTalkMakeupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/==='add_makeup'/);
  assert.doesNotMatch(block,/parseMakeupCancelMutationIntent|cancel_makeup|update_makeup/);
});

test('mobile makeup bridge uses source message id and consumes server-persisted action directly', () => {
  const start=talk.indexOf('async function resolveOlliTalkMakeupAddAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMakeupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'makeup_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='add_makeup'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile bot path remains independent from makeup Agent production routing', () => {
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkMakeupAddAgentTurn|resolveOlliTalkMakeupCancelAgentTurn|isOlliTalkMakeupAddAgentCandidate|isOlliTalkMakeupCancelAgentCandidate|makeup_prepare|makeup_cancel_prepare/);
});


test('mobile AI makeup cancel is routed before legacy action preparation', () => {
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const makeupCancel=block.indexOf('if(isOlliTalkMakeupCancelAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(makeupCancel>=0);
  assert.ok(legacy>makeupCancel);
  assert.match(block,/return resolveOlliTalkMakeupCancelAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile makeup cancel Agent gate uses only the shared cancel parser as candidate detection', () => {
  const start=talk.indexOf('function isOlliTalkMakeupCancelAgentCandidate');
  const end=talk.indexOf('function isOlliTalkPickupCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMakeupCancelMutationIntent\(commandText\)/);
  assert.match(block,/==='cancel_makeup'/);
  assert.doesNotMatch(block,/parseMakeupMutationIntent|add_makeup|update_makeup/);
});

test('mobile makeup cancel bridge uses source message id and consumes the server-persisted cancel action directly', () => {
  const start=talk.indexOf('async function resolveOlliTalkMakeupCancelAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkPickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'makeup_cancel_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='cancel_makeup'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

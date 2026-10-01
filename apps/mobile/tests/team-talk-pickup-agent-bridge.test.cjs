const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('olli-talk-beta.js', 'utf8');

test('mobile AI pickup add is routed before the legacy action path', () => {
  const start = talk.indexOf('async function resolveOlliTalkAiTurn');
  const end = talk.indexOf('function getOlliTalkMentionMessageText', start);
  const block = talk.slice(start, end);
  const agentGate = block.indexOf('if(isOlliTalkPickupAddAgentCandidate(commandText,router))');
  const legacyGate = block.indexOf("if(router && typeof router.prepareAction==='function')");

  assert.ok(start >= 0 && end > start);
  assert.ok(agentGate >= 0);
  assert.ok(legacyGate > agentGate);
  assert.match(block, /return resolveOlliTalkPickupAddAgentTurn/);
});

test('mobile pickup bridge reuses the shared pickup parser', () => {
  assert.match(talk, /parsePickupMutationIntent\(commandText\)/);
});


test('mobile pickup Agent uses the saved message id and returns the persisted action message', () => {
  const start = talk.indexOf('async function resolveOlliTalkPickupAddAgentTurn');
  const end = talk.indexOf('async function saveOlliTalkOlliReply', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_prepare'/);
  assert.match(block, /sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
});

test('mobile bot path remains independent from the pickup Agent bridge', () => {
  const start = talk.indexOf('async function resolveOlliTalkBotTurn');
  const end = talk.indexOf('function handleOlliTalkAiModeChanged', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolveOlliTalkPickupAddAgentTurn|isOlliTalkPickupAddAgentCandidate/);
});


test('mobile AI pickup update is routed before add and legacy action paths', () => {
  const start = talk.indexOf('async function resolveOlliTalkAiTurn');
  const end = talk.indexOf('function getOlliTalkMentionMessageText', start);
  const block = talk.slice(start, end);
  const updateGate = block.indexOf('if(isOlliTalkPickupUpdateAgentCandidate(commandText,router))');
  const addGate = block.indexOf('if(isOlliTalkPickupAddAgentCandidate(commandText,router))');
  const legacyGate = block.indexOf("if(router && typeof router.prepareAction==='function')");

  assert.ok(updateGate >= 0);
  assert.ok(addGate > updateGate);
  assert.ok(legacyGate > addGate);
  assert.match(block, /return resolveOlliTalkPickupUpdateAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile pickup update bridge uses shared update parser and persisted production action', () => {
  assert.match(talk, /parsePickupUpdateMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolveOlliTalkPickupUpdateAgentTurn');
  const end = talk.indexOf('async function resolveOlliTalkPickupAddAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_update_prepare'/);
  assert.match(block, /sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /update_pickup_arrival/);
  assert.match(block, /update_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveOlliTalkOlliReply|saveOlliTalkActionReply|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('mobile bot path remains independent from pickup update Agent bridge', () => {
  const start = talk.indexOf('async function resolveOlliTalkBotTurn');
  const end = talk.indexOf('function handleOlliTalkAiModeChanged', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolveOlliTalkPickupUpdateAgentTurn|isOlliTalkPickupUpdateAgentCandidate|pickup_update_prepare/);
});

test('mobile AI pickup cancel is routed before update, add and legacy action paths', () => {
  const start = talk.indexOf('async function resolveOlliTalkAiTurn');
  const end = talk.indexOf('function getOlliTalkMentionMessageText', start);
  const block = talk.slice(start, end);
  const cancelGate = block.indexOf('if(isOlliTalkPickupCancelAgentCandidate(commandText,router))');
  const updateGate = block.indexOf('if(isOlliTalkPickupUpdateAgentCandidate(commandText,router))');
  const addGate = block.indexOf('if(isOlliTalkPickupAddAgentCandidate(commandText,router))');
  const legacyGate = block.indexOf("if(router && typeof router.prepareAction==='function')");

  assert.ok(cancelGate >= 0);
  assert.ok(updateGate > cancelGate);
  assert.ok(addGate > updateGate);
  assert.ok(legacyGate > addGate);
  assert.match(block, /return resolveOlliTalkPickupCancelAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile pickup cancel bridge uses shared cancel parser and persisted production action', () => {
  assert.match(talk, /parsePickupCancelMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolveOlliTalkPickupCancelAgentTurn');
  const end = talk.indexOf('async function resolveOlliTalkPickupUpdateAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_cancel_prepare'/);
  assert.match(block, /sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /cancel_pickup/);
  assert.match(block, /cancel_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveOlliTalkOlliReply|saveOlliTalkActionReply|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('mobile bot path remains independent from pickup cancel Agent bridge', () => {
  const start = talk.indexOf('async function resolveOlliTalkBotTurn');
  const end = talk.indexOf('function handleOlliTalkAiModeChanged', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolveOlliTalkPickupCancelAgentTurn|isOlliTalkPickupCancelAgentCandidate|pickup_cancel_prepare/);
});


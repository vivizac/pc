const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('pc-team-talk.js', 'utf8');

test('PC AI pickup add is routed before the legacy action path', () => {
  const start = talk.indexOf('async function resolveAiTurn');
  const end = talk.indexOf('function updateComposerState', start);
  const block = talk.slice(start, end);
  const agentGate = block.indexOf('if (isPickupAddAgentCandidate(commandText, router))');
  const legacyGate = block.indexOf("if (router && typeof router.prepareAction === 'function')");

  assert.ok(start >= 0 && end > start);
  assert.ok(agentGate >= 0);
  assert.ok(legacyGate > agentGate);
  assert.match(block, /return resolvePickupAddAgentTurn/);
});

test('PC pickup bridge reuses the shared pickup parser', () => {
  assert.match(talk, /parsePickupMutationIntent\(commandText\)/);
});


test('PC pickup Agent uses the saved message id and returns the persisted action message', () => {
  const start = talk.indexOf('async function resolvePickupAddAgentTurn');
  const end = talk.indexOf('async function saveAssistantReply', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
});

test('PC bot path remains independent from the pickup Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupAddAgentTurn|isPickupAddAgentCandidate/);
});


test('PC AI pickup update is routed before add and legacy action paths', () => {
  const start = talk.indexOf('async function resolveAiTurn');
  const end = talk.indexOf('function updateComposerState', start);
  const block = talk.slice(start, end);
  const updateGate = block.indexOf('if (isPickupUpdateAgentCandidate(commandText, router))');
  const addGate = block.indexOf('if (isPickupAddAgentCandidate(commandText, router))');
  const legacyGate = block.indexOf("if (router && typeof router.prepareAction === 'function')");

  assert.ok(updateGate >= 0);
  assert.ok(addGate > updateGate);
  assert.ok(legacyGate > addGate);
  assert.match(block, /return resolvePickupUpdateAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC pickup update bridge uses shared update parser and persisted production action', () => {
  assert.match(talk, /parsePickupUpdateMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolvePickupUpdateAgentTurn');
  const end = talk.indexOf('async function resolvePickupAddAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_update_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /update_pickup_arrival/);
  assert.match(block, /update_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveAssistantReply|saveAssistantAction|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('PC bot path remains independent from pickup update Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupUpdateAgentTurn|isPickupUpdateAgentCandidate|pickup_update_prepare/);
});

test('PC AI pickup cancel is routed before update, add and legacy action paths', () => {
  const start = talk.indexOf('async function resolveAiTurn');
  const end = talk.indexOf('function updateComposerState', start);
  const block = talk.slice(start, end);
  const cancelGate = block.indexOf('if (isPickupCancelAgentCandidate(commandText, router))');
  const updateGate = block.indexOf('if (isPickupUpdateAgentCandidate(commandText, router))');
  const addGate = block.indexOf('if (isPickupAddAgentCandidate(commandText, router))');
  const legacyGate = block.indexOf("if (router && typeof router.prepareAction === 'function')");

  assert.ok(cancelGate >= 0);
  assert.ok(updateGate > cancelGate);
  assert.ok(addGate > updateGate);
  assert.ok(legacyGate > addGate);
  assert.match(block, /return resolvePickupCancelAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC pickup cancel bridge uses shared cancel parser and persisted production action', () => {
  assert.match(talk, /parsePickupCancelMutationIntent\(commandText\)/);

  const start = talk.indexOf('async function resolvePickupCancelAgentTurn');
  const end = talk.indexOf('async function resolvePickupUpdateAgentTurn', start);
  const block = talk.slice(start, end);

  assert.match(block, /mode:'pickup_cancel_prepare'/);
  assert.match(block, /sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block, /cancel_pickup/);
  assert.match(block, /cancel_pickup_dropoff/);
  assert.match(block, /assistantMessage:data\.message/);
  assert.match(block, /recordAi:false/);
  assert.doesNotMatch(block, /saveAssistantReply|saveAssistantAction|olli_team_chat_send_ai|olli_team_chat_send_action/);
});

test('PC bot path remains independent from pickup cancel Agent bridge', () => {
  const start = talk.indexOf('async function resolveBotTurn');
  const end = talk.indexOf('function buildAiConversationMessages', start);
  const block = talk.slice(start, end);

  assert.doesNotMatch(block, /resolvePickupCancelAgentTurn|isPickupCancelAgentCandidate|pickup_cancel_prepare/);
});


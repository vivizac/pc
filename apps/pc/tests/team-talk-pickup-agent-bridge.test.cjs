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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const talk = fs.readFileSync('apps/pc/pc-team-talk.js', 'utf8');

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

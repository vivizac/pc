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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const talk = fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC waitlist cancel gate uses only the shared cancel parser', () => {
  const start=talk.indexOf('function isWaitlistCancelAgentCandidate');
  const end=talk.indexOf('function isMakeupAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistCancelMutationIntent\(commandText\)/);
  assert.match(block,/=== 'cancel_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistMutationIntent|add_waitlist|update_waitlist/);
});

test('PC registered waitlist cancel is routed before legacy preparation', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const waitlist=block.indexOf('if (isWaitlistCancelAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(waitlist>=0);
  assert.ok(legacy>waitlist);
  assert.match(block,/const waitlistTurn = await resolveWaitlistCancelAgentTurn/);
  assert.match(block,/if \(waitlistTurn\) return waitlistTurn/);
});

test('PC waitlist cancel bridge uses source-bound production mode and guest fallback code', () => {
  const start=talk.indexOf('async function resolveWaitlistCancelAgentTurn');
  const end=talk.indexOf('async function resolvePickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_cancel_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
  assert.match(block,/return null/);
  assert.match(block,/action_type\) !== 'cancel_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from waitlist Agent production routing', () => {
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveWaitlistCancelAgentTurn|isWaitlistCancelAgentCandidate|waitlist_cancel_prepare/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC waitlist add gate uses only shared add parser',()=>{
  const start=talk.indexOf('function isWaitlistAddAgentCandidate');
  const end=talk.indexOf('function isWaitlistUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistMutationIntent\(commandText\)/);
  assert.match(block,/=== 'add_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistUpdateMutationIntent|parseWaitlistCancelMutationIntent|parseWriteIntent|prepareAction/);
});

test('PC waitlist add routes before update cancel and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const add=block.indexOf('if (isWaitlistAddAgentCandidate(commandText, router))');
  const update=block.indexOf('if (isWaitlistUpdateAgentCandidate(commandText, router))');
  const cancel=block.indexOf('if (isWaitlistCancelAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(add>=0);
  assert.ok(update>add);
  assert.ok(cancel>update);
  assert.ok(legacy>cancel);
  assert.match(block,/const waitlistAddTurn = await resolveWaitlistAddAgentTurn/);
  assert.match(block,/if \(waitlistAddTurn\) return waitlistAddTurn/);
});

test('PC waitlist add bridge uses source-bound production and guest fallback to legacy',()=>{
  const start=talk.indexOf('async function resolveWaitlistAddAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_add_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
  assert.match(block,/return null/);
  assert.match(block,/action_type\) !== 'add_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from waitlist add Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveWaitlistAddAgentTurn|isWaitlistAddAgentCandidate|waitlist_add_prepare/);
});

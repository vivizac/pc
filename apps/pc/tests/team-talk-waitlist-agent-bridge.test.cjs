const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const talk = fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');


test('PC waitlist update gate uses only the shared update candidate parser', () => {
  const start=talk.indexOf('function isWaitlistUpdateAgentCandidate');
  const end=talk.indexOf('function isWaitlistCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistUpdateMutationIntent\(commandText\)/);
  assert.match(block,/=== 'update_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistMutationIntent|parseWriteIntent|add_waitlist|cancel_waitlist/);
});

test('PC registered waitlist update is routed before cancel and legacy preparation', () => {
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const update=block.indexOf('if (isWaitlistUpdateAgentCandidate(commandText, router))');
  const cancel=block.indexOf('if (isWaitlistCancelAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(update>=0);
  assert.ok(cancel>update);
  assert.ok(legacy>cancel);
  assert.match(block,/return resolveWaitlistUpdateAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC waitlist update bridge uses source-bound production mode and never saves a second action card', () => {
  const start=talk.indexOf('async function resolveWaitlistUpdateAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_update_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'update_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC waitlist update guest remains on the same source-bound Agent bridge', () => {
  const start=talk.indexOf('async function resolveWaitlistUpdateAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_update_prepare'/);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|비재원 대기 변경은 현재 Team Chat에서 지원하지 않아요/);
});

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
  assert.doesNotMatch(block,/resolveWaitlistUpdateAgentTurn|isWaitlistUpdateAgentCandidate|waitlist_update_prepare|resolveWaitlistCancelAgentTurn|isWaitlistCancelAgentCandidate|waitlist_cancel_prepare/);
});

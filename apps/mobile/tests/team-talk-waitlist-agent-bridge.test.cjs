const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const talk = fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');
const commonRouter = fs.readFileSync(path.resolve(__dirname,'../../../packages/common/olli-command-router-common.js'),'utf8');

test('mobile waitlist cancel gate uses the shared cancel parser only', () => {
  const start=talk.indexOf('function isOlliTalkWaitlistCancelAgentCandidate');
  const end=talk.indexOf('function isOlliTalkMakeupAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistCancelMutationIntent\(commandText\)/);
  assert.match(block,/==='cancel_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistMutationIntent|add_waitlist|update_waitlist/);
});

test('mobile registered waitlist cancel is routed before legacy preparation', () => {
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const waitlist=block.indexOf('if(isOlliTalkWaitlistCancelAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(waitlist>=0);
  assert.ok(legacy>waitlist);
  assert.match(block,/const waitlistTurn=await resolveOlliTalkWaitlistCancelAgentTurn/);
  assert.match(block,/if\(waitlistTurn\) return waitlistTurn/);
});

test('mobile waitlist cancel bridge uses source-bound production mode and guest fallback code', () => {
  const start=talk.indexOf('async function resolveOlliTalkWaitlistCancelAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkPickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_cancel_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED/);
  assert.match(block,/return null/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='cancel_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile guest fallback preserves the legacy cancel_waitlist parser path', () => {
  const sandbox={window:{},console};
  vm.runInNewContext(commonRouter,sandbox);
  const router=sandbox.window.OlliCommandRouter;
  const command='비재원A 금요일 4시 대기 취소해줘';
  assert.equal(router.parseWaitlistCancelMutationIntent(command)?.intent,'cancel_waitlist');
  assert.equal(router.parseWaitlistCancelMutationIntent(command)?.studentName,'비재원A');
  assert.equal(router.parseWriteIntent(command)?.intent,'cancel_waitlist');
});

test('mobile Bot path remains independent from waitlist Agent production routing', () => {
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkWaitlistCancelAgentTurn|isOlliTalkWaitlistCancelAgentCandidate|waitlist_cancel_prepare/);
});

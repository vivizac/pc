const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile waitlist add gate uses only shared add parser',()=>{
  const start=talk.indexOf('function isOlliTalkWaitlistAddAgentCandidate');
  const end=talk.indexOf('function isOlliTalkWaitlistUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistMutationIntent\(commandText\)/);
  assert.match(block,/==='add_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistUpdateMutationIntent|parseWriteIntent|prepareAction/);
});

test('mobile waitlist add routes before update and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const add=block.indexOf('if(isOlliTalkWaitlistAddAgentCandidate(commandText,router))');
  const update=block.indexOf('if(isOlliTalkWaitlistUpdateAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(add>=0);
  assert.ok(update>add);
  assert.ok(legacy>update);
  assert.match(block,/const waitlistAddTurn=await resolveOlliTalkWaitlistAddAgentTurn/);
  assert.match(block,/if\(waitlistAddTurn\) return waitlistAddTurn/);
});

test('mobile waitlist add bridge keeps registered and guest requests on source-bound Agent production',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistAddAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_add_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|return null/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='add_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from waitlist add Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkWaitlistAddAgentTurn|isOlliTalkWaitlistAddAgentCandidate|waitlist_add_prepare/);
});

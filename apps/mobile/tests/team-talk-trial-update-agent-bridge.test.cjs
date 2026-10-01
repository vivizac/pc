const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile trial update gate uses only shared trial update candidate parser',()=>{
  const start=talk.indexOf('function isOlliTalkTrialUpdateAgentCandidate');
  const end=talk.indexOf('function isOlliTalkWaitlistAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialUpdateMutationIntent\(commandText\)/);
  assert.match(block,/==='update_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|cancel_trial/);
});

test('mobile trial update routes before waitlist and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const trial=block.indexOf('if(isOlliTalkTrialUpdateAgentCandidate(commandText,router))');
  const wait=block.indexOf('if(isOlliTalkWaitlistUpdateAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(trial>=0);
  assert.ok(wait>trial);
  assert.ok(legacy>wait);
  assert.match(block,/return resolveOlliTalkTrialUpdateAgentTurn\(commandText,context,replyToMessageId\)/);
});

test('mobile trial update uses source-bound production mode and server-persisted card',()=>{
  const start=talk.indexOf('async function resolveOlliTalkTrialUpdateAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkWaitlistAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_update_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='update_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path is independent from trial update Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkTrialUpdateAgentTurn|isOlliTalkTrialUpdateAgentCandidate|trial_update_prepare/);
});

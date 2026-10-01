const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile trial cancel candidate uses only shared trial cancel parser',()=>{
  const start=talk.indexOf('function parseOlliTalkTrialCancelAgentCandidate');
  const end=talk.indexOf('function isOlliTalkTrialUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialCancelMutationIntent\(commandText\)/);
  assert.match(block,/==='cancel_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|update_trial/);
});

test('mobile inline trial cancel reason routes directly to source-bound Agent',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const cancel=block.indexOf('const trialCancelCandidate=parseOlliTalkTrialCancelAgentCandidate');
  const add=block.indexOf('if(isOlliTalkTrialAddAgentCandidate(commandText,router))');
  const legacy=block.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(cancel>=0);
  assert.ok(add>cancel);
  assert.ok(legacy>add);
  assert.match(block,/reasonText:String\(trialCancelCandidate\.reason \|\| ''\)\.trim\(\)/);
});

test('mobile two-turn trial cancellation preserves reason prompt then uses Agent on second message',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  assert.match(block,/pendingPayload\.__trialCancelAgent/);
  assert.match(block,/sourceMessageText:String\(commandText \|\| ''\)\.trim\(\)/);
  assert.match(block,/const pendingTrialCancel=olliTalkPendingActionReason\.__trialCancelAgent/);
  assert.match(block,/return resolveOlliTalkTrialCancelAgentTurn\(\{/);
  assert.match(block,/reasonMessageId:Number\(replyToMessageId \|\| 0\)/);
});

test('mobile trial cancel resolver binds both saved messages and never saves a second card client-side',()=>{
  const start=talk.indexOf('async function resolveOlliTalkTrialCancelAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkTrialUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_cancel_prepare'/);
  assert.match(block,/sourceMessageId:sourceId/);
  assert.match(block,/reasonMessageId:reasonId/);
  assert.match(block,/reasonMessageText:String\(reasonMessageText \|\| ''\)\.trim\(\)/);
  assert.match(block,/reason:String\(reasonText \|\| ''\)\.trim\(\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='cancel_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from trial cancel Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkTrialCancelAgentTurn|parseOlliTalkTrialCancelAgentCandidate|trial_cancel_prepare/);
});

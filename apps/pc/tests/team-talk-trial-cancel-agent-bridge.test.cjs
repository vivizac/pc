const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial cancel candidate uses only shared trial cancel parser',()=>{
  const start=talk.indexOf('function parseTrialCancelAgentCandidate');
  const end=talk.indexOf('function isTrialUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialCancelMutationIntent\(commandText\)/);
  assert.match(block,/=== 'cancel_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|update_trial/);
});

test('PC inline trial cancel reason routes directly to source-bound Agent',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const cancel=block.indexOf('const trialCancelCandidate = parseTrialCancelAgentCandidate');
  const add=block.indexOf('if (isTrialAddAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(cancel>=0);
  assert.ok(add>cancel);
  assert.ok(legacy>add);
  assert.match(block,/reasonText:clean\(trialCancelCandidate\.reason\)/);
  assert.match(block,/reasonMessageId:Number\(replyToMessageId \|\| 0\)/);
});

test('PC two-turn trial cancellation preserves reason prompt then uses Agent on second message',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  assert.match(block,/pendingPayload\.__trialCancelAgent/);
  assert.match(block,/sourceMessageText:clean\(commandText\)/);
  assert.match(block,/const pendingTrialCancel = state\.pendingActionReason\.__trialCancelAgent/);
  assert.match(block,/return resolveTrialCancelAgentTurn\(\{/);
  assert.match(block,/reasonMessageId:Number\(replyToMessageId \|\| 0\)/);
});

test('PC trial cancel resolver sends command and reason message bindings and never saves a second card client-side',()=>{
  const start=talk.indexOf('async function resolveTrialCancelAgentTurn');
  const end=talk.indexOf('async function resolveTrialUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_cancel_prepare'/);
  assert.match(block,/sourceMessageId:sourceId/);
  assert.match(block,/reasonMessageId:reasonId/);
  assert.match(block,/reasonMessageText:clean\(reasonMessageText\)/);
  assert.match(block,/reason:clean\(reasonText\)/);
  assert.match(block,/action_type\) !== 'cancel_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from trial cancel Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveTrialCancelAgentTurn|parseTrialCancelAgentCandidate|trial_cancel_prepare/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial cancel candidate uses only shared trial cancel parser',()=>{
  const start=talk.indexOf('function parseTrialCancelAgentCandidate');
  const end=talk.indexOf('function parseAbsenceAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialCancelMutationIntent\(commandText\)/);
  assert.match(block,/=== 'cancel_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|update_trial/);
});

test('PC trial cancel legacy reason compatibility stays outside the shared Agent switch', () => {
  const dispatch=talk.slice(talk.indexOf('async function resolveSharedAgentRouteTurn'),talk.indexOf('async function resolveAiTurn'));
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.doesNotMatch(dispatch,/case 'trial_cancel'/);
  assert.match(ai,/__trialCancelAgent/);
  assert.match(ai,/resolveTrialCancelAgentTurn/);
  const classify=ai.indexOf('const routeClassifier=');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);
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
  const end=talk.indexOf('async function resolveStructuredWaitlistUpdateTurn',start);
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

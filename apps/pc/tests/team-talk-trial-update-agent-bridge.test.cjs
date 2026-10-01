const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial update gate uses only shared trial update candidate parser',()=>{
  const start=talk.indexOf('function isTrialUpdateAgentCandidate');
  const end=talk.indexOf('function isWaitlistUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialUpdateMutationIntent\(commandText\)/);
  assert.match(block,/=== 'update_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|cancel_trial/);
});

test('PC trial update routes before waitlist and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const trial=block.indexOf('if (isTrialUpdateAgentCandidate(commandText, router))');
  const wait=block.indexOf('if (isWaitlistUpdateAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(trial>=0);
  assert.ok(wait>trial);
  assert.ok(legacy>wait);
  assert.match(block,/return resolveTrialUpdateAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC trial update uses source-bound production mode and server-persisted card',()=>{
  const start=talk.indexOf('async function resolveTrialUpdateAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_update_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'update_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path is independent from trial update Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveTrialUpdateAgentTurn|isTrialUpdateAgentCandidate|trial_update_prepare/);
});

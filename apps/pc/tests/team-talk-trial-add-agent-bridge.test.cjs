const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial add gate uses shared add parser and requires explicit division',()=>{
  const start=talk.indexOf('function isTrialAddAgentCandidate');
  const end=talk.indexOf('function isTrialUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialMutationIntent\(commandText\)/);
  assert.match(block,/=== 'add_trial'/);
  assert.match(block,/\['elementary', 'kinder'\]\.includes\(division\)/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|cancel_trial|update_trial/);
});

test('PC trial add routes before trial update and legacy preparation',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const add=block.indexOf('if (isTrialAddAgentCandidate(commandText, router))');
  const update=block.indexOf('if (isTrialUpdateAgentCandidate(commandText, router))');
  const legacy=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(add>=0);
  assert.ok(update>add);
  assert.ok(legacy>update);
  assert.match(block,/return resolveTrialAddAgentTurn\(commandText, current, replyToMessageId\)/);
});

test('PC trial add uses source-bound production mode and server-persisted card',()=>{
  const start=talk.indexOf('async function resolveTrialAddAgentTurn');
  const end=talk.indexOf('async function resolveTrialUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_add_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'add_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from trial add Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveTrialAddAgentTurn|isTrialAddAgentCandidate|trial_add_prepare/);
});

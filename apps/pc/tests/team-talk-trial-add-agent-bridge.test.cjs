const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial add gate uses shared add parser and requires explicit division',()=>{
  const start=talk.indexOf('function isTrialAddAgentCandidate');
  const end=talk.indexOf('function parseTrialCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialMutationIntent\(commandText\)/);
  assert.match(block,/=== 'add_trial'/);
  assert.match(block,/\['elementary', 'kinder'\]\.includes\(division\)/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|cancel_trial|update_trial/);
});

test('PC trial add routes before trial update and legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'trial_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

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

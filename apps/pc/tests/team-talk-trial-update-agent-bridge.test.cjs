const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC trial update gate uses only shared trial update candidate parser',()=>{
  const start=talk.indexOf('function isTrialUpdateAgentCandidate');
  const end=talk.indexOf('function isWaitlistAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialUpdateMutationIntent\(commandText\)/);
  assert.match(block,/=== 'update_trial'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_trial|cancel_trial/);
});

test('PC trial update routes before waitlist and legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'trial_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC trial update uses source-bound production mode and server-persisted card',()=>{
  const start=talk.indexOf('async function resolveTrialUpdateAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistAddAgentTurn',start);
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

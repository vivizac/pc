const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile trial add gate uses shared add parser and requires explicit division',()=>{
  const start=talk.indexOf('function isOlliTalkTrialAddAgentCandidate');
  const end=talk.indexOf('function parseOlliTalkTrialCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseTrialMutationIntent\(commandText\)/);
  assert.match(block,/==='add_trial'/);
  assert.match(block,/\['elementary','kinder'\]\.includes\(division\)/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|cancel_trial|update_trial/);
});

test('mobile trial add routes before trial update and legacy preparation — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'trial_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('mobile trial add uses source-bound production mode and server-persisted card',()=>{
  const start=talk.indexOf('async function resolveOlliTalkTrialAddAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkTrialUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'trial_add_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='add_trial'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from trial add Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkTrialAddAgentTurn|isOlliTalkTrialAddAgentCandidate|trial_add_prepare/);
});

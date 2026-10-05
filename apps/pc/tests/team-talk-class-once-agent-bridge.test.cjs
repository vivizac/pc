const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC class-once gate uses only shared generic class parser',()=>{
  const start=talk.indexOf('function isClassOnceAgentCandidate');
  const end=talk.indexOf('function isMakeupAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseClassMutationIntent\(commandText\)/);
  assert.match(block,/=== 'add_class_once'/);
  assert.doesNotMatch(block,/parseMakeupMutationIntent|parseTrialMutationIntent|parseWaitlistMutationIntent|prepareAction/);
});

test('PC class-once route stays before move/makeup and before legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'class_once'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC class-once bridge uses source-bound production without second action save',()=>{
  const start=talk.indexOf('async function resolveClassOnceAgentTurn');
  const end=talk.indexOf('async function resolveStructuredMoveCancelTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'class_once_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'add_class_once'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from class-once Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveClassOnceAgentTurn|isClassOnceAgentCandidate|class_once_prepare/);
});

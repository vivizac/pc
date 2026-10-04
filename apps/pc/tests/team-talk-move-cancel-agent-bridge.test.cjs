const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC move cancel gate uses only shared cancellation parser',()=>{
  const start=talk.indexOf('function isMoveCancelAgentCandidate');
  const end=talk.indexOf('function isMakeupAddAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMoveCancelMutationIntent\(commandText\)/);
  assert.match(block,/=== 'cancel_move'/);
  assert.doesNotMatch(block,/parseScheduleMoveMutationIntent|prepareAction|move_class/);
});

test('PC move cancel is routed before pickup and legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'move_cancel'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC move cancel bridge uses source-bound production without second action save',()=>{
  const start=talk.indexOf('async function resolveMoveCancelAgentTurn');
  const end=talk.indexOf('async function resolvePickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_cancel_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'cancel_move'/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveStructuredTargetChoice/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from move cancel Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveMoveCancelAgentTurn|isMoveCancelAgentCandidate|move_cancel_prepare/);
});

test('PC move cancel target choice resumes through deterministic structured prepare without another Agent turn',()=>{
  const start=talk.indexOf('async function resolveStructuredMoveCancelTurn');
  const end=talk.indexOf('async function resolvePickupCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_move_cancel_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/move_cancel_prepare'/);
});

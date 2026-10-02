const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC move gate uses only shared move parser',()=>{
  const start=talk.indexOf('function isMoveAgentCandidate');
  const end=talk.indexOf('function isMoveCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseScheduleMoveMutationIntent\(commandText\)/);
  assert.match(block,/=== 'move_class'/);
  assert.doesNotMatch(block,/parseMoveCancelMutationIntent|prepareAction|cancel_move/);
});

test('PC move is routed before move cancel and legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'move'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC move bridge uses source-bound production without client-side second action save',()=>{
  const start=talk.indexOf('async function resolveMoveAgentTurn');
  const end=talk.indexOf('async function resolveMoveCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type\) !== 'move_class'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from move Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveMoveAgentTurn|isMoveAgentCandidate|move_prepare/);
});

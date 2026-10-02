const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile move gate uses only shared move parser',()=>{
  const start=talk.indexOf('function isOlliTalkMoveAgentCandidate');
  const end=talk.indexOf('function isOlliTalkMoveCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseScheduleMoveMutationIntent\(commandText\)/);
  assert.match(block,/==='move_class'/);
  assert.doesNotMatch(block,/parseMoveCancelMutationIntent|prepareAction|cancel_move/);
});

test('mobile move routes before move cancel and legacy preparation — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'move'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('mobile move bridge uses source-bound production without client-side second action save',()=>{
  const start=talk.indexOf('async function resolveOlliTalkMoveAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMoveCancelAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='move_class'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from move Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkMoveAgentTurn|isOlliTalkMoveAgentCandidate|move_prepare/);
});

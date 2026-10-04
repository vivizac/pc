const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile move cancel gate uses only shared cancellation parser',()=>{
  const start=talk.indexOf('function isOlliTalkMoveCancelAgentCandidate');
  const end=talk.indexOf('async function resolveOlliTalkTrialAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseMoveCancelMutationIntent\(commandText\)/);
  assert.match(block,/==='cancel_move'/);
  assert.doesNotMatch(block,/parseScheduleMoveMutationIntent|prepareAction|move_class/);
});

test('mobile move cancel routes before student info and legacy preparation — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'move_cancel'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('mobile move cancel bridge uses source-bound production without second action save',()=>{
  const start=talk.indexOf('async function resolveOlliTalkMoveCancelAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'move_cancel_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='cancel_move'/);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveOlliTalkStructuredTargetChoice/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from move cancel Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkMoveCancelAgentTurn|isOlliTalkMoveCancelAgentCandidate|move_cancel_prepare/);
});

test('mobile move cancel target choice resumes through deterministic structured prepare without another Agent turn',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredMoveCancelTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_move_cancel_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'move_cancel_prepare'/);
});

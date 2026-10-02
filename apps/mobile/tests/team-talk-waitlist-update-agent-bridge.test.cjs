const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile waitlist update gate uses only the shared candidate parser',()=>{
  const start=talk.indexOf('function isOlliTalkWaitlistUpdateAgentCandidate');
  const end=talk.indexOf('function isOlliTalkWaitlistCancelAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistUpdateMutationIntent\(commandText\)/);
  assert.match(block,/==='update_waitlist'/);
  assert.doesNotMatch(block,/parseWriteIntent|prepareAction|add_waitlist|cancel_waitlist/);
});

test('mobile waitlist update is routed before student info and legacy prepareAction — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'waitlist_update'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('mobile waitlist update bridge uses source-bound production mode without creating a second action',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_update_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='update_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.match(block,/recordAi:false/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile guest waitlist update remains on the same source-bound Agent bridge',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn');
  const end=talk.indexOf('function isOlliTalkPendingReasonCancel',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_update_prepare'/);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|비재원 대기 변경은 현재 Team Chat에서 지원하지 않아요/);
});

test('mobile Bot path remains independent from waitlist update Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkWaitlistUpdateAgentTurn|isOlliTalkWaitlistUpdateAgentCandidate|waitlist_update_prepare/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('mobile waitlist add gate uses only shared add parser',()=>{
  const start=talk.indexOf('function isOlliTalkWaitlistAddAgentCandidate');
  const end=talk.indexOf('function isOlliTalkWaitlistUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistMutationIntent\(commandText\)/);
  assert.match(block,/==='add_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistUpdateMutationIntent|parseWriteIntent|prepareAction/);
});

test('mobile waitlist add routes before update and legacy preparation — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'waitlist_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('mobile waitlist add bridge keeps registered and guest requests on source-bound Agent production',()=>{
  const start=talk.indexOf('async function resolveOlliTalkWaitlistAddAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkWaitlistUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_add_prepare'/);
  assert.match(block,/sourceMessageId=Number\(replyToMessageId \|\| 0\)/);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|return null/);
  assert.match(block,/action_type \|\| ''\)\.trim\(\)!=='add_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveOlliTalkActionReply|olli_team_chat_send_action/);
});

test('mobile Bot path remains independent from waitlist add Agent routing',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveOlliTalkWaitlistAddAgentTurn|isOlliTalkWaitlistAddAgentCandidate|waitlist_add_prepare/);
});

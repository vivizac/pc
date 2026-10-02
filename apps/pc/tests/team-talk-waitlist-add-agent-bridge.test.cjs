const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC waitlist add gate uses only shared add parser',()=>{
  const start=talk.indexOf('function isWaitlistAddAgentCandidate');
  const end=talk.indexOf('function isWaitlistUpdateAgentCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseWaitlistMutationIntent\(commandText\)/);
  assert.match(block,/=== 'add_waitlist'/);
  assert.doesNotMatch(block,/parseWaitlistUpdateMutationIntent|parseWaitlistCancelMutationIntent|parseWriteIntent|prepareAction/);
});

test('PC waitlist add routes before update cancel and legacy preparation — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'waitlist_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC waitlist add bridge keeps registered and guest requests on source-bound Agent production',()=>{
  const start=talk.indexOf('async function resolveWaitlistAddAgentTurn');
  const end=talk.indexOf('async function resolveWaitlistUpdateAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'waitlist_add_prepare'/);
  assert.match(block,/sourceMessageId = Number\(replyToMessageId \|\| 0\)/);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|return null/);
  assert.match(block,/action_type\) !== 'add_waitlist'/);
  assert.match(block,/assistantMessage:data\.message/);
  assert.doesNotMatch(block,/saveAssistantAction|olli_team_chat_send_action/);
});

test('PC Bot path remains independent from waitlist add Agent routing',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/resolveWaitlistAddAgentTurn|isWaitlistAddAgentCandidate|waitlist_add_prepare/);
});

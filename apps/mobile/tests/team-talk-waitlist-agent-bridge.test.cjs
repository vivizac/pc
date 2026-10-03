const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile waitlist add update cancel all route through Agent candidates',()=>{
  for(const name of ['isOlliTalkWaitlistAddAgentCandidate','isOlliTalkWaitlistUpdateAgentCandidate','isOlliTalkWaitlistCancelAgentCandidate']) assert.ok(talk.includes(name),name);
});
test('Mobile waitlist cancel keeps registered and guest requests on source-bound production',()=>{
  assert.ok(talk.includes("'waitlist_cancel_prepare'"));
  assert.ok(talk.includes("'structured_waitlist_cancel_prepare'"));
  assert.ok(talk.includes("structuredCommand"));
  const start=talk.indexOf('async function resolveOlliTalkWaitlistCancelAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkMakeupAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/OLLI_AGENT_WAITLIST_REGISTERED_STUDENT_REQUIRED|return null/);
});
test('Mobile waitlist routes occur before legacy prepareAction — shared dispatch contract',()=> {
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
  assert.match(dispatch,/case 'waitlist_update'/);
  assert.match(dispatch,/case 'waitlist_cancel'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
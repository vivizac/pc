const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile pickup add/update/cancel all have Agent candidates',()=>{
  for(const name of ['isOlliTalkPickupAddAgentCandidate','isOlliTalkPickupUpdateAgentCandidate','isOlliTalkPickupCancelAgentCandidate']) assert.ok(talk.includes(name),name);
});
test('Mobile pickup production modes are source-bound',()=>{
  for(const mode of ["mode:'pickup_prepare'","mode:'pickup_update_prepare'","mode:'pickup_cancel_prepare'"]) assert.ok(talk.includes(mode),mode);
  assert.ok(talk.includes('sourceMessageId'));
});
test('Mobile AI routes pickup Agent paths before legacy prepareAction — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'pickup_cancel'/);
  assert.match(dispatch,/case 'pickup_update'/);
  assert.match(dispatch,/case 'pickup_add'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
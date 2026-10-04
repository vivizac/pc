const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile timetable memo add/delete routes through memo_prepare before legacy prepareAction — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_memo'/);
  assert.match(dispatch,/case 'batch_write'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('Mobile timetable memo class choice uses reusable target buttons and deterministic resume',()=>{
  const start=talk.indexOf('async function resolveOlliTalkTimetableMemoAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkTrialAddAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/choiceRequired/);
  assert.match(block,/saveOlliTalkStructuredTargetChoice/);
  assert.match(block,/mode:'structured_memo_prepare'/);
  assert.match(block,/memoNote/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'memo_prepare'[\s\S]*mode:'memo_prepare'/);
});

test('Mobile batch is detected before individual writes and collects reason turns — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_memo'/);
  assert.match(dispatch,/case 'batch_write'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('Mobile batch uses batch_prepare and renders all persisted cards',()=>{
  assert.match(talk,/mode:'batch_prepare'/);
  assert.match(talk,/assistantMessages:messages/);
  assert.match(talk,/assistantMessages\.slice\(1\)\.forEach\(message=>appendOlliTalkPersistedMessage/);
});

test('Mobile batch collects missing makeup date/time after reason turns',()=>{
  assert.match(talk,/function olliTalkBatchCommandNeedsClarification/);
  assert.match(talk,/function olliTalkBatchClarificationPrompt/);
  assert.match(talk,/function applyOlliTalkBatchClarification/);
  assert.match(talk,/보강 날짜와 시간을 함께 알려주세요/);
  assert.match(talk,/clarificationMessageId/);
});

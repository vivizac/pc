const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile timetable read candidate is fixed by shared parseQueryIntent',()=>{
  const start=talk.indexOf('function parseOlliTalkTimetableReadAgentCandidate');
  const end=talk.indexOf('function isOlliTalkStudentAttendanceReadCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseQueryIntent\(commandText\)/);
  for(const intent of ['find_available_slots','find_roster_entries','find_pickups','multi_read_query']){
    assert.match(block,new RegExp(intent));
  }
  assert.doesNotMatch(block,/runQuery|prepareAction/);
});

test('Mobile timetable and student reads run before legacy prepareAction and runQuery — shared dispatch contract',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/window\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_read'/);
  assert.match(dispatch,/case 'attendance_read'/);
  assert.match(dispatch,/case 'pickup_read'/);
  assert.match(dispatch,/case 'schedule_read'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('Mobile read bridge saves only the source-bound Agent answer',()=>{
  const start=talk.indexOf('async function resolveOlliTalkSourceBoundReadAgentTurn');
  const end=talk.indexOf('async function resolveOlliTalkBatchAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/readIntent/);
  assert.match(block,/saveOlliTalkOlliReply\(context,replyText,sourceMessageId\)/);
  assert.match(block,/recordAi:false/);
});

test('Mobile Bot path stays independent from Agent timetable reads',()=>{
  const start=talk.indexOf('async function resolveOlliTalkBotTurn');
  const end=talk.indexOf('function handleOlliTalkAiModeChanged',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/timetable_read|schedule_read|attendance_read|pickup_read|resolveOlliTalkSourceBoundReadAgentTurn/);
});


test('Mobile student schedule uses rule system before Agent dispatch and context AI only normalizes the follow-up',()=>{
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  const ruleIndex=ai.indexOf('resolveOlliTalkRuleStudentScheduleTurn(');
  const classifyIndex=ai.indexOf('routeClassifier.classify(commandText,{router})');
  assert.ok(ruleIndex>=0 && classifyIndex>ruleIndex);

  const helperStart=talk.indexOf('async function resolveOlliTalkContextualRuleStudentScheduleTurn');
  const helperEnd=talk.indexOf('async function resolveOlliTalkContextualReadTurn',helperStart);
  const helper=talk.slice(helperStart,helperEnd);
  assert.match(helper,/mode:'context_resolve'/);
  assert.match(helper,/resolveOlliTalkRuleStudentScheduleTurn/);
  assert.doesNotMatch(helper,/mode:'context_read'/);

  const noRouteBlock=ai.slice(ai.indexOf('if(!sharedRoute && classifierAvailable){'));
  const normalizedIndex=noRouteBlock.indexOf('resolveOlliTalkContextualRuleStudentScheduleTurn');
  const agentContextIndex=noRouteBlock.indexOf('resolveOlliTalkContextualReadTurn');
  assert.ok(normalizedIndex>=0 && agentContextIndex>normalizedIndex);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable read candidate is fixed by shared parseQueryIntent',()=>{
  const start=talk.indexOf('function parseTimetableReadAgentCandidate');
  const end=talk.indexOf('function isStudentAttendanceReadCandidate',start);
  const block=talk.slice(start,end);
  assert.match(block,/parseQueryIntent\(commandText\)/);
  for(const intent of ['find_available_slots','find_roster_entries','find_pickups','multi_read_query']){
    assert.match(block,new RegExp(intent));
  }
  assert.doesNotMatch(block,/runQuery|prepareAction/);
});

test('PC timetable and student reads run before legacy prepareAction and runQuery — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_read'/);
  assert.match(dispatch,/case 'attendance_read'/);
  assert.match(dispatch,/case 'pickup_read'/);
  assert.match(dispatch,/case 'schedule_read'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
test('PC read bridge saves only the source-bound Agent answer',()=>{
  const start=talk.indexOf('async function resolveSourceBoundReadAgentTurn');
  const end=talk.indexOf('async function resolveBatchAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/sourceMessageId/);
  assert.match(block,/readIntent/);
  assert.match(block,/saveAssistantReply\(current,replyText,sourceMessageId\)/);
  assert.match(block,/recordAi:false/);
});

test('PC Bot path stays independent from Agent timetable reads',()=>{
  const start=talk.indexOf('async function resolveBotTurn');
  const end=talk.indexOf('function buildAiConversationMessages',start);
  const block=talk.slice(start,end);
  assert.doesNotMatch(block,/timetable_read|schedule_read|attendance_read|pickup_read|resolveSourceBoundReadAgentTurn/);
});


test('PC student schedule uses rule system before Agent dispatch and context AI only normalizes the follow-up',()=>{
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  const ruleIndex=ai.indexOf('resolveRuleStudentScheduleTurn(');
  const classifyIndex=ai.indexOf('routeClassifier.classify(commandText,{router})');
  assert.ok(ruleIndex>=0 && classifyIndex>ruleIndex);

  const helperStart=talk.indexOf('async function resolveContextualRuleStudentScheduleTurn');
  const helperEnd=talk.indexOf('async function resolveContextualReadTurn',helperStart);
  const helper=talk.slice(helperStart,helperEnd);
  assert.match(helper,/mode:'context_resolve'/);
  assert.match(helper,/resolveRuleStudentScheduleTurn/);
  assert.doesNotMatch(helper,/mode:'context_read'/);

  const noRouteBlock=ai.slice(ai.indexOf('if(!sharedRoute && classifierAvailable){'));
  const normalizedIndex=noRouteBlock.indexOf('resolveContextualRuleStudentScheduleTurn');
  const agentContextIndex=noRouteBlock.indexOf('resolveContextualReadTurn');
  assert.ok(normalizedIndex>=0 && agentContextIndex>normalizedIndex);
});

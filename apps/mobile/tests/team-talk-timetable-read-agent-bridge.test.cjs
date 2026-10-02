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

test('Mobile interpreter decides whether Agent dispatch is allowed before rule execution',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/interpretOlliTalkSystemLanguage/);
  assert.match(ai,/sharedRoute=interpreterRoute==='agent'/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_read'/);
  assert.match(dispatch,/case 'attendance_read'/);
  assert.match(dispatch,/case 'pickup_read'/);
  assert.match(dispatch,/case 'schedule_read'/);
  const interpret=ai.indexOf('interpretOlliTalkSystemLanguage(');
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if(router && typeof router.prepareAction==='function')");
  assert.ok(interpret>=0 && classify>interpret && legacy>classify);
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


test('Mobile student schedule and follow-ups use the same unified interpreter and never call legacy context AI',()=>{
  const aiStart=talk.indexOf('async function resolveOlliTalkAiTurn');
  const aiEnd=talk.indexOf('function getOlliTalkMentionMessageText',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.match(ai,/interpretOlliTalkSystemLanguage\(/);
  assert.match(ai,/commandText=String\(interpretation\.standaloneCommand/);
  assert.doesNotMatch(ai,/mode:'context_read'/);
  assert.doesNotMatch(ai,/mode:'context_resolve'/);
  assert.doesNotMatch(ai,/resolveOlliTalkRuleStudentScheduleTurn/);
  assert.doesNotMatch(ai,/resolveOlliTalkContextualRuleStudentScheduleTurn/);
  assert.match(ai,/if\(interpreterRoute==='rule'\)/);
});

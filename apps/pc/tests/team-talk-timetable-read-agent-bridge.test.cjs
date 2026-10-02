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

test('PC interpreter decides whether Agent dispatch is allowed before rule execution', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/interpretOlliSystemLanguage/);
  assert.match(ai,/sharedRoute=interpreterRoute==='agent'/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_read'/);
  assert.match(dispatch,/case 'attendance_read'/);
  assert.match(dispatch,/case 'pickup_read'/);
  assert.match(dispatch,/case 'schedule_read'/);
  const interpret=ai.indexOf('interpretOlliSystemLanguage(');
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(interpret>=0 && classify>interpret && legacy>classify);
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


test('PC student schedule and follow-ups use the same unified interpreter and never call legacy context AI',()=>{
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.match(ai,/interpretOlliSystemLanguage\(/);
  assert.match(ai,/commandText=clean\(interpretation\.standaloneCommand\)/);
  assert.doesNotMatch(ai,/mode:'context_read'/);
  assert.doesNotMatch(ai,/mode:'context_resolve'/);
  assert.doesNotMatch(ai,/resolveRuleStudentScheduleTurn/);
  assert.doesNotMatch(ai,/resolveContextualRuleStudentScheduleTurn/);
  assert.match(ai,/if\(interpreterRoute==='rule'\)/);
});

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

test('PC timetable and student reads run before legacy prepareAction and runQuery',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('function updateComposerState',start);
  const block=talk.slice(start,end);
  const timetable=block.indexOf('const timetableReadCandidate=parseTimetableReadAgentCandidate');
  const attendance=block.indexOf('isStudentAttendanceReadCandidate');
  const pickup=block.indexOf('isStudentPickupReadCandidate');
  const schedule=block.indexOf('isStudentScheduleReadCandidate');
  const prepare=block.indexOf("if (router && typeof router.prepareAction === 'function')");
  const query=block.indexOf("if (router && typeof router.runQuery === 'function')");
  assert.ok(timetable>=0);
  assert.ok(attendance>timetable && pickup>attendance && schedule>pickup);
  assert.ok(prepare>schedule && query>prepare);
  assert.match(block,/mode:'timetable_read'/);
  assert.match(block,/mode:'attendance_read'/);
  assert.match(block,/mode:'pickup_read'/);
  assert.match(block,/mode:'schedule_read'/);
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

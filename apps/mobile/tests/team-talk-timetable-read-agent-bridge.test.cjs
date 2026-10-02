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

test('Mobile timetable and student reads run before legacy prepareAction and runQuery',()=>{
  const start=talk.indexOf('async function resolveOlliTalkAiTurn');
  const end=talk.indexOf('function getOlliTalkMentionMessageText',start);
  const block=talk.slice(start,end);
  const timetable=block.indexOf('const timetableReadCandidate=parseOlliTalkTimetableReadAgentCandidate');
  const attendance=block.indexOf('isOlliTalkStudentAttendanceReadCandidate');
  const pickup=block.indexOf('isOlliTalkStudentPickupReadCandidate');
  const schedule=block.indexOf('isOlliTalkStudentScheduleReadCandidate');
  const prepare=block.indexOf("if(router && typeof router.prepareAction==='function')");
  const query=block.indexOf("if(router && typeof router.runQuery==='function')");
  assert.ok(timetable>=0);
  assert.ok(attendance>timetable && pickup>attendance && schedule>pickup);
  assert.ok(prepare>schedule && query>prepare);
  assert.match(block,/mode:'timetable_read'/);
  assert.match(block,/mode:'attendance_read'/);
  assert.match(block,/mode:'pickup_read'/);
  assert.match(block,/mode:'schedule_read'/);
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

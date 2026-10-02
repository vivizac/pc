const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC attendance status candidate uses only the shared direct-status parser',()=>{
  const start=talk.indexOf('function parseAttendanceStatusAgentCandidate');
  const end=talk.indexOf('function ',start+20);
  const block=talk.slice(start,end);
  assert.ok(block.includes('parseAttendanceStatusMutationIntent'));
  assert.equal(block.includes('prepareAction'),false);
  assert.equal(block.includes('parseAbsenceMutationIntent'),false);
});

test('PC attendance status bridge is source-bound and validates returned action type',()=>{
  const start=talk.indexOf('async function resolveAttendanceStatusAgentTurn');
  const end=talk.indexOf('async function ',start+30);
  const block=talk.slice(start,end);
  assert.ok(block.includes("mode:'attendance_status_prepare'"));
  assert.ok(block.includes('sourceMessageId'));
  assert.ok(block.includes("action.action_type)!=='set_attendance_status'"));
});

test('PC direct attendance status routing runs before timetable admin, batch, and legacy fallback',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf("if(router && typeof router.prepareAction==='function')",start);
  const block=talk.slice(start,end);
  const attendance=block.indexOf('parseAttendanceStatusAgentCandidate');
  const admin=block.indexOf('parseTimetableAdminAgentCandidate');
  const batch=block.indexOf('const batchCandidate');
  assert.ok(attendance>=0,'attendance candidate missing');
  assert.ok(admin>attendance,'attendance must run before timetable admin');
  assert.ok(batch>admin,'batch must remain after source-bound candidates');
});

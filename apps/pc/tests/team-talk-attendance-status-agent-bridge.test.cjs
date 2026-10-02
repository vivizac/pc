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

test('PC direct attendance status routing runs before timetable admin, batch, and legacy fallback — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'attendance_status'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
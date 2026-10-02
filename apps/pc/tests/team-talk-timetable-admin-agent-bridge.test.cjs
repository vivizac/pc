const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable admin candidate uses only shared admin parsers',()=>{
  const start=talk.indexOf('function parseTimetableAdminAgentCandidate');
  const end=talk.indexOf('function ',start+20);
  const block=talk.slice(start,end);
  for(const parser of [
    'parseClassLayoutMutationIntent',
    'parseTeacherAssignmentMutationIntent',
    'parseSessionOrderMutationIntent',
    'parseNormalClassDayMutationIntent',
  ]) assert.ok(block.includes(parser),parser);
  assert.equal(block.includes('prepareAction'),false);
  assert.equal(block.includes('runQuery'),false);
});

test('PC timetable admin bridge is source-bound and validates returned action type',()=>{
  const start=talk.indexOf('async function resolveTimetableAdminAgentTurn');
  const end=talk.indexOf('async function ',start+30);
  const block=talk.slice(start,end);
  assert.ok(block.includes("mode:'timetable_admin_prepare'"));
  assert.ok(block.includes('sourceMessageId'));
  assert.ok(block.includes('action.action_type'));
  assert.ok(block.includes('expectedType'));
});

test('PC timetable admin Agent routing runs before batch and legacy write fallback',()=>{
  const start=talk.indexOf('async function resolveAiTurn');
  const end=talk.indexOf('if (router && typeof router.prepareAction === 'function')',start);
  const block=talk.slice(start,end);
  const admin=block.indexOf('parseTimetableAdminAgentCandidate');
  const batch=block.indexOf('const batchCandidate = parseBatchAgentCandidate');
  assert.ok(admin>=0,'admin candidate missing');
  assert.ok(batch>admin,'admin must run before batch');
});

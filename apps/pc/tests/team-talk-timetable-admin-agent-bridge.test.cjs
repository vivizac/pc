const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../pc-team-talk.js'),'utf8');

test('PC timetable admin candidate uses only shared admin parsers',()=>{
  const start=talk.indexOf('function parseTimetableAdminRuleCandidate');
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
  const start=talk.indexOf('async function resolveTimetableAdminRuleTurn');
  const end=talk.indexOf('async function ',start+30);
  const block=talk.slice(start,end);
  assert.ok(block.includes("mode:'timetable_admin_prepare'"));
  assert.ok(block.includes('sourceMessageId'));
  assert.ok(block.includes('action.action_type'));
  assert.ok(block.includes('expectedType'));
  assert.ok(block.includes('choiceRequired'));
  assert.ok(block.includes('saveStructuredTargetChoice'));
});

test('PC timetable admin rule routing bypasses the shared Agent switch and runs before classifier', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const ai=talk.slice(talk.indexOf('async function resolveAiTurn'),talk.indexOf('function updateComposerState'));
  assert.doesNotMatch(dispatch,/case 'timetable_admin'/);
  const direct=ai.indexOf("['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)");
  const classify=ai.indexOf('const routeClassifier=');
  assert.ok(direct>=0 && classify>direct);
  assert.match(ai,/return resolveTimetableAdminRuleTurn\(commandText,parsed,current,replyToMessageId\)/);
});

test('PC session order target choice resumes through deterministic timetable admin prepare',()=>{
  const start=talk.indexOf('async function resolveStructuredTimetableAdminTurn');
  const end=talk.indexOf('async function resolveSourceBoundReadAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_timetable_admin_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'timetable_admin_prepare'/);
});


test('PC teacher A/B target choice shares deterministic timetable admin resume',()=>{
  const start=talk.indexOf('async function resolveStructuredTimetableAdminTurn');
  const end=talk.indexOf('async function resolveSourceBoundReadAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/set_class_teacher/);
  assert.match(block,/set_teacher_override/);
  assert.match(block,/structured_timetable_admin_prepare/);
});

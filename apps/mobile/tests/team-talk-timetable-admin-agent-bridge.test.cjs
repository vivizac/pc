const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const talk=fs.readFileSync(path.join(__dirname,'../olli-talk-beta.js'),'utf8');

test('Mobile timetable admin candidate uses only shared admin parsers',()=>{
  const start=talk.indexOf('function parseOlliTalkTimetableAdminRuleCandidate');
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

test('Mobile timetable admin bridge is source-bound and validates returned action type',()=>{
  const start=talk.indexOf('async function resolveOlliTalkTimetableAdminRuleTurn');
  const end=talk.indexOf('async function ',start+30);
  const block=talk.slice(start,end);
  assert.ok(block.includes("mode:'timetable_admin_prepare'"));
  assert.ok(block.includes('sourceMessageId'));
  assert.ok(block.includes('action.action_type'));
  assert.ok(block.includes('expectedType'));
  assert.ok(block.includes('choiceRequired'));
  assert.ok(block.includes('saveOlliTalkStructuredTargetChoice'));
});

test('Mobile timetable admin rule routing bypasses the shared Agent switch and runs before classifier',()=> {
  const dispatchStart=talk.indexOf('async function resolveOlliTalkSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveOlliTalkAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const ai=talk.slice(talk.indexOf('async function resolveOlliTalkAiTurn'),talk.indexOf('function getOlliTalkMentionMessageText'));
  assert.doesNotMatch(dispatch,/case 'timetable_admin'/);
  const direct=ai.indexOf("['set_class_layout','set_class_teacher','set_teacher_override','set_session_order','set_normal_class_day'].includes(interpreterIntent)");
  const classify=ai.indexOf('const routeClassifier=');
  assert.ok(direct>=0 && classify>direct);
  assert.match(ai,/return resolveOlliTalkTimetableAdminRuleTurn\(commandText,parsed,context,replyToMessageId\)/);
});

test('Mobile session order target choice resumes through deterministic timetable admin prepare',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredTimetableAdminTurn');
  const end=talk.indexOf('async function resolveOlliTalkSourceBoundReadAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/mode:'structured_timetable_admin_prepare'/);
  assert.match(block,/structuredCommand/);
  assert.doesNotMatch(block,/mode:'timetable_admin_prepare'/);
});


test('Mobile teacher A/B target choice shares deterministic timetable admin resume',()=>{
  const start=talk.indexOf('async function resolveOlliTalkStructuredTimetableAdminTurn');
  const end=talk.indexOf('async function resolveOlliTalkSourceBoundReadAgentTurn',start);
  const block=talk.slice(start,end);
  assert.match(block,/set_class_teacher/);
  assert.match(block,/set_teacher_override/);
  assert.match(block,/structured_timetable_admin_prepare/);
});

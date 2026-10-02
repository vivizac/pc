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

test('PC timetable admin Agent routing runs before batch and legacy write fallback — shared dispatch contract', () => {
  const dispatchStart=talk.indexOf('async function resolveSharedAgentRouteTurn');
  const dispatchEnd=talk.indexOf('async function resolveAiTurn',dispatchStart);
  const dispatch=talk.slice(dispatchStart,dispatchEnd);
  const aiStart=talk.indexOf('async function resolveAiTurn');
  const aiEnd=talk.indexOf('function updateComposerState',aiStart);
  const ai=talk.slice(aiStart,aiEnd);
  assert.ok(dispatchStart>=0 && dispatchEnd>dispatchStart);
  assert.match(ai,/global\.OlliTeamTalkAgentRouteClassifier/);
  assert.match(ai,/routeClassifier\.classify\(commandText,\{router\}\)/);
  assert.match(dispatch,/case 'timetable_admin'/);
  const classify=ai.indexOf('routeClassifier.classify(commandText,{router})');
  const legacy=ai.indexOf("if (router && typeof router.prepareAction === 'function')");
  assert.ok(classify>=0 && legacy>classify);

});
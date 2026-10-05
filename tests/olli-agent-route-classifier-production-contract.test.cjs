'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const common=fs.readFileSync(path.join(root,'packages/common/olli-team-talk-agent-route-common.js'),'utf8');

test('route classifier is classification-only and contains no network or mutation execution',()=>{
  assert.doesNotMatch(common,/fetch\s*\(/);
  assert.doesNotMatch(common,/supabase/i);
  assert.doesNotMatch(common,/olli_team_chat_action_execute/);
  assert.doesNotMatch(common,/prepareAction\s*\(/);
  assert.doesNotMatch(common,/runQuery\s*\(/);
});

test('classifier reuses only attendance status parser for remaining write Agent route',()=>{
  assert.match(common,/parseAttendanceStatusMutationIntent/);
  for(const parser of [
    'parseClassLayoutMutationIntent',
    'parseMultiWriteIntent',
    'parseTimetableMemoDeleteMutationIntent',
    'parseTrialMutationIntent',
    'parseWaitlistMutationIntent',
    'parsePickupMutationIntent',
    'parseMakeupMutationIntent',
    'parseScheduleMoveMutationIntent',
    'parseClassMutationIntent',
    'parseQueryIntent'
  ]) assert.doesNotMatch(common,new RegExp(parser));
});

test('classifier keeps attendance and pickup history read detectors only',()=>{
  assert.match(common,/isStudentAttendanceReadCandidate/);
  assert.match(common,/isStudentPickupReadCandidate/);
  assert.doesNotMatch(common,/isStudentScheduleReadCandidate/);
});

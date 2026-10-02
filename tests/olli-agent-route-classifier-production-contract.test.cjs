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

test('classifier reuses existing deterministic router parsers',()=>{
  for(const parser of [
    'parseAttendanceStatusMutationIntent',
    'parseClassLayoutMutationIntent',
    'parseMultiWriteIntent',
    'parseTimetableMemoDeleteMutationIntent',
    'parseTrialMutationIntent',
    'parseWaitlistMutationIntent',
    'parsePickupMutationIntent',
    'parseMakeupMutationIntent',
    'parseScheduleMoveMutationIntent',
    'parseClassMutationIntent',
    'parseQueryIntent',
  ]){
    assert.match(common,new RegExp(parser));
  }
});

test('classification phase preserves explicit-division gate for trial add',()=>{
  assert.match(common,/\['elementary','kinder'\]\.includes/);
});

'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const schedule=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcCss=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.css'),'utf8');
const mobileCss=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004104500_team_chat_structured_target_choice.sql'),'utf8');
const latestTargetChoiceMigration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261004130000_team_chat_structured_waitlist_update_choices.sql'),
  'utf8'
);

test('ambiguous pickup and waitlist SOTs return reusable target choices instead of typed re-entry prompts',()=>{
  assert.match(schedule,/code:'target_choice_required'/);
  assert.match(schedule,/field:'target_choice'/);
  assert.match(schedule,/targetType:'pickup'/);
  assert.match(schedule,/targetType:'waitlist'/);
  assert.match(schedule,/수정할 일정을 선택해 주세요/);
  assert.match(schedule,/삭제할 일정을 선택해 주세요/);
  assert.match(schedule,/취소할 대기를 선택해 주세요/);
});

test('router carries stable target ids back to the existing SOTs',()=>{
  assert.match(router,/waitlistId:cleanText\(command\.waitlist_id \|\| command\.waitlistId\)/);
  assert.match(router,/pickupId:cleanText\(command\.pickup_id \|\| command\.pickupId\)/);
  assert.match(router,/structuredTargetChoiceResult/);
  assert.match(router,/const sourceEnrollmentId=cleanText\(command\.source_enrollment_id \|\| command\.sourceEnrollmentId\)/);
  assert.match(router,/sourceEnrollmentId,/);
});

test('PC and Mobile persist and render generic structured target-choice buttons',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/choose_structured_target/);
    assert.match(source,/olli_team_chat_send_structured_target_choice/);
    assert.match(source,/olli_team_chat_get_structured_target_choice/);
    assert.match(source,/olli_team_chat_action_select_structured_target/);
    assert.match(source,/targetChoice/);
  }
});

test('target choice cards are readable one-column buttons',()=>{
  assert.match(pcCss,/structuredTarget[^\{]*\{[^}]*grid-template-columns:1fr/);
  assert.match(pcCss,/targetChoice[^\{]*\{[^}]*width:100%/);
  assert.match(mobileCss,/structuredTarget[^\{]*\{[^}]*grid-template-columns:1fr/);
  assert.match(mobileCss,/targetChoice[^\{]*\{[^}]*width:100%/);
});

test('target selection only updates draft stable id and never mutates pickup or waitlist data',()=>{
  assert.match(migration,/choose_structured_target/);
  assert.match(migration,/v_key:='pickupId'/);
  assert.match(migration,/v_key:='waitlistId'/);
  assert.match(latestTargetChoiceMigration,/'move_class'/);
  assert.match(latestTargetChoiceMigration,/'sourceEnrollmentId'/);
  assert.match(latestTargetChoiceMigration,/'cancel_move'/);
  assert.match(latestTargetChoiceMigration,/'changeId'/);
  assert.match(latestTargetChoiceMigration,/'add_timetable_memo'/);
  assert.match(latestTargetChoiceMigration,/'delete_timetable_memo'/);
  assert.match(latestTargetChoiceMigration,/'memoTargetKey'/);
  assert.match(latestTargetChoiceMigration,/jsonb_set\(v_draft,array\[v_key\]/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/resolveWaitlist\s*\(/);
  assert.doesNotMatch(migration,/removePickup\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

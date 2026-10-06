'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const pcCss=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.css'),'utf8');
const mobileCss=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.css'),'utf8');
const schedule=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004073600_team_chat_structured_time_choice.sql'),'utf8');
const moveMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261006112000_team_chat_move_structured_choices.sql'),'utf8');

test('PC and Mobile persist and render structured time choice cards from stored options',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/choose_structured_time/);
    assert.match(source,/olli_team_chat_send_structured_time_choice/);
    assert.match(source,/olli_team_chat_get_structured_time_choice/);
    assert.match(source,/olli_team_chat_action_select_structured_time/);
    assert.match(source,/시간 확인 중/);
    assert.match(source,/마감/);
    assert.match(source,/대기 가능/);
  }
});

test('common schedule builds real operating time choices including half-hour display labels',()=>{
  assert.match(schedule,/async function prepareStructuredTimeChoices/);
  assert.match(schedule,/timetableMemoTimeLabel\(/);
  assert.match(schedule,/structuredStoredTimeMinutes/);
  assert.match(schedule,/action==='add_waitlist' \? true : open/);
  assert.match(schedule,/status:open \? 'available' : 'full'/);
});

test('time choice SQL never executes a schedule mutation and only completes the field choice',()=>{
  assert.match(migration,/choose_structured_time/);
  assert.match(migration,/olli_team_chat_get_structured_time_choice/);
  assert.match(migration,/jsonb_set\(v_draft,'\{timeSlot\}'/);
  assert.match(migration,/status='completed'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

test('time cards keep two-column layout and closed booking slots disabled visually',()=>{
  assert.match(pcCss,/structuredTime[^{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(pcCss,/timeChoice\.closed/);
  assert.match(mobileCss,/structuredTime[^{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(mobileCss,/timeChoice\.closed/);
});


test('class move reuses structured target-time choice and schedule_move availability',()=>{
  assert.match(schedule,/move_class/);
  assert.match(schedule,/schedule_move/);
  assert.match(moveMigration,/target_time/);
  assert.match(moveMigration,/move_class/);
  assert.match(moveMigration,/olli_team_chat_send_structured_time_choice/);
  assert.match(moveMigration,/olli_team_chat_action_select_structured_time/);
  assert.doesNotMatch(moveMigration,/olli_schedule_execute\s*\(/);
});


test('closed time choices keep the time centered and render 마감 immediately beside it',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/withStatusLabel/);
    assert.match(source,/timeChoiceLabel/);
    assert.match(source,/timeChoiceStatus/);
    assert.match(source,/마감/);
  }
  assert.match(pcCss,/timeChoice\.withStatusLabel\{[^}]*position:relative;[^}]*justify-content:center/);
  assert.match(pcCss,/timeChoice \.timeChoiceStatus\{[^}]*position:absolute;[^}]*left:calc\(50% \+ 18px\);[^}]*top:50%/);
  assert.match(mobileCss,/timeChoice\.withStatusLabel\{[^}]*position:relative;[^}]*justify-content:center/);
  assert.match(mobileCss,/timeChoice \.timeChoiceStatus\{[^}]*position:absolute;[^}]*left:calc\(50% \+ 18px\);[^}]*top:50%/);
});

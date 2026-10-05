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
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261003141000_team_chat_structured_date_choice.sql'),'utf8');

test('PC and Mobile persist structured date cards and select dates without AI',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/action_needs_field/);
    assert.match(source,/choose_structured_date/);
    assert.match(source,/olli_team_chat_send_structured_date_choice/);
    assert.match(source,/olli_team_chat_action_select_structured_date/);
    assert.match(source,/type=['"]date['"]/);
    assert.match(source,/오늘/);
    assert.match(source,/내일/);
    assert.match(source,/날짜 선택/);
  }
});

test('structured date choice migration stores a non-executable pending choice and completes only the field choice',()=>{
  assert.match(migration,/choose_structured_date/);
  assert.match(migration,/olli_team_chat_send_structured_date_choice/);
  assert.match(migration,/olli_team_chat_action_select_structured_date/);
  assert.match(migration,/status='completed'/);
  assert.match(migration,/'draft',v_draft/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

test('date choice cards use a compact two-column layout with a full-width calendar choice',()=>{
  assert.match(pcCss,/structuredDate[^{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(pcCss,/dateWide[^}]*grid-column:1\/-1/);
  assert.match(mobileCss,/structuredDate[^{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(mobileCss,/dateWide[^}]*grid-column:1\/-1/);
});

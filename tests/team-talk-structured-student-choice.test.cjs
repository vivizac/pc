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
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004081500_team_chat_structured_student_choice.sql'),'utf8');

test('PC and Mobile persist and render structured student disambiguation cards',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/choose_structured_student/);
    assert.match(source,/olli_team_chat_send_structured_student_choice/);
    assert.match(source,/olli_team_chat_get_structured_student_choice/);
    assert.match(source,/olli_team_chat_action_select_structured_student/);
    assert.match(source,/학생 확인 중/);
  }
});

test('student choice cards use clear full-width vertical buttons',()=>{
  assert.match(pcCss,/structuredStudent[^{]*\{[^}]*grid-template-columns:1fr/);
  assert.match(pcCss,/studentChoice[^{]*\{[^}]*width:100%/);
  assert.match(mobileCss,/structuredStudent[^{]*\{[^}]*grid-template-columns:1fr/);
  assert.match(mobileCss,/studentChoice[^{]*\{[^}]*width:100%/);
});

test('student selection only updates the draft and never executes schedule mutation',()=>{
  assert.match(migration,/choose_structured_student/);
  assert.match(migration,/jsonb_set\(v_draft,'\{studentName\}'/);
  assert.match(migration,/jsonb_set\(v_draft,'\{division\}'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

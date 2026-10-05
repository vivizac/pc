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
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004084500_team_chat_structured_division_choice.sql'),'utf8');

test('PC and Mobile persist structured division choice cards and continue without another AI turn',()=>{
  for(const source of [pc,mobile]){
    assert.match(source,/choose_structured_division/);
    assert.match(source,/olli_team_chat_send_structured_division_choice/);
    assert.match(source,/olli_team_chat_action_select_structured_division/);
    assert.match(source,/유치부/);
    assert.match(source,/초등부/);
    assert.match(source,/continue(?:OlliTalk)?StructuredWriteDraft/);
  }
});

test('division card is a compact two-column choice',()=>{
  assert.match(pcCss,/structuredDivision[^\{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(pcCss,/divisionChoice[^\{]*\{[^}]*width:100%/);
  assert.match(mobileCss,/structuredDivision[^\{]*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(mobileCss,/divisionChoice[^\{]*\{[^}]*width:100%/);
});

test('division selection is limited to guest trial and waitlist and never mutates schedule',()=>{
  assert.match(migration,/v_target not in \('add_trial','add_waitlist'\)/);
  assert.match(migration,/v_division not in \('kinder','elementary'\)/);
  assert.match(migration,/jsonb_set\(v_draft,'\{division\}'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20261005144435_team_chat_preserve_group_choice_history.sql'),
  'utf8'
);

test('A/B selection preserves the original choice action and creates a new confirmation action',()=>{
  assert.match(migration,/private\.olli_team_chat_select_group_choice/);
  assert.match(migration,/public\.olli_team_chat_send_action\s*\(/);
  assert.match(migration,/status='completed'/);
  assert.match(migration,/result_message_id=v_confirmation_message_id/);
  assert.match(migration,/selectedClassGroup/);
  assert.doesNotMatch(
    migration,
    /update\s+public\.olli_team_chat_messages\s+set\s+body/mi
  );
  for(const type of ['choose_makeup_group','choose_trial_group','choose_waitlist_group','choose_move_group']){
    assert.match(migration,new RegExp(type));
  }
});

test('resolved A/B choice history keeps the selected value visible',()=>{
  const pcStart=pc.indexOf('function makeActionCard');
  const pcEnd=pc.indexOf('\n  function ',pcStart+20);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pc.length);
  assert.match(pcBlock,/actionStatusLabel\(action\)/);

  const mobileStart=mobile.indexOf('function createOlliTalkActionCard');
  const mobileEnd=mobile.indexOf('\n  function ',mobileStart+20);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobile.length);
  assert.match(mobile,/function isOlliTalkChoiceActionType/);
  assert.match(mobile,/function getOlliTalkSelectedChoiceButtonLabel/);
  assert.match(mobileBlock,/selectedChoice/);
  assert.match(mobileBlock,/selected\.textContent=getOlliTalkSelectedChoiceButtonLabel\(action\)/);
  assert.match(mobileBlock,/selected\.disabled=true/);
  assert.match(mobileBlock,/button\.textContent=group\+'반'/);
});

test('structured choice prompts remain in history while Mobile keeps the selected button value visible',()=>{
  for(const source of [pc,mobile]){
    for(const type of [
      'choose_structured_student','choose_structured_target','choose_structured_division',
      'choose_structured_date','choose_structured_time'
    ]){
      assert.match(source,new RegExp(type));
    }
    assert.match(source,/display_label/);
  }

  const pcStart=pc.indexOf('function makeActionCard');
  const pcEnd=pc.indexOf('\n  function ',pcStart+20);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pc.length);
  assert.ok(pcBlock.indexOf("if (status !== 'pending')") < pcBlock.indexOf("choose_structured_student"));

  const mobileStart=mobile.indexOf('function createOlliTalkActionCard');
  const mobileEnd=mobile.indexOf('\n  function ',mobileStart+20);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobile.length);
  assert.ok(mobileBlock.indexOf("if(status!=='pending')") < mobileBlock.indexOf("choose_structured_student"));
});

test('structured choice DB wrappers preserve the original message body while keeping existing validation logic',()=>{
  const allChoiceMigration=fs.readFileSync(
    path.join(root,'supabase/migrations/20261005150500_team_chat_preserve_all_choice_history.sql'),
    'utf8'
  );

  for(const type of ['date','time','student','division','target']){
    assert.match(allChoiceMigration,new RegExp('olli_team_chat_action_select_structured_'+type));
    assert.match(allChoiceMigration,new RegExp('olli_team_chat_action_select_structured_'+type+'_history_impl_20261005'));
  }
  assert.match(allChoiceMigration,/v_original_body/);
  assert.match(allChoiceMigration,/set body=v_original_body/);
  assert.match(allChoiceMigration,/return v_result - 'message_body'/);
});

test('Mobile removes resolved final confirmation cards because the inline system result is the completion UI',()=>{
  const start=mobile.indexOf('function createOlliTalkActionCard');
  const end=mobile.indexOf('\n  function ',start+20);
  const block=mobile.slice(start,end>start?end:mobile.length);
  assert.match(block,/status==='completed' && isOlliTalkChoiceActionType/);
  assert.match(block,/if\(status==='failed'\)/);
  assert.match(block,/return null;/);
  assert.doesNotMatch(block,/confirmed\.textContent='확인'/);
});

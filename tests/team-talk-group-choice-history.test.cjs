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

test('completed A/B choice cards remain visible but cannot be clicked again on PC and Mobile',()=>{
  const pcStart=pc.indexOf('function makeActionCard');
  const pcEnd=pc.indexOf('\n  function ',pcStart+20);
  const pcBlock=pc.slice(pcStart,pcEnd>pcStart?pcEnd:pc.length);
  const pcGroup=pcBlock.indexOf('const isSessionGroupChoice=');
  const pcStatus=pcBlock.indexOf("if (status !== 'pending')");
  assert.ok(pcGroup>=0 && pcStatus>pcGroup);
  assert.match(pcBlock,/button\.disabled=status!=='pending'/);
  assert.match(pcBlock,/if\(status==='pending'\) button\.addEventListener/);

  const mobileStart=mobile.indexOf('function createOlliTalkActionCard');
  const mobileEnd=mobile.indexOf('\n  function ',mobileStart+20);
  const mobileBlock=mobile.slice(mobileStart,mobileEnd>mobileStart?mobileEnd:mobile.length);
  const mobileGroup=mobileBlock.indexOf('const isSessionGroupChoice=');
  const mobileStatus=mobileBlock.indexOf("if(status!=='pending')");
  assert.ok(mobileGroup>=0 && mobileStatus>mobileGroup);
  assert.match(mobileBlock,/button\.disabled=status!=='pending'/);
  assert.match(mobileBlock,/if\(status==='pending'\) button\.addEventListener/);
});

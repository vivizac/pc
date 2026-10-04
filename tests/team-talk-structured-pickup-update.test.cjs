'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const router=fs.readFileSync(path.join(root,'packages/common/olli-command-router-common.js'),'utf8');
const schedule=fs.readFileSync(path.join(root,'packages/common/olli-command-schedule-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004093000_team_chat_structured_student_choice_update_pickup.sql'),'utf8');

test('structured pickup update is routed through the common router on PC and Mobile',()=>{
  assert.match(router,/supported = new Set\([^\n]*'update_pickup'/);
  for(const source of [pc,mobile]){
    assert.match(source,/\[[^\]]*'update_pickup'[^\]]*\]/);
  }
});

test('pickup update keeps the existing deterministic schedule SOT',()=>{
  assert.match(schedule,/async function preparePickupUpdateCommand/);
  assert.match(schedule,/if \(intent === 'update_pickup'\) return preparePickupUpdateCommand\(options\)/);
  assert.match(router,/schedule\.prepareWriteCommand\('update_pickup'/);
  assert.match(router,/update_pickup_arrival/);
  assert.match(router,/update_pickup_dropoff/);
});

test('legacy pickup update Agent preparation remains available as fallback',()=>{
  assert.match(pc,/async function resolvePickupUpdateAgentTurn/);
  assert.match(pc,/mode:'pickup_update_prepare'/);
  assert.match(mobile,/async function resolveOlliTalkPickupUpdateAgentTurn/);
  assert.match(mobile,/mode:'pickup_update_prepare'/);
});

test('student disambiguation persistence allows pickup update but never mutates schedule',()=>{
  assert.match(migration,/'update_pickup'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

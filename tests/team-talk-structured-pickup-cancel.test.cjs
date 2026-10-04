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
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004094500_team_chat_structured_student_choice_cancel_pickup.sql'),'utf8');

test('structured pickup cancellation is routed through the common router on PC and Mobile',()=>{
  assert.match(router,/supported = new Set\([^\n]*'cancel_pickup'/);
  for(const source of [pc,mobile]){
    assert.match(source,/\[[^\]]*'cancel_pickup'[^\]]*\]/);
  }
});

test('pickup cancellation keeps the existing deterministic schedule SOT',()=>{
  assert.match(schedule,/async function preparePickupCancelCommand/);
  assert.match(schedule,/if \(intent === 'cancel_pickup'\) return preparePickupCancelCommand\(options\)/);
  assert.match(router,/schedule\.prepareWriteCommand\('cancel_pickup'/);
  assert.match(router,/cancel_pickup_dropoff/);
});

test('legacy pickup cancel Agent preparation remains available as fallback',()=>{
  assert.match(pc,/async function resolvePickupCancelAgentTurn/);
  assert.match(pc,/mode:'pickup_cancel_prepare'/);
  assert.match(mobile,/async function resolveOlliTalkPickupCancelAgentTurn/);
  assert.match(mobile,/mode:'pickup_cancel_prepare'/);
});

test('student disambiguation persistence allows pickup cancellation but never deletes pickup data',()=>{
  assert.match(migration,/'cancel_pickup'/);
  assert.doesNotMatch(migration,/olli_schedule_execute\s*\(/);
  assert.doesNotMatch(migration,/removePickup\s*\(/);
  assert.doesNotMatch(migration,/olli_schedule_remove_pickup_dropoff\s*\(/);
  assert.doesNotMatch(migration,/olli_team_chat_action_execute\s*\(/);
});

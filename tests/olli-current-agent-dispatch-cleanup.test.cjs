'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const classifier=fs.readFileSync(path.join(root,'packages/common/olli-team-talk-agent-route-common.js'),'utf8');
const pc=fs.readFileSync(path.join(root,'apps/pc/pc-team-talk.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'apps/mobile/olli-talk-beta.js'),'utf8');

test('current classifier lists exactly three Agent routes',()=>{
  assert.match(classifier,/attendance_status/);
  assert.match(classifier,/attendance_read/);
  assert.match(classifier,/pickup_read/);
  for(const token of ['batch_write','timetable_admin','timetable_memo','trial_add','makeup_add','waitlist_add','move_cancel','timetable_read','schedule_read']){
    assert.doesNotMatch(classifier,new RegExp(token));
  }
});

test('current shared dispatch does not expose deterministic routine Agent cases',()=>{
  const blocks=[
    pc.slice(pc.indexOf('async function resolveSharedAgentRouteTurn'),pc.indexOf('async function resolveContextualMakeupTurn')),
    mobile.slice(mobile.indexOf('async function resolveOlliTalkSharedAgentRouteTurn'),mobile.indexOf('async function resolveOlliTalkContextualMakeupTurn'))
  ];
  for(const block of blocks){
    assert.doesNotMatch(block,/makeup_add|trial_add|waitlist_add|pickup_add|move_cancel|timetable_read|batch_write|timetable_admin/);
  }
});

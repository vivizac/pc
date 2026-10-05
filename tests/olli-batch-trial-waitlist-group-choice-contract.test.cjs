'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005081500_team_chat_batch_trial_waitlist_group_choice.sql'),'utf8');

test('batch trial and waitlist A/B choice uses generic non-mutating structured target RPC',()=>{
  assert.match(sql,/add_trial/);
  assert.match(sql,/add_waitlist/);
  assert.match(sql,/v_target in \('add_makeup','add_trial','add_waitlist'\)/);
  assert.match(sql,/choiceKey',''\)\) <> 'classGroup'/);
  assert.match(sql,/action_type='choose_structured_target'/);
  assert.doesNotMatch(sql,/olli_schedule_add_guest_entry\s*\(/);
  assert.doesNotMatch(sql,/insert\s+into\s+public\.schedule_/i);
});

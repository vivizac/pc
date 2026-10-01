const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = 'supabase/migrations/20260930160000_expand_team_talk_schedule_action_capabilities.sql';
const sql = fs.readFileSync(path, 'utf8');

test('one-time session change expands date-only behavior to date, time, and class group', () => {
  assert.match(sql, /create or replace function public\.olli_schedule_update_one_time_session\(/i);
  assert.match(sql, /p_session_date date default null/i);
  assert.match(sql, /p_time_slot integer default null/i);
  assert.match(sql, /p_class_group text default null/i);
  assert.match(sql, /set session_date = v_target_date,[\s\S]*time_slot = v_target_time,[\s\S]*class_group = v_target_group/i);
  assert.match(sql, /create or replace function public\.olli_schedule_update_one_time_date\([\s\S]*olli_schedule_update_one_time_session/i);
});

test('waitlist target change supports date, weekday, time, and class group', () => {
  assert.match(sql, /create or replace function public\.olli_schedule_update_waitlist_target\(/i);
  assert.match(sql, /p_target_weekday integer default null/i);
  assert.match(sql, /p_target_time_slot integer default null/i);
  assert.match(sql, /p_target_class_group text default null/i);
  assert.match(sql, /p_desired_effective_date date default null/i);
  assert.match(sql, /set target_weekday = v_weekday,[\s\S]*target_time_slot = v_time,[\s\S]*target_class_group = v_group,[\s\S]*desired_effective_date = v_effective/i);
});

test('Team Talk action allowlist preserves existing memo actions and adds new server capabilities', () => {
  for (const action of [
    'add_timetable_memo',
    'delete_timetable_memo',
    'update_pickup_arrival',
    'update_pickup_dropoff',
    'cancel_pickup',
    'cancel_pickup_dropoff',
    'update_makeup',
    'update_trial',
    'update_waitlist',
    'cancel_waitlist',
  ]) {
    assert.match(sql, new RegExp("'" + action + "'"));
  }
});

test('Team Talk execution uses existing schedule RPCs instead of direct table mutation for user-approved actions', () => {
  assert.match(sql, /v_type='update_pickup_arrival'[\s\S]*olli_schedule_save_pickup_arrival/i);
  assert.match(sql, /v_type='update_pickup_dropoff'[\s\S]*olli_schedule_register_pickup_dropoff/i);
  assert.match(sql, /v_type='cancel_pickup_dropoff'[\s\S]*olli_schedule_remove_pickup_dropoff/i);
  assert.match(sql, /v_type='cancel_pickup'[\s\S]*olli_schedule_remove_pickup/i);
  assert.match(sql, /v_type='update_waitlist'[\s\S]*olli_schedule_update_waitlist_target/i);
  assert.match(sql, /v_type='cancel_waitlist'[\s\S]*olli_schedule_resolve_waitlist/i);
  assert.match(sql, /v_type in \('update_makeup','update_trial'\)[\s\S]*olli_schedule_update_one_time_session/i);
});

test('same date and time can still change only the class group', () => {
  const unchanged = sql.match(/if v_target_date = v_item\.session_date[\s\S]*?end if;/i)?.[0] || '';
  assert.match(unchanged, /v_target_time = v_item\.time_slot/i);
  assert.match(unchanged, /v_target_group = upper\(/i);
});

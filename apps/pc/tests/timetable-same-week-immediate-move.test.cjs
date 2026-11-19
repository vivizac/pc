'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261119074858_pc_timetable_same_week_immediate_moves.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'apps/pc/pc-timetable.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'apps/pc/pc-timetable-service.js'), 'utf8');
const schedule = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.olli_schedule_change('), sql.indexOf('$function$;') + '$function$;'.length);
const pickup = sql.slice(sql.indexOf('create or replace function public.olli_schedule_move_pickup_v1('));

test('current-week regular moves apply today; next-week changes and additions are unchanged', () => {
  assert.match(schedule, /if p_change_type = 'move'\s+and v_effective < \(date_trunc\('week', current_date\)::date \+ 7\) then\s+v_effective := current_date;/);
  assert.match(schedule, /case when v_effective<=current_date then 'applied' else 'scheduled' end/);
  assert.match(schedule, /'effective_date',v_effective/);
  assert.match(schedule, /effective_to=v_effective - 1/);
  assert.match(schedule, /pg_advisory_xact_lock/);
});

test('capacity includes one-time sessions on the actual destination weekday, with A/B checks', () => {
  assert.match(schedule, /v_target_session_date := private\.olli_schedule_first_occurrence_on_or_after\(\s*v_effective, p_target_weekday\s*\)/);
  assert.match(schedule, /o\.session_date=v_target_session_date and o\.time_slot=p_target_time_slot/);
  assert.doesNotMatch(schedule, /o\.session_date=v_effective/);
  assert.match(schedule, /e\.effective_from<=v_target_session_date and \(e\.effective_to is null or e\.effective_to>=v_target_session_date\)/);
  assert.match(schedule, /private\.olli_schedule_group_is_enabled\([\s\S]*?private\.olli_schedule_first_occurrence_on_or_after\(v_effective, p_target_weekday\)/);
});

test('weekly pickups apply now in this week and preserve history; daily and future remain dated', () => {
  assert.match(pickup, /when v_pickup\.pickup_scope = 'weekly'\s+and p_target_date < \(date_trunc\('week', current_date\)::date \+ 7\)\s+then current_date\s+else p_target_date/);
  assert.match(pickup, /set effective_to = v_apply_date - 1/);
  assert.match(pickup, /v_pickup\.pickup_scope, v_apply_date, v_new_until/);
  assert.match(pickup, /when v_pickup\.pickup_scope = 'daily'\s+then p_target_date/);
  assert.match(pickup, /p_source_date <> v_pickup\.effective_from/);
  assert.match(pickup, /and p\.effective_from <= p_target_date/);
  assert.match(pickup, /'effective_date', v_apply_date, 'target_date', p_target_date/);
});

test('drag and dialog keep their existing authenticated RPC paths and report actual application', () => {
  assert.match(ui, /service\.changeSchedule\(\{/);
  assert.match(ui, /effectiveDate:target\.date/);
  assert.match(ui, /effectiveDate: dialog\.effectiveDate/);
  assert.match(ui, /service\.movePickup\(source\.id, source\.date, target\.date, target\.time\)/);
  assert.match(ui, /storedEffectiveDate = clean\(result\.effective_date\) \|\| target\.date/);
  assert.match(service, /effectiveDate: clean\(result && result\.effective_date\) \|\| params\.effective_date/);
  assert.match(service, /rpc\('olli_schedule_execute'/);
  assert.match(service, /rpc\('olli_schedule_move_pickup_v1'/);
});

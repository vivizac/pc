const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20261001083000_team_chat_pickup_completion_label.sql',
  'utf8'
);

test('private schedule time label derives half-hour clock text from the shared timetable mode', () => {
  const helper = sql.match(
    /create or replace function private\.olli_schedule_time_slot_label\([\s\S]*?\$\$;/
  )?.[0] || '';

  assert.match(helper, /private\.olli_schedule_timetable_mode\(p_academy_id\)='half_hour'/i);
  assert.match(helper, /p_weekday=6[\s\S]*p_time_slot between 10 and 12[\s\S]*p_time_slot - 9/i);
  assert.match(helper, /p_division,''\)\)='elementary'[\s\S]*p_time_slot between 7 and 11[\s\S]*p_time_slot - 6/i);
  assert.match(helper, /p_division,''\)\)='kinder'[\s\S]*p_time_slot between 7 and 9[\s\S]*p_time_slot - 4/i);
  assert.match(helper, /else p_time_slot::text \|\| '시'/i);
});

test('add_pickup completion uses the display label helper instead of the stored slot number', () => {
  const block = sql.match(
    /when 'add_pickup' then[\s\S]*?when 'update_pickup_arrival' then/i
  )?.[0] || '';

  assert.match(
    block,
    /private\.olli_schedule_time_slot_label\(p_academy_id,'kinder',v_target_weekday,v_target_time\)/i
  );
  assert.doesNotMatch(block, /coalesce\(v_target_time,0\)\|\|'시 수업'/i);
});

test('pickup completion-label migration does not replace the existing pickup v3 execution path', () => {
  const execute = sql.match(
    /elsif v_type='add_pickup' then[\s\S]*?elsif v_type='update_pickup_arrival' then/i
  )?.[0] || '';

  assert.match(execute, /public\.olli_schedule_save_pickup_v3/i);
  assert.match(execute, /v_payload->>'dropoffLabel'/i);
  assert.match(execute, /v_payload->>'effectiveDate'/i);
});

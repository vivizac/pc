const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20260930213000_timetable_memo_half_hour_source_of_truth.sql',
  'utf8'
);

test('timetable week exposes the shared timetable mode', () => {
  assert.match(
    sql,
    /'timetable_mode'\s*,\s*private\.olli_schedule_timetable_mode\(p_academy_id\)/i
  );
});

test('cell memo writes use the shared slot validator', () => {
  assert.match(sql, /private\.olli_schedule_slot_is_valid\(/i);
  assert.doesNotMatch(sql, /p_time_slot not between 1 and 6/i);
  assert.match(
    sql,
    /private\.olli_schedule_timetable_mode\(p_academy_id\)\s*=\s*'half_hour'/i
  );
  assert.match(sql, /v_group\s*:=\s*'A'/i);
});

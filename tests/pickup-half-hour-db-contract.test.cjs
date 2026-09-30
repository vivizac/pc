const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20261001070500_pickup_half_hour_slot_source_of_truth.sql',
  'utf8'
);

test('pickup v3 validates class slots through the shared timetable source of truth', () => {
  const v3 = sql.match(/create or replace function public\.olli_schedule_save_pickup_v3\([\s\S]*?\$function\$;/i)?.[0] || '';
  assert.match(v3, /private\.olli_schedule_slot_is_valid\(p_academy_id, 'kinder', p_weekday, p_class_time\)/i);
  assert.doesNotMatch(v3, /p_class_time not in \(4, 5\)/i);
});

test('legacy pickup v2 delegates to v3 instead of keeping a second slot validator', () => {
  const v2 = sql.match(/create or replace function public\.olli_schedule_save_pickup_v2\([\s\S]*?\$function\$;/i)?.[0] || '';
  assert.match(v2, /return public\.olli_schedule_save_pickup_v3\(/i);
  assert.doesNotMatch(v2, /p_class_time not in \(4, 5\)/i);
  assert.match(v2, /case when coalesce\(p_is_dropoff, false\) then p_pickup_label else null end/i);
});

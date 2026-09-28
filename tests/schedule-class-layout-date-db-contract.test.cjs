const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDir = path.join('supabase','migrations');
const files = fs.readdirSync(migrationDir)
  .filter(name => /_date_effective_elementary_class_layout_v2\.sql$/.test(name))
  .sort();

function migrationSql() {
  assert.ok(files.length > 0, 'date-effective A/B v2 migration must exist before implementation is considered complete');
  return fs.readFileSync(path.join(migrationDir, files.at(-1)), 'utf8');
}

test('A/B v2 migration stores effective split periods', () => {
  const sql = migrationSql();
  assert.match(sql, /effective_from\s+date/i);
  assert.match(sql, /effective_to\s+date/i);
  assert.match(sql, /primary\s+key\s*\([^)]*academy_id[^)]*weekday[^)]*time_slot[^)]*effective_from[^)]*\)/i);
});

test('A/B v2 migration exposes one date-aware split predicate', () => {
  const sql = migrationSql();
  assert.match(sql, /function\s+private\.olli_schedule_class_split_at\s*\([^)]*p_session_date\s+date/i);
  assert.match(sql, /function\s+private\.olli_schedule_group_is_enabled\s*\([^)]*p_target_date\s+date/i);
});

test('week and horizon RPCs return canonical class_split_periods with effective ranges', () => {
  const sql = migrationSql();
  assert.match(sql, /class_split_periods/i);
  assert.match(sql, /effective_from/i);
  assert.match(sql, /effective_to/i);
  assert.match(sql, /olli_schedule_week/i);
  assert.match(sql, /olli_schedule_availability_horizon/i);
});

test('split and merge RPCs require an explicit effective date', () => {
  const sql = migrationSql();
  assert.match(sql, /olli_schedule_split_class\s*\([^)]*p_effective_date\s+date/i);
  assert.match(sql, /olli_schedule_merge_class\s*\([^)]*p_effective_date\s+date/i);
  assert.match(sql, /DATE_WEEKDAY_MISMATCH|date_weekday_mismatch/i);
});

test('merge checks only B usage in the affected future interval and includes scheduled changes', () => {
  const sql = migrationSql();
  assert.match(sql, /olli_schedule_enrollments/i);
  assert.match(sql, /olli_schedule_one_time_sessions/i);
  assert.match(sql, /olli_schedule_waitlist/i);
  assert.match(sql, /olli_schedule_changes/i);
  assert.match(sql, /MERGE_BLOCKED_B_USAGE|merge_blocked_b_usage/i);
});

test('all date-bearing schedule writes call a date-aware group predicate', () => {
  const sql = migrationSql();
  for (const fn of [
    'olli_schedule_add_one_time',
    'olli_schedule_add_guest_entry',
    'olli_schedule_add_waitlist',
    'olli_schedule_change',
    'olli_schedule_resolve_waitlist',
    'olli_schedule_set_attendance',
    'olli_schedule_toggle_attendance',
    'olli_schedule_set_student_weekly_schedule',
    'olli_schedule_update_one_time_date'
  ]) {
    assert.match(sql, new RegExp(fn, 'i'), fn + ' must be covered by the A/B v2 migration');
  }
  assert.match(sql, /olli_schedule_group_is_enabled\s*\([^;]*?(session_date|effective_date|target_date|v_date)/is);
});

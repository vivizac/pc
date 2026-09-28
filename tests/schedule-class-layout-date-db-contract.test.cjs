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


test('merge blockers are bounded by the merge effective date so historical B rows do not block today', () => {
  const sql = migrationSql();
  assert.match(sql, /one_time_sessions[\s\S]*?session_date\s*>=\s*(v_effective|p_effective_date)/i);
  assert.match(sql, /enrollments[\s\S]*?effective_to\s+is\s+null[\s\S]*?effective_to\s*>=\s*(v_effective|p_effective_date)/i);
  assert.match(sql, /schedule_changes[\s\S]*?first_(occurrence|weekday)_on_or_after\s*\(\s*c\.effective_date[\s\S]*?>=\s*p_effective_date/i);
});

test('regular schedule writes derive the first actual class date on or after effective_date', () => {
  const sql = migrationSql();
  assert.match(sql, /first_(occurrence|weekday)|weekday_on_or_after/i);
  assert.match(sql, /olli_schedule_set_student_weekly_schedule/i);
  assert.match(sql, /olli_schedule_change/i);
});


test('A/B split periods reject overlaps and normalize adjacent ranges', () => {
  const sql = migrationSql();
  assert.match(sql, /olli_schedule_class_split_period_guard/i);
  assert.match(sql, /CLASS_LAYOUT_CONFLICT/i);
  assert.match(sql, /effective_to\s*=\s*p_effective_date\s*-\s*1/i);
  assert.match(sql, /v_previous_from/i);
});


test('the v2 database design has one canonical migration source', () => {
  assert.equal(
    fs.existsSync(path.join('supabase','rls-plans','date_effective_elementary_class_layout_v2.sql')),
    false,
    'duplicate A/B v2 SQL must not remain under rls-plans'
  );
  const appCopy = path.join('apps','pc','supabase','migrations',files.at(-1));
  if (fs.existsSync(appCopy)) {
    assert.equal(
      fs.readFileSync(appCopy, 'utf8'),
      migrationSql(),
      'apps/pc migration copy must match the canonical root migration exactly'
    );
  }
});

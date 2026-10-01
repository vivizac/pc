const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDir = path.join('supabase', 'migrations');
const files = fs.readdirSync(migrationDir)
  .filter((name) => /_waitlist_ab_division_slot_integrity\.sql$/.test(name))
  .sort();

function migrationSql() {
  assert.ok(files.length > 0, 'waitlist A/B slot integrity migration must exist');
  return fs.readFileSync(path.join(migrationDir, files.at(-1)), 'utf8');
}

test('active waitlist uniqueness is scoped by division and A/B class group', () => {
  const sql = migrationSql();

  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+target_division\s+text/i);
  assert.match(sql, /alter\s+column\s+target_division\s+set\s+not\s+null/i);
  assert.match(sql, /check\s*\(\s*target_division\s+in\s*\(\s*'elementary'\s*,\s*'kinder'\s*\)\s*\)/i);
  assert.match(
    sql,
    /create\s+unique\s+index\s+olli_schedule_waitlist_one_active_per_class_slot_idx[\s\S]*?academy_id[\s\S]*?target_division[\s\S]*?target_weekday[\s\S]*?target_time_slot[\s\S]*?target_class_group/i
  );
  assert.match(sql, /drop\s+index\s+if\s+exists\s+public\.olli_schedule_waitlist_one_active_per_slot_idx/i);
});

test('all active waitlist write paths use the same division and class-group slot identity', () => {
  const sql = migrationSql();

  for (const fn of [
    'olli_schedule_add_waitlist',
    'olli_schedule_add_guest_entry',
    'olli_schedule_update_waitlist_target',
    'olli_schedule_change'
  ]) {
    assert.match(sql, new RegExp(fn, 'i'), fn + ' must be covered by the migration');
  }

  assert.match(sql, /w\.target_division\s*=\s*v_division/i);
  assert.match(sql, /w\.target_class_group\s*=\s*v_class_group/i);
  assert.match(sql, /w\.target_class_group\s*=\s*v_group/i);
  assert.match(
    sql,
    /':wait:'\s*\|\|\s*v_division[\s\S]*?v_class_group/i,
    'guest wait advisory lock must distinguish A/B classes'
  );
});

test('legacy writes and old schedule history remain compatible with target_division', () => {
  const sql = migrationSql();

  assert.match(sql, /function\s+private\.olli_schedule_waitlist_fill_target_division/i);
  assert.match(sql, /before\s+insert\s+or\s+update\s+of\s+academy_id\s*,\s*student_id\s*,\s*guest_division\s*,\s*target_division/i);
  assert.match(sql, /v_current\s*-\s*'updated_at'\s*-\s*'target_division'/i);
  assert.match(sql, /v_item\.new_data\s*-\s*'updated_at'\s*-\s*'target_division'/i);
  assert.match(sql, /guest_division\s*=\s*v_item\.old_data->>'guest_division'/i);
  assert.match(sql, /target_class_group\s*=\s*coalesce\(nullif\(v_item\.old_data->>'target_class_group'/i);
});

test('legacy nine-argument schedule change delegates to canonical A/B-aware change', () => {
  const sql = migrationSql();

  assert.match(
    sql,
    /p_allow_wait\s+boolean\s+DEFAULT\s+true[\s\S]*?select\s+public\.olli_schedule_change\([\s\S]*?p_allow_wait\s*,\s*'A'/i
  );
});

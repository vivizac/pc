const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const file = fs.readdirSync(migrationDir)
  .filter((name) => /_makeup_closed_day_guard\.sql$/.test(name))
  .sort()
  .at(-1);

function source() {
  assert.ok(file, 'makeup closed-day guard migration must exist');
  return fs.readFileSync(path.join(migrationDir, file), 'utf8');
}

test('final makeup write rejects a closed day before locks or inserts', () => {
  const sql = source();
  const start = sql.toLowerCase().indexOf(
    'create or replace function public.olli_schedule_add_one_time'
  );
  assert.ok(start >= 0, 'makeup write function definition must exist');
  const block = sql.slice(start);

  const closed = block.indexOf('private.olli_schedule_is_closed_day');
  const lock = block.indexOf('pg_advisory_xact_lock');
  const insert = block.indexOf('insert into public.olli_schedule_one_time_sessions');

  assert.ok(closed >= 0, 'closed-day check must exist');
  assert.ok(lock > closed, 'closed-day check must happen before schedule locks');
  assert.ok(insert > closed, 'closed-day check must happen before one-time insert');
  assert.match(block, /공휴일에는 보강을 등록할 수 없습니다/);
});

test('closed-day hardening preserves existing server-side makeup integrity checks', () => {
  const sql = source();
  assert.match(sql, /private\.olli_schedule_can_access/);
  assert.match(sql, /private\.olli_schedule_slot_is_valid/);
  assert.match(sql, /private\.olli_schedule_group_is_enabled/);
  assert.match(sql, /private\.olli_schedule_capacity/);
  assert.match(sql, /olli_schedule_attendance_session_overrides/);
  assert.match(sql, /when unique_violation/);
  assert.match(sql, /'unchanged', true/);
});

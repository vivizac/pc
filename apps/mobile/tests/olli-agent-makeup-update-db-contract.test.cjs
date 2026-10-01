const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const file = fs.readdirSync(migrationDir)
  .filter((name) => /_makeup_update_closed_day_guard\.sql$/.test(name))
  .sort()
  .at(-1);

function source() {
  assert.ok(file, 'makeup update closed-day guard migration must exist');
  return fs.readFileSync(path.join(migrationDir, file), 'utf8');
}

test('final one-time update rejects a closed day before locks or writes', () => {
  const sql = source();
  const start = sql.toLowerCase().indexOf(
    'create or replace function public.olli_schedule_update_one_time_session'
  );
  assert.ok(start >= 0);
  const block = sql.slice(start);
  const closed = block.indexOf('private.olli_schedule_is_closed_day');
  const lock = block.indexOf('pg_advisory_xact_lock');
  const update = block.indexOf('update public.olli_schedule_one_time_sessions');

  assert.ok(closed >= 0);
  assert.ok(lock > closed);
  assert.ok(update > closed);
  assert.match(block, /공휴일에는 보강·체험 수업을 변경할 수 없습니다/);
});

test('closed-day update hardening preserves existing integrity gates', () => {
  const sql = source();
  assert.match(sql, /private\.olli_schedule_can_access/);
  assert.match(sql, /출결 정보가 있는 보강은 날짜·시간·반을 변경할 수 없습니다/);
  assert.match(sql, /private\.olli_schedule_slot_is_valid/);
  assert.match(sql, /private\.olli_schedule_group_is_enabled/);
  assert.match(sql, /private\.olli_schedule_capacity/);
  assert.match(sql, /same date|같은 날짜와 시간에 이미 등록된 수업이 있습니다/);
  assert.match(sql, /o\.id <> v_item\.id/);
  assert.match(sql, /'unchanged', true/);
});

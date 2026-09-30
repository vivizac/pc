const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const file = fs.readdirSync(migrationDir)
  .filter((name) => /_agent_student_pickups_range_read_rpc\.sql$/.test(name))
  .sort()
  .at(-1);

function sql() {
  assert.ok(file, 'pickup Agent read migration must exist');
  return fs.readFileSync(path.join(migrationDir, file), 'utf8');
}

test('pickup Agent RPC is scoped to one student and validates academy session access', () => {
  const source=sql();
  assert.match(source,/olli_schedule_can_access\(p_session_token, p_academy_id\)/);
  assert.match(source,/p\.student_id\s*=\s*p_student_id/);
  assert.match(source,/s\.id\s*=\s*p_student_id/);
  assert.match(source,/s\.academy_id\s*=\s*p_academy_id/);
});

test('pickup Agent RPC resolves overlapping legacy rows deterministically without mutating them', () => {
  const source=sql();
  assert.match(source,/row_number\(\) over\s*\([\s\S]*partition by d\.session_date, p\.class_time[\s\S]*p\.effective_from desc[\s\S]*p\.updated_at desc/i);
  assert.match(source,/where precedence_rank = 1/i);
  assert.doesNotMatch(source,/delete\s+from\s+public\.olli_schedule_pickups/i);
  assert.doesNotMatch(source,/update\s+public\.olli_schedule_pickups/i);
  assert.doesNotMatch(source,/insert\s+into\s+public\.olli_schedule_pickups/i);
});

test('pickup Agent RPC excludes closed days and does not return student or row identifiers', () => {
  const source=sql();
  assert.match(source,/not private\.olli_schedule_is_closed_day\(p_academy_id, d\.session_date\)/);
  assert.match(source,/'arrival_label'/);
  assert.match(source,/'arrival_time'/);
  assert.match(source,/'dropoff_label'/);
  assert.doesNotMatch(source,/'student_id'|'pickup_id'|'academy_id'|'session_token'/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const file = fs.readdirSync(migrationDir)
  .filter((name) => /_schedule_availability_rules_and_read_rpc\.sql$/.test(name))
  .sort()
  .at(-1);

function sql() {
  assert.ok(file, 'schedule availability migration must exist');
  return fs.readFileSync(path.join(migrationDir, file), 'utf8');
}

function availabilityBlock(source) {
  const start = source.toLowerCase().lastIndexOf(
    'create or replace function public.olli_schedule_availability_slots'
  );
  assert.ok(start >= 0, 'availability RPC definition must exist');
  return source.slice(start);
}

test('schedule availability migration makes half-hour and merged kinder group rules canonical', () => {
  const source = sql();
  assert.match(source, /olli_schedule_timetable_mode\(p_academy_id\)\s*=\s*'half_hour'[\s\S]*?then false/i);
  assert.match(source, /olli_schedule_kinder_class_merges/i);
  assert.match(source, /not exists\s*\([\s\S]*?m\.academy_id\s*=\s*p_academy_id[\s\S]*?m\.weekday\s*=\s*p_weekday[\s\S]*?m\.time_slot\s*=\s*p_time_slot/i);
});

test('new makeup, trial and wait writes all use canonical slot validation', () => {
  const source = sql();
  const matches = source.match(/private\.olli_schedule_slot_is_valid\(/g) || [];
  assert.ok(matches.length >= 4, 'canonical slot validation should cover add/update write paths and read RPC');
  assert.match(source, /create or replace function public\.olli_schedule_add_guest_entry/i);
  assert.match(source, /create or replace function public\.olli_schedule_add_waitlist/i);
  assert.match(source, /create or replace function public\.olli_schedule_update_one_time_session/i);
});

test('legacy six-argument makeup write delegates to the class-group aware implementation', () => {
  const source = sql();
  assert.match(
    source,
    /create or replace function public\.olli_schedule_add_one_time\([\s\S]*?p_note text DEFAULT ''::text\)[\s\S]*?language sql[\s\S]*?select public\.olli_schedule_add_one_time\([\s\S]*?p_note\s*,\s*'A'/i
  );
});

test('availability RPC is read-only aggregate output and only makeup subtracts dated absences', () => {
  const block = availabilityBlock(sql());
  assert.match(block, /v_purpose\s+not in\s*\('regular', 'makeup', 'trial', 'wait'\)/i);
  assert.match(block, /case when v_purpose\s*=\s*'makeup' then/i);
  assert.match(block, /olli_schedule_attendance_session_overrides/i);
  assert.match(block, /'waitlist_open'/i);
  assert.match(block, /'remaining'/i);
  assert.match(block, /'timetable_mode'/i);
  assert.doesNotMatch(block, /insert\s+into\s+public\./i);
  assert.doesNotMatch(block, /update\s+public\./i);
  assert.doesNotMatch(block, /delete\s+from\s+public\./i);
  assert.doesNotMatch(block, /'student_id'|'student_name'|'teacher_member_id'|'academy_id'|'session_token'/i);
});

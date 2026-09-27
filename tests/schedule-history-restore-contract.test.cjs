const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260928070000_complete_schedule_history_restore.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');

test('schedule history restore keeps the existing public RPC contract', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.olli_schedule_restore_history\(p_session_token text, p_academy_id uuid, p_transaction_id bigint\)/i);
  assert.match(sql, /RETURNS jsonb/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /SET search_path TO ''/i);
});

test('schedule history restore preserves stale-restore safety and restore bookkeeping', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /v_current is null or \(v_current - 'updated_at'\) <> \(v_item\.new_data - 'updated_at'\)/);
  assert.match(sql, /'conflict', true/);
  assert.match(sql, /set_config\('olli\.restore_of_transaction_id'/);
  assert.match(sql, /restore_transaction_id = v_restore_txid/);
});

test('enrollment update restore includes current class and session-order fields', () => {
  assert.match(sql, /update public\.olli_schedule_enrollments set[\s\S]*?class_group = coalesce\(nullif\(v_item\.old_data->>'class_group', ''\), 'A'\)/);
  assert.match(sql, /update public\.olli_schedule_enrollments set[\s\S]*?session_order = nullif\(v_item\.old_data->>'session_order', ''\)::smallint/);
});

test('waitlist update restore includes class and guest fields', () => {
  const block = sql.match(/update public\.olli_schedule_waitlist set[\s\S]*?where id = v_item\.row_id;/)?.[0] || '';
  assert.match(block, /target_class_group = coalesce\(nullif\(v_item\.old_data->>'target_class_group', ''\), 'A'\)/);
  assert.match(block, /guest_name = nullif\(v_item\.old_data->>'guest_name', ''\)/);
  assert.match(block, /guest_division = nullif\(v_item\.old_data->>'guest_division', ''\)/);
});

test('change update restore includes target class group', () => {
  const block = sql.match(/update public\.olli_schedule_changes set[\s\S]*?where id = v_item\.row_id;/)?.[0] || '';
  assert.match(block, /target_class_group = nullif\(v_item\.old_data->>'target_class_group', ''\)/);
});

test('one-time update restore includes class and guest fields', () => {
  const block = sql.match(/update public\.olli_schedule_one_time_sessions set[\s\S]*?where id = v_item\.row_id;/)?.[0] || '';
  assert.match(block, /class_group = coalesce\(nullif\(v_item\.old_data->>'class_group', ''\), 'A'\)/);
  assert.match(block, /guest_name = nullif\(v_item\.old_data->>'guest_name', ''\)/);
  assert.match(block, /guest_division = nullif\(v_item\.old_data->>'guest_division', ''\)/);
});

test('delete restore still uses full audit snapshots for row recreation', () => {
  assert.match(sql, /jsonb_populate_record\(null::public\.olli_schedule_changes, v_item\.old_data\)/);
  assert.match(sql, /jsonb_populate_record\(null::public\.olli_schedule_waitlist, v_item\.old_data\)/);
  assert.match(sql, /jsonb_populate_record\(null::public\.olli_schedule_one_time_sessions, v_item\.old_data\)/);
  assert.match(sql, /jsonb_populate_record\(null::public\.olli_schedule_enrollments, v_item\.old_data\)/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations',
  '20261028055746_academy_task_lifecycle_and_recurring.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

test('only the intended primary academy receives 12 fixed rules', () => {
  assert.match(sql, /a\.academy_code='VIVI-5578'/);
  assert.match(sql, /a\.academy_name='비비작아이성향미술학원'/);
  const keys = [
    'fee-notice', 'ads-management', 'lobby-windows', 'feedback-review',
    'elementary-feedback', 'overdue-fee-message', 'weekly-preparation',
    'monthly-registrations', 'monthly-consultations', 'unregistered-followup',
    'material-stock', 'academy-performance'
  ];
  for (const key of keys) assert.match(sql, new RegExp("'"+key+"'"));
  assert.equal(keys.length, 12);
  assert.match(sql, /'2026-10-28'::date/);
});

test('task cleanup is limited to configured academies and never purges unfinished work', () => {
  const housekeeping = sql.slice(sql.indexOf('-- Never purge unfinished work'));
  assert.match(housekeeping, /exists \(\s*select 1 from private\.olli_academy_task_rules scope/);
  assert.match(housekeeping, /t\.deleted_at is null and t\.completed/);
  assert.match(housekeeping, /coalesce\(t\.completed_at,t\.created_at\) <= now\(\)-interval '24 hours'/);
  assert.match(housekeeping, /t\.deleted_at is not null and t\.deleted_at <= now\(\)-interval '7 days'/);
  assert.doesNotMatch(housekeeping.slice(0, housekeeping.indexOf('-- Preserve the existing session')),
    /delete from public\.(?:students|summary_feedbacks|academy_members)/i);
});

test('recurring rules survive occurrence deletion and maintain one last-generated state', () => {
  assert.match(sql, /last_generated_on date/);
  assert.match(sql, /unique \(academy_id,rule_key\)/);
  assert.match(sql, /for update of r/);
  assert.match(sql, /set last_generated_on=v_due/);
  assert.match(sql, /date_trunc\('month',v_rule\.last_generated_on\)=date_trunc\('month',v_due\)/);
  assert.match(sql, /v_due := date_trunc\('week',p_today\)::date \+ 4/);
  assert.match(sql, /v_due := v_first \+ \(\(8 - extract\(dow from v_first\)::integer\) % 7\)/);
  assert.match(sql, /least\(v_rule\.day_of_month::integer,extract\(day from v_last\)::integer\)/);
  assert.match(sql, /private\.olli_teacher_payroll_settings/);
});

test('payroll tasks remain owner-only in read, complete and delete operations', () => {
  assert.match(sql, /add column if not exists owner_only boolean not null default false/);
  assert.match(sql, /v_rule\.repeat_kind='teacher_payday'/);
  assert.equal((sql.match(/not owner_only or v_role='owner'/g) || []).length, 3);
  assert.match(sql, /p_session_token text,p_academy_id uuid,p_task_id uuid,p_completed boolean/);
});

test('list filters old completed records before limiting; cron runs without PC sessions', () => {
  const listStart = sql.indexOf('create or replace function public.olli_academy_tasks_list');
  const listEnd = sql.indexOf('-- Keep owner-only tasks private', listStart);
  const listSql = sql.slice(listStart, listEnd);
  assert.match(listSql, /not completed or coalesce\(completed_at,created_at\)>now\(\)-interval '24 hours'/);
  assert.ok(listSql.indexOf('coalesce(completed_at,created_at)') < listSql.indexOf('limit v_limit'));
  assert.match(sql, /'olli-academy-task-maintenance-v1'/);
  assert.match(sql, /'15 \* \* \* \*'/);
  assert.match(sql, /revoke all on function private\.olli_academy_tasks_maintenance\(date\)/);
});

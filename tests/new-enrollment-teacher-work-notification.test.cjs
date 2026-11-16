'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20261116073000_olli_new_enrollment_targeted_teacher_work_badges.sql'
), 'utf8');
const emitter = migration.split('create or replace function private.olli_team_talk_emit_schedule_event(')[1]?.split('CREATE OR REPLACE FUNCTION public.olli_team_chat_system_push_targets(')[0] || '';
const target = migration.split('CREATE OR REPLACE FUNCTION public.olli_team_chat_system_push_targets(')[1] || '';

test('registration notifications use actual date-specific class teacher and active academy membership', () => {
  assert.match(emitter, /private\.olli_team_talk_effective_teacher\(/);
  assert.match(emitter, /if p_event_type = 'registration_add' and not exists \(/);
  assert.match(emitter, /m\.id = v_target_member_id/);
  assert.match(emitter, /m\.academy_id = p_academy_id/);
  assert.match(emitter, /m\.status = 'active'/);
  assert.match(emitter, /m\.account_id is not null/);
  assert.ok(emitter.indexOf('if p_event_type = \'registration_add\' and not exists') < emitter.indexOf('insert into public.olli_team_chat_bot_events'));
});

test('one idempotent targeted Work mention is recorded before existing push', () => {
  assert.match(emitter, /on conflict \(academy_id, event_key\) do nothing/);
  assert.match(emitter, /if p_event_type = 'registration_add' then\s+insert into public\.olli_team_chat_mentions/);
  assert.match(emitter, /values \(p_academy_id, v_message_id, v_target_member_id\)/);
  assert.match(emitter, /on conflict \(message_id, member_id\) do nothing/);
  assert.ok(emitter.indexOf('insert into public.olli_team_chat_mentions') < emitter.indexOf('perform net.http_post('));
  assert.match(emitter, /when 'trial_add' then '체험 등록'/);
  assert.match(emitter, /when 'pickup_add' then '픽업 등록'/);
});

test('system push carries only target member unread Work count for app icon', () => {
  assert.match(target, /'unread_count', \(/);
  assert.match(target, /st\.member_id = m\.id/);
  assert.match(target, /own_mention\.member_id = m\.id/);
  assert.match(target, /own_mention\.read_at is null/);
  assert.match(target, /material\.event_type = 'created'/);
  assert.match(target, /s\.member_id = p_member_id/);
  assert.match(target, /d\.message_id = p_message_id/);
});

test('migration leaves timetable save, core sync, student data and existing read states unchanged', () => {
  assert.doesNotMatch(migration, /\b(?:drop|truncate)\s+(?:table|function)\b/i);
  assert.doesNotMatch(migration, /\b(?:delete|update)\s+(?:from\s+)?public\.students\b/i);
  assert.doesNotMatch(migration, /\b(?:delete|update)\s+(?:from\s+)?public\.olli_schedule_enrollments\b/i);
  assert.doesNotMatch(migration, /update\s+public\.olli_team_chat_member_state/i);
  assert.match(migration, /commit;\s*$/);
});

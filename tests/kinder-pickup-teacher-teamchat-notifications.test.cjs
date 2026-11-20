'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261120062547_kinder_pickup_teacher_teamchat_notifications.sql'),'utf8');
const emission = sql.split('create or replace function private.olli_team_talk_emit_schedule_event(')[1]?.split('CREATE OR REPLACE FUNCTION public.olli_team_chat_system_push_targets(')[0] || '';
const targets = sql.split('CREATE OR REPLACE FUNCTION public.olli_team_chat_system_push_targets(')[1]?.split('create or replace function private.olli_team_talk_pickup_trigger(')[0] || '';
const pickup = sql.split('create or replace function private.olli_team_talk_pickup_trigger(')[1]?.split('create or replace function private.olli_team_talk_pickup_override_trigger(')[0] || '';
const late = sql.split('create or replace function private.olli_team_talk_pickup_override_trigger(')[1] || '';

test('new enrollment notification retains original single teacher, account, and unread badge semantics',()=>{
  assert.match(emission,/private\.olli_team_talk_effective_teacher\(/);
  assert.match(emission,/p_event_type = 'registration_add' and not exists/);
  assert.match(emission,/p_event_type = 'registration_add' then[\s\S]*?olli_team_chat_mentions/);
  assert.match(emission,/and m\.account_id is not null/);
  assert.match(emission,/p_event_type not in \('registration_add','pickup_add','pickup_move'\)/);
});
test('weekly, one-day and drag-moved pickups use original trigger, target date, no duplicate event',()=>{
  assert.match(pickup,/v_action not in \('pickup_add','pickup_daily_add','pickup_drag_move'\)/);
  assert.match(pickup,/'pickup:move:' \|\| new\.id::text/);
  assert.match(pickup,/case when v_action = 'pickup_drag_move' then 'pickup_move' else 'pickup_add' end/);
  assert.match(pickup,/olli_team_talk_next_class_date\(v_effective, new\.weekday\)/);
  assert.match(pickup,/tg_op = 'UPDATE'/);
  assert.match(emission,/on conflict \(academy_id, event_key\) do nothing/);
});
test('date-specific kinder teachers includes regular and all A or B daily overrides, not unrelated teachers',()=>{
  assert.match(emission,/from public\.olli_schedule_class_teachers ct/);
  assert.match(emission,/ct\.division = 'kinder'/);
  assert.match(emission,/ct\.weekday = extract\(isodow from p_class_date\)::integer/);
  assert.match(emission,/ct\.time_slot = p_time_slot/);
  assert.match(emission,/select o\.regular_teacher_member_id/);
  assert.match(emission,/select o\.teacher_member_id/);
  assert.match(emission,/o\.session_date = p_class_date/);
  assert.match(emission,/o\.time_slot = p_time_slot/);
  assert.match(emission,/array_agg\(distinct m\.id order by m\.id\)/);
  assert.match(emission,/m\.status = 'active'/);
});
test('one message and two targeted mentions/push with existing per-member Work unread count and authorization',()=>{
  assert.match(emission,/when 'pickup_move' then '픽업 이동'/);
  assert.match(emission,/to_char\(p_class_date, 'YYYY\.MM\.DD'\)/);
  assert.match(emission,/insert into public\.olli_team_chat_messages/);
  assert.match(emission,/select p_academy_id, v_message_id, unnest\(v_pickup_targets\)/);
  assert.match(emission,/foreach v_dispatch_member_id in array v_dispatch_targets loop/);
  assert.match(emission,/'target_member_id',v_dispatch_member_id/);
  assert.match(targets,/e\.event_type in \('pickup_add','pickup_move'\)/);
  assert.match(targets,/mt\.member_id = p_member_id/);
  assert.match(targets,/s\.member_id = p_member_id/);
  assert.match(targets,/'unread_count', \(/);
});
test('late substitute assignment gets missing targeted notice once, not a duplicated team message',()=>{
  assert.match(late,/after insert or update of teacher_member_id/);
  assert.match(late,/e\.class_date = new\.session_date/);
  assert.match(late,/e\.time_slot = new\.time_slot/);
  assert.match(late,/on conflict \(message_id, member_id\) do nothing/);
  assert.match(late,/returning member_id into v_mentioned/);
  assert.match(late,/if v_mentioned is not null and nullif\(v_secret, ''\) is not null/);
  assert.doesNotMatch(late,/insert into public\.olli_team_chat_messages/);
});
test('notices never alter saved student, pickup, attendance, sync, or legacy read states',()=>{
  assert.doesNotMatch(sql,/\b(?:delete|truncate|update)\s+(?:from\s+)?public\.(?:students|olli_schedule_pickups|olli_schedule_enrollments|olli_team_chat_member_state)\b/i);
  assert.doesNotMatch(sql,/create or replace function public\.olli_schedule_move_pickup_v1/);
  assert.doesNotMatch(sql,/create or replace function public\.olli_schedule_save_pickup_v4/);
  assert.match(sql,/commit;\s*$/);
});

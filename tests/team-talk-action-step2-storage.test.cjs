const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20260921191000_team_talk_action_storage_step2.sql',
  'utf8'
);

test('step 2 persists action-card states without exposing schedule execution', () => {
  assert.match(sql, /create table if not exists public\.olli_team_chat_actions/i);
  assert.match(sql, /'pending'::text,'completed'::text,'cancelled'::text,'failed'::text/);
  assert.match(sql, /revision bigint not null default 1/i);
  assert.match(sql, /add_class_once/);
  assert.match(sql, /cancel_class_once/);

  assert.match(
    sql,
    /drop function if exists public\.olli_team_chat_action_execute\(text, uuid, uuid\)/i
  );
  assert.doesNotMatch(sql, /create or replace function public\.olli_team_chat_action_execute/i);
  assert.doesNotMatch(sql, /public\.olli_schedule_execute\s*\(/i);
});

test('action payload stays server-side while chat list exposes only card metadata', () => {
  const listStart = sql.indexOf('create or replace function public.olli_team_chat_list');
  assert.ok(listStart >= 0);
  const listSql = sql.slice(listStart);

  assert.match(listSql, /'action_type',ac\.action_type/);
  assert.match(listSql, /'status',ac\.status/);
  assert.match(listSql, /'revision',ac\.revision/);
  assert.match(listSql, /'result_message_id',ac\.result_message_id/);
  assert.doesNotMatch(listSql, /'action_payload',ac\.action_payload/);
});

test('action table is not directly readable by browser roles', () => {
  assert.match(
    sql,
    /revoke all on table public\.olli_team_chat_actions from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.olli_team_chat_send_action[^;]+from public/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.olli_team_chat_action_cancel[^;]+from public/i
  );
});

test('cancellation is idempotent and revisioned', () => {
  assert.match(sql, /if v_action\.status='pending' then/i);
  assert.match(sql, /revision=revision\+1/i);
  assert.match(sql, /if v_action\.status='cancelled' then/i);
  assert.match(sql, /'changed',false/i);
});

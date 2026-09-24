const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260925170000_add_team_chat_delta_sync.sql'),
  'utf8'
);

test('creates a private durable chat change log', () => {
  assert.match(sql, /create table if not exists private\.olli_team_chat_change_events/i);
  assert.match(sql, /id bigint generated always as identity primary key/i);
  assert.match(sql, /alter table private\.olli_team_chat_change_events enable row level security/i);
  assert.match(sql, /revoke all on table private\.olli_team_chat_change_events from public, anon, authenticated/i);
});

test('does not log normal message inserts into the mutation cursor', () => {
  assert.match(sql, /after update or delete on public\.olli_team_chat_messages/i);
  assert.doesNotMatch(sql, /after insert or update or delete on public\.olli_team_chat_messages/i);
});

test('logs mutable message-scoped sources and read state', () => {
  for (const table of [
    'olli_team_chat_actions',
    'olli_team_chat_attachments',
    'olli_team_chat_mentions',
    'olli_team_chat_member_state'
  ]) {
    assert.match(sql, new RegExp('on public\\.' + table, 'i'));
  }
  assert.match(sql, /'message_mutated'/i);
  assert.match(sql, /'action_mutated'/i);
  assert.match(sql, /'attachment_mutated'/i);
  assert.match(sql, /'mention_mutated'/i);
  assert.match(sql, /'read_state'/i);
});

test('only message/action/attachment trigger rows emit their own wake signal', () => {
  const body = sql.match(/create or replace function private\.olli_team_chat_log_mutation\(\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i)?.[1] || '';
  assert.match(body, /v_change_type in \('message_mutated', 'action_mutated', 'attachment_mutated'\)/i);
  assert.match(body, /private\.olli_realtime_send_signal/i);
  assert.doesNotMatch(body, /v_change_type in \([^)]*mention_mutated[^)]*\)/i);
});

test('delta RPC has independent message and mutation cursors', () => {
  assert.match(sql, /public\.olli_team_chat_delta\(/i);
  assert.match(sql, /p_after_message_id bigint default null/i);
  assert.match(sql, /p_after_change_id bigint default null/i);
  assert.match(sql, /'next_message_id'/i);
  assert.match(sql, /'next_change_id'/i);
  assert.match(sql, /'has_more_messages'/i);
  assert.match(sql, /'has_more_changes'/i);
});

test('baseline mode returns heads without replaying old changes', () => {
  assert.match(sql, /v_baseline boolean := p_after_message_id is null and p_after_change_id is null/i);
  assert.match(sql, /'baseline', true/i);
  assert.match(sql, /'new_messages', '\[\]'::jsonb/i);
  assert.match(sql, /'changed_messages', '\[\]'::jsonb/i);
});

test('forward message candidates advance across deleted rows too', () => {
  const body = sql.match(/create or replace function public\.olli_team_chat_delta[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i)?.[1] || '';
  assert.match(body, /from public\.olli_team_chat_messages m[\s\S]*m\.id > v_message_cursor[\s\S]*order by m\.id asc[\s\S]*limit v_limit/i);
  assert.doesNotMatch(body, /m\.id > v_message_cursor[\s\S]*m\.deleted_at is null[\s\S]*order by m\.id asc/i);
});

test('read-state mutation expands to affected message ids but caps local-window refresh', () => {
  const body = sql.match(/create or replace function public\.olli_team_chat_delta[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i)?.[1] || '';
  assert.match(body, /e\.change_type = 'read_state'/i);
  assert.match(body, /m\.id > least\(coalesce\(e\.from_message_id, 0\), coalesce\(e\.to_message_id, 0\)\)/i);
  assert.match(body, /limit 500/i);
});

test('deleted ids are returned separately from changed message payloads', () => {
  assert.match(sql, /v_deleted_message_ids jsonb/i);
  assert.match(sql, /m\.deleted_at is not null/i);
  assert.match(sql, /'deleted_message_ids', v_deleted_message_ids/i);
});

test('existing full snapshot RPC is not replaced in this migration', () => {
  assert.doesNotMatch(sql, /create or replace function public\.olli_team_chat_list\(/i);
});

test('manifest now exposes durable chat mutation marker', () => {
  assert.match(sql, /'chat_mutations'/i);
  assert.match(sql, /'kind', 'change_id'/i);
  assert.match(sql, /'coverage', 'message_action_attachment_mention_read_state'/i);
  assert.doesNotMatch(sql, /'chat_mutations', 'no_durable_change_cursor'/i);
});

test('public delta RPC keeps existing OLLI access boundary', () => {
  const body = sql.match(/create or replace function public\.olli_team_chat_delta[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i)?.[1] || '';
  assert.match(body, /private\.olli_realtime_can_access\(p_session_token, p_academy_id\)/i);
  assert.match(sql, /revoke all on function public\.olli_team_chat_delta\(text, uuid, bigint, bigint, integer\) from public/i);
  assert.match(sql, /grant execute on function public\.olli_team_chat_delta\(text, uuid, bigint, bigint, integer\) to anon, authenticated/i);
});

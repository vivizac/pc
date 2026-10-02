const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync(
  'supabase/migrations/20261002072000_material_ordered_requester_notification.sql',
  'utf8'
);

test('material ordered transition creates one Olli AI bubble for the original requester', () => {
  assert.match(sql, /if v_status = 'ordered' and v_previous_status is distinct from 'ordered' then/i);
  assert.match(sql, /sender_name_snapshot,[\s\S]*message_type,[\s\S]*body/);
  assert.match(sql, /null,[\s\S]*'올리',[\s\S]*'ai',[\s\S]*v_notification_body/);
  assert.match(sql, /'재료 주문이 완료됐어요\.'/);
  assert.match(sql, /'요청자 · '/);
  assert.match(sql, /'품목 · '/);
  assert.match(sql, /'수량 · '/);
});

test('material ordered notification targets only the original requester through Team Chat mentions', () => {
  assert.match(sql, /insert into public\.olli_team_chat_mentions/);
  assert.match(sql, /v_request\.requested_by_member_id/);
  assert.match(sql, /on conflict \(message_id, member_id\) do nothing/i);
});

test('material ordered bubble does not attach a material event confirmation action', () => {
  const insert = sql.match(
    /insert into public\.olli_team_chat_messages[\s\S]*?returning id into v_notification_message_id;/i
  )?.[0] || '';
  assert.match(insert, /material_request_id/);
  assert.doesNotMatch(insert, /material_event_id/);
});

test('realtime signal uses notification message id so only the targeted unread summary can toast', () => {
  assert.match(
    sql,
    /private\.olli_realtime_send_signal\([\s\S]*coalesce\(v_notification_message_id, v_request\.revision\)/
  );
});

test('status RPC returns notification ids without changing its existing mutation contract', () => {
  assert.match(sql, /'request_id', v_request\.id/);
  assert.match(sql, /'status', v_request\.status/);
  assert.match(sql, /'revision', v_request\.revision/);
  assert.match(sql, /'notification_message_id', v_notification_message_id/);
  assert.match(sql, /'notification_member_id'/);
});

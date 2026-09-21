const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20260921170000_team_talk_pickup_notifications.sql', 'utf8');

test('Team Talk settings lists pickup registration and cancellation automatic alerts', () => {
  assert.match(settings, /<span>픽업 등록<\/span>/);
  assert.match(settings, /<span>픽업 취소<\/span>/);
  assert.match(settings, /AI 사용 여부와 관계없이 등록과 취소가 생기면 팀톡에 자동으로 알려줍니다/);
});

test('pickup automatic notifications add event types and trigger only pickup add/remove actions', () => {
  assert.match(sql, /'pickup_add'::text/);
  assert.match(sql, /'pickup_cancel'::text/);
  assert.match(sql, /v_action <> 'pickup_add'/);
  assert.match(sql, /v_action <> 'pickup_remove'/);
  assert.match(sql, /create trigger olli_team_talk_pickup_event/);
});

test('pickup automatic notifications keep AI mode out of the server event decision', () => {
  assert.match(sql, /team_talk_bot_notifications_enabled/);
  assert.doesNotMatch(sql, /team_talk_ai_enabled/);
  assert.doesNotMatch(sql, /ai_enabled/);
});

test('pickup automatic notifications resolve the effective class teacher and include pickup detail', () => {
  assert.match(sql, /private\.olli_team_talk_effective_teacher/);
  assert.match(sql, /to_char\(v_pickup_time, 'HH24:MI'\)/);
  assert.match(sql, /'픽업 등록'/);
  assert.match(sql, /'픽업 취소'/);
});

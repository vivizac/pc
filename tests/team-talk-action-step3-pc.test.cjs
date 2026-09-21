const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('pc-team-talk.js', 'utf8');
const css = fs.readFileSync('pc-team-talk.css', 'utf8');
const sql = fs.readFileSync(
  'supabase/migrations/20260921202000_team_talk_action_execute_step3.sql',
  'utf8'
);

test('AI mutations are prepared before a normal OpenAI reply', () => {
  const prepareIndex = js.indexOf('router.prepareAction(commandText');
  const aiIndex = js.indexOf('const resolved = await resolveAiReply(commandText, current)');
  assert.ok(prepareIndex >= 0);
  assert.ok(aiIndex > prepareIndex);
  assert.match(js, /prepared\.kind === 'action_pending'/);
  assert.match(js, /prepared\.kind === 'action_needs_reason'/);
});

test('PC persists and renders an action card under an AI message', () => {
  assert.match(js, /rpc\('olli_team_chat_send_action'/);
  assert.match(js, /p_action_payload: command/);
  assert.match(js, /if \(item\?\.action\) content\.appendChild\(makeActionCard\(item\.action\)\)/);
  assert.match(js, /olliPcTeamTalkActionButton secondary/);
  assert.match(js, /olliPcTeamTalkActionButton primary/);
  assert.match(css, /\.olliPcTeamTalkActionCard/);
  assert.match(css, /\.olliPcTeamTalkActionButton\.primary/);
});

test('PC action buttons send action id only to execute or cancel RPCs', () => {
  assert.match(js, /'olli_team_chat_action_execute'/);
  assert.match(js, /'olli_team_chat_action_cancel'/);
  assert.match(js, /p_action_id: actionId/);

  const start = sql.indexOf('create or replace function public.olli_team_chat_action_execute');
  const end = sql.indexOf('returns jsonb', start);
  const signature = sql.slice(start, end);
  assert.match(signature, /p_action_id uuid/);
  assert.doesNotMatch(signature, /p_action_payload/);
});

test('server locks pending action and creates a system result message', () => {
  assert.match(sql, /where a\.id=p_action_id and a\.academy_id=p_academy_id\s*\n\s*for update;/);
  assert.match(sql, /if v_action\.status <> 'pending' then/);
  assert.match(sql, /set status='completed'/);
  assert.match(sql, /set status='failed'/);
  assert.match(sql, /'system',v_body/);
  assert.match(sql, /revision=revision\+1/);
});

test('reason-required cancellation is rejected before schedule cancellation runs', () => {
  const reasonIndex = sql.indexOf("if v_type in ('cancel_makeup','cancel_trial') and v_reason='' then");
  const mutationIndex = sql.indexOf("elsif v_type in ('cancel_class_once','cancel_makeup','cancel_trial') then");
  assert.ok(reasonIndex >= 0);
  assert.ok(mutationIndex > reasonIndex);
});

test('action execution reuses existing schedule APIs rather than writing schedule tables directly', () => {
  const start = sql.indexOf('create or replace function public.olli_team_chat_action_execute');
  const body = sql.slice(start);
  assert.match(body, /public\.olli_schedule_execute\(/);
  assert.match(body, /public\.olli_schedule_save_pickup_v2\(/);
  assert.match(body, /public\.olli_schedule_set_attendance_session_status_v2\(/);
  assert.doesNotMatch(body, /insert into public\.olli_schedule_one_time_sessions/i);
  assert.doesNotMatch(body, /update public\.olli_schedule_enrollments/i);
});

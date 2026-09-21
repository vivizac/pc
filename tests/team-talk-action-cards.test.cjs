const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const router = fs.readFileSync('olli-command-router-common.js', 'utf8');
const schedule = fs.readFileSync('olli-command-schedule-common.js', 'utf8');
const talk = fs.readFileSync('pc-team-talk.js', 'utf8');
const css = fs.readFileSync('pc-team-talk.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260921172500_team_talk_action_cards.sql', 'utf8');

test('Team Talk reads schedule and pickup data before falling back to OpenAI', () => {
  assert.match(router, /async function queryTeamTalk/);
  assert.match(router, /parsePickupQueryIntent/);
  assert.match(router, /findPickups/);
  assert.match(router, /parseAvailableSlotsIntent/);
  assert.match(talk, /router\.queryTeamTalk/);
  const queryIndex = talk.indexOf('router.queryTeamTalk');
  const aiIndex = talk.indexOf('await resolveAiReply', queryIndex);
  assert.ok(queryIndex >= 0 && aiIndex > queryIndex);
});

test('write requests are prepared but never executed before an action-card button', () => {
  assert.match(router, /async function prepareTeamTalkAction/);
  assert.match(router, /kind:'command_confirmation'/);
  assert.match(schedule, /intent:'add_class'/);
  assert.match(schedule, /intent:'cancel_class'/);
  assert.match(talk, /olli_team_chat_send_action/);
  assert.match(talk, /olli_team_chat_action_execute/);
  assert.match(talk, /olli_team_chat_action_cancel/);
  assert.doesNotMatch(talk, /prepareTeamTalkAction[\s\S]{0,800}executePreparedWrite/);
});

test('generic dated class registration reuses one-time schedule safety checks', () => {
  assert.match(schedule, /async function prepareClassCommand/);
  assert.match(schedule, /findAvailableSlots\(\{[\s\S]{0,180}purpose:'makeup'/);
  assert.match(schedule, /duplicateMakeup/);
  assert.match(schedule, /intent === 'add_makeup' \|\| intent === 'add_class'/);
});

test('natural read phrases include 자리 있는지 and 픽업 등록된 학생', () => {
  assert.match(router, /있는지\|있는가/);
  assert.match(router, /function parsePickupQueryIntent/);
  assert.match(router, /explicitMutation/);
  assert.ok(router.includes('.replace(/\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일/g'));
});

test('PC renders persisted action state below Olli messages', () => {
  assert.match(talk, /item\?\.action/);
  assert.match(talk, /makeActionCard/);
  assert.match(css, /\.olliPcTeamTalkActionCard/);
  assert.match(css, /\.olliPcTeamTalkActionBtn\.primary/);
});

test('action records are private and execution is session-aware and idempotent by status', () => {
  assert.match(migration, /alter table public\.olli_team_chat_actions enable row level security/);
  assert.match(migration, /revoke all on table public\.olli_team_chat_actions from anon, authenticated, public/);
  assert.match(migration, /public\.olli_team_chat_action_execute/);
  assert.match(migration, /for update/);
  assert.match(migration, /if v_action\.status <> 'pending'/);
  assert.match(migration, /public\.olli_schedule_execute/);
  assert.match(migration, /values\(p_academy_id,null,'올리','system'/);
});

test('normal PC mention behavior is still isolated from Olli requests', () => {
  assert.match(talk, /const mentionIds = olliRequested \? \[\] : resolveMentionIds\(body\)/);
  assert.match(talk, /olli_team_chat_set_mentions/);
});

test('internal academy read results never enter the OpenAI conversation history', () => {
  assert.match(talk, /let usedOpenAi = false/);
  assert.match(talk, /usedOpenAi = usingAi/);
  assert.match(talk, /if \(usedOpenAi && responseText\) recordAiConversationTurn/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const phoneSettings = fs.readFileSync('olli-settings-team-talk-phone.js', 'utf8');
const pcSettings = fs.readFileSync('../../packages/common/olli-settings-team-talk-common.js', 'utf8');
const phoneTalk = fs.readFileSync('olli-talk-beta.js', 'utf8');
const pcTalk = fs.readFileSync('../pc/pc-team-talk.js', 'utf8');
const quickNote = fs.readFileSync('kinder-feedback.js', 'utf8');
const phoneHtml = fs.readFileSync('index.html', 'utf8');

test('phone and PC TeamChat settings no longer offer an AI or rules toggle', () => {
  for (const settings of [phoneSettings, pcSettings]) {
    assert.doesNotMatch(settings, /olliTeamTalkToggleAi|<strong>올리 AI<\/strong>|규칙 시스템 선택|AI 선택/);
    assert.match(settings, /올리봇 알림/);
    assert.match(settings, /olliTeamTalkToggleBotNotifications/);
  }
  assert.doesNotMatch(phoneSettings, /aiEnabled|ai_enabled|p_ai_enabled|syncAssistantMode|olli-team-talk-ai-mode-changed/);
  assert.match(phoneHtml, /olli-settings-team-talk-phone\.js\?v=20261010-no-ai-settings-toggle-1/);
});

test('bot notification setting remains writable without the legacy AI flag', () => {
  assert.match(phoneSettings, /rpc\('olli_team_talk_settings_get'/);
  assert.match(phoneSettings, /rpc\('olli_team_talk_settings_update'/);
  assert.match(phoneSettings, /p_bot_notifications_enabled:requestedBot/);
  assert.match(phoneSettings, /botNotificationsEnabled:!state\.botNotificationsEnabled/);
  assert.match(phoneSettings, /rpc\('olli_team_talk_avatar_update'/);
  assert.match(phoneSettings, /rpc\('olli_team_talk_background_update'/);
  assert.doesNotMatch(phoneSettings, /p_ai_enabled/);
});

test('TeamChat AI, rules, and QuickNote feedback execution code remain intact', () => {
  assert.match(phoneTalk, /resolveOlliTalkAiReply\(/);
  assert.match(phoneTalk, /interpreterRoute==='rule'/);
  assert.match(pcTalk, /resolveAiReply\(/);
  assert.match(pcTalk, /interpreterRoute==='rule'/);
  assert.match(quickNote, /submitKinderChatFeedback/);
});

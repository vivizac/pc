const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const talk = fs.readFileSync('pc-team-talk.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('shared Team Talk setting keeps AI off by default and persists the academy value', () => {
  assert.match(settings, /aiEnabled:\s*false/);
  assert.match(settings, /p_ai_enabled:\s*!!state\.aiEnabled/);
  assert.match(settings, /state\.aiEnabled = !!result\.ai_enabled/);
});

test('PC composer exposes the same bot or AI trigger contract', () => {
  assert.match(html, /id="olliPcTeamTalkOlli"[^>]*>봇<\/button>/);
  assert.match(talk, /button\.textContent = aiEnabled \? 'AI' : '봇'/);
  assert.match(talk, /usingAi[\s\S]{0,220}resolveAiReply[\s\S]{0,160}resolveBotReply/);
});

test('PC AI requests are authenticated and do not send Team Talk history', () => {
  assert.match(talk, /sessionToken:current\?\.sessionToken \|\| ''/);
  assert.match(talk, /messages:\[\{ role:'user', content:clean\(commandText\) \}\]/);
  assert.doesNotMatch(talk, /messages:\s*state\.messages/);
});

test('normal PC messages still keep the existing mention path', () => {
  assert.match(talk, /const mentionIds = olliRequested \? \[\] : resolveMentionIds\(body\)/);
  assert.match(talk, /olli_team_chat_set_mentions/);
});

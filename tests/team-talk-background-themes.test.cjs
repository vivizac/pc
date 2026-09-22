const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const css = fs.readFileSync('pc-team-talk.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260922162000_team_talk_platform_backgrounds_olli_styles.sql', 'utf8');

test('shared Team Talk settings runtime compiles with six background modes', () => {
  assert.doesNotThrow(() => new vm.Script(settings, { filename:'olli-settings-team-talk-common.js' }));
  assert.match(settings, /const OLLI_BLUE = '#0A84FF'/);
  for (const mode of ['light','dark','light-blue','dark-blue','olli-light','olli-dark']) {
    assert.match(settings, new RegExp("'"+mode+"'"));
  }
  assert.match(settings, /themeOption\('olli-light','올리 스타일 1','연회색 · 파랑 말풍선'\)/);
  assert.match(settings, /themeOption\('olli-dark','올리 스타일 2','어두운 파랑 · 파랑 말풍선'\)/);
});

test('Team Talk background is stored independently for PC and Phone', () => {
  assert.match(settings, /function currentPlatform\(\)/);
  assert.match(settings, /CACHE_PREFIX \+ currentPlatform\(\) \+ '_'/);
  assert.match(settings, /olli_team_talk_background_get/);
  assert.match(settings, /p_platform: currentPlatform\(\)/);
  assert.match(settings, /olli_team_talk_background_update/);
});

test('PC Team Talk supports both Olli styles with blue outgoing bubbles', () => {
  assert.match(css, /data-olli-talk-theme="olli-light"[\s\S]*--olli-pc-talk-bg:#F3F3F3[\s\S]*--olli-pc-talk-outgoing-bg:#0A84FF[\s\S]*--olli-pc-talk-outgoing-text:#fff/);
  assert.match(css, /data-olli-talk-theme="olli-dark"[\s\S]*--olli-pc-talk-bg:#46576E[\s\S]*--olli-pc-talk-outgoing-bg:#0A84FF[\s\S]*--olli-pc-talk-outgoing-text:#fff/);
  assert.match(css, /incoming \.olliPcTeamTalkBubble[\s\S]*var\(--olli-pc-talk-incoming-bg\)/);
  assert.match(css, /outgoing \.olliPcTeamTalkBubble[\s\S]*var\(--olli-pc-talk-outgoing-bg\)/);
});

test('platform background migration preserves old value then separates PC and Phone columns', () => {
  assert.match(migration, /team_talk_background_pc text/);
  assert.match(migration, /team_talk_background_phone text/);
  assert.match(migration, /coalesce\(team_talk_background_pc, team_talk_background, 'dark'\)/);
  assert.match(migration, /coalesce\(team_talk_background_phone, team_talk_background, 'dark'\)/);
  assert.match(migration, /olli_team_talk_background_get/);
  assert.match(migration, /olli_team_talk_background_update/);
  assert.match(migration, /'olli-light','olli-dark'/);
});

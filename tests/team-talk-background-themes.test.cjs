const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const css = fs.readFileSync('pc-team-talk.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260922153000_team_talk_blue_backgrounds.sql', 'utf8');

test('shared Team Talk settings runtime compiles with four background modes', () => {
  assert.doesNotThrow(() => new vm.Script(settings, { filename:'olli-settings-team-talk-common.js' }));
  assert.match(settings, /const LIGHT_BLUE_BG = '#F2F6FC'/);
  assert.match(settings, /const DARK_BLUE_BG = '#46576E'/);
  assert.match(settings, /'light-blue': LIGHT_BLUE_BG/);
  assert.match(settings, /'dark-blue': DARK_BLUE_BG/);
  assert.match(settings, /themeOption\('light-blue','밝은 파랑',LIGHT_BLUE_BG\)/);
  assert.match(settings, /themeOption\('dark-blue','어두운 파랑',DARK_BLUE_BG\)/);
});

test('PC Team Talk has contrast variables for both blue themes', () => {
  assert.match(css, /data-olli-talk-theme="light-blue"[\s\S]*--olli-pc-talk-bg:#F2F6FC/);
  assert.match(css, /data-olli-talk-theme="light-blue"[\s\S]*--olli-pc-talk-title:#1F2D3D/);
  assert.match(css, /data-olli-talk-theme="dark-blue"[\s\S]*--olli-pc-talk-bg:#46576E/);
  assert.match(css, /data-olli-talk-theme="dark-blue"[\s\S]*--olli-pc-talk-title:#fff/);
});

test('PC Team Talk bubble geometry and meta match the Phone Team Talk style', () => {
  assert.match(css, /\.olliPcTeamTalkBubble\{[\s\S]*border-radius:14px[\s\S]*font-size:calc\(14\.5px \* var\(--olli-text-scale\)\)[\s\S]*font-weight:400/);
  assert.match(css, /MessageGroupStart\.incoming[\s\S]*left:-3px;[\s\S]*top:0;[\s\S]*width:19px;[\s\S]*height:13px;[\s\S]*clip-path:path\("M 0 4 C 4 4 7 6 10 9/);
  assert.match(css, /MessageGroupStart\.outgoing[\s\S]*right:-3px;[\s\S]*top:0;[\s\S]*width:19px;[\s\S]*height:13px;[\s\S]*clip-path:path\("M 0 4 C 4 4 7 6 10 9/);
  assert.match(css, /\.olliPcTeamTalkMessageConnected\{margin-top:4px\}/);
  assert.match(css, /\.olliPcTeamTalkMessageMeta\{[\s\S]*justify-content:flex-end;[\s\S]*gap:3px;[\s\S]*padding-bottom:0/);
  assert.match(css, /\.olliPcTeamTalkUnreadCount\{[\s\S]*color:#F4E64C;[\s\S]*font-size:calc\(10px \* var\(--olli-text-scale\)\);[\s\S]*font-weight:600;[\s\S]*line-height:1/);
  assert.match(css, /\.olliPcTeamTalkMessageTime\{[\s\S]*font-size:calc\(10px \* var\(--olli-text-scale\)\);[\s\S]*font-weight:400;[\s\S]*line-height:1/);
});

test('database migration accepts both new theme values without removing gray themes', () => {
  assert.match(migration, /team_talk_background in \('light', 'dark', 'light-blue', 'dark-blue'\)/);
  assert.match(migration, /v_background not in \('light','dark','light-blue','dark-blue'\)/);
  assert.match(migration, /p_ai_enabled boolean/);
});

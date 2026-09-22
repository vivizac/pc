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
  assert.match(settings, /const DARK_BLUE_BG = '#394D6A'/);
  assert.match(settings, /'light-blue': LIGHT_BLUE_BG/);
  assert.match(settings, /'dark-blue': DARK_BLUE_BG/);
  assert.match(settings, /themeOption\('light-blue','밝은 파랑',LIGHT_BLUE_BG\)/);
  assert.match(settings, /themeOption\('dark-blue','어두운 파랑',DARK_BLUE_BG\)/);
});

test('PC Team Talk has contrast variables for both blue themes', () => {
  assert.match(css, /data-olli-talk-theme="light-blue"[\s\S]*--olli-pc-talk-bg:#F2F6FC/);
  assert.match(css, /data-olli-talk-theme="light-blue"[\s\S]*--olli-pc-talk-title:#1F2D3D/);
  assert.match(css, /data-olli-talk-theme="dark-blue"[\s\S]*--olli-pc-talk-bg:#394D6A/);
  assert.match(css, /data-olli-talk-theme="dark-blue"[\s\S]*--olli-pc-talk-title:#fff/);
});

test('database migration accepts both new theme values without removing gray themes', () => {
  assert.match(migration, /team_talk_background in \('light', 'dark', 'light-blue', 'dark-blue'\)/);
  assert.match(migration, /v_background not in \('light','dark','light-blue','dark-blue'\)/);
  assert.match(migration, /p_ai_enabled boolean/);
});

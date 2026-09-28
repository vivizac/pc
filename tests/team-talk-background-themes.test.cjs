const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settings = fs.readFileSync('olli-settings-team-talk-common.js', 'utf8');
const css = fs.readFileSync('pc-team-talk.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260922162000_team_talk_platform_backgrounds_olli_styles.sql', 'utf8');
const defaultMigration = fs.readFileSync('supabase/migrations/20260928151000_team_talk_default_olli_light.sql', 'utf8');
const resetMigration = fs.readFileSync('supabase/migrations/20260928153500_team_talk_reset_all_olli_light.sql', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

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


test('PC Team Chat defaults to Olli style 1 and lists Olli styles before Kakao styles', () => {
  assert.match(settings, /const DEFAULT_BACKGROUND = 'olli-light'/);
  assert.match(settings, /background: DEFAULT_BACKGROUND/);
  assert.match(settings, /\? mode : DEFAULT_BACKGROUND/);
  assert.match(settings, /state\.background = normalizeBackground\(cached\.background \|\| DEFAULT_BACKGROUND\)/);
  const olli = settings.indexOf('<div class="olliTeamTalkThemeGroupLabel olli">올리 스타일</div>');
  const kakao = settings.indexOf('<div class="olliTeamTalkThemeGroupLabel">카톡 스타일</div>');
  assert.ok(olli >= 0 && kakao > olli);
  assert.match(html, /olli-settings-team-talk-common\.js\?v=20260928-reset-all-olli1-1/);
});

test('database defaults both platform backgrounds to Olli style 1 without rewriting saved values', () => {
  assert.match(defaultMigration, /team_talk_background_pc set default 'olli-light'/);
  assert.match(defaultMigration, /team_talk_background_phone set default 'olli-light'/);
  assert.match(defaultMigration, /coalesce\(v_background, 'olli-light'\)/);
  assert.match(defaultMigration, /coalesce\(p_background, 'olli-light'\)/);
  const ddlPrefix = defaultMigration.slice(0, defaultMigration.indexOf('create or replace function'));
  assert.doesNotMatch(ddlPrefix, /update public\.academy_settings/);
});


test('PC ignores pre-reset cached Team Chat backgrounds while keeping the settings editable', () => {
  assert.match(settings, /const BACKGROUND_RESET_VERSION = '20260928-olli1'/);
  assert.match(settings, /background_reset_version: BACKGROUND_RESET_VERSION/);
  assert.match(settings, /cached\.background_reset_version === BACKGROUND_RESET_VERSION[\s\S]*\? normalizeBackground\(cached\.background \|\| DEFAULT_BACKGROUND\)[\s\S]*: DEFAULT_BACKGROUND/);
  assert.doesNotMatch(settings, /state\.background = 'dark'/);
  assert.doesNotMatch(settings, /applyBackground\('dark'\)/);
  assert.match(settings, /function selectBackground\(mode\)[\s\S]*queueBackgroundSave\(\)/);
  assert.match(html, /olli-settings-team-talk-common\.js\?v=20260928-reset-all-olli1-1/);
});

test('one-time migration resets every saved PC and phone Team Chat background to Olli style 1', () => {
  assert.match(resetMigration, /update public\.academy_settings/);
  assert.match(resetMigration, /team_talk_background_pc = 'olli-light'/);
  assert.match(resetMigration, /team_talk_background_phone = 'olli-light'/);
  assert.match(resetMigration, /where team_talk_background_pc is distinct from 'olli-light'[\s\S]*team_talk_background_phone is distinct from 'olli-light'/);
});

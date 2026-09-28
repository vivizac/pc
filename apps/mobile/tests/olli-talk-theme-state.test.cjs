const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'olli-talk-beta.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'olli-talk-beta.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Phone Team Talk keeps the selected semantic theme while recalculating contrast', () => {
  const start = js.indexOf('function syncOlliTalkContrastTheme()');
  const end = js.indexOf('function isOlliTalkChatNearBottom', start);
  const sync = js.slice(start, end);

  assert.match(sync, /selectedTheme = String\(screen\.dataset\.olliTalkTheme \|\| ''\)\.trim\(\)/);
  assert.match(sync, /\['light-blue','dark-blue','olli-light','olli-dark'\]\.includes\(selectedTheme\)/);
  assert.match(sync, /screen\.dataset\.olliTalkContrast = theme/);
  assert.match(sync, /if \(!preserveSelectedVariant\) screen\.dataset\.olliTalkTheme = theme/);
});

test('Olli phone themes still map outgoing messages to blue', () => {
  assert.match(css, /data-olli-talk-theme="olli-light"[\s\S]*data-olli-talk-theme="olli-dark"[\s\S]*--olli-talk-outgoing-bg:#0A84FF;[\s\S]*--olli-talk-outgoing-text:#fff;/);
  assert.match(css, /\.olliTalkBetaMessage\.outgoing \.olliTalkBetaBubble\{[\s\S]*--olli-talk-bubble-bg:var\(--olli-talk-outgoing-bg\)/);
});

test('Phone loads the current 0.72px / .12 photo-viewer highlight CSS and control-theme runtime', () => {
  assert.match(html, /olli-talk-beta\.css\?v=20260927-member-count-local-27/);
  assert.match(html, /olli-talk-beta\.js\?v=20260927-member-count-local-2/);
});


test('Phone Team Talk maps background contrast to a dedicated control theme', () => {
  const start = js.indexOf('function applyOlliTalkControlTheme(theme)');
  const end = js.indexOf('function isOlliTalkChatNearBottom', start);
  const runtime = js.slice(start, end);

  assert.ok(start >= 0);
  assert.match(runtime, /controlTheme = theme === 'light' \? 'light' : 'dark'/);
  assert.match(runtime, /screen\.dataset\.olliTalkControlTheme = controlTheme/);
  assert.match(runtime, /screen\.dataset\.olliTalkContrast = theme;[\s\S]*applyOlliTalkControlTheme\(theme\)/);
});

test('Dark Team Talk uses a very bright background-derived glass color while preserving the original transparency stops', () => {
  const darkStart = css.indexOf('#olliTalkBetaScreen[data-olli-talk-control-theme="dark"]{');
  const darkEnd = css.indexOf('\n}', darkStart);
  const dark = css.slice(darkStart, darkEnd);

  assert.ok(darkStart >= 0);
  assert.match(dark, /--olli-talk-control-glass-color:color-mix\(in srgb,var\(--olli-talk-bg\) 35%,#fff 65%\)/);

  for (const percent of [66,46,30]) {
    assert.ok(
      dark.includes('color-mix(in srgb,var(--olli-talk-control-glass-color) ' + percent + '%,transparent)'),
      'missing preserved glass alpha stop ' + percent + '%'
    );
  }

  for (const percent of [60,34,20,8,22,11]) {
    assert.ok(
      dark.includes('color-mix(in srgb,var(--olli-talk-bg) ' + percent + '%,transparent)'),
      'edge/header lighting must remain tied to the original background at ' + percent + '%'
    );
  }
});

test('Team Talk edge surfaces read their backgrounds from theme variables', () => {
  assert.match(css, /\.olliTalkBetaEdgeBlurTop\{[\s\S]*background:var\(--olli-talk-edge-top-bg\)/);
  assert.match(css, /\.olliTalkBetaHeader\{[\s\S]*background:var\(--olli-talk-header-bg\)/);
  assert.match(css, /\.olliTalkBetaEdgeBlurBottom\{[\s\S]*background:var\(--olli-talk-edge-bottom-bg\)/);
});


test('Dark Team Talk inner highlight leaves the top-right and bottom-left rounded corners open', () => {
  const darkStart = css.indexOf('#olliTalkBetaScreen[data-olli-talk-control-theme="dark"]{');
  const darkEnd = css.indexOf('\n}', darkStart);
  const dark = css.slice(darkStart, darkEnd);

  assert.match(dark, /--olli-phone-academy-button-shadow:[\s\S]*inset \.5px \.5px 0 rgba\(255,255,255,.72\)/);
  assert.match(dark, /inset -\.5px -\.5px 0 rgba\(255,255,255,.72\)/);
  assert.doesNotMatch(dark, /inset 0 0 0 \.75px rgba\(255,255,255,.72\)/);
  assert.match(dark, /0 0 0 1px rgba\(0,0,0,.025\)/);
  assert.match(dark, /0 8px 28px rgba\(0,0,0,.055\)/);
});


test('Dark Team Talk slightly increases the title weight and uses the darker sampled gray for the coffee center', () => {
  assert.match(css, /data-olli-talk-control-theme="dark"\] \.olliTalkBetaTitle\{[\s\S]*font-weight:400;/);
  assert.match(css, /data-olli-talk-control-theme="dark"\] \.olliTalkQuickOrderBtn svg circle\{[\s\S]*fill:#C7CACF;/);
  assert.match(css, /#olliTalkBetaScreen \.olliTalkBetaTitle\{[\s\S]*font-weight:350;/);
});


test('Original photo viewer owns a fixed dark-control palette independent of Team Talk background settings', () => {
  const start = css.indexOf('#olliTalkPhotoViewerScreen{');
  const end = css.indexOf('\n}', start);
  const viewer = css.slice(start, end);

  assert.ok(start >= 0);
  assert.match(viewer, /--olli-photo-viewer-control-base:#666D77/);
  assert.match(viewer, /--olli-photo-viewer-control-glass-color:color-mix\(in srgb,var\(--olli-photo-viewer-control-base\) 35%,#fff 65%\)/);
  assert.match(viewer, /--olli-phone-glass-border:rgba\(0,0,0,.88\)/);
  assert.match(viewer, /--olli-phone-academy-button-shadow:[\s\S]*inset \.72px \.72px 0 rgba\(255,255,255,.12\)[\s\S]*inset -\.72px -\.72px 0 rgba\(255,255,255,.12\)/);
  assert.doesNotMatch(viewer, /--olli-talk-bg/);
  assert.doesNotMatch(viewer, /data-olli-talk-control-theme/);
});

test('Original photo viewer keeps top and bottom overlay backgrounds transparent', () => {
  assert.match(css, /\.olliTalkPhotoViewerHeader\{[^}]*background:transparent;[^}]*background-image:none/);
  assert.match(css, /\.olliTalkPhotoViewerActions\{[^}]*background:transparent;[^}]*background-image:none/);
});

test('Original photo viewer button icons are white and optically centered', () => {
  assert.match(css, /\.olliTalkPhotoViewerBackBtn\{[^}]*color:#fff/);
  assert.match(css, /\.olliTalkPhotoViewerArchiveBtn\{[^}]*color:#fff/);
  assert.match(css, /\.olliTalkPhotoViewerActionBtn\{[^}]*color:#fff/);
  assert.match(css, /\.olliTalkPhotoViewerActionBtn\.delete\{color:#fff\}/);
  assert.match(css, /\.olliTalkPhotoViewerArchiveBtn svg\{[^}]*display:block;[^}]*margin:auto/);
  assert.match(css, /\.olliTalkPhotoViewerActionBtn svg\{[^}]*display:block;[^}]*margin:auto/);
  assert.match(css, /\.olliTalkPhotoViewerActionBtn\.delete svg\{[^}]*stroke-width:5\.5;[^}]*translateX\(-1\.4px\)/);
});


test('Original photo viewer glass is substantially more transparent than the Team Talk dark controls', () => {
  const start = css.indexOf('#olliTalkPhotoViewerScreen{');
  const end = css.indexOf('\n}', start);
  const viewer = css.slice(start, end);

  assert.match(viewer, /control-glass-color\) 3%,transparent/);
  assert.match(viewer, /control-glass-color\) 3%,transparent\) 0%/);
  assert.match(viewer, /control-glass-color\) 3%,transparent\) 46%/);
  assert.match(viewer, /control-glass-color\) 3%,transparent\) 100%/);
});


test('Dark Team Talk buttons and composer keep their border geometry but use a transparent border color', () => {
  const darkStart = css.indexOf('#olliTalkBetaScreen[data-olli-talk-control-theme="dark"]{');
  const darkEnd = css.indexOf('\n}', darkStart);
  const dark = css.slice(darkStart, darkEnd);

  assert.ok(darkStart >= 0);
  assert.match(dark, /--olli-phone-glass-border:transparent;/);
});

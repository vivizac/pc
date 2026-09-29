const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'olli-talk-beta.css'), 'utf8');

test('Olli Talk page uses the requested #F3F3F3 background', () => {
  assert.match(css, /--olli-talk-bg:#F3F3F3/);
  assert.match(css, /--olli-talk-bg-bottom:#F3F3F3/);
  assert.match(css, /background:#F3F3F3/);
});

test('Olli Talk composer uses the requested frosted glass values', () => {
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?border:\.5px solid var\(--olli-talk-glass-border\);[\s\S]*?background:linear-gradient\(/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?0 4px 12px var\(--olli-talk-glass-shadow\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
});

test('Olli Talk header round buttons share the same glass treatment', () => {
  assert.match(css, /\.olliTalkBetaBackBtn\{[\s\S]*?background:linear-gradient\([\s\S]*?backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
  assert.match(css, /\.olliTalkSearchBtn\{[\s\S]*?background:linear-gradient\([\s\S]*?backdrop-filter:blur\(20px\) saturate\(155%\) brightness\(1\.10\)/);
});


test('Olli Talk glass buttons and composer use a thinner white outline', () => {
  assert.match(css, /\.olliTalkBetaBackBtn\{[\s\S]*?border:\.5px solid var\(--olli-talk-glass-border\)/);
  assert.match(css, /\.olliTalkSearchBtn\{[\s\S]*?border:\.5px solid var\(--olli-talk-glass-border\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?border:\.5px solid var\(--olli-talk-glass-border\)/);
  assert.match(css, /inset 0 \.5px 0 var\(--olli-talk-glass-highlight\)/);
});


test('Olli Talk glass surfaces are transparent but luminous', () => {
  assert.match(css, /--olli-talk-glass-start:rgba\(255,255,255,\.66\)/);
  assert.match(css, /--olli-talk-glass-end:rgba\(255,255,255,\.30\)/);
  assert.match(css, /--olli-talk-glass-glow:rgba\(255,255,255,\.62\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?linear-gradient\([\s\S]*?var\(--olli-talk-glass-start\)[\s\S]*?var\(--olli-talk-glass-end\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?0 0 22px var\(--olli-talk-glass-glow\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?brightness\(1\.10\)/);
});


test('Olli Talk restores the original wide soft composer shadow', () => {
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?0 0 34px 10px rgba\(0,0,0,\.045\)/);
  assert.match(css, /\.olliTalkBetaComposer\{[\s\S]*?0 0 78px 22px rgba\(0,0,0,\.035\)/);
});

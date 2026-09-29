const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'kinder-feedback.css'), 'utf8');

test('1-minute feedback Olli Talk uses the Vivicot character icon', () => {
  assert.match(html, /id="kcfOlliTalkBtn"[\s\S]*?class="kcfOlliTalkIcon"><img[^>]*src="olli-character\.svg\?v=20260915-svg-3-black"/);
  assert.match(css, /\.kcfOlliTalkIcon\{[\s\S]*?width:28px;[\s\S]*?height:28px;/);
  assert.match(css, /\.kcfOlliTalkIcon img\{[\s\S]*?width:28px;[\s\S]*?height:28px;/);
  assert.doesNotMatch(css, /\.kcfOlliTalkIcon path/);
  assert.doesNotMatch(css, /\.kcfOlliTalkIcon circle/);
});

test('1-minute feedback LIVE button uses text instead of the character icon', () => {
  assert.match(html, /id="kcfOlliBtn"[\s\S]*?<span aria-hidden="true" class="kcfLiveText">Live<\/span>/);
  assert.doesNotMatch(html, /id="kcfOlliBtn"[\s\S]{0,260}<img/);
  assert.match(css, /#kcfPersistentTopLayer #kcfOlliBtn \.kcfLiveText\{[\s\S]*?font-size:11px;[\s\S]*?font-weight:800;/);
});

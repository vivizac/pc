const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'olli-talk-beta.css'), 'utf8');

test('Olli Talk composer uses dark mic and the same yellow send color in active and disabled states', () => {
  assert.match(css, /\.olliTalkBetaVoiceBtn\{[\s\S]*?color:#201818;/);
  assert.match(css, /\.olliTalkBetaSendBtn:not\(:disabled\)\{[\s\S]*?background:#FEE500;/);
  assert.match(css, /\.olliTalkBetaSendBtn:disabled\{[\s\S]*?background:#FEE500;/);
  assert.match(css, /\.olliTalkBetaSendBtn\{[\s\S]*?color:#201818;/);
});


test('Olli Talk keyboard-open gap removes safe-area padding above the keyboard', () => {
  assert.match(css, /\.olliTalkKeyboardOpen \.olliTalkBetaComposerWrap\{[\s\S]*?padding-bottom:4px;/);
});

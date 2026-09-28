const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'olli-talk-beta.css'), 'utf8');

test('Olli Talk uses the yellow chat palette', () => {
  assert.match(css, /--olli-talk-bg:#F3F3F1/);
  assert.match(css, /--olli-talk-primary:#FEE500/);
  assert.match(css, /\.olliTalkBetaMessage\.outgoing \.olliTalkBetaBubble\{[\s\S]*?background:#FEE500/);
  assert.match(css, /\.olliTalkBetaMessage\.incoming \.olliTalkBetaBubble\{[\s\S]*?background:#fff/);
  assert.match(css, /\.olliTalkBetaDateDivider span\{[\s\S]*?background:#E9E9E6;[\s\S]*?color:#6E6E6E/);
  assert.match(css, /\.olliTalkPushBtn\.active \.olliTalkPushDot\{[\s\S]*?background:#7ACB63/);
});

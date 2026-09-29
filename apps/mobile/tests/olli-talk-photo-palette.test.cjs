const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'olli-talk-beta.css'), 'utf8');

test('Olli Talk uses the photo-based recommended UI palette', () => {
  assert.match(css, /#olliTalkBetaScreen\{[\s\S]*?background:#F3F5F4;/);
  assert.match(css, /\.olliTalkBetaViewport\{[\s\S]*?background:#F3F5F4;/);
  assert.match(css, /\.olliTalkBetaTitle\{[\s\S]*?color:#201818;/);
  assert.match(css, /\.olliTalkBetaSub\{[\s\S]*?color:#A4A69B;/);
  assert.match(css, /\.olliTalkBetaMessage\.outgoing \.olliTalkBetaBubble\{[\s\S]*?background:#E7F0EC;/);
  assert.match(css, /\.olliTalkBetaMessage\.incoming \.olliTalkBetaBubble\{[\s\S]*?background:#fff;/);
  assert.match(css, /\.olliTalkBetaSendBtn:not\(:disabled\)\{[\s\S]*?background:#3FC6A0;/);
  assert.match(css, /\.olliTalkPushBtn\.active \.olliTalkPushDot\{[\s\S]*?background:#90C040;/);
});

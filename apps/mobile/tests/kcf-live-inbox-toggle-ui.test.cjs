const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const icon = fs.readFileSync('kcf-inbox-mode.svg', 'utf8');

test('KCF has distinct LIVE and inbox header buttons', () => {
  assert.match(html, /id="kcfOlliBtn"[^>]*onclick="toggleKinderChatFeedbackTopMode\(event\)"/);
  assert.match(html, /id="kcfInboxModeBtn"[^>]*onclick="toggleKinderChatFeedbackTopMode\(event\)"/);
  assert.match(html, /kcf-inbox-mode\.svg\?v=20260915-1/);
  assert.match(css, /#kcfPersistentTopLayer\.kcfTopModeInbox #kcfOlliBtn\{\s*display:none;/);
  assert.match(css, /#kcfPersistentTopLayer\.kcfTopModeInbox #kcfInboxModeBtn\{\s*display:inline-flex;/);
});

test('temporary inbox bubble keeps existing open action and only shows in inbox mode', () => {
  assert.match(html, /id="kcfVivicotInboxBubble" onclick="openKinderChatFeedbackInbox\(\)"/);
  assert.match(js, /bubbleActive && getKinderChatFeedbackTopMode\(\) === 'inbox'/);
  assert.match(css, /\.kcfVivicotInboxBubble[\s\S]*top:calc\(var\(--vivizac-memo-top-y\) \+ 54px\);[\s\S]*right:var\(--vivizac-memo-shell-x\);/);
});

test('inbox mode button uses a dedicated uploaded-image-derived icon asset', () => {
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(icon, /stroke="#111"/);
  assert.match(icon, /M5\.35 11h15\.5/);
});

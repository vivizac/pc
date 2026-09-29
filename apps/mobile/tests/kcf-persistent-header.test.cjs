const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');

test('1-minute feedback top controls are body-level source markup, not runtime-moved DOM', () => {
  const layerIndex = html.indexOf('id="kcfPersistentTopLayer"');
  const screenIndex = html.indexOf('id="kinderChatFeedbackScreen"');
  const headerIndex = html.indexOf('class="kcfHeader"');
  assert.ok(layerIndex >= 0 && headerIndex > layerIndex && headerIndex < screenIndex);
  assert.doesNotMatch(adapter, /appendChild\(header\)|kcfPersistentNavLayer|kcf-persistent-nav-phone\.css/);
});

test('persistent top layer, fade layer, and chat use one explicit stacking model', () => {
  assert.match(css, /#kcfPersistentTopLayer\s*\{[\s\S]*position:fixed;[\s\S]*inset:0;[\s\S]*pointer-events:none;[\s\S]*z-index:5000;/);
  assert.match(css, /#kinderChatFeedbackScreen \.kcfTopFadeLayer\{[\s\S]*position:fixed;[\s\S]*z-index:100;/);
  assert.match(css, /#kinderChatFeedbackScreen \.kcfChatArea\{[\s\S]*z-index:1;/);
  assert.match(css, /#kcfPersistentTopLayer \.kcfRoundBtn\{[\s\S]*position:fixed;/);
  assert.match(css, /#kcfPersistentTopLayer \.kcfHeaderCenter\{[\s\S]*position:fixed;/);
});

test('persistent top visibility is owned by original KCF open/close paths', () => {
  assert.match(js, /function setKinderChatFeedbackPersistentTopVisible\(visible\)/);
  assert.match(js, /page\.style\.display = 'flex';\n  setKinderChatFeedbackPersistentTopVisible\(true\);/);
  assert.match(js, /page\.style\.display = 'none';\n  setKinderChatFeedbackPersistentTopVisible\(false\);/);
});

test('restored inbox text and click connection survive UI rebuild', () => {
  assert.match(html, /onclick="openKinderChatFeedbackInbox\(\)"/);
  assert.match(html, />임시보관함이 활성화 되었습니다</);
  assert.match(js, /function openKinderChatFeedbackInbox\(\)/);
  assert.match(html, /id="kcfInboxOverlay"/);
});

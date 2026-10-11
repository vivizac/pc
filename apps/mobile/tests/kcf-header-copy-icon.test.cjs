const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('QuickNote collect/continuous name copy is a borderless icon, not a blue button', () => {
  const rules = css.split('body.kcfContinuousMode.kcfContinuousFeedbackFolded #kinderChatFeedbackScreen .kcfLiveHeaderCopyBtn,')[1]
    ?.split('}', 1)[0] || '';
  assert.match(rules, /border:0;/);
  assert.match(rules, /background:transparent;/);
  assert.match(rules, /box-shadow:none;/);
  assert.doesNotMatch(css, /\.kcfLiveHeaderCopyBtn\.kcfLiveHeaderCopied\s*\{/);
  assert.match(css, /\.kcfLiveTitleLeft:has\(\.kcfLiveHeaderCopyBtn\.kcfLiveHeaderCopied\) \.kcfLiveStudentNameText/);
  assert.match(css, /color:#0A84FF;/);
});

test('Header copy only uses clipboard, independent of save and shared copy-success timer', () => {
  const start = adapter.indexOf("headerCopy.addEventListener('click', async function(event){");
  const end = adapter.indexOf("\n      const name = document.createElement('span');", start);
  const handler = adapter.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(handler, /copyKinderChatFeedbackLive\(jobId, null\)/);
  assert.doesNotMatch(handler, /saveKinderChatFeedbackLive|autoSaveGeneratedFeedback|copyKinderChatFeedbackLive\(jobId, headerCopy\)/);
  assert.match(handler, /setTimeout\(function\(\)\{[\s\S]*?copyIconHtml;[\s\S]*?\}, 550\)/);
  assert.match(handler, /classList\.add\('kcfLiveHeaderCopied'\)/);
  assert.match(handler, /getKinderChatFeedbackInboxCopyCheckSvg/);
  assert.match(handler, /copyPending/);
});

test('Updated CSS and adapter assets are cache-busted', () => {
  assert.match(html, /kinder-feedback\.css\?v=20261011-inline-copy-glyph-1/);
  assert.match(html, /olli-feedback-registration-phone-adapter\.js\?v=20261011-inline-copy-glyph-1/);
});

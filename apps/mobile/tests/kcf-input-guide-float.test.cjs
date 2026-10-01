const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const autoMode = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');

test('QuickNote input guide floats above composer without changing layout', () => {
  assert.match(css, /#kinderChatFeedbackScreen \.kcfComposer \{[\s\S]*?position:relative/);
  assert.match(css, /#kinderChatFeedbackScreen \.kcfInputWarning \{[\s\S]*?position:absolute;[\s\S]*?bottom:calc\(100% \+ 8px\)/);
  assert.match(css, /opacity:0;[\s\S]*?visibility:hidden/);
  assert.match(css, /\.kcfInputWarning\.show \{[\s\S]*?opacity:1;[\s\S]*?visibility:visible/);
});

test('QuickNote input guide auto hides through the shared warning function', () => {
  assert.match(js, /let kcfInputWarningTimer = 0/);
  assert.match(js, /function setKinderChatFeedbackWarning\(message\)/);
  assert.match(js, /const visibleMs = Math\.min\(4800, Math\.max\(2800,/);
  assert.match(js, /setTimeout\(\(\) => \{[\s\S]*?el\.classList\.remove\('show'\)/);
});

test('all Class edit input guides use the shared floating guide', () => {
  assert.match(autoMode, /setKinderChatFeedbackWarning\('수업기록 수정 중/);
  assert.match(autoMode, /setKinderChatFeedbackWarning\('수정할 수업기록 내용을 입력해 주세요\.'/);
});

test('QuickNote guide assets are cache busted and accessible', () => {
  assert.match(html, /kinder-feedback\.css\?v=20261001-input-guide-float-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261001-input-guide-float-1/);
  assert.match(html, /<div aria-live="polite" class="kcfInputWarning" id="kcfInputWarning" role="status"><\/div>/);
});

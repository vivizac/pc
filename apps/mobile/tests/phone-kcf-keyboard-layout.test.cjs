const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');

test('empty QuickNote chat still owns vertical gestures without page overscroll', () => {
  const chatRule = css.match(/#kinderChatFeedbackScreen \.kcfChatArea\{[^}]*\}/)?.[0] || '';
  const sentinel = css.match(/#kinderChatFeedbackScreen \.kcfChatArea::after\{[^}]*\}/)?.[0] || '';
  assert.match(chatRule, /overflow-y:auto;/);
  assert.match(chatRule, /overscroll-behavior-y:contain;/);
  assert.match(chatRule, /touch-action:pan-y;/);
  assert.match(sentinel, /height:1px;/);
});

test('inline QuickNote source never owns keyboard movement anymore', () => {
  assert.doesNotMatch(js, /kcfKeyboardOpen/);
  assert.doesNotMatch(js, /kcfKeyboardBaselineBottom/);
  assert.doesNotMatch(js, /bindKinderChatFeedbackKeyboardOffset/);
  assert.doesNotMatch(js, /updateKinderChatFeedbackKeyboardOffset/);
  assert.doesNotMatch(js, /syncKinderChatFeedbackComposerViewport/);
  assert.doesNotMatch(js, /window\.visualViewport/);
  assert.doesNotMatch(css, /kcfKeyboardOpen/);
  assert.doesNotMatch(css, /--kcf-composer-vv-/);
  assert.doesNotMatch(css, /kcfKeyboardHidden/);
});

test('inline QuickNote source stays fixed at its normal page position', () => {
  const layer = css.match(/#kinderChatFeedbackScreen \.kcfComposerLayer \{[^}]*\}/)?.[0] || '';
  const wrap = css.match(/#kinderChatFeedbackScreen \.kcfComposerWrap \{[^}]*\}/)?.[0] || '';
  assert.match(layer, /position:fixed;/);
  assert.match(layer, /inset:0;/);
  assert.match(layer, /width:100%;/);
  assert.match(layer, /height:100%;/);
  assert.match(wrap, /bottom:var\(--olli-phone-guide-bottom/);
  assert.doesNotMatch(wrap, /bottom:4px/);
});

test('inline QuickNote input is read-only and opens the shared sheet', () => {
  assert.match(html, /<textarea class="kcfInput" id="kcfInput"[^>]*readonly[^>]*>/);
  const pointer = js.match(/input\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointer, /window\.KcfComposerSheet \|\| window\.KcfTeacherSheet/);
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(pointer, /sheet\.open\(\)/);
  assert.doesNotMatch(pointer, /teacherMode\.isEnabled/);
});

test('all programmatic QuickNote focus requests route to the shared sheet', () => {
  assert.match(js, /function openKinderChatFeedbackComposerSheet\(\)/);
  assert.match(js, /function focusKinderChatFeedbackInput\(\) \{\s*openKinderChatFeedbackComposerSheet\(\);\s*\}/);
  assert.doesNotMatch(js, /document\.getElementById\('kcfInput'\)[\s\S]{0,120}\.focus\(/);
});

test('shared QuickNote sheet alone follows visualViewport while its keyboard is open', () => {
  assert.match(teacherJs, /global\.visualViewport/);
  assert.match(teacherJs, /--kcf-teacher-vv-top/);
  assert.match(teacherJs, /--kcf-teacher-vv-height/);
  assert.match(teacherCss, /top:var\(--kcf-teacher-vv-top, 0px\)/);
  assert.match(teacherCss, /height:var\(--kcf-teacher-vv-height, 100vh\)/);
});

test('shared sheet hides the underlying message page while editing', () => {
  assert.match(teacherCss, /body\.kcfTeacherSheetOpen #kcfPersistentTopLayer,[\s\S]*?body\.kcfTeacherSheetOpen #kinderChatFeedbackScreen \.kcfInner,[\s\S]*?body\.kcfTeacherSheetOpen #kinderChatFeedbackScreen \.kcfComposerLayer/);
  assert.match(teacherJs, /document\.body\.classList\.add\('kcfTeacherSheetOpen'\)/);
  assert.match(teacherJs, /document\.body\.classList\.remove\('kcfTeacherSheetOpen'\)/);
});

test('inline source remains one line because multiline editing belongs to the sheet', () => {
  assert.match(js, /function autoResizeKinderChatFeedbackInput\(input\)[\s\S]*?const height = 34;/);
  assert.match(css, /#kinderChatFeedbackScreen \.kcfInput \{[\s\S]*?height:34px;[\s\S]*?max-height:34px;/);
  assert.doesNotMatch(css, /max-height:110px/);
});

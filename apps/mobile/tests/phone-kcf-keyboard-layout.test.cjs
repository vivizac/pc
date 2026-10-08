const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = name => fs.readFileSync(name, 'utf8');
const js = read('kinder-feedback.js');
const css = read('kinder-feedback.css');
const html = read('index.html');
const teacherJs = read('kcf-teacher-sheet.js');
const teacherCss = read('kcf-teacher-sheet.css');

test('empty QuickNote chat remains scrollable without page overscroll', () => {
  const chatRule = css.match(/#kinderChatFeedbackScreen \.kcfChatArea\{[^}]*\}/)?.[0] || '';
  assert.match(chatRule, /overflow-y:auto;/);
  assert.match(chatRule, /overscroll-behavior-y:contain;/);
  assert.match(chatRule, /touch-action:pan-y;/);
});

test('inline QuickNote text stays read-only and the single sheet owns keyboard focus', () => {
  assert.match(html, /<textarea class="kcfInput" id="kcfInput"[^>]*readonly[^>]*>/);
  assert.ok(js.includes('window.KcfTeacherSheet'));
  assert.ok(!js.includes('KcfNormalSheet'));
  assert.ok(teacherJs.includes('keyboard.activate(event, {'));
  assert.ok(teacherJs.includes('global.visualViewport'));
});

test('keyboard sheet keeps existing visualViewport and background lock', () => {
  assert.ok(teacherJs.includes('--kcf-teacher-vv-width'));
  assert.ok(teacherJs.includes('--kcf-teacher-vv-height'));
  assert.ok(teacherCss.includes('body.kcfTeacherSheetOpen'));
  assert.ok(teacherJs.includes("document.body.classList.add('kcfTeacherSheetOpen')"));
  assert.ok(teacherJs.includes("document.body.classList.remove('kcfTeacherSheetOpen')"));
});

test('continuous mode does not blur the input after submit', () => {
  assert.ok(teacherJs.includes("state.composerMode === 'continuous') return"));
  assert.ok(teacherJs.includes("if (accepted && state.composerMode !== 'continuous')"));
});

test('base composer remains fixed and one line as before', () => {
  assert.ok(css.includes('kcfComposerLayer'));
  assert.ok(js.includes('const height = 34;'));
  assert.ok(html.includes('id="kcfInput"'));
});

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const teacher = read('apps/mobile/kcf-teacher-sheet.css');
const html = read('apps/mobile/index.html');
const teacherJs = read('apps/mobile/kcf-teacher-sheet.js');

test('QuickNote single sheet preserves original dim backdrop and animation', () => {
  assert.match(teacher, /\.kcfTeacherSheetOverlay\s*\{[\s\S]*background:rgba\(0,0,0,\.14\)/);
  assert.match(teacher, /\.kcfTeacherSheet\s*\{[\s\S]*border-radius:28px 28px 0 0;[\s\S]*transform:translateY\(100%\);[\s\S]*transition:transform \.32s cubic-bezier\(\.22,\.61,\.36,1\)/);
  assert.match(teacher, /\.kcfTeacherSheetOverlay\.show \.kcfTeacherSheet\s*\{[\s\S]*transform:translateY\(0\)/);
  assert.match(teacher, /\.kcfTeacherSheetOverlay:not\(\.show\) \.kcfTeacherSheet\s*\{\s*transition:none/);
  assert.ok(html.includes('kcf-teacher-sheet.css?v=20261008-continuous-1'));
  assert.ok(!html.includes('kcf-normal-sheet'));
});

test('QuickNote retains native caret focus during the sheet transition', () => {
  assert.ok(teacherJs.includes("panel.addEventListener('transitionend'"));
  assert.ok(teacherJs.includes("event.propertyName !== 'transform'"));
  assert.ok(teacherJs.includes("root.classList.remove('entrance-complete')"));
  assert.ok(teacherJs.includes('scheduleSheetCaretReveal()'));
  assert.ok(teacherJs.includes('keyboard.activate(event, {'));
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261008-continuous-1'));
});

test('top X is not presented or wired on the new single composer', () => {
  assert.ok(!teacherJs.includes('kcfTeacherSheetCloseBtn'));
  assert.ok(!teacherJs.includes('kcfNormalSheetCloseBtn'));
});

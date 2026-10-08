const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');
const css = read('kcf-auto-mode.css');
const sheet = read('kcf-teacher-sheet.js');
const sheetCss = read('kcf-teacher-sheet.css');
const runtime = read('kcf-auto-mode-runtime.js');
const base = read('kinder-feedback.js');
const html = read('index.html');

test('QuickNote inline Class composer retains the two-row structure', () => {
  assert.match(css, /kcfTeacherRosterMode \.kcfComposer \{[\s\S]*?height:auto;[\s\S]*?max-height:none;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfComposerBottom \{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:33px minmax\(0,1fr\) 88px 33px 33px;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfAutoStudentRoster \{[\s\S]*?grid-column:2;[\s\S]*?grid-row:2;/);
});

test('closing the sheet still blurs the inline input', () => {
  assert.match(sheet, /function close\(options\)[\s\S]*?inlineInput\.blur\(\)/);
});

test('successful feedback still advances to the next student', () => {
  assert.match(runtime, /function completeSuccessfulSubmit\(context\)[\s\S]*?selectNextAvailableAutoStudent/);
  assert.ok(sheet.includes("state.composerMode === 'continuous') return"));
});

test('mode dropdown replaces the Class C button in the second-row slot', () => {
  assert.ok(html.includes('id="kcfModeSwitchBtn"'));
  assert.ok(sheet.includes("kcfTeacherSheetModeHost"));
  assert.ok(sheet.includes("mountSheetControls()"));
  assert.ok(!sheet.includes('id="kcfSheetModeSwitchBtn"'));
  assert.ok(css.includes('kcfTeacherRosterMode .kcfComposerModeBtn'));
  assert.ok(sheetCss.includes('.kcfComposerModeBtn'));
  assert.ok(!sheet.includes('kcfTeacherSheetModeBtn'));
});

test('student can deselect a roster card to type a different name', () => {
  assert.ok(runtime.includes('if (nextId === currentId) { deselectAutoStudent(); return; }'));
  assert.ok(runtime.includes('state.manualEntry = true'));
  assert.ok(runtime.includes('학생 이름과 수업기록을 적어주세요'));
});

test('the inline input opens only the Class sheet', () => {
  assert.ok(base.includes('mode.activateForComposer(event)'));
  assert.ok(base.includes('window.KcfTeacherSheet'));
  assert.ok(!base.includes('KcfNormalSheet'));
});

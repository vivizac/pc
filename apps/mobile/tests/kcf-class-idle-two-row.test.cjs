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

test('QuickNote idle keeps the ORIGINAL one-line 47px composer, with roster outside', () => {
  assert.doesNotMatch(css, /kcfTeacherRosterMode \.kcfComposer \{/);
  assert.doesNotMatch(css, /kcfTeacherRosterMode \.kcfComposerBottom \{/);
  assert.doesNotMatch(css, /grid-template-rows:minmax\(34px, auto\) auto 38px;/);
  assert.match(runtime, /wrap\.insertBefore\(roster, composer\)/);
  assert.match(css, /\.kcfAutoStudentRoster \{[\s\S]*?height:36px;[\s\S]*?margin:0 0 6px;/);
});

test('closing the sheet still blurs the inline input', () => {
  assert.match(sheet, /function close\(options\)[\s\S]*?inlineInput\.blur\(\)/);
});

test('successful feedback still advances to the next student', () => {
  assert.match(runtime, /function completeSuccessfulSubmit\(context\)[\s\S]*?selectNextAvailableAutoStudent/);
  assert.ok(sheet.includes("state.composerMode === 'continuous') return"));
});

test('mode dropdown takes only the former Class button position', () => {
  assert.ok(html.includes('id="kcfModeSwitchBtn"'));
  assert.ok(sheet.includes("kcfTeacherSheetModeHost"));
  assert.ok(sheet.includes("mountSheetControls()"));
  assert.ok(!sheet.includes('id="kcfSheetModeSwitchBtn"'));
  assert.ok(!css.includes('kcfTeacherRosterMode .kcfComposerModeBtn'));
  assert.ok(!sheet.includes('id="kcfTeacherSheetModeBtn"'));
  assert.ok(sheet.includes('id="kcfTeacherSheetCloseBtn"'));
  assert.match(sheetCss, /\.kcfTeacherSheetBottom \{[\s\S]*?display:flex;/);
  assert.ok(sheetCss.includes('.kcfComposerModeBtn'));
  assert.ok(!sheet.includes('kcfTeacherSheetModeBtn'));
});

test('student can deselect a roster card to type a different name', () => {
  assert.ok(runtime.includes('if (nextId === currentId) { deselectAutoStudent(); return; }'));
  assert.ok(runtime.includes('state.manualEntry = true'));
  assert.ok(!runtime.includes('학생 이름과 수업기록을 적어주세요'));
  assert.ok(runtime.includes('수업기록을 적어주세요'));
});

test('the inline input opens only the Class sheet', () => {
  assert.ok(base.includes('mode.activateForComposer(event)'));
  assert.ok(base.includes('window.KcfTeacherSheet'));
  assert.ok(!base.includes('KcfNormalSheet'));
});

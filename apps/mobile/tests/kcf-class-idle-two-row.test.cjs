const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const sheetCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const base = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('closed Class mode keeps the inline composer in two rows', () => {
  assert.match(css, /kcfTeacherRosterMode \.kcfComposer \{[\s\S]*?height:auto;[\s\S]*?max-height:none;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfComposerBottom \{[\s\S]*?display:grid;[\s\S]*?grid-template-rows:minmax\(34px, auto\) 38px;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfInput \{[\s\S]*?grid-column:2 \/ -1;[\s\S]*?grid-row:1;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfAutoStudentRoster \{[\s\S]*?grid-column:2;[\s\S]*?grid-row:2;[\s\S]*?position:static;/);
});

test('closing the Class sheet leaves the inline input without a cursor', () => {
  const close = sheet.match(/function close\(options\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(close, /var inlineInput = baseInput\(\)/);
  assert.match(close, /inlineInput\.blur\(\)/);
});

test('successful Class feedback still auto-advances to the next student before closing the sheet', () => {
  const complete = runtime.match(/function completeSuccessfulSubmit\(context\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(complete, /selectNextAvailableAutoStudent\(submitted\.studentId, submitted\.order \|\| \[\]\)/);
  assert.match(complete, /global\.KcfTeacherSheet\.onSuccessfulSubmit\(\)/);
  assert.ok(complete.indexOf('selectNextAvailableAutoStudent') < complete.indexOf('onSuccessfulSubmit'));
});

test('active Class control becomes compact C beside the first-row input', () => {
  assert.match(runtime, /btn\.textContent = state\.loading \? '···' : \(state\.enabled \? 'C' : 'Class'\)/);
  assert.match(css, /\.kcfTeacherBtn\.active \{[\s\S]*?width:33px !important;[\s\S]*?min-width:33px !important;[\s\S]*?border-radius:50% !important;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfTeacherBtn \{[\s\S]*?grid-column:1;[\s\S]*?grid-row:1;[\s\S]*?justify-self:start;/);
});

test('active Class sheet control also uses compact C', () => {
  assert.match(sheet, /id="kcfTeacherSheetModeBtn"[^>]*>C<\/button>/);
  assert.match(sheetCss, /\.kcfTeacherSheetModeBtn \{[\s\S]*?width:32px;[\s\S]*?min-width:32px;[\s\S]*?border-radius:50%;/);
});

test('student cards remain manually selectable while Class mode waits', () => {
  assert.match(runtime, /button\.addEventListener\('click',[\s\S]*?selectAutoStudent\(item\)/);
});

test('tapping the idle Class input reopens the sheet instead of focusing inline', () => {
  const pointer = base.match(/input\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointer, /teacherMode\.isEnabled\(\)/);
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(pointer, /teacherSheet\.open\(\)/);
});

test('Class idle layout assets are cache busted', () => {
  assert.match(html, /kcf-auto-mode\.css\?v=20261001-class-active-c-1/);
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20261001-class-active-c-1/);
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261001-class-active-c-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261001-class-active-c-1/);
});

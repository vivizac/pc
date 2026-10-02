const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const sheetCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const normalSheet = fs.readFileSync('kcf-normal-sheet.js', 'utf8');
const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const base = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('closed Class mode keeps the inline composer in two rows', () => {
  assert.match(css, /kcfTeacherRosterMode \.kcfComposer \{[\s\S]*?height:auto;[\s\S]*?max-height:none;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfComposerBottom \{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:33px minmax\(0,1fr\) 33px;[\s\S]*?grid-template-rows:minmax\(34px, auto\) 38px;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfInput \{[\s\S]*?grid-column:1 \/ -1;[\s\S]*?grid-row:1;/);
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

test('active Class control is uppercase black C in the second-row add slot only', () => {
  assert.match(runtime, /btn\.textContent = state\.loading \? '···' : \(state\.enabled \? 'C' : 'Class'\)/);
  assert.match(css, /\.kcfTeacherBtn\.active \{[\s\S]*?width:33px !important;[\s\S]*?background:#111 !important;[\s\S]*?color:#fff !important;/);
  const idleButton = css.match(/#kinderChatFeedbackScreen\.kcfTeacherRosterMode \.kcfTeacherBtn \{[^}]*\}/)?.[0] || '';
  assert.match(idleButton, /grid-column:1;/);
  assert.match(idleButton, /grid-row:2;/);
  assert.doesNotMatch(idleButton, /grid-row:1;/);
  assert.doesNotMatch(idleButton, /background:#f1f1f1/);
  assert.match(css, /kcfTeacherRosterMode \.kcfAttachBtn \{[\s\S]*?display:none;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfVoiceBtn \{[\s\S]*?display:none;/);
  assert.match(css, /kcfTeacherRosterMode \.kcfSendBtn \{[\s\S]*?grid-column:3;[\s\S]*?grid-row:2;/);
});

test('Class sheet is Class-only and normal sheet owns the Class label', () => {
  assert.match(sheet, /id="kcfTeacherSheetModeBtn"[^>]*>C<\/button>/);
  assert.match(sheet, /function open\(\)\{\s*if \(!modeEnabled\(\)\) return false;/);
  assert.match(sheetCss, /\.kcfTeacherSheetModeBtn \{[\s\S]*?width:33px;[\s\S]*?background:#111;[\s\S]*?color:#fff;/);
  assert.match(normalSheet, /id="kcfNormalSheetClassBtn"[^>]*>Class<\/button>/);
});

test('student cards remain manually selectable while Class mode waits', () => {
  assert.match(runtime, /button\.addEventListener\('click',[\s\S]*?selectAutoStudent\(item\)/);
});

test('tapping the inline composer routes to the mode-specific sheet', () => {
  const pointer = base.match(/composerBottom\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointer, /event\.preventDefault\(\)/);
  assert.match(pointer, /openKinderChatFeedbackComposerSheet\(\)/);
  assert.match(base, /isKinderChatFeedbackClassModeEnabled\(\)[\s\S]*?window\.KcfTeacherSheet[\s\S]*?window\.KcfNormalSheet/);
});

test('Class idle layout assets are cache busted', () => {
  assert.match(html, /kcf-auto-mode\.css\?v=20261001-unified-sheet-1/);
  assert.match(html, /kcf-normal-sheet\.js\?v=20261002-separate-sheets-1/);
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261002-separate-sheets-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261002-separate-sheets-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261002-separate-sheets-1/);
});

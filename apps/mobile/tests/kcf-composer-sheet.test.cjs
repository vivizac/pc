const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const baseJs = fs.readFileSync('kinder-feedback.js', 'utf8');
const normalJs = fs.readFileSync('kcf-normal-sheet.js', 'utf8');
const normalCss = fs.readFileSync('kcf-normal-sheet.css', 'utf8');
const teacherJs = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');
const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');

test('normal and Class QuickNote use separate sheet assets and globals', () => {
  assert.match(html, /kcf-normal-sheet\.css\?v=20261002-separate-sheets-1/);
  assert.match(html, /kcf-normal-sheet\.js\?v=20261002-separate-sheets-1/);
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261002-separate-sheets-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261002-separate-sheets-1/);
  assert.match(normalJs, /global\.KcfNormalSheet = api/);
  assert.match(teacherJs, /global\.KcfTeacherSheet = api/);
  assert.doesNotMatch(normalJs, /global\.KcfTeacherSheet = api/);
  assert.doesNotMatch(teacherJs, /global\.KcfNormalSheet = api/);
  assert.doesNotMatch(normalJs + teacherJs, /global\.KcfComposerSheet = api/);
});

test('inline composer routes explicitly by current mode instead of a shared sheet alias', () => {
  assert.match(baseJs, /function isKinderChatFeedbackClassModeEnabled\(\)/);
  assert.match(baseJs, /function getKinderChatFeedbackComposerSheetForMode\(\)[\s\S]*?window\.KcfTeacherSheet[\s\S]*?window\.KcfNormalSheet/);
  assert.match(baseJs, /function openKinderChatFeedbackComposerSheet\(\)/);
  assert.doesNotMatch(baseJs, /window\.KcfComposerSheet \|\| window\.KcfTeacherSheet/);
  const pointer = baseJs.match(/composerBottom\.addEventListener\('pointerdown',[\s\S]*?\n    \}\);/)?.[0] || '';
  assert.match(pointer, /openKinderChatFeedbackComposerSheet\(\)/);
});

test('normal sheet owns plus Class mic send and has no Class roster state', () => {
  assert.match(normalJs, /id="kcfNormalSheetAttachBtn"/);
  assert.match(normalJs, /id="kcfNormalSheetClassBtn"[^>]*>Class<\/button>/);
  assert.match(normalJs, /id="kcfNormalSheetVoiceBtn"/);
  assert.match(normalJs, /id="kcfNormalSheetSendBtn"/);
  assert.match(normalJs, /id="kcfNormalSheetCloseBtn"[^>]*aria-label="입력창 닫기"/);
  assert.doesNotMatch(normalJs, /kcfAutoStudentRoster|kcfTeacherSheetRosterHost|mountRoster|restoreRoster/);
  assert.match(normalCss, /\.kcfNormalSheetClassBtn \{[\s\S]*?min-width:52px;/);
  assert.match(normalCss, /\.kcfNormalSheetSendBtn \{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.match(normalCss, /\.kcfNormalSheetBottom \{[\s\S]*?gap:4px;[\s\S]*?padding:0 11px;/);
  assert.match(normalCss, /\.kcfNormalSheetClassBtn \{[\s\S]*?margin-left:8px;[\s\S]*?margin-right:12px;/);
  assert.match(normalCss, /\.kcfNormalSheetVoiceBtn \{[\s\S]*?margin-right:12px;/);
});

test('Class sheet owns only C roster send and rejects normal-mode open', () => {
  assert.match(teacherJs, /id="kcfTeacherSheetModeBtn"[^>]*>C<\/button>/);
  assert.match(teacherJs, /id="kcfTeacherSheetRosterHost"/);
  assert.match(teacherJs, /id="kcfTeacherSheetSendBtn"/);
  assert.doesNotMatch(teacherJs, /kcfTeacherSheetAttachBtn|kcfTeacherSheetVoiceBtn|kcfTeacherSheetNormalSpacer/);
  assert.match(teacherJs, /function open\(\)\{\s*if \(!modeEnabled\(\)\) return false;/);
  assert.match(teacherCss, /\.kcfTeacherSheetModeBtn \{[\s\S]*?width:33px;[\s\S]*?background:#111;[\s\S]*?color:#fff;/);
});

test('normal sheet activation does not force textarea scroll after focus', () => {
  const focusBlock = normalJs.match(/function focusEditor\(\)[\s\S]*?\n  \}/)?.[0] || '';
  const openStart = normalJs.indexOf('function open(event)');
  const openEnd = normalJs.indexOf('\n  function close(options)', openStart);
  const openBlock = openStart >= 0 && openEnd > openStart ? normalJs.slice(openStart, openEnd) : '';
  assert.match(focusBlock, /selectionEnd:true/);
  assert.doesNotMatch(focusBlock, /scrollToEnd:true/);
  assert.match(openBlock, /selectionEnd:true/);
  assert.doesNotMatch(openBlock, /scrollToEnd:true/);
  assert.match(normalCss, /\.kcfNormalSheetCloseBtn \{[\s\S]*?top:20px;[\s\S]*?right:22px;/);
});

test('normal Class button leaves normal sheet and delegates activation to Teacher mode', () => {
  const click = normalJs.match(/classBtn\.addEventListener\('click',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(click, /syncToBase\(\)/);
  assert.match(click, /close\(\{ sync:false \}\)/);
  assert.match(click, /await global\.toggleKinderChatFeedbackTeacherMode\(event\)/);
  assert.match(runtime, /function activateTeacherRoster\(teacherPrefill\)[\s\S]*?global\.KcfTeacherSheet\.open\(\)/);
});

test('Class C button disables Teacher mode and returns to the normal sheet', () => {
  const click = teacherJs.match(/modeBtn\.addEventListener\('click',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(click, /await global\.toggleKinderChatFeedbackTeacherMode\(event\)/);
  assert.match(click, /!modeEnabled\(\)/);
  assert.match(click, /global\.KcfNormalSheet\.open\(\)/);
});

test('normal send uses the existing normal feedback submit source without Teacher roster checks', () => {
  const click = normalJs.match(/send\.addEventListener\('click',[\s\S]*?\n      \}\);/)?.[0] || '';
  assert.match(click, /await global\.submitKinderChatFeedback\(\)/);
  assert.doesNotMatch(click, /modeEnabled|KcfTeacherMode|getSelection|kcfAutoStudentRoster/);
  assert.match(click, /var accepted = !!\(source && !String\(source\.value \|\| ''\)\.trim\(\) && !hasWarning\)/);
});

test('normal and Class sheets have independent viewport and page-lock state', () => {
  assert.match(normalJs, /--kcf-normal-vv-top/);
  assert.match(normalCss, /body\.kcfNormalSheetOpen/);
  assert.match(teacherJs, /--kcf-teacher-vv-top/);
  assert.match(teacherCss, /body\.kcfTeacherSheetOpen/);
  assert.doesNotMatch(normalJs, /kcfTeacherSheetOpen/);
  assert.doesNotMatch(teacherJs, /kcfNormalSheetOpen/);
});

test('Teacher successful submit still auto-advances Class roster before closing Class sheet', () => {
  assert.match(runtime, /completeSuccessfulSubmit\(context\)[\s\S]*?selectNextAvailableAutoStudent/);
  assert.match(runtime, /global\.KcfTeacherSheet\.onSuccessfulSubmit\(\)/);
  assert.match(teacherJs, /function onSuccessfulSubmit\(\)[\s\S]*?close\(\{ sync:false \}\)/);
});

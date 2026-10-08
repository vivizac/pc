const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');
const html = read('index.html');
const base = read('kinder-feedback.js');
const sheet = read('kcf-teacher-sheet.js');
const runtime = read('kcf-auto-mode-runtime.js');
const css = read('kcf-teacher-sheet.css');
const reg = read('../../packages/common/olli-feedback-registration-runtime.js');

test('QuickNote uses a single Class sheet and fully removes normal-mode assets', () => {
  assert.ok(html.includes('kcf-teacher-sheet.js?v=20261008-placeholder-2'));
  assert.ok(!html.includes('kcf-normal-sheet'));
  assert.ok(!fs.existsSync('kcf-normal-sheet.js'));
  assert.ok(!fs.existsSync('kcf-normal-sheet.css'));
  assert.ok(!base.includes('KcfNormalSheet'));
  assert.ok(!sheet.includes('KcfNormalSheet'));
});

test('inline input opens the Class sheet synchronously on a user gesture', () => {
  assert.ok(base.includes('mode.activateForComposer(event)'));
  assert.ok(base.includes('const sheet = window.KcfTeacherSheet'));
  assert.ok(runtime.includes("activateTeacherRoster('', event)"));
  assert.ok(runtime.includes('global.KcfTeacherSheet.open(event)'));
  assert.ok(sheet.includes('keyboard.activate(event, {'));
});

test('Class controls are replaced with dialogue and continuous-record selection', () => {
  assert.ok(html.includes('id="kcfModeSwitchBtn"'));
  assert.ok(!html.includes('id="kcfTeacherBtn"'));
  assert.ok(sheet.includes('id="kcfTeacherSheetModeHost"'));
  assert.ok(sheet.includes("mountSheetControls()"));
  assert.ok(!sheet.includes('id="kcfSheetModeSwitchBtn"'));
  assert.ok(sheet.includes("['dialogue','대화']"));
  assert.ok(sheet.includes("['continuous','연속기록']"));
  assert.ok(css.includes('.kcfComposerModeMenu'));
});

test('student names can be toggled off to manually write feedback for other classes', () => {
  assert.ok(runtime.includes('if (nextId === currentId) { deselectAutoStudent(); return; }'));
  assert.ok(runtime.includes("input.placeholder = '수업기록을 적어주세요'"));
  assert.ok(!runtime.includes('학생 이름과 수업기록을 적어주세요'));
  assert.ok(reg.includes('resolveKcfInlineFeedbackTarget(text)'));
  assert.ok(reg.includes('window.__olliPhoneInlineStudentFeedbackEnabled === true'));
});

test('continuous submit retains sheet and keyboard, dialogue submit closes', () => {
  assert.ok(sheet.includes("state.composerMode !== 'continuous') close({ sync:false })"));
  assert.ok(sheet.includes("state.composerMode === 'continuous') return;"));
  assert.ok(sheet.includes('if (state.open) syncFromBase()'));
  assert.ok(runtime.includes('selectNextAvailableAutoStudent(submitted.studentId'));
});

test('submission clears previous input before selecting next student draft', () => {
  const area = reg.slice(reg.indexOf('async function continueKinderChatFeedbackSubmit('), reg.indexOf('window.submitKinderChatFeedback = async'));
  assert.ok(area.indexOf("input.value = '';") < area.indexOf('completeSuccessfulSubmit(autoSubmitContext || null)'));
  assert.ok(area.includes('clearKinderChatFeedbackDraft'));
});

test('continuous mode warns instead of clearing an unmatched student name', () => {
  assert.ok(reg.includes("window.KcfTeacherSheet.getMode() === 'continuous'"));
  assert.ok(reg.includes("setKinderChatFeedbackWarning('학생 이름을 먼저 적고 수업기록을 입력해 주세요.')"));
});

test('record presentation removes conversational rows but retains the result cards', () => {
  assert.ok(css.includes('.kcfMsgRow:not(.kcfLiveResponseRow){display:none;}'));
  assert.ok(css.includes('.kcfLiveResponseRow{align-items:stretch'));
});

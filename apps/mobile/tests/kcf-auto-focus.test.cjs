const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');
const html = read('index.html');
const runtime = read('kcf-auto-mode-runtime.js');
const sheet = read('kcf-teacher-sheet.js');
const css = read('kcf-auto-mode.css');
const feedbackCss = read('kinder-feedback.css');

test('QuickNote composer has the mode dropdown and compact send controls', () => {
  assert.ok(html.includes('id="kcfModeSwitchBtn"'));
  assert.ok(html.includes('id="kcfSendBtn"'));
  assert.ok(feedbackCss.includes('.kcfSendBtn'));
  assert.ok(!runtime.includes('getTeacherButton()'));
  assert.ok(!runtime.includes('toggleKinderChatFeedbackTeacherMode'));
  assert.ok(css.includes('.kcfComposerModeBtn'));
});

test('Teacher roster state and legacy feedback API alias are preserved', () => {
  assert.ok(runtime.includes('global.KcfTeacherMode = {'));
  assert.ok(runtime.includes('global.KcfAutoMode = global.KcfTeacherMode'));
  assert.ok(runtime.includes('onFeedbackRequestStarted:'));
  assert.ok(runtime.includes('onFeedbackRequestResult:'));
});

test('the sheet opens without awaiting the schedule network request', () => {
  const begin = runtime.indexOf('function activateTeacherRoster(');
  const end = runtime.indexOf('function filterFeedbackItems(', begin);
  const activation = runtime.slice(begin, end);
  assert.ok(activation.includes('global.KcfTeacherSheet.open(event)'));
  assert.ok(activation.includes("preloadTodayScheduleQueue({ force:state.rosterStatus === 'error' })"));
  assert.ok(activation.indexOf('global.KcfTeacherSheet.open(event)') < activation.indexOf('preloadTodayScheduleQueue'));
  assert.ok(sheet.includes('keyboard.activate(event, {'));
});

test('student selection retains personal drafts and supports second-click deselection', () => {
  assert.ok(runtime.includes('if (nextId === currentId) { deselectAutoStudent(); return; }'));
  assert.ok(runtime.includes('saveCurrentAutoDraft()'));
  assert.ok(runtime.includes('state.manualEntry = true'));
  assert.ok(runtime.includes('button.textContent = item.name'));
});

test('schedule refresh and feedback edit behavior remain available', () => {
  assert.ok(runtime.includes("addEventListener('olli:schedule-changed'"));
  assert.ok(runtime.includes('completeSuccessfulSubmit'));
  assert.ok(runtime.includes('getSelection: getSelection'));
  assert.ok(runtime.includes('getRosterStatus:'));
  assert.ok(runtime.includes("var autoBtn = document.getElementById('kcfModeSwitchBtn');"));
});

test('opening the QuickNote page warms the roster without activating the keyboard', () => {
  const start = runtime.indexOf('function onPageOpened()');
  const end = runtime.indexOf('function bindTeacherRosterRefreshEvents()', start);
  const body = runtime.slice(start, end);
  assert.ok(body.includes('preloadTodayScheduleQueue({ force:true })'));
  assert.ok(!body.includes('global.KcfTeacherSheet.open()'));
});

test('inline source remains read-only and preserves existing voice controls', () => {
  assert.ok(html.includes('id="kcfVoiceBtn"'));
  assert.ok(html.includes('id="kcfInputActivateBtn"'));
  assert.match(html, /id="kcfInput"[^>]*readonly/);
});

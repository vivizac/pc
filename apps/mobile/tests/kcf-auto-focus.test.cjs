const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const css = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const feedbackCss = fs.readFileSync('kinder-feedback.css', 'utf8');
const sheet = fs.readFileSync('kcf-teacher-sheet.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('Feedback actions use Class beside the mic and keep compact controls', () => {
  assert.match(html, /id="kcfAttachBtn"[\s\S]*id="kcfInput"[\s\S]*id="kcfTeacherBtn"[^>]*>Class<\/button>[\s\S]*id="kcfVoiceBtn"[\s\S]*id="kcfSendBtn"/);
  assert.match(feedbackCss, /\.kcfAttachBtn \{[\s\S]*?width:33px;[\s\S]*?height:33px;/);
  assert.match(feedbackCss, /\.kcfSendBtn \{[\s\S]*?width:33px;[\s\S]*?height:33px;[\s\S]*?min-width:33px;/);
  assert.match(css, /\.kcfTeacherBtn \{[\s\S]*?min-width:52px !important;[\s\S]*?height:33px !important;[\s\S]*?padding:0 10px !important;/);
  assert.match(css, /\.kcfTeacherBtn\.active \{[\s\S]*?min-width:33px !important;[\s\S]*?background:#111 !important;[\s\S]*?color:#fff !important;/);
  assert.match(runtime, /btn\.textContent = state\.loading \? '···' : \(state\.enabled \? 'C' : 'Class'\)/);
});

test('Teacher is the canonical mode namespace and legacy AUTO remains only as an alias', () => {
  assert.match(runtime, /global\.KcfTeacherMode = \{/);
  assert.match(runtime, /isEnabled: isEnabled/);
  assert.match(runtime, /global\.KcfAutoMode = global\.KcfTeacherMode/);
  assert.match(runtime, /global\.toggleKinderChatFeedbackAutoMode = global\.toggleKinderChatFeedbackTeacherMode/);
});

test('Teacher mode opens and closes only the rebuilt Teacher sheet', () => {
  assert.match(runtime, /global\.KcfTeacherSheet && typeof global\.KcfTeacherSheet\.open === 'function'/);
  assert.match(runtime, /global\.KcfTeacherSheet\.open\(\)/);
  assert.match(runtime, /global\.KcfTeacherSheet && typeof global\.KcfTeacherSheet\.close === 'function'/);
  assert.match(runtime, /global\.KcfTeacherSheet\.close\(\{ sync:false \}\)/);
  assert.doesNotMatch(runtime, /setKinderChatFeedbackComposerExpanded/);
});

test('text typed before T is preserved when Teacher mode selects the first student', () => {
  assert.match(runtime, /var teacherPrefill = inputBeforeTeacher \? String\(inputBeforeTeacher\.value \|\| ''\) : ''/);
  assert.match(runtime, /if \(input && teacherPrefill\.trim\(\)\)/);
  assert.match(runtime, /input\.value = teacherPrefill/);
  assert.match(runtime, /state\.drafts\[selectedId\] = teacherPrefill/);
});

test('Teacher roster uses student name cards only and removes teacher labels', () => {
  const render = runtime.match(/function renderAutoRoster\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(render, /kcfAutoStudentChip/);
  assert.match(render, /button\.textContent = item\.name/);
  assert.match(render, /scroller\.appendChild\(button\)/);
  assert.doesNotMatch(render, /kcfAutoTeacherLabel/);
  assert.doesNotMatch(render, /displayTeacherName/);
  assert.match(sheet, /event\.target\.closest\('\.kcfAutoStudentChip'\)/);
});

test('QuickNote shared-sheet assets use the unified cache keys', () => {
  assert.match(html, /kinder-feedback\.css\?v=20261001-unified-sheet-1/);
  assert.match(html, /kinder-feedback\.js\?v=20261001-unified-sheet-1/);
  assert.match(html, /kcf-auto-mode\.css\?v=20261001-unified-sheet-1/);
  assert.match(html, /kcf-teacher-sheet\.css\?v=20261001-unified-sheet-1/);
  assert.match(html, /kcf-teacher-sheet\.js\?v=20261001-unified-sheet-1/);
});

test('Teacher roster is preloaded on page entry and empty state never opens the sheet', () => {
  const toggle = runtime.match(/global\.toggleKinderChatFeedbackTeacherMode = async function[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(runtime, /rosterStatus: 'loading'/);
  assert.match(runtime, /state\.rosterStatus = state\.queue\.length \? 'ready' : 'empty'/);
  assert.match(runtime, /state\.rosterStatus = 'error'/);
  assert.match(runtime, /function onPageOpened\(\)[\s\S]*?preloadTodayScheduleQueue\(\{ force:true \}\)/);
  assert.match(toggle, /state\.rosterStatus === 'empty'[\s\S]*?showTeacherRosterEmptyNotice\(\)[\s\S]*?return/);
  assert.doesNotMatch(toggle, /state\.enabled = true;[\s\S]*?await preloadTodayScheduleQueue/);
  assert.match(runtime, /function activateTeacherRoster\(teacherPrefill\)[\s\S]*?global\.KcfTeacherSheet\.open\(\)/);
  assert.match(sheet, /focusEditor\(\);[\s\S]*?requestAnimationFrame/);
});

test('Teacher roster refreshes its preload cache after schedule changes', () => {
  assert.match(runtime, /addEventListener\('olli:schedule-changed'[\s\S]*?preloadTodayScheduleQueue\(\{ force:true \}\)/);
});


test('inline roster starts close to the Class control without a hidden teacher label gap', () => {
  assert.match(css, /\.kcfAutoStudentRoster \{[\s\S]*?padding:0 41px 0 39px;/);
  assert.match(css, /\.kcfAutoStudentRosterScroller \{[\s\S]*?padding:1px 0 2px;/);
  assert.doesNotMatch(css, /\.kcfAutoTeacherGroup/);
  assert.doesNotMatch(css, /\.kcfAutoTeacherLabel/);
  assert.doesNotMatch(runtime, /function displayTeacherName/);
});


test('one-minute feedback stays Live-only and removes the old top Live/inbox buttons', () => {
  assert.doesNotMatch(html, /id="kcfOlliBtn"/);
  assert.doesNotMatch(html, /id="kcfInboxModeBtn"/);
  assert.match(html, /id="kcfOlliTalkBtn"/);
  const feedback = fs.readFileSync('kinder-feedback.js', 'utf8');
  assert.match(feedback, /function setKinderChatFeedbackTopMode\(mode, persist = true\)\{[\s\S]*kcfTopMode = 'live'/);
  assert.match(feedback, /function restoreKinderChatFeedbackTopMode\(\)\{\s*setKinderChatFeedbackTopMode\('live', false\)/);
});

test('normal composer stays one-line because editing now happens in the shared sheet', () => {
  assert.match(feedbackCss, /\.kcfInput \{[\s\S]*?height:34px;[\s\S]*?max-height:34px;/);
  assert.doesNotMatch(feedbackCss, /kcfKeyboardOpen/);
  assert.match(html, /id="kcfInput"[^>]*readonly/);
});

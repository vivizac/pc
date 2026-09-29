const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const css = fs.readFileSync('kcf-auto-mode.css', 'utf8');
const teacherCss = fs.readFileSync('kcf-teacher-sheet.css', 'utf8');

test('record-edit styles no longer depend on the removed expanded composer', () => {
  assert.doesNotMatch(css, /kcfComposerExpanded/);
  assert.match(teacherCss, /\.kcfTeacherSheetInput::placeholder \{[\s\S]*?color:#b8b8b8;/);
});

test('live and archive edit buttons share the same transparent gray button style', () => {
  assert.match(css, /#kinderChatFeedbackScreen \.kcfRecordEditBtn\s*\{[\s\S]*?margin:5px 5px 0 0;[\s\S]*?padding:2px 3px;[\s\S]*?border:none;[\s\S]*?background:transparent;[\s\S]*?color:#8a8a8a;[\s\S]*?font-size:calc\(12px \* var\(--olli-text-scale\)\);/);
  assert.match(runtime, /function ensureLiveRecordEditButton\(row\)[\s\S]*?editBtn\.className = 'kcfRecordEditBtn';[\s\S]*?editBtn\.textContent = '수정하기';/);
  assert.match(runtime, /function onDocumentMessageAdded\(row, data\)[\s\S]*?editBtn\.className = 'kcfRecordEditBtn';[\s\S]*?editBtn\.textContent = '수정하기';/);
});

test('shared discard path drops live feedback and is reused by both edit flows', () => {
  assert.match(runtime, /function discardFeedbackJob\(jobId\)[\s\S]*?state\.discardedIds\.add\(id\);/);
  assert.match(runtime, /function discardFeedbackJob\(jobId\)[\s\S]*?liveItem\.status = 'discarded';/);
  assert.match(runtime, /data-kcf-live-feedback-id/);
  assert.match(runtime, /global\.editKinderChatLiveRecord = function\(jobId, row\)[\s\S]*?discardFeedbackJob\(id\);/);
  assert.match(runtime, /global\.editKinderChatSubmittedRecord = function\(jobId\)[\s\S]*?discardFeedbackJob\(id\);/);
  assert.match(runtime, /discardFeedbackJob: discardFeedbackJob/);
});

test('live edit copies the user record into the composer and focuses it', () => {
  const liveEdit = runtime.match(/global\.editKinderChatLiveRecord = function\(jobId, row\)[\s\S]*?\n  \};\n\n  global\.editKinderChatSubmittedRecord/)?.[0] || '';
  assert.match(liveEdit, /body = clean\(liveItem && liveItem\.sourceText\) \|\| clean\(bubble && bubble\.textContent\)/);
  assert.match(liveEdit, /input\.value = body;/);
  assert.match(liveEdit, /focusInputAtEnd\(input\);/);
});

test('saving a live edit reuses the same request route with a fresh id', () => {
  const saveEdit = runtime.match(/async function saveSubmittedRecordEdit\(\)[\s\S]*?\n  function isEditing\(\)/)?.[0] || '';
  assert.match(saveEdit, /isLiveEdit/);
  assert.match(saveEdit, /record\.row\.dataset\.kcfLiveUserFor = newId;/);
  assert.match(saveEdit, /global\.startTodayFeedbackRequest\(nextOptions\)/);
  assert.match(saveEdit, /state\.discardedIds\.delete\(newId\)/);
});

test('live edit buttons are attached to live user rows, including restored rows', () => {
  assert.match(runtime, /function bindLiveRecordEditButtons\(\)[\s\S]*?\.kcfMsgRow\.user\[data-kcf-live-user-for\]/);
  assert.match(runtime, /new MutationObserver/);
  assert.match(runtime, /attributeFilter:\['data-kcf-live-user-for'\]/);
  assert.match(runtime, /function onPageOpened\(\)[\s\S]*?bindLiveRecordEditButtons\(\);/);
});

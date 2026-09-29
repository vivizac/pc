const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const phoneAdapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');

test('LIVE responses keep a memory-only item map and expose copy edit save actions', () => {
  assert.match(js, /const kcfLiveFeedbackItems = new Map\(\)/);
  assert.match(js, /kcfLiveFeedbackItems\.set\(item\.id, item\)/);
  assert.match(js, /copyKinderChatFeedbackLive\(options\.id, copyBtn\)/);
  assert.match(js, /editKinderChatFeedbackLive\(options\.id\)/);
  assert.match(js, /saveKinderChatFeedbackLive\(options\.id, saveBtn\)/);
  const liveStart = js.indexOf('function startKinderChatFeedbackLiveRequest(options = {})');
  const liveEnd = js.indexOf('async function copyKinderChatSourceCardText', liveStart);
  const liveRequest = js.slice(liveStart, liveEnd);
  assert.doesNotMatch(liveRequest, /setTodayFeedbackItemsRaw|createTodayFeedbackItem|updateTodayFeedbackItem/);
});

test('LIVE save reuses canonical feedback storage and supports duplicate-name student picker', () => {
  const start = js.indexOf('async function saveKinderChatFeedbackLive');
  const end = js.indexOf('function startKinderChatFeedbackLiveRequest', start);
  const save = js.slice(start, end);
  assert.match(save, /autoSaveGeneratedFeedback\(item\.resultText/);
  assert.match(save, /linkFeedbackPhotosToStudent\(item, finalStudentId\)/);
  assert.match(save, /openKinderChatFeedbackSaveStudentPicker\(item\.id, candidates, 'live'\)/);
  assert.match(js, /if \(source === 'live'\) saveKinderChatFeedbackLive\(itemId, null, selectedId\)/);
});

test('editing an already saved LIVE response patches the saved server row before UI commit', () => {
  const start = js.indexOf('async function confirmKinderChatFeedbackLiveEdit');
  const end = js.indexOf('async function saveKinderChatFeedbackLive', start);
  const edit = js.slice(start, end);
  const patchAt = edit.indexOf('await patchSavedTodayFeedbackItem(item, nextText)');
  const localAt = edit.indexOf('item.resultText = nextText');
  assert.ok(patchAt >= 0 && localAt > patchAt);
  assert.match(edit, /getTodayFeedbackSavedRowId\(item\)/);
});

test('LIVE student names are visible without entering copied feedback body', () => {
  assert.match(js, /function decorateKinderChatFeedbackLiveUserRow\(row, item\)/);
  assert.match(js, /kcfLiveUserStudentName/);
  assert.match(js, /kcfLiveUserMessageText/);
  assert.match(js, /studentTitle\.className = 'kcfLiveStudentTitle'/);
  assert.match(js, /row\.append\(studentTitle, bubble, editArea, actions\)/);

  const copyStart = js.indexOf('async function copyKinderChatFeedbackLive');
  const copyEnd = js.indexOf('async function editKinderChatFeedbackLive', copyStart);
  const copy = js.slice(copyStart, copyEnd);
  assert.match(copy, /copyKinderChatSourceCardText\(btn, item\.resultText\)/);
  assert.doesNotMatch(copy, /kcfLiveStudentTitle/);
});

test('Phone LIVE copy and edit actions are same-size gray text buttons without icons', () => {
  const decorateStart = phoneAdapter.indexOf('function decoratePhoneKcfLiveMessage');
  const decorateEnd = phoneAdapter.indexOf('/* LIVE feedback actions:', decorateStart);
  const decorate = phoneAdapter.slice(decorateStart, decorateEnd);

  assert.match(decorate, /copyBtn\.classList\.add\('kcfLiveCopySaveBtn', 'kcfLivePhoneTextActionBtn'\)/);
  assert.match(decorate, /copyBtn\.textContent = '복사 \+ 저장'/);
  assert.match(decorate, /editBtn\.classList\.add\('kcfLivePhoneTextActionBtn'\)/);
  assert.match(decorate, /editBtn\.textContent = '수정하기'/);
  assert.doesNotMatch(decorate, /copyIcon/);
  assert.doesNotMatch(decorate, /outerHTML/);
  assert.match(phoneAdapter, /if \(saveBtn\) saveBtn\.remove\(\)/);
  assert.match(phoneAdapter, /saveKinderChatFeedbackLive\(id, null\)/);
  assert.match(css, /\.kcfLiveActionBtn\.kcfLivePhoneTextActionBtn \{[\s\S]*width:auto;[\s\S]*min-width:0;[\s\S]*padding:0;[\s\S]*background:transparent;[\s\S]*color:#8e8e93;/);
  assert.match(css, /\.kcfLiveActions \{[\s\S]*width:100%;[\s\S]*justify-content:flex-start;[\s\S]*margin:8px 0 0;[\s\S]*padding:0;/);
});

test('LIVE action and editor styles are source-owned and cache-busted', () => {
  assert.match(css, /\/\* KCF LIVE response actions \*\//);
  assert.match(css, /\.kcfLiveResponseDone \.kcfLiveActions \{ display:flex; \}/);
  assert.match(css, /\.kcfLiveResponseRow\.editing \.kcfLiveEditArea \{ display:block; \}/);
  assert.match(js, /const KCF_LIVE_ACTION_ICON_SVG = \{/);
  assert.match(js, /kcfLiveCopyBtn', 'copy'\)/);
  assert.match(js, /kcfLiveEditBtn', 'edit'\)/);
  assert.match(js, /kcfLiveSaveBtn', 'save'\)/);
  assert.match(css, /\.kcfLiveActionBtn\.kcfLiveIconActionBtn \{/);
  assert.match(css, /stroke-width:1\.55/);
  assert.match(html, /kinder-feedback\.js\?v=20260922-student-name-copy-save-1/);
  assert.match(html, /kinder-feedback\.css\?v=20260922-transparent-live-actions-1/);
  assert.match(html, /olli-feedback-registration-phone-adapter\.js\?v=20260922-live-text-actions-1/);
});

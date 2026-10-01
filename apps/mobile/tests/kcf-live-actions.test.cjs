const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const css = fs.readFileSync('kinder-feedback.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const phoneAdapter = fs.readFileSync('olli-feedback-registration-phone-adapter.js', 'utf8');

test('LIVE response actions are temporary inbox, copy, and edit only', () => {
  const start = js.indexOf('function createKinderChatFeedbackLiveMessage');
  const end = js.indexOf('async function getKinderChatFeedbackLiveErrorMessage', start);
  const create = js.slice(start, end);

  assert.match(create, /createKinderChatFeedbackLiveActionButton\('임시보관함', 'kcfLiveNormalAction kcfLiveInboxBtn'\)/);
  assert.match(create, /createKinderChatFeedbackLiveActionButton\('복사', 'kcfLiveNormalAction kcfLiveCopyBtn'\)/);
  assert.match(create, /createKinderChatFeedbackLiveActionButton\('수정', 'kcfLiveNormalAction kcfLiveEditBtn'\)/);
  assert.match(create, /inboxBtn\.addEventListener\('click', \(\) => openKinderChatFeedbackInbox\(\)\)/);
  assert.match(create, /actions\.append\(inboxBtn, copyBtn, editBtn, cancelBtn, doneBtn\)/);
  assert.doesNotMatch(create, /kcfLiveSaveBtn|saveBtn|복사 \+ 저장/);
});

test('LIVE action source contains no icon or copy-save residue', () => {
  assert.doesNotMatch(js, /KCF_LIVE_ACTION_ICON_SVG/);
  assert.doesNotMatch(js, /kcfLiveIconActionBtn/);
  assert.doesNotMatch(js, /kcfLiveSaveBtn/);
  assert.doesNotMatch(phoneAdapter, /kcfLiveCopySaveBtn|phoneCopyKinderChatFeedbackLive|__olliPhoneAutoSave|복사 \+ 저장/);
  assert.doesNotMatch(css, /kcfLiveIconActionBtn|kcfLiveSaveBtn/);
});

test('stream completion renders first, then auto-saves, then reveals actions', () => {
  const start = js.indexOf('function startKinderChatFeedbackLiveRequest');
  const end = js.indexOf('async function copyKinderChatSourceCardText', start);
  const live = js.slice(start, end);
  const renderAt = live.indexOf('renderKinderChatFeedbackLiveResultText(liveUi.bubble, finalText)');
  const saveAt = live.indexOf('await saveKinderChatFeedbackLive(item.id, item.studentId)');
  const actionsAt = live.indexOf('showKinderChatFeedbackLiveActions(item)');
  assert.ok(renderAt >= 0);
  assert.ok(saveAt > renderAt);
  assert.ok(actionsAt > saveAt);
});

test('automatic LIVE save reuses canonical Supabase feedback storage', () => {
  const start = js.indexOf('async function saveKinderChatFeedbackLive');
  const end = js.indexOf('function startKinderChatFeedbackLiveRequest', start);
  const save = js.slice(start, end);
  assert.match(save, /autoSaveGeneratedFeedback\(item\.resultText/);
  assert.match(save, /linkFeedbackPhotosToStudent\(item, finalStudentId\)/);
  assert.match(save, /item\.saved = true/);
  assert.match(save, /syncKinderChatFeedbackLiveItemToInbox\(item\)/);
  assert.doesNotMatch(save, /setKinderChatFeedbackLiveActionLabel|저장 중|저장 완료/);
});

test('LIVE items mirror into the existing temporary inbox without a second server write', () => {
  const start = js.indexOf('function syncKinderChatFeedbackLiveItemToInbox');
  const end = js.indexOf('function getKinderChatFeedbackLiveRow', start);
  const mirror = js.slice(start, end);
  assert.match(mirror, /getTodayFeedbackItemsRaw\(\)/);
  assert.match(mirror, /setTodayFeedbackItemsRaw\(safeList\)/);
  assert.match(mirror, /sourcePage:'kinderChatFeedback'/);
  assert.doesNotMatch(mirror, /autoSaveGeneratedFeedback|saveOlliData|supabase/);
});

test('Phone LIVE controls use text-only layout with inbox left and copy/edit right', () => {
  const start = phoneAdapter.indexOf('function decoratePhoneKcfLiveMessage');
  const end = phoneAdapter.indexOf('/* LIVE feedback actions use text-only', start);
  const decorate = phoneAdapter.slice(start, end);
  assert.match(decorate, /querySelector\('\.kcfLiveInboxBtn'\)/);
  assert.match(decorate, /inboxBtn\.classList\.add\('kcfLivePhoneTextActionBtn'\)/);
  assert.match(decorate, /copyBtn\.textContent = '복사'/);
  assert.match(decorate, /editBtn\.classList\.add\('kcfLivePhoneTextActionBtn'\)/);
  assert.match(css, /\.kcfLiveInboxBtn \{\s*margin-right:auto;/);
  assert.match(css, /\.kcfLiveActionBtn\.kcfLivePhoneTextActionBtn \{[\s\S]*?background:transparent;[\s\S]*?color:#8e8e93;/);
});

test('temporary inbox itself remains connected and copy-only', () => {
  assert.match(html, /id="kcfInboxOverlay"/);
  assert.match(js, /function openKinderChatFeedbackInbox\(\)/);
  assert.match(js, /onclick="copyKinderChatFeedbackInbox\('/);
  assert.doesNotMatch(js, /copyAndSaveKinderChatFeedback/);
});

test('editing an already auto-saved LIVE response patches the server and refreshes inbox mirror', () => {
  const start = js.indexOf('async function confirmKinderChatFeedbackLiveEdit');
  const end = js.indexOf('async function saveKinderChatFeedbackLive', start);
  const edit = js.slice(start, end);
  const patchAt = edit.indexOf('await patchSavedTodayFeedbackItem(item, nextText)');
  const localAt = edit.indexOf('item.resultText = nextText');
  assert.ok(patchAt >= 0 && localAt > patchAt);
  assert.match(edit, /syncKinderChatFeedbackLiveItemToInbox\(item\)/);
});

test('auto-save LIVE assets are cache-busted', () => {
  assert.match(html, /kinder-feedback\.js\?v=20261002-auto-save-actions-1/);
  assert.match(html, /kinder-feedback\.css\?v=20261002-auto-save-actions-1/);
  assert.match(html, /olli-feedback-registration-phone-adapter\.js\?v=20261002-auto-save-actions-1/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const scrollReset = fs.readFileSync('olli-page-scroll-reset.js', 'utf8');

test('LIVE academy identity uses stable fallbacks', () => {
  const start = js.indexOf('function getKinderChatFeedbackLiveAcademyId(){');
  const end = js.indexOf('function getKinderChatFeedbackLiveDateKey', start);
  const source = js.slice(start, end);
  assert.match(source, /getOlliCurrentAcademyId/);
  assert.match(source, /OlliStorageCore\?\.AcademyContext\?\.getCurrent/);
  assert.match(source, /localStorage\.getItem\('olli_current_academy_id'\)/);
});

test('LIVE restore is a single read after the page becomes visible', () => {
  assert.doesNotMatch(js, /function scheduleKinderChatFeedbackLiveSessionRestore/);
  assert.doesNotMatch(js, /\[0, 120, 400, 900, 1800\]/);
  const start = js.indexOf('function openKinderChatFeedbackPage()');
  const end = js.indexOf('async function closeKinderChatFeedbackPage', start);
  const source = js.slice(start, end);
  const displayAt = source.indexOf("page.style.display = 'flex'");
  const restoreAt = source.indexOf('restoreKinderChatFeedbackLiveSession();');
  assert.ok(displayAt >= 0 && restoreAt > displayAt);
  assert.equal((source.match(/restoreKinderChatFeedbackLiveSession\(\);/g) || []).length, 1);
});

test('page scroll reset keeps the 1-minute feedback chat on the latest message', () => {
  const helperStart = scrollReset.indexOf('function resetScrollElementForPage');
  const helperEnd = scrollReset.indexOf('function hasActiveEditableInside', helperStart);
  const helper = scrollReset.slice(helperStart, helperEnd);
  const resetStart = scrollReset.indexOf('function resetPageScroll');
  const resetEnd = scrollReset.indexOf('function resetVisiblePageScroll', resetStart);
  const reset = scrollReset.slice(resetStart, resetEnd);

  assert.match(helper, /root\?\.id === 'kinderChatFeedbackScreen'/);
  assert.match(helper, /el\.classList\?\.contains\('kcfChatArea'\)/);
  assert.match(helper, /el\.scrollTop = el\.scrollHeight/);
  assert.match(reset, /resetScrollElementForPage\(root, el\)/);
  assert.doesNotMatch(reset, /forEach\(resetScrollElement\)/);
});

test('LIVE mode return and app foreground each re-read once', () => {
  const modeStart = js.indexOf('function setKinderChatFeedbackTopMode');
  const modeEnd = js.indexOf('function restoreKinderChatFeedbackTopMode', modeStart);
  assert.match(js.slice(modeStart, modeEnd), /kcfTopMode === 'live'.*restoreKinderChatFeedbackLiveSession\(\)/s);
  const lifeStart = js.indexOf("if (!window.__kcfLiveSessionLifecycleBound)");
  const life = js.slice(lifeStart);
  assert.match(life, /document\.visibilityState === 'visible'/);
  assert.match(life, /restoreKinderChatFeedbackLiveSession\(\)/);
});

test('LIVE uses rolling 24-hour retention and never calendar-day deletion', () => {
  assert.match(js, /KCF_LIVE_SESSION_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(js, /Date\.parse\(String\(session\?\.updatedAt \|\| session\?\.createdAt \|\| ''\)\)/);
  assert.doesNotMatch(js, /String\(session\.dateKey \|\| ''\) !== today/);
  assert.doesNotMatch(js, /\.filter\(item => String\(item\.dateKey \|\| dateKey\) === dateKey\)/);
  const restoreStart = js.indexOf('function restoreKinderChatFeedbackLiveSession(){');
  const restoreEnd = js.indexOf('function stripKinderChatFeedbackLivePrefix', restoreStart);
  assert.match(js.slice(restoreStart, restoreEnd), /const scope = academyId/);
});

test('LIVE does not read or write an unscoped academy session', () => {
  const readStart = js.indexOf('function readKinderChatFeedbackLiveSession(){');
  const readEnd = js.indexOf('function persistKinderChatFeedbackLiveSessionNow', readStart);
  assert.match(js.slice(readStart, readEnd), /academyId === 'unscoped'\) return null/);
  const persistStart = js.indexOf('function persistKinderChatFeedbackLiveSessionNow(){');
  const persistEnd = js.indexOf('function scheduleKinderChatFeedbackLiveSessionPersist', persistStart);
  const persist = js.slice(persistStart, persistEnd);
  assert.match(persist, /academyId === 'unscoped'\) return/);
  assert.doesNotMatch(persist, /localStorage\.clear\(\)/);
});

test('phone cache-busts rolling retention source', () => {
  assert.match(html, /kinder-feedback\.js\?v=20261002-auto-save-actions-1/);
});

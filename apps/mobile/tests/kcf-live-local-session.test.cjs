const fs = require('fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const js = fs.readFileSync(path.join(__dirname, '../kinder-feedback.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('QuickNote LIVE restores the academy-scoped draft without clearing unrelated jobs', () => {
  assert(js.includes("const KCF_LIVE_SESSION_KEY_PREFIX = 'olli_kcf_live_session_v1';"));
  assert(js.includes('`${KCF_LIVE_SESSION_KEY_PREFIX}_${getKinderChatFeedbackLiveAcademyId()}`'));
  assert(js.includes('KCF_LIVE_SESSION_PERSIST_DELAY_MS = 350'));
  assert(js.includes('KCF_LIVE_SESSION_MAX_ITEMS = 50'));
  assert(js.includes('KCF_LIVE_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000'));
  assert(js.includes("Date.parse(String(session?.updatedAt || session?.createdAt || ''))"));
  assert(!js.includes("String(session.dateKey || '') !== today"));
  assert(!js.includes('.filter(item => String(item.dateKey || dateKey) === dateKey)'));
  assert(js.includes('localStorage.removeItem(key);'));
  assert(!js.includes('localStorage.clear()'));
  assert(js.includes("item.status = 'interrupted';"));
  assert(js.includes("item.status === 'streaming'"));
  assert(js.includes('scheduleKinderChatFeedbackLiveSessionPersist();'));
  assert(js.includes('persistKinderChatFeedbackLiveSessionNow();'));
  assert(js.includes("window.addEventListener('pagehide'"));
  assert(js.includes("document.addEventListener('visibilitychange'"));
  assert(js.includes('restoreKinderChatFeedbackLiveSession();'));
  assert(js.includes('tagKinderChatFeedbackLiveUserRow(item);'));
  assert(js.includes('sanitizeKinderChatFeedbackLiveAttachments'));
  assert(js.includes("!/^data:/i.test(text)"));
  assert(js.includes('syncKinderChatFeedbackLiveItemToInbox(item)'));

  const sessionKeyIndex = js.indexOf('KCF_LIVE_SESSION_KEY_PREFIX');
  assert(sessionKeyIndex >= 0);
  assert(!js.slice(sessionKeyIndex, sessionKeyIndex + 10000).includes('olli_feedback_jobs_v2'));
});

test('QuickNote LIVE reveals the completed result before background save and keeps retry on failure', () => {
  assert.match(js, /showKinderChatFeedbackLiveActions\(item\);\s*if \(liveUi\.area\)[\s\S]{0,480}?void saveKinderChatFeedbackLive\(item\.id, item\.studentId\)\.then/);
  assert.match(js, /if \(saved !== true\) reportKinderChatFeedbackFailure\(item, 'SAVE_FAILED', 0\);/);
  assert.match(html, /<script src="kinder-feedback\.js\?v=[^"]+"/);
  assert.match(html, /<link rel="stylesheet" href="kinder-feedback\.css\?v=[^"]+"/);
});

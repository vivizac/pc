const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('KCF LIVE streams /api/chat directly into one bot bubble', () => {
  const start = js.indexOf('function startKinderChatFeedbackLiveRequest(options = {})');
  const end = js.indexOf('async function copyKinderChatSourceCardText', start);
  assert.ok(start >= 0 && end > start);
  const live = js.slice(start, end);
  assert.match(live, /fetch\('\/api\/chat'/);
  assert.match(live, /stream:\s*true/);
  assert.match(live, /response\.body\.getReader\(\)/);
  assert.match(live, /new TextDecoder\(\)/);
  assert.match(live, /restoreKinderChatFeedbackLiveStudentAliases\([\s\S]*?stripKinderChatFeedbackLivePrefix\(fullText\),[\s\S]*?item\.studentName[\s\S]*?\)/);
  assert.match(live, /liveUi\.bubble\.textContent = visibleText \|\| '…'/);
  assert.doesNotMatch(live, /liveTextRenderer/);
  assert.match(live, /syncKinderChatFeedbackLiveItemToInbox\(item\)/);
  assert.match(live, /await saveKinderChatFeedbackLive\(item\.id, item\.studentId\)/);
});

test('KCF LIVE restores anonymized student aliases in current and restored results', () => {
  assert.match(js, /function restoreKinderChatFeedbackLiveStudentAliases\(text, studentName\)/);
  assert.match(js, /return restoreFeedbackStudentAliases\(source, studentName\)/);
  assert.match(js, /const restoredStoredText = restoreKinderChatFeedbackLiveStudentAliases\(item\.resultText, item\.studentName\)/);
  assert.match(js, /item\.resultText = restoredStoredText/);
  assert.match(js, /const finalText = restoreKinderChatFeedbackLiveStudentAliases\([\s\S]*?stripKinderChatFeedbackLivePrefix\(fullText\),[\s\S]*?item\.studentName[\s\S]*?\)\.trim\(\)/);
});

test('KCF LIVE function is exported and reuses the existing temporary inbox sheet', () => {
  assert.match(js, /window\.startKinderChatFeedbackLiveRequest = startKinderChatFeedbackLiveRequest/);
  assert.match(js, /window\.getKinderChatFeedbackTopMode = getKinderChatFeedbackTopMode/);
  assert.match(js, /function renderKinderChatFeedbackInbox\(\)/);
  assert.match(js, /function syncKinderChatFeedbackLiveItemToInbox\(item\)/);
  assert.match(js, /openKinderChatFeedbackInbox\(\)/);
});

test('phone loads cache-busted LIVE streaming source', () => {
  assert.match(html, /kinder-feedback\.js\?v=20261002-auto-save-actions-1/);
});


test('KCF LIVE marks suspicious characters with the shared inbox renderer after streaming', () => {
  assert.match(js, /function renderKinderChatFeedbackLiveResultText\(bubble, text\)/);
  assert.match(js, /getSuspiciousFeedbackSegments\(source\)/);
  assert.match(js, /bubble\.innerHTML = renderSuspiciousFeedbackText\(source\)/);
  assert.match(js, /renderKinderChatFeedbackLiveResultText\(liveUi\.bubble, finalText\)/);
  assert.match(js, /renderKinderChatFeedbackLiveResultText\(bubble, nextText\)/);
  assert.match(js, /item\.suspiciousSegments = renderKinderChatFeedbackLiveResultText\(bubble, item\.resultText\)/);
});

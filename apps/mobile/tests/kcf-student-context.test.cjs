const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const kcf = fs.readFileSync('kinder-feedback.js', 'utf8');
const auto = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('manual KCF selection keeps id name and division together', () => {
  assert.match(kcf, /let kcfManualSelectedStudentDivision = '';/);
  assert.match(kcf, /studentDivision: studentDivision === 'kinder' \? 'kinder' : 'elementary'/);
  assert.match(kcf, /kcfManualSelectedStudentDivision = normalizeKinderChatFeedbackStudentDivision\(student\);/);
  assert.match(kcf, /window\.getKinderChatFeedbackManualSelection = getKinderChatFeedbackManualSelection;/);
  assert.match(kcf, /window\.setKinderChatFeedbackManualSelection = setKinderChatFeedbackManualSelection;/);
});

test('LIVE KCF sends division context to AI but keeps student id internal', () => {
  const start = kcf.indexOf('function startKinderChatFeedbackLiveRequest(options = {})');
  const end = kcf.indexOf('function getKinderChatFeedbackLiveItem', start);
  const live = kcf.slice(start, end > start ? end : start + 12000);
  assert.match(live, /studentDivision: item\.studentDivision/);
  const fetchStart = live.indexOf("fetch('/api/chat'");
  const fetchBlock = fetchStart >= 0 ? live.slice(fetchStart, fetchStart + 1800) : '';
  assert.ok(fetchStart >= 0);
  assert.doesNotMatch(fetchBlock, /studentId:/);
});

test('Teacher selection and edit context preserve student division', () => {
  assert.match(auto, /studentDivision: studentDivision\(student\)/);
  assert.match(auto, /studentDivision: item \? clean\(item\.studentDivision \|\| studentDivision\(item\.student\)\) : ''/);
  assert.match(auto, /studentDivision: clean\(item\.studentDivision \|\| studentDivision\(item\.student\)\)/);
  assert.match(auto, /studentDivision: clean\(record\.studentDivision \|\| \(record\.options && record\.options\.studentDivision\)\) \|\| 'elementary'/);
});

test('phone loads updated shared and local student-context assets', () => {
  assert.match(html, /olli-feedback-runtime\.js\?v=20260919-student-context-1/);
  assert.match(html, /olli-feedback-registration-runtime\.js\?v=20260919-student-context-1/);
  assert.match(html, /kinder-feedback\.js\?v=20260919-student-context-1/);
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20260919-student-context-1/);
});

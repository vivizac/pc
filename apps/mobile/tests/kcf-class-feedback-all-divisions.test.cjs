const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const kcf = fs.readFileSync('kinder-feedback.js', 'utf8');
const teacher = fs.readFileSync('kcf-auto-mode-runtime.js', 'utf8');
const observation = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const api = fs.readFileSync('api/chat.js', 'utf8');

test('one-minute feedback page enters with the record-room division', () => {
  assert.match(kcf, /function openKinderChatFeedbackPage\(options = \{\}\)/);
  assert.match(kcf, /applyKinderChatFeedbackEntryDivision\(options\);/);
  assert.match(kcf, /kcfReturnRecordView === 'kinder' \|\| kcfReturnRecordView === 'elementary'/);
  assert.match(observation, /openKinderChatFeedbackPage\(\{ division \}\);/);
});

test('manual selection cannot silently keep a student from another division', () => {
  assert.match(kcf, /selected && selected\.studentDivision !== nextDivision\) clearKinderChatFeedbackManualSelection\(\);/);
  assert.match(kcf, /selected && selected\.studentDivision !== next\) clearKinderChatFeedbackManualSelection\(\);/);
});

test('Teacher roster includes the current teacher\'s today students across both divisions', () => {
  assert.match(teacher, /function getAllActiveFeedbackStudents\(\)/);
  assert.doesNotMatch(teacher, /function getAllActiveKinderStudents\(\)/);
  assert.doesNotMatch(teacher, /if \(scope && studentDivision\(student\) !== scope\) return false;/);
  assert.match(teacher, /var normalizedDivision = serverDivision === 'kinder' \? 'kinder' : 'elementary';/);
  assert.match(teacher, /effectiveRow\.division = studentDivision\(student\);/);
  assert.match(teacher, /function teacherRosterScopeKey\(\) \{\s*return 'all';\s*\}/);
  assert.match(teacher, /state\.rosterDivision = teacherRosterScopeKey\(\)/);
});

test('one-minute feedback remains class feedback for both divisions', () => {
  assert.match(kcf, /studentDivision: item\.studentDivision/);
  assert.match(html, /olli-feedback-registration-runtime\.js\?v=20260921-ai-guaranteed-1/);
});

test('changed assets use the stage-3 cache keys', () => {
  assert.match(html, /elementary-analysis-phone-adapter\.js\?v=20260921-feedback-pipeline-1/);
  assert.match(html, /kinder-feedback\.js\?v=20260921-feedback-pipeline-1/);
  assert.match(html, /kcf-auto-mode-runtime\.js\?v=20260921-feedback-pipeline-1/);
  assert.match(html, /olli-observation-runtime\.js\?v=20260921-feedback-pipeline-1/);
});


test('one-minute feedback AI is independent from Team Talk bot or AI setting', () => {
  assert.match(api, /if \(promptType === 'talk'\) \{\s*await assertTeamTalkAiEnabled\(body\);\s*\}/);
  assert.doesNotMatch(api, /if \(promptType === 'class'\)[\s\S]{0,120}assertTeamTalkAiEnabled/);
  assert.match(html, /olli-feedback-runtime\.js\?v=20260921-ai-guaranteed-1/);
  assert.match(html, /olli-feedback-registration-runtime\.js\?v=20260921-ai-guaranteed-1/);
});


test('one-minute completion is recorded only after AI result and Teacher student returns on failure', () => {
  const sentFn = kcf.match(/function hasKcfStudentFeedbackSent\(student\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sentFn, /status === 'done' \|\| status === 'review' \|\| item\?\.saved === true/);
  assert.doesNotMatch(sentFn, /status[^\n]*!== 'error'/);

  const resultFn = teacher.match(/function onFeedbackRequestResult\(result\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(resultFn, /markKcfStudentFeedbackSent\(studentId\)/);
  assert.match(resultFn, /state\.completedIds\.delete\(studentId\)/);
  assert.match(teacher, /onFeedbackRequestResult: onFeedbackRequestResult/);

  const liveFn = kcf.match(/function startKinderChatFeedbackLiveRequest\(options = \{\}\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(liveFn, /onFeedbackRequestResult/);
  assert.match(liveFn, /status:'error'/);
});

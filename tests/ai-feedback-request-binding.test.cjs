const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const runtime = fs.readFileSync('olli-feedback-runtime.js', 'utf8');
const generation = fs.readFileSync('olli-record-feedback-generation.js', 'utf8');
const consultation = fs.readFileSync('olli-data-consultation-summary.js', 'utf8');

test('AI feedback alias restoration is owned by shared runtime', () => {
  assert.match(runtime, /function getFeedbackDisplayStudentName\(name\)/);
  assert.match(runtime, /function restoreFeedbackStudentAliases\(text, studentName\)/);
  assert.match(runtime, /output = output\.replace\(\/학생\\s\*A\/g, displayName\)/);
  assert.match(runtime, /output = output\.replace\(\/학생\\s\*\[B-Z\]\/g, '다른 친구'\)/);
});

test('growth feedback captures student identity before async request and saves with captured id', () => {
  assert.match(generation, /const requestStudentId = String\(options\.studentId \|\| currentMemoStudent\?\.id \|\| ''\)\.trim\(\);/);
  assert.match(generation, /const requestStudentName = normalizeTodayFeedbackStudentName\(studentName\);/);
  assert.match(generation, /studentId: requestStudentId,/);

  const requestStart = generation.indexOf('async function requestSceneCardFeedbackFromElementary');
  const fetchStart = generation.indexOf("const res = await fetch('/api/chat'", requestStart);
  const replyStart = generation.indexOf('const rawReply', fetchStart);
  const saveStart = generation.indexOf('await saveElementaryFeedbackDirectly', replyStart);
  const saveBlock = generation.slice(saveStart, generation.indexOf('});', saveStart) + 3);
  assert.doesNotMatch(saveBlock, /currentMemoStudent\?\.id/);
});

test('consultation AI distinguishes class growth and fail records', () => {
  assert.match(consultation, /function getConsultationFeedbackRecordPurpose\(row = \{\}\)/);
  assert.match(consultation, /rawType === 'growth'/);
  assert.match(consultation, /return '성장 피드백'/);
  assert.match(consultation, /return '실패·성장 피드백'/);
  assert.match(consultation, /return '수업 피드백'/);
});

test('consultation request keeps request-bound identity and restores subject alias after AI response', () => {
  assert.match(consultation, /body: JSON\.stringify\(\{ promptType, studentId, studentName, studentDivision, messages \}\)/);
  assert.match(consultation, /studentId: student\?\.id \|\| ''/);
  assert.match(consultation, /studentName: student\?\.name \|\| ''/);
  assert.match(consultation, /restoreFeedbackStudentAliases\(cleanText, student\?\.name \|\| ''\)/);
});

test('class and growth requests send request-bound student identity to Olli AI server', () => {
  assert.match(runtime, /jobId: item\.id,/);
  assert.match(runtime, /studentId: item\.studentId,/);
  assert.match(generation, /studentId: requestStudentId,/);
  assert.match(generation, /studentName: requestStudentName,/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const attendance = fs.readFileSync('olli-data-attendance-feedback.js', 'utf8');
const archive = fs.readFileSync('olli-record-student-picker-phone-adapter.js', 'utf8');
const runtime = fs.readFileSync('olli-observation-runtime.js', 'utf8');
const kcf = fs.readFileSync('kinder-feedback.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('phone record cards show purpose-based feedback titles', () => {
  assert.match(attendance, /function getAttendanceFeedbackPurpose/);
  assert.match(attendance, /수업 피드백/);
  assert.match(attendance, /성장 피드백/);
  assert.match(attendance, /실패-성장 피드백/);
  assert.match(attendance, /attendanceFeedbackSheetSectionTitle">피드백 기록/);
  assert.match(archive, /function getMemoFeedbackArchivePurpose/);
  assert.match(archive, /'수업 피드백'/);
  assert.match(archive, /'성장 피드백'/);
  assert.match(archive, /'실패-성장 피드백'/);
});

test('one-minute feedback keeps division when moving to observation note', () => {
  assert.match(runtime, /function openObservationNoteFromRecord\(options = \{\}\)/);
  assert.match(runtime, /getStudentsByType\(division\)/);
  assert.match(kcf, /openFn\(\{ division \}\)/);
  assert.match(kcf, /getKinderChatFeedbackEntryDivision\(\)/);
});

test('visible mode wording separates growth from fail-growth', () => {
  assert.match(html, />실패-성장 피드백</);
  assert.match(html, />관찰 노트</);
  assert.match(html, />현재 부서의 관찰노트로 이동</);
  assert.doesNotMatch(html, />성장 피드백\(유치부\)</);
  assert.doesNotMatch(html, />관찰 노트\(초등부\)</);
  assert.match(html, /실패-성장 피드백 생성/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const common = fs.readFileSync('observation-memo-common.js', 'utf8');
const attendance = fs.readFileSync('olli-data-attendance-feedback.js', 'utf8');
const kinder = fs.readFileSync('pc-kinder-feedback.js', 'utf8');

test('observation mode menu uses purpose labels for both divisions', () => {
  assert.match(common, /'1분 피드백'/);
  assert.match(common, /'실패-성장 피드백'/);
  assert.match(common, /'관찰 노트'/);
  assert.doesNotMatch(common, /1분 피드백\(유치부\)/);
  assert.doesNotMatch(common, /성장 피드백\(유치부\)/);
  assert.doesNotMatch(common, /관찰 노트\(초등부\)/);
  assert.doesNotMatch(common, /if \(currentMemoType === 'kinder'\) return;/);
  assert.match(common, /openKinderChatFeedbackGrowthSheet/);
  assert.match(common, /openElementaryGrowthFeedbackSheet/);
});

test('archive title follows feedback purpose while keeping legacy fallback', () => {
  assert.match(attendance, /function getAttendanceFeedbackPurpose/);
  assert.match(attendance, /rawType === 'class'/);
  assert.match(attendance, /rawType === 'growth'/);
  assert.match(attendance, /rawType === 'fail'/);
  assert.match(attendance, /수업 피드백/);
  assert.match(attendance, /성장 피드백/);
  assert.match(attendance, /실패-성장 피드백/);
  assert.match(attendance, /과거 데이터는 기존 제목 규칙을 유지/);
  assert.match(attendance, /attendanceFeedbackSheetSectionTitle">피드백 기록/);
});

test('legacy fail-growth queue labels remain readable after wording cleanup', () => {
  assert.match(kinder, /유치부 성장 피드백/);
  assert.match(kinder, /유치부 실패-성장 피드백/);
});

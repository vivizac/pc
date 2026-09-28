const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const storage = fs.readFileSync('olli-storage-core.js', 'utf8');
const foundation = fs.readFileSync('olli-data-foundation.js', 'utf8');
const observation = fs.readFileSync('olli-observation-runtime.js', 'utf8');

function getFeatureBlock(feature) {
  const marker = `feature: '${feature}'`;
  const index = storage.indexOf(marker);
  assert.ok(index >= 0, `missing feature: ${feature}`);
  const start = storage.lastIndexOf('FeatureRegistry.register({', index);
  const next = storage.indexOf('FeatureRegistry.register({', index + marker.length);
  return storage.slice(start, next >= 0 ? next : storage.length);
}

test('phone storage registry does not advertise missing feedbacks columns', () => {
  const block = getFeatureBlock('general_feedback');
  assert.match(block, /table: 'feedbacks'/);
  assert.doesNotMatch(block, /feedback_month/);
  assert.doesNotMatch(block, /feedback_month_number/);
});

test('phone edit contracts use updated_at for all feedback tables', () => {
  for (const feature of ['general_feedback_edit', 'growth_feedback_edit', 'summary_feedback_edit']) {
    const block = getFeatureBlock(feature);
    assert.match(block, /valueColumns: \['content', 'updated_at'\]/);
    assert.match(block, /selectColumns:[\s\S]*'updated_at'/);
  }
});

test('fail_feedbacks internal feature labels match fail-growth purpose', () => {
  assert.match(getFeatureBlock('growth_feedback'), /label: '실패-성장 피드백'/);
  assert.match(foundation, /table === 'fail_feedbacks'[\s\S]{0,180}label: '실패-성장 피드백'/);
});

test('phone observation growth request keeps the original student id across async AI work', () => {
  const start = observation.indexOf('async function requestSceneCardFeedbackFromElementary');
  const end = observation.indexOf('\nfunction getStudentModeEntries', start);
  const block = observation.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /const requestStudentId = String\(options\.studentId \|\| currentMemoStudent\?\.id \|\| ''\)\.trim\(\);/);
  assert.match(block, /const requestStudentName = normalizeTodayFeedbackStudentName\(studentName\);/);
  assert.match(block, /studentId: requestStudentId,/);
  assert.match(block, /studentName: requestStudentName,/);
  const fetchIndex = block.indexOf("const res = await fetch('/api/chat'");
  const saveIndex = block.indexOf('saveElementaryFeedbackDirectlyToArchive', fetchIndex);
  const saveBlock = block.slice(saveIndex, block.indexOf('});', saveIndex) + 3);
  assert.match(saveBlock, /studentId: requestStudentId,/);
  assert.doesNotMatch(saveBlock, /currentMemoStudent\?\.id/);
});

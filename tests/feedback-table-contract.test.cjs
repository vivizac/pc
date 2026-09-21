const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const policy = fs.readFileSync('olli-operations-feedback-policy.js', 'utf8');
const dataFeedback = fs.readFileSync('olli-data-feedback.js', 'utf8');
const storage = fs.readFileSync('olli-storage-core.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260921131000_align_feedback_updated_at.sql', 'utf8');

function getFeatureBlock(feature) {
  const marker = `feature: '${feature}'`;
  const index = storage.indexOf(marker);
  assert.ok(index >= 0, `missing feature: ${feature}`);
  const start = storage.lastIndexOf('FeatureRegistry.register({', index);
  const next = storage.indexOf('FeatureRegistry.register({', index + marker.length);
  return storage.slice(start, next >= 0 ? next : storage.length);
}

test('feedback purpose routes class/growth to feedbacks and fail to fail_feedbacks', () => {
  assert.match(policy, /function getFeedbackTableNameByType\(feedbackType\)/);
  assert.match(policy, /type === 'summary'\) return 'summary_feedbacks'/);
  assert.match(policy, /\['fail', 'fail_growth', 'failgrowth', 'elementary_fail', 'kinder_fail'\]/);
  assert.doesNotMatch(policy, /\['fail', 'growth'/);

  assert.match(dataFeedback, /type === 'summary'\) return 'summary_feedbacks'/);
  assert.doesNotMatch(dataFeedback, /\['fail', 'growth'/);
});

test('general feedback registry contains only real feedbacks columns', () => {
  const block = getFeatureBlock('general_feedback');
  assert.match(block, /table: 'feedbacks'/);
  assert.doesNotMatch(block, /feedback_month/);
  assert.doesNotMatch(block, /feedback_month_number/);
});

test('all editable feedback tables share updated_at contract', () => {
  for (const feature of ['general_feedback_edit', 'growth_feedback_edit', 'summary_feedback_edit']) {
    const block = getFeatureBlock(feature);
    assert.match(block, /valueColumns: \['content', 'updated_at'\]/);
    assert.match(block, /selectColumns:[\s\S]*'updated_at'/);
  }

  assert.match(migration, /alter table public\.fail_feedbacks[\s\S]*add column if not exists updated_at timestamptz/);
  assert.match(migration, /alter table public\.summary_feedbacks[\s\S]*add column if not exists updated_at timestamptz/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test('legacy growth storage feature is labeled as fail-growth to avoid purpose confusion', () => {
  assert.match(getFeatureBlock('growth_feedback'), /label: '실패-성장 피드백'/);
  assert.match(getFeatureBlock('growth_feedbacks_by_student_delete'), /label: '실패-성장 피드백 학생별 삭제'/);
});


test('feedback table routing has one shared source of truth', () => {
  assert.match(policy, /function getFeedbackTableNameByType\(feedbackType\)/);
  assert.doesNotMatch(dataFeedback, /function getFeedbackTableNameByType\(feedbackType\)/);
  assert.match(dataFeedback, /getFeedbackTableNameByType\(rawType\)/);
});

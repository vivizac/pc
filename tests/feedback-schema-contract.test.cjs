const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const storage = fs.readFileSync('olli-storage-core.js', 'utf8');

test('feedback storage registry does not reference removed general-feedback month columns', () => {
  const start = storage.indexOf("feature: 'general_feedback'");
  const end = storage.indexOf("feature: 'growth_feedback'", start);
  const block = storage.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /feedback_month/);
  assert.doesNotMatch(block, /feedback_month_number/);
  assert.match(block, /lesson_date/);
  assert.match(block, /member_id/);
  assert.match(block, /updated_at/);
});

test('growth feedback create/edit registry matches current fail_feedbacks timestamps', () => {
  const createStart = storage.indexOf("feature: 'growth_feedback'");
  const createEnd = storage.indexOf("feature: 'summary_feedback'", createStart);
  const createBlock = storage.slice(createStart, createEnd);
  assert.match(createBlock, /created_at/);
  assert.match(createBlock, /updated_at/);
  assert.match(createBlock, /client_mutation_id/);

  const editStart = storage.indexOf("feature: 'growth_feedback_edit'");
  const editEnd = storage.indexOf("feature: 'summary_feedback_edit'", editStart);
  const editBlock = storage.slice(editStart, editEnd);
  assert.match(editBlock, /valueColumns: \['content', 'updated_at'\]/);
});

test('summary feedback registry preserves current Supabase summary fields', () => {
  const start = storage.indexOf("feature: 'summary_feedback'");
  const end = storage.indexOf("feature: 'general_feedback_edit'", start);
  const block = storage.slice(start, end);
  for (const field of [
    'feedback_type',
    'period_months',
    'source_feedback_ids',
    'created_by',
    'summary_months',
    'updated_at',
    'client_mutation_id'
  ]) {
    assert.match(block, new RegExp(field));
  }
});

test('all three feedback edit features use content plus updated_at', () => {
  for (const feature of ['general_feedback_edit', 'growth_feedback_edit', 'summary_feedback_edit']) {
    const start = storage.indexOf(`feature: '${feature}'`);
    const end = storage.indexOf('FeatureRegistry.register({', start + 10);
    const block = storage.slice(start, end > start ? end : storage.length);
    assert.ok(start >= 0, feature);
    assert.match(block, /valueColumns: \['content', 'updated_at'\]/, feature);
    assert.match(block, /selectColumns:[^\n]*updated_at/, feature);
  }
});

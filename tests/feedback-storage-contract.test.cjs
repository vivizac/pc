const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const storage = fs.readFileSync('olli-storage-core.js', 'utf8');
const consultation = fs.readFileSync('olli-data-consultation-summary.js', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260921041111_align_feedback_tables_updated_at.sql',
  'utf8'
);

function featureBlock(feature) {
  const marker = `feature: '${feature}'`;
  const index = storage.indexOf(marker);
  assert.ok(index >= 0, `missing feature: ${feature}`);
  const start = storage.lastIndexOf('FeatureRegistry.register({', index);
  let end = storage.indexOf('FeatureRegistry.register({', index + marker.length);
  if (end < 0) end = storage.length;
  return storage.slice(start, end);
}

test('feedback storage registry only references real general feedback write columns', () => {
  const general = featureBlock('general_feedback');
  assert.match(
    general,
    /valueColumns: \['student_name', 'content', 'feedback_type', 'future_direction', 'year', 'date'\]/
  );
  assert.doesNotMatch(general, /feedback_month/);
  assert.doesNotMatch(general, /feedback_month_number/);
});

test('all three feedback edit features use the shared updated_at contract', () => {
  for (const feature of ['general_feedback_edit', 'growth_feedback_edit', 'summary_feedback_edit']) {
    const block = featureBlock(feature);
    assert.match(block, /valueColumns: \['content', 'updated_at'\]/);
    assert.match(block, /selectColumns:[^\n]*'updated_at'/);
  }
});

test('consultation feedback loads are ordered by created_at, not heterogeneous ids', () => {
  assert.doesNotMatch(consultation, /order=id\.desc/);
  const matches = consultation.match(/order=created_at\.desc/g) || [];
  assert.ok(matches.length >= 4);
});

test('repository migration preserves the live updated_at schema for growth and summary feedback', () => {
  assert.match(migration, /alter table public\.fail_feedbacks[\s\S]*add column if not exists updated_at timestamptz/);
  assert.match(migration, /alter table public\.summary_feedbacks[\s\S]*add column if not exists updated_at timestamptz/);
  assert.match(migration, /alter column updated_at set default now\(\)/);
  assert.match(migration, /alter column updated_at set not null/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20261024171001_backfill_legacy_summary_period_months.sql'), 'utf8'
);

test('legacy summary backfill uses the original stored analysis months only', () => {
  assert.match(migration, /UPDATE public\.summary_feedbacks/i);
  assert.match(migration, /SET period_months\s*=\s*summary_months/i);
  assert.match(migration, /WHERE period_months IS NULL/i);
  assert.match(migration, /summary_months IN \(1, 3, 6, 12\)/i);
  assert.match(migration, /COALESCE\(is_deleted, FALSE\) = FALSE/i);
});

test('historical metadata patch never rewrites feedback bodies or infers consultation identity', () => {
  assert.doesNotMatch(migration, /(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)/i);
  assert.doesNotMatch(migration, /(?:SET|,)\s*(?:content|created_at|date|year|client_mutation_id|source_feedback_ids|feedback_id|due_month|rule_key)\s*=/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.olli_consultation_summary_jobs/i);
});

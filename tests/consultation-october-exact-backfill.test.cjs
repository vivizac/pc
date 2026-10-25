'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations',
 '20261025120000_link_unique_october_2026_archived_consultation_summaries.sql'),'utf8');
test('historical recovery is scoped to one academy, one due month, original-month fbm reports',()=>{
  assert.match(migration,/j\.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'/);
  assert.match(migration,/j\.due_month = '2026-10'/);
  assert.match(migration,/LEFT\(COALESCE\(sf\.client_mutation_id, ''\), 4\) = 'fbm_'/);
  assert.match(migration,/DATE_TRUNC\('month', sf\.created_at AT TIME ZONE 'Asia\/Seoul'\)/);
  assert.match(migration,/REGEXP_REPLACE\(COALESCE\(sf\.date,''\)/);
  assert.match(migration,/sf\.summary_months = CASE j\.rule_key/);
  assert.match(migration,/sf\.period_months = sf\.summary_months/);
  assert.match(migration,/sf\.year = LEFT\(j\.due_month, 4\)::integer/);
});
test('recovery cannot assign multiple reports or reuse one report in two consultation tasks',()=>{
  assert.match(migration,/COUNT\(\*\) OVER \(PARTITION BY academy_id, student_id, rule_key, due_month\)/);
  assert.match(migration,/COUNT\(\*\) OVER \(PARTITION BY source_feedback_id\)/);
  assert.match(migration,/r\.task_candidate_count = 1 AND r\.feedback_task_count = 1/);
  assert.match(migration,/NOT EXISTS \(SELECT 1 FROM public\.olli_consultation_summary_jobs x/);
  assert.match(migration,/j\.feedback_id IS NULL/);
  assert.match(migration,/s\.status = 'active'/);
});
test('does not mutate or delete original feedbacks and audits every reassignment',()=>{
  assert.doesNotMatch(migration,/UPDATE public\.summary_feedbacks/i);
  assert.doesNotMatch(migration,/(?:DELETE FROM|TRUNCATE|DROP TABLE)/i);
  assert.match(migration,/private\.olli_consultation_summary_exact_backfill_audit/);
  assert.match(migration,/FROM linked l JOIN verified v/);
  assert.match(migration,/status = 'ready'/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/REVOKE ALL ON .* FROM PUBLIC, anon, authenticated/);
});

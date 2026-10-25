-- One-time, non-destructive recovery of seven October 2026 consultation summaries.
-- The original reports already exist. This migration connects only *unique*
-- reports whose independently stored student, academy, 1/3/6/12 month duration,
-- report date AND KST creation month agree with the original consultation due month.
-- No guessing from a later upload, no AI regeneration, no cross-period reuse.
-- Other months and ambiguous/missing reports are intentionally untouched.
CREATE TABLE IF NOT EXISTS private.olli_consultation_summary_exact_backfill_audit (
  academy_id uuid NOT NULL,
  student_id uuid NOT NULL,
  rule_key text NOT NULL,
  due_month text NOT NULL,
  feedback_id bigint NOT NULL,
  old_status text NOT NULL,
  original_report_date text NOT NULL,
  original_created_at timestamptz NOT NULL,
  original_mutation_id text NOT NULL,
  proof text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (academy_id, student_id, rule_key, due_month)
);
ALTER TABLE private.olli_consultation_summary_exact_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.olli_consultation_summary_exact_backfill_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.olli_consultation_summary_exact_backfill_audit TO service_role;

WITH candidates AS MATERIALIZED (
  SELECT j.academy_id, j.student_id, j.rule_key, j.due_month,
    j.status AS previous_status,
    sf.id AS source_feedback_id,
    sf.date AS source_report_date,
    sf.created_at AS source_created_at,
    sf.client_mutation_id AS source_mutation_id,
    (j.due_month || '-01')::date AS due_date,
    CASE j.rule_key
      WHEN 'after_1' THEN 1 WHEN 'after_3' THEN 3
      WHEN 'every_6' THEN 6 WHEN 'every_12' THEN 12
    END AS period,
    12 * (EXTRACT(YEAR FROM (j.due_month || '-01')::date)::integer
        - EXTRACT(YEAR FROM s.enrolled_at)::integer)
      + (EXTRACT(MONTH FROM (j.due_month || '-01')::date)::integer
        - EXTRACT(MONTH FROM s.enrolled_at)::integer) AS tenure_months
  FROM public.olli_consultation_summary_jobs j
  JOIN public.students s
    ON s.academy_id = j.academy_id AND s.id = j.student_id
  JOIN public.summary_feedbacks sf
    ON sf.academy_id = j.academy_id AND sf.student_id = j.student_id
  WHERE j.academy_id = '6871d975-6c50-426d-97b1-81ac4e35ba27'::uuid
    AND j.due_month = '2026-10'
    AND j.rule_key IN ('after_1', 'after_3', 'every_6', 'every_12')
    AND j.status IN ('pending', 'legacy_review_required')
    AND j.feedback_id IS NULL
    AND (j.leased_until IS NULL OR j.leased_until < now())
    AND s.status = 'active' AND COALESCE(s.is_deleted, false) = false
    AND sf.is_deleted IS NOT TRUE
    AND BTRIM(COALESCE(sf.content, '')) <> ''
    AND LEFT(COALESCE(sf.client_mutation_id, ''), 4) = 'fbm_'
    AND sf.summary_months = CASE j.rule_key
      WHEN 'after_1' THEN 1 WHEN 'after_3' THEN 3
      WHEN 'every_6' THEN 6 WHEN 'every_12' THEN 12 END
    AND sf.period_months = sf.summary_months
    AND sf.year = LEFT(j.due_month, 4)::integer
    AND DATE_TRUNC('month', sf.created_at AT TIME ZONE 'Asia/Seoul')::date
        = (j.due_month || '-01')::date
    AND REGEXP_REPLACE(COALESCE(sf.date,''),'[[:space:]]','','g') LIKE
      (LEFT(j.due_month,4) || '.' || RIGHT(j.due_month,2)::integer::text || '.%')
    AND NOT EXISTS (SELECT 1 FROM public.olli_consultation_summary_jobs x
      WHERE x.feedback_id = sf.id)
),
ranked AS (
  SELECT c.*,
    COUNT(*) OVER (PARTITION BY academy_id, student_id, rule_key, due_month) AS task_candidate_count,
    COUNT(*) OVER (PARTITION BY source_feedback_id) AS feedback_task_count
  FROM candidates c
),
verified AS (
  SELECT r.* FROM ranked r
  WHERE r.task_candidate_count = 1 AND r.feedback_task_count = 1
    AND r.tenure_months >= r.period
    AND (CASE r.rule_key
      WHEN 'after_1' THEN r.tenure_months = 1
      WHEN 'after_3' THEN r.tenure_months = 3
      WHEN 'every_6' THEN MOD(r.tenure_months,6) = 0
      WHEN 'every_12' THEN MOD(r.tenure_months,12) = 0
      ELSE false END)
),
linked AS (
  UPDATE public.olli_consultation_summary_jobs j SET
    feedback_id = v.source_feedback_id,
    status = 'ready',
    claim_token = NULL,
    leased_until = NULL,
    last_error = NULL,
    updated_at = now()
  FROM verified v
  WHERE j.academy_id = v.academy_id AND j.student_id = v.student_id
    AND j.rule_key = v.rule_key AND j.due_month = v.due_month
    AND j.feedback_id IS NULL
    AND j.status IN ('pending','legacy_review_required')
    AND (j.leased_until IS NULL OR j.leased_until < now())
  RETURNING j.academy_id,j.student_id,j.rule_key,j.due_month,j.feedback_id
)
INSERT INTO private.olli_consultation_summary_exact_backfill_audit
  (academy_id,student_id,rule_key,due_month,feedback_id,old_status,
   original_report_date,original_created_at,original_mutation_id,proof)
SELECT l.academy_id,l.student_id,l.rule_key,l.due_month,l.feedback_id,
  v.previous_status,v.source_report_date,v.source_created_at,v.source_mutation_id,
  'unique original-month fbm summary; exact academy/student/period/year/report date/KST creation and enrollment cadence'
FROM linked l JOIN verified v
  ON l.academy_id=v.academy_id AND l.student_id=v.student_id
  AND l.rule_key=v.rule_key AND l.due_month=v.due_month
  AND l.feedback_id=v.source_feedback_id
ON CONFLICT (academy_id,student_id,rule_key,due_month) DO NOTHING;

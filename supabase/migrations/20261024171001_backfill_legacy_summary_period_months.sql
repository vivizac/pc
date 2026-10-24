-- Historical summary metadata restoration, applied on 2026-10-24 UTC.
-- New server-authored summaries store period_months = summary_months.
-- Old summaries already contain the original summary_months.
-- This is only a duration backfill, NOT a consultation task assignment.
-- Do NOT guess consultation due_month/rule_key, client_mutation_id,
-- source_feedback_ids, or olli_consultation_summary_jobs.feedback_id.
-- Preserve every existing id, content, author, date, year and timestamp.
UPDATE public.summary_feedbacks
SET period_months = summary_months
WHERE period_months IS NULL
  AND summary_months IN (1, 3, 6, 12)
  AND academy_id IS NOT NULL
  AND student_id IS NOT NULL
  AND COALESCE(is_deleted, FALSE) = FALSE;

# Historical consultation summary backfill audit — 2026-10-25 KST

## Source and effect
Production project: vivizac - feedback. Existing rows: 46 (all active, content present).
Before: 45 had `period_months IS NULL`; all 45 already retained their original valid `summary_months` (1/3/6/12).
Applied migration `20261024171001_backfill_legacy_summary_period_months` sets only `period_months = summary_months`.
After: 46/46 have equal non-null summary/period months; no remaining missing duration values.
The migration deliberately does not mutate archived body, primary IDs, timestamps, creator, original month, source records or consultation task links.

## Exact consultation identity is a separate task
The authoritative readiness source is `olli_consultation_summary_jobs(academy_id, student_id, rule_key, due_month, feedback_id)`; do not mark ready just because an old summary matches the month/year.
Post-backfill: 23 consultation jobs; 11 legacy_review_required, 11 pending, 1 ready and exactly linked.
45 historic summaries still lack a verified exact consultation task link. A historic summary can be archival/manual, not necessarily a scheduled consultation report.
Of the unlinked consultation jobs, candidate filtering by student, duration, year and broad creation window yielded 4 review-required jobs with one candidate and 7 with two candidates, plus 3 pending annual jobs with one candidate. **None is proven by this heuristic**. Some archived summaries were written one month after the due month and may represent late entry or a different report.

## Non-destructive follow-up
Use the existing owner-authorized `olli_consultation_legacy_summary_link` RPC through the secure server action `link_legacy` after reviewing the exact saved report, actual consultation occurrence and student. This RPC prevents multiple-job assignment and creates a private audit entry. UI to present owner-verified candidates is a separate task; it is not present in this migration.
Do not rewrite `client_mutation_id` for historic rows, fabricate `source_feedback_ids`, remove older reports, or backfill a due month from created_at.
Do not merge this migration into any destructive cleanup.

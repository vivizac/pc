# October 2026 stored consultation summaries: correction for false "자료부족"

Investigated 2026-10-25: Kim Jihoon has archived summary ID 53 dated 2026-10-23; correct academy/student, a 12-month period, 2026 report year. His consultation job `every_12 | 2026-10` was pending with `feedback_id = NULL`. Because server inspection intentionally trusts only the exact job link, the UI displayed "자료부족" despite the real saved document. Other students had the same problem.

Original reporting is preserved; this is NOT a missing-growth-material problem, and should never regenerate an existing report.

Read-only preflight identified exactly **7** October consultation jobs, each with exactly one currently unlinked `fbm_` legacy summary whose student, academy, period, report year, report date, and KST writing month all match the consultation's original 2026-10 due month. Each also passes enrollment cadence. The migration links these seven rows only, with an isolated private system-reconciliation audit table (no simulated owner approval). It does not modify the feedback texts, original primary keys, manual periods, CAS or client sync.

Reports for September or earlier and any task with two or more candidates remain unlinked for explicit owner review, per original historical identity safety policy. Jobs without a matching saved report stay insufficient. The month-specific migration is idempotent and not a general auto-adoption rule.

Verification: compare October ready jobs with saved non-deleted, same-duration summary rows, ensure ID 53 is linked and total summary row count unchanged, and check PC/mobile readiness and archive content.

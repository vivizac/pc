# Olli self-booking — stage 1 (feature branch only)

## Status / boundary
This is a **non-deployed, non-applied** implementation candidate. Neither the production
database nor the PC/mobile/parent UIs are changed. This stage adds PostgreSQL schema,
owner-only configuration/availability RPCs, a server-only atomic reserve primitive,
and shared read-only slot policy. Do not turn on an external booking URL yet.

## Confirmed academy defaults (2026-10-25)
- Weeks: second and third **Monday–Sunday calendar rows** of each month;
  the row containing day 1 is week 1, even if partial. Confirm this interpretation
  before production rollout.
- Weekdays: Monday–Friday (ISO 1–5).
- 11:00–17:00 Asia/Seoul; 30-minute slots. Last start **16:30**.
- Parent reschedule and cancel: both enabled, subject to later cutoff policy.
- Every academy gets identical initial values, can later override them.
- Public parent survey only for new inquiries; enrolled families book without a survey.

## Files
- \`supabase/migrations/20261025150000_olli_booking_core_stage1.sql\`:
  six private tenant-scoped tables; GiST exclusion preventing overlapping confirmed
  bookings; owner settings + slot RPCs; service-role-only reserve RPC.
- \`packages/common/olli-booking-policy.cjs\`: shared default/weekday/week/slot logic.
- \`tests/consultation-booking-stage1.test.cjs\`: deterministic policy + SQL contract checks.

## Security contract
- Never give service-role keys, staff Olli sessions, or the raw booking token to a parent.
- The six new public tables have RLS enabled and direct anon/authenticated access revoked.
- Owner settings & availability RPCs verify the existing member session; reserve RPC
  is EXECUTE-granted to service_role only. An external Vercel API must verify the
  guardian's scoped/hashed link before invoking server reserve.
- SQL exclusion is the collision source of truth. UI slot visibility is advisory.
- A request_key retry returns the original booking id; a different payload with
  the same key is rejected. Separate parent rate limits, link issuance, and
  reschedule/cancel transactions belong to stage 2.
- Booking due_month/rule_key fields are references only; no consultation summary
  jobs or growth/summary feedback are modified.

## Verification gates (not yet satisfied)
1. Run Node policy/contract tests; run migration on **isolated throwaway database**.
2. Run actual Postgres transactions: cross-academy FK mismatch; concurrent overlap;
   same request_key retry; unauthorized RPC; out-of-hours/week/day; block dates.
3. Confirm Supabase security advisors, live schema drift and safe migration order.
4. Implement backend parent token validation, booking change/cancel and API error mapping.
5. Render PC/mobile/guardian flows and regression-check consultation summaries.
6. Merge and deploy only when the full system passes all gates.

Known open decisions: reschedule/cancel deadline, whether a calendar week containing
the first of the month is counted as the first week, holiday blocking, sibling policy,
guardian authentication link validity, retention. None silently restrict families yet.

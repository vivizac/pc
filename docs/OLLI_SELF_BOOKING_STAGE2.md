# Olli consultation booking — stage 2 implementation handoff

Status: **GitHub feature branch only; NOT deployed; NO production database changes.**

Commit verified in isolated CI: \`018652fbe169b7a03dd2d0c4331b28dd3b35e46a\`
CI: https://github.com/vivizac/pc/actions/runs/40185916948 (all jobs passed).

## Added in stage 2
- \`supabase/migrations/20261025183000_olli_booking_parent_stage2.sql\`
  - Enforces one live reservation per (academy, student) or (academy, new-intake).
  - Private mutation ledger for exact idempotent retries.
  - Staff-only issuance/revocation of hashed, expiring, student-scoped links.
  - Guardian \`snapshot\`, \`slots\`, \`reserve\`, \`reschedule\`, \`cancel\` in server-side SQL transactions.
  - Exclusive, atomic update of the same reservation on reschedule; GiST constraints
    from stage 1 still reject overlapping times. Cancellation releases the slot.
  - Audit events for create/change/cancel. \`due_month\` and summary feedback unaffected.
- \`packages/common/api/_lib/olli-booking-handler.cjs\`
  - Vercel POST-only JSON handler; generates 32-byte random bearer token for owner.
  - Sends only SHA256 token hash to the DB. Returns one-time fragment \`#token=...\`
    so parent page can keep the bearer out of HTTP referrers and server logs.
  - Uses private service key only on server. Parent requests never select academy/student.
  - Same-origin guard for browser requests, strict payload validation, sanitized errors,
    \`Cache-Control: no-store\`.
- PC and mobile wrapper routes: \`apps/{pc,mobile}/api/olli-booking.js\`.
  Their build manifests stage the **same** shared API handler.
- \`tests/consultation-booking-stage2.test.cjs\`: API/security contracts, one-time
  links, token hashing, malicious inputs, backend error sanitization and route parity.
- \`tests/consultation-booking-stage2.integration.sql\`: actual independent PG17
  migration, multi-tenant link issuance, invalid/expired/revoked link,
  reservation/retry, reschedule conflict rollback, cancellation audit,
  academy settings opt-outs and direct anon permission denials.
- \`tests/consultation-booking-stage2.concurrent.sh\`: two actual, simultaneous
  PostgreSQL requests for the same academy/slot; exactly one may commit.
- Stage 1 CI workflow expanded to run **both** stages on a disposable PostgreSQL 17
  service. The test DB is never the real Supabase database.

## Endpoint contract (internal, not yet advertised to families)
POST \`/api/olli-booking\`, JSON:
- Staff \`{action:"issue",session_token,academy_id,student_id OR intake_id,days_valid:14}\`
  -> \`{link_id,expires_at,fragment:"#token=<opaque>"}\`.
- Staff \`{action:"revoke",session_token,academy_id,link_id}\`.
- Parent \`{action:"snapshot",token}\` or \`{action:"slots",token,date:"YYYY-MM-DD"}\`.
- Parent \`{action:"reserve",token,start_at:"ISO8601-with-offset",request_key:"UUID"}\`.
- Parent \`{action:"reschedule",token,reservation_id,start_at,request_key}\`.
- Parent \`{action:"cancel",token,reservation_id,request_key}\`.

The parent has **no Olli user session** and cannot choose a student/academy ID;
the DB resolves identity only through the owner-issued hash. The raw token is
returned only once to staff for delivery to the intended guardian.

## User-confirmed initial per-academy defaults
Second and third calendar weeks (Monday-first row interpretation to confirm),
Monday–Friday 11:00–17:00 Asia/Seoul, 30-minute slots, last start 16:30.
Both parent reschedule and cancel enabled.

## Required before launch
1. Build parent booking/reschedule/cancel UI and ensure the fragment stays out of
   analytics, history, API logs, URLs sent to third parties and Referer headers.
2. Connect verified owner-only link issuance to Olli PC and mobile UI and send link
   only to the guardian contact explicitly verified by the academy.
3. Integrate new-intake survey only for new students; do not enable that survey
   for enrolled students.
4. Replace Naver-only booking URL restrictions consistently in SOLAPI UI, API
   and existing DB RPC, and obtain valid approved templates where required.
5. Implement rate limiting / abuse monitoring, link-expiry renewal, privacy
   retention and a selected cancellation cutoff. Decide how to treat expired
   links with future reservations. A stolen valid link remains a bearer credential.
6. Verify tenant isolation in the **actual multi-role Supabase environment**,
   schema drift, security advisors, Vercel API routing and preview behavior.
7. Verify both app renderings on actual devices, clock boundaries and existing
   archived consultation and feedback invariants.
8. Do not merge, apply the migration to production, or deploy until gates pass.

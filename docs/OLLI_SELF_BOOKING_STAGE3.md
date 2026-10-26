# Olli booking stage 3 — PC and mobile owner management (feature branch only)

## Implemented
- PC existing sidebar retains "상담기록". Adds an independent "상담 현황" entry and screen.
- The PC booking screen offers monthly calendar, appointment list, reschedule/cancel,
  and per-academy booking settings. No direct calls to student feedback generation.
- Mobile keeps its original attendance/observation/quick-note navigation and the
  original "학원 관리" dashboard. A small **additive** entry opens a separate
  mobile-only booking screen, with Today / This week / All bookings / Settings.
- Both render via the same \`packages/common/olli-booking-owner-ui.js\` and CSS.
  The app runtime manifests stage the same files. The mobile academy dashboard
  continues local-first rendering; this feature does not replace its data cache.
- Owner-scoped RPC \`olli_booking_staff_manage\` lists only the current academy
  and supports collision-checked atomic changes/cancellations, with a staff
  idempotency ledger and event records.
- Settings via \`olli_booking_settings_manage\`, with revision CAS, per-academy defaults,
  and normal owner session membership checks. No client reads private booking tables.

## Behavior requiring further work
- Parent booking web page still must be built. A copyable public link is therefore
  intentionally NOT exposed/advertised by the owner UI yet.
- This code is in the feature branch only; the production Supabase DB has not
  received any of stages 1–3. The new management screen will give a clear error
  if opened without these migrations. Do not enable staff booking UI for parents.
- New enquiries already have a private \`olli_booking_intakes\` data model but the
  existing survey intake workflow is not connected yet.
- The parent reservation API exists in stage 2 but should not be advertised until
  rate limits, guardian link flow and end-to-end UI validation are complete.
- Actual browser/device screenshot QA is still required. GitHub CI covers static
  route, owner gate, backend and Postgres integration only.
- Do not merge to main, deploy any Vercel project or apply production DB migrations
  until end-to-end verification and final approval.

## Confirmed defaults
Second/third calendar row of the month, Mon–Fri, 11:00–17:00,
30-minute appointments, last start 16:30, parent reschedule/cancel allowed.
The "week containing day 1 = week one" interpretation remains to be confirmed
before launch.

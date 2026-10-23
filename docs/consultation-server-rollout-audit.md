# Olli consultation server migration — release safety gate

> Draft PR #483. Do not merge or deploy to production merely because Node tests or preview builds pass.

## Implemented on branch

- [x] PC and Mobile consultation auto-generation use a common server-owned handler staged from `packages/common`.
- [x] Archive/manual summary generation also requests the same server, validates selected saved feedback IDs, and writes at most one summary per student/period/month.
- [x] Manual summary edits update the same stored summary by session-validated server RPC instead of inserting a second row.
- [x] Database job key is unique per academy/student/rule/due month, with atomic claim token and expired lease reclamation.
- [x] 12-month consultation requires final-period growth feedback (target last month or following month), not merely the existence of two historical records.
- [x] Consultation completion and rules use a session-validated RPC and are displayed consistently using shared calendar task policy.
- [x] Mobile consultation content preview and manual summary editor are wired to shared server data.
- [x] Preview builds cannot generate AI responses or save consultation completion against production Supabase without explicit authorization.
- [x] Rejected/invalid session cannot access summary generator; DB execution privilege restricted to service_role only.
- [x] Automated tests: mocked simultaneous requests, failed model, expired claim lease, missing selection, revision, preview mutation ban, and PC/mobile read regressions.

## Production database applied, old rows preserved

- [x] Additive consultation summary jobs table and progress/rules RPC installed.
- [x] Summary job RPC limited to service_role (anon/authenticated cannot execute).
- [x] Manual job rule variants and in-place revision action installed.
- [x] Invalid session is denied; new summary jobs table is empty after installation.
- [x] Existing `summary_feedbacks.id` is a PostgreSQL IDENTITY column and needs no extra default/sequence migration.

## Must pass before production release

- [ ] Login with a **real authorized test academy owner** and verify completion on PC → Mobile, then Mobile → PC; reload each browser and check `academy_settings.consultation_progress`.
- [ ] Verify an uncompleted September student carries forward to October/November; completed record stays visibly completed in that month, disappears next month, and completion cancellation is synchronized.
- [ ] Verify an elementary 12-month due student with prior feedback but no final-month growth remains 'insufficient'. A late final-month feedback entered in the following month unlocks summary generation.
- [ ] Test two real logged-in devices simultaneously requesting the same summary; verify one job and one summary row in Supabase.
- [ ] Test manual archive selection, edit and save in both PC and Mobile; edits update original ID, not a second summary record.
- [ ] Test cross-academy ID and teacher-only session denial, expired account sessions, incomplete/missing API secrets, and network timeouts.
- [ ] Test legacy PC-local consultation completion recovery with explicit user approval; avoid automatic overwrite of any server-side cancellation.
- [ ] Force installed iOS/PWA clients to refresh script caches before the server transition; otherwise old cached code may keep making legacy requests.
- [ ] Review existing `summary_feedbacks` historical duplicates, but do **not** automatically delete or merge them.
- [ ] Review old direct legacy `summary_feedbacks` write path during rolling upgrade so old devices cannot race new server clients.
- [ ] Confirm environment variables on both PC and Mobile server function deployments; verify central model prompt type and privacy gateway.
- [ ] **Server-independent scheduler/Cron** is not implemented: at present app requests trigger server generation.
- [ ] Target feedback month (`YYYY-MM`) is not persisted separately from creation date; March-written vs April-written final-month ambiguity remains.
- [ ] Baseline global CI has independent monorepo, common source, and PC material archive failures; keep separate from consultation regressions.

## Deployment safety

Deploy Mobile + PC together only after the above blockers are resolved. Roll back both Vercel app deployments if any authenticated test fails. Leave additive database schema in place during app rollback; do not drop jobs or modify old feedbacks. Never expose service_role secrets to browser code. Verify job count, summary row count, and consultation completion RPC logs after release.

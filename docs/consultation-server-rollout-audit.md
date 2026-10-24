# Olli consultation server migration — release safety gate

> Draft PR #483. Do not merge or deploy to production merely because Node tests or preview builds pass.

## Implemented on branch

- [x] PC and Mobile consultation auto-generation use a common server-owned handler staged from `packages/common`.
- [x] Archive/manual summary generation also requests the same server, validates selected saved feedback IDs, and writes at most one summary per student/period/month.
- [x] Manual summary edits update the same stored summary by session-validated server RPC instead of inserting a second row.
- [x] Database job key is unique per academy/student/rule/due month, with atomic claim token and expired lease reclamation.
- [x] 12-month consultation requires growth feedback for the *final lesson month*, not just any record written in the following month.
- [x] New growth feedback saves on both apps ask for lesson target month (YYYY-MM), persisted through the secure feedback RPC to `feedbacks.target_month`.
- [x] Legacy feedback target_month is left null rather than guessed from its creation date; late historical growth must be explicitly classified to unlock annual summaries.
- [x] Consultation completion and rules use a session-validated RPC and are displayed consistently using shared calendar task policy.
- [x] Mobile consultation content preview and manual summary editor are wired to shared server data.
- [x] Preview builds cannot generate AI responses or save consultation completion against production Supabase without explicit authorization.
- [x] Rejected/invalid session cannot access summary generator; DB execution privilege restricted to service_role only.
- [x] Guarded mobile-server Vercel Cron (daily 02:00 UTC/11:00 KST) plus sessionless service_role-only candidate enumeration. Jobs are inactive without `CRON_SECRET` and `OLLI_CONSULTATION_CRON_ENABLED=enabled`.
- [x] Server Cron considers unfinished consultation carry-over (up to 20 years) and uses the same idempotency/claim table. No automatic historical completion or correction.
- [x] HTML responses carry no-store; modified PC and mobile growth/consultation runtime assets use cache-busted URLs; push service worker does not cache fetches.
- [x] Automated tests: mocked simultaneous requests, failed model, expired claim lease, missing selection, revision, preview mutation ban, cron permissions, lesson month and PC/mobile read regressions.

## Production database applied, old rows preserved

- [x] Additive consultation summary jobs table and progress/rules RPC installed.
- [x] Summary job RPC limited to service_role (anon/authenticated cannot execute).
- [x] Manual job rule variants and in-place revision action installed.
- [x] Invalid session is denied; new summary jobs table is empty after installation.
- [x] Existing `summary_feedbacks.id` is a PostgreSQL IDENTITY column and needs no extra default/sequence migration.
- [x] Additive `feedbacks.target_month` and protected feedback save RPC mapping installed; existing feedback rows unchanged.
- [x] Service_role-only Cron candidate read and internal scheduler action installed. Verified candidate discovery in read-only test (no AI, no writes).

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
- [ ] **Activate server-independent scheduler/Cron** only after real-account E2E and release; Mobile production currently has neither `CRON_SECRET` nor `OLLI_CONSULTATION_CRON_ENABLED`. Existing production app is untouched; default Cron is off.
- [ ] Existing historical growth feedback created in the next month has no `target_month`; do not auto-label it. Provide an explicit authorized backfill/edit flow for genuine legacy last-month records before release.
- [ ] Shared secret `CRON_SECRET` must be generated securely and stored in **Mobile** production Vercel settings, not in code; enable the flag only after data tests.
- [ ] Verify Cron's 11 AM KST execution on production with rate limit, observed logs and rollback/disable procedure.
- [ ] Baseline global CI has independent monorepo, common source, and PC material archive failures; keep separate from consultation regressions.

## Deployment safety

Deploy Mobile + PC together only after the above blockers are resolved. Roll back both Vercel app deployments if any authenticated test fails. Leave additive database schema in place during app rollback; do not drop jobs or modify old feedbacks. Never expose service_role secrets to browser code. Verify job count, summary row count, and consultation completion RPC logs after release.

## Historical summary identity safety (next stage)

- [x] Read-only database inspection: 45 active historical summary rows without the new consultation task identity; no job rows were present at inspection time.
- [x] Added an unapplied migration to auto-adopt only exact task-key summaries. Ambiguous historic summaries are marked `legacy_review_required` without modifying or deleting the original summary record.
- [x] Existing Cron candidate filter excludes review-required jobs from the daily 6-task processing budget.
- [ ] Build an owner-authorized manual association/review workflow for old ambiguous reports. Do not infer a due month from a write date.

## Historical growth lesson-month correction (staged, not live)
- [x] Add dedicated session-validated owner/manager RPC for correcting `feedbacks.target_month` on saved growth records only.
- [x] Prevent cross-academy/teacher/expired session changes, future months, deleted records, and stale concurrent edits.
- [x] Audit original/updated month and account in an append-only restricted table in the same transaction.
- [x] Expose PC and Mobile archive buttons that prompt for explicit month and show new month only after confirmed server save.
- [x] Disable legacy PC summary regeneration path that deleted a saved summary before recreating it on the client.
- [ ] Apply new migration only after real-user staging E2E; old 219 live growth rows remain unmodified.
- [ ] Real owner-session test: PC→mobile and mobile→PC correction, stale revision conflict, server rollback after disconnected call.

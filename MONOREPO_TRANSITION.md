# Olli Monorepo Transition

Target structure:

- `apps/pc` — PC application
- `apps/mobile` — Mobile application (self-contained snapshot on the work branch; Production cutover not yet active)
- `packages/common` — shared runtime source

## Safety rules

1. Existing root PC runtime remains untouched during the self-contained preparation stage.
2. Existing `vivizac/mobile` repository remains authoritative for Mobile Production until self-contained preview and production verification pass.
3. PC and Mobile Vercel projects stay separate.
4. Raw GitHub rewrites are removed only after the new structure is verified in Production.
5. Phone-only session recovery, iOS/keyboard, observation-note autosave, and other platform adapters must not be absorbed into `packages/common`.
6. Supabase schema/data and stabilized CAS/revision/pending/conflict logic are not changed as part of repository-layout work.

## Current production baselines

- PC main: `0b56edcf5493d1a5224874eb30f0c2d1c68eadc6`
- Mobile main: `0e74868fbdd3b73b3e84f57fcd31e46b64df6484`

## Current transition state

- `packages/common` has been refreshed to include the shared files currently required by the Mobile Production bridge.
- Work branch `apps/mobile` was materialized from Mobile Production commit `0e74868f...`; its baseline tree was verified byte-for-byte as `8f56ad46...` with 246 blobs.
- The gitlink and `.gitmodules` were removed on the work branch only.
- Work branch Mobile build now stages the exact 45 runtime bridge files from `packages/common`; its `vercel.json` no longer points to PC raw GitHub.
- **Production Mobile remains unchanged** in the separate `vivizac/mobile` repository and continues using the existing raw bridge until Preview/cutover validation passes.
- Next structural step is CI verification followed by a Mobile Vercel Preview using `apps/mobile` as Root Directory with outside-root source access enabled.

This stage is structural preparation only. It does not change Production runtime paths.


## 2026-09-29 self-contained Mobile Preview verification

Preview-only validation was created without changing Mobile Production:

- Mobile Preview branch: `preview/self-contained-common-20260929`
- Preview branch head: `8be363e242ec061c6e05088f2c8f8991167d1a9d`
- Vercel Preview deployment: `dpl_2h2kCTG6dq9DKtACWCWrJbsqAZ6y`
- Preview URL host: `vivizac-feedback-99jwbupdl-ipro721-5437s-projects.vercel.app`
- Deployment target: Preview (`target: null`), state: `READY`
- Mobile Production remains `main@0e74868fbdd3b73b3e84f57fcd31e46b64df6484`.
- The Preview branch contains the 45 shared runtime files locally and has no PC raw GitHub runtime rewrites.
- All 45 Preview runtime blob SHAs match `packages/common` exactly.
- The pinned Production source `observation-memo-version-history-core.js` was separately checked and is byte-identical to the package source.
- Monorepo CI at `6ca893fecd6aa0669c3d5eee4a71e2b28b444611` passed structure/build, static dependency closure, PC schedule Realtime, and Mobile schedule/security/storage contracts.

### Not yet completed

- Logged-in visual/UI smoke on the protected Preview deployment is not marked complete. The connected server fetch is redirected by Vercel SSO and the current environment does not expose a persistent browser session.
- The final Vercel Root Directory cutover to `apps/mobile` has not been performed.
- The existing Mobile Production repository/raw bridge has not been removed.

Do not merge the repository-layout cutover to Production or remove legacy bridges until the logged-in Preview/Production smoke gate is completed.


## 2026-09-29 PC/Common single-source gate

PC has now reached the same structural staging model as Mobile on the work branch.

- `packages/common/pc-runtime-manifest.json` defines 48 shared PC runtime files.
- All 48 were verified byte-identical between the previous `apps/pc` parity copies and `packages/common` before removal.
- A temporary build-closure test removed all 48 copies, staged them from `packages/common`, then verified every local PC entry asset and JavaScript syntax.
- After that proof, the 48 tracked duplicates were removed from `apps/pc` on the work branch.
- `apps/pc/vercel.json` now declares `node scripts/stage-common.cjs` as the future app-root build command.
- `apps/pc/.vercelignore` and `apps/mobile/.vercelignore` exclude repository-only test/Supabase/GitHub files from future app-root deployments while preserving runtime/API/assets/common staging.
- CI passed after the duplicate removal and again after the deployment-boundary change.

### Production isolation re-check

A full `main...work/olli-mobile-self-contained-20260929` diff check found:

- branch is ahead of main and not behind,
- no Production-root runtime JavaScript/CSS/HTML changes,
- no Supabase changes,
- the only root transition removal is the obsolete `.gitmodules` file,
- app/materialization/common/test/docs/deploy-contract changes are isolated under their intended paths.

### Known pre-existing Mobile defect found during integrity scan

The expanded syntax gate found that Production Mobile's `api/link-preview.js` contains invalid/double-escaped regular expressions. Team Chat uses this endpoint for URL preview cards. A direct Production request returned HTTP 500 `FUNCTION_INVOCATION_FAILED`.

- The fix exists only on the monorepo work branch and the temporary Mobile Preview branch.
- The fixed parser has syntax and behavior tests for meta extraction, attribute parsing, and private IPv4 checks.
- The temporary Preview deployment built successfully after the fix.
- Mobile Production `main` is intentionally still unchanged.

### Merge blocker remains

Do **not** merge/cut over yet. Remaining gate:
1. authenticated Preview UI smoke,
2. verify Vercel Root Directory + outside-root source access for both `apps/pc` and `apps/mobile`,
3. only then merge/cut over,
4. Production smoke,
5. only after stable Production remove legacy root/raw bridges.

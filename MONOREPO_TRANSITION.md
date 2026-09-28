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

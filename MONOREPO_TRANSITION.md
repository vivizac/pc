# Olli Monorepo Transition

Target structure:

- `apps/pc` — PC application
- `apps/mobile` — Mobile application (currently a gitlink transition bridge)
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
- `apps/mobile` is still a gitlink and is **not** yet a self-contained Vercel Root Directory.
- Existing raw rewrites and the separate Mobile repository remain active.
- Next structural step is to materialize `apps/mobile` from the Mobile Production baseline and make its build consume `packages/common` locally, without changing Production routes yet.

This stage is structural preparation only. It does not change Production runtime paths.

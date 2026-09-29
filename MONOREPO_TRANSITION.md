# Olli Monorepo Transition

## Current state — 2026-09-29

The Production cutover is complete.

- Repository: `vivizac/pc`
- PC Production: `apps/pc`
- Mobile Production: `apps/mobile`
- Shared runtime source: `packages/common`
- PC and Mobile remain separate Vercel projects.
- Both builds stage shared files from `packages/common` using their app-specific runtime manifests.
- Mobile no longer depends on raw GitHub rewrites or the legacy `vivizac/mobile` repository.
- The legacy Mobile repository is source history only.

## Verified Production gates

PC and Mobile app-root deployments reached READY after the cutover. Mobile real-device smoke passed:

1. first-screen entry
2. Observation Note entry
3. Quick Note entry
4. student selection and memo editing
5. save/reopen persistence
6. archive
7. Team Chat
8. Work Hub
9. full app close and re-entry

Shared staged runtime assets were also verified from the live Production URLs.

## Active ownership

```
Supabase
   ↑
packages/common
   ↑             ↑
apps/pc      apps/mobile
   ↑             ↑
PC Vercel    Mobile Vercel
```

`packages/common` owns shared runtime/business/data access code. Platform DOM/CSS/navigation/touch/keyboard behavior remains app-owned.

## Legacy cleanup gate

Repository-layout cleanup must still follow:

1. remove obsolete root patch workflows
2. move validation to `packages/common`, `apps/pc`, and `apps/mobile`
3. remove obsolete legacy root runtime copies only after tests no longer depend on them
4. keep root `supabase/` and DB migration history separate from runtime cleanup
5. run monorepo/build/realtime/security regression tests
6. verify both Vercel Productions remain READY

Do not delete platform adapters or Supabase history as part of root runtime cleanup.

# Olli Monorepo Target

The existing `vivizac/mobile` repository remains the authoritative Mobile **Production** deployment source until the monorepo Preview and Production cutover are verified.

Current monorepo work target:
- Repository: `vivizac/pc`
- Branch: `work/olli-mobile-self-contained-20260929`
- PC Production baseline: `0b56edcf5493d1a5224874eb30f0c2d1c68eadc6`
- Mobile Production baseline: `0e74868fbdd3b73b3e84f57fcd31e46b64df6484`
- Mobile Production baseline tree: `8f56ad46a9ec014506e5a4bc0512737b483ab666`
- `apps/mobile` is a materialized self-contained source snapshot on the work branch; it is no longer a gitlink there.

Rules:
1. Do not disconnect the current Mobile Production Vercel deployment yet.
2. Do not delete the existing `vivizac/mobile` repository or its history.
3. The monorepo Mobile build stages runtime-shared files from `packages/common`; it must not fetch PC raw GitHub at runtime.
4. When Vercel Root Directory is `apps/mobile`, outside-root source access must allow the build to read `packages/common`.
5. Production cutover happens only after monorepo Preview verification.
6. The legacy Production raw bridge is removed only after Production stabilization.

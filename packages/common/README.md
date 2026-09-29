# Olli Common

`packages/common` is the active single source for runtime code shared by Olli PC and Mobile.

## Active Production structure

- Repository: `vivizac/pc`
- PC app: `apps/pc`
- Mobile app: `apps/mobile`
- Shared runtime source: `packages/common`
- PC staging manifest: `pc-runtime-manifest.json`
- Mobile staging manifest: `mobile-runtime-manifest.json`
- Both Vercel projects use their app directory as Root Directory and require outside-root source access so the build can read `packages/common`.

The previous Mobile repository `vivizac/mobile` is retained only as source history. It is not the current Production deployment source. Do not restore raw GitHub runtime rewrites or tracked common copies under either app.

## Ownership rule

Only code that is genuinely shared by PC and Mobile belongs here. PC-only DOM/UI behavior stays under `apps/pc`; Mobile-only DOM/UI, touch, keyboard, session-recovery and phone adapters stay under `apps/mobile`.

When shared storage, revision/CAS, pending/blocked, conflict or authentication behavior changes, preserve the existing safety contracts and run both app build-closure tests before merging.

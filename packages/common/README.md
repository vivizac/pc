# Olli Common

This directory is the transitional single source for code shared by PC and Mobile.

- PC source baseline: `0b56edcf5493d1a5224874eb30f0c2d1c68eadc6`
- Mobile production baseline: `0e74868fbdd3b73b3e84f57fcd31e46b64df6484`
- Current package inventory is aligned with the shared runtime files used by the Production Mobile bridge, plus shared files already staged for the monorepo cutover.
- Runtime cutover is **not active yet**.
- Root PC files and Mobile raw rewrites remain in place until self-contained preview and production verification.
- Do not delete the existing Mobile repository, raw rewrites, or platform adapters during this preparation stage.

Do not add PC-only DOM/UI behavior or Mobile-only DOM/UI behavior here.
Platform-specific adapters remain under their app.

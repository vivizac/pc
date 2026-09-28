# Vercel Monorepo Deployment Contract

PC and Mobile remain separate Vercel Projects throughout the monorepo transition.

| App | Vercel Project | Current Git source | Target monorepo root |
| --- | --- | --- | --- |
| PC | `prj_cyeKySBK73mqbJFXcv1EShy18oTB` | `vivizac/pc` | `apps/pc` |
| Mobile | `prj_q09zNQj9z0VlRaVt9GgRfD0M4HvC` | `vivizac/mobile` | `apps/mobile` |

## Current safe state

- PC Preview from the A/B transition branch is READY.
- Mobile Preview from the A/B transition branch is READY.
- Production Git sources/root directories have not been changed.
- `apps/mobile` is currently a Git history bridge, not yet the final Vercel Root Directory.
- The existing Mobile Vercel project stays connected to `vivizac/mobile` until the self-contained Mobile snapshot is verified.

## Cutover rule

Changing the Git source/root directory is a deployment operation, not a source-code refactor. It is performed only after the A/B implementation and regression suite are green. PC and Mobile must be switched and verified independently.

# Olli Monorepo Transition

Target structure:

- `apps/pc` — PC application snapshot
- `apps/mobile` — Mobile repository gitlink during transition
- `packages/common` — shared runtime source

## Safety rules

1. Existing root PC runtime remains untouched during Stage 5.
2. Existing `vivizac/mobile` repository remains authoritative for Mobile deployment until Stage 6 validation.
3. PC and Mobile Vercel projects stay separate.
4. Raw GitHub rewrites are removed only after the new structure is verified in Production.
5. The Mobile gitlink preserves the original Mobile Git history while the monorepo cutover is prepared.

## Source points

- PC source: `f5667c269fbde0033d2c96dee4104b355aa3444a`
- Mobile source: `a0bfe39d16c4ed98caa13a2a8e8698c43b80a957`

This commit is structural only. It does not change Production runtime paths.

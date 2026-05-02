# Icon sprite investigation (FE-B #14)

**Status:** investigated and rejected. **Date:** 2026-05-02.

## What was tried

Refactor `src/components/ui/icons.tsx`:

  - All 41 upstream icons centralized in a single `<IconSpriteSheet/>`
    component as `<symbol id="cpa-icon-…"/>` definitions, mounted once at
    app root in `src/App.tsx`.
  - Each `IconX` export rewritten as a thin wrapper that renders
    `<svg ...{baseSvgProps}><use href="#cpa-icon-…"/></svg>`.
  - Public API preserved (each `IconX` still takes `size` and forwards
    `...props`). Stroke styling stays on the consumer `<svg>`.

## Measurement

| | bundle raw | bundle gz |
|---|---:|---:|
| Phase B exit baseline (commit `e49937f`) | 2,012,680 B | 551,795 B |
| With sprite refactor applied | 2,014,640 B | 560,090 B |
| Delta | **+1,960 B** | **+8,295 B (+1.5%)** |

Bundle got **bigger**, not smaller.

## Why the sprite pattern doesn't help here

The SVG sprite pattern is an optimization for **HTML pages that fetch
icons over HTTP** as separate SVG files — the sprite eliminates per-icon
HTTP requests by inlining all icons in a single fetched sprite sheet.

This app uses `vite-plugin-singlefile` to produce a single
`dist/index.html` that inlines every asset. There are zero per-icon HTTP
requests to amortize. The "consolidation" the sprite is meant to deliver
is already absorbed by JS bundling: each icon's SVG markup appears
exactly once in the bundle, regardless of how many React instances render
it.

The sprite refactor adds **overhead** in this architecture:

  - The `<symbol>` definitions repeat the SVG path data already in the
    bundle (no net savings).
  - Each consumer `<svg>` now carries its full props set **plus** a
    `<use href="#…"/>` element (extra bytes vs the previous
    inline-paths-only form).
  - Symbol IDs and `href="#…"` strings introduce ~3 KB of new tokens
    that gzip can't dedupe across the bundle.

Result: +8 KB gz with **no architectural benefit** in this deployment
shape. The fork-vs-upstream icon split goal (per plan rev 3) can be
achieved instead by colocating fork-only icons in a separate file (e.g.
`src/components/ui/icons-fork.tsx`) without changing the existing per-
component pattern.

## Plan rev 3 alignment

Plan §"Risk Register" #13: *"Bundle gz target (−10 to −15%) unachievable
without code splitting. If tree-shaking + icon sprite + smaller logo +
dead chart code don't get within 25% of target, document the realistic
delta and proceed."*

Phase B realised −8.06 % gz from the logo swap. Sprite would have
**regressed** that to −6.5 %. We proceed with the −8 % delivered by Phase
B and accept the realistic delta.

## Recommendation for future sessions

**Do NOT re-attempt the icon sprite refactor under the current
single-file bundle.** If the deployment artifact contract changes (e.g.
the management asset becomes a multi-file bundle served over HTTP), the
sprite pattern becomes worth reconsidering.

If a fork needs to add icons in Stage 2, put them in a sibling file —
do not modify `icons.tsx` and do not change the per-component pattern.

# Over-engineering audit — `libs/shared/*`

Part of [the 2026-09-24 audit](00-summary.md). Scope: `api-client`,
`design-system` (tokens/primitives/compounds), `form`, `i18n`. Correctness,
security, and performance are out of scope for this pass.

The codebase is unusually disciplined: nearly every class-literal table, token,
and prop is backed by an explicit "grepped call sites before adding" or
"SOURCED/INVENTED" comment, so there's very little slop to cut here.

## Findings (ranked biggest-cut-first)

**delete** — `Tooltip` primitive. Exported from `primitives/index.ts`, has
tokens built for it (`Z_LAYERS.tooltip`, `OVERLAY_SIZES.tooltipMaxWidth`), zero
consumers in `apps/` or `libs/` outside its own tests/stories (the design has
no tooltip per `overlays.ts`'s own comment). Replacement: nothing — delete the
component + its 313-line spec + stories, and drop the tooltip entries from
`overlays.ts` if nothing else needs the layering slot.
`libs/shared/design-system/src/primitives/lib/tooltip/tooltip.tsx`
(554 lines across tsx+spec+stories).

**shrink** — `stub-api.ts` and `stub-transport.ts` duplicate the same
fetch-stub body (record request, respond by call index, JSON `Response`) and
the identical `rpcPayload()` helper. Replacement: `stub-api.ts` should build on
`stubTransport()` from `stub-transport.ts` instead of re-implementing it.
`libs/shared/api-client/src/__fixtures__/stub-api.ts:37-81`,
`libs/shared/api-client/src/__fixtures__/stub-transport.ts:35-67`.

## Watch-list (no cut recommended)

**yagni** — `Radio`, `Grid`, `Dropdown`, `Tabs`, `Switch`, `Checkbox` each have
exactly 1–2 real call sites in `apps/` (`Radio`:
`apps/garage/web/src/shell/admin/lock-mode-choice/lock-mode-choice.tsx` only;
`Grid`: `admin-window-screen.tsx` only; `Dropdown`: `top-bar.tsx` only) — not
currently a problem (each is documented and prop surface is narrow), but worth
noting these are single-consumer primitives if the prop APIs ever grow past
what that one caller uses.

## Lean already (inspected, nothing to cut)

- `form`
- `i18n`
- `api-client` (aside from the fixture duplication above)
- `design-system` tokens/primitives/compounds — every class-literal table,
  token, and prop is backed by an explicit justification comment citing its
  call sites; no dead tokens found in colors/spacing/motion/overlays/controls;
  `Box`/`Stack` prop breadth all traces to real call sites.

## Net

**-554 lines (Tooltip removal), -0 deps possible.**

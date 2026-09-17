# 0126 – A child tsconfig's `exclude` must be set explicitly, or it silently inherits the parent's

## What

`apps/garage/web/tsconfig.spec.json` extends `apps/garage/web/tsconfig.json` and, until
this fix, declared no `exclude` of its own. TypeScript's `extends` merges
`compilerOptions` but does not merge `include`/`exclude`/`files` — a field a
child omits is inherited from the parent **whole**, not defaulted to empty.
When Task 24's fix round widened the parent's `exclude` to also match
`.spec.tsx`/`.test.tsx` (`doc/decision`'s own commit history, round 2 of that
fix — see the fix report), the child inherited that widened glob too. The
child's own `include` lists exactly those same patterns, so the two
cancelled out: `tsc --listFiles -p apps/garage/web/tsconfig.spec.json` went from
listing every spec/test file under `apps/garage/web/src` to listing **zero** of
them, and the target stayed green throughout, because an empty TypeScript
program has nothing to report errors about.

Fixed by giving `tsconfig.spec.json` its own `"exclude": []`, so it no longer
inherits the parent's at all.

A second, related defect surfaced once the program was no longer empty:
`tsconfig.spec.json` overrode `"module": "commonjs"` while inheriting the
parent's `"moduleResolution": "bundler"`. That mismatched pair is what made
`tsc` resolve `@tanstack/query-core` to two different declaration builds (its
CJS `.d.cts` output and its ESM `.d.ts` output) within the *same* type-check
program — the identical "Property `#private` in type `QueryClient` refers to
a different member" failure round 2 diagnosed in the app program, now
reappearing in the spec program because it was the first time anything
actually type-checked there. Fixed by changing `"module"` to `"esnext"`,
matching the app program. This is safe at runtime: `apps/garage/web/jest.config.cts`
builds its transform through `next/jest`, which constructs its own SWC
options programmatically (`next/dist/build/swc/jest-transformer.js`) rather
than reading this tsconfig — and unlike several other projects in this repo
(`api`, `contract`, `database`, and others use `ts-jest`, which does read a
`tsconfig`), `apps/garage/web` never uses `ts-jest` at all. This tsconfig is
`"noEmit": true` and used only for `tsc`'s static check, so its `module`
setting has no bearing on what Jest actually executes here.

## Why

### The trap generalises, and it is dangerous precisely because it stays green

A widened `exclude` on a parent tsconfig is a completely reasonable, common
edit — this project made one, for a good reason, in fix round 2 of Task 24.
Nothing about making that edit signals "go check every child config that
extends this file." And the failure mode is not a red target that points at
the cause: it is a target that *passes*, because the child program that
would have caught the shadowed error now contains nothing to check.

This is not hypothetical elsewhere in this project. The same shape of bug —
a check that reports success because it was never given anything to look at
— is exactly how an ICS bearer token reached the logs in four places and
survived review: every spec pinned `LOG_LEVEL: 'fatal'`, so no test ever read
log output, and "tests pass" meant "the thing that would have failed was
never run," not "the thing that would have failed didn't." A green that
comes from checking nothing is the same failure wearing different clothes.

### Why this was caught late, and what actually surfaces it

`nx run web:typecheck` merges the exit codes of two separate `tsc`
invocations (`tsconfig.json`, then `tsconfig.spec.json`) but only prints
errors, never file counts — an empty program is indistinguishable from a
clean one in the target's own output. The only way to have caught it earlier
was the check the re-reviewer actually ran:
`tsc --listFiles -p apps/garage/web/tsconfig.spec.json`, counted against the known
number of `.spec.*`/`.test.*` files under `apps/garage/web/src`, and a canary — a
deliberate, unmissable type error injected into a file the program is
supposed to cover, proving the target goes red when it should.

## Consequences

- Whoever next widens `apps/garage/web/tsconfig.json`'s `include`/`exclude` (or adds
  a new child tsconfig anywhere that extends a config with a non-trivial
  `exclude`) needs to check every child's own `exclude`, not assume `extends`
  merges them. This ADR is the pointer; `tsconfig.spec.json`'s new
  `"exclude": []` carries an inline comment saying why it is there and links
  back here.
- The general lesson is broader than this one file: an `include`/`exclude`
  change on any shared/base tsconfig in this repo (`tsconfig.base.json`
  included) should be paired with a `--listFiles` check on every config that
  extends it, not just a green `nx run-many`.
- No test is added or changed by this decision — it is a build-configuration
  correctness fix, not application behaviour, and "no test" is exactly the
  category of gap this ADR is about. The verification instead is procedural,
  spelled out below, and repeatable by anyone who touches these files again.

## Verified by

```
rtk proxy npx tsc --noEmit -p apps/garage/web/tsconfig.spec.json --listFilesOnly \
  | grep -c 'apps/garage/web/src/.*\.\(spec\|test\)\.'
```
→ `18`, matching every `.spec.ts(x)`/`.test.ts(x)` file under `apps/garage/web/src`
(confirmed by listing them individually, not just counting).

A deliberate, unmissable type error
(`const FIXED_TODAY: number = '2026-01-31';` in `lot-screen.spec.tsx`, a
string literal assigned to a `number`) was injected and confirmed to fail
`nx run web:typecheck` (`tsc --noEmit -p apps/garage/web/tsconfig.spec.json` exits
non-zero, attributing 6 errors to that line), then reverted.

`tsc --noEmit -p apps/garage/web/tsconfig.json` (the app program alone) and
`tsc --noEmit -p apps/garage/web/tsconfig.spec.json` (the spec program alone) each
independently exit `0` with the mutation reverted — the original leak (spec
files inside the app program) has not returned, and the app program was
never the one with the `module`/`moduleResolution` mismatch, so it needed no
change.

Full suite, unpiped, `$?` on its own line, all green:
`rtk proxy npx nx run-many -t lint,typecheck,test,build --skip-nx-cache` and
`rtk proxy npx nx format:check` — both `NX_EXIT=0` / `FORMAT_EXIT=0`. Exact
output is in `task-24-report.md`'s round-3 section.

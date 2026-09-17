# 0238 – The no-environment-branch scan covers the whole API source tree

## What

`apps/garage/api/src/realtime/realtime-no-backdoor.spec.ts` now walks **all of
`apps/garage/api/src`** recursively, skipping `**/testing/**` and `*.spec.ts`, instead
of listing one directory. 85 files at the time of writing, against 5 before.

The file keeps its name — four places in the code and the docs cite it by that
name — but its `describe` titles now say what it covers: *"the API has no
environment-dependent behaviour"* for the tree-wide half, *"the realtime
module"* for the assertions that really are about that module.

## Why

`REALTIME_DIR = join(__dirname)` with a non-recursive `readdirSync` made the
spec's whole subject five files in one directory. The rule it enforces — "a
*value* may differ between environments and a *branch* may not" — is quoted from
`apps/garage/api/src/auth`'s own header, and `apps/garage/api/src/auth` is where an
`if (isTest)` would actually let an unauthenticated caller in. The most
security-critical directory in the application was guarded nowhere while a less
critical one was guarded twice.

No such branch exists today — verified by grep, then by this spec — so this
closes a regression gap rather than a live defect. That is the whole point of
the assertion.

## Three things the widening changed

**`NODE_ENV` needed an allow-list, and it is explicit.** Three shipped files
name it: `env.ts` (a schema member), `app/app.module.ts` (a DI read handed to
the logger factory) and `logging/logger.options.ts` (the `base` field of a log
record). All three *carry* the value; none branches on it. So the assertion is
two-part — the set of files that mention it must be exactly those three, and
none of them may match a comparison or a conditional on it. A fourth file
mentioning `NODE_ENV` at all fails, which is the behaviour worth having.

**`CI` became a word match.** `not.toContain('CI')` was a substring test. It was
true of five realtime files by luck; across 85 it would eventually fail on some
unrelated identifier and be relaxed rather than fixed. `/\bCI\b/` says what was
meant.

**The vacuity guard became a count, not a file list.** The old guard pinned five
filenames, which breaks on every new file in that directory — an invitation to
weaken it. What actually has to be impossible is a walker that matches nothing
and satisfies every `not.toContain` for free, so the guard is
`length >= 60` plus two named files (`auth/jwks-verifier.service.ts`,
`realtime/realtime.gateway.ts`) that prove the walk reaches the two directories
the rule is about.

## Risk

A count-based guard tolerates the walker losing *some* files without noticing.
Sixty is well under the current 85 and well over any plausible single directory,
so it fails on a regression to per-directory scanning while surviving ordinary
growth — but it is a threshold, and a threshold is a judgement.

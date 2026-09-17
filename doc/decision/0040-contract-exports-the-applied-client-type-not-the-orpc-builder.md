# 0040 – `libs/garage/contract` exports the applied client type; `@orpc/contract` stays out of `type:util`

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 19 (`libs/shared/api-client`)
**Follows on from:** `doc/decision/0007-*`, `doc/decision/0017-*`

## What

`libs/shared/api-client` needs `ContractRouterClient<Contract>` to type its client. That generic
lives in `@orpc/contract`, which `NPM_ALLOWLIST` grants to the **`type:contract` tag only**.

`libs/garage/contract` applies the generic itself and exports the result:

```ts
// libs/garage/contract/src/api/router.ts
export type Contract = typeof contract;
export type ContractClient = ContractRouterClient<Contract>;
```

`libs/shared/api-client` then writes `export type ApiClient = ContractClient;` and never names
`@orpc/contract` at all. `NPM_ALLOWLIST.util` does **not** list `@orpc/contract`, and carries
a comment saying why.

## Why

The first version of this task took the other route: it added `@orpc/contract` to
`NPM_ALLOWLIST.util`, with a comment arguing the import was type-only and therefore harmless.
Review rejected it, correctly.

**The allow-lists hang off `type:`, and that tag is shared.** `NPM_ALLOWLIST.util` applies to
every `type:util` project at once — today `libs/shared/form`, `libs/shared/i18n`, `libs/shared/api-client`,
`libs/query`, and `libs/garage/shared-types`; tomorrow `libs/garage/realtime-client`, `libs/garage/auth`,
`libs/garage/calendar-export`. Adding a package to serve one of them hands it to all of them. The
reviewer's probe confirmed the consequence directly: with that entry in place, an
`@orpc/contract` import from `libs/shared/i18n` passed lint.

**"Type-only" is not the mitigation it sounds like.** It is true that nothing of
`@orpc/contract` reaches the runtime through a type import — but `@nx/enforce-module-boundaries`
does not distinguish the two, so the rule was genuinely relaxed for every `type:util` lib, not
narrowed to type positions. The comment made the change read safer than it was.

**`NPM_ALLOWLIST.contract` was tight on purpose, and said so.** Its comment reads "`@orpc/contract`
only — never `@orpc/client` or `@orpc/server`, so the contract can not reach a transport
(`doc/decision/0007-*`)". Loosening the *other* side of that boundary as a side effect of a
frontend task is exactly the kind of drift `eslint.config.mjs` exists to prevent — it is this
project's entire enforcement surface, and three separate rules in it have already been found
silently inert.

**Why exporting the applied type is the right shape, not just the permitted one.** A contract
lib's job is to be the single source of truth for what crosses the boundary. `Contract` (the
router object's type) was already exported from here; `ContractClient` is the same object seen
from the caller's side. Putting the application here also fixes the parameterisation in one
place — `TClientContext` stays at its default, so a second consumer cannot quietly instantiate
it differently and end up with a structurally different client type.

**Alternatives rejected.** A new `layer:` tag isolating `libs/shared/api-client` would let it keep the
direct import, at the cost of a whole tag dimension existing to serve one line. Re-declaring the
generic by hand in `libs/shared/api-client` would duplicate a type the contract already owns and
reintroduce exactly the drift contract-first is for.

## How

The type is exported from `libs/garage/contract/src/api/router.ts`, next to `Contract`, and reaches
`@garage/contract` through the existing `src/api/index.ts` barrel — no new entry point.

Verified by probe rather than by lint passing green (`doc/workspace.md` warns this trap has
already fired three times). A temporary `import type { ContractRouterClient } from '@orpc/contract'`
in `libs/shared/i18n` **and** in `libs/shared/api-client` itself:

```
libs/shared/api-client/src/zz-probe-contract.ts
  4:1  error  A project tagged with "type:util" is not allowed to import "@orpc/contract"
libs/shared/i18n/src/zz-probe-contract.ts
  3:1  error  A project tagged with "type:util" is not allowed to import "@orpc/contract"
```

Both probes deleted afterwards. The `libs/shared/api-client` probe is the important one: it shows the
narrowing is not merely "i18n is fenced off" but that the owning lib itself has no privileged
path either.

## Risk if this is wrong

`libs/garage/contract` now names a type from the client half of oRPC's type surface. That is a smaller
step than it looks — `ContractRouterClient` is defined in `@orpc/contract`, the package the
contract already depends on, and `NPM_ALLOWLIST.contract` still bans `@orpc/client` and
`@orpc/server` outright, so the contract still cannot reach a transport. The line to hold is
that one: if a future task finds itself wanting `@orpc/client` inside `libs/garage/contract`, that is
not an extension of this decision, it is `doc/decision/0007-*` being overturned.

The second risk is the pattern being over-applied. "Re-export it from the contract lib" is the
right answer for a *type derived from the contract*; it is the wrong answer for a package a
wrapper genuinely needs at runtime (`@orpc/tanstack-query` in `libs/query`, `@hookform/resolvers`
in `libs/shared/form`). Those stay in `NPM_ALLOWLIST.util`, coarse tag and all, because the per-directory
`no-restricted-imports` override is what actually confines them.

# 0005 – The npm scope is `@lets-park`, not `@myorg`

**Date:** 2026-08-28 · **Status:** accepted (decided by the user) · **Amends:** `plan.md` (entry-point names)

## What

Every lib in the workspace lives under the `@lets-park` scope:

| `plan.md` says | Reality |
| --- | --- |
| `@myorg/contract` | `@garage/contract` |
| `@myorg/contract/realtime` | `@garage/contract/realtime` |
| `@myorg/design-system/primitives` | `@garage/design-system/primitives` |
| … | … |

## Why

`@myorg` is an obvious placeholder. Changing the scope touches every import in the
repo, so it's essentially free now (before the first lib exists) and expensive later.
The user confirmed the choice.

## How

The scope is set in Task 1 (root `package.json`, `nx.json`, path aliases in
`tsconfig.base.json`, and generator defaults), so every lib created in later tasks
falls under `@garage/*` automatically.

## Risk if this is wrong

Renaming the scope is mechanical (search & replace + regenerating path aliases), but
the later it happens, the more files are affected. That's why we handle it right away
in Task 1.

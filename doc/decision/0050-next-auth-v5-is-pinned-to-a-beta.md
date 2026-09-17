# 0050 – `next-auth` is pinned to an exact v5 **beta**, and `latest` must never be taken

**Date:** 2026-09-02 · **Status:** accepted · **Task:** 20 (`libs/garage/auth`), review fix round 1

## What

`package.json` carries

```json
"next-auth": "5.0.0-beta.32"
```

— an exact version, no range, installed with `--save-exact`. It resolves `@auth/core@0.41.3`.

**Do not "modernise" this to `^5.0.0`, `latest`, or `next`.** There is no stable v5 release to
move to, and every automatic alternative lands somewhere worse.

## Why

**`latest` is still v4.** At the time of writing, `npm view next-auth dist-tags` returns:

```
{
  latest:  4.24.15,
  beta:    5.0.0-beta.32,
  next:    4.0.0-next.26,
  canary:  3.24.0-canary.0,
  ...
}
```

Auth.js has published v5 under the `beta` tag for years and has never moved `latest`. So the
usual reflexes all fail:

- `next-auth@latest` installs **v4**;
- `^5.0.0` matches no published version at all — npm's semver ranges exclude prereleases unless
  the range itself carries one, so `^5.0.0` does not match `5.0.0-beta.32`;
- `next-auth@next` installs **v4.0.0-next.26**, an ancient prerelease, because that tag was
  never repurposed.

**v4 is not a fallback; it is a different library.** `libs/garage/auth` is built on the v5 App Router
API throughout: `NextAuth()` returning `{ handlers, auth, signIn, signOut }`, the universal
`auth()` in Server Components and middleware, and the `authorized` callback. v4 has
`getServerSession`, `withAuth` and a `[...nextauth].ts` default export, and none of the four
values this lib destructures exists. A downgrade does not degrade — it fails to compile.

**The version is fixed by the spec, not by preference.** `plan.md`'s technology decisions and
global constraint 9 both name next-auth v5. Choosing the version is not this task's call; the
only decision here is *how* to express "v5" in a `package.json` when v5 has no stable tag.

**Why exact, not a prerelease range.** `^5.0.0-beta.32` would match later betas, and a beta is
by definition outside semver's compatibility promise — nothing obliges `beta.33` to keep
`beta.32`'s API. An exact pin makes every bump a deliberate commit with a diff someone reads,
rather than lockfile drift that surfaces as a failing test months later. (Which specific betas
broke what has not been researched here; the point is that the guarantee does not exist, not
that a particular break is known.)

## How

`npm install next-auth@5.0.0-beta.32 --save-exact`. `libs/garage/auth` is the only importer
(`eslint.config.mjs`, `WRAPPED_LIBRARIES`), so the blast radius of a bump is one lib and its
79 tests.

**When a stable v5 ships**, the upgrade is `npm install next-auth@5 --save-exact`, then run
`nx run-many -t lint,typecheck,test -p auth`. The things most likely to break are the ones
this lib depends on structurally and which are all covered by tests:

- the `{ handlers: { GET, POST }, auth, signIn, signOut }` shape (`create-auth.spec.ts`);
- `trustHost` still being honoured from the config rather than only from the environment —
  `create-auth.spec.ts` drives the real route handler under `NODE_ENV=production` and would
  catch an `UntrustedHost` regression;
- the `jwt` / `session` / `authorized` callback signatures (`config.spec.ts`);
- `Okta({...})` still parking caller options under `.options` (`config.spec.ts` asserts this
  explicitly, because reading them at the top level silently passes against `undefined`);
- `SessionProvider` still distinguishing an absent `session` prop from `null`
  (`client.spec.tsx`).

## Risk if this is wrong

A pinned beta gets no security patches unless someone bumps it deliberately. Nothing in this
repo watches for a new `beta` tag, and Dependabot-style tooling generally will not offer a
prerelease bump against an exact prerelease pin — so the pin is only as safe as somebody
periodically running `npm view next-auth dist-tags`. That check belongs with whoever owns
dependency hygiene; it is not automated here.

The second risk is the one this record exists to prevent: a future dependency sweep sees
`-beta` pinned exact with no in-repo rationale and "fixes" it. Before this record, the
justification lived only in a gitignored implementation report. If you are reading this
because you were about to change that line — the four bullets above are why not.

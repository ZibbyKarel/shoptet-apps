# 0276 – Destructive database scripts are guarded by the connection string, not by `NODE_ENV`

## What

`libs/garage/database/src/lib/disposable-database.ts` exports
`assertDisposableDatabase(url)`. Both scripts in `libs/garage/database/src/scripts`
call it before they touch a row, and both print the host and database they are
about to write to.

It accepts `localhost`, `127.0.0.1`, `::1` and any **single-label** hostname (a
Docker Compose service name or network alias). Everything else is refused unless
`GARAGE_ALLOW_DESTRUCTIVE_RESET=1` is set in the environment.

`reset-e2e.ts`'s previous guard —

```ts
if (process.env['NODE_ENV'] === 'production') { throw new Error(…); }
```

— is gone.

## Why

- **The old guard was inert in exactly the situation it existed for.**
  `NODE_ENV` is unset in a plain shell; `nx run database:reset-e2e` sets only
  `SWC_NODE_PROJECT` (`project.json`); `apps/garage/web-e2e`'s `globalSetup` spawns the
  script with whatever environment it inherited. Meanwhile the variable that
  actually decides which database gets emptied — `DATABASE_URL` — was never
  consulted. The script's own docblock said *"'delete a month of reservations'
  is not a thing that should ever be one stray environment variable away from a
  real database"*, and the implementation was one stray environment variable
  away from a real database. Measured: with the pre-fix file and
  `DATABASE_URL=postgresql://…@prod.example.com:5432/garage`, the script ran
  straight through the guard and failed inside
  `prisma.waitlistEntry.deleteMany()` with `Can't reach database server at
  prod.example.com`. The only thing that saved it was DNS.
- **The property that matters is *which database this is*, and only the
  connection string states it.** A hostname check is a fact about the target; a
  `NODE_ENV` check is a fact about how somebody happened to invoke the process.
- **A single-label hostname cannot be a managed database.** RDS, Cloud SQL, Neon
  and Supabase all hand out fully-qualified names, so `postgres` or
  `garage-postgres` can only be a container on the same Compose network. That
  keeps the Compose topology working without an override, which matters because
  an override people have to set every day is an override people alias away.
- **`seed.ts` had the same hole**, and it is the exposure path for
  `doc/decision/0275-*`: it creates accounts and issues feed credentials.
  One helper, both callers.
- **The escape hatch is deliberate.** Somebody with a real reason to seed a
  shared database can still do it, but they have to say so in the same command,
  and the host is printed either way.

## How

- `assertDisposableDatabase` returns `{ url, host, database, overridden }`
  rather than `void`, so the caller can print the target *and* narrow
  `string | undefined` to `string` by having passed the guard, instead of
  asserting a type it already checked.
- The refusal message names the host and never the URL, which carries the
  password.
- Measured, not assumed: `postgresql:` is not a WHATWG "special scheme", so
  `new URL('postgresql://u@[::1]/d').hostname` is `'[::1]'` **with** the
  brackets — not `'::1'` as it would be for `http:`. The helper strips them.
  This was found by the spec failing, not by reading the specification.
- `reset-e2e.ts`'s permanent widening of the reservation window to 31 days is
  now a **stated term of the script's contract** rather than an acknowledged
  cost: the only databases it can reach without an explicit override are ones
  whose settings nobody is entitled to rely on between runs. A teardown that
  restored the value would still be wrong for anyone whose run was interrupted.

## Risk

- **A developer running Postgres on a LAN machine (`db.local`, a colleague's
  desktop) now needs the override.** That is the intended trade: the check
  cannot tell that host from a staging one, and the failure mode it exists to
  prevent is silent.
- **The override is a single environment variable**, so it can be exported in a
  shell profile and forgotten. Nothing prevents that; the printed target line is
  the mitigation.
- `GARAGE_ALLOW_DESTRUCTIVE_RESET` is not in `apps/garage/api/src/env.ts` or
  `.env.example` on purpose — it is a flag for one invocation of a CLI script,
  not configuration, and a variable that lives in `.env` is a variable that is
  always set.

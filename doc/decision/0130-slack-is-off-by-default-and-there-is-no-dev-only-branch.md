# 0130 — Slack is off by an env value, not by a dev-only branch

**Date:** 2026-09-03 · **Status:** accepted · **Task:** 16

## What

`SLACK_ENABLED` defaults to **`false`**, `.env.example` ships it as `false`, and
that single environment *value* is the whole mechanism keeping a developer's
machine from posting into a real Slack workspace.

There is **no** `if (process.env.NODE_ENV !== 'production')`, no `DRY_RUN` flag,
no `SlackClient` subclass that logs instead of sending, and no injected "fake
Slack" provider chosen by environment. The disabled path is the *same code* as
the enabled one: every notification reads its data and renders its Czech copy,
and only the final HTTP call stops, at one gate inside `SlackClient`.

`SLACK_ENABLED=true` with no `SLACK_BOT_TOKEN` or no `SLACK_CHANNEL_ID` refuses
to boot, naming the missing variable and never its value.

## Why

Three rules of this project point the same way and would each be broken by the
obvious alternative.

**No test-only branches.** `doc/environment.md` states it as the project's
philosophy and `doc/auth.md` is built on it: dev, e2e and production run
identical code and differ only in values. A "don't really send in dev" flag is
precisely a test-only branch — it is a code path that exists only where nobody
is watching, and the first bug in it is invisible until production is the thing
running the other branch.

**A path that only runs in production is a path nobody has run.** If the message
were built only when Slack is enabled, a template that throws on a `null` plate,
or a Czech string with a broken ICU escape, would first appear in production
minutes after a cancellation. Because the gate is at the *call*, not at the
message, a developer with Slack off still executes every line up to the socket —
and `slack.db.spec.ts` asserts exactly that: the database read happens and zero
HTTP requests leave the process.

**One gate is auditable; several are not.** Everything Slack-facing goes through
`SlackClient`, so "is this installation sending?" has one answer in one place.
A per-call-site check would be four places for a fifth call site to forget.

## Why `SLACK_ENABLED` is not coerced

`z.coerce.boolean()` treats every non-empty string as `true`, so
`SLACK_ENABLED=false` would switch Slack **on**. The schema uses
`z.enum(['true','false'])`: only the two literals parse, `1`/`yes`/`FALSE`/empty
are rejected by name at boot. For a switch whose off position is a safety
property, guessing is not acceptable.

## What a team that wants Slack in dev does

Point `SLACK_CHANNEL_ID` at a scratch channel and use a separate Slack app's
token. That is a change of values, not of code, and it is the same change
production makes.

## Consequences

- A developer who *has* set `SLACK_ENABLED=true` locally will post to whatever
  channel they configured. That is the intended behaviour and the reason the
  variable is documented as pointing at a scratch channel.
- The `'disabled'` outcome is a first-class value, distinct from `'failed'`, so
  a log or a test can tell "nobody asked us to send" from "we tried and could
  not".
- CI needs nothing: with the variable absent, the default is off.

## How

- `apps/garage/api/src/env.ts` — `SLACK_ENABLED` (enum, default `false`) and the
  `superRefine` that requires the token and channel when it is on.
- `apps/garage/api/src/slack/slack-client.service.ts` — the one gate.
- `apps/garage/api/src/slack/slack.config.ts` — `target` is present exactly when Slack
  is on, so the compiler carries the invariant instead of a `?? ''`.
- `apps/garage/api/src/slack/slack-client.service.spec.ts` — disabled sends nothing at
  all (`server.requests` is empty), and is neither a `warn` nor an `error`.
- `apps/garage/api/src/slack/slack.db.spec.ts` — disabled still runs the database read.
- `apps/garage/api/src/slack/slack-env.spec.ts` — the rejected spellings, and that the
  boot error names the variable and never the token. The original version of
  this last check supplied an *empty* `SLACK_BOT_TOKEN` and looked for the
  wrong constant, so it could not have failed even if the formatter started
  echoing offending values — task-16-task-review.md's M1 caught it. The fix
  puts the real token-shaped string where the schema actually rejects it
  (`SLACK_ENABLED`, a two-literal enum) and checks it does not come back out;
  verified against `formatEnvValidationError` echoing the raw config value.

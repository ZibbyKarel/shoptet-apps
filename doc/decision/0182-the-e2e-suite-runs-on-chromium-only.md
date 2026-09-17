# 0182 – The e2e suite runs on Chromium only

## What

`apps/garage/web-e2e/playwright.config.mts` declares two projects — `setup` and
`chromium` — where the Nx scaffold declared Chromium, Firefox and WebKit. The
other two browsers are removed, not skipped.

## Why

- **Nothing in these specs is browser-dependent.** They assert Czech accessible
  names, HTTP statuses, response headers and ICS text. There is no CSS
  assertion, no screenshot comparison, no vendor-prefixed API, no
  `navigator.*` probe. Three browsers would run the same code paths through
  three engines and could only disagree about things the suite never looks at.
- **The cost is not linear, it is contention.** Every scenario writes to one
  shared PostgreSQL database, and three of them run two or three concurrent
  authenticated sessions. Tripling the suite triples the number of sessions
  racing for the same nine parking spots and the same seeded accounts. Slot
  allocation (`SPEC_DAY_SLOTS`) keeps *specs* apart; it does not keep three
  copies of the same spec apart, so a three-browser run would need a
  per-browser day allocation as well — complexity in service of coverage that
  does not exist.
- **The sign-in flow is the one place a browser difference could plausibly
  matter**, and it is a plain form post and a chain of 302s. Cross-browser risk
  there is a question about `mock-oauth2-server`, not about this application.

If the design system later grows assertions that are genuinely visual, those
belong in Storybook and its own visual tooling, where a browser matrix is cheap
and does not need a database.

## How

- `apps/garage/web-e2e/playwright.config.mts` — `projects: [setup, chromium]`. The
  `setup` project produces the personas' `storageState`; `chromium` depends on
  it and ignores `src/support/`.

## Risk

- **A Safari- or Firefox-only rendering bug ships unnoticed.** Accepted: this is
  an internal tool for one company, and the suite's job is to prove the
  application's *behaviour*, not its rendering. Restoring a browser is four
  lines in the config plus a day-slot scheme, on the day somebody has a reason.

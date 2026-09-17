# 0029 – Documentation is written in English; UI copy stays in Czech

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** Global
Constraint 12 in `doc/implementation-plan.md`

## What

All prose documentation in this repository — every `doc/*.md` file, every
`doc/decision/NNNN-*.md` record, and `CLAUDE.md` — is written in **English**.
This reverses the language the documentation was actually written in up to
this point: all 33 decision records and every `doc/*.md` file were originally
written in Czech by prior subagents, under an earlier reading of Global
Constraint 12 (`**Jazyk:** kód, identifikátory a komentáře anglicky; UI copy
a doc/ česky` – "code, identifiers, and comments in English; UI copy and
`doc/` in Czech").

This decision does **not** touch the application's interface language. Every
UI string in `apps/garage/web` and any domain-facing copy in `libs/*` **stays in
Czech** — this is, and remains, a Czech company's internal app. Interface
language is a product decision made by the user, not a documentation
convention, and it is not being revisited here.

As part of applying this decision, all 33 decision records and 8 top-level
`doc/*.md` files were renamed with `git mv` (preserving decision records'
exact numeric prefixes) and translated in full from Czech to English; every
cross-reference to the old Czech filenames was updated to match. Where a
translated document quotes an actual piece of UI copy (button labels, form
hints, banner text), the Czech string is kept verbatim with a short English
gloss in parentheses on first use — e.g. `Rezervovat místo` ("Reserve a
spot") — so the documentation still describes the real interface rather than
an invented English one.

## Why

Two audiences read this repository for two different reasons, and conflating
their languages under one blanket rule ("`doc/` is Czech") caused real
confusion in practice:

- **Documentation** (`doc/`, decision records, `CLAUDE.md`) is read by
  engineers and agents reasoning about the system's architecture and
  history. English is this project's working language everywhere else —
  code, identifiers, comments, commit messages — and splitting the
  documentation off into Czech meant every agent that needed to consult
  `doc/decision/*` or `doc/*.md` had to work in a second language for no
  benefit; nothing about *why a decision was made* is Czech-specific.
- **The application's UI** is read by the actual users of the app — Czech
  employees reserving a parking spot — and has always been meant to render
  in Czech regardless of what language the documentation about it uses. That
  was true under the old wording of Global Constraint 12 too; the old wording
  just expressed it by accident, by lumping "UI copy and `doc/`" into a
  single Czech bucket, which invited exactly the opposite mistake: a future
  agent reading "`doc/` is Czech" and inferring nothing in this project has
  an English-language obligation, including the interface.

Making the distinction explicit — documentation in English, UI copy in
Czech, stated as two independent facts rather than one bucketed rule — removes
the ambiguity in both directions: it stops the interface from silently
drifting into English through a "helpful" translation, and it stops the
documentation from silently staying in Czech through inertia.

## How

- Global Constraint 12 in `doc/implementation-plan.md` now reads: "Language:
  code, identifiers, and comments in English; documentation (`doc/`) in
  English. **UI copy stays in Czech** — this is a Czech company's internal
  app, and the interface language is a deliberate product decision, not a
  documentation one. Do not translate UI strings into English." The mirrored
  copy in `.superpowers/sdd/implementation-plan/global-constraints.md`
  (gitignored, used for task dispatch) was updated to match verbatim.
- `CLAUDE.md`'s `## Language` section was extended with the same
  distinction, so an agent reading only the top-level project file (without
  opening `doc/implementation-plan.md`) still sees it.
- Every `doc/*.md` file and every `doc/decision/NNNN-*.md` record was
  renamed to an English slug (numeric prefixes on decision records
  unchanged) and translated in full — not summarized — preserving tables,
  code blocks, SQL, and all technical identifiers (file paths, npm package
  names, Nx tags, error codes, event names) verbatim.
- Quoted UI strings inside the translated documentation were left in Czech
  with an English gloss in parentheses on first use, rather than translated
  outright — the documentation must still describe the actual (Czech)
  interface.
- Every cross-reference to an old Czech filename — in `doc/`, `libs/`,
  `apps/`, `prisma.config.ts`, `CLAUDE.md`, and `README.md` — was searched
  for and updated, including glob-style references
  (`doc/decision/0004-*`) that would otherwise keep resolving silently
  after the rename without ever pointing at a nonexistent name.

## Risk if this is wrong

If a future agent misreads "documentation is in English" as license to also
translate the interface, Czech-speaking users would suddenly see an English
app — a real regression for the app's actual audience, who never asked for
an English UI. That's precisely the failure mode this decision is written to
prevent: the constraint now states the UI exception in the same sentence as
the English-documentation rule, not as a separate fact an agent might miss
if it only skims Global Constraint 12's first clause.

Conversely, if this decision itself is ever misread as "everything Czech
must be purged," a future agent might try to translate quoted UI strings
inside the documentation into English outright — losing the ability to
match documentation prose against what the interface actually says. The
"Czech string kept, English gloss added" convention exists specifically to
avoid that.

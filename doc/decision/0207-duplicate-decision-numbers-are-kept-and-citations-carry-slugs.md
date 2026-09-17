# 0207 – Duplicate decision numbers are kept; citations carry slugs

## What

Five numbers in `doc/decision/` are used twice:

| number | the two records |
| --- | --- |
| 0011 | `breakpoints-are-derived`, `derived-control-tokens-and-rounding` |
| 0012 | `focus-ring-and-native-elements-in-primitives`, `otf-fonts-committed-without-verified-license` |
| 0013 | `calendar-arithmetic-and-single-timezone-boundary`, `storybook-10-without-nx-storybook-and-without-addons` |
| 0024 | `czech-month-declension-genitive-vs-nominative`, `prisma-client-inside-libs-database-and-committed` |
| 0025 | `next-intl-esm-jest-transform`, `uuid-v7-as-primary-key` |

They are **not** renumbered. Instead, every citation that referred to one of
them by the ambiguous `NNNN-*` glob now names the slug, and `doc/README.md`
lists all 132 records by slug.

## Why

- **The ambiguity that could actually bite was in the citations, not in the
  filenames.** A reader following `doc/decision/0012-focus-ring-and-native-elements-in-primitives`
  is never confused. A reader following `doc/decision/0013-*` has two records to
  choose from and no way to tell which. There were exactly five such citations
  in the repository, all resolvable from context, all now spelled out:

  | file | was | now |
  | --- | --- | --- |
  | `libs/garage/calendar-export/src/lib/reservation-calendar.ts` | `0013-*` | `0013-calendar-arithmetic-and-single-timezone-boundary` |
  | `libs/garage/shared-types/README.md` | `0013-*` | same |
  | `doc/ics.md` | `0013-*` | same |
  | `doc/decision/0081-*` | `0013-*` | same |
  | `doc/wrappers.md` | `0025-*` | `0025-next-intl-esm-jest-transform` |

- **Renumbering is a rename, and a rename is what makes this dangerous.** Five
  files would move, ~25 citation sites would need editing across `.md`, `.ts`,
  `.tsx` and `.cts`, and a number collision is **not a merge conflict**: when
  two branches add different `0011-…` files git reports success and keeps both,
  and when one branch renames a record while another cites its old number, git
  also reports success and leaves a dangling reference in prose. This branch is
  one of several unmerged ones and is itself based on `task-28-e2e`, which is
  *behind* `feat/lets-park-mvp` — that integration branch already carries five
  files this base has never seen. Renumbering from here would update only the
  citations visible from here.
- **A find-and-replace would corrupt what it was meant to fix.** Rewriting
  `0013-` to `0014-` also rewrites `0013-storybook-…`, the record that is *not*
  being renumbered, and the `0013-*` globs that mean the other one.
- **The numbers were never the identifier.** Slugs are unique — all 132 of them
  — and `doc/README.md` is the index that resolves any of them.

## How

- The five citations above, rewritten in place.
- `doc/README.md` — every record listed by slug, with the duplicates called out
  in the same table as above so the collision is discoverable rather than
  surprising.
- **The rule going forward:** a `NNNN-*` citation is only correct while that
  number is unique, and nothing in the repository keeps it unique — so prefer
  the full slug, and **never** use the glob form for 0011, 0012, 0013, 0024 or
  0025. The 585 existing `NNNN-*` citations to unique numbers are left alone;
  rewriting them would be the same mass edit this record declines to make.
  Take the next number from the end of the index in `doc/README.md`, and if it
  collides after a merge, leave it and rely on the slug.

## Risk

- **The numbers stay non-unique**, so they cannot be used as keys — by a script,
  a link checker, or a person skimming. That is already true today and this
  records it rather than pretending otherwise.
- **A future `NNNN-*` citation reintroduces the ambiguity.** Nothing enforces
  the rule; it is stated in the index and here.

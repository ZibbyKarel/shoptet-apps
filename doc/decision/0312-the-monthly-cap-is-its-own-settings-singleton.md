# 0312 – The monthly cap is its own settings singleton

**Date:** 2026-09-17 · **Status:** accepted · **Task:** `TODO.md` item 2 ·
**Builds on:** `doc/decision/0026-singleton-settings-enforced-by-check-constraint.md`

## What

The admin-configurable monthly reservation cap (`TODO.md` item 2 — the cap was
a fixed constant, `MONTHLY_RESERVATION_CAP = 5`) lives on a **new** singleton,
`ReservationLimitSettings`, one row, one field
(`monthlyReservationCap`). It is **not** a column on
`ReservationWindowSettings`, and `ReservationWindowSettings` was **not**
renamed to make room for it.

## Why not a column on `ReservationWindowSettings`

`ReservationWindowSettings` already has a name and a doc comment, and both say
what it is for: it drives the reservation **window** — whether a _month_ is
open to anybody at all (`doc/decision/0004-*`). The cap is a different rule
with a different audience — how much _one person_ may take while the month is
open — and the two are visibly different to the people who hit them: an
ordinary user meets the window as a banner across the whole screen and the cap
as a single greyed-out day in the bulk-booking calendar. Adding
`monthlyReservationCap` to `ReservationWindowSettings` would have made both the
model's name and its doc comment false the moment it landed — exactly the kind
of defect this repo treats as real, not decoration.

## Why not renaming `ReservationWindowSettings` instead

Renaming the window model to something that could honestly hold both settings
was considered and rejected for a reason that has nothing to do with naming
taste. `AuditLog.entityType` and `AuditLog.action` store the model's identity
as **literal strings** — `'ReservationWindowSettings'` and
`'RESERVATION_WINDOW_UPDATED'` — and `AuditLog` is append-only by trigger
(`doc/decision/0027-hard-delete-and-append-only-auditlog.md`): nothing can
`UPDATE` a historical row to say it happened to the renamed entity instead.
Renaming the model would have left the audit table permanently disagreeing
with itself — old rows naming `ReservationWindowSettings`, new ones naming
whatever it became — and any admin-UI or support query that filters on
`entityType` would silently split its own history in two. A new model costs a
second settings surface; a rename would have cost a historical record that
could never be made whole again. Not a close call.

## What it costs

A second settings surface, duplicating the upsert/default/audit shape
`ReservationWindowService` already has for the window: `ReservationLimitsService`
(`apps/lets-park/api/src/reservation-limits/`) reads the singleton, defaults it
when the seed hasn't run, replaces it wholesale on `update`, and writes
`RESERVATION_LIMITS_UPDATED` to the audit log with before/after values — the
same arrangement as `ReservationWindowService`, just for one field instead of
two. It also costs a fifth admin tab, "Limity rezervací"
(`apps/lets-park/web/src/shell/admin/admin-limits-panel.tsx` +
`admin-limits-screen/`), built the same way as the reservation-window tab: one
stepper, no Save button, saves on change.

## Why the cap rides on the month summary, not its own endpoint

`monthReservationsOutputSchema` — shared by `reservation.myMonth` and
`admin.reservation.month` — gained a required `cap` field instead of the
client fetching `admin.reservationLimits.get` (or a user-facing equivalent) on
the side. The client's whole job with the two numbers is `cap - count`: the
bulk-booking calendar greys out a day once the difference reaches zero, and a
count and a cap that could arrive from two independent round trips are a count
and a cap that can disagree the moment an admin changes the setting between
the two requests landing. One field cannot drift from itself. This mirrors why
the window state rides along on `overview.day` rather than a separate call
(`doc/contract.md`, "Day overview") — the same shape, applied to the same
class of problem.

## Why the cap is read inside the writer's transaction

`readMonthlyReservationCap` is called **inside** the same transaction that will
insert the `Reservation` row(s) — by `ReservationsService.create`,
`BulkReservationService.confirmOnce`, and `WaitlistPromotionService.promote` —
not once, earlier, outside it. `doc/decision/0307-*` already established that
the cap has no unique index to act as a final arbiter: the
`pg_advisory_xact_lock` plus a recount, done inside the transaction, _is_ the
authoritative check. A cap value read before that transaction opened would be
exactly the kind of stale read that check exists to rule out — an admin could
lower the cap between the read and the insert, and the insert would go on to
enforce a number nobody configured any more. Reading it as one more statement
inside a transaction that already takes a lock and does a recount is a small
addition to a path that is already doing several things, and it cannot go
stale against itself.

### Why the promotion loop hoists that read above the loop

`WaitlistPromotionService.promote` reads the cap **once**, above its loop over
waitlist candidates, rather than once per candidate inside it. The reason is
**not** that the value cannot change mid-transaction — it can. Nothing in this
API sets an isolation level, so every transaction here runs at PostgreSQL's
default READ COMMITTED, where each statement takes its own fresh snapshot; a
per-candidate re-read genuinely could observe an admin's committed change
partway through one promotion. (An earlier version of the comment on this hoist
claimed the setting "cannot change inside a transaction" — that claim was
false and was corrected in `0157a3b`; this record does not repeat it.)

The hoist is deliberate for two reasons that are true:

1. **One pass, one rule.** Every candidate considered in a single promotion
   pass should be judged against the _same_ cap. Re-reading per candidate would
   let an admin who saves a new cap mid-loop have the earlier candidates in
   that same promotion measured against the old number and the later ones
   against the new — one promotion applying two different rules to
   equally-placed people in the same queue.
2. **One query instead of one per candidate**, in exactly the path whose query
   sequence `doc/decision/0307-*` already analyses for a `40P01` deadlock
   between `confirmOnce` and `cancel` + `promote`. Adding a query per candidate
   there is adding load to the one path already known to contend.

## That lowering the cap does not invalidate existing reservations

The cap binds **new** inserts only — `assertWithinMonthlyReservationCap` runs
as the last check before an insert, and nothing re-evaluates reservations that
already exist. Lowering `monthlyReservationCap` below a user's current count
for the month leaves their existing reservations exactly as they are; it only
stops them from adding another until the count is back under the new number
(or the month changes). There is no reconciliation job and none is needed —
the same "changing a setting doesn't retroactively touch existing rows"
posture `ReservationWindowSettings` already has for `openDaysBefore` and
`lockMode`.

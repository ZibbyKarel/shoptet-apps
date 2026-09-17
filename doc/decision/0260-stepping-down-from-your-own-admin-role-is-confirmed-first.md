# 0260 – Stepping down from your own admin role is confirmed first

## What

In `apps/garage/web/src/shell/admin/admin-users-screen/admin-users-screen.tsx`, switching the viewer's own
**Admin** switch *off* opens a `ConfirmDialog` instead of writing. Every other
combination — promoting anybody, demoting anybody else, the viewer granting
themselves the role back — is unchanged and immediate.

## Why

- **The two self-protections were asymmetric, and the wrong way round.** The
  viewer's own "Aktivní" switch is disabled, with a good explanation: deactivating
  yourself is how an admin loses their own session mid-task. Their own "Admin"
  switch was fully enabled, and `admin-users-screen.spec.tsx` pinned that as
  intended — yet demoting yourself takes `/správa` away (the tab disappears from
  the top bar and this screen stops rendering) and **only another admin can give
  it back**. One unlabelled click was the whole distance to that.
- **Disabling it would be wrong.** Stepping down is a legitimate thing to do, it
  does not end the session, and the API already refuses it for the last active
  admin (`UsersService.adminUpdate`, `CONFLICT`). The problem is not that it is
  possible; it is that it is instantaneous and unannounced.
- **Only the irreversible direction asks.** Granting is undone by the same
  switch, by the same person. Demoting somebody else is ordinary administration,
  is visible in the row afterwards, and is undone the same way.
- **The dialog says what is lost, not that something is.** "Přijdete o přístup do
  Správy. Vrátit vám roli může potom už jen jiný administrátor." — the second
  sentence is the one that makes the first worth reading.
- **`ConfirmDialog` is rendered unconditionally and closed by its `open` prop**,
  which is how that compound is built: it renders nothing when closed, and
  mounting it conditionally would remove the dialog in the same commit its
  confirm button is pressed.

## How

- `apps/garage/web/src/shell/admin/admin-users-screen/admin-users-screen.tsx` — one `useState`, one guard
  in the role switch's `onCheckedChange`, one `ConfirmDialog` at the foot of the
  rendered tree.
- `libs/shared/i18n/src/lib/messages.ts` — three new keys in `admin`
  (`usersSelfRoleConfirmTitle`, `…Description`, `…Action`) and their interface
  declarations. **This is the one file outside `apps/garage/web` this change touches**;
  it is an additive leaf in the `admin` namespace.
- `apps/garage/web/src/shell/admin/admin-users-screen/admin-users-screen.spec.tsx` — six tests: it asks
  and writes nothing; it names what is lost; it writes once confirmed; it writes
  nothing when cancelled and leaves the switch checked; it does not ask for
  self-promotion; it does not ask for somebody else's demotion. The pre-existing
  *"reports a promotion and a demotion"* test was re-pointed at a viewer who is
  neither row, which is what it was always about.

## Risk

- **A confirmation on a control the design does not draw one for.** The design
  draws no confirmation anywhere (`doc/decision/0071-*`), so the compound itself
  was already invented; this is a second use of it, for the same reason the
  first existed.
- **The API remains the enforcement.** Nothing here authorises anything: a
  browser that skips the dialog still meets `@Roles('ADMIN')` and the
  last-active-admin check.

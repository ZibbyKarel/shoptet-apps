# 0160 – The users table gets an "Aktivní" switch the design does not draw

## What

`apps/garage/web/src/shell/admin/admin-users-screen/admin-users-screen.tsx` renders **four** columns —
`Jméno`, `E-mail`, `Admin`, `Aktivní` — where
`doc/design/screens/03-admin-users.png` draws three. The fourth is a `Switch`
per row, wired to `admin.user.update({ id, active })`.

The switch on the signed-in admin's **own** row is disabled, with
`usersSelfActiveHint` ("Vlastní účet nelze deaktivovat.") as its `title`.

## Why

- **The task brief requires it.** Task 27 names the users tab as
  "`DataTable`, deaktivace, změna role". The design draws only the role half.
- **The contract already carries it, and nothing else can.**
  `adminUpdateUserInputSchema` picks exactly `{ role, active }` from
  `userSchema` — those two fields are, by construction, the only ones an admin
  may change — and `UsersService.adminUpdate` implements both, audits both, and
  guards both. Offboarding *is* `active: false`: a user row is never deleted,
  because `Reservation`, `WaitlistEntry` and `AuditLog` reference it with
  `ON DELETE RESTRICT` (`doc/decision/0027-*`). Without this column the product
  has an offboarding procedure with no way to reach it.
- **It is added in the design's own idiom, not as a new control.**
  `doc/design/screens/04-admin-spots.png` already has an `AKTIVNÍ` column drawn
  as exactly this switch, in exactly this position (right-aligned, last before
  the actions). Reusing it keeps the two admin tables looking like one product;
  inventing a "Deaktivovat" button or a row menu would not.
- **The disabled own-row switch is a courtesy, and is documented as one.**
  `UsersService.adminUpdate` refuses self-deactivation with `CONFLICT`
  regardless of what any browser sends, and refuses removing the last active
  admin. Hiding a control is never authorization
  (`apps/garage/api/src/orpc/orpc-pipeline.spec.ts` proves the server side over real
  HTTP). What the disabled switch buys is that the most likely mistake — a
  mis-click on the wrong row, whose cost is losing your own session mid-task —
  does not reach the API at all.

## How

- The column is `id: 'active'`, `align: 'end'`, `width: '120px'`, matching the
  `role` column beside it. Its `Switch` uses `tone="success"` (green), the tone
  the spots table's own activity switch uses; the `role` switch keeps the
  default blue, matching `03-admin-users.png`.
- Each switch carries an `aria-label` naming the person
  (`usersAdminToggleLabel` / `usersActiveToggleLabel`, e.g. "Aktivní účet —
  Adéla Horáková"). A bare switch in a table row has no accessible name from
  its column header, so without this a screen reader announces six identical
  "switch, on" controls.
- Both switches on a row are disabled while *either* is being written
  (`isRowBusy`), because they go through one procedure and a second call would
  race the first.
- Demoting **yourself** stays enabled. That is deliberate: the API allows it
  while another active admin remains, and the UI must not pre-empt a decision
  the server is willing to make.

## Risk

- **The screen now differs from its mock**, so a later visual comparison will
  flag it. Recorded here so the difference reads as a decision rather than a
  regression.
- **`viewerId` arrives from `me.get` and is `undefined` while that is in
  flight**, so for a moment the own-row switch is enabled. Pressing it in that
  window sends a request the API refuses with `CONFLICT`, and the screen shows
  `errUserConflict` — a worse sentence than the disabled state, but not a wrong
  outcome. Blocking every row until the profile lands would be a worse trade
  for a window measured in milliseconds.

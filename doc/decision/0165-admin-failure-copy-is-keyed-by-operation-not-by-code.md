# 0165 – Admin failure copy is keyed by (operation, code), not by code alone

## What

`apps/garage/web/src/shell/admin/admin-errors.ts` holds a table from an **admin write**
(`userUpdate`, `spotCreate`, `spotRename`, `spotRetire`, `spotRevive`,
`windowUpdate`) and a contract `ErrorCode` to a message key in the `admin`
namespace, plus a per-operation fallback.

The admin screens use `useAdminWriteError(write, failure)`. They do **not** use
the `errors` namespace, which translates a code with no other context.

## Why

- **The same code means different things on different procedures.** `CONFLICT`
  is the clearest case:

  | procedure | what `CONFLICT` is |
  | --- | --- |
  | `admin.user.update` | the last active administrator would be gone |
  | `admin.spot.create` | the label is already painted on another spot |
  | `admin.spot.update` | a duplicate label **or** a spot somebody still holds |
  | `admin.spot.deactivate` | somebody holds the spot from today onwards |
  | `admin.window.update` | a concurrent write, nothing the client caused |

  One sentence covering all five would have to be vague enough to explain none
  of them — which is what `errors.CONFLICT` ("Někdo jiný mezitím provedl stejnou
  změnu") already is.

- **`errors.VALIDATION_FAILED` is actively wrong on this screen.** It reads
  "Požadavek porušuje pravidlo rezervací (např. víkend nebo svátek)." — true of
  a booking, nonsense next to a role switch, a spot rename or a day stepper.

- **A table can be checked against the contract; a chain of `if`s cannot.**
  `admin-errors.spec.tsx` reads each admin procedure's declared error map off
  `libs/garage/contract` and asserts the table has a sentence for every code the
  procedure can raise. Adding an error code to a procedure fails that test until
  the copy is written.

## How

- **`admin.spot.update` is three operations, not one.** Renaming, switching a
  spot off, and switching one on all go through it, and its `CONFLICT` means
  something different in each. The response cannot say which was intended, so
  the *caller* records it: `AdminSpotsPanel.startWrite(write, spotId)` stores the
  intent when the call is made, and `writeErrorFrom` travels with `writeError`.
- **`spotRevive` maps no `CONFLICT` on purpose.** Turning a spot back on
  collides with nothing — `SpotsService.update` only checks reservations on the
  way *off*, and the label is unchanged. Falling back is the honest answer;
  reusing the duplicate-label sentence would be inventing a cause.
- **The fallback never guesses.** An unmapped code, or a transport failure with
  no code at all, gets `errFallback*`: "it did not save, try again". True of
  anything unexpected, and it never leaks the thrown error's own message.
- **`FORBIDDEN` is spread into every row.** Every authenticated procedure
  inherits it (`authed` in `libs/garage/contract/src/api/errors.ts`), and it is the one
  code whose meaning does not change with the operation.
- Every mutation resets the previous failure before starting
  (`updateUser.reset()`, `startWrite`), so a mutation that failed once cannot
  keep its `error` and render a stale sentence over a later success.

## Risk

- **The mapping is a claim about the backend that the type system does not
  check.** Nothing stops `UsersService` from raising `CONFLICT` for a new
  reason that `errUserConflict` does not describe. The comment on the
  `userUpdate` row names the one currently-unreachable case
  (self-deactivation, blocked by the disabled switch) so that removing that
  guard is visibly a copy change too.
- **Six operations is already a list to keep in step with the contract.** The
  spec's "covers every code the admin procedures can raise" test is what keeps
  it honest; a seventh admin write added without a row will fail it.

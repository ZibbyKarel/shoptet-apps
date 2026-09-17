# 0258 – The bulk modal is keyed on its opening rather than reset in an effect

## What

`BulkReservationModal` is now a two-line wrapper that renders
`BulkReservationModalContent` with `key={`${open}-${month}`}`. The
`useEffect(..., [open, month])` that cleared `selected`, `proposal`, `result`
and `failure` is gone.

## Why

- **A passive effect runs after paint.** The render in which `open` flipped back
  to `true` still saw the previous run's `result` and took the result branch, so
  reopening the modal flashed the last batch's outcome before the day grid
  appeared.
- **The effect also reset less than it looked like it did.** It cleared four
  `useState`s and nothing else. The `previewBulk` and `confirmBulk` mutations
  kept their own state, so a modal closed while a proposal request was in flight
  reopened with its primary button already spinning (`loading={previewBulk.isPending}`)
  and every day locked (`pending`), and nothing would ever land to clear it. That
  is the part of this a test can see, and it is what the new test asserts.
- **A key fixes it by construction rather than by ordering.** React discards the
  subtree and mounts a fresh one: there is no state left to flash, no mutation
  left in flight, and no effect whose timing has to be right.
- **`useLayoutEffect` was the other option offered and was not taken.** It runs
  before paint and would have closed the flash, but `LotScreen` is a client
  component that Next.js still prerenders on the server, where React warns that
  `useLayoutEffect` does nothing — a warning on every render of `/`, for a
  problem a key solves outright.
- **The month is in the key as well as `open`.** The contract refuses a batch
  spanning two months, so a day left over from another month would turn the next
  confirmation into `VALIDATION_FAILED`. `LotScreen` also closes the modal when
  the day moves, so this half is belt and braces — cheap, and it is the rule
  this file actually depends on rather than one it borrows from its caller.

## How

`apps/garage/web/src/lot/bulk-modal/bulk-modal.tsx`. `apps/garage/web/src/lot/bulk-modal/bulk-modal.spec.tsx` gains
*"does not carry an in-flight proposal request into the next opening"*: start a
preview that never resolves, close, reopen, and the primary button is the
resting `Vyberte dny` with no `aria-busy`, and selecting a day re-enables it.

## Risk

- **Every opening is a fresh mount**, so `spot.list` re-subscribes. It is a
  cached query with no side effects, and it was already gated on `open`.
- **Nothing may now rely on state surviving a close.** Nothing does; the
  pre-existing test *"forgets the selection between two openings"* asserted the
  same thing about the half the effect did cover, and still passes.

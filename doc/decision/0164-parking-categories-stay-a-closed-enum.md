# 0164 – Parking categories stay a closed enum; the band counts, it does not edit

## What

`doc/design/screens/04-admin-spots.png` draws a "KATEGORIE" band with removable
chips (`IT ×`, `Shared ×`), a "Nová kategorie" text field and a "Přidat
kategorii" button.

The implemented band (`CategoryBand` in `category-band.tsx`) renders one
chip per category with its count, and one sentence:

> Kategorie jsou pevně dané — IT a Shared.

There is no add field, no remove ×, and no button.

## Why

- **A category is not data, it is a type.** `PARKING_GROUPS = ['IT', 'SHARED']`
  is a `const` tuple in `libs/garage/shared-types/src/lib/domain-constants.ts`. Every
  layer is built on it: `libs/garage/contract` derives `parkingGroupSchema` with
  `z.enum(PARKING_GROUPS)`, Prisma has it as a Postgres `enum` column, and
  `apps/garage/api` filters and orders by it.
- **So "Přidat kategorii" is not a feature that was skipped — it is one that
  cannot exist without a migration.** Adding a value at runtime would need a
  `ParkingGroupCategory` table, a foreign key from `ParkingSpot`, a data
  migration, contract changes to every procedure that mentions `group`, and a
  rule for what happens to spots in a category somebody removes. That is a task,
  not a control.
- **Rendering the control anyway would be the worse option.** A field that
  accepts text and a button that does nothing is a promise the product cannot
  keep; a control wired to a procedure that does not exist is not shippable at
  all. Saying the list is fixed is at least true.
- **The counts are the part of the band that is real and useful.** "IT 4 ·
  Shared 5" answers the question the chips were there to answer — how the lot is
  split — and it comes free from the rows already loaded.

## How

- `CategoryBand` maps `PARKING_GROUPS`, so a value added to the tuple appears
  here with no edit to this file.
- It counts **every listed spot**, retired ones included, because the table
  lists them too. A count that quietly excluded them would disagree with the
  rows underneath it.
- It is a `role="group"` named by its own caption. Two things on this screen are
  called "Kategorie" — this band and the table's column header — and without the
  named group neither a screen reader nor a test can tell them apart.
- The row-level category picker is a `Select` over the same tuple. Because the
  options *are* the enum and the stored value is typed as a member of it, the
  select's displayed value can never fall outside its own options — the failure
  mode where a control shows one thing and holds another is structurally absent
  here, and `admin-spots-screen.spec.tsx` pins the option list to the enum.

## Risk

- **The design and the screen disagree, visibly.** A reviewer comparing them
  will see three missing controls. That is the point of this record.
- **If categories ever do become data**, this band is where the editing UI goes,
  and `CategoryBand`'s `PARKING_GROUPS` iteration becomes a fetched list. The
  sentence `spotsCategoriesFixed` is the marker to delete.

## Re-read against the design, fix round 1

Reopened `04-admin-spots.png`: it draws `IT 4 ×`, `Shared 5 ×`, a
`Nová kategorie` field and a `Přidat kategorii` button — three controls, all
absent here. The premise is unchanged and so is the conclusion:

- `PARKING_GROUPS` is a `const` tuple in `libs/garage/shared-types`, `parkingGroupSchema`
  is `z.enum(PARKING_GROUPS)`, and Prisma has it as a Postgres enum. Adding a
  category needs a migration, a contract change and a deploy. There is no
  procedure any of those three controls could call.
- Shipping them anyway would mean a text field that discards what is typed and
  an `×` that does nothing — a worse answer to "can I add a category?" than the
  sentence that says no.

**Unchanged.** This is a product decision, not a code fix: if categories should
be data, that is a schema change and a task of its own.

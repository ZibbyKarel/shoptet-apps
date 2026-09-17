# @garage/contract

The single source of truth for every shape that crosses the FE ↔ BE boundary.
No endpoint, DTO or realtime event may exist in code before it exists here.

- `src/schemas/` — shared Zod entity schemas, primitives and the error contract
  (Task 3).
- `src/api/` — oRPC procedures, entry point `@garage/contract` (Task 4).
- `src/realtime/` — Socket.io event payload schemas, entry point
  `@garage/contract/realtime` (Task 5).

Types are always derived with `z.infer`, never hand-written alongside a schema.
Allowed npm dependencies are limited by ESLint to `zod`, `@orpc/contract` and
`tslib` — the contract must never reach for a transport.

Documentation: `doc/contract.md`.

## Tests

```bash
npx nx run contract:test
```

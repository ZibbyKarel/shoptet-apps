# 0023 – Realtime is a separate entry point, and its event maps are derived from a registry

## What

`@garage/contract/realtime` is a **second entry point** of the same lib, not
a section of the first one:

- `libs/garage/contract/src/realtime/*` imports nothing from `src/api`,
- the root `libs/garage/contract/src/index.ts` does **not** re-export realtime,
- the alias `@garage/contract/realtime` lives in `tsconfig.base.json`,
- isolation is guarded by `src/realtime/no-orpc.spec.ts`, which walks the
  actual module graph.

`ServerToClientEvents` and `ClientToServerEvents` are **not hand-written**.
They are mapped types over the runtime registries
`SERVER_TO_CLIENT_EVENT_SCHEMAS` and `CLIENT_TO_SERVER_EVENT_SCHEMAS`, so every
payload type is a `z.infer`.

## Why

**Why two entry points at all.** `@garage/contract` pulls in
`@orpc/contract`. A browser bundle that only opens a socket, or the Socket.io
gateway, gets nothing out of that — and worse, a single barrel would spread
that dependency everywhere a realtime type is touched. The shared shapes stay
shared, though: both branches take their schemas from `src/schemas`, nothing
is duplicated (global constraint 1). That's why `userSummarySchema` and
`publicReservationSchema` moved into `schemas/entities.ts` too — both the
day overview and the broadcast need them, and `realtime` must not reach into
`api`.

**Why ESLint alone can't guard this.** `@orpc/contract` is an allowed package
for `type:contract` (the API half needs it), and `@orpc/client` is physically
installed in the repo. Nx module boundaries therefore **let through** an
`@orpc/*` import from `src/realtime`. The only honest proof is the module
graph.

**Why a test with its own check.** A walker that finds nothing due to a bug
would pass on an empty result — exactly the kind of green result this test
exists to catch. That's why the same walker must **find** `@orpc/contract` in
`api/index.ts`; if it doesn't, the suite fails. It also checks that the graph
reaches further than the entry file, and that an unrecognized specifier
throws instead of being silently skipped. Both were verified in reverse too: a
temporary import of `@orpc/contract` into `realtime/events.ts` broke two
tests, and a temporary import from `../api/errors` broke three.

**Why the maps are derived.** Socket.io types a connection with a map whose
values are **function types** (`(payload) => void`), and a function type is
the one thing Zod can't describe — it's the only part of the contract that
isn't itself a schema. A hand-written map, though, would be a second source of
truth alongside the schemas and could drift from them. A mapped type over the
registry solves that: adding an event is one line in the registry, and from
it follow both the runtime validation table for the gateway and the
compile-time handler signature. **Registering an event and forgetting to
validate it isn't expressible** — and that's exactly what makes the rule
"the server always validates incoming client→server events" total, not
aspirational.

## How

`event-maps.ts` holds three constants: the outbound schema registry, the
inbound schema registry, and `CLIENT_TO_SERVER_ACK_SCHEMAS` for the subset of
commands that respond with an ack (today only `cell:lock`). The
`ClientToServerEvents` map is a conditional mapped type: a key from the ack
registry gets a second argument, `(result) => void`; the others don't.

Inbound payloads are `z.strictObject` — an unknown key is rejected, not
dropped. Outbound stays lenient (unknown keys are stripped), because the
client must tolerate a server deployed ahead of it; the server has no such
obligation toward the client.

The alias is tested indirectly (`entry-point.spec.ts` reads
`tsconfig.base.json` and pins the target), because a project must not reach
its own sources through its own alias — `@nx/enforce-module-boundaries`
forbids that, correctly, since such an import can be used to launder cycles.

## Risk

**The alias is only tested declaratively.** Whether
`@garage/contract/realtime` actually resolves in Jest and in a Next.js
build is first verified in Tasks 15 and 24. The test here only guarantees the
alias exists and points at an existing file — not that every resolver
understands it. If one doesn't, that shows up immediately on the consumer's
first import, not silently.

**The walker is a regex, not an AST.** It watches specifiers in `import` /
`export … from` / `require`, and it deliberately over-matches — a specifier
inside a comment would trigger it too. That's the safe direction (it fails
falsely, never passes falsely), but it means a comment written as
`from "@orpc/x"` with quotes would trip the test. Today's comments use
backticks, so it doesn't matter; if it ever does, the fix is an AST walk, not
loosening the rule.

**The registries and maps sit in one file with a conditional mapped type.**
The construction is dense, and adding a second ack will require reading it
carefully. The alternative (a hand-written interface) is more readable and
drifts silently — a worse property than density.

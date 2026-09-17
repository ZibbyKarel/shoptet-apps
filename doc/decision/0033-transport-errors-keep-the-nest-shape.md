# 0033 – Transport errors keep Nest's shape; unknown errors return a bare 500

**Date:** 2026-08-28 · **Status:** accepted · **Follows on from:** `doc/decision/0018-*`,
`doc/decision/0032-*`

## What

The global filter (`apps/garage/api/src/common/filters/contract-exception.filter.ts`) returns
**two different body shapes**, depending on whether it's a domain error or not:

1. **A domain error** (`DomainError`, a mapped Prisma error) → oRPC error JSON:
   `{ defined: false, code, status, message, data? }`, where `code` is a member of the
   closed `ERROR_CODES` enum, and `status` and `message` come from `ERROR_DEFINITIONS`.
   `data` is the contract's `details`, under the name oRPC uses for the same field
   (`doc/decision/0018-*`). `defined` is always `false` – an error that made it this far is,
   by definition, one the procedure didn't declare.
2. **Everything else** (an unmatched route, a request dropped by the throttler, a body over
   the limit, an unknown exception) → Nest's shape: `{ statusCode, message }`.

An unexpected error – anything that's neither a `DomainError`, a mapped Prisma error, nor an
`HttpException` – returns the **constant** body `{ statusCode: 500, message: 'Internal
server error' }`. An `HttpException` with a status ≥ 500 gets overwritten with that same
body.

There is a **single exception** to the rule "a 5xx body gets overwritten": the result of the
health check from `@nestjs/terminus` (503). That one is passed through unchanged – it's
built from our own indicators' return values, contains no `Error` and no stack, and *is* the
point of that endpoint. A probe whose body says "internal server error" tells an operator
nothing.

And two things that aren't `HttpException`, so the filter has to recognize them explicitly:

- **`http-errors` errors raised before routing** – in practice, `PayloadTooLargeError` from
  the body parser. Recognized by the `expose === true` flag, which `http-errors` itself uses
  to mark messages safe for the client (it sets this for 4xx, not for 5xx). Returns
  `{ statusCode, message }` at the original status, i.e. 413.
- **the terminus result** – see above.

**The stack trace is always logged and never sent.** Every branch builds its body from a
fixed set of fields; the original error only reaches `this.logger`.

## Why

**Why domain errors get the oRPC shape.** The frontend reads errors through the oRPC client,
and it understands exactly one shape – `ORPCErrorJSON`, i.e. `Pick<ORPCError,
'defined'|'code'|'status'|'message'|'data'>` (verified in
`node_modules/@orpc/client/dist/index.d.mts`, not from memory). If the filter sent its own
shape, the frontend would have two paths for handling errors – one for errors the procedure
declared, another for ones that fell through into the filter. That's exactly the split a
contract-first approach avoids.

**Why transport errors, conversely, don't get that shape.** The `ERROR_CODES` enum is closed
(`doc/decision/0016-*`) and doesn't – and shouldn't – have a member for "route doesn't exist"
or "too many requests". Inventing a code for them would mean opening the enum to things that
aren't domain errors, and that the client handles no differently than by HTTP status. Nest
already has its own established shape for them; that's enough.

**Why an unknown error returns a constant.** `error.message` from an unhandled exception can
contain a connection string, a filesystem path, a piece of SQL, or the name of an internal
function. Passing it through into the response "because it's useful for debugging" means
debugging on production through an attacker's browser. What's useful for debugging is the
log – the error goes there in full, including the stack and the `x-request-id` it can be
looked up by.

**Why even `HttpException` with a status ≥ 500 gets overwritten.**
`InternalServerErrorException(err.message)` is a common pattern, and just as commonly leaks
an internal detail into the message. Status 5xx is the line past which the body isn't
trusted.

**Why the exception for terminus is narrow.** "Pass through object bodies" isn't enough on
its own – `new InternalServerErrorException('connect ECONNREFUSED 10.0.0.7:5432')` also has
an object body (`{statusCode, message, error}`), and that's exactly the leak the rule
guards against. So the exception instead tests the terminus result's specific shape
(`status` ∈ `ok|error|shutting_down` plus object-valued `info`, `error`, `details`) **and**
that it's a `ServiceUnavailableException`. The test `still replaces an ordinary 5xx body` in
`contract-exception.filter.spec.ts` guards against that gap widening.

**Why `expose`, and not just the status.** Deciding by "is it a 4xx" would mean sending out
the message of any third-party library that happens to carry a 4xx. `expose` is
`http-errors`' own contract for "this message is safe to show the client"; relying on it is
cheaper and more honest than a list of allowed error types.

## How

```ts
const INTERNAL_ERROR_BODY = { statusCode: 500, message: 'Internal server error' };
```

The filter is registered via `{ provide: APP_FILTER, useClass: ContractExceptionFilter }` in
`AppModule`, not via `app.useGlobalFilters()` in `main.ts` – so tests that only bootstrap the
module get it too.

Tests in `contract-exception.filter.spec.ts` include, among other things, a **sweep over six
kinds of failure** that checks that the topmost stack frame never appears in the serialized
body. It's extracted as `failure.stack.split('\n')[1]` and compared exactly – a naive
`not.toContain('at ')` gives a false alarm, because `'at '` is a substring of the English
text in `ERROR_DEFINITIONS` (`"…for th`**`at `**`day."`).

## Risk if this is wrong

Two body shapes mean the frontend has to be able to tell which one it got. The
distinguishing feature is the presence of the `code` field; if someone added `code` to the
transport branch "for consistency", the frontend would start treating it as a member of
`ERROR_CODES` and hit a value the enum doesn't know. The transport body therefore **must
not** have `code`.

The second risk runs the other way: adding an extra field to the domain branch (say,
`timestamp` or `path`). The oRPC client parses `ORPCErrorJSON` and drops extra fields – so it
would look harmless, except that information would never arrive anywhere.

**A third risk, and this has already happened once:** this filter is the last link in the
chain, so its behavior **cannot be verified by a test that calls the controller method
directly**. The first version of this decision claimed that a body over the limit returned
413, and that the terminus body passed through – both written from reasoning, and both were
wrong (413 was returned as 500, the terminus body was overwritten with the constant). Only a
real HTTP request exposed it. That's why `apps/garage/api/src/app/http-pipeline.spec.ts` exists,
firing requests against the built application, wired through the same `configureApp`
function as `main.ts` – **any further claim about the filter's behavior belongs verified
there**, not reasoned about.

# 0259 – The web app's CSP omits `script-src` and `connect-src`, on purpose

## What

`apps/garage/web/next.config.ts` sets `poweredByHeader: false` and a `headers()` rule
matching `/:path*` that sends `Content-Security-Policy`, `X-Frame-Options`,
`X-Content-Type-Options` and `Referrer-Policy`. The policy is:

```
base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'
```

## Why

- **There were no security headers at all.** `next.config.ts` set `output` and
  `outputFileTracingRoot` and nothing else, so the app could be framed, would be
  sniffed, leaked its full path as a referrer cross-site, and announced the
  framework.
- **Every directive shipped is one that cannot break this application, and that
  is the design.** `frame-ancestors 'none'` is the clickjacking control;
  `base-uri 'self'` stops an injected `<base>` re-pointing every relative URL;
  `object-src 'none'` retires the plugin surface; `form-action 'self'` keeps a
  form from posting elsewhere. The Okta hand-off is a navigation, not a form
  post, so sign-in is unaffected.
- **`script-src` is omitted because a nonce-less one would be theatre.**
  Next.js injects its own inline bootstrap and RSC-payload `<script>` tags into
  every document. Without a per-request nonce the directive has to carry
  `'unsafe-inline'`, which reads strict and stops nothing. A real nonce has to
  be minted in middleware — and this app's middleware is `src/proxy.ts`, where
  authentication is decided. Threading a nonce through it is a change to the
  auth path, not a header tweak.
- **`connect-src` is omitted because a wrong one fails silently and remotely.**
  `headers()` is resolved into `routes-manifest.json` at **build** time, while
  `NEXT_PUBLIC_API_URL` is supplied at run time. A policy baked from the
  builder's environment would refuse every oRPC call and the Socket.io handshake
  in any deployment whose API origin differs — in the browser, with nothing in a
  server log.
- **`default-src` is omitted for the same reason**: it would supply exactly the
  `script-src` and `connect-src` values above by fallback.
- **`X-Frame-Options: DENY` alongside `frame-ancestors`.** They say the same
  thing; browsers that understand both prefer the CSP, and the legacy header
  covers anything that does not.
- **Applied to `/api/*` too.** An `X-Content-Type-Options` on the HTML and not
  on the JSON is the half of this worth the least.

## How

`apps/garage/web/next.config.ts`. `apps/garage/web/src/security-headers.spec.ts` asserts the
rule matches every path and carries each header, and — the load-bearing one —
asserts the *absence* of `script-src`, `connect-src`, `default-src` and
`unsafe-inline`, so anyone adding either directive has to come to that test and
say why.

## Risk

- **The test asserts configuration, not a live response**, and says so in its
  own header. Next.js serves the manifest; what this workspace can hold is that
  the rule exists and says the right thing.
- **The upgrade path is a nonce in `src/proxy.ts`**, which would let
  `script-src 'self' 'nonce-…'` and a real `default-src` be added. That is a
  change to the authentication middleware and belongs in its own task.

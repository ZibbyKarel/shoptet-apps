# 0262 – `global-error` re-establishes the one provider it can

## What

`apps/garage/web/src/app/global-error.tsx` renders its own `<html lang="cs">` and
`<body>`, imports `./global.css`, wraps the page in `IntlProvider`, and shows
`ScreenError` with `reset` as its retry.

## Why

- **Nothing caught a throw from the root layout.** `app/error.tsx` covers pages
  and nested layouts, but a throw from `RootLayout` happens above that boundary
  and only `global-error` catches it. There was no such file.
- **The path is real, not theoretical.** `app/layout.tsx` does `await auth()`,
  and Auth.js throws on a session cookie encrypted with an `AUTH_SECRET` that has
  since been rotated. Every visitor holding a stale cookie hits it at once —
  which is exactly the moment the app should not be speaking English. Without
  this file they get Next.js's built-in error page.
- **It replaces the root layout**, so the document, the stylesheet and the
  providers all have to be re-established by it or not exist.
- **The copy still comes from the catalogue.** `IntlProvider` carries its own
  locale, time zone and messages (`libs/shared/i18n/src/lib/provider.tsx`) and asks
  nothing of a server, so it is the one provider that *can* be re-established
  here — and re-establishing it keeps the Czech-UI rule without adding a second
  hard-coded Czech string to the app. The others (session, query, socket) are
  deliberately absent: this screen calls no API.
- **Nothing about the error is rendered**, for the same reason as
  `app/error.tsx`: `ScreenError` keys its copy off the contract's error code and
  falls back to one generic Czech sentence, so no `message`, no stack and no
  `digest` reaches the page. The full error stays in the server log.

## How

`apps/garage/web/src/app/global-error.tsx` and `global-error.spec.tsx`. The spec asserts
the two catalogue strings appear (which is what proves the provider is really
re-established rather than the sentences having been inlined), that neither the
error's message nor its digest is anywhere in the body, that the retry calls
Next.js's `reset`, and that the document is declared Czech.

## Risk

- **`global-error` is only exercised in production builds** — in development
  Next.js shows its own overlay first. The unit spec is therefore the coverage,
  and it renders the component directly.
- **React 19 applies `<html>`/`<body>` to the document's existing nodes** rather
  than nesting new ones, which is why the `lang` assertion reads
  `document.documentElement`. The spec filters the resulting nesting warning and
  says why.

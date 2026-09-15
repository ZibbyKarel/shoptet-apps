import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GlobalError from './global-error';

/**
 * The translated UI at the one moment nothing else is working.
 *
 * A throw from `RootLayout` — `await auth()` on a cookie encrypted with a
 * rotated `AUTH_SECRET` is the realistic one — is caught by nothing but
 * `global-error`, because it happens above `error.tsx`'s boundary. Without
 * this file the visitor gets Next.js's built-in English page.
 *
 * The file renders its own `<html>`/`<body>`, which is what makes it a
 * replacement for the root layout rather than a screen inside it. React warns
 * about the nesting when it is mounted inside jsdom's existing document; the
 * warning is an artefact of the harness, not of the component, and the
 * assertions below are about what the visitor reads either way.
 *
 * Because it replaces the root layout, no server-resolved locale reaches it:
 * it negotiates from `navigator.language` (`libs/shared/i18n`'s `negotiateLocale`).
 * jsdom reports `en-US`, so every spec about the Czech copy has to say which
 * browser it is pretending to be — {@link setBrowserLanguage}.
 */

/**
 * What the browser claims to prefer, for one test.
 *
 * `navigator.language` is a prototype getter in jsdom, so it is replaced
 * rather than assigned; `configurable` keeps `beforeEach` able to put the next
 * value in place.
 */
function setBrowserLanguage(language: string) {
  Object.defineProperty(window.navigator, 'language', { value: language, configurable: true });
}

const originalLanguage = Object.getOwnPropertyDescriptor(window.navigator, 'language');

const originalError = console.error;

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('<html>')) return;
    originalError(...args);
  };
});

afterAll(() => {
  console.error = originalError;
  if (originalLanguage) {
    Object.defineProperty(window.navigator, 'language', originalLanguage);
  }
});

function boom() {
  return Object.assign(new Error('JWEDecryptionFailed: decryption operation failed'), {
    digest: '1234567890',
  });
}

describe('global-error', () => {
  beforeEach(() => {
    setBrowserLanguage('cs-CZ');
  });

  it('speaks Czech, from the catalogue, with no provider above it', () => {
    render(<GlobalError error={boom()} reset={jest.fn()} />);

    // Both strings are `shell.errorTitle` / `shell.errorUnknown` in
    // `messages/cs.json`. Finding them proves the one provider this screen can
    // re-establish — `IntlProvider`, handed the catalog the file imports
    // statically — really is re-established, rather than the file having
    // hard-coded the sentences.
    expect(screen.getByText('errorTitle')).toBeInTheDocument();
    expect(screen.getByText('errorUnknown')).toBeInTheDocument();
  });

  it('never puts the error, its message or its digest on the page', () => {
    render(<GlobalError error={boom()} reset={jest.fn()} />);

    expect(document.body.textContent).not.toContain('JWEDecryptionFailed');
    expect(document.body.textContent).not.toContain('decryption operation failed');
    expect(document.body.textContent).not.toContain('1234567890');
  });

  it('offers the retry, wired to Next.js’s own reset', async () => {
    const reset = jest.fn();
    render(<GlobalError error={boom()} reset={reset} />);

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('declares the document language, because it replaces the root layout', () => {
    // React 19 renders `<html>`/`<body>` by applying them to the document's
    // existing nodes rather than nesting new ones, so the attribute lands on
    // `document.documentElement` — which is exactly where it has to be in the
    // browser for a screen reader to read the page as Czech.
    render(<GlobalError error={boom()} reset={jest.fn()} />);

    expect(document.documentElement).toHaveAttribute('lang', 'cs');
  });

  it('speaks English when the browser asks for it', () => {
    // The counterpart of the first spec, and the reason the outer `beforeEach`
    // exists: with an English-speaking browser the same screen renders
    // `messages/en.json`. Asserting the copy — not only `<html lang>` — is what
    // proves the second catalog is wired to this file rather than merely
    // imported by it.
    setBrowserLanguage('en-US');

    render(<GlobalError error={boom()} reset={jest.fn()} />);

    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(screen.getByText('errorTitle')).toBeInTheDocument();
    expect(screen.getByText('errorUnknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });

  it('negotiates that language in the browser, because no server resolved one', () => {
    // The rule itself is `negotiateLocale`'s and is tested in `libs/shared/i18n`;
    // what this asserts is that this screen — the one place in the app that
    // has to ask the browser — actually asks it.
    setBrowserLanguage('de-DE');

    render(<GlobalError error={boom()} reset={jest.fn()} />);

    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });
});

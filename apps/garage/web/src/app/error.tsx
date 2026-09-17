'use client';

import { Container } from '@garage/design-system/primitives';
import { ScreenError } from '../shell/screen-state/screen-state';

/**
 * The last line of defence: anything a page or a layout throws lands here.
 *
 * **Nothing about the error is rendered.** `ScreenError` keys its copy off the
 * contract's error code and falls back to one generic Czech sentence for
 * everything else; the `Error` object's own `message` never reaches the page.
 * That is deliberate and matches what Next.js does in production anyway — it
 * replaces a server-side error's message with a `digest` before it crosses to
 * the client, precisely so a stack or a query string cannot leak. The full
 * error stays in the server log.
 *
 * `reset()` re-renders the segment, which is what `ScreenError`'s retry runs.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main>
      <Container padding={[16, 4]}>
        <ScreenError error={error} onRetry={reset} headingLevel={2} />
      </Container>
    </main>
  );
}

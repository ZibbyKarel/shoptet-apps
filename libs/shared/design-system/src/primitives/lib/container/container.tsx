import { forwardRef, type HTMLAttributes } from 'react';

import { cx } from '../cx';
import { type Padding, resolvePadding } from '../padding';

export type ContainerMaxWidth = 'base' | 'wide';

/**
 * Consumed as an arbitrary-value class, not `max-w-container`/`max-w-container-wide`:
 * `theme.css` deliberately does not map `--container`/`--container-wide` into
 * Tailwind's `@theme`, because its `--container-*` namespace is reserved for
 * `@container` query breakpoints, a different concept from a content
 * max-width. `max-w-[var(--container)]` is the documented way to consume
 * these two tokens — see the comment above `@theme inline` in `theme.css`.
 */
const MAX_WIDTH_CLASSES: Record<ContainerMaxWidth, string> = {
  base: 'max-w-[var(--container)]',
  wide: 'max-w-[var(--container-wide)]',
};

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Content width cap. Defaults to `base`. */
  maxWidth?: ContainerMaxWidth | undefined;
  /**
   * Defaults to `[8, 4]` → `py-8 px-4`, matching `app/(app)/layout.tsx:26`.
   * The other 3 call sites this replaces use `py-16` instead — see the spec's
   * default; a caller on one of those 3 passes `padding={[16, 4]}` explicitly.
   */
  padding?: Padding | undefined;
}

/**
 * Centered, width-capped content wrapper, replacing 4 near-identical
 * `mx-auto w-full max-w-[var(--container)] px-4 py-*` occurrences in
 * `apps/garage/web` — identical but for `py-*`: `app/(app)/layout.tsx:26` uses
 * `py-8`, while `app/error.tsx:26`, `app/global-error.tsx:51` and
 * `app/not-found.tsx:24` all use `py-16`.
 */
export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { maxWidth = 'base', padding = [8, 4], className, children, ...rest },
  ref
) {
  return (
    <div
      {...rest}
      ref={ref}
      className={cx(
        'mx-auto w-full',
        MAX_WIDTH_CLASSES[maxWidth],
        resolvePadding(padding, 'p'),
        className
      )}
    >
      {children}
    </div>
  );
});

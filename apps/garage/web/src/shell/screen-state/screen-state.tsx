'use client';

/**
 * The three states every screen has to be able to be in, written once.
 *
 * `plan.md` (Fáze 6, point 3) requires each screen to define a loading, an
 * empty and an error state, and requires a contract error code to reach the
 * user as a sentence rather than an enum name. These are those pieces —
 * composed, not invented: the empty and error states are the design system's
 * `EmptyState` compound, and the retry control is its `Button` primitive.
 *
 * They live in app code rather than in `libs/shared/design-system/src/compounds` because
 * they carry domain knowledge the design system must not: `ScreenError` reads
 * a **contract** error and translates a member of the contract's closed error
 * enum. `EmptyState` itself stays domain-free, which is why it is imported
 * here rather than extended there.
 */

import type { ReactNode } from 'react';
import { Box, Button, Spinner, Stack, Text } from '@garage/design-system/primitives';
import { EmptyState } from '@garage/design-system/compounds';
import type { EmptyStateHeadingLevel } from '@garage/design-system/compounds';
import { toContractError } from '@garage/api-client';
import { useTranslations } from '@garage/i18n';

export interface ScreenLoadingProps {
  /** Overrides the default "Načítá se…". */
  readonly label?: string;
}

/**
 * A screen waiting for its first data.
 *
 * `role="status"` with the default `aria-live="polite"` is what makes the
 * spinner an announcement rather than a decoration: a screen reader says the
 * label when this appears, and says the screen's content when it is replaced.
 * The spinner itself is `aria-hidden`, because the label already says it.
 */
export function ScreenLoading({ label }: ScreenLoadingProps) {
  const t = useTranslations('shell');
  const text = label ?? t('loading');

  return (
    // `Box` supplies the `py-16 px-6` padding — `Stack` has no padding prop
    // of its own, so the two layers split the job the way `Card`/`Container`
    // already do elsewhere (padding on an outer `Box`/`div`, layout on the
    // flex child). `role="status"` stays on the `Stack`: that is the element
    // whose accessible content changes when this state is replaced.
    <Box padding={[16, 6]}>
      <Stack role="status" align="center" justify="center" spacing={3}>
        {/*
         * `Spinner size="md"` is byte-identical to the hand-rolled ring this
         * used to be (`size-6 animate-spin rounded-cta border-2 border-border
         * border-t-brand-blue`), now owned by the design system.
         */}
        <Spinner size="md" />
        <Text as="span" size="sm" tone="subtle">
          {text}
        </Text>
      </Stack>
    </Box>
  );
}

export interface ScreenErrorProps {
  /**
   * Whatever the failing call threw. Read through `toContractError`, so a
   * domain failure becomes one of the contract's codes and anything else — a
   * dropped connection, a 500, a bug — falls back to the generic sentence.
   */
  readonly error: unknown;
  /** Rendered as a "Zkusit znovu" button when supplied. */
  readonly onRetry?: () => void;
  /** See `EmptyStateProps.headingLevel`: only the page knows its own outline. */
  readonly headingLevel?: EmptyStateHeadingLevel;
}

/**
 * A screen whose data could not be loaded.
 *
 * The message is keyed off the **code**, never off the error's own `message`:
 * a contract error's `message` field is developer-facing English by design
 * (`libs/garage/contract/src/api/errors.ts`), and a transport failure's message is a
 * stack-adjacent string that has no business on a page. Neither is ever shown.
 */
export function ScreenError({ error, onRetry, headingLevel }: ScreenErrorProps) {
  const t = useTranslations('shell');
  const errors = useTranslations('errors');
  const contractError = toContractError(error);

  return (
    <EmptyState
      title={t('errorTitle')}
      description={contractError === null ? t('errorUnknown') : errors(contractError.code)}
      {...(headingLevel === undefined ? {} : { headingLevel })}
      {...(onRetry === undefined
        ? {}
        : {
            action: (
              <Button variant="secondary" onClick={onRetry}>
                {t('retry')}
              </Button>
            ),
          })}
    />
  );
}

/**
 * The state a screen's data is in, as one value rather than four props.
 *
 * Six screens used to take `data | undefined`, `isPending`, `isError` and
 * `error` side by side, and five of the six prop interfaces then spelled the
 * correlation out in prose — "`undefined` exactly when `isPending || isError`".
 * A fact an interface has to state in a comment is a fact its types are
 * failing to carry: nothing stopped a caller from handing a screen
 * `isPending: false, isError: false, data: undefined`, and a screen that
 * reached its ready branch with no data would draw an empty table asserting
 * "there are no parking spots" — a claim, where the truth was an absence.
 *
 * As a discriminated union the combination cannot be written down. `data`
 * exists only on the branch that has it, so the ready branch cannot be reached
 * without it, and the comment is replaced by a compile error. This is the same
 * shape `lot/bulk-modal/bulk-view.ts` uses for `PreferredSpotView` and `BulkBadgeView`.
 *
 * `onRetry` stays a sibling prop: retrying is the caller's capability, not a
 * property of the data, and it is the same function in all three states.
 */
export type ScreenData<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly data: T };

/**
 * The shape {@link screenDataOf} reads — structurally what a TanStack query
 * result already is.
 *
 * Written out here rather than imported as `UseQueryResult` so that the seam
 * does not name the transport at all: a screen fed from `useQueries`, from a
 * Storybook story or from a parent's own state can be adapted with the same
 * function.
 */
export interface ScreenQueryLike<T> {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly data: T | undefined;
}

/**
 * A query result, narrowed to the three states a screen can draw.
 *
 * The precedence is the one the hand-written guards had, so the mapping is
 * behaviour-preserving: pending wins over error, and a result that is neither
 * pending nor failed yet carries no data is treated as a failure — the branch
 * a screen must never render as "empty".
 */
export function screenDataOf<T>(query: ScreenQueryLike<T>): ScreenData<T> {
  if (query.isPending) {
    return { kind: 'loading' };
  }
  if (query.isError || query.data === undefined) {
    return { kind: 'error', error: query.error };
  }
  return { kind: 'ready', data: query.data };
}

export interface ScreenDataGuardProps<T> {
  readonly state: ScreenData<T>;
  /** Rendered as a "Zkusit znovu" button on the error state. */
  readonly onRetry?: () => void;
  /** See `EmptyStateProps.headingLevel`: only the page knows its own outline. */
  readonly headingLevel?: EmptyStateHeadingLevel;
  /** Drawn only once there is data to draw it from. */
  readonly children: (data: T) => ReactNode;
}

/**
 * The two-branch guard every screen had copied into it, written once.
 *
 * A render prop rather than an early return on purpose: a screen whose states
 * belong *inside* something it has already opened — a modal that keeps its
 * header and footer while its body is loading — cannot use an early return
 * without losing the frame. Both call shapes are the same expression here.
 *
 * No `label` for the loading state, because no screen overrides it. A site that
 * needs one still has `ScreenLoading` itself.
 */
export function ScreenDataGuard<T>({
  state,
  onRetry,
  headingLevel,
  children,
}: ScreenDataGuardProps<T>) {
  if (state.kind === 'loading') {
    return <ScreenLoading />;
  }

  if (state.kind === 'error') {
    return (
      <ScreenError
        error={state.error}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(headingLevel === undefined ? {} : { headingLevel })}
      />
    );
  }

  return <>{children(state.data)}</>;
}

/**
 * The **empty** state, re-exported rather than re-implemented.
 *
 * `EmptyState` (Task 22) is already the design system's "there is nothing
 * here" block and it is domain-free, which is exactly right — only the screen
 * knows what its own emptiness means, so nothing generic about parking belongs
 * in it. Re-exporting it here means a screen imports all three of its states
 * from one place instead of two.
 */
export { EmptyState };

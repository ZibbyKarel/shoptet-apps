'use client';

import { useId, type ReactNode } from 'react';

import { cx } from '../cx';

/** Label / hint / error props every form primitive accepts. */
export interface FieldOwnProps {
  /** Visible label. Wired to the control with `htmlFor`, so it is also the accessible name. */
  label?: ReactNode | undefined;
  /** Supporting text under the control. Referenced by `aria-describedby`. */
  hint?: ReactNode | undefined;
  /**
   * Error message. Its presence *is* the error state — it turns the control's
   * border red and sets `aria-invalid`, so the two can never disagree.
   */
  error?: ReactNode | undefined;
}

export interface FieldIds {
  controlId: string;
  /** `aria-describedby` value, or `undefined` when there is nothing to describe. */
  describedBy: string | undefined;
  hintId: string;
  errorId: string;
  invalid: boolean;
}

/**
 * Derives the ids that tie a control to its label, hint and error message.
 *
 * @param providedId an explicit `id` from the caller, which always wins so a
 *   consumer's own labelling keeps working
 */
export function useFieldIds(
  providedId: string | undefined,
  { hint, error }: Pick<FieldOwnProps, 'hint' | 'error'>
): FieldIds {
  const generated = useId();
  const controlId = providedId ?? generated;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean);

  return {
    controlId,
    hintId,
    errorId,
    invalid: Boolean(error),
    describedBy: described.length > 0 ? described.join(' ') : undefined,
  };
}

/**
 * Joins an `aria-describedby` the caller already set with the ids the field
 * owns, dropping the empty ones. Returns `undefined` when nothing is left, so
 * React removes the attribute rather than emitting `aria-describedby=""`.
 *
 * **Written as a merge, never as an assignment, and that is the whole point.**
 * A wrapper that describes a control by cloning it with its own
 * `aria-describedby` would have its value overwritten if a control spread
 * `{...rest}` first and then wrote `aria-describedby={ids.describedBy}` as an
 * assignment — the description would silently stop reaching the screen
 * reader whenever the control had no hint and no error of its own.
 * `field.spec.tsx` fails if this goes back to an assignment.
 */
export function mergeDescribedBy(...values: (string | undefined)[]): string | undefined {
  const joined = values.filter(Boolean).join(' ');

  return joined.length > 0 ? joined : undefined;
}

export interface FieldProps extends FieldOwnProps {
  ids: FieldIds;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * Vertical label → control → message stack. Presentation only: it never
 * touches the control it wraps, it just renders the text around it.
 */
export function Field({ ids, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {label ? (
        <label htmlFor={ids.controlId} className="text-sm font-medium text-fg">
          {label}
        </label>
      ) : null}
      {children}
      {hint ? (
        <p id={ids.hintId} className="text-xs text-fg-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={ids.errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

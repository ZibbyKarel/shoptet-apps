'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

import {
  CONTROL_HEIGHT,
  CONTROL_TEXT,
  CONTROL_TRANSITION,
  FIELD_PADDING_X,
  FOCUS_RING,
  WRAPPER_WIDTH_CLASSES,
  type ControlSize,
  type ControlWrapperWidth,
} from '../control-size';
import { cx } from '../cx';
import { Field, mergeDescribedBy, useFieldIds, type FieldOwnProps } from '../field/field';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    FieldOwnProps {
  /**
   * Height step. Defaults to `md`. Shadows the native `size` attribute
   * deliberately — a character-count `size` has no place in a design system
   * whose every other control takes the same four-step scale.
   */
  size?: ControlSize | undefined;
  /** Stretches the input to its container. Defaults to `true`. */
  fullWidth?: boolean | undefined;
  /**
   * Width of the outer wrapper — as opposed to `fullWidth`, which stretches
   * the `<input>` itself inside it. No default: omitting it keeps the
   * wrapper shrink-to-fit, exactly as before this prop existed. See
   * `ControlWrapperWidth` in `control-size.ts` for what it does and does not
   * cover.
   */
  width?: ControlWrapperWidth | undefined;
  /** Class applied to the outer wrapper rather than the `<input>` itself. */
  wrapperClassName?: string | undefined;
}

/** Single-line text field. A plain `<input>`, styled — no behaviour taken over. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = 'md',
    fullWidth = true,
    width,
    label,
    hint,
    error,
    id,
    className,
    wrapperClassName,
    disabled = false,
    // Pulled out of `rest` so it can be merged below rather than overwritten —
    // see `mergeDescribedBy` in `field.tsx`.
    'aria-describedby': callerDescribedBy,
    ...rest
  },
  ref
) {
  const ids = useFieldIds(id, { hint, error });

  return (
    <Field
      ids={ids}
      label={label}
      hint={hint}
      error={error}
      className={cx(width !== undefined && WRAPPER_WIDTH_CLASSES[width], wrapperClassName)}
    >
      <input
        {...rest}
        ref={ref}
        id={ids.controlId}
        disabled={disabled}
        aria-invalid={ids.invalid || undefined}
        aria-describedby={mergeDescribedBy(callerDescribedBy, ids.describedBy)}
        className={cx(
          'rounded-md border placeholder:text-fg-3',
          CONTROL_HEIGHT[size],
          FIELD_PADDING_X[size],
          CONTROL_TEXT[size],
          CONTROL_TRANSITION,
          FOCUS_RING,
          // Swapped, never layered: same-property utilities resolve by
          // stylesheet order, not className order (see `button.tsx`). Disabled
          // wins over invalid — a field the user cannot edit should not also
          // be shouting an error at them through a red border.
          disabled
            ? 'border-border'
            : ids.invalid
              ? 'border-danger'
              : 'border-border focus-visible:border-brand-blue',
          disabled ? 'cursor-not-allowed bg-bg-muted text-fg-3' : 'bg-bg text-fg',
          fullWidth && 'w-full',
          className
        )}
      />
    </Field>
  );
});

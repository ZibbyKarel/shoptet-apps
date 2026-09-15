import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { cx } from '../cx';

/**
 * `warning`/`success` only — there is no neutral default worth guessing.
 * Every real call site (`lot-header.tsx`'s two status banners, `spot-dialog.tsx`'s
 * lock note, `bulk-modal.tsx`'s result panel) is one of these two; `Toast`
 * already covers the wider `neutral`/`info`/`danger` set for a floating
 * notice, and this primitive does not duplicate that surface.
 *
 * Border + tint pair, same shape as `Toast`'s `TONE_CLASSES` and modelled on
 * the same design source: a 100-level tint with its full-strength
 * counterpart as the border.
 */
export type CalloutTone = 'warning' | 'success';

const TONE_CLASSES: Record<CalloutTone, string> = {
  warning: 'border-brand-yellow bg-brand-yellow-100',
  success: 'border-brand-green bg-brand-green-100',
};

/**
 * Cross-axis alignment of the icon against the text, for the row layout an
 * `icon` triggers. `spot-dialog.tsx:404` wants the icon pinned to the top of
 * a two-line message (`align="start"`, the default); `lot-header.tsx:128`'s
 * `WindowBanner` wants it centred against a single line (`align="center"`).
 */
export type CalloutAlign = 'start' | 'center';

const ALIGN_CLASSES: Record<CalloutAlign, string> = {
  start: 'items-start',
  center: 'items-center',
};

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  /** Tint + border pair. Required — there is no neutral reading of this panel. */
  tone: CalloutTone;
  /**
   * Leading mark. Presentational, so `Callout` never imports `IconCircle` or
   * hard-codes a glyph itself — callers pass an `IconCircle` (or any other
   * node) through this slot, keeping `Callout` domain-free. When present,
   * the panel lays out as a row (`flex items-start gap-3`, the icon not
   * shrinking) so the text wraps beside it rather than under it; when
   * absent, `children` fill the panel with no layout imposed, so a caller
   * needing its own row (e.g. text plus a trailing button,
   * `lot-header.tsx:186`'s `RealtimeNotice`) is free to wrap its own
   * children in a `Stack`.
   */
  icon?: ReactNode | undefined;
  /** Cross-axis alignment of `icon` against the text. Defaults to `start`. Only meaningful with `icon`. */
  align?: CalloutAlign | undefined;
  /** `<div>` or `<section>`. Defaults to `div`. */
  as?: 'div' | 'section' | undefined;
}

/**
 * Bordered, tinted notice panel — the "status banner" every real call site
 * hand-rolled with its own `cx('rounded-md border px-4 py-3', ...)` (see the
 * four sites named above). `Callout` owns only the chrome and the optional
 * icon row; it never sets a `role` itself. Every real caller already needs
 * a specific one (`role="status"` for the two `lot-header.tsx` banners and
 * `bulk-modal.tsx`'s unchanged-result line, `role="alert"` for
 * `spot-dialog.tsx`'s lock note and `bulk-modal.tsx`'s changed-result panel)
 * and `Badge`'s docstring states the same policy: a component that invents
 * its own role for callers who already have one in mind just gets fought
 * with `aria-*` overrides. `role`/`aria-*` pass through via `...rest`.
 *
 * `mb-5` is spacing every real call site currently bakes into the same
 * className as the panel's own chrome, but it is the caller's placement in
 * its surrounding layout, not part of the panel — left out here on purpose,
 * for a wrapping `Box margin=` or parent `Stack spacing=` to express instead.
 */
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { tone, icon, align = 'start', as = 'div', className, children, ...rest },
  ref
) {
  const Tag = as;

  return (
    <Tag
      {...rest}
      // `Tag` is a union of two intrinsic element types, and JSX resolves
      // `ref`'s type per-branch rather than against the union `forwardRef`
      // was given — same cast `List`/`Divider` need for the same reason.
      ref={ref as Ref<HTMLDivElement>}
      className={cx(
        'rounded-md border px-4 py-3',
        TONE_CLASSES[tone],
        icon !== undefined && cx('flex gap-3', ALIGN_CLASSES[align]),
        className
      )}
    >
      {icon !== undefined ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </Tag>
  );
});

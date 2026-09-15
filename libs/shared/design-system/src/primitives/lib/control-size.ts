/**
 * The height scale shared by every control that sits on a form row — Button,
 * Input, Select, Stepper. The pixel values live in
 * `@lets-park/design-system/tokens` (`--control-h-*`); this module only names
 * the steps and picks the matching horizontal padding and type size, both of
 * which come from the ordinary `--space-*` / `--fs-*` scales.
 */
export type ControlSize = 'sm' | 'md' | 'lg' | 'xl';

/** Track height. Arbitrary-value syntax because Tailwind has no height namespace. */
export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-[var(--control-h-sm)]',
  md: 'h-[var(--control-h-md)]',
  lg: 'h-[var(--control-h-lg)]',
  xl: 'h-[var(--control-h-xl)]',
};

/**
 * Track width for square controls (an icon button whose box matches the row
 * height). Same token as the height, so the two can never drift apart.
 */
export const CONTROL_SQUARE_WIDTH: Record<ControlSize, string> = {
  sm: 'w-[var(--control-h-sm)]',
  md: 'w-[var(--control-h-md)]',
  lg: 'w-[var(--control-h-lg)]',
  xl: 'w-[var(--control-h-xl)]',
};

/** Type size per step. */
export const CONTROL_TEXT: Record<ControlSize, string> = {
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-md',
};

/** Horizontal padding for controls whose content is centred (buttons). */
export const CONTROL_PADDING_X: Record<ControlSize, string> = {
  sm: 'px-4',
  md: 'px-5',
  lg: 'px-6',
  xl: 'px-8',
};

/** Horizontal padding for controls whose content is a caret-aligned text run (fields). */
export const FIELD_PADDING_X: Record<ControlSize, string> = {
  sm: 'px-3',
  md: 'px-4',
  lg: 'px-4',
  xl: 'px-5',
};

/**
 * Focus ring. The design only specifies focus for text fields (border turns
 * brand blue), which is too weak to be the sole focus affordance and says
 * nothing about buttons — so every focusable primitive additionally gets this
 * one consistent, high-contrast ring. See
 * `doc/decision/0012-focus-ring-and-native-elements-in-primitives.md`.
 */
export const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue';

/**
 * The same ring, drawn *inside* the element's box rather than around it.
 *
 * For items that sit flush against a panel edge — menu items, tabs — an outward
 * ring is clipped by the panel or overlaps the neighbour above. The offset is
 * the negative of `FOCUS_RING`'s, off the same numeric scale, so the two rings
 * are the same weight and the same colour and only their side differs.
 */
export const INSET_FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue';

/**
 * Press feedback, taken verbatim from the design's `style-active` rules
 * (`transform:scale(0.97)`). A transform ratio, not a color or a length, so it
 * has no token counterpart.
 */
export const PRESS_FEEDBACK = 'active:not-disabled:scale-[0.97]';

/** Shared transition. */
export const CONTROL_TRANSITION = 'transition duration-[var(--dur-base)] ease-out';

/**
 * Width of a field's outer *wrapper* — `Input`/`Select`'s `Field` div — as
 * opposed to `fullWidth`, which stretches the control itself inside that
 * wrapper. Two real call sites needed this: `date-picker-dialog.tsx`'s month
 * select sits between two nav buttons in a flex row and needs to fill the
 * space between them (`grow`); a plain block context that should span its
 * parent needs `full`.
 *
 * Deliberately does not cover `admin-users-screen.tsx`'s `w-full sm:w-80`
 * search field — a *responsive* wrapper width has no vocabulary here or
 * anywhere else in the design system (no primitive takes a breakpoint-keyed
 * prop), and inventing one for this single call site would be exactly the
 * kind of value this rewrite is meant to stop reaching for. See the rewrite
 * report: the recommended fix is wrapping in `Box` once `Box` gains a width
 * prop, not a responsive step added here.
 */
export type ControlWrapperWidth = 'full' | 'grow';

/** `w-full`/`flex-1` literals for `ControlWrapperWidth`. */
export const WRAPPER_WIDTH_CLASSES: Record<ControlWrapperWidth, string> = {
  full: 'w-full',
  grow: 'flex-1',
};

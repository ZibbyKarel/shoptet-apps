import type { SpacingKey } from '@garage/design-system/tokens';

/** A spacing step, or `0` for no space at all — `SPACING` starts at `1`, see `Padding` below. */
export type PaddingStep = SpacingKey | 0;

/**
 * CSS-shorthand-style padding/margin prop, mirroring the 1/2/4-value
 * shorthand syntax instead of one prop per side:
 *
 * - a single step applies to all sides (`p-{v}`)
 * - a `[vertical, horizontal]` pair (`py-{v} px-{h}`)
 * - a `[top, right, bottom, left]` quad (`pt-{t} pr-{r} pb-{b} pl-{l}`)
 *
 * `0` is part of the type on purpose: a bare panel (border + background, no
 * inner padding — content handles its own) needs `padding={0}`, and `SPACING`
 * itself has no `0` key. `p-0`/`m-0` still work because Tailwind's default
 * `--spacing` multiplier stays in place — the token scale is deliberately
 * left open rather than closed, which would have silently dropped the
 * zero-value utilities along with it. So `0` is accepted here even though it
 * is not a `SpacingKey`. See
 * `doc/decision/0268-the-spacing-scale-is-open-by-design-and-the-enumeration-is-what-binds-it-to-the-tokens.md`.
 */
export type Padding =
  | PaddingStep
  | readonly [vertical: PaddingStep, horizontal: PaddingStep]
  | readonly [top: PaddingStep, right: PaddingStep, bottom: PaddingStep, left: PaddingStep];

type PaddingPrefix = 'p' | 'px' | 'py' | 'pt' | 'pr' | 'pb' | 'pl';
type MarginPrefix = 'm' | 'mx' | 'my' | 'mt' | 'mr' | 'mb' | 'ml';

/**
 * Every `{prefix}-{step}` Tailwind class, spelled out as a literal.
 *
 * Tailwind v4 finds classes by scanning source text statically — it does not
 * evaluate JS. A template like `` `p-${step}` `` never appears verbatim in
 * any file, so Tailwind emits nothing for it. The only way to make a
 * dynamically-chosen step produce real CSS is to enumerate every
 * prefix/step pair as its own string literal and select among them at
 * runtime, so each one is visible to the scanner. 14 prefixes × 14 steps is
 * the resulting 196 entries.
 *
 * Exported (only) so `padding.spec.ts` can walk every entry and assert it
 * against `` `${prefix}-${step}` `` — a hand-typed table this size is the
 * likeliest place for a wrong *value* behind a correct key, which nothing
 * else here would catch.
 */
export const PADDING_CLASSES: Record<PaddingPrefix | MarginPrefix, Record<PaddingStep, string>> = {
  p: {
    0: 'p-0',
    1: 'p-1',
    2: 'p-2',
    3: 'p-3',
    4: 'p-4',
    5: 'p-5',
    6: 'p-6',
    8: 'p-8',
    10: 'p-10',
    12: 'p-12',
    16: 'p-16',
    20: 'p-20',
    24: 'p-24',
    32: 'p-32',
  },
  px: {
    0: 'px-0',
    1: 'px-1',
    2: 'px-2',
    3: 'px-3',
    4: 'px-4',
    5: 'px-5',
    6: 'px-6',
    8: 'px-8',
    10: 'px-10',
    12: 'px-12',
    16: 'px-16',
    20: 'px-20',
    24: 'px-24',
    32: 'px-32',
  },
  py: {
    0: 'py-0',
    1: 'py-1',
    2: 'py-2',
    3: 'py-3',
    4: 'py-4',
    5: 'py-5',
    6: 'py-6',
    8: 'py-8',
    10: 'py-10',
    12: 'py-12',
    16: 'py-16',
    20: 'py-20',
    24: 'py-24',
    32: 'py-32',
  },
  pt: {
    0: 'pt-0',
    1: 'pt-1',
    2: 'pt-2',
    3: 'pt-3',
    4: 'pt-4',
    5: 'pt-5',
    6: 'pt-6',
    8: 'pt-8',
    10: 'pt-10',
    12: 'pt-12',
    16: 'pt-16',
    20: 'pt-20',
    24: 'pt-24',
    32: 'pt-32',
  },
  pr: {
    0: 'pr-0',
    1: 'pr-1',
    2: 'pr-2',
    3: 'pr-3',
    4: 'pr-4',
    5: 'pr-5',
    6: 'pr-6',
    8: 'pr-8',
    10: 'pr-10',
    12: 'pr-12',
    16: 'pr-16',
    20: 'pr-20',
    24: 'pr-24',
    32: 'pr-32',
  },
  pb: {
    0: 'pb-0',
    1: 'pb-1',
    2: 'pb-2',
    3: 'pb-3',
    4: 'pb-4',
    5: 'pb-5',
    6: 'pb-6',
    8: 'pb-8',
    10: 'pb-10',
    12: 'pb-12',
    16: 'pb-16',
    20: 'pb-20',
    24: 'pb-24',
    32: 'pb-32',
  },
  pl: {
    0: 'pl-0',
    1: 'pl-1',
    2: 'pl-2',
    3: 'pl-3',
    4: 'pl-4',
    5: 'pl-5',
    6: 'pl-6',
    8: 'pl-8',
    10: 'pl-10',
    12: 'pl-12',
    16: 'pl-16',
    20: 'pl-20',
    24: 'pl-24',
    32: 'pl-32',
  },
  m: {
    0: 'm-0',
    1: 'm-1',
    2: 'm-2',
    3: 'm-3',
    4: 'm-4',
    5: 'm-5',
    6: 'm-6',
    8: 'm-8',
    10: 'm-10',
    12: 'm-12',
    16: 'm-16',
    20: 'm-20',
    24: 'm-24',
    32: 'm-32',
  },
  mx: {
    0: 'mx-0',
    1: 'mx-1',
    2: 'mx-2',
    3: 'mx-3',
    4: 'mx-4',
    5: 'mx-5',
    6: 'mx-6',
    8: 'mx-8',
    10: 'mx-10',
    12: 'mx-12',
    16: 'mx-16',
    20: 'mx-20',
    24: 'mx-24',
    32: 'mx-32',
  },
  my: {
    0: 'my-0',
    1: 'my-1',
    2: 'my-2',
    3: 'my-3',
    4: 'my-4',
    5: 'my-5',
    6: 'my-6',
    8: 'my-8',
    10: 'my-10',
    12: 'my-12',
    16: 'my-16',
    20: 'my-20',
    24: 'my-24',
    32: 'my-32',
  },
  mt: {
    0: 'mt-0',
    1: 'mt-1',
    2: 'mt-2',
    3: 'mt-3',
    4: 'mt-4',
    5: 'mt-5',
    6: 'mt-6',
    8: 'mt-8',
    10: 'mt-10',
    12: 'mt-12',
    16: 'mt-16',
    20: 'mt-20',
    24: 'mt-24',
    32: 'mt-32',
  },
  mr: {
    0: 'mr-0',
    1: 'mr-1',
    2: 'mr-2',
    3: 'mr-3',
    4: 'mr-4',
    5: 'mr-5',
    6: 'mr-6',
    8: 'mr-8',
    10: 'mr-10',
    12: 'mr-12',
    16: 'mr-16',
    20: 'mr-20',
    24: 'mr-24',
    32: 'mr-32',
  },
  mb: {
    0: 'mb-0',
    1: 'mb-1',
    2: 'mb-2',
    3: 'mb-3',
    4: 'mb-4',
    5: 'mb-5',
    6: 'mb-6',
    8: 'mb-8',
    10: 'mb-10',
    12: 'mb-12',
    16: 'mb-16',
    20: 'mb-20',
    24: 'mb-24',
    32: 'mb-32',
  },
  ml: {
    0: 'ml-0',
    1: 'ml-1',
    2: 'ml-2',
    3: 'ml-3',
    4: 'ml-4',
    5: 'ml-5',
    6: 'ml-6',
    8: 'ml-8',
    10: 'ml-10',
    12: 'ml-12',
    16: 'ml-16',
    20: 'ml-20',
    24: 'ml-24',
    32: 'ml-32',
  },
};

/**
 * The per-side prefixes for each axis, so `resolvePadding` can look one up
 * instead of writing `axis === 'p' ? 'pt' : 'mt'` at every side. These are
 * prefix *keys* into `PADDING_CLASSES`, never class names themselves, so the
 * static-literal rule above does not apply to this table.
 */
const AXIS: Record<
  'p' | 'm',
  {
    all: PaddingPrefix | MarginPrefix;
    y: PaddingPrefix | MarginPrefix;
    x: PaddingPrefix | MarginPrefix;
    t: PaddingPrefix | MarginPrefix;
    r: PaddingPrefix | MarginPrefix;
    b: PaddingPrefix | MarginPrefix;
    l: PaddingPrefix | MarginPrefix;
  }
> = {
  p: { all: 'p', y: 'py', x: 'px', t: 'pt', r: 'pr', b: 'pb', l: 'pl' },
  m: { all: 'm', y: 'my', x: 'mx', t: 'mt', r: 'mr', b: 'mb', l: 'ml' },
};

/**
 * Resolves a `Padding` value to space-separated Tailwind classes for the
 * given axis (`p` for padding, `m` for margin), picking the shape — single
 * step, `[vertical, horizontal]`, or `[top, right, bottom, left]` — from
 * whether `value` is an array and how long it is.
 */
export function resolvePadding(value: Padding, axis: 'p' | 'm'): string {
  const prefix = AXIS[axis];

  // `Array.isArray` alone does not narrow a readonly tuple in its negative
  // branch (a readonly array is not assignable to the mutable `any[]` the
  // guard checks against), so the shapes are told apart by `typeof`/length
  // instead — every `PaddingStep` is a numeric literal.
  if (typeof value === 'number') {
    return PADDING_CLASSES[prefix.all][value];
  }
  if (value.length === 2) {
    const [vertical, horizontal] = value;
    return `${PADDING_CLASSES[prefix.y][vertical]} ${PADDING_CLASSES[prefix.x][horizontal]}`;
  }
  const [top, right, bottom, left] = value;
  return `${PADDING_CLASSES[prefix.t][top]} ${PADDING_CLASSES[prefix.r][right]} ${PADDING_CLASSES[prefix.b][bottom]} ${PADDING_CLASSES[prefix.l][left]}`;
}

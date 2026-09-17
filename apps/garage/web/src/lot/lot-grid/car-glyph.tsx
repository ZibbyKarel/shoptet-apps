'use client';

/**
 * The car, seen from above.
 *
 * An **SVG with a viewBox**, not a stack of positioned boxes. The design draws
 * it as nine absolutely-positioned divs, and transcribing those would have put
 * a dozen pixel literals into TSX — which would read as spacing decisions and
 * be linted as such, when they are nothing of the kind. Inside a `viewBox`
 * they are user units in the drawing's own coordinate system, obviously an
 * illustration's proportions rather than layout, and the whole glyph scales
 * from the one size below.
 *
 * The body takes its colour from a `var(...)` reference passed in as `fill`,
 * a plain SVG presentation attribute — not a Tailwind `text-*` utility plus
 * `fill="currentColor"`, which was this file's previous mechanism and is the
 * one thing removing Tailwind from this app could not keep: there is no
 * `className` left to carry it. `lot-view.ts`'s `carColorVar()` is what picks
 * the reference. The five accent rects below follow the same idiom
 * `global.css`'s `.lot-asphalt`/`.lot-hatch` already use for a literal colour
 * mixed with transparency, so the palette stays the design system's either way.
 *
 * Purely decorative: the holder's name and plate are written underneath in
 * real text, so a second announcement of the same fact would be noise.
 */
export function CarGlyph({ colorVar }: { readonly colorVar: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-4 0 66 104"
      width="62"
      height="98"
      // eslint-disable-next-line no-restricted-syntax -- `.lot-car`: the glyph's own drop shadow, an illustration property no design-system prop expresses.
      className="lot-car"
    >
      {/* wing mirrors, behind the body */}
      <rect
        x="-4"
        y="32"
        width="5"
        height="9"
        rx="2"
        fill="color-mix(in srgb, var(--brand-dark) 40%, transparent)"
      />
      <rect
        x="57"
        y="32"
        width="5"
        height="9"
        rx="2"
        fill="color-mix(in srgb, var(--brand-dark) 40%, transparent)"
      />
      {/* body */}
      <path
        d="M0 16A16 16 0 0 1 16 0h26a16 16 0 0 1 16 16v75a13 13 0 0 1-13 13H13A13 13 0 0 1 0 91Z"
        fill={colorVar}
      />
      {/* windscreen, roof panel, rear window */}
      <rect
        x="8"
        y="10"
        width="42"
        height="20"
        rx="7"
        fill="color-mix(in srgb, var(--brand-dark) 45%, transparent)"
      />
      <rect
        x="5"
        y="36"
        width="48"
        height="34"
        rx="6"
        fill="color-mix(in srgb, var(--neutral-0) 15%, transparent)"
      />
      <rect
        x="8"
        y="76"
        width="42"
        height="16"
        rx="5"
        fill="color-mix(in srgb, var(--brand-dark) 35%, transparent)"
      />
    </svg>
  );
}

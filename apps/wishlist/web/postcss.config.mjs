/**
 * Tailwind v4 for Next.js.
 *
 * Tailwind v4 is CSS-first: there is no `tailwind.config.js` and no `content`
 * array — the theme comes from `src/app/global.css`, which imports the design
 * system's `theme.css` and names its own `@source` trees. All this file does
 * is put Tailwind into Next's CSS pipeline; `autoprefixer` and `postcss-import`
 * are not listed because `@tailwindcss/postcss` already does both.
 *
 * Identical to `apps/garage/web/postcss.config.mjs`, and that is the point:
 * two applications, one stylesheet pipeline, no second source of theme values.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

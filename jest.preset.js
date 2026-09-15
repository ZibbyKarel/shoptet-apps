const nxPreset = require('@nx/jest/preset').default;

/**
 * Packages on this workspace's runtime paths that are published **ESM-only** —
 * `"type": "module"` with no `require` condition — while every Jest project
 * here runs as CommonJS. Jest transforms nothing under `node_modules` by
 * default, so without this their `import` statements reach the CJS loader
 * untransformed and the suite dies on `Cannot use import statement outside a
 * module`. `doc/decision/0020-orpc-is-esm-only-jest-must-transpile-it.md`.
 *
 * **Why it is here and not in each project.** 0020 said the third project to
 * need this block should move it into this file rather than copy it again. It
 * reached eleven copies before anyone was in a position to do it, because each
 * task that added one could only touch its own files. It is consolidated here
 * now (`doc/decision/0297-*`); the copies that remain are named there.
 *
 * The list is the **union** across the workspace, not a per-project set, and
 * that costs nothing: `transformIgnorePatterns` only says a file *may* be
 * transformed if it is loaded. A project that never imports `next-intl` is
 * unaffected by `next-intl` being listed.
 *
 * Two things do **not** move here, because they are genuinely per-project:
 *
 * - the `'^.+\\.mjs$'` entry in `transform` — some projects run ts-jest, some
 *   babel-jest, and the two need different entries;
 * - `'mjs'` in `moduleFileExtensions`, without which resolution never finds the
 *   files at all.
 *
 * A project that overrides `transformIgnorePatterns` replaces this value
 * outright (Jest merges a preset shallowly), so an override must restate
 * everything it needs — via `buildTransformIgnorePatterns` below, not a
 * hand-rolled regex, for the pnpm reason documented on that function.
 */
const ESM_ONLY_PACKAGES = [
  // `@orpc/client`, `@orpc/client/fetch`, `@orpc/contract`,
  // `@orpc/tanstack-query` — the contract-first stack, reached transitively by
  // anything importing `@lets-park/contract` at runtime.
  '@orpc',
  // next-intl and its transitive message-formatting dependencies.
  'next-intl',
  'use-intl',
  'intl-messageformat',
  '@formatjs',
  '@schummar',
  'icu-minify',
];

/**
 * Builds a `transformIgnorePatterns` entry that actually works under pnpm.
 *
 * pnpm nests every dependency: the real file lives at
 * `node_modules/.pnpm/<name>@<version>[_<hash>]/node_modules/<name>/...`, so a
 * package's path contains **two** `/node_modules/` segments, not one. Jest
 * tests a `transformIgnorePatterns` entry against the whole path and skips the
 * transform if *any* position matches — including the first `/node_modules/`,
 * which is followed by `.pnpm/<name>@<version>.../`, not `<name>/`. A pattern
 * of the plain `/node_modules/(?!(?:pkg-a|pkg-b)/)` shape (what every project
 * here used before) never matches that first segment's continuation, so it is
 * always treated as "ignore" there regardless of which package it is — the
 * second, correct segment further down the path is never reached because the
 * first match already decided the file's fate. Measured: `@nestjs/config` was
 * already named in `apps/lets-park/api/jest.config.cts`'s own
 * `transformIgnorePatterns` and still failed with `SyntaxError: Unexpected
 * token 'export'`, because of exactly this.
 *
 * The fix is to also let `.pnpm/` itself defeat the "ignore" match, so the
 * decision falls through to the second, real segment: a package resolves to
 * ignore (untransformed) only when neither alternative matches at any
 * `/node_modules/` position, i.e. it is genuinely CJS and not a nested
 * `.pnpm` nested store entry.
 */
function buildTransformIgnorePatterns(packages) {
  return `/node_modules/(?!(?:\\.pnpm/|(?:${packages.join('|')})/))`;
}

module.exports = {
  ...nxPreset,
  transformIgnorePatterns: [buildTransformIgnorePatterns(ESM_ONLY_PACKAGES)],
};

module.exports.buildTransformIgnorePatterns = buildTransformIgnorePatterns;
module.exports.ESM_ONLY_PACKAGES = ESM_ONLY_PACKAGES;

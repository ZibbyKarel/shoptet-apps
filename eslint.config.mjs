import nx from '@nx/eslint-plugin';

/**
 * Absolute path of the workspace root.
 *
 * Nx runs `eslint .` with the *project* directory as cwd, and every project's
 * `eslint.config.mjs` re-exports this file. Without an explicit `basePath`,
 * workspace-relative globs such as `apps/**` or `libs/shared/form/**` would be matched
 * against project-relative file paths and silently never fire. Every config
 * object below whose `files` are workspace-relative therefore pins `basePath`.
 */
const workspaceRoot = import.meta.dirname;

/**
 * Every extension ESLint actually lints in this workspace. Kept as one list so
 * the boundary rule, the wrapper ban and the per-wrapper-lib overrides below
 * cannot drift apart the way they did before — `.cts`/`.mts`/`.cjs`/`.mjs`
 * files (eighteen of them, under `apps/` and `libs/`) were linted but with
 * those rules silently absent, because each `files` array was hand-copied and
 * only ever listed `.ts`/`.tsx`/`.js`/`.jsx`.
 */
const LINTED_EXTENSIONS = ['ts', 'tsx', 'cts', 'mts', 'js', 'jsx', 'cjs', 'mjs'];

/** `files` globs matching every linted extension, rooted under `root`. */
const under = (root) => LINTED_EXTENSIONS.map((ext) => `${root}/**/*.${ext}`);

/**
 * Third-party libraries that application and library code must never import
 * directly. Each one is owned by exactly one wrapper lib, which is the single
 * place in the workspace allowed to import it (see `plan.md`, wrapper table).
 *
 * key   = npm package that is banned
 * owner = directory of the wrapper lib that owns it (exempted from the ban)
 * use   = import path developers should use instead
 */
const WRAPPED_LIBRARIES = {
  'react-hook-form': {
    owner: 'libs/shared/form',
    use: '@lets-park/form',
  },
  '@tanstack/react-table': {
    owner: 'libs/shared/design-system/src/compounds',
    use: '@lets-park/design-system/compounds',
  },
  '@orpc/client': {
    owner: 'libs/shared/api-client',
    use: '@lets-park/api-client',
  },
  'socket.io-client': {
    owner: 'libs/lets-park/realtime-client',
    use: '@lets-park/realtime-client',
  },
  'next-auth': {
    owner: 'libs/lets-park/auth',
    use: '@lets-park/auth',
  },
  'ical-generator': {
    owner: 'libs/lets-park/calendar-export',
    use: '@lets-park/calendar-export',
  },
  'next-intl': {
    owner: 'libs/shared/i18n',
    use: '@lets-park/i18n',
  },
};

/**
 * Builds a `no-restricted-imports` option object banning every wrapped library
 * except the ones listed in `allowedPackages`.
 *
 * Flat config does not merge rule options: an override that re-declares
 * `no-restricted-imports` replaces the whole option object. Every wrapper lib
 * override therefore has to restate the full ban list minus its own package,
 * which is why both the global block and the overrides are generated from the
 * single `WRAPPED_LIBRARIES` map above.
 */
/**
 * Exported so that a lib-local config can *compose* these patterns rather than
 * replace them. `no-restricted-imports` is a single rule: a later flat-config
 * block that sets it wins outright, so a lib adding its own bans without
 * spreading these in would silently switch the wrapper ban off for itself —
 * which is exactly the kind of enforcement-shaped hole this file has been
 * caught in before. `libs/shared/design-system/eslint.config.mjs` spreads
 * `restrictWrappedLibraries().patterns` into every one of its blocks for that
 * reason.
 */
export function restrictWrappedLibraries(allowedPackages = []) {
  return {
    patterns: Object.entries(WRAPPED_LIBRARIES)
      .filter(([pkg]) => !allowedPackages.includes(pkg))
      .map(([pkg, { owner, use }]) => ({
        group: [pkg, `${pkg}/*`],
        message: `Do not import "${pkg}" directly — use the wrapper lib ${use} (${owner}). Only ${owner} may import "${pkg}".`,
      })),
  };
}

/**
 * The same ban, for the two ways of reaching a package that are not an
 * `import` declaration: `require('pkg')` and `await import('pkg')`.
 *
 * **`no-restricted-imports` does not cover either, and nothing else did.**
 * Measured, on a throwaway `apps/lets-park/web/src/__probe__.ts` holding
 * `require('socket.io-client')` and `import('socket.io-client')`:
 * `nx run web:lint` exited **0** with no finding. `@nx/enforce-module-boundaries`
 * does see dynamic imports, but it constrains applications not at all here —
 * `NPM_ALLOWLIST.app` is `['*']`, deliberately, because an app depends on
 * whatever it ships. So the wrapper rule that the whole architecture rests on
 * had one spelling it enforced and two it did not. No live violation existed;
 * this closes it before one does.
 *
 * Selector-matched rather than pattern-matched because that is the only tool
 * ESLint offers for a call expression. The regex accepts the package and its
 * subpaths (`socket.io-client/debug`) and nothing that merely starts with the
 * same letters (`next-auth-extras`), which is what the `(\/|$)` does.
 *
 * Exported alongside `restrictWrappedLibraries` and for the same reason: a
 * later flat-config block that sets `no-restricted-syntax` replaces this list
 * outright, so a lib adding its own selectors has to spread these in.
 */
export function restrictWrappedLibrariesDynamically(allowedPackages = []) {
  return Object.entries(WRAPPED_LIBRARIES)
    .filter(([pkg]) => !allowedPackages.includes(pkg))
    .flatMap(([pkg, { owner, use }]) => {
      // Both escapes are load-bearing: an unescaped `.` would make
      // `socket.io-client` match `socketXio-client`, and an unescaped `/` ends
      // the regex literal mid-selector — esquery rejected
      // `@tanstack/react-table` outright until this was added.
      const source = `/^${pkg.replaceAll('.', '\\.').replaceAll('/', '\\/')}(\\/|$)/`;
      const message = `Do not reach "${pkg}" directly — use the wrapper lib ${use} (${owner}). Only ${owner} may import "${pkg}", and that includes require() and dynamic import().`;
      return [
        { selector: `ImportExpression[source.value=${source}]`, message },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=${source}]`,
          message,
        },
      ];
    });
}

/**
 * npm allow-lists per Nx `type:` tag (`allowedExternalImports`).
 *
 * ## Why the lists hang off `type:` and nowhere else
 *
 * `@nx/enforce-module-boundaries` collects **every** constraint whose source tag
 * the project carries and reports a violation if *any* of them bans the import
 * (`hasBannedImport` → `depConstraints.filter(...).find(...)` in
 * `@nx/eslint-plugin/dist/src/utils/runtime-lint-utils.js`). Constraints are
 * therefore ANDed, and a package must appear in the list of every matching
 * dimension. Spreading npm allow-lists across `type:` and `scope:` would mean
 * listing `react` in two places and getting an intersection nobody can predict.
 *
 * `type:` is used because it is the one dimension that **partitions** the
 * workspace: every project carries exactly one `type:` tag, so a list here
 * covers everything and leaves no project unconstrained. `scope:` stays purely
 * about direction of dependency, which is what it models.
 *
 * ## Why a list is mandatory on every tag
 *
 * A tag with **no** `allowedExternalImports` constrains nothing at all — that is
 * how `libs/lets-park/shared-types` was free to import Zod despite decision 0003
 * (Task 3 review, S3). An empty array (`[]`) is not the same thing: it bans
 * every npm package. Omission is inert; `[]` is a rule.
 *
 * Lists are deliberately short. When a task needs a package that is not here,
 * ESLint fails loudly with the package name and that task adds one line —
 * which is the point, because the addition shows up in review.
 */
const NPM_ALLOWLIST = {
  /**
   * Applications compose the whole stack; constraining them would just mirror
   * `package.json`. Spelled out rather than omitted so it reads as a decision.
   */
  app: ['*'],

  /**
   * Domain composition. No feature lib exists yet — extend when the first one
   * lands. Feature code reaches third parties through wrapper libs anyway
   * (see `WRAPPED_LIBRARIES`), so this list should stay near-empty.
   */
  feature: ['tslib'],

  /**
   * Design system (`libs/shared/design-system`). React plus styling helpers and
   * Storybook; TanStack Table is here because the design system's compounds
   * layer owns the DataTable wrapper. Never a backend package.
   */
  ui: [
    'tslib',
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
    'clsx',
    'tailwind-merge',
    'class-variance-authority',
    '@tanstack/react-table',
    '@tanstack/react-table/*',
    'storybook',
    'storybook/*',
    '@storybook/*',
    // Storybook's Tailwind v4 bridge, used only in `.storybook/main.ts`.
    '@tailwindcss/vite',
    // Test-only. The boundary rule cannot distinguish a spec file from a
    // shipped one, so these have to be allowed for the whole tag; keeping
    // them out would ban every design-system test.
    '@testing-library/react',
    '@testing-library/user-event',
    '@testing-library/jest-dom',
  ],

  /**
   * Wrapper libs. Each one exists precisely to be the single importer of one
   * third-party package, so this is the union of `WRAPPED_LIBRARIES` plus the
   * React/Next peers those wrappers are built on. The union is intentionally
   * coarse: *which* wrapper may import *which* package is enforced per-directory
   * by `no-restricted-imports` below, which this list cannot express.
   *
   * `libs/lets-park/shared-types` also carries `type:util`, but it additionally carries
   * `layer:foundation`, whose empty list ANDs this one down to nothing.
   */
  util: [
    'tslib',
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
    'next',
    'next/*',
    ...Object.keys(WRAPPED_LIBRARIES).flatMap((pkg) => [pkg, `${pkg}/*`]),
    // `libs/shared/form`'s Zod resolver for react-hook-form. It is not itself a
    // wrapped library (nothing else could import it instead — it only makes
    // sense paired with react-hook-form), so it is not in `WRAPPED_LIBRARIES`,
    // just allow-listed here alongside it.
    '@hookform/resolvers',
    '@hookform/resolvers/*',
    // `libs/shared/api-client`'s bridge between the oRPC client and TanStack Query
    // (`api-query.ts`). Same reasoning as `@hookform/resolvers`: it is not
    // itself a wrapped library (nothing could import it *instead* of
    // something else — it only makes sense paired with `@orpc/client` and
    // `@tanstack/react-query`, and the latter is not wrapped at all since
    // `doc/decision/0308-*`), so it is not in `WRAPPED_LIBRARIES`, just
    // allow-listed here alongside them.
    '@orpc/tanstack-query',
    '@orpc/tanstack-query/*',
    // `@orpc/contract` is deliberately **not** here, even though
    // `libs/shared/api-client` needs `ContractRouterClient` to type its client. This
    // list applies to every `type:util` lib at once, so adding it would also
    // hand the contract builder to `libs/shared/form`, `libs/shared/i18n` and every wrapper
    // still to come — undoing the narrowness `NPM_ALLOWLIST.contract` is
    // documented to have. Instead `libs/lets-park/contract` applies the type itself and
    // exports the result as `ContractClient` (see `libs/lets-park/contract/src/api/router.ts`),
    // which is what a contract lib is for. See `doc/decision/0040-*`.
    // `libs/shared/form` types `useAppForm` against a Zod schema (`z.input`/`z.output`)
    // and its resolver validates with Zod at runtime — it is the one wrapper
    // whose whole job is bridging Zod to react-hook-form, so it needs Zod
    // itself, not just the contract lib built on it.
    'zod',
    'zod/*',
    // Test-only, same reasoning as `ui` above: the boundary rule cannot tell
    // a spec file from a shipped one, so these have to be allowed for the
    // whole tag. Needed by `libs/shared/i18n`'s component test (`IntlProvider`) and
    // `libs/shared/form`'s (`userEvent.type`/`.click` on rendered primitives).
    '@testing-library/react',
    '@testing-library/jest-dom',
    '@testing-library/user-event',
    // `ical.js` is deliberately **not** here, even though `libs/lets-park/calendar-export`'s
    // specs need it: this list applies to every `type:util` lib at once, so an
    // entry would reach shipped source in six unrelated wrappers. It is scoped
    // to the spec files that actually use it — see
    // `calendarExportSpecDepConstraints` below.
  ],

  /**
   * `libs/lets-park/contract`. `@orpc/contract` only — never `@orpc/client` or
   * `@orpc/server`, so the contract can not reach a transport
   * (`doc/decision/0007-*`).
   */
  contract: ['tslib', 'zod', 'zod/*', '@orpc/contract', '@orpc/contract/*'],

  /**
   * Data access (`libs/lets-park/database`, Task 9). Prisma and nothing else — no HTTP
   * client, no frontend package.
   */
  data: ['tslib', 'prisma', 'prisma/*', '@prisma/client', '@prisma/*', '.prisma/*'],

  /**
   * `libs/lets-park/shared-types`: zero npm dependencies, by decision 0003. It is imported
   * by `apps/lets-park/api`, `libs/lets-park/contract` and `libs/shared/i18n` alike, so anything it pulls
   * in lands in all three. `[]` bans every package — Node builtins
   * (`node:fs`, …) are not npm nodes and stay allowed.
   */
  foundation: [],
};

/** Source files of every wrapper lib get their own package unbanned. */
const wrapperLibOverrides = Object.entries(WRAPPED_LIBRARIES).map(([pkg, { owner }]) => ({
  basePath: workspaceRoot,
  files: under(owner),
  rules: {
    'no-restricted-imports': ['error', restrictWrappedLibraries([pkg])],
    'no-restricted-syntax': ['error', ...restrictWrappedLibrariesDynamically([pkg])],
  },
}));

/**
 * `@nx/enforce-module-boundaries`'s `allow` list: imports of a **workspace-root
 * tooling config**, which the rule otherwise reads as a project reaching outside
 * its own root by relative path.
 *
 * Both entries are the tool's own prescribed shape, not dependency structure a
 * consumer could import instead:
 *
 * - `eslint.config.*` / `eslint.base.config.*` — every project's flat config
 *   re-exports the root one, which is how one `DEP_CONSTRAINTS` governs the
 *   whole workspace rather than fifteen hand-copied arrays.
 * - `jest.preset.js` — each `jest.config.cts` both sets `preset:` to it (a
 *   string, invisible to the rule) and `require()`s `buildTransformIgnorePatterns`
 *   out of it, so the one pnpm-aware `transformIgnorePatterns` builder is
 *   written once. That `require` is a real import, and it is what the second
 *   entry admits.
 *
 * Factored out because three separate rule blocks below restate the whole
 * option object — flat config replaces a rule's options rather than merging
 * them — and a list duplicated three times drifts.
 */
const TOOLING_CONFIG_IMPORTS = [
  '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
  '^.*/jest\\.preset\\.[cm]?js$',
];

/**
 * `@nx/enforce-module-boundaries`'s `depConstraints`, factored out to a named
 * constant so `libs/shared/form`'s test-only override below (`formSpecDepConstraints`)
 * can clone it rather than silently drifting from a second, hand-copied array.
 * Flat config replaces a rule's whole option object for a later, matching
 * config block — it does not merge — so any override has to restate every
 * entry, not just the one it changes (same reasoning as
 * `restrictWrappedLibraries` above).
 */
const DEP_CONSTRAINTS = [
  // --- type dimension -------------------------------------------
  // Every project carries exactly one `type:` tag, so this dimension
  // is where the npm allow-lists live. See NPM_ALLOWLIST above for
  // why they are not repeated on `scope:` / `ds:`.
  //
  // Layering, top to bottom, is acyclic:
  //   app → feature → ui → util → contract → foundation
  // `type:util` may depend on `type:contract` (that is what
  // `libs/shared/api-client` is for), and `type:contract` depends on
  // `layer:foundation` — not on `type:util` — so the two directions
  // no longer form a cycle at the tag level (Task 3 review, N3).
  //
  // Applications compose everything; nothing may depend on them.
  {
    sourceTag: 'type:app',
    onlyDependOnLibsWithTags: ['*'],
    allowedExternalImports: NPM_ALLOWLIST.app,
  },
  // Feature libs hold domain composition.
  {
    sourceTag: 'type:feature',
    onlyDependOnLibsWithTags: [
      'type:feature',
      'type:ui',
      'type:util',
      'type:contract',
      'type:data',
    ],
    allowedExternalImports: NPM_ALLOWLIST.feature,
  },
  // The design system is domain-free: it must never reach into
  // feature or application code.
  {
    sourceTag: 'type:ui',
    onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
    allowedExternalImports: NPM_ALLOWLIST.ui,
  },
  {
    sourceTag: 'type:util',
    onlyDependOnLibsWithTags: ['type:util', 'type:contract'],
    allowedExternalImports: NPM_ALLOWLIST.util,
  },
  // The contract sits below every wrapper and above the foundation:
  // Zod schemas plus the oRPC contract builder, nothing else.
  {
    sourceTag: 'type:contract',
    onlyDependOnLibsWithTags: ['layer:foundation'],
    allowedExternalImports: NPM_ALLOWLIST.contract,
  },
  {
    sourceTag: 'type:data',
    onlyDependOnLibsWithTags: ['type:data', 'type:util', 'type:contract'],
    allowedExternalImports: NPM_ALLOWLIST.data,
  },

  // --- foundation ------------------------------------------------
  // `libs/lets-park/shared-types` is the bottom of the graph: it depends on no
  // workspace lib and on no npm package. Both empty arrays are
  // load-bearing — `onlyDependOnLibsWithTags: []` rejects every
  // tagged target, `allowedExternalImports: []` rejects every
  // package. See doc/decision/0003-* and doc/decision/0017-*.
  {
    sourceTag: 'layer:foundation',
    onlyDependOnLibsWithTags: [],
    allowedExternalImports: NPM_ALLOWLIST.foundation,
  },

  // --- scope dimension ------------------------------------------
  // Keeps frontend-only libs (e.g. libs/shared/i18n, next-intl) out of
  // apps/lets-park/api, and backend-only libs out of apps/lets-park/web.
  // See doc/decision/0003-date-helpers-in-shared-types.md.
  {
    sourceTag: 'scope:web',
    onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
  },
  {
    sourceTag: 'scope:api',
    onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'],
  },
  {
    sourceTag: 'scope:shared',
    onlyDependOnLibsWithTags: ['scope:shared'],
  },

  // --- design-system layer dimension ----------------------------
  // Gone, deliberately. `ds:tokens` / `ds:primitives` / `ds:compounds` tagged
  // three Nx projects, and `@nx/enforce-module-boundaries` constrained the
  // tokens -> primitives -> compounds direction between them. The three layers
  // are now three directories of one project (`libs/shared/design-system`), and one
  // project carries one tag set, so there is no project boundary left for these
  // entries to match — leaving them here would be three constraints that never
  // fire, which is worse than none.
  //
  // The rule itself is unchanged and still enforced: `plan.md` line 51 states
  // it, and `libs/shared/design-system/eslint.config.mjs` now enforces it with
  // path-scoped `no-restricted-imports` groups that catch both the workspace
  // alias and a relative escape, each with a probe recorded beside it. See
  // doc/decision/0301-the-design-system-is-one-package-and-the-layer-rule-moved-to-lint-paths.md.
  //
  // The npm surface stays where it always was, on the `type:` dimension
  // (`doc/decision/0017-*`): a second allow-list on a `ds:` tag was probed at
  // Task 8's merge and does **not** intersect — Nx accepts a package as soon as
  // any matching constraint permits it.
];

/**
 * `depConstraints` for `libs/shared/form`'s own **test** files only: identical to
 * `DEP_CONSTRAINTS`, except the `type:util` entry also allows `type:ui`.
 *
 * Why this exists: `libs/shared/form`'s test suite demonstrates the wrapper's whole
 * reason for being — a real, Zod-validated, submittable form built from
 * `@lets-park/form` plus design-system primitives (`Input`, `Select`,
 * `Checkbox`), with no direct `react-hook-form` import anywhere in that file
 * (`doc/decision/0030-*`, Task 18). That demo can only run if the test file
 * may import the design system (`design-system`, `type:ui`), which the general
 * `type:util` constraint forbids — composing the design system is supposed to
 * happen in app/feature code (global constraint 5), and `libs/shared/form`'s own
 * *shipped* source must stay just as constrained as every other wrapper lib.
 *
 * Scoped to `libs/shared/form/**\/*.spec.{ts,tsx}` below, nowhere else: every other
 * `type:util` project, and `libs/shared/form`'s non-test source, still gets the
 * unmodified `DEP_CONSTRAINTS`.
 */
const formSpecDepConstraints = DEP_CONSTRAINTS.map((constraint) =>
  constraint.sourceTag === 'type:util'
    ? {
        ...constraint,
        onlyDependOnLibsWithTags: [...constraint.onlyDependOnLibsWithTags, 'type:ui'],
      }
    : constraint
);

/**
 * `depConstraints` for `libs/lets-park/calendar-export`'s own **test** files only:
 * identical to `DEP_CONSTRAINTS`, except the `type:util` entry also allows
 * `ical.js`.
 *
 * Why this exists: `ical.js` is Mozilla's RFC 5545 parser, a **devDependency**,
 * and it is the independent reader that makes those specs worth anything — a
 * test that asserts our own generated string back at us proves the template
 * matches itself, not that a calendar client can parse the feed. Nothing
 * shipped imports it, and `libs/lets-park/calendar-export`'s own shipped source must not:
 * `ical-generator` writes the feed, `ical.js` only reads it back in a test.
 *
 * Scoped rather than added to `NPM_ALLOWLIST.util`, which is where it started:
 * that list applies to every `type:util` project at once, so an entry there
 * reaches the shipped source of six unrelated wrapper libs that have no
 * business parsing calendars. Same shape as `formSpecDepConstraints` above.
 *
 * `apps/lets-park/api`'s calendar pipeline spec also uses it and needs no entry — it is
 * `type:app`, whose allow-list is broad by design.
 */
const calendarExportSpecDepConstraints = DEP_CONSTRAINTS.map((constraint) =>
  constraint.sourceTag === 'type:util'
    ? {
        ...constraint,
        allowedExternalImports: [...constraint.allowedExternalImports, 'ical.js'],
      }
    : constraint
);

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/.next',
      '**/coverage',
      '**/playwright-report',
      '**/test-output',
      // Exported design assets, not workspace source.
      'doc/**',
    ],
  },
  {
    files: LINTED_EXTENSIONS.map((ext) => `**/*.${ext}`),
    /**
     * `eslint.config.mjs` and `jest-environment-*.cjs` are tooling configs,
     * not application dependency structure: what they import is dictated by
     * the plugin/environment API (`@nx/eslint-plugin`, `jest-environment-jsdom`,
     * …), never ships to production, and has no analogue a consumer could
     * import instead. `DEP_CONSTRAINTS`'s `allowedExternalImports` is written
     * per `type:` tag to police *source* dependencies — widening it to admit
     * these packages would weaken it for exactly the application code it
     * exists to constrain, which is the opposite of why this block's `files`
     * was widened to cover them in the first place. Every other extension
     * under `apps/` and `libs/` — `jest.config.cts`, `playwright.config.mts`,
     * plain source — stays fully covered; this excludes only the two
     * tooling-config shapes that have no source-dependency reading.
     */
    ignores: ['**/eslint.config.{mjs,cjs}', '**/jest-environment-*.{cjs,mjs}'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: TOOLING_CONFIG_IMPORTS,
          depConstraints: DEP_CONSTRAINTS,
        },
      ],
    },
  },
  {
    files: LINTED_EXTENSIONS.map((ext) => `**/*.${ext}`),
    rules: {
      /**
       * Severity stays at Nx's `warn`; the lint target runs with
       * `--max-warnings=0` (see `nx.json`), so a warning still fails the build.
       * Only the options are tuned here, and only for bindings that **cannot be
       * deleted**:
       *
       * - `ignoreRestSiblings` — `const { icsToken: _token, ...rest } = user` is
       *   the idiomatic way to assert a field is absent from a projection. The
       *   named sibling exists solely so the rest element omits it; typescript-
       *   eslint defaults this to `false`, unlike the core ESLint rule.
       * - `argsIgnorePattern` / `caughtErrorsIgnorePattern` — a positional
       *   parameter before a used one, and a `catch` binding, cannot simply be
       *   removed. `_` marks the omission as deliberate.
       *
       * `varsIgnorePattern` is deliberately **not** set: an unused plain
       * variable can always just be deleted, so there is no honest reason to
       * silence it with a prefix.
       */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Wrapper layers are mandatory in application and library code.
  {
    basePath: workspaceRoot,
    files: under('apps').concat(under('libs')),
    rules: {
      'no-restricted-imports': ['error', restrictWrappedLibraries()],
      // The same ban for `require()` and `import()`, which
      // `no-restricted-imports` cannot see. See
      // `restrictWrappedLibrariesDynamically` for the probe that found the
      // hole and `doc/decision/0290-*` for why it is worth closing when no
      // violation exists.
      'no-restricted-syntax': ['error', ...restrictWrappedLibrariesDynamically()],
    },
  },
  ...wrapperLibOverrides,
  // See `formSpecDepConstraints` above: only `libs/shared/form`'s own test files may
  // reach the design system (`design-system`, `type:ui`), to demonstrate the wrapper
  // building a real form without a direct `react-hook-form` import.
  // `allowCircularSelfDependency` is needed alongside it because that same
  // demo imports `@lets-park/form` by its workspace alias from inside
  // `libs/shared/form` itself (the point being to prove the *public* API is enough),
  // which the boundary rule otherwise flags as a circular self-dependency.
  {
    basePath: workspaceRoot,
    files: ['libs/shared/form/**/*.spec.ts', 'libs/shared/form/**/*.spec.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allowCircularSelfDependency: true,
          allow: TOOLING_CONFIG_IMPORTS,
          depConstraints: formSpecDepConstraints,
        },
      ],
    },
  },
  // See `calendarExportSpecDepConstraints` above: `ical.js` is a test-only
  // reader, allowed in this lib's specs and nowhere else in `type:util`.
  {
    basePath: workspaceRoot,
    files: ['libs/lets-park/calendar-export/**/*.spec.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: TOOLING_CONFIG_IMPORTS,
          depConstraints: calendarExportSpecDepConstraints,
        },
      ],
    },
  },
  // `libs/lets-park/shared-types` has to stay dependency-free: it is imported by
  // apps/lets-park/api, libs/lets-park/contract and libs/shared/i18n alike. The Nx `type:util` constraint
  // cannot express this, because the same tag covers the wrapper libs, which
  // exist precisely to depend on third-party packages.
  // See doc/decision/0003-date-helpers-in-shared-types.md.
  {
    basePath: workspaceRoot,
    files: under('libs/lets-park/shared-types'),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...restrictWrappedLibraries().patterns,
            {
              group: ['zod', 'zod/*'],
              message:
                'libs/lets-park/shared-types must not depend on Zod — it is imported by apps/lets-park/api too. Zod schemas belong to libs/lets-park/contract (@lets-park/contract).',
            },
          ],
        },
      ],
    },
  },
  // Structured logging only (nestjs-pino on the backend); no ad-hoc console output.
  {
    basePath: workspaceRoot,
    files: ['apps/lets-park/api/**/*.ts', 'libs/**/*.ts', 'libs/**/*.tsx'],
    rules: {
      'no-console': 'error',
    },
  },
  /**
   * Type-aware linting for the backend and the libs: `no-floating-promises`
   * and `no-misused-promises`.
   *
   * `projectService: true` is what makes a *typed* rule possible at all — it
   * asks typescript-eslint to build a real program per file rather than parse
   * it standalone, which is also why it is the one block in this file that
   * costs measurable wall-clock time. Measured, three cold-cache runs of
   * `npm run lint` each: median **9.3s without this block, 14.8s with it** —
   * about 1.6x. `nx.json`'s lint `inputs` carry `^default` for the same reason
   * this block exists; see the note there.
   *
   * Why these two rules and no others: the codebase names the failure they
   * guard, in `apps/lets-park/api/src/reservations/composite-domain-event.publisher.ts`
   * — an escaping rejection is worse than an escaping throw, because `apps/lets-park/api`
   * installs no `unhandledRejection` handler, so Node's default terminates the
   * process **after COMMIT**, on a user's cancellation path.
   *
   * They cover different halves of that, and the split is worth stating
   * because the first commit here blurred it:
   *
   * - `no-floating-promises` catches a promise **created and dropped** — an
   *   `await` forgotten at a call site. Every `void`ed promise in the tree
   *   today is correct; what was missing was the enforcement, which rested
   *   entirely on convention and review. It found zero errors, and it is the
   *   regression guard, not a bug hunt.
   * - `no-misused-promises` catches the construct that actually produces the
   *   composite publisher's failure: an `async` method **declared** where the
   *   supertype says `void`. TypeScript's void-return assignability rule lets
   *   `Promise<void>` satisfy an abstract `publish(...): void`, so neither
   *   `tsc` nor the abstract-class DI token stops it, and neither does
   *   `no-floating-promises` — nothing floats at the call site; the composite
   *   calls a method it was told returns nothing.
   *   (`checksVoidReturn.inheritedMethods` is on by default, which is the
   *   sub-check that sees it.)
   *
   * So the composite's runtime try/catch is the dynamic half of that defense
   * and stays; this rule is the static half, and it stops the bad override
   * being written anywhere in `apps/lets-park/api` or `libs` in the first place. A
   * delegate injected from outside the linted tree is still the guard's job.
   * The only waiver is the two disables on `AsyncRejectingPublisher` in
   * `composite-domain-event.publisher.spec.ts`, which *is* the guard's test —
   * each carries a comment saying so.
   *
   * Cost of adding `no-misused-promises`: five errors, all in spec files, none
   * in production code. Two are that fixture; three were
   * `onSubmit={form.handleSubmit(...)}` in the `libs/shared/form` specs, fixed rather
   * than silenced — `(event) => void form.handleSubmit(...)(event)`.
   *
   * Its wall-clock cost is small, because the expensive part — building the
   * program — is already paid for by the rule above. Measured back to back,
   * median of three cold-cache runs each of
   * `npx nx run-many -t lint --skip-nx-cache` (the authoritative invocation;
   * Nx run duration): **23.4s without this rule, 25.7s with it**, about +10%.
   * Do not compare those to the `npm run lint` figures a few lines up — a
   * different command on a differently loaded machine. Only the deltas travel.
   *
   * `ignoreVoid` keeps its default (`true`): `void promise` stays the
   * documented way to say "detached on purpose", which is the convention the
   * existing sites already follow, each with a comment beside it. Turning it
   * off would not find a bug — it would demand ~24 disables for code the
   * analysis pass already read and cleared.
   *
   * **`apps/lets-park/web/**` is deliberately out.** Its React
   * `void queryClient.invalidateQueries(...)` sites need their own pass, and a
   * half-considered sweep of them would bury the backend result this block is
   * for. `.tsx` is listed for `libs/**` only, for the same reason: the design
   * system and the wrapper libs are in, the app's React tree is not.
   *
   * One visible consequence, so nobody "fixes" it by halves: the `libs/shared/form`
   * specs now wrap `handleSubmit` in `void`, while the two production callers
   * — `apps/lets-park/web/src/shell/settings-screen/settings-screen.tsx` and
   * `apps/lets-park/web/src/shell/admin/admin-spots-screen/admin-spots-screen.tsx` —
   * still pass it bare,
   * purely because `apps/lets-park/web/**` is outside this block. That is the same
   * finding waiting for the web pass, not an inconsistency to paper over.
   *
   * Scoped to `.ts`/`.tsx` rather than `LINTED_EXTENSIONS`: a file the
   * TypeScript project service does not own parses as a hard error rather than
   * a lint finding, and the `.cjs`/`.mjs` tooling configs are not in any
   * tsconfig.
   */
  {
    basePath: workspaceRoot,
    files: ['apps/lets-park/api/**/*.ts', 'libs/**/*.ts', 'libs/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: workspaceRoot,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  // Standalone scripts and tooling are allowed to print to the console.
  {
    basePath: workspaceRoot,
    files: [
      'tools/**',
      'scripts/**',
      '**/scripts/**',
      '**/*.config.ts',
      '**/*.config.cts',
      '**/*.config.mts',
      '**/*.config.js',
    ],
    rules: {
      'no-console': 'off',
    },
  },
];

import nx from '@nx/eslint-plugin';
import baseConfig, { restrictWrappedLibraries } from '../../../eslint.config.mjs';

/**
 * Packages the design system must not reach for, even though `type:ui` allows
 * them workspace-wide.
 *
 * The design system is a closed layer with a near-zero runtime dependency
 * surface — `src/primitives/lib/cx.ts` exists precisely so that no class-name
 * helper has to be installed. `NPM_ALLOWLIST.ui` in the root config cannot
 * express that, because it has to stay wide enough for the compounds layer,
 * which owns the TanStack Table wrapper.
 *
 * This is a `no-restricted-imports` rule rather than `allowedExternalImports`
 * on a tag, because **that does not work**, and it was probed rather than
 * assumed: with `clsx` on `NPM_ALLOWLIST.ui` and absent from a `ds:primitives`
 * list, an `import clsx from 'clsx'` in the primitives lib produced no error at
 * all. Nx does not intersect `allowedExternalImports` across tag dimensions —
 * one matching constraint that permits the package is enough. The root config
 * records the same finding.
 *
 * Probe this rule before trusting it: add `import clsx from 'clsx'` to any file
 * here and run `npx nx lint design-system --skip-nx-cache`. It must name `clsx`
 * and exit 1.
 */
const CLOSED_LAYER_BANS = [
  {
    group: ['clsx', 'clsx/*', 'classnames', 'tailwind-merge', 'class-variance-authority'],
    message:
      'The design system installs no class-name helper — use `cx` from `@garage/design-system/primitives`. See doc/decision/0052-overlay-tokens-and-one-layering-scale.md.',
  },
];

/**
 * The tokens -> primitives -> compounds direction, one way only.
 *
 * `plan.md` (§Fáze 2, line 51) states it and says to enforce it with Nx tags.
 * It was enforced that way until the three layers became three directories of
 * one project: `@nx/enforce-module-boundaries` constrains dependencies
 * *between projects*, and one project carries one tag set, so the `ds:tokens` /
 * `ds:primitives` / `ds:compounds` `depConstraints` had nothing left to match.
 * Same rule, different mechanism — see the decision record for the full
 * reconciliation.
 *
 * Each group catches **both** spellings of a cross-layer reach:
 *
 * - the workspace alias, `@garage/design-system/primitives`, which is what
 *   the existing cross-layer imports use and what new ones will copy;
 * - a relative escape, `../../../primitives/lib/button`, which is what someone
 *   sidestepping the alias would write.
 *
 * `**` in a `no-restricted-imports` group matches across path separators, so
 * `'**\/primitives'` matches the last segment of the alias and
 * `'**\/primitives/**'` matches anything under it, by either spelling. A rule
 * that caught only the alias would be trivially bypassable and would be the
 * fifth rule this workspace has shipped that reads as enforcement and enforces
 * nothing; see the root config's history of exactly that.
 *
 * There is no entry for the compounds layer: it may import both of the others,
 * which is the whole shape of the rule.
 */
const LAYER_BANS_TOKENS = [
  {
    group: ['**/primitives', '**/primitives/**', '**/compounds', '**/compounds/**'],
    message:
      'The tokens layer is the bottom of the design system: it may not import primitives or compounds. plan.md line 51.',
  },
];

const LAYER_BANS_PRIMITIVES = [
  {
    group: ['**/compounds', '**/compounds/**'],
    message:
      'Primitives may not import compounds — the direction is tokens -> primitives -> compounds, one way. plan.md line 51.',
  },
];

/**
 * The root's `@nx/enforce-module-boundaries` options, read back out of the base
 * config rather than hand-copied.
 *
 * Flat config *replaces* a rule's whole option object for a later matching
 * block — it does not merge — so an override has to restate every entry. Taking
 * the object from the live config is the version of that which cannot drift. It
 * throws rather than silently producing an empty constraint set, because
 * `depConstraints: []` would turn the rule off.
 */
function moduleBoundaryOptions() {
  for (const block of baseConfig) {
    const rule = block?.rules?.['@nx/enforce-module-boundaries'];
    if (Array.isArray(rule) && rule[1]?.depConstraints?.length > 0) {
      return rule[1];
    }
  }

  throw new Error(
    '@nx/enforce-module-boundaries options not found in the root config — this override would ' +
      'otherwise disable the rule for design-system rather than narrowing it.'
  );
}

const BOUNDARY_OPTIONS = moduleBoundaryOptions();

/**
 * `depConstraints` for this project's own **test** files only: identical to the
 * root's, except the `type:ui` entry also allows `tailwindcss`.
 *
 * Why this exists: `src/tokens/lib/theme-css.spec.ts` compiles
 * `assets/theme.css` with `compile()` from the real `tailwindcss`, at the
 * version the app builds with, and reads the emitted rules. That is the whole
 * point of it — the bridge file is hand-written, and the two claims it used to
 * make about the spacing scale were both false in a way only a compiler could
 * show. A re-implementation of Tailwind's resolution inside the test would
 * prove nothing about the file.
 *
 * Nothing shipped from this project imports `tailwindcss`, and nothing should.
 * Scoped to `src/tokens/**\/*.spec.ts` rather than added to `NPM_ALLOWLIST.ui`,
 * which would reach every `type:ui` project's shipped source — the same
 * reasoning the root config gives for `ical.js` in
 * `calendarExportSpecDepConstraints`.
 *
 * The glob names the tokens layer specifically, not `src/**\/*.spec.ts`. When
 * the three layers became three directories of one project, the project-wide
 * spelling would have handed the allowance to the primitives layer's three
 * plain spec files (`cx`, `gap`, `padding`) as well, which have no business
 * importing a CSS compiler. `src/tokens/lib/theme-css.spec.ts` is the only file
 * in the workspace that needs it, and the glob now says so. Probed in both
 * directions: an `import { compile } from 'tailwindcss'` in
 * `src/primitives/lib/cx.spec.ts` errors, and `theme-css.spec.ts`'s real import
 * lints clean.
 *
 * Probe it before trusting it: add `import { compile } from 'tailwindcss'` to
 * `src/tokens/lib/colors.ts` and run `npx nx lint design-system
 * --skip-nx-cache`. It must name `tailwindcss` and exit 1.
 */
const specDepConstraints = BOUNDARY_OPTIONS.depConstraints.map((constraint) =>
  constraint.sourceTag === 'type:ui'
    ? {
        ...constraint,
        allowedExternalImports: [...constraint.allowedExternalImports, 'tailwindcss'],
      }
    : constraint
);

export default [
  ...nx.configs['flat/react'],
  ...baseConfig,
  {
    /**
     * The layers import each other by their workspace alias
     * (`@garage/design-system/primitives`), which they did as separate
     * projects and still do as one. `@nx/enforce-module-boundaries` reads a
     * project importing its own alias as a circular self-dependency, so the
     * option below is what keeps those imports legal. `libs/shared/form`'s spec block
     * in the root config sets it for the same reason.
     *
     * Every other option is restated because flat config replaces the object.
     */
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        { ...BOUNDARY_OPTIONS, allowCircularSelfDependency: true },
      ],
    },
  },
  {
    // The project-wide baseline: the bare call, so `@tanstack/react-table`
    // stays **banned** here. Only the `src/compounds/**` block at the bottom of
    // this file exempts it, because only the compounds layer owns the DataTable
    // wrapper. Spreading the exemption here instead would hand it to the tokens
    // and primitives layers too — `no-restricted-imports` is one rule and the
    // last matching block replaces it outright, so a broad block beats a narrow
    // one regardless of order of intent.
    //
    // The patterns are spread back in at all because this block replaces the
    // root's copy of the rule, `wrapperLibOverrides` entry included.
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...restrictWrappedLibraries().patterns, ...CLOSED_LAYER_BANS],
        },
      ],
    },
  },
  {
    // The tokens layer emits CSS custom properties and reads its inputs from
    // disk. It has no runtime dependencies at all, and nothing here should
    // acquire one — React least of all, since a token is a string and not a
    // component.
    // `scripts/**/*.ts` is in this block because `scripts/build-tokens-css.ts`
    // is the tokens layer's build entry point — it lived under `tokens/` and
    // inherited these bans until the merge moved it up to the project root.
    files: ['src/tokens/**/*.ts', 'src/tokens/**/*.tsx', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...restrictWrappedLibraries().patterns,
            ...CLOSED_LAYER_BANS,
            ...LAYER_BANS_TOKENS,
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message:
                'The tokens layer emits CSS and must not depend on React — a token is a string, not a component.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/primitives/**/*.ts', 'src/primitives/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...restrictWrappedLibraries().patterns,
            ...CLOSED_LAYER_BANS,
            ...LAYER_BANS_PRIMITIVES,
          ],
        },
      ],
    },
  },
  {
    // The **only** block that exempts `@tanstack/react-table`, and the reason
    // the three blocks above all use the bare call. This layer owns the
    // DataTable wrapper — it is this package's entry in `WRAPPED_LIBRARIES`,
    // whose `owner` points at this directory — so it is the one place in the
    // workspace allowed to import the package directly.
    //
    // There is no layer ban here: compounds may import both primitives and
    // tokens, which is the whole shape of the rule.
    files: ['src/compounds/**/*.ts', 'src/compounds/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...restrictWrappedLibraries(['@tanstack/react-table']).patterns,
            ...CLOSED_LAYER_BANS,
          ],
        },
      ],
    },
  },
  {
    files: ['src/tokens/**/*.spec.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          ...BOUNDARY_OPTIONS,
          allowCircularSelfDependency: true,
          depConstraints: specDepConstraints,
        },
      ],
    },
  },
];

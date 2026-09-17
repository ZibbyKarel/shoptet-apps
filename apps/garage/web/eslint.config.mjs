import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig, { restrictWrappedLibrariesDynamically } from '../../../eslint.config.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    ignores: ['.next/**/*'],
  },
  // The application layer carries no Tailwind: `className` (and the DS
  // `wrapperClassName` escape hatch — see below) must never appear as a JSX
  // attribute here. See doc/decision/0311-the-application-layer-carries-no-tailwind.md.
  //
  // `react/forbid-dom-props` was considered and rejected: it only sees native
  // DOM elements, but `className` is also accepted (and spread onward) by
  // design-system components such as `Badge` and `Box`. A DOM-only rule would
  // enforce half of this and read as if it enforced all of it — the exact
  // "reads as enforcement, enforces nothing" failure the root and
  // design-system configs already document four times over. A plain
  // `JSXAttribute` selector sees every element, DS component included.
  //
  // The selector is `name.name=/[cC]lassName$/` rather than a literal
  // `='className'` match, so it also catches `wrapperClassName` — the prop
  // `Input`/`Select` expose specifically to let a caller hand raw Tailwind
  // through to their wrapper element (`admin-users-screen.tsx`,
  // `date-picker-dialog.tsx` both do this today). It is the same violation —
  // a Tailwind utility string written in app code — under a different prop
  // name, and a selector that only caught the exact spelling `className`
  // would leave that escape hatch open the day this rule lands.
  //
  // This is `no-restricted-syntax`, the same rule the root config uses for
  // the wrapper-library dynamic-import ban (`restrictWrappedLibrariesDynamically`,
  // around line 566 there). Flat config replaces a rule's whole option list
  // for a later matching block rather than merging it — the root config's own
  // comment near line 118 says so — so this block must spread that ban's
  // selectors back in, or adding this one would silently turn the
  // wrapper-library enforcement off for this app. Read back from the live
  // export rather than hand-copied, for the same reason
  // `libs/shared/design-system/eslint.config.mjs` reads `BOUNDARY_OPTIONS`
  // back out of `baseConfig` instead of restating it: a copy can drift, a
  // read cannot.
  //
  // Known limitation, not a bug: a `JSXAttribute` selector cannot see a type
  // declaration (`className?: string` in a props interface) or a spread
  // (`{...props}` forwarding one along) — only a literal attribute written in
  // JSX. `shell/admin/window-banner/window-banner.tsx` declares and forwards
  // exactly such a `className` prop; this rule does not and cannot flag it.
  {
    basePath: import.meta.dirname,
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name=/[cC]lassName$/]',
          message:
            'The app layer carries no Tailwind — compose @garage/design-system/primitives ' +
            'or /compounds instead of passing className/wrapperClassName. If no existing ' +
            'variant expresses what you need, add one to the design system rather than reaching ' +
            'for a class name here. See doc/decision/0311-the-application-layer-carries-no-tailwind.md.',
        },
        ...restrictWrappedLibrariesDynamically(),
      ],
    },
  },
];

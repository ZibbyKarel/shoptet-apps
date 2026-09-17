import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../../eslint.config.mjs';

export default [
  playwright.configs['flat/recommended'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      /**
       * `expect-expect` cannot see through a helper, and this suite has four
       * that are nothing but assertions: `expectFree` and `expectHeldBy` in
       * `support/lot-page.ts`, `waitForDayRoom` in `support/realtime.ts`, and
       * `expectLocale` in `src/locale.spec.ts`. Each wraps one or more
       * `expect` calls against UI copy, and inlining them so the linter can
       * see the assertion would mean repeating that copy in every spec — the
       * rule would be satisfied and the suite would be worse.
       *
       * They are listed by name rather than by an `expect*` glob so that adding
       * a helper is a deliberate act: a new one is invisible to the rule until
       * somebody says it asserts something.
       *
       * Naming them rather than switching the rule off keeps what the rule is
       * actually for — a `test()` that asserts nothing at all is still an
       * error, which is how a scenario silently reduces to "the page did not
       * throw". Exercised: a test whose body is only navigation still fails
       * this lint.
       */
      'playwright/expect-expect': [
        'error',
        { assertFunctionNames: ['expectFree', 'expectHeldBy', 'waitForDayRoom', 'expectLocale'] },
      ],
    },
  },
];

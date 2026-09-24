import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { compile } from 'tailwindcss';

import { COLOR_UTILITIES } from './color-utilities';
import { BREAKPOINTS } from './layout';
import { SPACING } from './spacing';

/**
 * Drift guard for `assets/theme.css`.
 *
 * `tokens.css` is generated and `generate-css.spec.ts` compares it to the
 * generator byte-for-byte. `theme.css` — the Tailwind v4 bridge that turns
 * those custom properties into utilities — is **hand-written**, says so at the
 * top of itself, and had nothing checking it at all. Add a token and it
 * silently gets no utility; rename one and the bridge emits `var(--gone)`,
 * which is not an error in CSS, just a property that resolves to nothing.
 *
 * So: every `--x` declared in `tokens.css` must either be referenced as
 * `var(--x)` by `theme.css` or appear in `UNMAPPED_ON_PURPOSE` below — which is
 * the prose at the bottom of `theme.css` turned into a list a test can read.
 *
 * The last two tests compile the bridge through the real Tailwind and read the
 * emitted rules, because the spacing block used to carry a justification that
 * was false in both halves and nothing could tell.
 */

const ASSETS = join(__dirname, '../../../assets');
const THEME_CSS_PATH = join(ASSETS, 'theme.css');
const tokensCss = readFileSync(join(ASSETS, 'tokens.css'), 'utf-8');
const themeCss = readFileSync(THEME_CSS_PATH, 'utf-8');

/**
 * Comments are stripped first, and that is not a detail: `theme.css` documents
 * the unmapped tokens by showing how to consume them (`max-w-[var(--modal-w-sm)]`,
 * `z-[var(--z-overlay)]`, ...). Counting those as references would make this
 * test pass for six of the tokens it is supposed to be strictest about.
 */
const themeCode = themeCss.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Every first capture group of `pattern` in `source`, in order. */
function captured(source: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const [, group] = match;
    if (group !== undefined) {
      found.push(group);
    }
  }

  return found;
}

const declaredTokens = captured(tokensCss, /^ {2}--([a-z0-9-]+):/gm);
const referencedTokens = new Set(captured(themeCode, /var\(--([a-z0-9-]+)\)/g));

/**
 * Tokens `theme.css` deliberately does not map into a Tailwind namespace, with
 * the reason each one is excluded. Kept as one list rather than as prose so
 * that a token added to this file forces a decision, and a token deleted from
 * `tokens.css` breaks the list instead of rotting inside it.
 */
const UNMAPPED_ON_PURPOSE: Record<string, string> = {
  // Tailwind v4's `duration-*` utilities take a bare numeric scale, not a named
  // theme lookup. Only `--dur-base` is wired, through the one namespace
  // Tailwind does read for it: `--default-transition-duration`.
  'dur-fast': 'no --duration-* namespace exists; use duration-[var(--dur-fast)]',
  'dur-slow': 'no --duration-* namespace exists; use duration-[var(--dur-slow)]',
  // `--container-*` in Tailwind v4 means @container query breakpoints, which is
  // a different concept from a content max-width.
  container: 'the --container-* namespace is for @container queries; use max-w-[var(--container)]',
  'container-wide': 'same as --container',
  // No `--height-*` namespace; heights come off the spacing scale, and routing
  // them through it would also mint bogus w-/p- utilities.
  'control-h-sm': 'no --height-* namespace; use h-[var(--control-h-sm)]',
  'control-h-md': 'no --height-* namespace; use h-[var(--control-h-md)]',
  'control-h-lg': 'no --height-* namespace; use h-[var(--control-h-lg)]',
  'control-h-xl': 'no --height-* namespace; use h-[var(--control-h-xl)]',
  'switch-w': 'switch geometry is one fixed drawing, not a scale',
  'switch-h': 'switch geometry is one fixed drawing, not a scale',
  'switch-pad': 'switch geometry is one fixed drawing, not a scale',
  'switch-knob': 'switch geometry is one fixed drawing, not a scale',
  'switch-knob-shadow': 'switch geometry is one fixed drawing, not a scale',
  // No `--z-index-*` namespace; z-index comes off a bare numeric scale.
  'z-sticky': 'no --z-index-* namespace; use z-[var(--z-sticky)]',
  'z-bar': 'no --z-index-* namespace; use z-[var(--z-bar)]',
  'z-overlay': 'no --z-index-* namespace; use z-[var(--z-overlay)]',
  'z-dropdown': 'no --z-index-* namespace; use z-[var(--z-dropdown)]',
  'z-toast': 'no --z-index-* namespace; use z-[var(--z-toast)]',
  // No `--width-*` / `--border-width-*` namespace either.
  'modal-w-sm': 'no --width-* namespace; use max-w-[var(--modal-w-sm)]',
  'modal-w-md': 'no --width-* namespace; use max-w-[var(--modal-w-md)]',
  'menu-min-w': 'no --width-* namespace; use min-w-[var(--menu-min-w)]',
  'tab-indicator-h': 'no --border-width-* namespace; use border-b-[length:var(--tab-indicator-h)]',
  'toast-w': 'no --width-* namespace; use max-w-[var(--toast-w)]',
};

/**
 * Located by walking up from this file rather than with `require.resolve`:
 * Jest's resolver maps `*.css` to a JavaScript stub, so asking it for
 * `tailwindcss/index.css` hands back a module and the compiler dies on
 * `Invalid declaration: 'var Reflect'`.
 */
function tailwindIndexCss(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, 'node_modules/tailwindcss/index.css');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('tailwindcss/index.css not found above ' + __dirname);
    }
    dir = parent;
  }
}

/** Compiles `theme.css` for real and returns the rules the candidates emit. */
async function emit(candidates: string[]): Promise<string> {
  const compiler = await compile(themeCss, {
    base: dirname(THEME_CSS_PATH),
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? tailwindIndexCss() : resolve(base, id);

      return { path, base: dirname(path), content: readFileSync(path, 'utf-8') };
    },
  });

  return compiler.build(candidates);
}

function ruleFor(css: string, utility: string): string | undefined {
  const escaped = utility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`\\.${escaped}\\s*\\{[^}]*\\}`));

  return match?.[0].replace(/\s+/g, ' ');
}

describe('theme.css bridges every token it does not explicitly decline', () => {
  it('reads a non-trivial number of tokens, so a broken parser cannot pass vacuously', () => {
    expect(declaredTokens.length).toBeGreaterThan(100);
    expect(referencedTokens.size).toBeGreaterThan(80);
  });

  it('maps every token in tokens.css, or declines it by name', () => {
    const unaccounted = declaredTokens.filter(
      (name) => !referencedTokens.has(name) && !(name in UNMAPPED_ON_PURPOSE)
    );

    expect(unaccounted).toEqual([]);
  });

  it('declines nothing that no longer exists', () => {
    const stale = Object.keys(UNMAPPED_ON_PURPOSE).filter((name) => !declaredTokens.includes(name));

    expect(stale).toEqual([]);
  });

  it('never references a token tokens.css does not declare', () => {
    // This is the `var(--gone)` case: valid CSS, resolves to nothing, no error
    // anywhere. Only a comparison against the generated file can see it.
    const dangling = [...referencedTokens].filter((name) => !declaredTokens.includes(name));

    expect(dangling).toEqual([]);
  });

  it('mints exactly the colour utilities COLOR_UTILITIES names, and no others', () => {
    // Both directions. A colour added to `colors.ts` but never bridged gets no
    // utility; a `--color-*` left here after its token was renamed produces a
    // utility that resolves to nothing. `COLOR_UTILITIES` is derived from the
    // token modules, so this is what keeps the two ends honest — and what lets
    // `disabled-styling.spec.tsx` and `contrast.spec.tsx` in the primitives lib
    // stop hand-maintaining a list of colour names.
    const inTheme = captured(themeCode, /^ {2}--color-([a-z0-9-]+):/gm).sort();

    expect(inTheme).toEqual(Object.keys(COLOR_UTILITIES).sort());
  });

  it('keeps its literal breakpoints equal to BREAKPOINTS', () => {
    // These five cannot be `var()`: Tailwind resolves `--breakpoint-*` at build
    // time inside `@media`, and a custom property cannot be substituted into a
    // media query. So they are the one hand-copied block in the file, and this
    // is the only thing that stops them drifting from `layout.ts`.
    const inTheme: Record<string, string> = {};
    for (const match of themeCode.matchAll(/--breakpoint-([a-z0-9]+):\s*([^;]+);/g)) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) {
        inTheme[key] = value.trim();
      }
    }

    expect(inTheme).toEqual(BREAKPOINTS);
  });
});

describe('theme.css spacing scale, as compiled', () => {
  it('binds every enumerated key to its --space-* token', async () => {
    const keys = Object.keys(SPACING);
    const css = await emit(keys.map((key) => `p-${key}`));

    for (const key of keys) {
      expect(ruleFor(css, `p-${key}`)).toBe(`.p-${key} { padding: var(--space-${key}); }`);
    }
  });

  it('leaves the scale open: an off-scale number still mints a utility', async () => {
    // The enumeration is not a fence and this file no longer claims it is. See
    // `doc/decision/0268-the-spacing-scale-is-open-by-design-and-the-enumeration-is-what-binds-it-to-the-tokens.md`.
    const css = await emit(['p-7', 'w-70', 'max-w-96', 'min-h-80']);

    expect(ruleFor(css, 'p-7')).toBe('.p-7 { padding: calc(var(--spacing) * 7); }');
    expect(ruleFor(css, 'w-70')).toBe('.w-70 { width: calc(var(--spacing) * 70); }');
    expect(ruleFor(css, 'max-w-96')).toBe('.max-w-96 { max-width: calc(var(--spacing) * 96); }');
    expect(ruleFor(css, 'min-h-80')).toBe('.min-h-80 { min-height: calc(var(--spacing) * 80); }');
  });

  it('resolves colour utilities to the token file, not to a literal', async () => {
    const css = await emit(['bg-brand-blue', 'text-fg-2']);

    expect(ruleFor(css, 'bg-brand-blue')).toContain('var(--brand-blue)');
    expect(ruleFor(css, 'text-fg-2')).toContain('var(--fg-2)');
  });
});

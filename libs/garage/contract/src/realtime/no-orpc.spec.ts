/**
 * Proof that `@garage/contract/realtime` is a genuinely separate entry point.
 *
 * The claim is structural, so lint cannot be the evidence: `@orpc/contract` is
 * on this lib's npm allow-list (the API entry point needs it) and `@orpc/client`
 * is physically installed in the workspace, so `@nx/enforce-module-boundaries`
 * would happily let `src/realtime` import either. The only honest check is the
 * module graph itself.
 *
 * So this file walks the graph: starting at `src/realtime/index.ts` it follows
 * every `import` / `export … from` specifier transitively across relative paths
 * and asserts what the reachable set contains.
 *
 * A graph walker that silently matches nothing would pass vacuously, which is
 * exactly the failure mode this test exists to rule out. It therefore carries
 * its own control: pointed at `src/api/index.ts`, the same walker **must** find
 * `@orpc/contract`. If it does not, the walker is broken and the suite fails —
 * rather than reporting a green that means nothing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname, '..');

/**
 * Matches the module specifier of a static `import`/`export … from`, plus
 * `import type`, side-effect imports and `require()`.
 *
 * Deliberately a regex rather than a TypeScript AST walk: the check has to be
 * readable and to have no dependency of its own beyond `node:fs`. It errs
 * towards over-matching (a specifier inside a comment would be followed too),
 * which for this purpose is the safe direction — a false positive fails the
 * test, a false negative would hide one.
 */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(SPECIFIER)].map((match) => match[1] as string);
}

/** Resolves a relative specifier to a `.ts` file inside `src/`. */
function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Cannot resolve '${specifier}' from ${relative(SRC_ROOT, fromFile)}`);
}

interface Graph {
  /** Every workspace file reachable from the entry, relative to `src/`. */
  files: string[];
  /** Every non-relative specifier reachable from the entry. */
  externals: string[];
}

function walk(entry: string): Graph {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) {
      continue;
    }
    files.add(file);

    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        queue.push(resolveRelative(file, specifier));
      } else {
        externals.add(specifier);
      }
    }
  }

  return {
    files: [...files].map((file) => relative(SRC_ROOT, file)).sort(),
    externals: [...externals].sort(),
  };
}

const realtime = walk(join(SRC_ROOT, 'realtime/index.ts'));

describe('the module-graph walker', () => {
  // Control: without this, every assertion below could pass because the walker
  // found nothing at all.
  const api = walk(join(SRC_ROOT, 'api/index.ts'));

  it('finds @orpc/contract in the API entry point', () => {
    expect(api.externals).toContain('@orpc/contract');
  });

  it('reaches more than the entry file itself in both entry points', () => {
    expect(api.files.length).toBeGreaterThan(1);
    expect(realtime.files.length).toBeGreaterThan(1);
  });

  it('follows relative imports transitively, not just one level', () => {
    // `realtime/index.ts` imports `./events`, which imports `../schemas/...`.
    expect(realtime.files).toContain('realtime/events.ts');
    expect(realtime.files).toContain('schemas/entities.ts');
    expect(realtime.files).toContain('schemas/primitives.ts');
  });

  it('fails loudly on a specifier it cannot resolve', () => {
    expect(() => resolveRelative(join(SRC_ROOT, 'realtime/index.ts'), './nope')).toThrow();
  });
});

describe('@garage/contract/realtime', () => {
  it('pulls in no @orpc package, transitively', () => {
    expect(realtime.externals.filter((name) => name.startsWith('@orpc'))).toEqual([]);
  });

  it('reaches no file under src/api', () => {
    // The isolation has to hold in the graph, not only in the direct imports:
    // one hop through `../api/errors` would drag `@orpc/contract` back in.
    expect(realtime.files.filter((file) => file.startsWith('api/'))).toEqual([]);
  });

  it('depends on exactly zod and the foundation lib', () => {
    // Pinned rather than filtered, so a *new* external dependency also fails
    // this test and has to be argued for.
    expect(realtime.externals).toEqual(['@garage/shared-types', 'zod']);
  });

  it('is not re-exported from the root entry point', () => {
    // Two entry points, not one barrel with a realtime section: importing
    // `@garage/contract` must not pull the socket contract in either.
    const root = walk(join(SRC_ROOT, 'index.ts'));
    expect(root.files.filter((file) => file.startsWith('realtime/'))).toEqual([]);
  });
});

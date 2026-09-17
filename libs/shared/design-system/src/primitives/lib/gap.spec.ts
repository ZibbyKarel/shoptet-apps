import {
  GAP_CLASSES,
  GAP_X_CLASSES,
  GAP_Y_CLASSES,
  resolveGap,
  resolveGapX,
  resolveGapY,
} from './gap';
import type { SpacingKey } from '@garage/design-system/tokens';

const STEPS: readonly SpacingKey[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];

describe('GAP_CLASSES', () => {
  it('has all 13 spacing steps, each mapping to the matching literal', () => {
    expect(
      Object.keys(GAP_CLASSES)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([...STEPS].sort((a, b) => a - b));

    for (const step of STEPS) {
      // Built by interpolation here, not in the source map: this produces no
      // class literal for Tailwind's scanner to (mis)read, so it cannot
      // itself go stale the way a hand-typed table entry can.
      expect(GAP_CLASSES[step]).toBe(`gap-${step}`);
    }
  });
});

describe('resolveGap', () => {
  it('resolves each step to its gap-* class', () => {
    for (const step of STEPS) {
      expect(resolveGap(step)).toBe(`gap-${step}`);
    }
  });
});

describe('GAP_X_CLASSES', () => {
  it('has all 13 spacing steps, each mapping to the matching literal', () => {
    expect(
      Object.keys(GAP_X_CLASSES)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([...STEPS].sort((a, b) => a - b));

    for (const step of STEPS) {
      expect(GAP_X_CLASSES[step]).toBe(`gap-x-${step}`);
    }
  });
});

describe('GAP_Y_CLASSES', () => {
  it('has all 13 spacing steps, each mapping to the matching literal', () => {
    expect(
      Object.keys(GAP_Y_CLASSES)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual([...STEPS].sort((a, b) => a - b));

    for (const step of STEPS) {
      expect(GAP_Y_CLASSES[step]).toBe(`gap-y-${step}`);
    }
  });
});

describe('resolveGapX', () => {
  it('resolves each step to its gap-x-* class', () => {
    for (const step of STEPS) {
      expect(resolveGapX(step)).toBe(`gap-x-${step}`);
    }
  });
});

describe('resolveGapY', () => {
  it('resolves each step to its gap-y-* class', () => {
    for (const step of STEPS) {
      expect(resolveGapY(step)).toBe(`gap-y-${step}`);
    }
  });
});

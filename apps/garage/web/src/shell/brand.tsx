'use client';

/**
 * The logo lockup: a blue rounded tile carrying a `P`, next to the wordmark.
 *
 * Drawn twice in the design at two sizes — 52 px on the login canvas
 * (`doc/design/screens/canvas-default.png`) and 30 px in the top bar
 * (`02-avatar-menu.png`) — so it is one component with a size step rather than
 * two pieces of markup that can drift.
 *
 * It lives in app code, not in the design system: a design system is
 * domain-free, and a product's own logo is the most domain-specific thing
 * there is (global constraint 5).
 *
 * **Rounded to tokens.** The design's exact boxes are 52 px / 30 px with 16 px
 * / 9 px radii; the token scale offers 48 px / 32 px (`--space-12` /
 * `--space-8`) and 16 px / 8 px (`--radius-md` / `--radius-xs`). Snapping to
 * the scale rather than hand-writing four pixel values is the rule
 * `doc/decision/0011-derived-control-tokens-and-rounding.md` set for exactly
 * this situation.
 *
 * **Composed from `IconCircle`/`Text`/`Stack` rather than raw Tailwind** —
 * this app carries no Tailwind of its own.
 *
 * `IconCircle` now covers both size steps this lockup needs: `md` (`size-8`,
 * 32px) for the top bar's `sm` step, and `lg` (`size-12`, 48px, added for
 * this exact tile) for the login screen's `lg` step — restoring the design's
 * 48px tile instead of the previous 32px regression. The glyph's `fontSize`
 * scale now has `md` (`text-md`) and `2xl` (`text-2xl`) too, so the "P"
 * glyph is drawn at the design's own two sizes rather than rounded down to
 * `base`/`xl`.
 */

import { IconCircle, Stack, Text } from '@garage/design-system/primitives';
import { useTranslations } from '@garage/i18n';

export type BrandSize = 'sm' | 'lg';

/** Per-size step, expressed entirely in design-system props. */
const SIZE_CONFIG: Record<
  BrandSize,
  {
    readonly tileSize: 'md' | 'lg';
    readonly tileFontSize: 'md' | '2xl';
    readonly wordmarkSize: 'md' | '2xl';
    readonly wordmarkTracking: 'snug' | 'tight';
    readonly gap: 2 | 3;
  }
> = {
  sm: { tileSize: 'md', tileFontSize: 'md', wordmarkSize: 'md', wordmarkTracking: 'snug', gap: 2 },
  lg: {
    tileSize: 'lg',
    tileFontSize: '2xl',
    wordmarkSize: '2xl',
    wordmarkTracking: 'tight',
    gap: 3,
  },
};

export interface BrandProps {
  /** Diameter step. Defaults to the top bar's. */
  readonly size?: BrandSize;
  /**
   * Renders the wordmark as the page's `<h1>` instead of a plain span.
   *
   * Opt-in, and only the login screen passes it: that page has no other
   * heading, whereas inside the app the `<h1>` belongs to the screen's own
   * title and a second one in the top bar would break the outline.
   */
  readonly asHeading?: boolean;
}

export function Brand({ size = 'sm', asHeading = false }: BrandProps) {
  const t = useTranslations('shell');
  const config = SIZE_CONFIG[size];

  return (
    <Stack direction="row" align="center" spacing={config.gap}>
      {/*
       * `sm` renders at `IconCircle`'s `md` step (`size-8`/`rounded-xs`,
       * 32px) — unchanged from before. `lg` now renders at `IconCircle`'s
       * `lg` step (`size-12`, 48px), restoring the design's larger tile
       * instead of the previous fallback to `md`.
       */}
      <IconCircle
        aria-hidden="true"
        shape="square"
        tone="blue"
        size={config.tileSize}
        fontSize={config.tileFontSize}
        weight="bold"
      >
        P
      </IconCircle>
      <Text
        as={asHeading ? 'h1' : 'span'}
        size={config.wordmarkSize}
        weight="bold"
        tracking={config.wordmarkTracking}
      >
        {t('brand')}
      </Text>
    </Stack>
  );
}

/**
 * The dashboard palette this line draws: the NPC property dashboard's own.
 *
 * The dashboard's brand colours are tokens `token-resolver.ts` derives from
 * three White Label inputs (primary, accent, brand); its surfaces and its
 * semantic colours are fixed. The prime draws NPC's palette because its
 * `whitelabel_settings` row stores those three. Read from the prime on
 * 2 Oct 2026:
 *
 *   primary  228 94% 45%    royal blue: active navigation, buttons, focus rings
 *   accent   296 100% 44%   magenta: secondary emphasis, supporting chart colours
 *   brand    258 98% 48%    violet: the `--brand` ramp
 *
 * This deployment's row was never written. Provisioning copies the schema and
 * not the rows (`docs/operations/CLONE_PROVISIONING_GAPS.md`), so the table
 * held zero rows, `BrandProvider` kept `defaultBrandConfig`, and the resolver
 * fell back to the platform defaults: Aurixa gold on obsidian. That is the
 * right look for an unbranded platform deployment, and the wrong one here.
 * The gold left on the page (the group labels, the start of the active item)
 * is `--warning`, which no brand moves, and the prime draws it too.
 *
 * Three rules.
 *
 * - **A stored colour always wins.** A colour is filled only where the row
 *   holds none the resolver can read, so a colour saved on the White Label
 *   page takes over field by field, as it does on the prime.
 * - **The theme only.** This is applied where the dashboard's tokens are
 *   resolved and never to `settings`, because documents read
 *   `settings.brandColor` (`resolveRecordBrand`, `highlightColourFor`).
 * - **The platform defaults are untouched.** `brand-defaults.ts` and the
 *   resolver are shared with the prime and still describe an unbranded
 *   deployment.
 *
 * `BrandProvider.tsx` and `WhiteLabel.tsx` are shared with the prime, so a
 * cascade that brings either back without this call puts the dashboard back
 * in gold and nothing else notices. `linePalette.spec.tsx` does, from its own
 * step in `ci.yml`.
 */
import type { BrandConfig } from './brand-types';
import { normalizeHslString } from './color-utils';

type BrandColours = Pick<BrandConfig, 'primaryColor' | 'accentColor' | 'brandColor'>;

export const LINE_PALETTE = {
  primaryColor: '228 94% 45%',
  accentColor: '296 100% 44%',
  brandColor: '258 98% 48%',
} as const satisfies Record<keyof BrandColours, string>;

/** Whether the resolver can read a stored colour. It falls back on anything it cannot. */
function isStored(colour: unknown): colour is string {
  return normalizeHslString(colour, '') !== '';
}

/**
 * The colours the dashboard draws: the deployment's own where it stored them,
 * the line's where it did not. Returns a copy and leaves every other field as
 * it was.
 */
export function withLinePalette<T extends BrandColours>(
  config: T,
): T & Record<keyof BrandColours, string> {
  return {
    ...config,
    primaryColor: isStored(config.primaryColor) ? config.primaryColor : LINE_PALETTE.primaryColor,
    accentColor: isStored(config.accentColor) ? config.accentColor : LINE_PALETTE.accentColor,
    brandColor: isStored(config.brandColor) ? config.brandColor : LINE_PALETTE.brandColor,
  };
}

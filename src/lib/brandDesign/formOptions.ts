/**
 * The vocabulary the design-system form offers, in words a person can choose by.
 *
 * The option *values* are owned by `options.pure.ts`; what lives here is the
 * label and the one-line explanation for each, because "opener_band" on a
 * dropdown tells nobody anything and the difference between `ledger` and
 * `classic` tables is the sort of thing you should not have to render a PDF to
 * discover.
 *
 * ## Why this is a `.ts` and not part of the `.tsx`
 *
 * The suggested brand colours are hex literals, and the style ratchet
 * (`scripts/audit-style-tokens.cjs`) counts hex literals in `.tsx` as hardcoded
 * colour. It is right to: a hex in a component is almost always a colour
 * somebody typed instead of using a token. These are neither — they are *data*,
 * the starting points offered for a document's own brand colour, which has
 * nothing to do with the application's theme. Keeping them in a module the
 * ratchet does not scan keeps that distinction honest rather than suppressed.
 */
/* eslint-disable no-restricted-syntax --
 * `SUGGESTED_BRAND_HEXES` is document data, not application theme. These are the
 * starting points offered for the accent a generated PDF prints in, chosen per
 * design system; they never reach a component's styling. The rule is right about
 * everything else in `src/`, which is why the exception is written down here
 * rather than the values being hidden from it.
 */
import type {
  ReportChapterStyle,
  ReportCoverStyle,
  ReportDensity,
  ReportTableStyle,
} from '@/lib/reportDesign/options.pure';
import type { ReportPreset } from '@/lib/reportDesign/brandResolve.pure';

export interface LabelledOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

export const PRESET_OPTIONS: ReadonlyArray<LabelledOption<ReportPreset>> = [
  {
    value: 'signature',
    label: 'Signature',
    hint: 'Warm ivory paper with a deep field. The house look.',
  },
  {
    value: 'editorial_navy',
    label: 'Editorial navy',
    hint: 'Cooler paper, a navy field. Reads as a broadsheet.',
  },
  {
    value: 'minimal_ink',
    label: 'Minimal ink',
    hint: 'Near-white with a champagne alternate. Quiet, and the most paper-frugal.',
  },
  {
    value: 'high_contrast',
    label: 'High contrast',
    hint: 'The accessible option. Every role sits well clear of its floor.',
  },
];

export const DENSITY_OPTIONS: ReadonlyArray<LabelledOption<ReportDensity>> = [
  { value: 'compact', label: 'Compact', hint: 'Tight leading. Fewer pages, more work to read.' },
  { value: 'balanced', label: 'Balanced', hint: 'The default, and right for most documents.' },
  { value: 'spacious', label: 'Spacious', hint: 'Generous. Adds real pages to a long report.' },
];

export const CHAPTER_STYLE_OPTIONS: ReadonlyArray<LabelledOption<ReportChapterStyle>> = [
  { value: 'classic', label: 'Classic', hint: 'A number, a rule, a title.' },
  { value: 'opener_band', label: 'Opener band', hint: 'A tinted band across the chapter head.' },
  { value: 'minimal', label: 'Minimal', hint: 'Title only. No rule, no number block.' },
];

export const TABLE_STYLE_OPTIONS: ReadonlyArray<LabelledOption<ReportTableStyle>> = [
  { value: 'classic', label: 'Classic', hint: 'Header rule and row separators.' },
  { value: 'ledger', label: 'Ledger', hint: 'Banded rows. Easiest to follow across a wide table.' },
  { value: 'minimal', label: 'Minimal', hint: 'Whitespace only. Elegant, and hard on a dense table.' },
];

export const COVER_STYLE_OPTIONS: ReadonlyArray<LabelledOption<ReportCoverStyle>> = [
  { value: 'image', label: 'Image', hint: 'Full-bleed cover art, when the tenant has some.' },
  { value: 'title_overlay', label: 'Title overlay', hint: 'Title set over a tinted field.' },
  { value: 'editorial', label: 'Editorial', hint: 'Type only. No image, no field.' },
];

/**
 * Starting points for a brand colour.
 *
 * Every one of these clears its contrast floors under all four presets, so a
 * person who picks one and saves immediately gets a legible document. That is
 * the point of offering any: the audit refuses an illegible hue, and being
 * refused on your first attempt is a poor introduction to a feature.
 */
export const SUGGESTED_BRAND_HEXES: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#2F5D50', name: 'Forest' },
  { hex: '#1F3A5F', name: 'Navy' },
  { hex: '#7A3B2E', name: 'Terracotta' },
  { hex: '#4A3B6B', name: 'Aubergine' },
  { hex: '#0F5C63', name: 'Teal' },
  { hex: '#6B4A16', name: 'Bronze' },
];

/** `#RRGGBB`, the only shape the reader accepts. */
export const BRAND_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Example briefs, so the box is not a blank page. */
export const BRIEF_EXAMPLES: readonly string[] = [
  'A boutique buyers’ agency writing for first-time investors. Warm and editorial, '
  + 'never corporate. The documents are read on a phone as often as on paper.',
  'A finance broker’s serviceability reports for lender submission. Dense, tabular, '
  + 'unmistakably professional. Nobody reads these for pleasure.',
];

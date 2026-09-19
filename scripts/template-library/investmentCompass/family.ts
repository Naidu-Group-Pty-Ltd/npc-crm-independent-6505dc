/**
 * Investment Compass — the family model.
 *
 * ## Two halves, deliberately separated
 *
 * **Transcribed** (in `families.generated.ts`, emitted from `source.json`):
 * family key, name, note, faces, every manifest key and value, every variant's
 * name, code, ground, density, architecture, recommended use, description and
 * override set. Ten families × five variants is ~250 manifest entries, which is
 * not a thing anyone transcribes by hand correctly — so it is mechanical, and a
 * spec re-checks it against the source on every run.
 *
 * **Measured** (this file): point sizes, margins and rhythm. The catalogue names
 * typography as a preset (`cinzel_playfair_inter`) and spacing as a scale name
 * (`generous`); the actual measurements exist only in the ten drawn archetype
 * files. `TYPOGRAPHY` below records what each family's pages actually set, with
 * the measurement beside each value.
 *
 * ## What a variant is
 *
 * A `base` manifest plus a sparse override object. `resolveManifest()` is the
 * catalogue's own `Object.assign({}, base, overrides)`. That is what makes fifty
 * masters describable rather than fifty hand-drawn documents — and it is why
 * `templates.ts` holds ONE composition rather than fifty.
 *
 * ## Only the reference is drawn
 *
 * The catalogue computes archetype coverage as `BUILT` when `axisIndex === 0`
 * and `MANIFEST` otherwise, and says so: "This is the family reference. The
 * other four variants are expressed as overrides on it." Each family therefore
 * has one drawn expression and four declarative ones.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. The manifest vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved manifest for one master template.
 *
 * Keys mirror the approved source exactly. The optional ones are genuinely
 * optional there — `image_slots` appears only on the two photographic families,
 * `capital_framing` only on Wealth Management, `field_keys` only on Dark
 * Executive — so making them required would invent values no designer set.
 */
export interface TemplateManifest {
  design_family: string;
  typography_preset: string;
  numeric_typography: string;
  cover_overlay: string;
  section_header_style: string;
  kpi_layout: string;
  callout_style: string;
  table_style: string;
  chart_style: string;
  navigation_style: string;
  risk_display: string;
  recommendation_style: string;
  radius: string;
  border_treatment: string;
  spacing_scale: string;
  page_margin_preset: string;
  toc_style: string;
  footer_style: string;
  density: string;
  print_density: string;
  image_slots?: string;
  capital_framing?: string;
  field_keys?: string;
}

export type Density = 'compact' | 'balanced' | 'spacious';
export type Ground = 'light' | 'dark';

/**
 * The five variant axes, in the catalogue's order.
 *
 * Positional: the axis is assigned by index, so the first variant of every
 * family is its reference and the fifth its presentation cut.
 */
export const AXES = [
  'A · reference',
  'B · condensed',
  'C · expansive',
  'D · architecture',
  'E · presentation',
] as const;

/** The seven report archetypes every family covers. */
export const ARCHETYPES = [
  'Cover',
  'Executive dashboard',
  'Narrative',
  'Dense data',
  'Chart and scenario',
  'Risk and recommendation',
  'Sources and appendix',
] as const;

export interface VariantDefinition {
  /** Approved template name, e.g. "Sovereign Folio". */
  name: string;
  /** Approved catalogue code, e.g. "pb-03". */
  code: string;
  ground: Ground;
  density: Density;
  /** Page architecture: band / grid / bleed / rail / stack / split / frame / plate. */
  architecture: string;
  /** The approved one-line recommended use. */
  use: string;
  /** The approved description. */
  description: string;
  /** Sparse manifest overrides on the family base. */
  overrides: Partial<TemplateManifest>;
}

export interface DesignFamily {
  /** Stable key, matching the manifest's `design_family`. */
  key: string;
  /** Catalogue code, e.g. "pb". */
  code: string;
  /** Catalogue ordinal, e.g. "01". */
  ordinal: string;
  name: string;
  /** The approved one-line family note. */
  note: string;
  /** The approved face list, as displayed. */
  faces: string;
  base: TemplateManifest;
  variants: readonly VariantDefinition[];
}

export { DESIGN_FAMILIES } from './families.generated';
import { DESIGN_FAMILIES as FAMILIES } from './families.generated';

export function familyByKey(key: string): DesignFamily | null {
  return FAMILIES.find((f) => f.key === key) ?? null;
}

/** The catalogue's own manifest resolution. */
export function resolveManifest(family: DesignFamily, variant: VariantDefinition): TemplateManifest {
  return {
    ...family.base,
    ...variant.overrides,
    // The catalogue re-asserts density after the spread; reproduced so a
    // variant that omits it inherits the family's rather than undefined.
    density: variant.overrides.density ?? family.base.density,
  };
}

export function axisFor(family: DesignFamily, variant: VariantDefinition): string {
  const index = family.variants.indexOf(variant);
  return AXES[index] ?? AXES[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Recommended-use buckets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The catalogue's five recommended-use buckets, transcribed from `USE_MATCH`.
 *
 * Kept as the source states it rather than derived from the variants, because
 * the mapping is an editorial judgement — `pb-04` Bullion Rail is filed under
 * "Handover and audit" despite being a Private Banking template, and no rule
 * over the manifest would produce that.
 */
export const USE_BUCKETS: Readonly<Record<string, readonly string[]>> = {
  'Client-facing': ['pb-01', 'pb-03', 'le-01', 'le-02', 'le-03', 'le-04', 'le-05', 'wm-01', 'wm-04', 'ca-05', 'ap-03'],
  'Portfolio review': ['pb-02', 'wm-02', 'wm-03', 'ir-02', 'sm-02', 'ap-02'],
  'Committee and board': ['ir-05', 'ca-01', 'ca-02', 'ca-03', 'ca-04', 'de-02', 'wm-05', 'ir-03'],
  'Screen reading': ['mf-01', 'mf-02', 'mf-03', 'mf-04', 'mf-05', 'de-01', 'de-03', 'de-04', 'de-05', 'da-05'],
  'Handover and audit': ['da-01', 'da-02', 'da-03', 'da-04', 'ap-01', 'ap-04', 'ap-05', 'sm-01', 'sm-03', 'sm-04', 'sm-05', 'ir-01', 'ir-04', 'pb-04', 'pb-05'],
};

export function useBucketFor(templateCode: string): string | null {
  for (const [bucket, ids] of Object.entries(USE_BUCKETS)) {
    if (ids.includes(templateCode)) return bucket;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Typography — measured from the ten drawn archetypes
// ─────────────────────────────────────────────────────────────────────────────

export interface FamilyTypography {
  /** Cover title face. */
  display: string;
  displayGeneric: 'serif' | 'sans-serif' | 'monospace';
  /** Section headings and figures. */
  heading: string;
  headingGeneric: 'serif' | 'sans-serif' | 'monospace';
  /** Body copy and table cells. */
  body: string;
  bodyGeneric: 'serif' | 'sans-serif' | 'monospace';
  /** Uppercase labels, eyebrows, running heads, column heads. */
  mono: string;
  monoGeneric: 'monospace' | 'sans-serif' | 'serif';
  /**
   * Which face sets the figures.
   *
   * `numeric_typography` says so directly — `playfair_lining_tabular` sets them
   * in the heading serif, `plex_mono_tabular` in the mono face, `inter_tabular`
   * in the body face. Getting this wrong is the difference between a private
   * bank's statement and a spreadsheet.
   */
  numericFace: 'heading' | 'body' | 'mono';
  /** Google Fonts axis per face, so italics and weights actually load. */
  axes: Partial<Record<'display' | 'heading' | 'body' | 'mono', string>>;
}

/**
 * The four type roles per family, resolved from `typography_preset`.
 *
 * A family that names one face uses it for every role — Luxury Editorial is
 * `noto_serif_only` and Swiss Minimal is `inter_grotesk`, and both mean exactly
 * that. Where the archetype's root `font-family` disagreed with the preset's
 * name, the archetype won: it is the drawn document.
 */
export const TYPOGRAPHY: Record<string, FamilyTypography> = {
  // Cinzel wordmark + cover, Playfair headings and figures, Inter body,
  // Plex Mono labels. Measured: h1 41pt, h2 22–29pt, body 8.8pt, table 8.2pt.
  private_banking: {
    display: 'Cinzel', displayGeneric: 'serif',
    heading: 'Playfair Display', headingGeneric: 'serif',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'heading',
    axes: {
      display: 'wght@400;600',
      heading: 'ital,wght@0,400;0,500;0,600;1,400',
      body: 'wght@400;500;600;700',
      mono: 'wght@400;500;700',
    },
  },
  // `noto_serif_plex`. A research note has no display cover — its largest type
  // is the 14pt masthead — and every figure is Plex Mono tabular.
  institutional_research: {
    display: 'Noto Serif', displayGeneric: 'serif',
    heading: 'Noto Serif', headingGeneric: 'serif',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'mono',
    axes: {
      display: 'wght@400;600;700', heading: 'wght@400;600;700',
      body: 'wght@400;500;600;700', mono: 'wght@400;500;600;700',
    },
  },
  // `noto_serif_only` — one face, every role, including the labels. Measured:
  // h1 40pt, h2 21–27pt, body 9.6pt. The most generous body size in the set.
  luxury_editorial: {
    display: 'Noto Serif', displayGeneric: 'serif',
    heading: 'Noto Serif', headingGeneric: 'serif',
    body: 'Noto Serif', bodyGeneric: 'serif',
    mono: 'Noto Serif', monoGeneric: 'serif',
    numericFace: 'heading',
    axes: {
      display: 'ital,wght@0,300;0,400;0,600;0,700;1,400',
      heading: 'ital,wght@0,300;0,400;0,600;0,700;1,400',
      body: 'ital,wght@0,300;0,400;0,600;0,700;1,400',
      mono: 'ital,wght@0,300;0,400;0,600;0,700;1,400',
    },
  },
  // `inter_only` with Plex Mono chips and labels. Measured: h1 37pt, h2 20pt.
  modern_fintech: {
    display: 'Inter', displayGeneric: 'sans-serif',
    heading: 'Inter', headingGeneric: 'sans-serif',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'body',
    axes: { display: 'wght@400;500;600;700', heading: 'wght@400;500;600;700', body: 'wght@400;500;600;700', mono: 'wght@400;500;600;700' },
  },
  // `lato_light`. Measured: h1 36pt, h2 22pt, body 9pt, labels 5.8pt Plex Mono
  // — the smallest label in the set, because a drawing's captions are notes.
  architectural_property: {
    display: 'Lato', displayGeneric: 'sans-serif',
    heading: 'Lato', headingGeneric: 'sans-serif',
    body: 'Lato', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'body',
    axes: { display: 'wght@300;400;700', heading: 'wght@300;400;700', body: 'wght@300;400;700', mono: 'wght@400;500;600' },
  },
  // `inter_grotesk` — one face, no mono. Measured: h1 52pt, the largest cover
  // in the catalogue, against 8.2pt body. That ratio is the Swiss argument.
  swiss_minimal: {
    display: 'Inter', displayGeneric: 'sans-serif',
    heading: 'Inter', headingGeneric: 'sans-serif',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'Inter', monoGeneric: 'sans-serif',
    numericFace: 'body',
    axes: { display: 'wght@400;500;600;700', heading: 'wght@400;500;600;700', body: 'wght@400;500;600;700', mono: 'wght@400;500;600;700' },
  },
  // `lato_sans`, but the archetype's root is Noto Serif and its letterhead is
  // Lato 900 — a serif body under a sans letterhead, which is what a signed
  // advisory letter looks like. Measured: h1 27pt, h2 16pt.
  corporate_advisory: {
    display: 'Lato', displayGeneric: 'sans-serif',
    heading: 'Lato', headingGeneric: 'sans-serif',
    body: 'Noto Serif', bodyGeneric: 'serif',
    mono: 'Lato', monoGeneric: 'sans-serif',
    numericFace: 'body',
    axes: { display: 'wght@400;700;900', heading: 'wght@400;700;900', body: 'wght@400;600;700', mono: 'wght@400;700;900' },
  },
  // `roboto_only`. Measured: h1 34pt, h2 22pt, body 8.8pt, table 8.6pt.
  wealth_management: {
    display: 'Roboto', displayGeneric: 'sans-serif',
    heading: 'Roboto', headingGeneric: 'sans-serif',
    body: 'Roboto', bodyGeneric: 'sans-serif',
    mono: 'Roboto', monoGeneric: 'sans-serif',
    numericFace: 'body',
    axes: { display: 'wght@300;400;500;700', heading: 'wght@300;400;500;700', body: 'wght@300;400;500;700', mono: 'wght@300;400;500;700' },
  },
  // `plex_mono_inter` — 361 mono declarations against 5 Inter. The model is the
  // document, so the mono face carries it and Inter is the prose exception.
  data_analyst: {
    display: 'IBM Plex Mono', displayGeneric: 'monospace',
    heading: 'IBM Plex Mono', headingGeneric: 'monospace',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'mono',
    axes: { display: 'wght@400;500;600;700', heading: 'wght@400;500;600;700', body: 'wght@400;500;600;700', mono: 'wght@400;500;600;700' },
  },
  // `plex_mono_only`, and the only family whose archetype root font is mono.
  // Measured: h1 33pt, h2 16–19pt, body 8.4pt. Every colourway is a dark
  // ground bar four, which is the family's whole premise.
  dark_executive: {
    display: 'IBM Plex Mono', displayGeneric: 'monospace',
    heading: 'IBM Plex Mono', headingGeneric: 'monospace',
    body: 'Inter', bodyGeneric: 'sans-serif',
    mono: 'IBM Plex Mono', monoGeneric: 'monospace',
    numericFace: 'mono',
    axes: { display: 'wght@400;500;600;700', heading: 'wght@400;500;600;700', body: 'wght@400;500;600', mono: 'wght@400;500;600;700' },
  },
};

export function typographyFor(familyKey: string): FamilyTypography {
  const type = TYPOGRAPHY[familyKey];
  // Throwing rather than defaulting: an unmapped family would silently compile
  // in Private Banking's faces and be filed under its own name.
  if (!type) throw new Error(`No typography for family "${familyKey}"`);
  return type;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Type scale
// ─────────────────────────────────────────────────────────────────────────────

export interface TypeScale {
  /** Cover title. */
  coverTitle: number;
  /** Cover eyebrow. */
  coverEyebrow: number;
  /** Cover standfirst. */
  coverStandfirst: number;
  /** The verdict heading on the dashboard. */
  verdict: number;
  /** Ordinary section heading. */
  heading: number;
  /** Section eyebrow. */
  eyebrow: number;
  /** Running head. */
  runningHead: number;
  /** Body copy. */
  body: number;
  /** Table cells and list items. */
  cell: number;
  /** KPI value. */
  kpiValue: number;
  /** KPI label. */
  kpiLabel: number;
  /** KPI note under the value. */
  kpiNote: number;
  /** Table column head. */
  columnHead: number;
  /** Section numeral on narrative pages. */
  numeral: number;
}

/**
 * Each family's measured `balanced` scale.
 *
 * Every number is read off that family's archetype pages — cover title from its
 * `h1`, section heading from the median `h2`, body from its paragraphs, cells
 * from its tables, labels from its tracked uppercase runs. Where a family draws
 * no display cover (Institutional Research is a masthead, not a title page) the
 * cover size is its masthead size, which is the honest answer rather than a
 * borrowed one.
 */
export const BASE_SCALES: Record<string, TypeScale> = {
  private_banking:        { coverTitle: 41, coverEyebrow: 7,   coverStandfirst: 15,   verdict: 29, heading: 22, eyebrow: 6.6, runningHead: 6.2, body: 9.6,  cell: 8.4, kpiValue: 23, kpiLabel: 6,   kpiNote: 7.4, columnHead: 6,   numeral: 38 },
  institutional_research: { coverTitle: 14, coverEyebrow: 6.4, coverStandfirst: 11.5, verdict: 14, heading: 12.5, eyebrow: 6.2, runningHead: 6,   body: 8.6,  cell: 8,   kpiValue: 12.5, kpiLabel: 6, kpiNote: 6.6, columnHead: 6,   numeral: 20 },
  luxury_editorial:       { coverTitle: 40, coverEyebrow: 6.4, coverStandfirst: 16,   verdict: 27, heading: 23, eyebrow: 6.4, runningHead: 6.2, body: 9.6,  cell: 8.4, kpiValue: 21, kpiLabel: 6.2, kpiNote: 7.4, columnHead: 6.2, numeral: 36 },
  modern_fintech:         { coverTitle: 37, coverEyebrow: 6.6, coverStandfirst: 14,   verdict: 23, heading: 20, eyebrow: 6,   runningHead: 5.9, body: 8.8,  cell: 8.4, kpiValue: 19, kpiLabel: 5.9, kpiNote: 7,   columnHead: 5.9, numeral: 32 },
  architectural_property: { coverTitle: 36, coverEyebrow: 6.6, coverStandfirst: 13,   verdict: 25, heading: 22, eyebrow: 5.8, runningHead: 6,   body: 9,    cell: 8.4, kpiValue: 17, kpiLabel: 5.8, kpiNote: 7,   columnHead: 5.8, numeral: 34 },
  swiss_minimal:          { coverTitle: 52, coverEyebrow: 6.6, coverStandfirst: 13,   verdict: 27, heading: 22, eyebrow: 6.4, runningHead: 6.2, body: 8.2,  cell: 8.2, kpiValue: 26, kpiLabel: 6.2, kpiNote: 7,   columnHead: 6.2, numeral: 40 },
  corporate_advisory:     { coverTitle: 27, coverEyebrow: 6.6, coverStandfirst: 12,   verdict: 17, heading: 16, eyebrow: 6.4, runningHead: 6.2, body: 9,    cell: 8.2, kpiValue: 16, kpiLabel: 6.2, kpiNote: 7,   columnHead: 6.2, numeral: 26 },
  wealth_management:      { coverTitle: 34, coverEyebrow: 6.8, coverStandfirst: 14,   verdict: 23, heading: 22, eyebrow: 6.2, runningHead: 6.2, body: 8.8,  cell: 8.6, kpiValue: 22, kpiLabel: 6.2, kpiNote: 7.2, columnHead: 6.2, numeral: 32 },
  data_analyst:           { coverTitle: 25, coverEyebrow: 6.6, coverStandfirst: 11,   verdict: 16, heading: 15, eyebrow: 6.2, runningHead: 6,   body: 8.8,  cell: 7.8, kpiValue: 16, kpiLabel: 6,   kpiNote: 6.6, columnHead: 6,   numeral: 24 },
  dark_executive:         { coverTitle: 33, coverEyebrow: 6.4, coverStandfirst: 13,   verdict: 19, heading: 17, eyebrow: 6,   runningHead: 5.9, body: 8.4,  cell: 7.8, kpiValue: 17, kpiLabel: 5.9, kpiNote: 6.8, columnHead: 5.9, numeral: 28 },
};

/**
 * How the measured scale moves with density.
 *
 * `balanced` is what was measured. `compact` and `spacious` step the whole
 * scale with the catalogue's own margin presets, because a 26mm margin at
 * balanced type is not a spacious document — it is a narrower one.
 *
 * Display type moves further than body type: a cover title can afford to grow
 * 20% where 9pt body copy at 11pt would stop being body copy.
 */
const DENSITY_FACTORS: Record<Density, { display: number; text: number }> = {
  compact: { display: 0.82, text: 0.92 },
  balanced: { display: 1, text: 1 },
  spacious: { display: 1.18, text: 1.06 },
};

/** Round to a quarter point — finer than any renderer resolves. */
function step(value: number): number {
  return Math.round(value * 4) / 4;
}

export function scaleFor(familyKey: string, density: Density): TypeScale {
  const base = BASE_SCALES[familyKey];
  if (!base) throw new Error(`No type scale for family "${familyKey}"`);
  const f = DENSITY_FACTORS[density];
  return {
    coverTitle: step(base.coverTitle * f.display),
    coverEyebrow: step(base.coverEyebrow * f.text),
    coverStandfirst: step(base.coverStandfirst * f.display),
    verdict: step(base.verdict * f.display),
    heading: step(base.heading * f.display),
    eyebrow: step(base.eyebrow * f.text),
    runningHead: step(base.runningHead * f.text),
    body: step(base.body * f.text),
    cell: step(base.cell * f.text),
    kpiValue: step(base.kpiValue * f.display),
    kpiLabel: step(base.kpiLabel * f.text),
    kpiNote: step(base.kpiNote * f.text),
    columnHead: step(base.columnHead * f.text),
    numeral: step(base.numeral * f.display),
  };
}

/** Tracking, in em. The brand signature is the wide uppercase eyebrow. */
export const TRACKING = {
  coverEyebrow: 0.34,
  wordmark: 0.26,
  eyebrow: 0.26,
  runningHead: 0.2,
  label: 0.18,
  columnHead: 0.1,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 5. Geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page margins in points, from `page_margin_preset`.
 *
 * The catalogue states these in millimetres. 1mm = 72/25.4pt, rounded to whole
 * points because every other geometry value in a `ReportTemplate` is a whole
 * point and a fractional margin makes every downstream `y` fractional too.
 */
export const MARGIN_PRESETS: Record<string, number> = {
  '12mm': 34,
  '15mm': 43,
  '16mm': 45,
  '18mm': 51,
  '20mm': 57,
  '22mm': 62,
  '24mm': 68,
  '26mm': 74,
  '28mm': 79,
};

export function marginFor(manifest: TemplateManifest): number {
  const margin = MARGIN_PRESETS[manifest.page_margin_preset];
  // Throwing rather than defaulting: an unknown preset is a transcription
  // error, and quietly falling back to 20mm would ship a "spacious" template
  // at reference margins with nothing to show for it.
  if (!margin) throw new Error(`No margin for page_margin_preset "${manifest.page_margin_preset}"`);
  return margin;
}

/** Vertical rhythm, in points, from `spacing_scale`. */
export interface SpacingScale {
  gap: number;
  headingGap: number;
  sectionGap: number;
  rowHeight: number;
  cellPadding: number;
}

/**
 * The seven spacing scales the catalogue names.
 *
 * `compressed` and `strict` are Swiss Minimal's; `open` is its spacious cut.
 * They are distinct from `tight`/`regular`/`generous` because a strict grid
 * spaces by module rather than by taste.
 */
export const SPACING_SCALES: Record<string, SpacingScale> = {
  compressed: { gap: 9,  headingGap: 6,  sectionGap: 13, rowHeight: 13, cellPadding: 2.5 },
  strict:     { gap: 13, headingGap: 8,  sectionGap: 20, rowHeight: 16, cellPadding: 3.5 },
  tight:      { gap: 11, headingGap: 7,  sectionGap: 16, rowHeight: 14, cellPadding: 3 },
  regular:    { gap: 14, headingGap: 9,  sectionGap: 20, rowHeight: 16, cellPadding: 4 },
  generous:   { gap: 16, headingGap: 10, sectionGap: 24, rowHeight: 18, cellPadding: 4.5 },
  open:       { gap: 20, headingGap: 12, sectionGap: 30, rowHeight: 20, cellPadding: 5.5 },
  luxurious:  { gap: 22, headingGap: 14, sectionGap: 34, rowHeight: 22, cellPadding: 6 },
};

export function spacingFor(manifest: TemplateManifest): SpacingScale {
  const scale = SPACING_SCALES[manifest.spacing_scale];
  if (!scale) throw new Error(`No spacing scale for "${manifest.spacing_scale}"`);
  return scale;
}

/** Corner radius in points. Only Modern Fintech is not `0`. */
export function radiusFor(manifest: TemplateManifest): number {
  const radius = Number.parseFloat(manifest.radius);
  return Number.isFinite(radius) ? radius : 0;
}

/** Rule weights, in points. */
export const RULE_WEIGHTS = {
  hairline: 0.75,
  emphasis: 1.5,
  heavy: 2,
} as const;

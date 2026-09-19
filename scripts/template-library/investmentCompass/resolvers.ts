/**
 * Manifest vocabulary → renderer primitives.
 *
 * ## Why this module exists
 *
 * The approved catalogue's manifest vocabulary is wide: 31 `kpi_layout` values,
 * 30 `chart_style`, 29 `cover_overlay`, 27 `section_header_style`, 26
 * `table_style`. Thirty-one KPI renderers would be absurd; thirty-one silent
 * fallbacks to one renderer would be a lie. Neither is what a design system is.
 *
 * So every value gets an **explicit** entry here saying which primitive draws
 * it and with what parameters. Two consequences, both wanted:
 *
 *  1. A reviewer can read what `holdings_rows` actually becomes, and disagree.
 *  2. A value with no entry **throws**. `resolvers.spec.ts` walks every value in
 *     `source.json` and asserts each resolves, so a family added to the Design
 *     source and not mapped here fails the build rather than quietly rendering
 *     as somebody else's layout.
 *
 * ## The honest bit
 *
 * Several distinct manifest values map to the same primitive with the same
 * parameters — `ledger_rows`, `statement_rows` and `schedule_rows` are all a
 * ruled ledger of label/figure rows. That is not a shortcut: the catalogue's
 * own distinction between them is the *family's* typography and rule weights,
 * which the family layer already supplies. Where two values differ only in the
 * name their family uses for the same arrangement, they resolve alike, and the
 * comment says so.
 *
 * Where the difference is real, it is parameterised — `grid_cells_six` is six
 * columns where `grid_cells_two` is two, and `double_rule_statement` closes a
 * total where `ledger_hairline` does not.
 */

// ─────────────────────────────────────────────────────────────────────────────
// KPI layout
// ─────────────────────────────────────────────────────────────────────────────

export interface KpiPlan {
  /** Which arrangement `kpi-grid` draws. */
  variant: 'ruled' | 'display' | 'rows' | 'stacked' | 'tile';
  /** Columns per row. Ignored by `rows` and `stacked`. */
  columns: number;
  /** Draw a full cell grid rather than column separators (the Swiss module). */
  cellBorders?: boolean;
  /** How many figures the arrangement wants. */
  items: number;
}

const KPI: Record<string, KpiPlan> = {
  // ── Ruled bands: hairline-separated columns under a heavier rule ──────────
  four_column_ruled: { variant: 'ruled', columns: 4, items: 4 },
  six_column_ruled: { variant: 'ruled', columns: 6, items: 6 },
  ruled_four: { variant: 'ruled', columns: 4, items: 4 },
  // A research exhibit strip is the same band; the family sets it in Plex Mono.
  exhibit_strip: { variant: 'ruled', columns: 4, items: 4 },
  // The coverage note's inline strip is the same band at three figures — it is
  // a two-page update, so it carries the three numbers that decide.
  inline_strip: { variant: 'ruled', columns: 3, items: 3 },
  decision_strip: { variant: 'ruled', columns: 3, items: 3 },
  chart_led_strip: { variant: 'ruled', columns: 4, items: 4 },
  position_strip_five: { variant: 'ruled', columns: 5, items: 5 },
  // Eight positions across an A4 measure is 57pt a column, which a formatted
  // currency value does not fit — so it wraps to two rows of four.
  position_strip_eight: { variant: 'ruled', columns: 4, items: 8 },
  // Twelve is a dashboard console: six across, two deep.
  console_twelve: { variant: 'ruled', columns: 6, items: 12 },

  // ── Flat module cells: the Swiss grid, drawn as cells rather than columns ─
  grid_cells_two: { variant: 'ruled', columns: 2, cellBorders: true, items: 2 },
  grid_cells_four: { variant: 'ruled', columns: 4, cellBorders: true, items: 4 },
  grid_cells_six: { variant: 'ruled', columns: 6, cellBorders: true, items: 6 },
  grid_six: { variant: 'ruled', columns: 6, cellBorders: true, items: 6 },
  field_cells_four: { variant: 'ruled', columns: 4, cellBorders: true, items: 4 },

  // ── Filled cards: the only family that fills a KPI tile is the fintech one ─
  card_row_four: { variant: 'tile', columns: 4, items: 4 },
  card_row_with_trend: { variant: 'tile', columns: 4, items: 4 },

  // ── Display: two up, at figure size ──────────────────────────────────────
  two_by_two_display: { variant: 'display', columns: 2, items: 4 },
  // A pair of positions read side by side, same arrangement.
  position_pairs: { variant: 'display', columns: 2, items: 4 },

  // ── Ledger rows: label left, figure right, rule between ──────────────────
  // These six are one arrangement under six families' names for it. What makes
  // a `statement_rows` different from a `schedule_rows` is the family's rule
  // weight and face, which the family layer already supplies.
  ledger_rows: { variant: 'rows', columns: 1, items: 5 },
  statement_rows: { variant: 'rows', columns: 1, items: 5 },
  schedule_rows: { variant: 'rows', columns: 1, items: 5 },
  datum_rows: { variant: 'rows', columns: 1, items: 5 },
  hairline_rows: { variant: 'rows', columns: 1, items: 5 },
  holdings_rows: { variant: 'rows', columns: 1, items: 5 },
  derivation_rows: { variant: 'rows', columns: 1, items: 5 },
  // A summary table replaces KPI cards with a ruled list on the board papers.
  summary_table: { variant: 'rows', columns: 1, items: 6 },
  decision_summary: { variant: 'rows', columns: 1, items: 4 },
  field_table: { variant: 'rows', columns: 1, items: 6 },
  // Plan callouts are figures hung off a drawing; without the drawing they are
  // the same ruled list, which is the honest degradation.
  plan_callouts: { variant: 'rows', columns: 1, items: 4 },

  // ── Stacked against a rail ───────────────────────────────────────────────
  stacked_rail: { variant: 'stacked', columns: 1, items: 4 },
};

export function kpiPlan(value: string): KpiPlan {
  const plan = KPI[value];
  if (!plan) throw new Error(`Unmapped kpi_layout: "${value}"`);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table treatment
// ─────────────────────────────────────────────────────────────────────────────

export interface TablePlan {
  /** `fill` draws a coloured header band; `rule` sets tracked caps over a rule. */
  headerStyle: 'fill' | 'rule';
  /** Hairline under every row. */
  rowRule: boolean;
  /** A border around the whole table. */
  outerBorder: boolean;
  /** Vertical rules between every cell. */
  gridLines: boolean;
  /** Alternate-row tint. */
  stripe: boolean;
  /** One padding step tighter. */
  tight: boolean;
  /** Close a total row with a doubled rule. */
  doubleRuleTotals: boolean;
}

const RULED: TablePlan = {
  headerStyle: 'rule', rowRule: true, outerBorder: false,
  gridLines: false, stripe: true, tight: false, doubleRuleTotals: false,
};
const tighten = (p: TablePlan): TablePlan => ({ ...p, tight: true });

const TABLE: Record<string, TablePlan> = {
  // ── Statements: no filled header, hairline rows ──────────────────────────
  ledger_hairline: RULED,
  ledger_tight: tighten(RULED),
  statement_rules: RULED,
  statement_tight: tighten(RULED),
  schedule_rules: RULED,
  schedule_ruled: RULED,
  schedule_tight: tighten(RULED),
  ruled_rows: RULED,
  ruled_rows_tight: tighten(RULED),
  hairline_rows: { ...RULED, stripe: false },
  datum_rules: { ...RULED, stripe: false },
  exhibit_ruled: RULED,
  exhibit_tight: tighten(RULED),
  board_ruled: RULED,
  board_tight: tighten(RULED),
  sparkline_rows: RULED,

  // ── The one that closes a total ──────────────────────────────────────────
  double_rule_statement: { ...RULED, doubleRuleTotals: true },

  // ── Grids: the analyst and Swiss families rule both axes ─────────────────
  grid_lines_light: { ...RULED, gridLines: true, outerBorder: true, stripe: false },
  grid_lines_tight: tighten({ ...RULED, gridLines: true, outerBorder: true, stripe: false }),
  full_gridlines: { ...RULED, gridLines: true, outerBorder: true, stripe: false },
  gridlines_micro: tighten({ ...RULED, gridLines: true, outerBorder: true, stripe: false }),
  worksheet_grid: { ...RULED, gridLines: true, outerBorder: true, stripe: true },
  module_cells: { ...RULED, gridLines: true, outerBorder: true, stripe: false },

  // ── Dark ground: the rules carry, the stripe does not ────────────────────
  dark_rules: { ...RULED, stripe: false },
  dark_rules_tight: tighten({ ...RULED, stripe: false }),

  // ── The only filled header in the catalogue ──────────────────────────────
  // A soft zebra under a tinted head is the fintech table; every other family
  // reads a filled header band as a UI table rather than a document one.
  zebra_soft: {
    headerStyle: 'fill', rowRule: false, outerBorder: false,
    gridLines: false, stripe: true, tight: false, doubleRuleTotals: false,
  },
};

export function tablePlan(value: string): TablePlan {
  const plan = TABLE[value];
  if (!plan) throw new Error(`Unmapped table_style: "${value}"`);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────────────────────

export type SectionHeaderKind =
  /** Tracked eyebrow over a display heading. */
  | 'eyebrow'
  /** An oversized numeral beside the heading. */
  | 'numeral'
  /** Heading only; the rail or masthead carries the label. */
  | 'bare'
  /** A filled band behind the heading. */
  | 'band'
  /** A decimal clause number before the heading. */
  | 'decimal'
  /** An italic standfirst under the heading. */
  | 'standfirst';

const SECTION: Record<string, SectionHeaderKind> = {
  eyebrow_rule_display: 'eyebrow',
  chip_label: 'eyebrow',
  chip_inline: 'eyebrow',
  numbered_exhibit: 'numeral',
  plate_number: 'numeral',
  full_bleed_numeral: 'numeral',
  grid_number: 'numeral',
  schedule_number: 'numeral',
  sheet_number: 'numeral',
  step_number: 'numeral',
  module_marker: 'numeral',
  plan_reference: 'numeral',
  rail_marker: 'bare',
  rail_marker_numbered: 'numeral',
  vertical_rail: 'bare',
  inline_heading: 'bare',
  holding_header: 'band',
  band_header: 'band',
  band_strip: 'band',
  dark_ribbon: 'band',
  decimal_numbered: 'decimal',
  two_level_decimal: 'decimal',
  clause_numbered: 'decimal',
  schedule_letter: 'decimal',
  standfirst_italic: 'standfirst',
  plate_standfirst: 'standfirst',
  drop_cap_opener: 'standfirst',
};

export function sectionHeaderKind(value: string): SectionHeaderKind {
  const kind = SECTION[value];
  if (!kind) throw new Error(`Unmapped section_header_style: "${value}"`);
  return kind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverPlan {
  /**
   * How the cover is grounded.
   *
   * `field` fills the page with the field colour; `band` puts the field behind
   * the head only and leaves the rest on paper; `paper` keeps the whole page on
   * stock and does its work typographically.
   */
  ground: 'field' | 'band' | 'paper';
  /** A rule framing the whole page. */
  frame?: boolean;
  /** A vertical rail down the binding edge. */
  rail?: boolean;
  /** The title block runs to the full measure and sits lower. */
  bleed?: boolean;
}

const COVER: Record<string, CoverPlan> = {
  // ── Full field ───────────────────────────────────────────────────────────
  obsidian_full: { ground: 'field' },
  obsidian_bleed_portrait: { ground: 'field', bleed: true },
  obsidian_rail: { ground: 'field', rail: true },
  obsidian_verdict_box: { ground: 'field' },
  photographic_scrim: { ground: 'field' },
  photographic_bleed: { ground: 'field', bleed: true },
  dark_data_ribbon: { ground: 'field' },
  dashboard_cover: { ground: 'field' },
  ribbon_stack: { ground: 'field' },
  rail_cover: { ground: 'field', rail: true },
  dark_model_bar: { ground: 'field' },

  // ── A band at the head, paper below ──────────────────────────────────────
  obsidian_band: { ground: 'band' },
  holdings_band: { ground: 'band' },
  letterhead_band: { ground: 'band' },
  letter_then_band: { ground: 'band' },
  masthead_rule: { ground: 'band' },
  model_header_bar: { ground: 'band' },
  contract_header: { ground: 'band' },
  memo_header: { ground: 'band' },
  note_header: { ground: 'band' },
  engagement_letterhead: { ground: 'band' },
  decision_box: { ground: 'band' },

  // ── Paper, worked typographically ────────────────────────────────────────
  typographic_frontispiece: { ground: 'paper' },
  typographic_plain: { ground: 'paper' },
  letter_first_page: { ground: 'paper' },
  flat_grid: { ground: 'paper' },
  raster_cover: { ground: 'paper', frame: true },
  hairline_frame_plan: { ground: 'paper', frame: true },
  site_plan_cover: { ground: 'paper', frame: true },
};

export function coverPlan(value: string): CoverPlan {
  const plan = COVER[value];
  if (!plan) throw new Error(`Unmapped cover_overlay: "${value}"`);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Callout
// ─────────────────────────────────────────────────────────────────────────────

export type CalloutKind = 'bar' | 'margin' | 'block' | 'badge';

const CALLOUT: Record<string, CalloutKind> = {
  // Tinted panel behind an accent edge.
  tinted_gold_bar: 'bar',
  tinted_violet: 'bar',
  amber_bar: 'bar',
  band_note: 'bar',
  ribbon_note: 'bar',
  boxed_note: 'bar',
  reliance_block: 'bar',
  disclosure_note: 'bar',
  finding_note: 'bar',
  chart_note: 'bar',
  // Unfilled note hung off a hairline.
  margin_note: 'margin',
  caption_rail: 'margin',
  indented_note: 'margin',
  italic_aside: 'margin',
  rule_note: 'margin',
  source_reference: 'margin',
  mono_caption: 'margin',
  amber_caption: 'margin',
  derivation_note: 'margin',
  // Flat filled block, no edge — the Swiss and module treatments.
  flat_block: 'block',
  module_block: 'block',
};

export function calloutKind(value: string): CalloutKind {
  const kind = CALLOUT[value];
  if (!kind) throw new Error(`Unmapped callout_style: "${value}"`);
  return kind;
}

/** How the strengths/considerations labels are marked. */
export type StrengthsWatchStyle = 'band' | 'rule' | 'plain';

/**
 * Strengths and considerations are a callout in everything but name, so they
 * are marked the way this family marks a callout rather than carrying a
 * vocabulary of their own.
 *
 * Before this they were one treatment for all fifty masters: a solid band of
 * full-strength green and red with the label reversed out. It rendered
 * identically in Swiss Minimal and Institutional Research — two families whose
 * entire difference is how loudly they mark a section — and put two saturated
 * rectangles on the most-read page of every report in the catalogue.
 *
 * **No family gets the filled band**, and that is a deliberate correction of a
 * first attempt. Mapping `block` callouts to the band looked principled and put
 * the loudest treatment on the four Swiss Minimal variants — the most restrained
 * family in the catalogue — because its `flat_block` callout is a *neutral*
 * tinted panel, the grey box its pages already use. The fill colour there is a
 * surface tint; ours would have been full-strength `positive`/`negative`. The
 * axis was right and the endpoint was wrong: a saturated rectangle is an alert
 * in every one of the ten families, so the choice is only how quietly to mark
 * the label, not whether to shout.
 *
 * `band` therefore survives only as the block's own default, which is what keeps
 * the 43 pre-existing voice templates rendering exactly as they did.
 */
export function strengthsWatchStyle(calloutStyle: string): StrengthsWatchStyle {
  switch (calloutKind(calloutStyle)) {
    // A family that boxes or bars its callouts gets a rule under the label.
    case 'block':
    case 'bar':
      return 'rule';
    // A family whose callouts live in the margin marks nothing at all.
    case 'margin':
      return 'plain';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk
// ─────────────────────────────────────────────────────────────────────────────

export type RiskKind = 'table' | 'bars';

const RISK: Record<string, RiskKind> = {
  rated_table: 'table',
  rating_table: 'table',
  rated_rows: 'table',
  rated_schedule: 'table',
  numbered_register: 'table',
  finding_rows: 'table',
  flat_matrix: 'table',
  chip_matrix: 'table',
  disclosure_blocks: 'table',
  validation_suite: 'table',
  validation_plus_schema: 'table',
  // Proportional bars beside the hazard.
  severity_bars: 'bars',
  rating_map: 'bars',
  rating_map_plus_bars: 'bars',
  trend_chips: 'bars',
};

export function riskKind(value: string): RiskKind {
  const kind = RISK[value];
  if (!kind) throw new Error(`Unmapped risk_display: "${value}"`);
  return kind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommendation
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationKind =
  /** A filled card on the field colour. */
  | 'card'
  /** Ruled type on paper, set like the rest of the statement. */
  | 'statement'
  /** A bordered box. */
  | 'box';

const RECOMMENDATION: Record<string, RecommendationKind> = {
  obsidian_card: 'card',
  band_card: 'card',
  panel_dark: 'card',
  ribbon_verdict: 'card',
  signed_band: 'card',
  terminal_read: 'card',
  model_read: 'card',
  boxed_verdict: 'box',
  verdict_box: 'box',
  decision_box: 'box',
  decision_required: 'box',
  flat_block: 'box',
  ruled_statement: 'statement',
  rule_statement: 'statement',
  ruled_note: 'statement',
  signed_note: 'statement',
  letter_close: 'statement',
  engagement_terms: 'statement',
  suitability_statement: 'statement',
};

export function recommendationKind(value: string): RecommendationKind {
  const kind = RECOMMENDATION[value];
  if (!kind) throw new Error(`Unmapped recommendation_style: "${value}"`);
  return kind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartPlan {
  /** Which production chart block draws the series. */
  block: 'chart-line' | 'chart-area' | 'chart-bar' | 'chart-stacked-bar' | 'sparkline';
  /** Draw the same series more than once, small. */
  smallMultiples?: boolean;
}

const CHART: Record<string, ChartPlan> = {
  // Lines
  line_editorial: { block: 'chart-line' },
  line_minimal: { block: 'chart-line' },
  line_plain: { block: 'chart-line' },
  line_hairline: { block: 'chart-line' },
  line_amber: { block: 'chart-line' },
  line_amber_large: { block: 'chart-line' },
  line_over_plate: { block: 'chart-line' },
  minimal_line: { block: 'chart-line' },
  single_line: { block: 'chart-line' },
  measured_line: { block: 'chart-line' },
  measured_line_bare: { block: 'chart-line' },
  plate_line: { block: 'chart-line' },
  full_width_plate: { block: 'chart-line' },
  single_panel: { block: 'chart-line' },
  distance_diagram: { block: 'chart-line' },
  // Areas
  stepped_area: { block: 'chart-area' },
  // Bars
  bar_solid: { block: 'chart-bar' },
  bar_flat: { block: 'chart-bar' },
  bar_flat_large: { block: 'chart-bar' },
  allocation_bars: { block: 'chart-bar' },
  // Stacked
  bar_stacked: { block: 'chart-stacked-bar' },
  // Small multiples — the same series repeated at panel size
  panel_multiples: { block: 'chart-line', smallMultiples: true },
  panel_multiples_dense: { block: 'chart-line', smallMultiples: true },
  small_multiples: { block: 'chart-line', smallMultiples: true },
  small_multiples_amber: { block: 'chart-line', smallMultiples: true },
  small_multiples_dark: { block: 'chart-line', smallMultiples: true },
  single_multiple: { block: 'chart-line', smallMultiples: true },
  // Sparklines
  sparkline_dense: { block: 'sparkline' },
  sparklines_only: { block: 'sparkline' },
  sparkline_plus_tornado: { block: 'sparkline' },
};

export function chartPlan(value: string): ChartPlan {
  const plan = CHART[value];
  if (!plan) throw new Error(`Unmapped chart_style: "${value}"`);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image slots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One briefed plate.
 *
 * The brief is the point. Every slot in the approved Luxury Editorial archetype
 * carries a `placeholder` telling the operator what photograph belongs there —
 * "Drop a landscape plate — estate streetscape, parkland, or the corridor from
 * height". A generic image box is not what `four_briefed` means, so the brief
 * travels to the Builder as the block's name.
 */
export interface ImagePlate {
  /** Slot id, from the archetype where one exists. */
  id: string;
  /**
   * Where the plate falls in the document.
   *
   * Every value but `cover` names the content page the plate follows; `page` is
   * a plate that stands on its own at the end of the narrative, belonging to no
   * section. A plate is always a whole page (see `platePage` in `blocks.ts` for
   * why), so this orders the document rather than positioning anything within a
   * page — which is also why the archetype's stated plate heights (74mm, 90mm,
   * 60mm) are recorded in the comments below and carried nowhere: a plate that
   * fills the page has no height to declare.
   */
  placement: 'cover' | 'property' | 'thesis' | 'projection' | 'sources' | 'page';
  /** The operator's brief, verbatim from the archetype where one exists. */
  brief: string;
  /** Print a measured caption under the plate. */
  caption?: string;
}

export interface ImageSlotPlan {
  /** Every plate this template declares, in document order. */
  plates: readonly ImagePlate[];
  /** A full-bleed photographic cover. */
  coverHero: boolean;
  /**
   * Whether plates run to the trim.
   *
   * This is the family's difference and never a per-plate option. Luxury
   * Editorial is a monograph: its plates bleed, with the asset's name reversed
   * out of a scrim at the foot. Architectural Property measures instead — the
   * plate is inset to the page margin and captioned as a figure, which is what
   * a plate in a drawing set is.
   */
  bleed: boolean;
}

const NO_PLATES: ImageSlotPlan = { plates: [], coverHero: false, bleed: false };

/**
 * The four plates the Luxury Editorial archetype actually draws.
 *
 * The archetype sizes them — the narrative plate is 90mm, the dashboard
 * portrait 74mm and the detail plate 60mm — which is the right call in a
 * reflowing document and unbuildable in this one, where a slot reserves its
 * height whether or not anything fills it. Each of these is a full page
 * instead; `platePage` records why.
 */
const LUX_COVER: ImagePlate = {
  id: 'lux-cover',
  placement: 'cover',
  brief: 'Drop the hero photograph — the dwelling, the streetscape, or the estate at dusk',
};
const LUX_PORTRAIT: ImagePlate = {
  id: 'lux-portrait',
  placement: 'property',
  brief: 'Drop a portrait plate — the dwelling frontage',
};
const LUX_PLATE: ImagePlate = {
  id: 'lux-plate',
  placement: 'thesis',
  brief: 'Drop a landscape plate — estate streetscape, parkland, or the corridor from height',
};
const LUX_DETAIL: ImagePlate = {
  id: 'lux-detail',
  placement: 'sources',
  brief: 'Drop a detail plate — interior, façade detail, or the estate parkland',
};

const IMAGE_SLOTS: Record<string, ImageSlotPlan> = {
  // The Luxury Editorial base: a hero cover and three interior plates.
  four_briefed: {
    coverHero: true,
    bleed: true,
    plates: [LUX_COVER, LUX_PORTRAIT, LUX_PLATE, LUX_DETAIL],
  },

  // "Six slots including two full-bleed plates; text yields to imagery on
  // narrative pages." The two extra belong to no section, so they fall at the
  // end of the narrative rather than after one of its pages.
  six_with_bleed: {
    coverHero: true,
    bleed: true,
    plates: [
      LUX_COVER, LUX_PORTRAIT, LUX_PLATE, LUX_DETAIL,
      {
        id: 'lux-bleed-1',
        placement: 'page',
        brief: 'Drop a full-bleed plate — the estate at scale, or the approach',
      },
      {
        id: 'lux-bleed-2',
        placement: 'page',
        brief: 'Drop a full-bleed plate — the interior, or the outlook from the dwelling',
      },
    ],
  },

  // "A typographic title page carries the verdict; imagery starts on the
  // narrative pages." So: no cover hero, and the three interior plates only.
  three_interior: {
    coverHero: false,
    bleed: true,
    plates: [LUX_PORTRAIT, LUX_PLATE, LUX_DETAIL],
  },

  // Architectural Property's Elevation: "Full-width plates with measured
  // captions and one schedule per page." Measured captions are the family's
  // caption rail made explicit — a plate in a drawing set is a figure, and a
  // figure carries a reference.
  four_measured: {
    coverHero: false,
    bleed: false,
    plates: [
      {
        id: 'ap-elevation-1',
        placement: 'property',
        brief: 'Drop the frontage elevation — square on, full width of the lot',
        caption: 'Figure 1 · Frontage elevation',
      },
      {
        id: 'ap-elevation-2',
        placement: 'thesis',
        brief: 'Drop the streetscape — the dwelling in its row',
        caption: 'Figure 2 · Streetscape context',
      },
      {
        id: 'ap-elevation-3',
        placement: 'projection',
        brief: 'Drop the site or context plan — dimensioned where possible',
        caption: 'Figure 3 · Site and context',
      },
      {
        id: 'ap-elevation-4',
        placement: 'sources',
        brief: 'Drop a detail — materials, junction, or the rear aspect',
        caption: 'Figure 4 · Detail',
      },
    ],
  },

  // "Editorial typography without image slots. Empty plates never print as
  // holes because there are none." The catalogue naming the failure mode is
  // why every plate above is conditional.
  none: NO_PLATES,
};

/**
 * The plates a manifest declares.
 *
 * `image_slots` is optional in the source — only the two photographic families
 * carry it — so an absent value is "no plates" rather than an error. A value
 * that IS present and unmapped throws, like every other resolver here.
 */
export function imageSlotPlan(value: string | undefined): ImageSlotPlan {
  if (!value) return NO_PLATES;
  const plan = IMAGE_SLOTS[value];
  if (!plan) throw new Error(`Unmapped image_slots: "${value}"`);
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation and footer
// ─────────────────────────────────────────────────────────────────────────────

/** Whether the variant draws a vertical rail down every page. */
export function hasRail(navigationStyle: string): boolean {
  return navigationStyle === 'vertical_rail'
    || navigationStyle === 'rail_with_progress'
    || navigationStyle === 'caption_rail'
    || navigationStyle === 'narrow_rail';
}

/** Whether the page number sits on the rail rather than in the footer. */
export function railFooter(footerStyle: string): boolean {
  return footerStyle === 'rail_number' || footerStyle === 'rail_progress';
}

/**
 * Whether a contents page is emitted: always.
 *
 * `toc_style: none` was a catalogue statement about the decorative index a
 * family draws, and it silenced the page outright — Luxury Editorial and
 * Private Banking declared it family-wide, so all ten of their masters (the
 * house default among them) shipped multi-page client documents with no way
 * to navigate them, and the owner read five real PDFs without finding a
 * single contents page. Navigability is a property of the DOCUMENT, not of a
 * family's styling: every master emits the Contents page now, and a family's
 * `toc_style` remains free to say how its list is drawn. The parameter stays
 * so the call sites keep stating what they are asking about.
 */
export function hasContents(_tocStyle: string): boolean {
  return true;
}

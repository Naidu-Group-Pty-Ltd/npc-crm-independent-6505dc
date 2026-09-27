/**
 * The rules a chosen design adds to the standard report stylesheet.
 *
 * Appended after everything `buildReportCss` emits, so a rule here wins over
 * one of EQUAL specificity by order — no `!important`, and the standard sheet
 * above it stays readable on its own. A more specific rule in the standard
 * sheet still wins (the ledger's last-row and total-row rules keep their own
 * borders under a grid, and the paper cover's lockup rule keeps its own
 * display), so a rule here that must win is written at least as specifically
 * as the one it overrides. With no design nothing is appended and the sheet is
 * byte for byte what it always was.
 *
 * ## What a rule here may do
 *
 * Restyle what is already on the page: its colour, its ground, its rules, its
 * size. Never add a word, remove one, hide one, reorder one or change its case
 * — `templateDesignParity.spec.ts` renders every format under every design and
 * holds the document body to the standard one, and this sheet is what would
 * break that if it did anything else. That is also why nothing here sets
 * `display: none`, `content`, `text-transform` or `visibility`: the spec reads
 * this module's output and refuses all four.
 *
 * ## Why the cover is recoloured rather than re-drawn
 *
 * A catalogue design grounds its cover on the field, in a band at the head, or
 * not at all. The standard cover's markup is one arrangement, and it stays one
 * arrangement: a band is a background with a hard stop, and paper is the cover
 * set in the paper inks. The knockout mark on the cover was drawn for a dark
 * ground, so on a paper ground it sits on a plate of the field colour rather
 * than being swapped for a different image — a different image would be a
 * different body, and the body is not a design's to change.
 */
import { alpha, pt } from './cssUnits.pure.ts';
import { DENSITY_METRICS, type ReportDesignOptions } from './options.pure.ts';
import { PAGE_SIZE } from './page.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import { COVER_TITLE_SCALE } from './typography.pure.ts';
import type { TemplateDesignLayer } from './templateDesign.pure.ts';

/**
 * The band's depth, in millimetres.
 *
 * The catalogue's banded covers draw a 176pt field at the head of the sheet —
 * 62mm — and the standard cover's masthead row and rule sit at 22mm and 30mm,
 * so both fall inside it and keep their on-field inks.
 */
export const COVER_BAND_MM = 62;

/**
 * How far a framed cover's hairline sits inside the trim.
 *
 * Inside the standard cover's own furniture: its footer sits 14mm from the
 * foot and its masthead 22mm from the head, so the frame encloses both.
 */
const COVER_FRAME_INSET_MM = 10;

/** The masters' hairline weight (`RULE_WEIGHTS.hairline`), in points. */
const COVER_FRAME_WEIGHT_PT = 0.75;

const CELL = 'table.data tbody td, table.data tbody th[scope="row"]';
const HEAD_CELL = 'table.data thead th';
const TOTAL_CELL = 'table.data tbody tr.total td, table.data tbody tr.total th[scope="row"]';
const BAND_CELL = 'table.data tbody tr:nth-child(even) td, '
  + 'table.data tbody tr:nth-child(even) th[scope="row"]';

/** The cover in paper inks — every element the standard cover paints on the field. */
function paperInks(p: ResolvedReportPalette): string {
  return `
  .report-cover { color: ${p.bodyInk}; }
  .report-cover .cover-eyebrow { color: ${p.accentOnPaper}; }
  .report-cover h1.cover-title { color: ${p.bodyInk}; }
  .report-cover .cover-title em { color: ${p.accentOnPaper}; }
  .report-cover .cover-meta { color: ${p.mutedInk}; }
  .report-cover .cover-meta .lbl { color: ${p.accentOnPaper}; }
  .report-cover .cover-meta .val { color: ${p.bodyInk}; }
  .report-cover .cover-footer { color: ${p.mutedInk}; }
  /* The knockout mark was drawn for a dark ground. On paper it sits on a plate
     of the field colour, so it stays legible and stays the same image. */
  .report-cover .cover-lockup .lockup-mark {
    display: inline-block;
    background: ${p.field};
    padding: 3mm 4mm;
  }
  .report-cover .brand-lockup.on-field .lockup-text { color: ${p.accentOnPaper}; }`;
}

function coverRules(layer: TemplateDesignLayer, p: ResolvedReportPalette, type: Record<string, number>): string {
  const out: string[] = [];

  if (layer.coverGround === 'band') {
    out.push(`
  /* Band — the field grounds the head of the sheet and paper the rest. The
     masthead and its rule sit inside the band and keep their on-field inks;
     everything below it is set in paper inks. */
  @page cover { background: ${p.paper}; }
  .report-cover {
    background: linear-gradient(180deg, ${p.field} 0mm, ${p.field} ${COVER_BAND_MM}mm, ${p.paper} ${COVER_BAND_MM}mm, ${p.paper} 100%);
  }
  /* A tenant's cover art belongs to the band, under the same scrim. */
  .report-cover .cover-hero,
  .report-cover .cover-scrim { bottom: auto; height: ${COVER_BAND_MM}mm; }${paperInks(p)}`);
  }

  if (layer.coverGround === 'paper') {
    out.push(`
  /* Paper — the cover does its work typographically, on stock. */
  @page cover { background: ${p.paper}; }
  .report-cover { background: ${p.paper}; }
  .report-cover .cover-masthead { color: ${p.accentOnPaper}; }
  .report-cover .cover-masthead .vol { color: ${p.mutedInk}; }
  .report-cover .cover-rule { border-top-color: ${p.accentOnPaper}; }
  /* A tenant's cover art washes into the stock rather than darkening it, so the
     paper inks above keep their contrast over it. */
  .report-cover .cover-scrim {
    background: linear-gradient(180deg,
      ${alpha(p.paper, 0.35)} 0%,
      ${alpha(p.paper, 0.75)} 55%,
      ${alpha(p.paper, 0.96)} 100%);
  }${paperInks(p)}`);
  }

  if (layer.coverFrame) {
    out.push(`
  /* A hairline frame inset from the trim — the drawing set's border, at the
     masters' own weight and in their line colour. An outline rather than a
     border: the cover box is the size of the sheet, so a border sits AT the
     trim, where nobody sees it and a guillotine takes it off. An outline is
     drawn after everything inside the box, so it also stays over a tenant's
     cover art and the scrim that washes it. */
  .report-cover {
    outline: ${COVER_FRAME_WEIGHT_PT}pt solid ${p.rule};
    outline-offset: -${COVER_FRAME_INSET_MM}mm;
  }`);
  }

  if (layer.coverTitleScale !== 1) {
    const s = layer.coverTitleScale;
    out.push(`
  /* The cover title at the design's own scale, fitted the same way. */
  .report-cover h1.cover-title { font-size: ${pt(type.coverTitle * s)}; }
  .report-cover h1.cover-title.fit-medium { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.medium * s)}; }
  .report-cover h1.cover-title.fit-long { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.long * s)}; }
  .report-cover h1.cover-title.fit-longest { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.longest * s)}; }`);
  }

  return out.join('\n');
}

function railRules(layer: TemplateDesignLayer, p: ResolvedReportPalette): string {
  if (!layer.rail) return '';
  return `
  /* A rail down the binding edge of every body page, drawn as the page area's
     own left border so it runs the full height between the running head and
     the foot. The full-bleed pages carry none. */
  @page {
    border-left: 0.8pt solid ${p.accentFill};
    padding-left: 5mm;
  }
  @page cover { border-left: none; padding-left: 0; }
  @page disclaimer { border-left: none; padding-left: 0; }`;
}

function sectionRules(
  layer: TemplateDesignLayer,
  p: ResolvedReportPalette,
  type: Record<string, number>,
  d: (typeof DENSITY_METRICS)[keyof typeof DENSITY_METRICS],
): string {
  switch (layer.sectionKind) {
    case 'band':
      return `
  /* Band — the section heading sits on a plate of the field colour. */
  .chapter-header {
    background: ${p.field};
    padding: ${pt(d.blockGapPt)} ${pt(d.blockGapPt)} ${pt(d.blockGapPt - 2)};
    margin-left: -${pt(d.blockGapPt)};
    margin-right: -${pt(d.blockGapPt)};
    border: 0;
  }
  .chapter-header h1 { color: ${p.onFieldInk}; }
  .chapter-header .chapter-no { color: ${p.accentOnField}; }
  .chapter-header .chapter-dek { color: ${alpha(p.onFieldInk, 0.82)}; }`;
    case 'numeral':
      return `
  /* Numeral — the section number set as a figure in the display face, at the
     subhead step rather than the heading one: it announces the section above
     a title that already does, and a larger figure adds a line to every
     chapter opener. */
  .chapter-header .chapter-no {
    font-family: ${layer.typography.display};
    font-size: ${pt(type.h3 * layer.fit.display)};
    letter-spacing: 0.02em;
    line-height: 1.1;
    color: ${p.accentOnPaper};
  }`;
    case 'standfirst':
      return `
  /* Standfirst — the italic line under the heading carries the section. */
  .chapter-header .chapter-dek { font-size: ${pt((type.h3 + 1) * layer.fit.accent)}; color: ${p.bodyInk}; }`;
    default:
      return '';
  }
}

/*
 * Why a design does not keep a short table together.
 *
 * Measured over 459 renders (nine report types, each as the standard document
 * and under all 50 designs), 26 Sep 2026. A design's faces and headings take a
 * little more or a little less of a page than the standard's, so a short table
 * that fitted, or moved whole, in the standard document occasionally splits
 * under a design — 12 of the 450 designed renders, all in Comparison and
 * Portfolio. Two remedies were measured and neither is kept:
 *
 *  - Row-level keeps (`break-after: avoid` on the first row, `break-before:
 *    avoid` on the last) do nothing here. Every row carries `break-inside:
 *    avoid` so that it never splits, and WeasyPrint 69 moves such a row to the
 *    next page without consulting the break between rows.
 *  - A whole-table keep (`break-inside: avoid`, scoped to short tables with
 *    `:has()`) moves a table that FITS whenever it ends within about 6 mm of
 *    the foot — the engine counts it as split — which added a page to 82 of the
 *    450 renders, in Borrowing Capacity and the 10 Year Cash Flow.
 *
 * The standard documents split short tables the same way with other data, so
 * this is the house sheet's question rather than a design's; recorded here so
 * it is not rediscovered.
 */

function tableRules(
  layer: TemplateDesignLayer,
  p: ResolvedReportPalette,
  d: (typeof DENSITY_METRICS)[keyof typeof DENSITY_METRICS],
): string {
  const t = layer.table;
  if (!t) return '';
  const out: string[] = [];
  const pad = pt(Math.max(3, d.cellPadPt - (t.tight ? 2 : 0)));

  if (t.gridLines || t.outerBorder) {
    out.push(`
  /* Grid — both axes ruled, and a border round the whole table. */
  table.data { border: 0.6pt solid ${p.rule}; }
  ${HEAD_CELL}, ${CELL} {
    border: 0.3pt solid ${p.rule};
    padding-left: 6pt;
    padding-right: 6pt;
  }`);
    if (t.stripe) out.push(`\n  ${BAND_CELL} { background: ${p.paperAlt}; }`);
  }
  if (t.headerStyle === 'fill') {
    out.push(`
  /* A filled head band. */
  ${HEAD_CELL} { background: ${p.paperAlt}; padding-left: 6pt; }`);
  }
  if (!t.rowRule && !t.gridLines) out.push(`\n  ${CELL} { border-bottom: 0; }`);
  if (t.doubleRuleTotals) {
    out.push(`
  /* A statement closes its total with a doubled rule. */
  ${TOTAL_CELL} { border-top: 2pt double ${p.bodyInk}; }`);
  }
  if (t.tight) out.push(`\n  ${HEAD_CELL}, ${CELL} { padding-top: ${pad}; padding-bottom: ${pad}; }`);
  return out.join('');
}

/**
 * The pull quote is the one rule that sets the display face in italic. A display
 * face with no italic in the print container (IBM Plex Mono, Cinzel) would have
 * its slant synthesised from the upright, which reads as a printing fault, so
 * the quote takes the design's italic voice instead — the face its standfirsts
 * are already set in.
 */
function italicRules(layer: TemplateDesignLayer): string {
  if (layer.displayItalic) return '';
  return `
  .pull-quote { font-family: ${layer.typography.accent}; }`;
}

/**
 * A design never costs a figure.
 *
 * Measured over 459 renders with WeasyPrint 69.0 (26 Sep 2026, release audit):
 * under 31 of the 50 designs the Commercial & Industrial Capacity report's
 * six-column "Financial periods" table lost its Evidence column at the edge of
 * the sheet, and under the raised (rounded) designs the tail of Adjusted
 * EBITDA as well. The standard document already runs that table about 19 mm
 * into its right margin, because its uppercase, tracked numeric headers never
 * wrap. A design then either narrows the text area (a rail, grid padding),
 * widens the header face, or clips the table at its own rounded shell
 * (`overflow: hidden` on a raised surface), and what was in the margin is cut.
 *
 * So under a design a numeric column's HEAD may wrap between its words, while
 * its figures still never do (the house sheet's rule for a figure stands), and
 * a table's shell clips nothing: its rounded border stays and only the header
 * band's own corners are no longer trimmed to it. Neither can add, remove or
 * reorder a word.
 */
function fitRules(): string {
  return `
  /* A design never costs a figure: a numeric column's head may wrap between
     words (its figures still never do), and a table's shell clips nothing. */
  table.data th.num { white-space: normal; }
  .table-block, table.data { overflow: visible; }`;
}

function surfaceRules(layer: TemplateDesignLayer, options: ReportDesignOptions): string {
  if (options.surfaceStyle !== 'raised' || layer.radius <= 0) return '';
  const r = `${Number((layer.radius * 0.75).toFixed(2))}pt`;
  return `
  /* The design's own corner, on every raised surface. */
  .kpi-strip .kpi, .table-block, table.data, .callout, .sidenote, .decision-box { border-radius: ${r}; }`;
}

/** The design's rules, or the empty string for a standard document. */
export function templateDesignCss(
  layer: TemplateDesignLayer | null,
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
): string {
  if (!layer) return '';
  const d = DENSITY_METRICS[options.density];
  const parts = [
    coverRules(layer, palette, type),
    railRules(layer, palette),
    sectionRules(layer, palette, type, d),
    tableRules(layer, palette, d),
    italicRules(layer),
    surfaceRules(layer, options),
    fitRules(),
  ].filter(Boolean);
  if (!parts.length) return '';
  return `
  /* ── The chosen design ─────────────────────────────────────────────────
     Restyles what the standard document prints; adds, removes and hides
     nothing. Page ${PAGE_SIZE.name}. */${parts.join('\n')}
`;
}

/**
 * The report stylesheet, built from a resolved palette and a set of options.
 *
 * This replaces `render-investment-report-pdf/report.css.ts`, which was a single
 * `const` template string over a hardcoded `BRAND` object — one of the eight
 * golds, and unreachable from any tenant. Three things changed in the port:
 *
 *  1. **Every colour is a palette role.** There is not one hex literal below.
 *     `reportSourceHygiene.spec.ts` asserts that, so it stays true.
 *  2. **`@page` rules are generated from `page.pure.ts`.** Page geometry had two
 *     definitions — the `PAGE` token object and the CSS that consumed it — and
 *     the named pages the product actually uses (`chapter-opener`,
 *     `landscape-table`, `disclaimer`) existed in neither. Now the table is the
 *     definition and the CSS is derived.
 *  3. **The layout model is tables, not flexbox.** WeasyPrint's flex support is
 *     partial and version-dependent; its table model is not. A KPI strip that
 *     silently stacks into a column on the render host is the kind of defect
 *     that only shows up in a client's hands. `display: table` costs nothing
 *     here — every one of these rows is a fixed set of equal cells.
 *
 * ## What was deliberately dropped rather than translated
 *
 * `-webkit-font-smoothing` (no meaning in print), `filter: contrast()/saturate()`
 * (unsupported — silently ignored, so it was never doing anything), and
 * `box-shadow` (a screen affordance; on paper an elevation cue reads as a
 * printing artefact). The one gradient that survives is the cover scrim, because
 * it is the only thing keeping cover type legible over arbitrary client-supplied
 * photography, and it is only emitted when there is a photograph under it.
 *
 * Pure: sibling `.pure` imports only, no I/O, deterministic output for a given
 * input — which is what makes `reportGolden.spec.ts` possible.
 */
import { alpha, pt } from './cssUnits.pure.ts';
import {
  DENSITY_METRICS,
  intensity,
  normalizeReportDesignOptions,
  scaledType,
  type ReportDesignOptions,
} from './options.pure.ts';
import {
  GRID_GUTTER_MM,
  GRID_SPANS,
  NAMED_PAGES,
  PAGE_SIZE,
  marginsFor,
  type NamedPage,
} from './page.pure.ts';
import type { ResolvedReportPalette } from './roles.pure.ts';
import { PRINT_TRACKING } from './tokens.pure.ts';
import {
  COVER_TITLE_SCALE,
  EDITORIAL_NUMERIC_FEATURES,
  NUMERIC_FEATURES,
  PRINT_STACK,
  PROSE_NUMERIC_FEATURES,
} from './typography.pure.ts';
import {
  designLayerOf,
  UNIT_TYPE_FIT,
  type ReportTypeFit,
  type ReportTypography,
  type TemplateDesignLayer,
} from './templateDesign.pure.ts';
import { templateDesignCss } from './templateDesignCss.pure.ts';

export interface ReportCssInput {
  /** From `resolveReportPalette()` — or from the report's brand snapshot. */
  palette: ResolvedReportPalette;
  /** Partial and untrusted; normalised on the way in. */
  options?: Partial<ReportDesignOptions> | null;
  /**
   * The running foot, printed on every body page.
   *
   * Comes from the brand snapshot. The prototype hardcoded
   * `"NPC · Investment Intelligence"` into the `@bottom-left` box, which made
   * every white-label tenant's report carry our name.
   */
  masthead: string;
  /**
   * A chosen template's design (`templateDesign.pure.ts`).
   *
   * Absent on every standard document, and then the sheet is byte for byte
   * what it always was. When absent here it is read from the palette, which is
   * where a design resolved by `resolveCatalogueDesign` carries it — so a
   * renderer that passes its palette through unchanged needs no other change.
   */
  design?: TemplateDesignLayer | null;
}

/**
 * A CSS string literal for `content:`.
 *
 * The masthead is tenant-supplied. Without escaping, a company name containing
 * a double quote terminates the string and the remainder of the `@page` block
 * becomes syntactically invalid — which WeasyPrint recovers from by dropping the
 * rule, so the failure is a silently missing footer rather than an error.
 */
function cssString(value: string): string {
  const escaped = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // A literal newline inside a CSS string is a parse error.
    .replace(/[\r\n]+/g, ' ');
  return `"${escaped}"`;
}

/**
 * The cover's masthead and footer rows, in millimetres.
 *
 * Computed here rather than written as `calc(210mm - 44mm)` in the sheet.
 * **WeasyPrint 62.3 — the version the render container pins — rejects that
 * `calc()` outright**: `Ignored \`width: calc(210mm - 44mm)\`, invalid value`.
 * Newer builds accept it, which is exactly how it survived review: it was
 * verified against the engine on a developer's machine and dropped on the one
 * that prints for clients.
 *
 * What it cost: `table-layout: fixed` needs a width to be fixed *to*. Without
 * one the table auto-sized to its content, so the cover's classification and
 * its reference printed as one run — `PRIVATE AND CONFIDENTIALAE8DDE86` — which
 * is the defect the fixed layout was added to stop.
 *
 * 44 is the two 22mm cover margins. A number no version can misread.
 */
const COVER_ROW_WIDTH_MM = PAGE_SIZE.widthMm - 44;

/**
 * The `@page` block for one named page, expressed as its difference from the
 * base rule. `body` is the base and is emitted separately.
 */
function namedPageRule(page: NamedPage, palette: ResolvedReportPalette): string {
  const spec = NAMED_PAGES[page];
  const m = marginsFor(page);
  const lines: string[] = [];

  if (spec.landscape) lines.push(`    size: ${PAGE_SIZE.name} landscape;`);
  lines.push(`    margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;`);
  if (spec.bleed) lines.push(`    background: ${palette.field};`);

  if (!spec.header) {
    lines.push('    @top-left { content: none; }');
    lines.push('    @top-right { content: none; }');
  }
  if (!spec.footer) {
    lines.push('    @bottom-left { content: none; }');
    lines.push('    @bottom-center { content: none; }');
    lines.push('    @bottom-right { content: none; }');
  }

  return `  /* ${spec.note} */\n  @page ${page} {\n${lines.join('\n')}\n  }`;
}

/** Base `@page` plus one rule per named page, plus the `.page-*` selectors. */
function pageRules(
  palette: ResolvedReportPalette,
  masthead: string,
  type: Record<string, number>,
  pressMarks: boolean,
  S: ReportTypography,
  F: ReportTypeFit,
): string {
  const base = marginsFor('body');

  /* Crop marks and a bleed-extended sheet, for a document going to a press.

     On the base rule so every named page inherits it — a cover is the page
     that most needs the bleed, and it is the one that declares its own margins.

     3mm is the trade convention. The sheet becomes 216 x 303mm around a
     210 x 297mm trim, and the field colour on a full-bleed page runs off the
     edge instead of stopping at it. Off by default: crop marks on a document
     sent to a client read as a proof nobody meant to send. */
  const press = pressMarks
    ? '    marks: crop cross;\n    bleed: 3mm;\n'
    : '';
  const named = (Object.keys(NAMED_PAGES) as NamedPage[])
    .filter((p) => p !== 'body')
    .map((p) => namedPageRule(p, palette))
    .join('\n\n');

  // `page: <name>` is how an element claims a named page. Generated from the
  // same table, so a new named page cannot be reachable from CSS but not markup.
  const selectors = (Object.keys(NAMED_PAGES) as NamedPage[])
    .map((p) => `  .page-${p} { page: ${p}; }`)
    .join('\n');

  // Two sections claiming the *same* named page are two pages, not one flow.
  //
  // `page:` only forces a break when the name changes, so a second landscape
  // matrix placed after a first one simply continued it — the ten-year cash
  // flow projection rendered as one full landscape page and a second holding
  // four orphaned rows. Each `.page-*` section is a page by definition; this
  // says so for the adjacent-siblings case the property does not cover.
  const adjacency = (Object.keys(NAMED_PAGES) as NamedPage[])
    .map((p) => `  .page-${p} + .page-${p}`)
    .join(',\n') + ' { break-before: page; }';

  return `
  @page {
    size: ${PAGE_SIZE.name};
    margin: ${base.top}mm ${base.right}mm ${base.bottom}mm ${base.left}mm;
    background: ${palette.paper};
${press}
    @top-left {
      content: string(chapter-eyebrow);
      font-family: ${S.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.widest};
      text-transform: uppercase;
      /* A margin box inherits nothing, so the case-sensitive forms the rest of
         this sheet's uppercase runs get have to be asked for here too. */
      font-feature-settings: "kern" 1, "case" 1;
      color: ${palette.mutedInk};
    }
    @top-right {
      content: string(chapter-title);
      font-family: ${S.accent};
      font-style: italic;
      font-size: ${pt(type.caption * F.accent)};
      color: ${palette.mutedInk};
    }
    @bottom-left {
      content: ${cssString(masthead)};
      font-family: ${S.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.widest};
      text-transform: uppercase;
      font-feature-settings: "kern" 1, "case" 1;
      color: ${palette.mutedInk};
    }
    @bottom-center {
      content: "";
      border-top: 0.4pt solid ${palette.rule};
      width: 18pt;
      height: 0;
      margin: 0 auto;
    }
    @bottom-right {
      content: counter(page, decimal-leading-zero) " / " counter(pages, decimal-leading-zero);
      font-family: ${S.mono};
      font-size: ${pt(type.micro)};
      letter-spacing: ${PRINT_TRACKING.wide};
      color: ${palette.bodyInk};
    }
  }

${named}

${selectors}

${adjacency}`;
}

/**
 * Body-cell selectors.
 *
 * Both `td` and `th[scope="row"]` every time — see the comment in the classic
 * variant. Hoisted so a variant cannot quietly forget one of the two.
 */
const CELL = 'table.data tbody td, table.data tbody th[scope="row"]';
const BAND_CELL = 'table.data tbody tr:nth-child(even) td, '
  + 'table.data tbody tr:nth-child(even) th[scope="row"]';
const LAST_ROW_CELL = 'table.data tbody tr:last-child td, '
  + 'table.data tbody tr:last-child th[scope="row"]';
const TOTAL_CELL = 'table.data tbody tr.total td, table.data tbody tr.total th[scope="row"]';

/** Table rules for the selected `tableStyle`. Only the chosen variant is emitted. */
function tableRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
  S: ReportTypography,
): string {
  const d = DENSITY_METRICS[options.density];
  const padY = pt(d.cellPadPt);

  const shared = `
  /*
   * A table may break across pages, and its head repeats when it does — that is
   * what \`display: table-header-group\` below is for.
   *
   * It used to say \`page-break-inside: avoid\` here, which contradicted that
   * and had two consequences. A table that did not fit at the foot of a page
   * moved whole and left a hole; and a table longer than one page could not
   * break at all, so a client with thirty liabilities would lose rows off the
   * bottom. Found by the first render of a data-heavy format.
   *
   * Rows still never split, and a caption never strands from its first row.
   */
  table.data {
    width: 100%;
    border-collapse: collapse;
    margin: ${pt(d.blockGapPt)} 0;
    font-size: ${pt(type.caption + 1)};
  }
  table.data caption {
    caption-side: top;
    text-align: left;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    padding-bottom: 6pt;
  }
  table.data th {
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    text-align: left;
    font-weight: 500;
    padding: ${padY} 10pt ${padY} 0;
  }
  table.data td {
    padding: ${padY} 10pt ${padY} 0;
    color: ${palette.bodyInk};
    ${NUMERIC_FEATURES}
  }
  /* The first cell of a row is a header cell — that is what makes the table
     navigable in a tagged PDF — but it must not look like the column head. */
  table.data th[scope="row"] {
    font-family: ${S.body};
    font-size: inherit;
    font-weight: 500;
    letter-spacing: ${PRINT_TRACKING.normal};
    text-transform: none;
    color: ${palette.bodyInk};
    padding: ${padY} 10pt ${padY} 0;
  }
  /* A caption is a separate box from the table it belongs to, and WeasyPrint
     will happily leave it on the previous page while the table moves. The
     wrapper is what actually keeps them together. */
  .table-block { margin: ${pt(d.blockGapPt)} 0; }
  .table-block table.data { margin: 0; }
  /*
   * A figure never wraps. Line-breaking treats the minus sign and the space
   * before a period suffix as break opportunities, so a narrow column renders
   * "-" on one line and "$10,600 pa" on the next, and the reader has to
   * reassemble the number. With auto table layout the column widens instead,
   * which is the right trade in a financial table.
   */
  table.data td.num, table.data th.num { text-align: right; white-space: nowrap; }
  table.data td.pos { color: ${palette.positive}; }
  table.data td.neg { color: ${palette.negative}; }
  table.data thead { display: table-header-group; }
  table.data tr { page-break-inside: avoid; }
  table.data caption { break-after: avoid; }`;

  if (options.tableStyle === 'ledger') {
    return `${shared}

  /* Ledger — heavy top and bottom rules, hairlines between, no verticals. The
     financial-appendix convention: the block reads as one object. */
  table.data {
    border-top: 1pt solid ${palette.bodyInk};
    border-bottom: 1pt solid ${palette.bodyInk};
  }
  table.data thead th { border-bottom: 0.6pt solid ${palette.bodyInk}; }
  ${CELL} { border-bottom: 0.3pt solid ${alpha(palette.mutedInk, 0.25)}; }
  ${LAST_ROW_CELL} { border-bottom: 0; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.bodyInk};
    font-weight: 600;
  }`;
  }

  if (options.tableStyle === 'minimal') {
    return `${shared}

  /* Minimal — one rule under the head. Everything else is alignment. */
  table.data thead th { border-bottom: 0.6pt solid ${palette.rule}; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.rule};
    font-weight: 600;
  }`;
  }

  return `${shared}

  /* Classic — banded rows. The band is the panel colour, so it survives a
     greyscale print, which a tint of the accent does not.

     Every rule here names both td and th[scope="row"]: the first cell of a row
     is a header cell for the tagged-PDF structure tree, so a td-only selector
     bands four fifths of the row and leaves a pale stripe down the left edge. */
  table.data thead th { border-bottom: 0.6pt solid ${palette.bodyInk}; }
  ${BAND_CELL} { background: ${palette.paperAlt}; }
  ${CELL} { border-bottom: 0.3pt solid ${palette.rule}; }
  ${TOTAL_CELL} {
    border-top: 0.6pt solid ${palette.bodyInk};
    background: ${palette.paperAlt};
    font-weight: 600;
  }`;
}

/** Chapter-header rules for the selected `chapterStyle`. */
function chapterRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
  S: ReportTypography,
  F: ReportTypeFit,
): string {
  const d = DENSITY_METRICS[options.density];
  const i = intensity(options);

  const shared = `
  /* The running head is set from these attributes, so a chapter cannot be
     opened without naming itself. */
  .chapter {
    page-break-before: always;
    string-set: chapter-eyebrow attr(data-eyebrow),
                chapter-title attr(data-chapter-title);
    /* The chapter title sits low on its opening page, magazine-style — as
       padding on the chapter box rather than as a page margin.
       \`page: chapter-opener\` would apply to every page the chapter spans, so
       the deep margin and the suppressed running head would follow it through
       page nine of a nine-page chapter. Padding applies to the first fragment
       only, which is exactly the intent. */
    padding-top: ${marginsFor('chapter-opener').top - marginsFor('body').top}mm;
  }
  .chapter-header { margin-bottom: ${pt(d.blockGapPt + 4)}; }
  .chapter-header .chapter-no {
    display: ${options.showSectionNumbers ? 'block' : 'none'};
    font-family: ${S.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    line-height: 1;
    color: ${palette.accentOnPaper};
    margin: 0 0 ${pt(d.blockGapPt)} 0;
  }
  .chapter-header h1 {
    font-size: ${pt(type.h1 * F.display)};
    line-height: 1.18;
    max-width: 150mm;
    margin: 0;
  }
  .chapter-header .chapter-dek {
    margin-top: ${pt(d.paragraphGapPt + 5)};
    font-family: ${S.accent};
    font-style: italic;
    font-size: ${pt(type.h3 * F.accent)};
    line-height: 1.35;
    color: ${palette.mutedInk};
    max-width: 140mm;
  }`;

  if (options.chapterStyle === 'opener_band') {
    return `${shared}

  /* Opener band — a tinted plate behind the header. Alpha follows
     visualIntensity so the same markup can read as loud or as barely there. */
  .chapter-header {
    background: ${alpha(palette.accentFill, 0.1 * i)};
    border-top: ${pt(2 * i + 0.5)} solid ${palette.accentFill};
    padding: ${pt(d.blockGapPt)} ${pt(d.blockGapPt)} ${pt(d.blockGapPt)};
    margin-left: -${pt(d.blockGapPt)};
    margin-right: -${pt(d.blockGapPt)};
  }`;
  }

  if (options.chapterStyle === 'minimal') {
    return `${shared}

  /* Minimal — no rule, no plate; the deep top margin of the chapter-opener page
     does the separating. */
  .chapter-header .chapter-no { margin-bottom: ${pt(d.paragraphGapPt)}; }`;
  }

  return `${shared}

  /* Classic — a hairline under the header, the house default. */
  .chapter-header {
    padding-bottom: ${pt(d.blockGapPt - 2)};
    border-bottom: 0.6pt solid ${palette.rule};
  }`;
}

/** Cover rules for the selected `coverStyle`. */
function coverRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
  S: ReportTypography,
): string {
  const i = intensity(options);
  // The hero sits under the type, so its opacity has a floor: at intensity 0 the
  // photograph is gone entirely and the cover is a solid plate, which is a
  // legitimate look. Between 0 and 1 it never goes bright enough to fight the
  // title, because the scrim below compensates.
  const heroOpacity = Number((0.25 + 0.45 * i).toFixed(3));

  const shared = `
  .report-cover {
    position: relative;
    box-sizing: border-box;
    width: ${PAGE_SIZE.widthMm}mm;
    height: ${PAGE_SIZE.heightMm}mm;
    background: ${palette.field};
    color: ${palette.onFieldInk};
    overflow: hidden;
    page-break-after: always;
  }
  .report-cover .cover-hero {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    background-size: cover;
    background-position: center;
    opacity: ${heroOpacity};
  }
  /* The only gradient in the sheet. It exists so the title clears its contrast
     floor over a photograph nobody has seen yet. */
  .report-cover .cover-scrim {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    background: linear-gradient(180deg,
      ${alpha(palette.field, 0.2)} 0%,
      ${alpha(palette.field, 0.55)} 55%,
      ${alpha(palette.field, 0.92)} 100%);
  }
  .report-cover .cover-masthead {
    position: absolute;
    top: 22mm; left: 22mm; right: 22mm;
    display: table;
    /* Fixed, so a long company name cannot widen the table past the measure and
       push the edition off the sheet. An auto table sizes to its content and
       ignores the declared width, which is how a real cover printed a tenant's
       name and its design system's name run together as one word.

       Nothing in this file may name a company or a client: these comments ship
       inside every tenant's PDF, and documentBrand.spec.ts scans the whole
       document for ours. */
    table-layout: fixed;
    width: ${COVER_ROW_WIDTH_MM}mm;
    font-family: ${S.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnField};
  }
  /* 62/38 rather than the even split a fixed table would take. The mark is a
     company name at the widest tracking in the system and the edition is one
     word; an even split wrapped a long name onto a second line, which landed on
     the cover rule 8mm below. */
  .report-cover .cover-masthead .mark {
    display: table-cell;
    text-align: left;
    width: 62%;
    overflow-wrap: anywhere;
    padding-right: 6mm;
  }
  .report-cover .cover-masthead .vol {
    display: table-cell;
    text-align: right;
    width: 38%;
    color: ${alpha(palette.onFieldInk, 0.7)};
  }
  .report-cover .cover-rule {
    position: absolute;
    top: 30mm; left: 22mm;
    width: 28mm; height: 0;
    border-top: 1pt solid ${palette.accentOnField};
  }
  .report-cover .cover-eyebrow {
    font-family: ${S.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnField};
    margin-bottom: 14mm;
  }
  /* Cinzel — the brand's cover face, and one of only two places it appears. It
     sets lowercase as small capitals, which is why it is confined to the two
     places set large and short.

     Regular, not Bold. Cinzel is an inscriptional roman cut after Trajan-column
     capitals, and those are light: at 34pt the Bold reads as blunt rather than
     grand, and it blooms on the obsidian field a cover is set on, because
     light-on-dark type optically gains weight. The face was only being set Bold
     because Bold was the only weight in the image — a typographic decision made
     by an omission in a Dockerfile. Regular and SemiBold were sitting unused in
     public/fonts/Cinzel_Playfair_Display.zip, the same archive the Bold came
     from, the whole time. */
  .report-cover h1.cover-title {
    font-family: ${S.cover};
    font-weight: 400;
    font-size: ${pt(type.coverTitle)};
    line-height: 1.02;
    letter-spacing: ${PRINT_TRACKING.snug};
    color: ${palette.onFieldInk};
    margin: 0;
    max-width: 165mm;
    /* A title is somebody else's string, and one of them arrived as an uploaded
       *filename* — fifty-odd characters joined by underscores, which are not a
       break opportunity. At 56pt that is far wider than the measure, max-width
       cannot clip what cannot wrap, and the overflow stretched the cover box so
       that the masthead and the footer, both positioned 22mm from its right
       edge, were dragged off the sheet. Three broken things, one unbreakable
       word. */
    overflow-wrap: anywhere;
  }
  /* Set by coverTitleFit, which counts the characters CSS cannot. */
  .report-cover h1.cover-title.fit-medium { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.medium)}; }
  .report-cover h1.cover-title.fit-long { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.long)}; line-height: 1.06; }
  .report-cover h1.cover-title.fit-longest { font-size: ${pt(type.coverTitle * COVER_TITLE_SCALE.longest)}; line-height: 1.1; }
  /* The subtitle sets smaller than the title and on its own line. At parity it
     wraps a locality onto a third line, which pushes the meta block into the
     cover footer — seen in a real render before this was corrected. */
  .report-cover .cover-title em {
    display: block;
    margin-top: 3mm;
    font-family: ${S.accent};
    font-style: italic;
    font-weight: 400;
    font-size: 0.66em;
    line-height: 1.05;
    color: ${palette.accentOnField};
  }
  /* The meta block runs to a second row rather than squeezing its columns.

     One row of however many entries a format supplied sized its columns to
     content, so a fourth entry took every column below its content width and
     three of the four broke — including "04 August 2026", set as "04 August"
     over "2026". A date that wraps is the kind of thing a reader registers as
     sloppiness before they have read a word, and it is on the cover.

     renderCover now chunks the entries into rows of at most three, balanced,
     and the vertical border-spacing separates them. Still a table: the flat
     sheet's layout model is tables rather than flexbox, for the reason this
     file's header gives, and a cover is not the place to make an exception. */
  .report-cover .cover-meta {
    margin-top: 16mm;
    display: table;
    border-spacing: 7mm 5mm;
    margin-left: -7mm;
    font-family: ${S.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${alpha(palette.onFieldInk, 0.78)};
  }
  .report-cover .cover-meta .meta-row { display: table-row; }
  .report-cover .cover-meta .meta-item { display: table-cell; vertical-align: top; }
  .report-cover .cover-meta .lbl {
    display: block;
    color: ${palette.accentOnField};
    margin-bottom: 3mm;
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
  }
  .report-cover .cover-meta .val {
    font-family: ${S.body};
    font-size: ${pt(type.body)};
    letter-spacing: ${PRINT_TRACKING.normal};
    text-transform: none;
    color: ${palette.onFieldInk};
    font-weight: 500;
  }
  .report-cover .cover-footer {
    position: absolute;
    bottom: 14mm; left: 22mm; right: 22mm;
    display: table;
    /* Same reason as the masthead — "PRIVATE AND CONFIDENTIAL" and the
       reference printed as one run on the cover this fixes. */
    table-layout: fixed;
    width: ${COVER_ROW_WIDTH_MM}mm;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${alpha(palette.onFieldInk, 0.55)};
  }
  .report-cover .cover-footer .left { display: table-cell; text-align: left; }
  .report-cover .cover-footer .right { display: table-cell; text-align: right; }
  .report-cover .cover-lockup { margin-bottom: 12mm; }`;

  if (options.coverStyle === 'editorial') {
    return `${shared}

  /* Editorial — the title sits low, magazine-style, and the photograph carries
     the top two-thirds. */
  .report-cover .cover-body {
    position: absolute;
    left: 22mm; right: 22mm; bottom: 38mm;
  }`;
  }

  if (options.coverStyle === 'image') {
    return `${shared}

  /* Image-led — the photograph is the cover and the type sits on a solid plinth
     at the foot, so it never depends on what is behind it. */
  .report-cover .cover-scrim { background: none; }
  .report-cover .cover-body {
    position: absolute;
    box-sizing: border-box;
    left: 0; right: 0; bottom: 0;
    padding: 20mm 22mm 26mm;
    background: ${palette.field};
  }
  .report-cover h1.cover-title { font-size: ${pt(type.h1 + 6)}; }`;
  }

  return `${shared}

  /* Title overlay — the house default. Anchored to the FOOT of the sheet, not
     the top: the block grows upward into empty space, so a long address cannot
     push the meta rows down into the cover footer. Both are absolutely
     positioned, so nothing would have stopped it. */
  .report-cover .cover-body {
    position: absolute;
    left: 22mm; right: 22mm; bottom: 40mm;
  }`;
}

/**
 * Build the stylesheet.
 *
 * Deterministic for a given input: same palette, same options, same masthead →
 * byte-identical output.
 */
export function buildReportCss(input: ReportCssInput): string {
  const palette = input.palette;
  const options = normalizeReportDesignOptions(input.options);
  const layer = input.design ?? designLayerOf(palette);
  // The five type roles: the design's where there is one, the house's otherwise.
  const S: ReportTypography = layer?.typography ?? PRINT_STACK;
  // Each display role's size against the house's; 1 throughout without a
  // design, so every size below is the number it always was.
  const F: ReportTypeFit = layer?.fit ?? UNIT_TYPE_FIT;
  const type = scaledType(options);
  const d = DENSITY_METRICS[options.density];
  const i = intensity(options);

  return `${pageRules(palette, input.masthead, type, options.pressMarks, S, F)}

  /* ── Foundation ─────────────────────────────────────────────────────── */
  html, body {
    margin: 0;
    padding: 0;
    background: ${palette.paper};
    color: ${palette.bodyInk};
    font-family: ${S.body};
    font-size: ${pt(type.body)};
    line-height: ${d.leading};
    font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
  }

  /* ── Case-sensitive forms on everything set in caps ───────────────────

     Every uppercase run in this system is also letterspaced, most of them at
     0.18em. Without the case feature, a parenthesis, a hyphen, a bullet or a
     slash inside one keeps its lowercase optical position — designed to sit
     against an x-height — so it drops below the centre of the capitals around
     it and the extra tracking makes the misalignment plain. EXAMPLE (DRAFT) is
     the one to look at: both parentheses sit low and small.

     Both IBM Plex Mono and Playfair Display carry the feature. One declaration
     per surface, and it is the cheapest visible improvement available anywhere
     in this stylesheet.

     Enumerated rather than put on the body rule to inherit: case also
     substitutes figure forms in some faces, and this system sets figures
     deliberately three different ways below. A feature that reached everything
     by default would quietly overrule all three.

     The running head and foot are margin boxes, which take their own
     declarations and inherit nothing from this rule. Theirs sit beside their
     own text-transform. */
  .report-cover .cover-eyebrow,
  .report-cover .cover-masthead,
  .report-cover .cover-meta,
  .report-cover .cover-footer,
  .brand-lockup .lockup-text,
  .company-page .company-name .tail,
  .company-page .contact-label,
  .callout .callout-label,
  .decision-box .decision-label,
  .sidenote .sidenote-label,
  .kpi .kpi-label,
  .chart-figure figcaption,
  .pull-quote cite,
  .eyebrow,
  h4,
  table.data caption,
  table.data th {
    font-feature-settings: "kern" 1, "liga" 1, "case" 1;
  }

  /* ── The document outline ─────────────────────────────────────────────

     The bookmark properties appeared nowhere in this design system, so every
     report it has ever produced opens with an empty bookmarks pane —
     including a twenty-nine page one. The contents page tells a reader what
     is in the document and gives them no way to get there; the outline is the
     half a reader can actually use. It is also what a screen reader navigates
     by, which makes it part of the accessibility claim rather than a
     convenience.

     Two levels, from the two headings that are structural. An h3 is a
     sub-subhead inside a chapter and belongs in the prose, not in a pane.

     The cover is excluded deliberately: its heading is the document's title,
     so an outline that began with it would open on an entry pointing at the
     page the reader is already looking at. WeasyPrint reads these from the
     stylesheet — the technique is the one in
     src/lib/reportTemplate/htmlRenderer.ts, which has used it since it was
     written. */
  .chapter-header h1,
  .page-contents h1,
  .company-page .company-name {
    bookmark-level: 1;
    bookmark-label: content(text);
  }
  .chapter-body h2 {
    bookmark-level: 2;
    bookmark-label: content(text);
  }
  .report-cover h1.cover-title { bookmark-level: none; }

  /* ── Typography ─────────────────────────────────────────────────────── */
  h1, h2, h3 {
    font-family: ${S.display};
    color: ${palette.bodyInk};
    font-weight: 600;
    letter-spacing: ${PRINT_TRACKING.snug};
    line-height: 1.12;
    margin: 0;
    page-break-after: avoid;
  }
  h1 { font-size: ${pt(type.h1 * F.display)}; }
  /* ── A subhead is a different object from a chapter title ──────────────
     h1 and h2 shared face, colour, weight, tracking and line-height, and
     differed only in size and margin — so an h2 was a chapter title set
     smaller. That is invisible while a chapter title sits above it and wrong
     the moment one does not: a chapter always breaks to a new page, and
     page-break-after:avoid regularly puts an h2 at the top of a fresh sheet
     with nothing above it but the running head. A 20pt Playfair heading
     opening a blank page reads as a chapter opener that lost its eyebrow and
     its rule.

     Two signals, not three. The first version also drew an accent rule above
     the subhead, and a render said what that costs: at the top of a sheet a
     full-measure 0.6pt hairline is indistinguishable from a header rule, so it
     separated the subhead from the page break rather than from the text above
     it — and eight subheads down two pages, each with its own gold rule at
     ~55pt intervals, read as a rate card rather than as prose. Half the
     title's size at a lighter weight is enough; a native Borrowing Capacity
     page sets its subheads at this size with no rule and reads correctly.

     subhead is its own token rather than a ratio of h1, so a brand design
     system that moves it moves it. It stays above 14pt at every bodyScale,
     which keeps it in the display contrast band (see tokens.pure.ts). */
  h2 {
    font-size: ${pt(type.subhead * F.display)};
    font-weight: 500;
    margin: ${pt(d.blockGapPt + 12)} 0 ${pt(d.paragraphGapPt + 3)};
  }
  h3 { font-size: ${pt(type.h3 * F.display)}; margin: ${pt(d.blockGapPt)} 0 ${pt(d.paragraphGapPt - 1)}; }
  /* ── Why there is no keep-together beyond the heading ──────────────────
     A subhead can still open a section in the last inch of a page:
     page-break-after:avoid promises only the *next* box, and when every
     paragraph is one line the next box always fits. Refusing a break after the
     first block as well was tried, and a render said what it costs — it turned
     a bad break into a worse page. The group it creates is often a chapter's
     tail, and a tail that no longer fits moves to a sheet of its own: a subhead
     and two lines alone at 1.1% ink, which is more visible than the fault it
     was fixing.

     The condition that separates the two cases is "unless this would strand
     the group", and CSS cannot express it — there is no way to ask whether the
     receiving page would be empty. So the heading keeps its own rule and
     nothing more. Recorded rather than left to be rediscovered. */
  /* h4 is the mono micro-label, not a smaller heading — it is the same object
     as .eyebrow and shares its colour so the two never drift apart. */
  h4 {
    font-family: ${S.mono};
    text-transform: uppercase;
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    font-size: ${pt(type.caption)};
    font-weight: 700;
    color: ${palette.accentOnPaper};
    margin: ${pt(d.paragraphGapPt + 5)} 0 ${pt(d.paragraphGapPt - 3)};
    page-break-after: avoid;
  }

  p {
    margin: 0 0 ${pt(d.paragraphGapPt)};
    orphans: 3;
    widows: 3;
    ${options.justifyText ? 'text-align: justify;' : 'text-align: left;'}
  }
  /* Figures in a sentence are not figures in a column. Tabular figures set
     every digit on the same advance, so a year or a percentage inside a
     paragraph opens a gap on both sides of its narrow digits — right in a
     table, wrong in prose, and inherited into prose wherever a numeric rule
     was an ancestor. Said here rather than left to the face's default. */
  p, li, blockquote, .callout-body, .decision-box, .sidenote-body {
    ${PROSE_NUMERIC_FEATURES}
  }

  /* ── Hyphenation, body prose only ─────────────────────────────────────

     It works: pyphen ships with the engine and renderDocument sets lang.
     Two things about how it was wired were wrong.

     It was welded to justifyText, in the same ternary — so turning
     justification off silently turned hyphenation off too, and a ragged-right
     setting is where a long word hurts most. And it was on p alone, so a list
     item and a callout body, which sit on a narrower measure than the text
     around them, were the two places that could not break a word.

     The limits are what keep it from being the other kind of eyesore: never
     break a word under six letters, and never leave fewer than three letters
     before the hyphen or three after it. There is no limit on consecutive
     hyphenated lines — hyphenate-limit-lines is an unknown property on the
     pinned engine, which said so on stderr the first time it was asked. It is
     recorded in UNSUPPORTED so it cannot come back silently.

     Not on headings, cover type, table cells or figure labels — those are set
     to be read at a glance and a hyphen in one reads as a typo. */
  p, li, .callout-body p, .decision-box p, .sidenote-body p {
    hyphens: auto;
    hyphenate-limit-chars: 6 3 3;
  }
  h1, h2, h3, h4, caption, th, td,
  .cover-title, .cover-eyebrow, .cover-meta, .chapter-header,
  .kpi-label, .kpi-value, .eyebrow, .figure-label, .toc-row {
    hyphens: none;
  }

  strong { font-weight: 600; color: ${palette.bodyInk}; }
  em {
    font-family: ${S.accent};
    font-style: italic;
    font-size: 1.05em;
    /* Pinned, because only the 400 italic of the accent face ships.

       Without a weight this rule inherits one, so inside an h1 (600) or an h2
       (500) it asks for an italic at that weight. There is no such cut, and
       Pango emboldens the 400 synthetically rather than refusing — a smeared
       italic that nothing downstream can see. The cover title already pinned
       400 for exactly this reason, which shows the hazard was known and
       handled in one place only.

       font-synthesis: none is the declaration that says "fall back visibly
       rather than fake it", and it is an unknown property on the pinned
       engine — asked, warned about on stderr, ignored. Pinning the weight is
       what actually works: it requests the cut that exists. */
    font-weight: 400;
  }
  a {
    color: ${palette.accentOnPaper};
    text-decoration: none;
    border-bottom: 0.3pt solid ${alpha(palette.accentOnPaper, 0.4)};
  }
  ul, ol { margin: 0 0 ${pt(d.paragraphGapPt)}; padding-left: 14pt; }
  li { margin-bottom: ${pt(d.paragraphGapPt / 2)}; }
  /* Footnotes — the markdown renderer's [^id] references and its Notes list.
     A raised number, not vertical-align:super: the UA's super shifts a whole
     line of leading and opens a visible gap in the paragraph above it. The
     notes list sets a step smaller than body, like every apparatus line. */
  sup.fn-ref { font-size: 0.65em; line-height: 0; vertical-align: 0.45em; }
  ol.fn-notes { font-size: 0.88em; margin-top: ${pt(d.paragraphGapPt)}; }
  ol.fn-notes li { margin-bottom: ${pt(d.paragraphGapPt / 3)}; }
  /* A list whose items carry their own leading glyph.
     The model's glance strip writes its own marker per item — a tick, a
     diamond, a warning sign, a star — and each one means something. Left as an
     ordinary list the sheet added a bullet in front of it, so a client's page
     printed two markers where the model wrote one. The list stays a list,
     because a tagged PDF should announce it as one; only the sheet's marker
     goes. (No example glyph in this comment: comments in this file ship inside
     every document, and the clientDetails spec rightly fails the build for a
     dingbat anywhere in the HTML.) */
  ul.marked { list-style: none; padding-left: 0; }
${options.showDropCaps
    ? `
  /* A raised initial on the chapter's first body paragraph — NOT a floated drop
     cap.

     The floated ::first-letter was tried and rejected against a real render:
     WeasyPrint places the float but does not shorten the first line box around
     it, so the initial lands on top of the words it opens. Lines two and three
     indent correctly, which makes the defect look like a near-miss rather than
     the unsupported construct it is. A raised initial needs no float, sets on
     the baseline, and is the device most financial print uses anyway.

     Never on .lede: a standfirst is already set larger and in the italic accent
     face, and an initial in front of it reads as a mistake. */
  .chapter-body > p:first-of-type:not(.lede)::first-letter,
  .chapter-body > .lede + p::first-letter {
    font-family: ${S.display};
    font-size: 2.1em;
    line-height: 1;
    padding-right: 1pt;
    color: ${palette.accentOnPaper};
  }
`
    : ''}
  /* ── Eyebrow — the brand's typographic signature ────────────────────── */
  .eyebrow {
    font-family: ${S.mono};
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    font-weight: 700;
    color: ${palette.accentOnPaper};
    margin-bottom: ${pt(d.paragraphGapPt + 1)};
  }
  .eyebrow::before { content: "— "; }
  .eyebrow.on-field { color: ${palette.accentOnField}; }

  /* ── Pull quote ─────────────────────────────────────────────────────── */
  /* Stat card — the generator's ::: stat and ::: divider blocks: a label, one
     figure at display size with its unit, a caption, between two hairlines. */
  .stat-card {
    margin: ${pt(d.blockGapPt)} 0;
    padding: ${pt(d.cellPadPt + 5)} 0;
    border-top: 0.75pt solid ${palette.rule};
    border-bottom: 0.75pt solid ${palette.rule};
    page-break-inside: avoid;
  }
  .stat-card .stat-label {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: 3pt;
  }
  .stat-card .stat-value {
    font-family: ${S.display};
    font-size: ${pt((type.h2 + 8) * F.display)};
    line-height: 1.1;
    font-weight: 700;
    color: ${palette.bodyInk};
    font-variant-numeric: lining-nums tabular-nums;
  }
  .stat-card .stat-unit { font-size: ${pt(type.body + 1)}; font-weight: 600; margin-left: 2pt; }
  .stat-card .stat-sub {
    display: block;
    margin-top: 3pt;
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }
  .stat-card .stat-headline { margin: 4pt 0 0; }

  .pull-quote {
    font-family: ${S.display};
    font-style: italic;
    font-size: ${pt(type.pullQuote * F.display)};
    line-height: 1.25;
    ${EDITORIAL_NUMERIC_FEATURES}
    /* Same reason as em: pin the cut that ships rather than inherit a weight
       there is no italic for. */
    font-weight: 400;
    color: ${palette.bodyInk};
    margin: ${pt(d.blockGapPt + 4)} 0;
    padding: 0 0 0 14pt;
    border-left: 2pt solid ${palette.accentFill};
    page-break-inside: avoid;
    text-align: left;
  }
  .pull-quote cite {
    display: block;
    margin-top: ${pt(d.paragraphGapPt - 1)};
    font-family: ${S.mono};
    font-style: normal;
    font-size: ${pt(type.caption)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }

  /* ── KPI strip ──────────────────────────────────────────────────────── */
  .kpi-strip {
    display: table;
    table-layout: fixed;
    width: 100%;
    border-top: 0.6pt solid ${palette.bodyInk};
    border-bottom: 0.6pt solid ${palette.bodyInk};
    margin: ${pt(d.blockGapPt)} 0 ${pt(d.blockGapPt + 4)};
    page-break-inside: avoid;
  }
  .kpi-strip .kpi {
    display: table-cell;
    vertical-align: top;
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    border-right: 0.3pt solid ${palette.rule};
  }
  .kpi-strip .kpi:last-child { border-right: 0; }
  .kpi .kpi-label {
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    margin-bottom: 6pt;
  }
  .kpi .kpi-value {
    font-family: ${S.display};
    font-size: ${pt((type.h2 + 2) * F.display)};
    /* Not 1. A KPI value is usually a figure on one line, where a leading of
       exactly the em is the right tight setting — but table-layout: fixed
       divides the strip evenly, so a six-cell strip gives each value about
       28mm, and anything wordier than a number wraps. At line-height 1 the
       second line's ascenders print through the first line's descenders in a
       display face. 1.08 is the smallest leading that clears them and is
       invisible on the one-line case. */
    line-height: 1.08;
    color: ${palette.bodyInk};
    ${NUMERIC_FEATURES}
  }
  /* Five or more cells — see KPI_DENSE_FROM. The step down is what stops a
     28mm cell breaking "House" into "Hous / e". */
  .kpi-strip.dense .kpi-value { font-size: ${pt(type.subhead * F.display)}; }
  .kpi-strip.dense .kpi { padding: ${pt(d.cellPadPt + 4)} ${pt(d.cellPadPt + 4)}; }
  .kpi .kpi-value.pos { color: ${palette.positive}; }
  .kpi .kpi-value.neg { color: ${palette.negative}; }
  .kpi .kpi-foot {
    margin-top: 4pt;
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }

  /* ── The composed sheet ─────────────────────────────────────────────── */
  /* A page whose contents were chosen rather than flowed into.

     A break and nothing else — no min-height. Giving the sheet the height of
     the content box seemed obvious and was wrong twice: a chapter header sits
     above the first sheet, so a full-height box no longer fitted beside it and
     the contents were pushed to the next page under a sheet of blank paper;
     and a run of them turned a two-chapter document into ten pages. Whether a
     sheet fills its page is a question about the composition, and the page
     critique answers it by measuring the ink on the render. */
  .sheet { break-after: page; }
  /* Without this the last sheet's break emits a blank page before the closing
     company page. */
  .sheet:last-of-type { break-after: auto; }

  /* ── Columns and the asymmetric grid ────────────────────────────────── */
  .two-col {
    column-count: 2;
    column-gap: 8mm;
    column-rule: 0.3pt solid ${palette.rule};
    margin: ${pt(d.paragraphGapPt + 3)} 0;
  }
  .two-col p { break-inside: avoid-column; }

  /* Percentage cells rather than a 12-track grid: WeasyPrint has no CSS Grid,
     and the four spans below are the only ones the layouts use. */
  .grid-12 {
    display: table;
    table-layout: fixed;
    width: 100%;
    border-spacing: ${GRID_GUTTER_MM}mm 0;
    margin: ${pt(d.blockGapPt)} -${GRID_GUTTER_MM}mm;
  }
  .grid-12 > .col { display: table-cell; vertical-align: top; }
${(Object.entries(GRID_SPANS) as Array<[string, number]>)
    .map(([span, pct]) => `  .grid-12 > .col-${span} { width: ${pct}%; }`).join('\n')}

  /* ── Sidenote, callout, decision box ────────────────────────────────── */
  .sidenote {
    background: ${palette.paperAlt};
    border-left: 2pt solid ${palette.accentFill};
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    font-size: ${pt(type.caption + 1)};
    line-height: 1.5;
    color: ${palette.bodyInk};
    page-break-inside: avoid;
    margin: ${pt(d.blockGapPt)} 0;
  }
  .sidenote .sidenote-label {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: 4pt;
  }

  /* Callout — tone carries meaning, so the left rule is a Category B colour and
     the ground is a wash of the same. Never the brand: "risk" must not change
     colour when a tenant does. */
  .callout {
    padding: ${pt(d.cellPadPt + 5)} ${pt(d.cellPadPt + 7)};
    margin: ${pt(d.blockGapPt)} 0;
    border-left: 2pt solid ${palette.rule};
    background: ${palette.paperAlt};
    page-break-inside: avoid;
    font-size: ${pt(type.caption + 1)};
  }
  .callout .callout-label {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    margin-bottom: 4pt;
  }
  .callout.tone-positive { border-left-color: ${palette.positive}; }
  .callout.tone-positive .callout-label { color: ${palette.positive}; }
  .callout.tone-caution { border-left-color: ${palette.caution}; }
  .callout.tone-caution .callout-label { color: ${palette.caution}; }
  .callout.tone-negative { border-left-color: ${palette.negative}; }
  .callout.tone-negative .callout-label { color: ${palette.negative}; }
  .callout.tone-informative { border-left-color: ${palette.informative}; }
  .callout.tone-informative .callout-label { color: ${palette.informative}; }
  .callout.tone-neutral .callout-label { color: ${palette.mutedInk}; }

  /* ── The glance key ──────────────────────────────────────────────────
     A section's findings, set as a ruled key rather than a box of dingbats.

     What this replaces drew twelve washed, left-ruled boxes on one Compass,
     three of them on page 28, each a stack of raw glyphs. Three things were
     wrong and none was the content: a dingbat is not a category (it survives
     neither greyscale nor a screen reader nor a reader who has not been told
     the key); a wash plus a rule says "separate object", and spending both on
     a summary of the prose directly beneath it turns a page into a stack of
     boxes; and every finding started where the previous glyph ended, so four
     findings sat on four left edges inside one box.

     Hairlines top and bottom, no ground, no left bar. The meaning is a word in
     a fixed column, so every finding hangs on one axis and the tag reads in
     greyscale; the tone colour rides on top of the word rather than instead of
     it. See reports/glanceStrip.pure.ts for the vocabulary. */
  .glance {
    border-top: 0.6pt solid ${palette.rule};
    border-bottom: 0.6pt solid ${palette.rule};
    padding: ${pt(d.cellPadPt + 3)} 0 ${pt(d.cellPadPt + 4)};
    margin: ${pt(d.blockGapPt + 2)} 0;
    page-break-inside: avoid;
  }
  .glance .glance-label {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
    margin-bottom: ${pt(d.cellPadPt + 1)};
  }
  /* The sheet's own marker is removed and none is added: the tag column IS the
     marker. list-style:none on a <ul> keeps the tagged PDF announcing a
     list while the bullet goes. */
  .glance ul.glance-rows { list-style: none; padding-left: 0; margin: 0; }
  /* A hanging indent, so a finding that wraps aligns under itself rather than
     under its tag. The tag column is sized from the longest word the
     vocabulary can print. */
  .glance .glance-row {
    position: relative;
    padding-left: ${pt(d.cellPadPt * 4 + 24)};
    margin: 0 0 ${pt(d.paragraphGapPt / 2)};
    font-size: ${pt(type.caption + 1)};
    line-height: 1.45;
    color: ${palette.bodyInk};
  }
  .glance .glance-row:last-child { margin-bottom: 0; }
  .glance .glance-tag {
    position: absolute;
    left: 0;
    top: 0.1em;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }
  /* Category B colours — the tone must read the same in a tenant's report as
     in ours, so never the brand. "context" keeps the muted ink: a neutral fact
     is the one reading that should not pull the eye. */
  .glance .glance-strength .glance-tag { color: ${palette.positive}; }
  .glance .glance-watch .glance-tag { color: ${palette.caution}; }
  .glance .glance-verdict .glance-tag { color: ${palette.accentOnPaper}; }

  /* Decision box — "What this means". One per section, by the compass rules. */
  .decision-box {
    border: 0.6pt solid ${palette.accentFill};
    background: ${alpha(palette.accentFill, 0.07 * i)};
    padding: ${pt(d.cellPadPt + 7)} ${pt(d.cellPadPt + 9)};
    margin: ${pt(d.blockGapPt + 2)} 0;
    page-break-inside: avoid;
  }
  .decision-box .decision-label {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
    margin-bottom: 6pt;
  }
  .decision-box p:last-child { margin-bottom: 0; }

  /* ── Contents ───────────────────────────────────────────────────────── */
  .contents { display: table; width: 100%; margin-top: ${pt(d.blockGapPt)}; }
  /* A contents entry is one line and must not be split across a page.
     Found on the first Market Intelligence render, which is the first document
     in the programme with a contents page long enough to break: the last entry
     kept its number and its note on page two and put its title alone on page
     three, so the contents listed a section with no name. */
  .contents .toc-row { display: table-row; break-inside: avoid; page-break-inside: avoid; }
  /* A contents page must not end by stranding one entry on the next sheet.
     Keeping a row whole fixed a title separated from its number and swapped in
     a different fault: the fourteen-entry Market Intelligence contents put
     thirteen rows on one page and the fourteenth alone on the next, at 0.2%
     ink, on a named page that carries no running head — so page three of a
     twenty-two page report was a single line floating under nothing, which
     reads as a printing fault rather than as a contents page.

     Refusing a break after each of the last three rows pulls the whole tail
     over together. It is the table equivalent of widows, which does not apply
     to rows. */
  .contents .toc-row:nth-last-child(-n+4):not(:last-child) {
    break-after: avoid;
    page-break-after: avoid;
  }
  .contents .toc-row > * {
    display: table-cell;
    padding: ${pt(d.cellPadPt)} 0;
    border-bottom: 0.3pt solid ${palette.rule};
  }
  .contents .toc-no {
    width: 12%;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.wide};
    color: ${palette.accentOnPaper};
  }
  .contents .toc-title { color: ${palette.bodyInk}; }
  .contents .toc-note {
    width: 34%;
    font-size: ${pt(type.caption)};
    color: ${palette.mutedInk};
  }
  .contents .toc-page {
    width: 8%;
    text-align: right;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    color: ${palette.mutedInk};
    ${NUMERIC_FEATURES}
  }

  /* ── Brand lockup ───────────────────────────────────────────────────── */
  .brand-lockup { display: table; }
  .brand-lockup .lockup-mark { display: table-cell; vertical-align: middle; }
  .brand-lockup .lockup-mark img { display: block; height: 13mm; width: auto; }
  .brand-lockup .lockup-text {
    display: table-cell;
    vertical-align: middle;
    padding-left: 4mm;
    font-family: ${S.mono};
    font-size: ${pt(type.micro + 0.5)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    color: ${palette.accentOnPaper};
  }
  .brand-lockup.on-field .lockup-text { color: ${palette.accentOnField}; }
  .brand-lockup.mark-lg .lockup-mark img { height: 22mm; }

  /* ── Closing company page — full-bleed field ────────────────────────── */
  /* Full-bleed: the disclaimer page carries no @page margin, so the block is
     the whole sheet and its own padding is the margin. Without border-box the
     padding is added to the 210mm width and the contact block runs off the
     right edge of the paper. */
  .company-page {
    position: relative;
    box-sizing: border-box;
    width: ${PAGE_SIZE.widthMm}mm;
    height: ${PAGE_SIZE.heightMm}mm;
    background: ${palette.field};
    color: ${palette.onFieldInk};
    padding: 24mm 22mm;
    page-break-before: always;
  }
  .company-page .company-name {
    font-family: ${S.cover};
    /* SemiBold, and stating it is not decoration: an unstated weight is a 400
       request, and a request the image cannot answer exactly is how a face gets
       synthesised.

       A weight above the cover title's Regular, deliberately. This is a
       wordmark set smaller than the title and it has to hold the page on its
       own, where the title has a whole sheet of furniture around it. */
    font-weight: 600;
    font-size: ${pt((type.h1 - 4) * F.cover)};
    line-height: 1.05;
    color: ${palette.accentOnField};
    margin: 0 0 ${pt(d.blockGapPt + 6)};
    letter-spacing: ${PRINT_TRACKING.snug};
  }
  .company-page .company-name .tail {
    display: block;
    font-family: ${S.mono};
    font-size: ${pt(type.h3 - 1)};
    letter-spacing: ${PRINT_TRACKING.widest};
    text-transform: uppercase;
    margin-top: 3mm;
    color: ${alpha(palette.onFieldInk, 0.85)};
  }
  .company-page .contact { display: table; width: 100%; margin-bottom: ${pt(d.blockGapPt + 8)}; }
  .company-page .contact-row { display: table-row; }
  .company-page .contact-row > * { display: table-cell; padding: ${pt(d.cellPadPt)} 0; }
  .company-page .contact-label {
    width: 26mm;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.accentOnField};
  }
  .company-page .contact-value {
    font-size: ${pt(type.caption + 1)};
    color: ${palette.onFieldInk};
  }
  .company-page .disclaimer {
    border-top: 0.4pt solid ${alpha(palette.onFieldInk, 0.25)};
    padding-top: ${pt(d.blockGapPt)};
    color: ${alpha(palette.onFieldInk, 0.72)};
    line-height: 1.5;
    text-align: left;
  }
  .company-page .disclaimer p { margin: 0 0 ${pt(d.paragraphGapPt - 2)}; text-align: left; }
  .company-page .disclaimer p:last-child { margin-bottom: 0; }

  /* ── Charts ─────────────────────────────────────────────────────────── */
  .chart-figure {
    margin: ${pt(d.blockGapPt)} 0;
    page-break-inside: avoid;
  }
  /* The SVG carries its own viewBox and scales to the measure; the width here
     is what fixes the printed size, and therefore what the point sizes in
     charts.pure.ts are computed against. */
  /* A chart is an img carrying a data-URI SVG, so that the engine tags it as a
     figure with alternative text — see chartFigure in charts.pure.ts. The
     inline svg case remains for a figure with nothing to describe it by. */
  .chart-figure svg,
  .chart-figure .chart-img { display: block; width: 100%; height: auto; }
  /* A chart drawn at CHART_WIDTH.compact prints at the width it was drawn for,
     not stretched across the measure - see chartFigure's ChartFigureWidth. Left
     against the measure rather than centred, so it reads as a figure in a
     column and not as a slide. */
  .chart-figure.chart-compact { width: 60.5%; }
  .chart-figure figcaption {
    margin-top: 6pt;
    font-family: ${S.mono};
    font-size: ${pt(type.micro)};
    letter-spacing: ${PRINT_TRACKING.eyebrow};
    text-transform: uppercase;
    color: ${palette.mutedInk};
  }
  /* A sparkline that flows inside a line of body copy keeps its own size. */
  .spark-inline { display: inline; width: auto; height: 1em; vertical-align: -0.15em; }

  /* ── Utilities ──────────────────────────────────────────────────────── */
  .avoid-break { page-break-inside: avoid; }
  .break-before { page-break-before: always; }
  .num { ${NUMERIC_FEATURES} }
  .muted { color: ${palette.mutedInk}; }
  .lede {
    font-family: ${S.accent};
    font-style: italic;
    font-size: ${pt((type.bodyLg + 1) * F.accent)};
    line-height: 1.4;
    ${EDITORIAL_NUMERIC_FEATURES}
    font-weight: 400;
    color: ${palette.mutedInk};
    margin-bottom: ${pt(d.blockGapPt)};
    text-align: left;
  }
${tableRules(palette, options, type, S)}
${chapterRules(palette, options, type, S, F)}
${coverRules(palette, options, type, S)}
${raisedRules(palette, options, type)}
${templateDesignCss(layer, palette, options, type)}`;
}

/**
 * The raised surface style.
 *
 * Appended last so every rule here overrides its flat counterpart by order
 * rather than by specificity — no `!important`, and the flat sheet stays
 * readable on its own.
 *
 * ## What is deliberately absent
 *
 * No `box-shadow` and no `filter: blur()`. WeasyPrint 69 ignores both as
 * unknown properties, and its SVG renderer ignores `feGaussianBlur` too, so
 * the soft glow a browser-rendered document gets under a card is genuinely
 * unavailable here. Tested, not assumed. What replaces it is a gradient fill
 * and a hairline ring, which read as *lifted* without pretending to a shadow —
 * and everything else in a browser-designed reference page (flexbox, grid,
 * radius, gradients, the paper texture, a rounded table shell, pill badges)
 * WeasyPrint draws correctly.
 */
function raisedRules(
  palette: ResolvedReportPalette,
  options: ReportDesignOptions,
  type: Record<string, number>,
): string {
  if (options.surfaceStyle !== 'raised') return '';
  const d = DENSITY_METRICS[options.density];
  const radius = '3.2mm';

  return `
  /* ── Raised ─────────────────────────────────────────────────────────── */

  /* The paper carries a faint square grid. Two repeating gradients rather than
     an image: nothing to fetch, nothing to inline, and it scales with the page
     instead of resampling.

     On the page box rather than on a section, because a section's background
     paints its own box and stops. A later @page rule merges with the earlier
     one, so this adds the image without disturbing the paper colour. */
  @page {
    background-image:
      linear-gradient(${alpha(palette.rule, 0.38)} 0.2pt, transparent 0.2pt),
      linear-gradient(90deg, ${alpha(palette.rule, 0.38)} 0.2pt, transparent 0.2pt);
    background-size: 14mm 14mm;
  }
  /* Not on the field pages: a grid over an obsidian cover is a cutting mat. */
  @page cover { background-image: none; }
  @page disclaimer { background-image: none; }
  /* The paper colour lives on the page box, which is what the texture is
     drawn on. The root element's background is propagated to the canvas and
     painted over that box, so leaving it set covered the content area and the
     grid survived only in the margins — which read exactly like a printing
     fault. Both are cleared; the page box still carries the paper. */
  html, body { background: transparent; }

  /* KPI cards, not a KPI strip. The single biggest visual difference between a
     document that looks composed and one that looks printed out. */
  .kpi-strip {
    display: flex;
    gap: ${pt(d.blockGapPt - 2)};
    border-top: 0;
    border-bottom: 0;
  }
  .kpi-strip .kpi {
    display: block;
    flex: 1 1 0;
    border-right: 0;
    border-radius: ${radius};
    border: 0.3pt solid ${alpha(palette.rule, 0.9)};
    background: linear-gradient(160deg, ${palette.paperBright} 0%, ${palette.paperAlt} 100%);
    padding: ${pt(d.cellPadPt + 6)} ${pt(d.cellPadPt + 6)};
  }

  /* A shell around the table, and a header band inside it. */
  .table-block, table.data {
    border-radius: ${radius};
    /* Clips the corners of the header band to the shell's own radius. */
    overflow: hidden;
  }
  table.data {
    border-collapse: separate;
    border-spacing: 0;
    border: 0.3pt solid ${alpha(palette.rule, 0.9)};
  }
  table.data thead th {
    background: ${palette.paperAlt};
    border-bottom: 0.3pt solid ${palette.rule};
  }
  table.data caption { padding-bottom: ${pt(d.paragraphGapPt)}; }

  /* Callouts, sidenotes and decision boxes become cards too, so a page of them
     reads as one family rather than as three unrelated treatments. */
  .callout, .sidenote, .decision-box {
    border-radius: ${radius};
    background: linear-gradient(160deg, ${palette.paperBright} 0%, ${palette.paperAlt} 100%);
  }

  /* An accent bar beside the section head, which is what carries the eyebrow
     and the title as one object rather than two stacked lines. */
  .chapter-header {
    border-left: 1.2pt solid ${palette.accentOnPaper};
    padding-left: ${pt(d.cellPadPt + 8)};
  }

  /* Rows sit apart rather than butting together. */
  .grid-12 { gap: ${pt(d.blockGapPt)}; }`;
}

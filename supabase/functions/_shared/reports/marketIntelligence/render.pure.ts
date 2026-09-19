/**
 * A Market Intelligence report as HTML, through the design system.
 *
 * ## What this replaces, and what was actually wrong with it
 *
 * Not the structure. `MarketIntelligencePDFGenerator` is a careful 1,159-line
 * jsPDF document — eight named layers in a deliberate order, a table of
 * contents, branded insight cards, colour-coded strategy panels, an events
 * timeline. It draws vectors, not rasters, so unlike the Client Details and Q&A
 * generators its text is already selectable.
 *
 * What is wrong with it is what it does to the content on the way in, and four
 * defects in the drawing:
 *
 *  - **Table cells are hard-truncated.** `.slice(0, 30)` on a header and
 *    `.slice(0, 35)` on a body cell (`:486`, `:499`), with no wrapping and no
 *    per-column measurement. Measured against the record: the corpus holds 10
 *    tables of 72 rows, the widest cell is **322 characters**, and **40.3% of
 *    all table rows lose content** to that cap. Layer 5's own prompt demands a
 *    four-column risk matrix with six or more rows (`index.ts:792-803`), so the
 *    section the document builds toward is the one most damaged.
 *  - **The footer prints on the cover.** `drawCoverPage` does `this.pageNum++`
 *    (`:217`) without going through `addPage`, so the first real `addPage()`
 *    sees `pageNum > 0`, calls `drawFooter()`, and lays a gold rule and
 *    "Page 1" over the navy cover art.
 *  - **The audience badge is measured at the wrong size.** `getTextWidth` is
 *    called at `:259` while the font is still 36pt from the title (`:243`), and
 *    the text is drawn at 9pt (`:262`) — so the gold badge is roughly four times
 *    wider than the word inside it.
 *  - **The contents page lists sections that were never printed.** It is built
 *    from `includedLayers` alone (`:301-345`), and 6 of the record's 46 layer
 *    bodies came back empty. It also carries no page numbers.
 *
 * And `sanitise` (`:86-91`) strips every character outside Latin-1 — the same
 * over-reach the Report Q&A migration records, here removing nothing it was
 * written to remove, because the corpus contains no pictographs and no dingbats
 * at all.
 *
 * ## Two colour systems in one document
 *
 * The body is drawn from thirteen hardcoded constants — `NAVY {13,38,77}`,
 * `GOLD {191,155,80}` (the `#BF9B50` this design system retired) and eleven
 * more — while the closing page comes from `drawJsPDFDisclaimerPage`, which was
 * already migrated and takes `DEFAULT_PALETTE`. So the last page of every market
 * intelligence PDF has been on the design system while the preceding twenty
 * were not.
 *
 * ## The marketing copy is carried, from the pinned brand
 *
 * Three blocks are hardcoded English rather than model output: the per-audience
 * insight panels, a "Why <Brand>?" callout, and a "Ready to Take the Next Step?"
 * box. They are kept — somebody wrote them for a client-facing document — but
 * the brand name comes from the snapshot rather than a second
 * `fetchGlobalReportSettings` round trip, so the document stops having two ideas
 * of who the company is.
 *
 * ## The legacy generator stays
 *
 * This is a second path. `MarketIntelligencePDFGenerator` still draws its
 * document, and both the export button and the history modal still reach it.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderLede,
  renderSidenote,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import { count, formatMeasure } from '../../reportDesign/measure.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
  spinePageBudget,
  validateSpine,
  type SpineEntry,
} from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { renderMarkdown } from '../markdown.pure.ts';
import { formatReportDate, formatReportDateShort as shortDate } from '../reportDate.pure.ts';

import type { MarketEvent, MarketIntelligenceReport } from './payload.pure.ts';
import { narrativeFor } from './normalise.pure.ts';
import {
  chaptersFor,
  contentsPagesFor,
  planSections,
  type PlannedSection,
} from './sections.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['market-intelligence'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;


/**
 * `2026-08-03T…` → `03 August 2026`, and `22 Apr 2026` for a timeline column.
 * Read rather than parsed — see `reportDate.pure.ts` for the three reasons.
 */
export { formatReportDate };

/** The audience editions, as the legacy labels them. */
const AUDIENCE_LABELS: Readonly<Record<string, string>> = {
  general: '',
  investor: 'Investor Edition',
  homebuyer: 'Homebuyer Edition',
};

/**
 * The per-audience insight panels.
 *
 * Hardcoded English carried verbatim from `drawAudienceInsightPanels`
 * (`MarketIntelligencePDFGenerator.ts:862-887`). It is not model output and it
 * says the same thing on every report — but somebody wrote it for a
 * client-facing document, so it is carried rather than quietly dropped. Recorded
 * in the contract as copy that belongs to whoever owns the marketing voice.
 */
export function audiencePanels(segment: string): string {
  if (segment === 'investor') {
    return renderCallout(
      'informative',
      'What this means for your portfolio',
      '<p>These suburbs have been identified based on their yield-to-growth ratio, '
      + 'supply-demand dynamics, and infrastructure pipeline. Each represents a strategic '
      + 'entry point for portfolio growth with strong rental demand underpinning cash flow '
      + 'stability.</p>',
    );
  }
  if (segment && segment !== 'general') {
    return renderCallout(
      'positive',
      'What this means for your home search',
      '<p>These suburbs offer strong lifestyle value alongside genuine capital growth '
      + 'potential. They represent areas where buying now positions you for long-term wealth '
      + 'building, with improving amenities and transport connectivity.</p>',
    );
  }
  return renderCallout(
    'informative',
    'What this means for investors',
    '<p>Focus on yield-to-growth ratios and supply-demand dynamics in the suburbs '
    + 'identified. Each represents a strategic entry point for portfolio growth with strong '
    + 'rental demand underpinning cash flow.</p>',
  ) + renderCallout(
    'positive',
    'What this means for homebuyers',
    '<p>These suburbs offer genuine lifestyle value alongside capital growth potential. '
    + 'Buying in these locations now positions you for long-term wealth building in a less '
    + 'competitive market.</p>',
  );
}

/**
 * The brand's own close.
 *
 * The two boxes the legacy draws at the end of the CTA section (`:734`, `:760`),
 * with the brand name taken from the pinned snapshot rather than from a second
 * settings fetch. The CTA prompt already tells the model not to write its own
 * version (`index.ts:511`), and `stripDuplicateBrandTagline` removes it when the
 * model writes one anyway.
 */
function brandClose(brandName: string): string {
  return renderCallout(
    'neutral',
    `Why ${brandName}?`,
    `<p>${escapeHtml(brandName)} is a strategic property advisory that delivers `
    + 'data-driven, insight-led guidance — enabling clients to act on opportunities others '
    + 'do not see.</p>',
  ) + renderCallout(
    'informative',
    'Ready to take the next step?',
    `<p>Contact ${escapeHtml(brandName)} to discuss your personalised property strategy.</p>`,
  );
}

/**
 * The events timeline.
 *
 * A table rather than the legacy's stack of cards, because the four fields are a
 * record and a reader scanning for a date wants a column. Impact is a word in
 * its own cell as well as a tone on the row — the legacy encodes it as a
 * coloured dot alone (`:820`), and colour is never the only channel in this
 * design system.
 */
function eventsTable(events: readonly MarketEvent[]): string {
  if (!events.length) return '';
  const rows: TableRow[] = events.map((e) => ({
    when: shortDate(e.date),
    // Printed, not only derived. `toEvents` orders the table upcoming-first and
    // then past descending, which is the right reading order and looks like a
    // sorting bug without this column: a reader sees an August row above a July
    // one and has no way to tell it is deliberate. The payload has carried this
    // flag since the first draft and nothing read it.
    timing: e.upcoming ? 'Ahead' : 'Passed',
    event: e.event,
    category: e.category.replace(/_/g, ' '),
    impact: e.impact ? e.impact.charAt(0).toUpperCase() + e.impact.slice(1) : '—',
  }));
  const upcoming = events.filter((e) => e.upcoming).length;
  return renderDataTable(
    [
      { key: 'when', label: 'Date', align: 'left' },
      { key: 'timing', label: 'Timing', align: 'left' },
      { key: 'event', label: 'Event', align: 'left' },
      { key: 'category', label: 'Category', align: 'left' },
      { key: 'impact', label: 'Impact', align: 'left' },
    ],
    rows,
    {
      caption: upcoming
        ? `Ordered with the ${upcoming === 1 ? 'one event' : `${upcoming} events`} still ahead first`
        : 'Most recent first',
    },
  ) + events
    .filter((e) => e.description)
    // Labelled with the event, not only its date. These blocks run onto a page
    // of their own once there are more than a few, and a date alone makes a
    // reader flip back to the table to find out what it was about.
    .map((e) => renderSidenote(
      `${shortDate(e.date)} · ${e.event}`,
      `<p>${escapeHtml(e.description)}</p>`,
    ))
    .join('');
}

/** The sources list. Numbered, so a layer can point at one. */
function sourcesTable(citations: readonly string[]): string {
  if (!citations.length) return '';
  return renderDataTable(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'source', label: 'Source', align: 'left' },
    ],
    citations.map((c, i) => ({ n: String(i + 1), source: c })),
    { caption: 'What this report was drawn from' },
  );
}

// ── The document ────────────────────────────────────────────────────────────

export interface RenderMarketIntelligenceInput {
  report: MarketIntelligenceReport;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  lockup?: BrandLockupProps | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  heroDataUri?: string | null;
  confidentiality?: string | null;
  options?: ReportDesignOptions | null;
  edition?: string | null;
  reference?: string | null;
}

export interface MarketIntelligenceRenderPlan {
  spine: SpineEntry[];
  bodyHtml: string;
  /** Section titles in printed order. The ledger records these. */
  sections: string[];
  pageBudget: number;
  /** Sections the document budget dropped, by title. Named on the page too. */
  dropped: string[];
  /** Characters the section cap and the document budget did not carry. */
  charsOmitted: number;
  /** Layers asked for that returned nothing, by title. Named on the page too. */
  emptyLayers: string[];
  /** True when anything was dropped, clipped, or came back empty. */
  degraded: boolean;
  problems: string[];
}

/** The body of one planned section. */
function sectionBody(
  section: PlannedSection,
  report: MarketIntelligenceReport,
  brandName: string,
): string {
  if (section.kind === 'events') return eventsTable(report.events);
  if (section.kind === 'sources') return sourcesTable(report.citations);

  const prose = section.markdown
    ? renderMarkdown(section.markdown, {
      idPrefix: section.id.replace(/[^a-z0-9]/gi, ''),
      // The model writes `## Executive Summary` as the first line of the
      // section already titled that, and the page then says it twice four
      // lines apart at 34pt and 17pt.
      chapterTitle: section.title,
    }).html
    : '';

  if (section.kind === 'next-steps') {
    return prose + brandClose(brandName);
  }
  // The suburb layer is where the legacy puts its audience panels, and they
  // read as a gloss on that layer rather than as a section of their own.
  if (section.kind === 'layer' && report.layers[section.layerIndex ?? -1]?.key === 'layer7_micro') {
    return prose + audiencePanels(report.meta.audienceSegment);
  }
  return prose;
}

export function renderMarketIntelligenceBody(
  input: RenderMarketIntelligenceInput,
): MarketIntelligenceRenderPlan {
  const report = input.report;
  const brandName = input.masthead || 'this advisory';
  const { sections, dropped, charsOmitted } = planSections(report);

  const spine = buildSpine({
    archetype: 'market-intelligence',
    chapters: chaptersFor(sections),
    contentsPages: contentsPagesFor(sections),
  });
  const problems = validateSpine('market-intelligence', spine);

  // Rebuilt here, not carried from the normaliser.
  //
  // `buildMarketIntelligenceReport` counts layers, because layers are all it
  // has; the document prints sections, and a `full` report has fourteen of them
  // against eight layers. The stored narrative therefore said "in 8 sections"
  // under a cover reading "SECTIONS 14" and over a contents page listing
  // fourteen. The Report Q&A migration had the same defect for the same reason —
  // a figure built before the thing it describes was decided — and the fix is
  // the same: build it from the plan.
  const narrative = narrativeFor(
    report.meta.reportPeriod,
    report.meta.reportTypeLabel,
    sections.length,
    report.layers.filter((l) => l.empty).length,
    report.events.length,
  );

  const audienceLabel = AUDIENCE_LABELS[report.meta.audienceSegment]
    ?? `${report.meta.audienceSegment.charAt(0).toUpperCase()}${report.meta.audienceSegment.slice(1)} Edition`;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The report's own label, as the legacy cover uses. The difference is that
    // it is set as one line here rather than word-grouped two at a time
    // (`:247-254`), which is what put "MARKET INTELLIGENCE" over "REPORT" on
    // every cover regardless of how the title actually reads.
    title: report.meta.reportTypeLabel,
    masthead: input.masthead,
    edition: input.edition ?? null,
    meta: [
      { label: 'Period', value: report.meta.reportPeriod },
      { label: 'Prepared on', value: formatReportDate(report.meta.preparedOn) },
      ...(audienceLabel ? [{ label: 'Edition', value: audienceLabel }] : []),
      { label: 'Sections', value: String(sections.length) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  // Derived from the spine, not counted by hand — so the contents cannot list a
  // section that was not built. The legacy builds its own from `includedLayers`
  // and lists layers that returned nothing.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(spine).map((e) => ({ number: e.number, title: e.title, note: e.note })),
    // This format is the only one whose contents outgrows a sheet — fourteen or
    // fifteen entries, each with a note. Split evenly here rather than left to
    // the page breaker, which fills the first sheet and strands the remainder:
    // it put thirteen rows on one page and the fourteenth alone on the next.
    // Derived from the same `contentsPagesFor` the spine is costed with, so the
    // sheets the reader gets and the pages the spine claims cannot disagree.
    Math.ceil(contentsEntriesFor(spine).length / Math.max(1, contentsPagesFor(sections))),
  );

  // Said on the page, not only in the ledger. A layer that was asked for and
  // came back empty is a gap a reader would otherwise have to notice for
  // themselves — the legacy leaves a contents entry pointing at nothing.
  const emptyLayers = report.layers.filter((l) => l.empty);
  const gaps = emptyLayers.length
    ? renderCallout(
      'caution',
      // "Layers", not "sections". The document's contents page numbers the
      // sections it printed, and the whole point of these is that no section
      // exists for them — calling them sections invites a reader to go looking
      // for numbers that are not there, which is the legacy's defect restated.
      emptyLayers.length === 1 ? 'One layer returned no data' : `${emptyLayers.length} layers returned no data`,
      `<p>${escapeHtml(
        `${emptyLayers.map((l) => l.title).join(', ')} ${emptyLayers.length === 1 ? 'was' : 'were'} `
        + 'requested for this period and returned nothing, so no section appears for '
        + `${emptyLayers.length === 1 ? 'it' : 'them'}.`,
      )}</p>`,
    )
    : '';

  const cut = dropped.length
    ? renderCallout(
      'caution',
      'Not every section is shown',
      `<p>${escapeHtml(
        `${dropped.map((d) => d.title).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} `
        + 'longer than this document can carry and were not printed. The full text is in the '
        + 'report record.',
      )}</p>`,
    )
    : '';

  // A shortened section says so where it was shortened.
  //
  // `MAX_SECTION_CHARS` clips one layer in the record from 244,332 characters to
  // 20,000, and the first render of that shape printed the clipped text with
  // nothing to mark it — a reader would have taken a section that stops
  // mid-argument for the whole of it. `planSections` had counted the omission
  // all along and the renderer simply never asked for the number, which is
  // silent truncation arrived at by omission rather than by choice. It is the
  // one failure this programme exists to remove, so the notice goes in the
  // section itself, not only in the opening lede where a reader twelve pages
  // later will not see it.
  const clipNotice = (section: PlannedSection): string => {
    if (!section.clippedChars) return '';
    return renderCallout(
      'caution',
      'This section is shortened',
      `<p>${escapeHtml(
        // `formatMeasure(count(…))` rather than `toLocaleString('en-AU')`:
        // `measure.pure.ts:121` records why — Deno and Node do not have to
        // agree on ICU grouping, and this string is asserted in a test.
        `A further ${formatMeasure(count(section.clippedChars))} characters of this section `
        + 'are not printed here. The full text is in the report record.',
      )}</p>`,
    );
  };

  const body = sections.map((section, index) => {
    const number = String(index + 1).padStart(2, '0');
    const opening = index === 0 ? renderLede(narrative) + gaps + cut : '';
    return openChapter(DOCUMENT_NAME, number, section.title)
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.dek,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${opening}${sectionBody(section, report, brandName)}`
      + `${clipNotice(section)}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });

  return {
    spine,
    bodyHtml: cover + contents + body + closing,
    sections: sections.map((s) => s.title),
    pageBudget: spinePageBudget(spine),
    dropped: dropped.map((d) => d.title),
    charsOmitted,
    emptyLayers: emptyLayers.map((l) => l.title),
    // Clipping counts. A section printed to two-thirds of its length is a
    // degraded document even though every section is present.
    degraded: dropped.length > 0 || emptyLayers.length > 0 || charsOmitted > 0,
    problems,
  };
}

export function renderMarketIntelligenceDocument(
  input: RenderMarketIntelligenceInput,
): MarketIntelligenceRenderPlan & { html: string } {
  const plan = renderMarketIntelligenceBody(input);
  return {
    ...plan,
    html: renderDocument({
      title: `${DOCUMENT_NAME} — ${input.report.meta.reportPeriod}`,
      author: input.masthead,
      subject: DOCUMENT_NAME,
      css: buildReportCss({
        palette: input.palette,
        options: input.options ?? null,
        masthead: input.masthead,
      }),
      bodyHtml: plan.bodyHtml,
    }),
  };
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderMarketIntelligenceFromBrandInput {
  report: MarketIntelligenceReport;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /**
   * The **tenant's** cover art, inlined. Never the house art.
   *
   * The legacy has no cover image at all — it fills the page with
   * `NAVY {13,38,77}` and sets the brand name as text (`:222-233`). So this is
   * not replacing a house asset, it is giving the format a tenant one for the
   * first time.
   */
  coverArtDataUri?: string | null;
  options?: ReportDesignOptions | null;
  edition?: string | null;
  reference?: string | null;
}

export interface MarketIntelligenceRenderResult extends MarketIntelligenceRenderPlan {
  html: string;
  /** What the brand snapshot was missing. Advisory; rendering does not stop. */
  gaps: string[];
}

export function renderMarketIntelligenceFromBrand(
  input: RenderMarketIntelligenceFromBrandInput,
): MarketIntelligenceRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  const rendered = renderMarketIntelligenceDocument({
    report: input.report,
    palette: brand.palette,
    company: brand.company,
    masthead: brand.masthead,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: input.options ?? null,
    edition: input.edition ?? null,
    reference: input.reference ?? null,
  });

  return { ...rendered, gaps: brand.gaps };
}

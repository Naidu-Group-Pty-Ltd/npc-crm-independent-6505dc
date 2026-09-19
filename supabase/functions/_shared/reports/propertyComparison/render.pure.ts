/**
 * The comparison as HTML, through the design system.
 *
 * The path this replaces does something none of the other three legacies did: it
 * sends the stored row to a *model* to be rewritten as markdown, then draws that
 * markdown with pdf-lib. So downloading a comparison saved in March costs tokens
 * today and returns different prose on each attempt, and nobody can say which
 * document a client was sent. The findings in `COMPARISON.md` record the rest —
 * a whole-document regex that strips semicolons from every sentence, a fallback
 * that prints `JSON.stringify` under each heading, and an interface that omits
 * investor matching so it has never reached a page.
 *
 * Here nothing is rewritten. The stored row is typeset, the same row twice gives
 * the same document, and it costs nothing.
 *
 * The legacy generator stays exactly where it is, and so does the engine it
 * shares with the investment report. This is a second path.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderBandedMatrix,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type CalloutTone,
  type KpiCell,
  type TableColumn,
  type TableRow,
  type ValueTone,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';

import type {
  AxisGroup,
  NamedProperty,
  PropertyComparison,
  RankedProperty,
  RiskBand,
} from './payload.pure.ts';
import { SECTION_LABELS } from './normalise.pure.ts';
import { comparisonSections, comparisonSpine, validateComparisonSpine } from './sections.pure.ts';
import { categoryWinsChart, rankingChart } from './charts.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['property-comparison'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;

/** A figure the record does not hold — the same mark `formatMeasure` emits. */
const EMPTY = '—';

/**
 * How each risk band reads, and how much confidence its colour may carry.
 *
 * The band is derived from free text with ten distinct spellings, and the *words*
 * on the page are always the source's own. Colour is a second channel, never the
 * only one: a document that says "critical" only by being red says nothing to a
 * monochrome printer.
 */
const BAND: Record<RiskBand, { tone: ValueTone; callout: CalloutTone }> = {
  low: { tone: 'positive', callout: 'positive' },
  moderate: { tone: 'neutral', callout: 'caution' },
  high: { tone: 'negative', callout: 'caution' },
  severe: { tone: 'negative', callout: 'negative' },
  unrated: { tone: 'neutral', callout: 'neutral' },
};

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-07-23T…` → `23 July 2026`.
 *
 * Parsed rather than handed to `Date`: this module is pure, and
 * `toLocaleDateString` depends on the runtime's ICU build, so the same payload
 * would date itself differently in Deno and in Node.
 */
export { formatReportDate };

// ── Small helpers ───────────────────────────────────────────────────────────

const p = (t: string) => (t ? `<p>${escapeHtml(t)}</p>` : '');
/**
 * A subhead inside a chapter.
 *
 * `h2`, not `h3`. Six of these formats grew their own `const h3` helper for
 * "a subhead" while the design system's actual subhead — `h2` at 17pt, whose
 * rule in `css.pure.ts` carries a paragraph explaining that it is a different
 * object from a chapter title — went unused in every one of them. A chapter
 * title is an `h1`, so an `h3` under it skips a level, and PDF/UA 7.4.2 fails
 * on exactly that: "heading level 2 is skipped in a descending sequence".
 *
 * Seven of the ten documents failed the same rule and no other. Named
 * `subhead` rather than `h2` so the next person reaches for the level the
 * design system defines instead of inventing one.
 */
const subhead = (text: string) => `<h2>${escapeHtml(text)}</h2>`;

function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

/** A score with its denominator. Never a bare number — see `ScaledScore`. */
function scoreText(r: RankedProperty): string {
  if (!r.score) return EMPTY;
  return `${formatMeasure(r.score.value)} / ${r.score.outOf}`;
}

/** "12 Wattle Street" or "No clear winner" — never `undefined`, never index -1. */
const winnerName = (n: { property: { shortAddress: string } | null }): string =>
  n.property ? n.property.shortAddress : 'No clear winner';

/** A named property and its reason, as a sidenote. */
function namedBlock(label: string, n: NamedProperty | null): string {
  if (!n) return '';
  const who = n.property ? `<strong>${escapeHtml(n.property.address)}</strong>. ` : '';
  const body = `<p>${who}${escapeHtml(n.reason)}</p>`;
  return renderSidenote(label, body);
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * The verdict, first.
 *
 * On a salvaged record this is also where the reader is told the record is
 * incomplete — before the ranking rather than after eight sections.
 */
function verdictSection(cf: PropertyComparison, palette: ResolvedReportPalette): string {
  const top = cf.ranked[0];

  const kpis: KpiCell[] = [
    {
      label: 'Properties compared',
      value: String(cf.properties.length),
      foot: cf.meta.states.length ? cf.meta.states.join(' · ') : undefined,
    },
    {
      label: 'Ranked first',
      value: top ? top.property.shortAddress : EMPTY,
      // The risk is stated in the foot, not carried by the colour of the
      // winner's name. Toning it negative because the property is risky reads as
      // "this result is wrong" rather than "this property carries risk", which
      // is a different claim and not one the ranking makes.
      foot: top?.risk?.level ? `${top.risk.level} risk` : undefined,
    },
    {
      label: 'Top score',
      value: top ? scoreText(top) : EMPTY,
      foot: cf.scale && !cf.scale.confident ? 'scale stated, not inferred' : undefined,
    },
  ];

  // The ranked table carries the risk band beside the rank. That is the answer
  // to "is the best one also the riskiest" — stated in a column rather than
  // drawn on an axis this module would have had to invent.
  const cols: TableColumn[] = [
    { key: 'rank', label: '#', align: 'left' },
    { key: 'address', label: 'Property', align: 'left' },
    { key: 'risk', label: 'Risk', align: 'left' },
    { key: 'score', label: 'Score', align: 'right' },
  ];
  const rows: TableRow[] = cf.ranked.map((r) => ({
    rank: r.rank === null ? EMPTY : String(r.rank),
    address: r.property.address,
    risk: r.risk?.level || EMPTY,
    score: scoreText(r),
  }));

  const scaleNote = cf.scale
    ? `Scores are as the analysis recorded them, out of ${cf.scale.outOf}.`
    : 'The analysis did not score these properties.';

  return renderLede(cf.narrative)
    + truncationCallout(cf)
    + renderKpiStrip(kpis)
    + p(cf.summary)
    + rankingChart(cf, palette)
    + renderDataTable(cols, rows, { caption: `How they ranked — ${scaleNote}` });
}

/**
 * What the record does not hold, and why.
 *
 * The distinction between *not found* and *never written* is the whole message:
 * one implies a lookup failed and something might be retried; the other tells the
 * reader the analysis stopped before it got there, and what to do about it.
 */
function truncationCallout(cf: PropertyComparison): string {
  const { provenance } = cf;
  if (provenance.shape !== 'salvaged') return '';

  const missing = provenance.missing
    .map((k) => SECTION_LABELS[k] ?? k)
    .filter(Boolean);
  const recovered = provenance.recovered.length;

  const lost = missing.length
    ? ` ${missing.length === 1 ? 'One section was' : `${missing.length} sections were`} `
      + `never written: ${missing.join(', ')}.`
    : '';

  return renderCallout(
    'informative',
    'This comparison was saved before the analysis finished',
    `<p>The analysis was cut short while it was being written, and the sections it `
    + `had completed were stored as raw text rather than as a finished report. `
    + `${recovered} of them ${recovered === 1 ? 'has' : 'have'} been read back and `
    + `${recovered === 1 ? 'appears' : 'appear'} in this document in full.${lost} `
    + `Those sections are not missing from this report — they are not in the `
    + `record. Re-running the comparison would produce them.</p>`,
  );
}

/**
 * The scorecard — every category, and which property took it.
 *
 * Landscape, and the reason is consistency rather than geometry. With two to five
 * properties as columns this matrix fits the portrait measure comfortably; the
 * Portfolio's holdings matrix is landscape even for a one-property portfolio, and
 * a format whose central table changes orientation with the row count hands a
 * reader two different-looking documents for the same report type.
 */
function scorecardSection(cf: PropertyComparison, palette: ResolvedReportPalette): string {
  const key = renderDataTable(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'address', label: 'Property', align: 'left' },
      ...(cf.properties.some((prop) => prop.state)
        ? [{ key: 'state', label: 'State', align: 'left' as const }]
        : []),
    ],
    cf.properties.map((prop) => ({
      n: String(prop.number),
      address: prop.address,
      ...(cf.properties.some((q) => q.state) ? { state: prop.state || EMPTY } : {}),
    })),
    { caption: 'The properties, numbered as they appear overleaf' },
  );

  const columns = cf.properties.map((prop) => String(prop.number));
  // Positive axes only. A tick in this matrix means "won this category", and
  // `highestRisk` names the property that came off worst — ticking it asserts
  // the opposite of what it means. It keeps its own row in the risk section,
  // where the word "highest" sits beside it.
  const positive = cf.axes.flatMap((g) => g.winners).filter((w) => w.polarity === 'positive');
  const rows = positive.map((w) => ({
    label: w.label,
    values: cf.properties.map((prop) =>
      w.property && w.property.number === prop.number
        ? (w.value ? `✓ ${w.value}` : '✓')
        : EMPTY),
    total: false,
  }))
    // A category nobody won is a row of em dashes across the page, which reads as
    // a rendering fault rather than as "the analysis could not call it". The
    // sections beneath carry its reason in words instead.
    .filter((row) => row.values.some((v) => v !== EMPTY));

  const undecided = positive.filter((w) => !w.property).length;
  const matrix = rows.length
    ? renderBandedMatrix('Category', columns, rows, {
      caption: 'A tick marks the property the analysis named on that category. '
        + (undecided
          ? `${undecided} ${undecided === 1 ? 'category' : 'categories'} named no property and `
            + `${undecided === 1 ? 'is' : 'are'} listed with their reasons in the sections that follow.`
          : 'Every category named one.'),
    })
    : renderCallout(
      'neutral',
      'No category had a winner',
      '<p>The analysis compared every category but could not name a property on any '
      + 'of them. The reasons are in the sections that follow.</p>',
    );

  return key + categoryWinsChart(cf, palette) + matrix;
}

/** Each property in turn — strengths, concerns, and who it suits. */
function rankingSection(cf: PropertyComparison): string {
  return cf.ranked
    .filter((r) => r.strengths.length || r.concerns.length || r.bestSuitedFor || r.risk)
    .map((r) => {
      const heading = subhead(`${r.rank !== null ? `${r.rank}. ` : ''}${r.property.address}`);
      const score = r.score
        ? p(`Scored ${scoreText(r)}${r.risk?.level ? `, with risk assessed as ${r.risk.level.toLowerCase()}` : ''}.`)
        : '';
      return heading
        + score
        + (r.bestSuitedFor ? p(`Best suited for: ${r.bestSuitedFor}`) : '')
        + (r.strengths.length ? renderSidenote('Working', renderList(r.strengths)) : '')
        + (r.concerns.length ? renderSidenote('Watch', renderList(r.concerns)) : '');
    })
    .join('');
}

/** One axis group — the winner per category, with the source's reason. */
function axisSection(cf: PropertyComparison, id: string): string {
  const group = cf.axes.find((g) => g.id === id);
  if (!group) return '';
  return renderAxisGroup(group);
}

function renderAxisGroup(group: AxisGroup): string {
  const cols: TableColumn[] = [
    { key: 'axis', label: group.title, align: 'left' },
    { key: 'winner', label: 'Named', align: 'left' },
    { key: 'value', label: '', align: 'right' },
  ];
  const anyValue = group.winners.some((w) => w.value);
  const rows: TableRow[] = group.winners.map((w) => ({
    axis: w.label,
    winner: winnerName(w),
    value: anyValue ? (w.value || EMPTY) : '',
  }));

  const detail = group.winners
    .filter((w) => w.reason)
    .map((w) => subhead(w.label) + p(w.reason))
    .join('');

  return renderDataTable(cols, rows, { caption: 'Who the analysis named on each' })
    + detail;
}

/** Risk — the axis winners, then each property's own risks in its own words. */
function riskSection(cf: PropertyComparison): string {
  const axes = axisSection(cf, 'risk');
  const perProperty = cf.risks
    .filter((r) => r.specificRisks.length || r.level)
    .map((r) => subhead(r.property.address)
      + (r.level ? p(`Assessed ${r.level}.`) : '')
      + renderList(r.specificRisks))
    .join('');
  return axes + perProperty;
}

/** Concerns raised against individual properties, worst first. */
function flagsSection(cf: PropertyComparison): string {
  const order: Record<RiskBand, number> = { severe: 0, high: 1, moderate: 2, low: 3, unrated: 4 };
  return [...cf.redFlags]
    .sort((a, b) => order[a.band] - order[b.band])
    .map((f) => renderCallout(
      BAND[f.band].callout,
      `${f.property ? f.property.shortAddress : 'The comparison'}${f.severity ? ` — ${f.severity}` : ''}`,
      renderList(f.concerns),
    ))
    .join('');
}

/** Who each property suits — the section the legacy has never rendered. */
function matchesSection(cf: PropertyComparison): string {
  return cf.matches
    .map((m) => subhead(m.property ? m.property.address : 'Across the comparison')
      + (m.investorTypes.length ? p(m.investorTypes.join(' · ')) : '')
      + p(m.reasoning))
    .join('');
}

/** What sets each apart. Salvaged records only — see `payload.pure.ts`. */
function advantagesSection(cf: PropertyComparison): string {
  return cf.advantages
    .map((a) => subhead(a.property ? a.property.address : 'Across the comparison')
      + renderList(a.advantages))
    .join('');
}

/** Which to buy first, and how long to hold each. Salvaged records only. */
function timingSection(cf: PropertyComparison): string {
  const t = cf.timing;
  if (!t) return '';
  const periods = t.holdingPeriods.length
    ? renderDataTable(
      [
        { key: 'property', label: 'Property', align: 'left' },
        { key: 'period', label: 'Suggested hold', align: 'left' },
      ],
      t.holdingPeriods.map((h) => ({
        property: h.property ? h.property.address : EMPTY,
        period: h.period || EMPTY,
      })),
      { caption: 'How long the analysis suggests holding each' },
    )
    + t.holdingPeriods.filter((h) => h.reason)
      .map((h) => subhead(h.property ? h.property.shortAddress : 'Across the comparison') + p(h.reason))
      .join('')
    : '';
  return namedBlock('Buy first', t.buyFirst) + periods;
}

/** The pick, the runners-up, what to avoid, and the what-ifs. */
function planSection(cf: PropertyComparison): string {
  const r = cf.recommendations;
  if (!r) return '';

  const runners = r.runners.length
    ? subhead('Runners-up')
      + r.runners.map((n) => p(`${n.property ? `${n.property.address}. ` : ''}${n.reason}`)).join('')
    : '';
  const avoid = r.avoid.length
    ? subhead('What to avoid')
      + r.avoid.map((n) => p(`${n.property ? `${n.property.address}. ` : ''}${n.reason}`)).join('')
    : '';
  const scenarios = r.alternativeScenarios.length
    ? subhead('If the brief were different')
      + r.alternativeScenarios
        .map((s) => renderSidenote(
          s.scenario || 'Another way to read it',
          `<p>${s.property ? `<strong>${escapeHtml(s.property.address)}</strong>. ` : ''}${escapeHtml(s.reason)}</p>`,
        ))
        .join('')
    : '';

  return namedBlock('The pick', r.bestOverall) + runners + avoid + scenarios;
}

/**
 * The basis the comparison was run on.
 *
 * Read out of `analysis_summary`, which holds a settings blob despite its name.
 * Nothing has ever rendered it, so no comparison document has stated the
 * assumptions behind its own ranking.
 */
function basisSection(cf: PropertyComparison): string {
  const b = cf.basis;
  const rows: TableRow[] = [
    { item: 'Compared on', value: formatReportDate(cf.meta.analysedOn) || EMPTY },
    { item: 'Properties', value: String(cf.properties.length) },
    { item: 'Time horizon', value: b.timeHorizon || EMPTY },
    { item: 'Risk tolerance', value: b.riskTolerance || EMPTY },
    { item: 'Investor profile', value: b.investorProfile || EMPTY },
    { item: 'Depth', value: b.depth || EMPTY },
    { item: 'Analysed by', value: b.model || EMPTY },
  ];

  const weights = b.weights.length
    ? renderDataTable(
      [
        { key: 'item', label: 'Weighting', align: 'left' },
        { key: 'value', label: '', align: 'right' },
      ],
      b.weights.map((w) => ({ item: w.label, value: formatMeasure(w.weight) })),
      { caption: 'The weights applied to the ranking' },
    )
    : '';

  const notes = cf.notes.length
    ? renderCallout('neutral', 'Worth knowing', renderList(cf.notes))
    : '';

  return renderDataTable(
    [
      { key: 'item', label: 'This comparison', align: 'left' },
      { key: 'value', label: '', align: 'right' },
    ],
    rows,
  ) + weights + notes;
}

/** A section the record should hold and does not. */
function placeholderSection(key: string): string {
  const label = SECTION_LABELS[key] ?? key;
  return renderCallout(
    'caution',
    'Not recorded',
    `<p>The analysis stopped before it wrote ${label}. This section is here so the `
    + `contents page reflects what a complete comparison contains — the content was `
    + `never saved, and re-running the comparison is what would produce it.</p>`,
  );
}

const SECTION_BODY: Record<
  string,
  (cf: PropertyComparison, palette: ResolvedReportPalette) => string
> = {
  verdict: verdictSection,
  scorecard: scorecardSection,
  ranking: (cf) => rankingSection(cf),
  money: (cf) => axisSection(cf, 'money'),
  place: (cf) => axisSection(cf, 'place'),
  risk: (cf) => riskSection(cf),
  flags: (cf) => flagsSection(cf),
  matches: (cf) => matchesSection(cf),
  advantages: (cf) => advantagesSection(cf),
  timing: (cf) => timingSection(cf),
  plan: (cf) => planSection(cf),
  basis: (cf) => basisSection(cf),
};

// ── The document ────────────────────────────────────────────────────────────

export interface RenderComparisonInput {
  comparison: PropertyComparison;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  edition?: string | null;
  confidentiality?: string | null;
}

/** The body — cover, contents, sections, closing — without the stylesheet. */
export function renderComparisonBody(input: RenderComparisonInput): string {
  const cf = input.comparison;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The properties are the subject, so the count and the places are the title.
    // The legacy overlays its title on a raster of our own letterhead.
    title: cf.meta.title,
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    meta: [
      { label: 'Properties', value: String(cf.properties.length) },
      { label: 'States', value: cf.meta.states.join(', ') },
      { label: 'Compared', value: formatReportDate(cf.meta.analysedOn) },
      ...(cf.meta.clientName ? [{ label: 'Prepared for', value: cf.meta.clientName }] : []),
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: cf.meta.reference,
  });

  const sections = comparisonSections(cf);

  // Derived from the spine, not counted by hand — so the contents cannot list a
  // section that was not built, order them differently from how they print, or
  // claim a page number, because it carries none.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(comparisonSpine(cf)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
  );

  const body = sections.map((section, index) => {
    const inner = section.placeholderFor
      ? placeholderSection(section.placeholderFor)
      : SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title)
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${inner}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + contents + body + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path, so a document that is wrong is better as an error here — where the
 * message names the problem — than as a PDF a client opens.
 */
export function renderComparisonDocument(input: RenderComparisonInput): string {
  const problems = validateComparisonSpine(input.comparison);
  if (problems.length) {
    throw new Error(`${DOCUMENT_NAME} has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.comparison.meta.title}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderComparisonBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderComparisonFromBrandInput {
  comparison: PropertyComparison;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
}

export interface ComparisonRenderResult {
  html: string;
  /** What the brand snapshot was missing. Reported, never thrown. */
  gaps: string[];
}

export function renderComparisonFromBrand(
  input: RenderComparisonFromBrandInput,
): ComparisonRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderComparisonDocument({
      comparison: input.comparison,
      palette: brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: input.options ?? null,
      edition: input.edition ?? null,
    }),
    gaps: brand.gaps,
  };
}

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
  SECTION_SUBHEAD_CLASS,
  escapeHtml,
  openChapter,
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
import { portraitMatrixCss, renderPortraitMatrix } from '../../reportDesign/portraitMatrix.pure.ts';
import { paragraphsFromWrapped } from '../../reportDesign/prose.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';
import { formatMeasure } from '../../reportDesign/measure.pure.ts';

import type {
  AxisGroup,
  NamedProperty,
  PropertyComparison,
  PropertyRef,
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
/** A model's text as the paragraphs it wrote (`paragraphsFromWrapped`), never one run-together block. */
const paragraphs = (t: string) => paragraphsFromWrapped(t).map(p).join('');
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
 *
 * Set at h3's size (`SECTION_SUBHEAD_CLASS`) under a memo section's title, as
 * the other memo formats' subheads are (Audit 8, 1 Oct 2026).
 */
const subhead = (text: string) => `<h2 class="${SECTION_SUBHEAD_CLASS}">${escapeHtml(text)}</h2>`;

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

/**
 * Whether a sentence already names its property, by street.
 *
 * The analysis usually opens a reason with the property it is about, so a
 * bold address set ahead of it printed the name twice in one line: "37 Bolin
 * Street, Schofields NSW 2762. 37 Bolin Street is the alternative for…".
 */
function namesProperty(sentence: string, property: PropertyRef): boolean {
  const street = property.shortAddress.trim().toLowerCase();
  return Boolean(street) && sentence.toLowerCase().includes(street);
}

/** The property's address ahead of a reason, only where the reason does not already name it. */
function lead(property: PropertyRef | null, reason: string): string {
  return property && !namesProperty(reason, property)
    ? `<strong>${escapeHtml(property.address)}</strong>. `
    : '';
}

/** A named property and its reason, as a sidenote. */
function namedBlock(label: string, n: NamedProperty | null): string {
  if (!n) return '';
  const body = `<p>${lead(n.property, n.reason)}${escapeHtml(n.reason)}</p>`;
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
    + paragraphs(cf.summary)
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

/** The class the scorecard is styled by (`portraitMatrixCss`). */
const SCORECARD_CLASS = 'pc-scorecard';

/**
 * A property's score line, which reads as the second line of its heading. A
 * heading keeps only the box after it (css.pure.ts), so the two kept each
 * other and nothing more: 20 of the 51 two-property documents ended page four
 * on "1. 14 Wattlebird Grove… / Scored 81.5 / 100, with risk assessed as low to
 * moderate." with everything about the property overleaf (Audit 8). The line
 * refuses the break after itself, so what follows comes with it. The sections
 * run on, so the group cannot strand a chapter's tail.
 */
const SCORE_LINE_CLASS = 'pc-score';

/**
 * The scorecard — every category, and which property took it.
 *
 * On the page the section is already on. It opened a landscape sheet of its
 * own "for consistency" with the Portfolio's holdings matrix, which then moved
 * to portrait itself: two to five properties and ten categories fit the
 * portrait measure, and the landscape sheet held one table and two-thirds
 * white space. The property columns share the width equally, so the tick for
 * the second property is not squeezed between two wide neighbours.
 */
function scorecardSection(cf: PropertyComparison, palette: ResolvedReportPalette): string {
  // Headed by the street alone. The section used to open on a key table
  // ("The properties, numbered as they appear overleaf") that restated the
  // ranking directly above it, and to number each column by the order the
  // properties were entered, which is not the order they ranked in: "1." over
  // the property ranked third. The street is the name; nothing is looked up.
  const columns = cf.properties.map((prop) => prop.shortAddress || prop.address || 'Property');
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
  // The matrix every format that sets properties side by side draws
  // (`portraitMatrix.pure.ts`), the copy this section kept "until it is
  // audited" retired: there each street head was set on one line, and at five
  // properties in the standard design the fourth and fifth columns ran past
  // the sheet's edge, by 71pt and 248pt.
  const matrix = rows.length
    ? renderPortraitMatrix({
      lineLabel: 'Category',
      headings: columns,
      lines: rows.map((row) => ({ label: row.label, values: row.values })),
      caption: 'A tick marks the property the analysis named on that category. '
        + (undecided
          ? `${undecided} ${undecided === 1 ? 'category' : 'categories'} named no property and `
            + `${undecided === 1 ? 'is' : 'are'} listed with their reasons in the sections that follow.`
          : 'Every category named one.'),
      className: SCORECARD_CLASS,
      labelWidthPct: 30,
    })
    : renderCallout(
      'neutral',
      'No category had a winner',
      '<p>The analysis compared every category but could not name a property on any '
      + 'of them. The reasons are in the sections that follow.</p>',
    );

  return categoryWinsChart(cf, palette) + matrix;
}

/** Each property in turn — strengths, concerns, and who it suits. */
function rankingSection(cf: PropertyComparison): string {
  return cf.ranked
    .filter((r) => r.strengths.length || r.concerns.length || r.bestSuitedFor || r.risk)
    .map((r) => {
      const heading = subhead(`${r.rank !== null ? `${r.rank}. ` : ''}${r.property.address}`);
      // The line belongs to the heading above it (`SCORE_LINE_CLASS`).
      const score = r.score
        ? `<p class="${SCORE_LINE_CLASS}">${escapeHtml(
          `Scored ${scoreText(r)}${r.risk?.level ? `, with risk assessed as ${r.risk.level.toLowerCase()}` : ''}.`,
        )}</p>`
        : '';
      return heading
        + score
        + (r.bestSuitedFor ? p(`Best suited for: ${r.bestSuitedFor}`) : '')
        // "Working" and "Watch" were labels, not words: what carries the
        // property, and what to keep an eye on.
        + (r.strengths.length ? renderSidenote('In its favour', renderList(r.strengths)) : '')
        + (r.concerns.length ? renderSidenote('To watch', renderList(r.concerns)) : '');
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
    // "Assessed Low to moderate." took the record's capital into the middle of
    // a sentence the ranking section had already written as "risk assessed as
    // low to moderate".
    .map((r) => subhead(r.property.address)
      + (r.level ? p(`Risk assessed as ${r.level.toLowerCase()}.`) : '')
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

/** What sets each apart. Stored since 28 Sep 2026, salvaged before — see `payload.pure.ts`. */
function advantagesSection(cf: PropertyComparison): string {
  return cf.advantages
    .map((a) => subhead(a.property ? a.property.address : 'Across the comparison')
      + renderList(a.advantages))
    .join('');
}

/**
 * Which to buy first, how long to hold each, and how to leave it.
 *
 * The exit strategies are the analysis's own words, one paragraph a property:
 * the producer has asked for them since its first prompt and no surface had
 * printed them.
 */
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
  const exits = t.exitStrategies.length
    ? subhead('Exit strategies')
      + t.exitStrategies
        .map((e) => `<p>${lead(e.property, e.strategy)}${escapeHtml(e.strategy)}</p>`)
        .join('')
    : '';
  return namedBlock('Buy first', t.buyFirst) + periods + exits;
}

/** The pick, the runners-up, what to avoid, and the what-ifs. */
function planSection(cf: PropertyComparison): string {
  const r = cf.recommendations;
  if (!r) return '';

  const named = (n: NamedProperty) => `<p>${lead(n.property, n.reason)}${escapeHtml(n.reason)}</p>`;
  const runners = r.runners.length
    ? subhead('Runners-up') + r.runners.map(named).join('')
    : '';
  const avoid = r.avoid.length
    ? subhead('What to avoid') + r.avoid.map(named).join('')
    : '';
  const scenarios = r.alternativeScenarios.length
    ? subhead('If the brief were different')
      + r.alternativeScenarios
        .map((s) => renderSidenote(
          s.scenario || 'Another way to read it',
          `<p>${lead(s.property, s.reason)}${escapeHtml(s.reason)}</p>`,
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
  // A setting the record does not hold is omitted, never printed as a dash:
  // "an absence is omitted, never worded" (RUNTIME_CONSOLIDATION.md §8). A
  // setting it does hold reads as a setting: "Moderate", not the stored
  // "moderate"; "5–7 years", not "5-7 years".
  //
  // The model's identifier is not printed. "Analysed by google/gemini-2.5-flash"
  // was the vendor's name for a model on a client's page, and on every
  // production comparison; what it stood for — that a model wrote the
  // ranking — is said in words below, on every comparison, whether or not the
  // record names the model.
  const rows: TableRow[] = [
    { item: 'Compared on', value: formatReportDate(cf.meta.analysedOn) },
    { item: 'Properties', value: String(cf.properties.length) },
    { item: 'Time horizon', value: settingText(b.timeHorizon) },
    { item: 'Risk tolerance', value: settingText(b.riskTolerance) },
    { item: 'Investor profile', value: settingText(b.investorProfile) },
    { item: 'Analysis depth', value: settingText(b.depth) },
  ].filter((r) => Boolean(r.value));

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

  const on = formatReportDate(cf.meta.analysedOn);
  const written = renderCallout(
    'neutral',
    'Written by AI',
    p(`The ranking, the scores and the reasons in this comparison were written by an AI `
      + `analysis of the properties' investment reports${on ? ` on ${on}` : ''}. `
      + `Where it states a figure, each property's own report is the record.`),
  );

  return renderDataTable(
    [
      { key: 'item', label: 'This comparison', align: 'left' },
      { key: 'value', label: '', align: 'right' },
    ],
    rows,
  ) + weights + written + notes;
}

/**
 * A stored setting as a person writes it: sentence case, and a range of
 * numbers joined by an en dash. Words inside are left as stored.
 */
function settingText(value: string): string {
  const v = value.trim().replace(/(\d)\s*-\s*(\d)/g, '$1\u2013$2');
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
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
    // A comparison is ten short sections — most run to a table and a few
    // paragraphs — and a page each printed seventeen sheets for three
    // properties, half of them part empty. They run on under one another now,
    // each keeping its numbered header and running head (`RUN_ON_CHAPTER_CLASS`).
    // And they are memo sections (`MEMO_CHAPTER_CLASS`), as the other four
    // memo formats' are: a 31pt title over a section of three short
    // paragraphs stood a third of a page tall, and set a 14pt subhead under it
    // at nearly half its size (Audit 8, 1 Oct 2026).
    return openChapter(DOCUMENT_NAME, number, section.title, 'body', { runOn: index > 0, memo: true })
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
 * A comparison's tables are short — one row per property, or one per category —
 * and one split across a page reads as two tables. Measured on a three-property
 * comparison: the ranking broke after its first row, leaving two rows alone at
 * the head of the next page. A table longer than a page still breaks: `avoid`
 * is a preference WeasyPrint gives up rather than overflow.
 */
const COMPARISON_CSS = `
  .table-block { break-inside: avoid; }${portraitMatrixCss(SCORECARD_CLASS)}
  p.${SCORE_LINE_CLASS} { break-after: avoid; page-break-after: avoid; }`;

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
    }) + COMPARISON_CSS,
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
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
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
      palette: input.design?.palette ?? brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: withDesignOptions(input.options, input.design),
      edition: input.edition ?? null,
    }),
    gaps: brand.gaps,
  };
}

/**
 * The market figures a report may state, and what each one rests on.
 *
 * ## The defect this exists to end
 *
 * `MarketEvidence` reached the SCORING SERVICE and nothing else. The generator
 * builds `marketPoints` from Domain and the open-data sales registers, posts
 * it to `investment-scoring-service`, and the grade comes back — and the model
 * that writes the market prose is handed none of it.
 *
 * So the prose supplies its own. On 18 Annabelle Crescent, Kellyville, the
 * document stated six market figures:
 *
 * > Kellyville house medians are consistently **reported** around the
 * > **high-$1.8m to ~$2.0m range**, with annual house price growth **called
 * > in** the **low single digits** …
 * >
 * > Recent data sets **report** **median house prices in the order of
 * > $1.96m**, **unit medians in the high-$700k to low-$800k range**, and
 * > **median weekly house rents around $900** …
 * >
 * > a price guide around **$1.55m** … That guide positions the property
 * > **below the prevailing Kellyville house median**
 *
 * `market_fact_snapshot` — the governed ledger this report was built on —
 * holds no median price, no median rent, no growth rate and no sale count for
 * that property. Not `absent` with a ruling: no such fact at all. The ledger
 * carries 27 ABS and RBA facts and not one market price.
 *
 * Note the grammar, because it is the tell and it is diagnosable: *is
 * consistently reported*, *data sets report*, *is called*. **An agentless
 * passive is what a sentence uses when it has no source to name.** A model
 * with a figure names where it came from; a model without one reaches for a
 * construction that does not require it.
 *
 * And the report's central valuation claim rests on two of them: a $1.55m
 * guide is "below the prevailing Kellyville house median" of $1.96m. Two
 * unsourced numbers, compared, in the Executive Verdict.
 *
 * ## The rules
 *
 * 1. **A market figure is stated only where the record holds it**, with the
 *    geography it describes, the dwelling split, the period and the
 *    publisher — the same standard the planning controls answer to.
 * 2. **An agentless attribution is not a source.** "Reported", "data sets
 *    show", "is generally around" and "market commentary suggests" name
 *    nobody, and a figure introduced that way has no provenance whatever it
 *    is.
 * 3. **A licence decides what a client may be shown.** `mayReachClientReport`
 *    is the gate, and it is applied HERE rather than trusted downstream:
 *    Domain's rights are `unverified` pending the follow-up, so its points
 *    score the grade and stay out of the client's document.
 * 4. **A benchmark never borrows the subject's authority, and the subject
 *    never borrows the benchmark's.** They are separate rows naming separate
 *    geographies, because a state figure printed beside a suburb one reads as
 *    the suburb's.
 * 5. **An absence is stated, and says which kind.** A provider that was asked
 *    and could not answer is named with its reason; a measure nothing
 *    published is listed as not held. Neither is an invitation to supply one.
 * 6. **Nothing here is a valuation.** A median describes a market, not this
 *    property. A comparison against one IS permitted in the prose and is
 *    useful — the defect was comparing two UNSOURCED figures, not comparing —
 *    provided the median's provenance travels with it and the sentence stops
 *    at the difference. What is never permitted is the verdict: "undervalued",
 *    "a bargain", or an equity or margin inferred from the gap.
 *
 * Pure: no fetch, no Deno, no clock.
 */

import {
  describePoint,
  EVIDENCE_KEYS,
  mayReachClientReport,
  presentPoints,
  type EvidenceKey,
  type EvidencePoint,
  type EvidenceProvider,
  type MarketEvidence,
} from './marketEvidence.pure.ts';
import { parseVizDirective } from '../vizDirectives.pure.ts';

/** How each measure is named to a reader, and how its value is written. */
const MEASURE: Readonly<Record<EvidenceKey, { label: string; unit: 'money' | 'percent' | 'count' | 'days' | 'series' }>> = {
  medianPrice: { label: 'Median sale price', unit: 'money' },
  growth1Year: { label: 'Price growth, 1 year', unit: 'percent' },
  growth3YearCagr: { label: 'Price growth, 3 years (compound annual)', unit: 'percent' },
  growth5YearCagr: { label: 'Price growth, 5 years (compound annual)', unit: 'percent' },
  growth10YearCagr: { label: 'Price growth, 10 years (compound annual)', unit: 'percent' },
  priceSeries: { label: 'Median price series', unit: 'series' },
  salesVolumeSeries: { label: 'Sales volume series', unit: 'series' },
  salesCount: { label: 'Sales in the period', unit: 'count' },
  daysOnMarket: { label: 'Median days on market', unit: 'days' },
  vacancyRate: { label: 'Rental vacancy rate', unit: 'percent' },
  listingActivity: { label: 'Properties advertised', unit: 'count' },
  medianRent: { label: 'Median advertised weekly rent', unit: 'money' },
  vendorDiscount: { label: 'Vendor discount', unit: 'percent' },
  auctionClearanceRate: { label: 'Auction clearance rate', unit: 'percent' },
  benchmarkGrowth1Year: { label: 'Benchmark price growth, 1 year', unit: 'percent' },
  benchmarkGrowth3YearCagr: { label: 'Benchmark price growth, 3 years (compound annual)', unit: 'percent' },
  benchmarkGrowth5YearCagr: { label: 'Benchmark price growth, 5 years (compound annual)', unit: 'percent' },
  benchmarkMedianPrice: { label: 'Benchmark median sale price', unit: 'money' },
  populationGrowth: { label: 'Resident population growth (a driver, not growth)', unit: 'percent' },
};

/** Rule 4 — a benchmark is drawn apart, never in the subject's block. */
const IS_BENCHMARK = (key: EvidenceKey): boolean => key.startsWith('benchmark');

/**
 * The publisher as a reader should see it, never the enum.
 *
 * ## Why this is a TOTAL record, and the fallback names no key
 *
 * It was `Partial`, with `PROVIDER_LABEL[p] ?? p` under it — so a provider
 * with no entry printed its own identifier, which is the one thing the line
 * above forbids. Page 36 of the Investment Compass delivered for 9 Hollow
 * Street on 21 Sep 2026 told the client, in the column headed *Where it is
 * published*:
 *
 * ```
 *   The market's median sale price and its growth | vic_vpsr_suburb | Quarterly…
 *   The one-year growth rate                      | vic_vpsr_suburb | Quarterly…
 * ```
 *
 * Two rows of a five-column table naming a database series key, directly
 * beside a row that reads *"Vicmap Planning — plan_zone
 * (opendata.maps.vic.gov.au WFS)"* and gets it right. `vic_vpsr_suburb` and
 * `sa_lsg_suburb` were added to `EvidenceProvider` with the archived suburb
 * series (me9.sales.2, 16 Sep 2026) and never added here — and because they
 * are the readings that answer for Victoria and South Australia, **every VIC
 * and SA report has printed a key where the publisher belongs.**
 *
 * `Readonly<Record<…>>` rather than `Partial<Record<…>>` is the structural
 * half: the compiler now refuses a new provider that has no name for a reader,
 * which is what a lookup with a silent fallback could never do. The names
 * themselves are the short reader-facing forms, in the style of their
 * siblings; the full citation each publisher gives itself lives beside its
 * loader, as `VIC_VPSR_SOURCE_LABEL` and `SA_LSG_SOURCE_LABEL`.
 *
 * The runtime fallback stays, because a provider read back from the database
 * is a string and not the union, and it **names the absence rather than the
 * key** — the rule `stripPlaceholderRows` and `placesAvailability` already
 * answer to. A key tells a reader nothing and looks like a mistake, which is
 * worse than an honest blank.
 */
const PROVIDER_LABEL: Readonly<Record<EvidenceProvider, string>> = {
  domain: 'Domain',
  cotality: 'Cotality',
  proptrack: 'PropTrack',
  sqm_research: 'SQM Research',
  abs_res_dwell: 'Australian Bureau of Statistics — Residential Dwellings',
  abs_census: 'Australian Bureau of Statistics — Census',
  abs_erp: 'Australian Bureau of Statistics — Estimated Resident Population',
  nsw_valuer_general: 'NSW Valuer General',
  vic_property_sales: 'Victorian Property Sales Report',
  qld_titles: 'Queensland Titles Registry',
  sa_land_services: 'Land Services SA',
  qld_qgso_rlda: 'Queensland Government Statistician — Residential Land and Dwelling Activity',
  nsw_dcj_rent_sales: 'NSW Department of Communities and Justice — Rent and Sales Report',
  vic_vpsr_suburb: 'Victorian Valuer-General — Property Sales Report, by suburb',
  sa_lsg_suburb: 'Land Services SA — median house sales by suburb',
};

/** Anything that reads as an identifier rather than as a name. */
const LOOKS_LIKE_A_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

export function providerName(p: EvidenceProvider): string {
  const named = PROVIDER_LABEL[p];
  if (named) return named;
  const raw = String(p ?? '').trim();
  return raw && !LOOKS_LIKE_A_KEY.test(raw) ? raw : 'Publisher not recorded';
}

function writeValue(value: unknown, unit: (typeof MEASURE)[EvidenceKey]['unit']): string | null {
  if (unit === 'series') {
    return Array.isArray(value) && value.length
      ? `${value.length} periods, ${String((value[0] as { period?: unknown })?.period ?? '?')} to `
        + `${String((value[value.length - 1] as { period?: unknown })?.period ?? '?')}`
      : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  switch (unit) {
    case 'money': return `$${Math.round(value).toLocaleString('en-AU')}`;
    // One decimal, and the sign kept: a fall is a fact and "-2.1%" is what it
    // looks like. `toFixed` on a negative already carries it.
    case 'percent': return `${value.toFixed(1)}%`;
    case 'days': return `${Math.round(value).toLocaleString('en-AU')} days`;
    default: return Math.round(value).toLocaleString('en-AU');
  }
}

export interface MarketFactsInput {
  /** `enhancedData.marketEvidence` — what the adapters extracted, or absent. */
  marketEvidence?: unknown;
}

export interface MarketFactRow {
  key: EvidenceKey;
  label: string;
  /** The figure, written. Null where the value could not be written. */
  value: string | null;
  /** The geography, dwelling split, sample and period — `describePoint`. */
  describes: string;
  publisher: string;
  /** Anything a reader needs in order not to over-read it. */
  note: string | null;
  benchmark: boolean;
}

export interface MarketFacts {
  /** Measures a client's document may state. */
  rows: MarketFactRow[];
  /** Measures held but withheld from a client document, and why. */
  withheld: Array<{ label: string; publisher: string; reason: string }>;
  /** Providers asked that could not answer, with the reason each gave. */
  unavailable: Array<{ publisher: string; reason: string }>;
  /** Providers asked at all. */
  consulted: string[];
  /** True when at least one row may be stated. */
  anyStated: boolean;
  /** True when no evidence object was produced at all. */
  evidenceMissing: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** "Domain", "Domain and Cotality", "Domain, Cotality and the ABS". */
const listWords = (items: readonly string[]): string =>
  (items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function buildMarketFacts(input: MarketFactsInput): MarketFacts {
  const raw = isRecord(input.marketEvidence) ? input.marketEvidence : null;
  // The generator stores `{ points, providersConsulted, providersUnavailable }`;
  // a caller may equally hand the `MarketEvidence` itself. Both are read,
  // because a shape mismatch here fails exactly like an empty market.
  const points = isRecord(raw?.points) ? raw!.points : raw;
  if (!points) {
    return { rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true };
  }
  const ev = { subject: {}, providersConsulted: [], providersUnavailable: [], ...points } as unknown as MarketEvidence;

  const rows: MarketFactRow[] = [];
  const withheld: MarketFacts['withheld'] = [];
  for (const { key, point } of presentPoints(ev)) {
    const measure = MEASURE[key];
    if (!measure) continue;
    const publisher = providerName(point.provider);
    // Rule 3, applied here rather than trusted downstream.
    if (!mayReachClientReport(point)) {
      withheld.push({
        label: measure.label,
        publisher,
        reason: 'the right to publish this measure in a client document is not confirmed',
      });
      continue;
    }
    const value = writeValue((point as EvidencePoint<unknown>).value, measure.unit);
    if (value === null) continue;
    rows.push({
      key,
      label: measure.label,
      value,
      describes: describePoint(point),
      publisher,
      note: point.sourceNote,
      benchmark: IS_BENCHMARK(key),
    });
  }

  const unavailable = Array.isArray(raw?.providersUnavailable)
    ? (raw!.providersUnavailable as unknown[]).flatMap((u) => (isRecord(u) && typeof u.provider === 'string'
      ? [{ publisher: providerName(u.provider as EvidenceProvider), reason: String(u.reason ?? 'no reason stated') }]
      : []))
    : [];
  const consulted = Array.isArray(raw?.providersConsulted)
    ? (raw!.providersConsulted as unknown[]).flatMap((p) => (typeof p === 'string' ? [providerName(p as EvidenceProvider)] : []))
    : [];

  return { rows, withheld, unavailable, consulted, anyStated: rows.length > 0, evidenceMissing: false };
}

// ---------------------------------------------------------------------------
// Rendering

/** The measures a report could carry, so an empty table reads as a short search. */
const NOT_HELD_LABELS = (facts: MarketFacts): string[] => {
  const have = new Set(facts.rows.map((r) => r.key));
  const withheldLabels = new Set(facts.withheld.map((w) => w.label));
  return EVIDENCE_KEYS
    // A SERIES is not a figure a client reads off a table — it is what the
    // figures above were computed from — so neither series is listed as a
    // measure nothing published.
    .filter((k) => !have.has(k) && !IS_BENCHMARK(k)
      && k !== 'priceSeries' && k !== 'salesVolumeSeries' && k !== 'populationGrowth')
    .map((k) => MEASURE[k].label)
    .filter((l) => !withheldLabels.has(l));
};

/**
 * The market evidence a client reads.
 *
 * Composed here rather than asked of a model: every row is either measured or
 * absent, and neither is a writing task.
 */
export function renderMarketFacts(facts: MarketFacts): string {
  const lines: string[] = [];

  if (facts.rows.length) {
    lines.push('| Measure | Figure | What it describes | Published by |');
    lines.push('|---|---|---|---|');
    // Rule 4: the subject first, the benchmark under its own heading, so a
    // state figure beside a suburb one can never read as the suburb's.
    for (const r of facts.rows.filter((x) => !x.benchmark)) {
      lines.push(`| ${r.label} | ${r.value} | ${r.describes} | ${r.publisher} |`);
    }
    const marks = facts.rows.filter((x) => x.benchmark);
    if (marks.length) {
      lines.push('');
      lines.push('**The wider market these are judged against.** Each row below describes a DIFFERENT geography '
        + 'from the rows above, and states nothing about this suburb.');
      lines.push('');
      lines.push('| Measure | Figure | What it describes | Published by |');
      lines.push('|---|---|---|---|');
      for (const r of marks) lines.push(`| ${r.label} | ${r.value} | ${r.describes} | ${r.publisher} |`);
    }
    lines.push('');
    /*
     * One provenance note per PARAGRAPH, not one per line.
     *
     * They were pushed as consecutive lines, which reads correctly on a
     * terminal and is one paragraph in Markdown — so on the first render of
     * this block all six of Kellyville's notes ran together into a wall of
     * text, each publisher, geography and period colliding with the next.
     * Every consumer of this string is a Markdown renderer.
     */
    const notes = facts.rows.filter((r) => r.note);
    for (const r of notes) {
      lines.push(`**${r.label}.** ${r.note}`);
      lines.push('');
    }
  }

  if (facts.evidenceMissing) {
    lines.push('**Not retrieved.** No market evidence was assembled for this property, so this report states no '
      + 'median price, rent, growth rate, vacancy rate or sale count. That is a statement about this run rather '
      + 'than about the market.');
    lines.push('');
    return lines.join('\n');
  }

  for (const w of facts.withheld) {
    lines.push(`**Held but not published.** ${w.label} was measured by ${w.publisher} and is not printed here, `
      + 'because the right to publish that measure in a client document is not confirmed. It is used to grade the '
      + 'property and is withheld from this document.');
    lines.push('');
  }

  /*
   * A provider's own error text is an ENGINEERING DIAGNOSTIC and does not
   * belong in a client's document.
   *
   * The first render of this block printed, on a client page:
   *
   * > **Asked and could not answer.** Domain: Operation not permitted on
   * > project — no API package is attached to the Domain project this key
   * > belongs to
   *
   * Three things in one sentence that mean nothing to a reader and one that
   * should not be shown to them at all: a vendor's internal refusal string, a
   * statement about an API package, and the existence of a key. The FACT a
   * reader needs is that a source was asked and did not answer, which is why
   * the measures below are not held. The reason stays on the evidence record,
   * where an operator reads it.
   */
  if (facts.unavailable.length) {
    const names = [...new Set(facts.unavailable.map((u) => u.publisher))];
    lines.push(
      `**Asked and could not answer.** ${listWords(names)} ${names.length === 1 ? 'was' : 'were'} asked for this `
      + 'market and did not return a figure, so nothing from '
      + `${names.length === 1 ? 'it' : 'them'} is stated below. The reason is recorded on this report's evidence `
      + 'record.',
    );
    lines.push('');
  }

  const notHeld = NOT_HELD_LABELS(facts);
  if (notHeld.length) {
    // Same reason as rule 4's separator: the labels are what the table prints
    // and the comma belongs in them, so the JOIN changes instead.
    lines.push(`**Not held for this market:** ${notHeld.join('; ').toLowerCase()}. No figure for any of these is `
      + 'stated anywhere in this report. A measure nobody published is not a market with none.');
    lines.push('');
  }

  lines.push('**What these are, and what they are not.** Each figure above describes a MARKET over a stated '
    + 'period, at the geography and dwelling split named beside it. None of them is a valuation of this '
    + 'property, an estimate of what it would sell for, or a forecast. A median is the middle of what sold; '
    + 'the property may sit anywhere relative to it for reasons no median carries.');

  return lines.join('\n');
}

/*
 * Rule 6/7, spelled once.
 *
 * It exists because a prohibition on SENTENCES is one a model routes around
 * into a chart. On 18 Annabelle Crescent the growth section carried two
 * unsourced rates in prose and then drew `spark=9.6,7.1,5.9,4.8,3.5` — the two
 * ranges' endpoints, extended with two values that appear nowhere. The
 * post-processor removes such a directive (`suppressUnevidencedMarketSeries`);
 * this is the half that reaches the model before it writes one, which is the
 * lesson `compassDocumentContract.pure.ts` records: a prohibition with no
 * demonstration of the permitted form is one a model routes around.
 */
const CHART_IS_A_CLAIM =
  'A CHART IS A CLAIM. Every rule here applies to a `{{…}}` directive exactly as it applies to a sentence: a '
  + 'series of growth rates, medians, rents, vacancy figures or sale counts may contain only values from the '
  + 'table above, and where the table holds fewer points than a chart would need, draw no chart. Do not fill a '
  + 'series out to a nicer shape, do not extend it with a trend, and do not take a number from prose you have '
  + 'just written unless the table states it too.';

/** The rules the prose beside the table must obey. */
/**
 * A retrieved growth reading that disagrees with the accepted capital growth
 * rate the projections are built on.
 *
 * ## Why this had no rule until now
 *
 * The programme named this and deliberately did not make it one, because the
 * corpus held no case to test against: on the reported Cowra document page 8
 * said "annual capital growth readings around the low-to-mid single digits"
 * while `assumptions.capitalGrowth` is 0.1, and `marketFactRules` rule 1
 * already forbade the sentence OUTRIGHT — nothing had been retrieved, so the
 * document was closed by a rule that never had to compare anything. What was
 * open is the case where a series IS retrieved and differs from the modelled
 * rate, which no stored row has.
 *
 * `market_sales_medians` now loads for every state, so that case is arriving
 * rather than hypothetical, and the rule is written with a labelled fixture
 * rather than waiting for a production example. A fixture is not a property
 * acceptance and is not offered as one; it is how a rule gets a positive and a
 * negative case before the first real document needs it.
 *
 * ## The rule
 *
 * The two numbers are different quantities and BOTH are legitimate. The
 * accepted rate is an input a person agreed to and the projections, the
 * equity series and the ten-year position are built on it; the retrieved
 * reading is what a publisher's series did over a past window. Replacing one
 * with the other would silently change a client's financial model, which is
 * the thing the standard forbids in terms. Reconciling them is not this
 * product's call either — the adviser's.
 *
 * So neither is changed and neither is hidden: where they diverge materially
 * the document must state both, name which one the projections use, and not
 * present the retrieved reading as a forecast. Where they agree, or where
 * either is absent, there is nothing to disclose and no rule is emitted —
 * because a rule that fires on every document is one people learn to skip.
 *
 * The threshold is in PERCENTAGE POINTS, absolute, for `DERIVED_FIGURES`'
 * reason: a relative band on a small rate rejects ordinary rounding, and
 * 0.1% against 3% is not a rounding disagreement at all.
 */
export const CGR_DIVERGENCE_POINTS = 0.5;

export interface GrowthDivergence {
  /** The rate the projections are built on, as a percentage. */
  acceptedPercent: number | null;
  /** What a publisher's series measured, as a percentage. */
  retrievedPercent: number | null;
  /** Who published the retrieved reading, and over what. */
  retrievedLabel?: string | null;
}

/** Whether the two readings are far enough apart to be worth a reader's attention. */
export function growthReadingsDiverge(d: GrowthDivergence): boolean {
  if (typeof d.acceptedPercent !== 'number' || !Number.isFinite(d.acceptedPercent)) return false;
  if (typeof d.retrievedPercent !== 'number' || !Number.isFinite(d.retrievedPercent)) return false;
  return Math.abs(d.retrievedPercent - d.acceptedPercent) >= CGR_DIVERGENCE_POINTS;
}

/**
 * The rule the model is handed when they diverge, or null when there is
 * nothing to say.
 */
export function growthDivergenceRule(d: GrowthDivergence): string | null {
  if (!growthReadingsDiverge(d)) return null;
  const accepted = `${d.acceptedPercent}%`;
  const retrieved = `${d.retrievedPercent}%`;
  const who = d.retrievedLabel?.trim() ? d.retrievedLabel.trim() : 'the retrieved series';
  return 'CAPITAL GROWTH — TWO READINGS, AND THEY DISAGREE. The projections, the equity series and '
    + `every ten-year figure in this report are built on an accepted rate of ${accepted}. `
    + `${who} measures ${retrieved} over its own past window. Both are real and they are different `
    + 'quantities: one is an input a person agreed to, the other is what a publisher recorded. '
    + 'You may not replace one with the other, you may not average them, you may not present the '
    + 'retrieved reading as a forecast or as what this property will do, and you may not quietly '
    + `use ${retrieved} in a sentence about the modelled outcome. Where you mention growth at all, `
    + `state both, say that the modelling uses ${accepted}, and attribute ${retrieved} to its `
    + 'publisher and its period. Reconciling them is the adviser\'s judgement, not this report\'s.';
}

export function marketFactRules(facts: MarketFacts): string {
  const head = 'MARKET FIGURE RULES FOR THE WHOLE REPORT — they apply in every section, including the executive '
    + 'verdict, risk registers, SWOT tables, checklists and summaries, and they override any example elsewhere '
    + 'in this prompt AND anything a live web search returns.';

  /*
   * Rule 2 in the words the model is handed, and it is the one that carries
   * the rest. Every figure in the Kellyville report arrived this way, and the
   * construction is the diagnosis: a sentence that has a source names it.
   */
  const noAgentless = 'An agentless attribution is NOT a source. Do not write that a figure "is reported", "is '
    + 'generally around", "is called", that "recent data sets report" it, that "market commentary suggests" it, '
    + 'or that it comes from "multiple sources" — those name nobody. Every market figure you state must name its '
    + 'publisher, the geography it describes and the period, exactly as the table gives them.';

  if (facts.evidenceMissing || !facts.anyStated) {
    return [
      `${head} No market figure was retrieved for this property.`,
      '1. Do NOT state a median sale price, a median rent, a price growth rate, a vacancy rate, a days-on-market '
      + 'figure, an auction clearance rate or a sales volume — not for the suburb, the postcode, the council or '
      + 'the state, and not from a live web search, a listing portal, a news article or your own knowledge. '
      + 'There is no figure here to state.',
      `2. ${noAgentless}`,
      '3. Say in one sentence that no market price or rent series was retrieved for this location and that the '
      + 'market discussion below is therefore qualitative. Then write it qualitatively — position, dwelling mix, '
      + 'demand drivers, what a buyer would compare — without a number.',
      '4. Do NOT compare the asking price or price guide against a median, a "prevailing" level or a "typical" '
      + 'figure. There is no median here, so any such comparison invents one.',
      '5. Do NOT rate, score or grade the market from the absence. A figure nobody retrieved is not evidence that '
      + 'the market is strong, weak, fair value or anything else.',
      `6. ${CHART_IS_A_CLAIM} With no figure held, that means no market chart at all.`,
    ].join('\n');
  }

  const stated = facts.rows.filter((r) => !r.benchmark).map((r) => r.label);
  const marks = facts.rows.filter((r) => r.benchmark).map((r) => r.label);
  return [
    head,
    `1. The market evidence table above is supplied complete. Exactly these measures are held and may be stated: `
    + `${stated.join('; ') || 'none for this subject'}. Every other market figure is NOT held — do not state one, `
    + 'and do not supply one from a live web search, a listing portal, a news article or your own knowledge.',
    `2. ${noAgentless}`,
    '3. State each figure with the geography and dwelling split the table names beside it. A postcode figure is '
    + 'not the suburb’s, an "all dwelling types" figure is not the house figure, and a period is part of the '
    + 'fact rather than a footnote.',
    marks.length
      // Several of these labels carry a comma ("Price growth, 3 years …"),
      // so a comma-joined list of them reads as twice as many entries.
      ? `4. ${marks.join('; ')} ${marks.length === 1 ? 'describes' : 'describe'} a DIFFERENT geography and `
        + `${marks.length === 1 ? 'is' : 'are'} a benchmark. Name that geography whenever you use one, and `
        + 'never present it as this suburb’s figure or let it stand in for one that is missing.'
      : '4. No benchmark is held, so do not compare this market against a wider one by supplying a figure for it.',
    '5. A median is the middle of what sold; it is not a valuation of this property and not a forecast. You MAY '
    + 'say how the subject\u2019s recorded price sits against a median in this table, with that median\u2019s '
    + 'publisher, geography, dwelling split and period beside it — that is useful and the reader needs it. What '
    + 'you may NOT do is turn the gap into a verdict: no "undervalued", "a bargain", "priced below its worth", '
    + '"good buying" or "cheap", and no equity, instant gain or margin inferred from it. Say what the '
    + 'difference is and what a median cannot see — land size, condition, age, position, and the spread it '
    + 'hides.',
    '6. Where the table says a measure is not held, say so if the subject comes up rather than supplying one, and '
    + 'do not rate or score the market from its absence.',
    `7. ${CHART_IS_A_CLAIM}`,
  ].join('\n');
}

// ─── Charts drawn from market figures ───────────────────────────────────────

/**
 * A directive whose SERIES is market figures the record does not hold.
 *
 * ## The defect this ends
 *
 * On 18 Annabelle Crescent the growth section carried two growth rates and a
 * chart of five, three lines apart, all in one section:
 *
 * > External suburb analytics report a **10-year compound annual growth rate
 * > (CAGR) of about 9.6% for Kellyville's property market to early 2026** …
 * >
 * > Other investment profiles cite **average annual capital growth for houses
 * > around 5.9–7.1% over longer windows** …
 * >
 * > `{{margin: Kellyville house value momentum | spark=9.6,7.1,5.9,4.8,3.5 |
 * >  note=Long-run growth strong, recent growth moderating from high levels. |
 * >  label=Growth profile}}`
 *
 * "External suburb analytics report" and "Other investment profiles cite" name
 * nobody — rule 2 — and the two figures disagree by up to 3.7 points. The
 * chart is worse than either: its first three values are the endpoints of
 * those two unsourced ranges, and **4.8 and 3.5 appear nowhere at all**, in
 * the document or the record. A reader sees a measured decline.
 *
 * `suppressUnrecordedVerdictVisuals` could not see it. That guard judges
 * `gauge` and `wheel` always and `bars`/`heatmap`/`radar` where they declare
 * `max=100`, on the reasoning that those primitives otherwise carry a measured
 * series — which is right, and leaves every OTHER primitive unjudged, and
 * `margin` is one of them.
 *
 * ## The rule
 *
 * The distinction is not the primitive, it is **whether the record holds the
 * series**. Where a directive's title or label names a market measure, every
 * number in its series must be one the market evidence table states. A chart
 * is a claim in the same way a sentence is, and a chart the table cannot
 * source is the sentence rule with the words taken out of it.
 *
 * Narrow on purpose:
 *
 *  - Only a directive whose TITLE or LABEL names a market measure is judged.
 *    A `{{bars}}` of amenity counts or SEIFA deciles is not this rule's
 *    business and is left alone.
 *  - Only the NUMERIC SERIES is read — `spark=`, `values=`, `data=`,
 *    `series=`, and a leading comma-separated run of numbers. A digit inside
 *    a `note=` or a `title=` is prose.
 *  - A directive with no readable series is left alone: malformed is not
 *    untrue, and that is a different control's business.
 *
 * Pure: no fetch, no Deno, no clock.
 */
export interface SuppressedMarketVisual {
  kind: string;
  directive: string;
  /** The values the market evidence table does not state. */
  values: number[];
  /** Why it was judged at all — the words in its title that named a measure. */
  matchedOn: string;
}

export interface MarketVisualSuppression {
  markdown: string;
  removed: SuppressedMarketVisual[];
}

/**
 * The words that make a chart a market chart.
 *
 * Deliberately the measures this module publishes and nothing else: an
 * "affordability" or "lifestyle" chart is not a market series and is not
 * this rule's to judge.
 */
const MARKET_WORDS = [
  'growth', 'cagr', 'median', 'price', 'prices', 'value', 'values', 'rent', 'rents',
  'rental', 'yield', 'vacancy', 'days on market', 'clearance', 'sale', 'sales',
];

const SERIES_OPTIONS = ['spark', 'values', 'data', 'series'];

/** Every number the table states, rounded the way a chart would print it. */
function statedNumbers(facts: MarketFacts): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    out.add(n.toFixed(1));
    out.add(Math.round(n).toFixed(1));
    // A money figure drawn in a chart is routinely divided down — $1,808,000
    // as 1.808, 1.81 or 1808 — so each scale the table's own value implies is
    // admitted, and nothing that is not in the table is.
    if (Math.abs(n) >= 1000) {
      add2(n / 1000, out);
      add2(n / 1_000_000, out);
    }
  };
  const add2 = (n: number, set: Set<string>) => {
    set.add(n.toFixed(1));
    set.add(Math.round(n).toFixed(1));
    set.add(Number(n.toFixed(2)).toFixed(1));
  };
  for (const row of facts.rows) {
    if (!row.value) continue;
    for (const token of row.value.match(/-?\d[\d,]*\.?\d*/g) ?? []) {
      const n = Number(token.replace(/,/g, ''));
      if (Number.isFinite(n)) add(n);
    }
  }
  return out;
}

/**
 * Every MAGNITUDE a directive plots, read through the real parser.
 *
 * `seriesValues` below re-parses the grammar privately and reads only a
 * `spark=` / `values=` / `data=` / `series=` option or a bare all-numeric
 * head. Measured by execution over all twelve production forms, that left
 * **nine unread** — including `bars` with head pairs, which is the first
 * example in the grammar's own documentation and the commonest shape in the
 * corpus. So `CHART_IS_A_CLAIM`'s promise, that "a series … may contain only
 * values from the table above", was enforced for three forms in twelve.
 *
 * This asks `parseVizDirective` instead — the one implementation of the
 * grammar, which every renderer already uses. A second reading of a grammar is
 * how the two come to disagree, and that is exactly what happened here.
 *
 * ## Which kinds, and why not the rest
 *
 * Only the kinds whose plotted values are MAGNITUDES in the same units a fact
 * table states: `bars`, `donut`, `tiles`, `heatmap`, `waterfall`, `wheel` and
 * `margin`'s sparkline.
 *
 * `gauge`, `pictograph` and `quadrant` are deliberately excluded and it is not
 * an oversight. Their numbers are a POSITION on a declared scale — a gauge's
 * `max`, a pictograph's `total`, a quadrant's axis — so `7/10` is a rating and
 * `8,3` is a placement, and judging either against a table of medians would
 * remove a sound chart. `timeline` and `glance` plot no number at all; their
 * digits live in label text, which this rule must never read as a value.
 *
 * A scale is likewise never judged: a `bars` `max=100` and a `wheel`'s `max`
 * are the axis, not a claim, so neither is returned.
 */
function plottedMagnitudes(kind: string, payload: string): number[] {
  const d = parseVizDirective(kind, payload);
  if (!d) return [];
  const finite = (xs: Array<number | null | undefined>): number[] =>
    xs.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  switch (d.kind) {
    case 'bars': return finite(d.items.map((i) => i.value));
    case 'donut': return finite(d.segments.map((sg) => sg.value));
    case 'heatmap': return finite(d.grid.flat());
    case 'waterfall': return finite(d.items.map((i) => i.value));
    case 'wheel': return finite(d.scores);
    case 'margin': return finite(d.spark ?? []);
    case 'tiles':
      /*
       * A tile's value is a STRING and is often qualitative ("Moderate"), so
       * only a tile whose value reads as a number is a magnitude.
       *
       * The digit test is the whole guard, and the first draft did not have
       * it: stripping non-numerics from `"Moderate"` leaves `""`, and
       * **`Number('')` is 0**, which is finite — so a qualitative tile
       * reported a magnitude of zero and a market-worded tile grid was
       * removed for a figure nobody plotted. That is the same trap
       * `urban-centre-register-ingest` records paying for, where a feature
       * with no point parsed as `(0, 0)`. A spec caught it here.
       */
      return finite(d.tiles.map((t) => {
        const raw = String(t.value ?? '').trim();
        if (!/\d/.test(raw)) return null;
        const n = Number(raw.replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) ? n : null;
      }));
    default:
      return [];
  }
}

/** The numbers a directive's payload draws, ignoring prose options. */
function seriesValues(payload: string): number[] {
  const parts = payload.split('|').map((p) => p.trim());
  const out: number[] = [];
  const readList = (text: string) => {
    for (const token of text.split(',')) {
      const n = Number(token.trim().replace(/[^0-9.\-]/g, ''));
      if (token.trim() !== '' && Number.isFinite(n)) out.push(n);
    }
  };
  parts.forEach((part, index) => {
    const eq = part.indexOf('=');
    if (eq === -1) {
      // The head, and only the head, may be a bare series.
      if (index === 0 && /^[\s\d.,-]+$/.test(part) && /\d/.test(part)) readList(part);
      return;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    if (SERIES_OPTIONS.includes(key)) readList(part.slice(eq + 1));
  });
  return out;
}

/** The directive's title and any `label=` — what decides whether it is judged. */
function describingWords(payload: string): string {
  const parts = payload.split('|').map((p) => p.trim());
  const head = parts[0] ?? '';
  // A grid head (`8.6,3.9 / 2.0,1.0`) is a series, not a title. It carries no
  // word, so including it changed no verdict — but leaving it would mean the
  // same string is a title here and a value list in `heatmapGrid`, which is
  // how two readings of one grammar come to disagree.
  const headIsSeries = /^[\s\d.,\/-]+$/.test(head) && /\d/.test(head);
  const labels = parts
    .filter((p) => /^(label|title)\s*=/i.test(p))
    .map((p) => p.slice(p.indexOf('=') + 1));
  return [headIsSeries ? '' : head, ...labels].join(' ').toLowerCase();
}

export function suppressUnevidencedMarketSeries(
  markdown: string,
  facts: MarketFacts,
): MarketVisualSuppression {
  const stated = statedNumbers(facts);
  const removed: SuppressedMarketVisual[] = [];
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = line.trim().match(/^\{\{([a-z]+)\s*:\s*([\s\S]*)\}\}$/i);
    if (!m) { out.push(line); continue; }
    const kind = m[1].toLowerCase();
    const payload = m[2];
    const words = describingWords(payload);
    const matched = MARKET_WORDS.filter((w) => words.includes(w));
    if (!matched.length) { out.push(line); continue; }
    // Both readings, unioned. `seriesValues` reads the option forms the
    // parser folds away (a `spark=` on a kind that declares no sparkline),
    // and `plottedMagnitudes` reads what the directive actually draws. More
    // values judged, never fewer.
    const values = [...new Set([...seriesValues(payload), ...plottedMagnitudes(kind, payload)])];
    if (!values.length) { out.push(line); continue; }
    const unsupported = values.filter((v) => !stated.has(v.toFixed(1)));
    if (!unsupported.length) { out.push(line); continue; }
    removed.push({ kind, directive: line.trim(), values: unsupported, matchedOn: matched.join(', ') });
  }
  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

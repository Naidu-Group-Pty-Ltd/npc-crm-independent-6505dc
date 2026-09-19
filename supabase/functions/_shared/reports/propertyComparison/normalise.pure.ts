/**
 * Turning one stored row into a document payload.
 *
 * ## The reading posture
 *
 * Every field this document prints was written by a model in a single response
 * and stored without schema validation, so nothing here is trusted: a field may
 * be absent, a number may be a string, an array may be an object, a pointer may
 * name a property that does not exist. `text()`, `num()`, `list()` and `block()`
 * are the whole defence and they are boring on purpose.
 *
 * The rule, as in all three prior formats: **a missing block drops its section;
 * it never renders.** With one deliberate exception, described below.
 *
 * ## Two shapes in, one payload out
 *
 * `columns` — the seven jsonb columns are populated. 23 of 50 rows.
 * `salvaged` — every column is NULL and the model's truncated response sits in
 * `executive_summary`; `salvage.pure.ts` reads it back. 27 of 50 rows.
 *
 * The shape is decided once, here, and never mixed. On the salvaged path the
 * `executive_summary` *column* is ignored entirely and the recovered
 * `executiveSummary` *key* is the summary — printing the column would put a
 * 20,000-character JSON blob on the page as prose, which is what the viewer and
 * the legacy PDF both do today.
 *
 * ## The exception to "a missing block drops its section"
 *
 * On the salvaged path a missing section is *reported*, not dropped, because its
 * absence is systematic rather than incidental: `recommendations` survives on
 * two of twenty-seven rows. A ranked comparison that silently omits "which
 * should I buy" reads as a finished document that forgot to answer its own
 * question. `provenance.missing` is what drives that, and the renderer builds a
 * named placeholder for each.
 *
 * ## A curiosity worth knowing
 *
 * `marketTiming` and `competitiveAdvantages` can only ever appear on a *salvaged*
 * document. The producer writes them, but the writer that destructures a
 * successful response into columns has nowhere to put them, so on the 23 intact
 * rows they were discarded at write time. The damaged rows carry more of the
 * analysis than the intact ones do.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { count as countOf, NO_MEASURE, percent } from '../../reportDesign/measure.pure.ts';
import type {
  AlternativeScenario,
  AxisGroup,
  AxisWinner,
  CompetitiveAdvantage,
  ComparisonBasis,
  HoldingPeriod,
  MarketTiming,
  InvestorMatch,
  LabelledWeight,
  NamedProperty,
  PropertyComparison,
  PropertyRef,
  Provenance,
  RankedProperty,
  Recommendations,
  RedFlag,
  RiskBand,
  RiskVerdict,
  ScaledScore,
  SourceShape,
} from './payload.pure.ts';
import { COMPARISON_SECTIONS } from './salvage.pure.ts';
import { readStoredAnalysis } from './storedAnalysis.pure.ts';

/** The producer accepts 2–5; more than this is a data fault, not a comparison. */
export const MAX_PROPERTIES = 12;
/** Past this a bullet list is a wall. The source has never come close. */
export const MAX_BULLETS = 16;
/** Long enough for the real executive summaries (792–1,851 chars) with headroom. */
export const MAX_PARAGRAPH = 4_000;

/** The stored row could not be read as a comparison. */
export class ComparisonPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComparisonPayloadError';
  }
}

// ── Reading whatever arrived ────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** An object at `key`, or an empty one. Never throws. */
function block(source: unknown, key: string): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const value = source[key];
  return isRecord(value) ? value : {};
}

/** An array at `key`, or an empty one. */
function arrayAt(source: unknown, key: string): unknown[] {
  if (!isRecord(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/** A string, trimmed and capped on a word boundary. Numbers stringify. */
export function text(value: unknown, max = MAX_PARAGRAPH): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const hard = trimmed.slice(0, max);
  const space = hard.lastIndexOf(' ');
  const kept = space > max * 0.6 ? hard.slice(0, space) : hard;
  return `${kept.replace(/[\s,;:.]+$/, '')}…`;
}

/** A finite number, or `null`. A numeric string counts — models emit those. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,\s%]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A list of strings out of whatever was there. */
function list(value: unknown, max = MAX_BULLETS): string[] {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value.trim() ? [text(value)] : [];
  }
  return value
    .slice(0, max)
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') return text(entry);
      if (!isRecord(entry)) return '';
      for (const key of ['text', 'advantage', 'title', 'description', 'reason', 'name', 'label']) {
        const found = text(entry[key]);
        if (found) return found;
      }
      return '';
    })
    .filter(Boolean);
}

// ── Property pointers ───────────────────────────────────────────────────────

/**
 * Resolve a stored `propertyNumber` against the property list.
 *
 * **1-based, and `0` means "nobody".** Of 92 winner pointers in the record, 74
 * name a property, 6 are `0` and 12 are `null` — the last two both meaning *no
 * clear winner on this axis*, which is a real answer rather than an absence. One
 * accessor so that no renderer ever computes `properties[n - 1]` and reads index
 * `-1`, which is how a document ends up claiming property zero won.
 */
export function propertyAt(
  raw: unknown,
  properties: readonly PropertyRef[],
): PropertyRef | null {
  const n = num(raw);
  if (n === null || !Number.isInteger(n) || n < 1 || n > properties.length) return null;
  return properties[n - 1] ?? null;
}

/** Everything before the first comma — a chart label or a narrow column. */
const streetLine = (address: string) => (address.split(',')[0] ?? address).trim();

/**
 * The properties, in `propertyNumber` order.
 *
 * `property_addresses` is the index the pointers refer to, so it is the spine.
 * The ranking carries its own copy of each address and wins where they differ,
 * because that is the one the prose was written against. Where the row has no
 * address array at all — four early rows — the ranking supplies them.
 */
function toProperties(row: Record<string, unknown>, rankings: unknown[]): PropertyRef[] {
  const stored = Array.isArray(row.property_addresses) ? row.property_addresses : [];
  const states = Array.isArray(row.property_states) ? row.property_states : [];

  const fromRanking = new Map<number, string>();
  for (const r of rankings) {
    if (!isRecord(r)) continue;
    const n = num(r.propertyNumber);
    const address = text(r.address, 200);
    if (n !== null && Number.isInteger(n) && n >= 1 && address) fromRanking.set(n, address);
  }

  const declared = num(row.property_count) ?? 0;
  const size = Math.max(stored.length, fromRanking.size, declared);
  if (!size) return [];

  const out: PropertyRef[] = [];
  for (let i = 1; i <= Math.min(size, MAX_PROPERTIES); i += 1) {
    const address = fromRanking.get(i) || text(stored[i - 1], 200) || `Property ${i}`;
    out.push({
      number: i,
      address,
      shortAddress: streetLine(address),
      // `property_states` is a de-duplicated list of the states involved, not a
      // per-property array, so it only aligns when every property shares one.
      state: states.length === 1 ? text(states[0], 8) : '',
    });
  }
  return out;
}

// ── The score, and its denominator ──────────────────────────────────────────

/**
 * Which scale this comparison's scores are on.
 *
 * Detected from the **maximum of the whole set**, never per score. That is the
 * defect in `migrate-comparison-scores`, which rescales any individual score
 * below 15 by ten — under which a genuine 12/100 becomes 120/100. The scale is a
 * property of the model call, not of a number, so one low score must not drag the
 * set onto the wrong denominator.
 *
 * Returns null when nothing was scored at all, which is a real state: the newest
 * comparisons in the record score every property `0` because the underlying
 * reports carried no data to score.
 */
export function detectScale(scores: readonly number[]): { outOf: number; confident: boolean } | null {
  const finite = scores.filter((s) => Number.isFinite(s) && s >= 0);
  if (!finite.length) return null;
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  if (max <= 0) return null;
  const outOf = max > 10 ? 100 : 10;
  return {
    outOf,
    // A 0–10 reading over a set with almost no spread is a weak signal, and the
    // document asserts the scale in words rather than leaning on the denominator.
    confident: outOf === 100 || max - min >= 2,
  };
}

const scoreOf = (raw: unknown, scale: { outOf: number; confident: boolean } | null): ScaledScore | null => {
  const n = num(raw);
  if (n === null || !scale) return null;
  return {
    value: { value: n, unit: 'count', precision: Number.isInteger(n) ? 0 : 1 },
    outOf: scale.outOf,
    confident: scale.confident,
  };
};

// ── Risk, as free text ──────────────────────────────────────────────────────

/**
 * Ten distinct `riskLevel` strings appear in the record.
 *
 * `Low-Moderate`, `Moderate`, `Moderate-Low`, `Moderate-High`, `Moderate to
 * High`, `High`, `High (Undetermined)`, `Very High`, `Critical`, `Extreme` —
 * three spellings of one idea, and one that means "unknown, assume the worst"
 * rather than a level. The band drives a tone; the source's own words are what
 * is printed. Order matters: the severe words are tested before the milder ones
 * they contain.
 */
const RISK_WORDS: ReadonlyArray<[RegExp, RiskBand]> = [
  [/extreme|critical|severe/i, 'severe'],
  [/very high|high/i, 'high'],
  [/moderate|medium|fair/i, 'moderate'],
  [/low|minimal/i, 'low'],
];

export function toRiskBand(raw: unknown): RiskBand {
  const value = text(raw, 60);
  if (!value) return 'unrated';
  for (const [pattern, band] of RISK_WORDS) if (pattern.test(value)) return band;
  return 'unrated';
}

// ── Axes ────────────────────────────────────────────────────────────────────

/** The stored key, and how the document names it. */
const MONEY_AXES: ReadonlyArray<[string, string]> = [
  ['bestValue', 'Best value for money'],
  ['bestYield', 'Highest rental yield'],
  ['bestCashFlow', 'Best cash flow'],
  ['bestROI', 'Best return on investment'],
  ['entryCostsVsReturns', 'Entry costs against returns'],
];

const PLACE_AXES: ReadonlyArray<[string, string]> = [
  ['bestSchools', 'Best schools'],
  ['bestInfrastructure', 'Best infrastructure'],
  ['bestLifestyle', 'Best lifestyle'],
  ['bestGrowthCorridor', 'Best growth corridor'],
  ['accessibilityAndConvenience', 'Accessibility and convenience'],
  ['compareAccessibility', 'Accessibility compared'],
];

const RISK_AXES: ReadonlyArray<[string, string]> = [
  ['lowestRisk', 'Lowest risk'],
  ['highestRisk', 'Highest risk'],
  ['bestRiskReward', 'Best risk against reward'],
];

/**
 * Axes where being named is bad news.
 *
 * Only one, and it is worth the machinery: `highestRisk` sits in the same block
 * as `lowestRisk`, so a scorecard that ticks both is asserting that a property
 * won the category of being riskiest.
 */
const NEGATIVE_AXES = new Set(['highestRisk']);

/**
 * One axis, or null when the record does not hold it.
 *
 * A winner naming nobody is still an axis — "no clear winner" is what the
 * analysis concluded and the document says so — but an axis with neither a
 * winner nor a reason is nothing at all and is dropped.
 */
function toWinner(
  source: Record<string, unknown>,
  key: string,
  label: string,
  properties: readonly PropertyRef[],
): AxisWinner | null {
  const raw = source[key];
  const polarity = NEGATIVE_AXES.has(key) ? 'negative' as const : 'positive' as const;
  // Some axes are plain prose rather than a winner object.
  if (typeof raw === 'string') {
    const reason = text(raw);
    return reason ? { key, label, property: null, value: '', reason, polarity } : null;
  }
  if (!isRecord(raw)) return null;
  const reason = text(raw.reason);
  const value = text(raw.value, 80);
  const property = propertyAt(raw.propertyNumber, properties);
  if (!reason && !value && !property) return null;
  return { key, label, property, value, reason, polarity };
}

function toAxisGroup(
  id: string,
  title: string,
  source: Record<string, unknown>,
  axes: ReadonlyArray<[string, string]>,
  properties: readonly PropertyRef[],
): AxisGroup | null {
  const winners = axes
    .map(([key, label]) => toWinner(source, key, label, properties))
    .filter((w): w is AxisWinner => w !== null);
  return winners.length ? { id, title, winners } : null;
}

// ── Sections ────────────────────────────────────────────────────────────────

function toRisks(source: Record<string, unknown>, properties: readonly PropertyRef[]): RiskVerdict[] {
  return arrayAt(source, 'riskLevels')
    .filter(isRecord)
    .map((r) => {
      const property = propertyAt(r.propertyNumber, properties);
      const level = text(r.riskLevel, 60);
      return {
        property: property ?? properties[0] ?? { number: 0, address: '', shortAddress: '', state: '' },
        level,
        band: toRiskBand(level),
        specificRisks: list(r.specificRisks),
      };
    })
    .filter((r) => r.level || r.specificRisks.length);
}

function toRedFlags(raw: unknown, properties: readonly PropertyRef[]): RedFlag[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isRecord)
    .map((f) => {
      const severity = text(f.severity, 40);
      return {
        property: propertyAt(f.propertyNumber, properties),
        severity,
        band: toRiskBand(severity),
        concerns: list(f.concerns),
      };
    })
    .filter((f) => f.concerns.length || f.severity);
}

function toMatches(raw: unknown, properties: readonly PropertyRef[]): InvestorMatch[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isRecord)
    .map((m) => ({
      property: propertyAt(m.propertyNumber, properties),
      investorTypes: list(m.investorTypes),
      reasoning: text(m.reasoning),
    }))
    .filter((m) => m.investorTypes.length || m.reasoning);
}

function toNamed(raw: unknown, properties: readonly PropertyRef[]): NamedProperty | null {
  if (!isRecord(raw)) return null;
  const reason = text(raw.reason);
  const property = propertyAt(raw.propertyNumber, properties);
  return reason || property ? { property, reason } : null;
}

function toNamedList(raw: unknown, properties: readonly PropertyRef[]): NamedProperty[] {
  return (Array.isArray(raw) ? raw : [])
    .map((e) => toNamed(e, properties))
    .filter((n): n is NamedProperty => n !== null);
}

function toScenarios(raw: unknown, properties: readonly PropertyRef[]): AlternativeScenario[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isRecord)
    .map((s) => ({
      scenario: text(s.scenario, 240),
      reason: text(s.reason),
      // The one place the record names this field `recommendation` rather than
      // `propertyNumber`; both are read so a rename upstream cannot lose it.
      property: propertyAt(s.recommendation ?? s.propertyNumber, properties),
    }))
    .filter((s) => s.scenario || s.reason);
}

function toRecommendations(raw: unknown, properties: readonly PropertyRef[]): Recommendations | null {
  if (!isRecord(raw)) return null;
  const built: Recommendations = {
    bestOverall: toNamed(raw.bestOverall, properties),
    runners: toNamedList(raw.runners, properties),
    avoid: toNamedList(raw.avoid, properties),
    alternativeScenarios: toScenarios(raw.alternativeScenarios, properties),
  };
  const empty = !built.bestOverall && !built.runners.length
    && !built.avoid.length && !built.alternativeScenarios.length;
  return empty ? null : built;
}

function toTiming(raw: unknown, properties: readonly PropertyRef[]): MarketTiming | null {
  if (!isRecord(raw)) return null;
  const holdingPeriods: HoldingPeriod[] = (Array.isArray(raw.holdingPeriods) ? raw.holdingPeriods : [])
    .filter(isRecord)
    .map((h) => ({
      property: propertyAt(h.propertyNumber, properties),
      period: text(h.recommendedPeriod ?? h.period, 60),
      reason: text(h.reason),
    }))
    .filter((h) => h.period || h.reason);
  const buyFirst = toNamed(raw.buyFirst, properties);
  return buyFirst || holdingPeriods.length ? { buyFirst, holdingPeriods } : null;
}

function toAdvantages(raw: unknown, properties: readonly PropertyRef[]): CompetitiveAdvantage[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(isRecord)
    .map((a) => ({
      property: propertyAt(a.propertyNumber, properties),
      advantages: list(a.advantages),
    }))
    .filter((a) => a.advantages.length);
}

/**
 * The settings the comparison was run under.
 *
 * `analysis_summary` holds a JSON settings blob despite its name, so it is parsed
 * rather than printed. A parse failure yields empty fields, never a section
 * showing raw JSON.
 */
function toBasis(row: Record<string, unknown>): ComparisonBasis {
  let settings: Record<string, unknown> = {};
  const raw = text(row.analysis_summary, 2_000);
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) settings = parsed;
    } catch {
      // Not settings after all. Nothing is printed rather than something wrong.
    }
  }

  const weights: LabelledWeight[] = [];
  if (isRecord(settings.customWeights)) {
    for (const [key, value] of Object.entries(settings.customWeights)) {
      const n = num(value);
      if (n === null) continue;
      weights.push({
        label: key.charAt(0).toUpperCase() + key.slice(1),
        weight: percent(n, 0),
      });
    }
  }

  return {
    timeHorizon: text(settings.timeHorizon, 60),
    riskTolerance: text(settings.riskTolerance, 60),
    weights,
    depth: text(row.analysis_depth, 40),
    investorProfile: text(row.investor_profile, 40),
    model: text(row.model_used, 80),
  };
}

// ── The sentence under the headline ─────────────────────────────────────────

/**
 * A built sentence, never the model's.
 *
 * The same discipline as the other three formats: the opening line is arithmetic
 * over the payload, so it cannot disagree with the table beneath it.
 */
export function describeComparison(
  properties: readonly PropertyRef[],
  ranked: readonly RankedProperty[],
  states: readonly string[],
): string {
  const n = properties.length;
  const where = states.length === 1
    ? ` in ${states[0]}`
    : states.length > 1
      ? ` across ${states.slice(0, -1).join(', ')} and ${states[states.length - 1]}`
      : '';
  const top = ranked[0];
  if (!top) return `${n} properties compared${where}.`;

  const scored = top.score
    ? ` It scores ${top.score.value.value} out of ${top.score.outOf}.`
    : ' The analysis could not score them.';
  return `${n} properties compared${where}. `
    + `${top.property.address} ranks first.${scored}`;
}

// ── Entry ───────────────────────────────────────────────────────────────────

export interface BuildComparisonInput {
  /** The `property_comparisons` row. */
  row: Record<string, unknown>;
  /** Read from `clients`, and only when exactly one client resolves. */
  clientName?: string;
  /** Things the route learned that the row does not say — a dangling report. */
  notes?: readonly string[];
  /** The clock lives at the edge. */
  now: string;
}

/** Which of the seven structured columns carry anything. */
export function buildPropertyComparison(input: BuildComparisonInput): PropertyComparison {
  const row = input.row;

  // ── Which shape, decided once ─────────────────────────────────────────────
  // `readStoredAnalysis` is that decision, and it is shared with the on-screen
  // viewer. Two readers of these rows disagreeing is not hypothetical: the
  // viewer used to try `JSON.parse` on the blob and print the cleaned string on
  // failure, so a row this route read correctly rendered as 16 KB of raw JSON on
  // the screen beside it.
  const stored = readStoredAnalysis(row);
  if (stored.error) throw new ComparisonPayloadError(stored.error);
  const source = stored.sections;
  const provenance: Provenance = stored.provenance;
  const shape: SourceShape = provenance.shape;

  // ── The properties, and the pointers into them ────────────────────────────
  const rawRankings = Array.isArray(source.rankings) ? source.rankings : [];
  const properties = toProperties(row, rawRankings);
  if (properties.length < 2) {
    // Two is what makes it a comparison. The producer refuses to run below that
    // and a one-property "comparison" is a different document.
    throw new ComparisonPayloadError(
      `a comparison needs at least two properties; this row resolves ${properties.length}`,
    );
  }

  const scale = detectScale(
    rawRankings.filter(isRecord).map((r) => num(r.finalScore)).filter((n): n is number => n !== null),
  );

  const risks = toRisks(block(source, 'riskComparison'), properties);
  const riskByNumber = new Map(risks.map((r) => [r.property.number, r]));

  const ranked: RankedProperty[] = rawRankings
    .filter(isRecord)
    .map((r) => {
      const property = propertyAt(r.propertyNumber, properties);
      const resolved = property ?? properties[0];
      return {
        property: resolved,
        rank: num(r.rank),
        score: scoreOf(r.finalScore, scale),
        strengths: list(r.primaryStrengths),
        concerns: list(r.primaryConcerns),
        bestSuitedFor: text(r.bestSuitedFor, 240),
        risk: riskByNumber.get(resolved.number) ?? null,
      };
    })
    // Rank is not unique — a real row ranks two properties equal second — so the
    // sort is stable on rank and nothing keys off it.
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));

  const axes = [
    toAxisGroup('money', 'The money', block(source, 'financialComparison'), MONEY_AXES, properties),
    toAxisGroup('place', 'Location and lifestyle', block(source, 'locationComparison'), PLACE_AXES, properties),
    toAxisGroup('risk', 'Risk', block(source, 'riskComparison'), RISK_AXES, properties),
  ].filter((g): g is AxisGroup => g !== null);

  const notes = [...(input.notes ?? [])];
  if (row.is_archived === true) {
    notes.push('This comparison has been archived. It is reproduced here as it was saved.');
  }
  if (scale && !scale.confident) {
    notes.push(
      `Scores are recorded out of ${scale.outOf}. The analysis scored every property `
      + 'closely, so the scale is stated rather than inferred from the figures alone.',
    );
  }

  const summary = text(source.executiveSummary);

  return {
    meta: {
      title: text(row.report_title, 160)
        || `Property Comparison — ${properties.length} properties`,
      clientName: text(input.clientName, 120),
      analysedOn: text(row.created_at, 40),
      preparedOn: input.now,
      reference: text(row.id, 8).toUpperCase(),
      states: (Array.isArray(row.property_states) ? row.property_states : [])
        .map((s) => text(s, 8)).filter(Boolean),
      archived: row.is_archived === true,
    },
    provenance,
    properties,
    ranked,
    scale: ranked.find((r) => r.score)?.score ?? null,
    narrative: describeComparison(properties, ranked, (Array.isArray(row.property_states) ? row.property_states : []).map((s) => text(s, 8)).filter(Boolean)),
    summary,
    axes,
    risks,
    redFlags: toRedFlags(source.redFlags, properties),
    matches: toMatches(source.investorMatches, properties),
    recommendations: toRecommendations(source.recommendations, properties),
    timing: toTiming(source.marketTiming, properties),
    advantages: toAdvantages(source.competitiveAdvantages, properties),
    basis: toBasis(row),
    notes,
  };
}

/** Re-exported so the sections module can name what the record should hold. */
export { COMPARISON_SECTIONS };

/** How each section key reads in a sentence. */
export const SECTION_LABELS: Readonly<Record<string, string>> = {
  executiveSummary: 'the executive summary',
  rankings: 'the property ranking',
  financialComparison: 'the financial comparison',
  locationComparison: 'the location comparison',
  riskComparison: 'the risk comparison',
  investorMatches: 'investor matching',
  marketTiming: 'market timing',
  competitiveAdvantages: 'competitive advantages',
  redFlags: 'the red flags',
  recommendations: 'the final recommendation',
};

/** A `Measure` for a plain count, for the KPI strip. */
export const asCount = (n: number): Measure => (Number.isFinite(n) ? countOf(n) : NO_MEASURE);

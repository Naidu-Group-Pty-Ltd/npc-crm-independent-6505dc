/**
 * RF-7.2B — market facts a client may actually be shown.
 *
 * RF-7.2A found the two largest market inputs were not what their labels said:
 * demographics generated under an "ABS Census 2021" attribution on 855 reports,
 * and a hardcoded `4.35` under an "RBA Official Cash Rate" attribution on 1,035.
 * This module is the forward replacement, and it is deliberately small, because
 * the fix is not cleverness — it is reading the table the platform already
 * loaded and refusing when it cannot.
 *
 * ## Demographics
 *
 * ```
 * report_geography (ASGS point-in-polygon, trusted)
 *   → postcode
 *   → abs_census_poa          ← 2,643 genuine ABS Census 2021 rows
 *   → contextual facts, carrying POA grain and the 2021 reference period
 * ```
 *
 * Measured on the live corpus: **867 of 1,207 reports** have trusted geography,
 * and **all 867** match a row in `abs_census_poa`. The other 340 get
 * `unavailable` — not an estimate, not a neighbouring postcode, not a model.
 *
 * The grain is a **postcode**, and it is published as one. A postcode routinely
 * spans several suburbs of very different character, so "POA 3024" is not
 * "Cobblebank" and this module will not let it be labelled as such.
 *
 * ## The cash rate, and why the label is the hard part
 *
 * The series the platform holds is `FIRMMCRT`, and its own metadata reads
 * **"Cash Rate Target; monthly average"** — RBA table F1.1, monthly frequency.
 * That is not a spot rate. In a month with no policy change the average equals
 * the target (3.60, 3.85, 4.10, 4.35 sit on the 25bp ladder); in a month
 * containing a change it does not (4.31, 3.96, 3.83 and 3.70 are all
 * transition-month averages).
 *
 * So this module publishes what the series *is*: the cash rate target's monthly
 * average, for a named month, with the RBA's own publication date. It does not
 * call it "the current cash rate", because a change in the current month is not
 * yet in the series — and describing one as the other is precisely the
 * substitution that produced the defect being fixed.
 *
 * Two further refusals, each measured:
 *
 * - a stored value whose source says `(estimated)` is **generated**, and the
 *   hardcoded `4.35` is the whole of that population;
 * - a value sourced "via Perplexity real-time search" is a **model's** reading
 *   of the web presented as a statistical agency's publication.
 *
 * Neither is admitted however plausible the number looks. The hardcoded 4.35 is
 * in fact correct as at August 2026, which is exactly why it must still be
 * refused: a constant that is accidentally right is one RBA decision away from
 * being silently wrong again, and nothing in the product would notice.
 *
 * Pure: no database, no network, no clock, no LLM. Rows in, gated facts out.
 */

import {
  gateFact,
  type SafeFact,
  type FactContext,
} from './clientSafeGate.pure.ts';
// One month table in the programme. A private copy here is exactly what
// `oneDateFormatter.spec.ts` exists to refuse, and it caught this on the
// first run.
import { MONTHS_LONG } from '../reportDate.pure.ts';

export const SAFE_MARKET_FACTS_VERSION = '1.0.0';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

/** A row of `public.abs_census_poa`, in whatever shape it was selected. */
export type AbsCensusRow = unknown;

/** The resolved `public.report_geography` row for the same report. */
export type GeographyRow = unknown;

export interface DemographicFacts {
  readonly facts: SafeFact<unknown>[];
  /** True only where trusted geography resolved AND an ABS row matched. */
  readonly routed: boolean;
  readonly reason: string;
}

const TRUSTED_GEOGRAPHY_STATUS = ['resolved', 'resolved_with_warning'];

/**
 * Demographics for one report, or a clean refusal.
 *
 * The refusal path is the point of the function. Three different things can go
 * wrong — no geography, untrusted geography, no matching ABS row — and each
 * gets its own sentence, because "unavailable" with no reason is what sends an
 * operator looking in the wrong place.
 */
export function safeDemographics(
  geography: GeographyRow,
  absRow: AbsCensusRow,
): DemographicFacts {
  const unavailableAll = (reason: string): DemographicFacts => ({
    routed: false,
    reason,
    facts: DEMOGRAPHIC_FIELDS.map((f) => gateFact({
      name: f.name,
      value: null,
      safety: 'unavailable',
      absenceReason: reason,
      material: f.material,
    })),
  });

  if (!isRecord(geography)) {
    return unavailableAll(
      'No geography has been resolved for this property, so no area statistics can be '
      + 'attached to it. They are not estimated from the address.',
    );
  }

  const status = str(geography.status);
  if (status === null || !TRUSTED_GEOGRAPHY_STATUS.includes(status)) {
    return unavailableAll(
      'This property\'s location could not be resolved with confidence, so area '
      + 'statistics are not attached to it.',
    );
  }

  const postcode = str(geography.postcode);
  if (postcode === null) {
    return unavailableAll(
      'The resolved location carries no postcode, so no postcode-area statistics can '
      + 'be matched to it.',
    );
  }

  if (!isRecord(absRow)) {
    return unavailableAll(
      `No ABS Census record is held for postcode ${postcode}. A neighbouring `
      + 'postcode is never substituted.',
    );
  }

  const referencePeriod = str(absRow.reference_period) ?? '2021 Census';
  const source = 'abs_census_poa';
  const context: FactContext = {
    grain: 'postcode',
    referencePeriod,
    dataset: str(absRow.source) ?? 'ABS Census of Population and Housing 2021',
    asOf: str(absRow.loaded_at),
  };

  const facts = DEMOGRAPHIC_FIELDS.map((f) => gateFact({
    name: f.name,
    value: num((absRow as Record<string, unknown>)[f.column]),
    safety: 'contextual',
    source,
    context,
    material: f.material,
    absenceReason: `The ABS Census record for postcode ${postcode} carries no `
      + `${f.clientLabel.toLowerCase()}.`,
  }));

  return {
    facts,
    routed: true,
    reason: `Matched ABS Census ${referencePeriod} for postcode ${postcode}.`,
  };
}

/**
 * The demographic fields, their real columns, and what a client may call them.
 *
 * `clientLabel` never says "suburb". Each is a postcode-area figure and the
 * gate attaches that grain to every one of them.
 */
export const DEMOGRAPHIC_FIELDS: ReadonlyArray<{
  name: string;
  column: string;
  clientLabel: string;
  material?: boolean;
}> = [
  { name: 'market.population', column: 'population', clientLabel: 'Population' },
  { name: 'market.medianAge', column: 'median_age', clientLabel: 'Median age' },
  { name: 'market.medianRentWeekly', column: 'median_rent_weekly', clientLabel: 'Median weekly rent' },
  { name: 'market.medianHouseholdIncomeWeekly', column: 'median_hh_income_weekly', clientLabel: 'Median household income (weekly)' },
  { name: 'market.medianMortgageMonthly', column: 'median_mortgage_monthly', clientLabel: 'Median monthly mortgage repayment' },
  { name: 'market.ownerOccupierRate', column: 'owner_occupier_rate', clientLabel: 'Owner-occupier rate' },
  { name: 'market.renterRate', column: 'renter_rate', clientLabel: 'Renter rate' },
  { name: 'market.unemploymentRate', column: 'unemployment_rate', clientLabel: 'Unemployment rate' },
  { name: 'market.participationRate', column: 'participation_rate', clientLabel: 'Labour-force participation rate' },
];

// ---------------------------------------------------------------------------
// The cash rate
// ---------------------------------------------------------------------------

/** A row of `public.rba_observations` joined to its `rba_series_meta`. */
export interface RbaCashRateReading {
  readonly seriesId: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly frequency: unknown;
  readonly tableCode: unknown;
  readonly publicationDate: unknown;
  readonly obsDate: unknown;
  readonly value: unknown;
}

/** The one series this module will read, named rather than pattern-matched. */
export const CASH_RATE_SERIES_ID = 'FIRMMCRT';

/**
 * The RBA cash rate target, labelled as the monthly average it is.
 *
 * Refuses anything that is not the series it expects. A different series with a
 * plausible title is not a substitute: the whole defect being repaired here was
 * a plausible number under an authoritative label.
 */
export function safeCashRate(reading: RbaCashRateReading | null): SafeFact<number> {
  if (reading === null) {
    return gateFact<number>({
      name: 'market.cashRateTargetMonthlyAverage',
      value: null,
      safety: 'unavailable',
      material: true,
      absenceReason:
        'No Reserve Bank cash rate observation is currently held, so no official rate '
        + 'is quoted. An estimate is not used in its place.',
    });
  }

  if (str(reading.seriesId) !== CASH_RATE_SERIES_ID) {
    return gateFact<number>({
      name: 'market.cashRateTargetMonthlyAverage',
      value: null,
      safety: 'unavailable',
      material: true,
      absenceReason:
        'The available interest-rate series is not the Reserve Bank cash rate target, '
        + 'so it is not quoted as one.',
    });
  }

  const value = num(reading.value);
  const month = monthLabel(reading.obsDate);
  const published = str(reading.publicationDate);

  return gateFact<number>({
    name: 'market.cashRateTargetMonthlyAverage',
    value,
    safety: 'contextual',
    source: 'rba_observations',
    material: true,
    context: {
      grain: 'national',
      // The label carries the two things the old value hid: that it is a
      // monthly AVERAGE, and which month it is the average of.
      referencePeriod: month === null
        ? 'a month the series does not name'
        : `${month} (monthly average)`,
      dataset: str(reading.tableCode)
        ? `RBA statistical table ${String(reading.tableCode).toUpperCase()} — ${str(reading.description) ?? 'Cash Rate Target'}`
        : 'RBA Cash Rate Target',
      asOf: published,
    },
    absenceReason:
      'The Reserve Bank series carries no value for the latest period, so no official '
      + 'rate is quoted.',
  });
}

/** The daily target series and the RBA's own announced-change column. */
export const CASH_RATE_TARGET_SERIES_ID = 'FIRMMCRTD';

/** The in-force target, as `cashRateTargetOf` derived it from F1. */
export interface CashRateTargetReading {
  readonly percent: unknown;
  readonly effectiveDate: unknown;
  readonly effectiveLabel: unknown;
  readonly lastChangedDate: unknown;
  readonly lastChangedLabel: unknown;
  readonly lastChangePoints: unknown;
  readonly decisionsSinceChange?: unknown;
  readonly asAtLabel: unknown;
  readonly seriesId: unknown;
  readonly tableCode: unknown;
  readonly publicationDate: unknown;
  readonly effectiveDateSource?: unknown;
}

/**
 * The cash rate target in force, with the date the Reserve Bank set it.
 *
 * This is the fact a reader acts on, and the one the product could not state:
 * the only series held was a monthly AVERAGE, so "the current cash rate" was
 * either a month-old average or a constant nobody refreshed. Absent means
 * absent — `safeCashRate` is NOT a fallback for this, because presenting a
 * monthly average as the rate in force is the misstatement being closed.
 */
export function safeCashRateTarget(reading: CashRateTargetReading | null): SafeFact<number> {
  const unavailable = (why: string) => gateFact<number>({
    name: 'market.cashRateTargetCurrent',
    value: null,
    safety: 'unavailable',
    material: true,
    absenceReason: why,
  });

  if (reading === null) {
    return unavailable(
      'No Reserve Bank cash-rate target is currently held, so no current rate is quoted. '
      + 'The monthly average is not used in its place.',
    );
  }
  // `seriesId` is F1's, and F1 is a cross-check rather than the authority: the
  // decision history alone is sufficient and leaves it null. What is refused is
  // a reading claiming to be the target while naming some OTHER series.
  const seriesId = str(reading.seriesId);
  if (seriesId !== null && seriesId !== CASH_RATE_TARGET_SERIES_ID) {
    return unavailable(
      'The available interest-rate series is not the Reserve Bank cash rate target on date, '
      + 'so it is not quoted as the current target.',
    );
  }

  const value = num(reading.percent);
  const effective = str(reading.effectiveLabel);
  if (value === null || effective === null) {
    return unavailable(
      'The Reserve Bank series does not carry both a target and the date it took effect, '
      + 'so no current rate is quoted.',
    );
  }

  const asAt = str(reading.asAtLabel);
  return gateFact<number>({
    name: 'market.cashRateTargetCurrent',
    value,
    safety: 'authoritative',
    source: 'rba_observations',
    material: true,
    context: {
      grain: 'national',
      referencePeriod: `effective ${effective}`
        + (asAt ? `, in force as at ${asAt}` : ''),
      dataset: str(reading.effectiveDateSource)
        ?? 'RBA Cash Rate Target decision history',
      asOf: str(reading.publicationDate),
    },
  });
}

/**
 * The three dates and amounts that sit beside the target, each its own fact.
 *
 * Separate rather than folded into the target's label because they answer
 * different questions and were being conflated: the EFFECTIVE date is the most
 * recent Board decision (12 August 2026 on the reported case) while the LAST
 * CHANGED date is when the rate moved (6 May 2026). A snapshot that recorded
 * only "effective 6 May" would preserve the error rather than the facts.
 */
export function cashRateTargetDetailFacts(
  reading: CashRateTargetReading | null,
): SafeFact<unknown>[] {
  if (reading === null) return [];
  const source = str(reading.effectiveDateSource)
    ?? 'RBA Cash Rate Target decision history';
  const context = {
    grain: 'national' as const,
    referencePeriod: 'RBA Board decision',
    dataset: source,
    asOf: str(reading.publicationDate),
  };
  const facts: SafeFact<unknown>[] = [];
  const effectiveDate = str(reading.effectiveDate);
  if (effectiveDate !== null) {
    facts.push(gateFact({
      name: 'market.cashRateTargetEffectiveDate',
      value: effectiveDate,
      safety: 'authoritative',
      source: 'rba_cash_rate_decisions',
      context,
    }));
  }
  const lastChanged = str(reading.lastChangedDate);
  if (lastChanged !== null) {
    facts.push(gateFact({
      name: 'market.cashRateTargetLastChangedDate',
      value: lastChanged,
      safety: 'authoritative',
      source: 'rba_cash_rate_decisions',
      context,
    }));
  }
  const points = num(reading.lastChangePoints);
  if (points !== null) {
    facts.push(gateFact({
      name: 'market.cashRateTargetLastChangePoints',
      value: points,
      safety: 'authoritative',
      source: 'rba_cash_rate_decisions',
      context,
    }));
  }
  // The macro table prints this — "unchanged at 2 Board decisions since" — so
  // it is a client-visible figure and must be reconstructable from the stored
  // snapshot like any other. Found by the §C5 coverage probe, which exists
  // precisely because a figure can reach a prompt without reaching the record.
  const held = num(reading.decisionsSinceChange);
  if (held !== null) {
    facts.push(gateFact({
      name: 'market.cashRateTargetDecisionsSinceChange',
      value: held,
      safety: 'authoritative',
      source: 'rba_cash_rate_decisions',
      context,
    }));
  }
  return facts;
}

/** The client sentence for the in-force target. One spelling, shared. */
export function cashRateTargetStatement(fact: SafeFact<number>): string {
  if (fact.status !== 'present' || fact.value === null || fact.context === null) {
    return fact.absence?.reason ?? 'No current Reserve Bank cash rate target is quoted.';
  }
  return `RBA Cash Rate Target: ${fact.value}% — ${fact.context.referencePeriod}`
    + (fact.context.asOf ? `, published ${fact.context.asOf}.` : '.');
}

/** `2026-08-31` → `August 2026`. Null rather than a guess on anything else. */
export function monthLabel(obsDate: unknown): string | null {
  const s = str(obsDate);
  if (s === null) return null;
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return null;
  return `${MONTHS_LONG[idx]} ${m[1]}`;
}

/**
 * The client sentence for the cash rate, which must not say "current".
 *
 * Exported so the narrative bundle and any surface use the same words: two
 * spellings of one caveat is how one of them loses it.
 */
export function cashRateStatement(fact: SafeFact<number>): string {
  if (fact.status !== 'present' || fact.value === null || fact.context === null) {
    return fact.absence?.reason
      ?? 'No official cash rate is quoted.';
  }
  return `Reserve Bank cash rate target: ${fact.value}% — ${fact.context.referencePeriod}`
    + (fact.context.asOf ? `, published ${fact.context.asOf}.` : '.');
}

// ---------------------------------------------------------------------------
// The disowned Location trio
// ---------------------------------------------------------------------------

/**
 * The four stored location figures a forward report may not consume.
 *
 * Historical rows keep them; nothing deletes them. They are refused HERE, at
 * the point of use, which is what lets the record stay intact while the
 * document stops repeating it.
 */
export const BLOCKED_LOCATION_FIELDS: readonly string[] = [
  'market.walkScore',
  'market.commuteDurationMinutes',
  'market.schoolsWithin3km',
  'market.transportQualityScore',
];

/** Refuse every one of them, with the measurement that justifies the refusal. */
export function blockedLocationFacts(): SafeFact<unknown>[] {
  return BLOCKED_LOCATION_FIELDS.map((name) => gateFact({
    name,
    value: null,
    safety: 'not_client_safe',
  }));
}

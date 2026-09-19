/**
 * ME-6 — what has to be true about a provider's answer before it is scored.
 *
 * ## The governing distinction: REJECT versus FLAG
 *
 * Two failures look alike in a validator and are opposites in a market.
 *
 * A **malformed** answer is one no market could produce: a period in the
 * future, one period appearing twice, a series running backwards, a suburb the
 * request never asked about. Those are rejected — using them is using
 * something that is not evidence.
 *
 * An **extreme** answer is one a market can absolutely produce. Perth houses
 * moved more than 20% in a year; a thin regional suburb's median can halve
 * because three cheap sales landed in one quarter. Clipping those to a
 * "sensible" band is the fabrication this programme exists to remove — it
 * silently rewrites a genuine market event into a plausible one and nothing
 * downstream can tell. So an extreme value is **flagged and passed through at
 * full value**, and the flag travels with it.
 *
 * `clip`, `cap`, `winsorise` and `floor` do not appear in this module, and a
 * test asserts no finding can carry a corrected value.
 *
 * ## Geography is matched, never trusted
 *
 * A provider answers with the area it decided the request meant. Asking for
 * `Bowral NSW 2576` and being answered for `Bowral` in a different state, or
 * for the LGA, is a correct answer to a different question — the exact failure
 * `market-source-probe`'s Part C gate exists to catch. The provider's returned
 * area is compared against the TRUSTED Aurixa geography, which ME-5.1
 * established for 867 reports, and a mismatch is rejected rather than accepted
 * with a note.
 *
 * ## Dwelling type is never silently substituted
 *
 * `dwellingTypeMatched: false` already exists on `EvidencePoint` and means the
 * source could only answer for another type. That is admissible for some
 * measures and never admissible as the subject's own growth: a unit's growth
 * is not a house's. The finding names it rather than letting a report claim
 * the number is about the asked-for type.
 *
 * ## Freshness is a fact, recorded exactly
 *
 * How old the evidence is, in days, from the period the SOURCE describes —
 * never from when we fetched it. The sanctions work settled that one:
 * freshness of the load is not currency of the data.
 */

/** Bumped when a rule changes. Persisted on every report. */
export const EVIDENCE_QUALITY_VERSION = 'me6.quality.1' as const;

export type QualitySeverity = 'reject' | 'flag' | 'note';

export type QualityCode =
  // rejections — not evidence
  | 'geography_mismatch'
  | 'geography_level_coarser_than_requested'
  | 'period_in_future'
  | 'period_unparseable'
  | 'duplicate_period'
  | 'series_out_of_order'
  | 'insufficient_history'
  // flags — real, and worth a human look
  | 'extreme_period_movement'
  | 'series_gap'
  | 'thin_sample'
  | 'sample_size_absent'
  | 'stale_evidence'
  | 'dwelling_type_substituted'
  // notes
  | 'freshness_recorded';

export interface QualityFinding {
  code: QualityCode;
  severity: QualitySeverity;
  detail: string;
  /**
   * The value the finding is about, unchanged. There is deliberately no
   * `correctedValue`: this module never rewrites a market.
   */
  observedValue: number | string | null;
}

export interface QualityReport {
  version: typeof EVIDENCE_QUALITY_VERSION;
  admissible: boolean;
  findings: ReadonlyArray<QualityFinding>;
  /** Days between the period the source describes and the evaluation date. */
  freshnessDays: number | null;
  /** Sample sizes retained exactly as supplied, in series order. */
  sampleSizes: ReadonlyArray<number | null>;
}

/** What Aurixa asked for — the trusted geography, never the provider's echo. */
export interface RequestedSubject {
  suburb: string;
  postcode: string;
  state: string;
  dwellingType: string;
}

/** What the provider answered with. */
export interface AnsweredSubject {
  areaName: string;
  postcode?: string | null;
  state?: string | null;
  level: string;
  dwellingType: string;
  dwellingTypeMatched: boolean;
}

export interface SeriesPoint { period: string; value: number; sampleSize?: number | null }

/**
 * A movement beyond which a period is FLAGGED — never clipped.
 *
 * Set from what Australian suburb medians genuinely do rather than from a
 * statistical convention: a quarter-on-quarter move above this is usually a
 * mix shift in a thin market, which is exactly the thing a reader must be told
 * about rather than have smoothed away.
 */
export const EXTREME_PERIOD_MOVEMENT_PCT = 40;

/** Below this, a median is a handful of sales and says more about the sample. */
export const THIN_SAMPLE_THRESHOLD = 10;

/** Beyond this, evidence is flagged as stale. It is still returned. */
export const STALE_EVIDENCE_DAYS = 400;

/** A gap larger than this between consecutive observations is flagged. */
export const MAX_GAP_DAYS = 200;

const DAY = 24 * 60 * 60 * 1000;
const basic = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Suburb comparison, tolerant of a bracketed state disambiguator.
 *
 * Australian suburb names repeat across states, so both our geography and a
 * provider's may carry one — "Araluen (NSW)". Stripping it lets the two spell
 * the same place differently and still match.
 *
 * It must NEVER be used on the state field itself: it would reduce every state
 * to the empty string, and VIC would match NSW. That is not hypothetical — it
 * is the bug this module shipped with for one test run, and the reason the two
 * normalisers are separate functions rather than one with a flag.
 */
const normSuburb = (s: string) =>
  basic(s).replace(/\b(nsw|vic|qld|wa|sa|tas|act|nt)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** State comparison. Deliberately does not strip state tokens. */
const normState = (s: string) => basic(s);

/** Levels at least as fine as suburb. A coarser answer is a different question. */
const SUBJECT_LEVELS = new Set(['property', 'suburb']);

/**
 * Validate one provider answer.
 *
 * `evaluatedAt` is a parameter rather than `Date.now()` so a snapshot's
 * freshness is reproducible in ME-7 — the same inputs must always produce the
 * same report.
 */
export function assessEvidenceQuality(
  requested: RequestedSubject,
  answered: AnsweredSubject,
  series: ReadonlyArray<SeriesPoint>,
  evaluatedAt: Date,
  opts: { requireSubjectLevel?: boolean; minObservations?: number } = {},
): QualityReport {
  const findings: QualityFinding[] = [];
  const add = (code: QualityCode, severity: QualitySeverity, detail: string, observedValue: number | string | null = null) =>
    findings.push({ code, severity, detail, observedValue });

  // ── geography ────────────────────────────────────────────────────────────
  if (normSuburb(answered.areaName) !== normSuburb(requested.suburb)) {
    add('geography_mismatch', 'reject',
      `Asked for "${requested.suburb}"; answered for "${answered.areaName}". A correct answer to a different question.`,
      answered.areaName);
  }
  if (answered.postcode && answered.postcode.trim() !== requested.postcode.trim()) {
    add('geography_mismatch', 'reject',
      `Asked for postcode ${requested.postcode}; answered for ${answered.postcode}.`, answered.postcode);
  }
  if (answered.state && normState(answered.state) !== normState(requested.state)) {
    add('geography_mismatch', 'reject',
      `Asked for ${requested.state}; answered for ${answered.state}. Suburb names repeat across states.`,
      answered.state);
  }
  if ((opts.requireSubjectLevel ?? true) && !SUBJECT_LEVELS.has(answered.level)) {
    add('geography_level_coarser_than_requested', 'reject',
      `Answered at "${answered.level}". A coarser area is a benchmark, never the subject's own figure.`,
      answered.level);
  }

  // ── dwelling type ────────────────────────────────────────────────────────
  if (!answered.dwellingTypeMatched) {
    add('dwelling_type_substituted', 'flag',
      `Asked for "${requested.dwellingType}"; the source could only answer for "${answered.dwellingType}". `
      + 'Usable as context; never as this dwelling type’s own growth.',
      answered.dwellingType);
  }

  // ── series shape ─────────────────────────────────────────────────────────
  const times: number[] = [];
  const seen = new Set<string>();
  for (const p of series) {
    const t = Date.parse(p.period);
    if (!Number.isFinite(t)) {
      add('period_unparseable', 'reject', `Period "${p.period}" is not a date.`, p.period);
      continue;
    }
    if (t > evaluatedAt.getTime()) {
      add('period_in_future', 'reject',
        `Period ${p.period} is after the evaluation date. An observation cannot describe a period that has not ended.`,
        p.period);
    }
    if (seen.has(p.period)) {
      add('duplicate_period', 'reject', `Period ${p.period} appears more than once.`, p.period);
    }
    seen.add(p.period);
    times.push(t);
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) {
      add('series_out_of_order', 'reject',
        `Observation ${i} (${series[i].period}) precedes observation ${i - 1} (${series[i - 1].period}).`,
        series[i].period);
      break;
    }
  }
  const minObs = opts.minObservations ?? 2;
  if (series.length < minObs) {
    add('insufficient_history', 'reject',
      `${series.length} observation(s); ${minObs} are required before any period can be computed.`, series.length);
  }

  // ── gaps: real, and a reason to look ─────────────────────────────────────
  for (let i = 1; i < times.length; i++) {
    const gap = Math.round((times[i] - times[i - 1]) / DAY);
    if (gap > MAX_GAP_DAYS) {
      add('series_gap', 'flag',
        `${gap} days between ${series[i - 1].period} and ${series[i].period}. A gap is not an error, `
        + 'but a period computed across it spans absent quarters.', gap);
    }
  }

  // ── numeric sanity: flagged at FULL value, never clipped ─────────────────
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    if (!(prev > 0) || !Number.isFinite(cur)) continue;
    const movePct = ((cur - prev) / prev) * 100;
    if (Math.abs(movePct) >= EXTREME_PERIOD_MOVEMENT_PCT) {
      add('extreme_period_movement', 'flag',
        `${movePct.toFixed(1)}% between ${series[i - 1].period} and ${series[i].period}. `
        + 'Reported at full value: a thin market genuinely moves like this, and clipping it would '
        + 'rewrite a real event into a plausible one.', Math.round(movePct * 100) / 100);
    }
  }

  // ── sample sufficiency: retained, never invented ─────────────────────────
  const sampleSizes = series.map((p) => (typeof p.sampleSize === 'number' ? p.sampleSize : null));
  const withSample = sampleSizes.filter((s): s is number => s !== null);
  if (withSample.length === 0 && series.length > 0) {
    add('sample_size_absent', 'flag',
      'The provider states no transaction count. Confidence is scored lower for absent sample information; '
      + 'a count is never assumed.', null);
  } else {
    const thin = withSample.filter((s) => s < THIN_SAMPLE_THRESHOLD).length;
    if (thin > 0) {
      add('thin_sample', 'flag',
        `${thin} of ${withSample.length} periods rest on fewer than ${THIN_SAMPLE_THRESHOLD} transactions.`, thin);
    }
  }

  // ── freshness: from the period the SOURCE describes ──────────────────────
  let freshnessDays: number | null = null;
  if (times.length > 0) {
    const latest = Math.max(...times);
    freshnessDays = Math.round((evaluatedAt.getTime() - latest) / DAY);
    add('freshness_recorded', 'note',
      `Most recent observation is ${freshnessDays} days old, measured from the period the source describes.`,
      freshnessDays);
    if (freshnessDays > STALE_EVIDENCE_DAYS) {
      add('stale_evidence', 'flag',
        `${freshnessDays} days since the most recent observation. Returned in full; age travels with it.`,
        freshnessDays);
    }
  }

  return {
    version: EVIDENCE_QUALITY_VERSION,
    admissible: !findings.some((f) => f.severity === 'reject'),
    findings,
    freshnessDays,
    sampleSizes,
  };
}

/** The rejections alone, for a caller that only needs to know why. */
export function rejections(report: QualityReport): ReadonlyArray<QualityFinding> {
  return report.findings.filter((f) => f.severity === 'reject');
}

/** Flags travel with admissible evidence — they are disclosures, not blocks. */
export function flags(report: QualityReport): ReadonlyArray<QualityFinding> {
  return report.findings.filter((f) => f.severity === 'flag');
}

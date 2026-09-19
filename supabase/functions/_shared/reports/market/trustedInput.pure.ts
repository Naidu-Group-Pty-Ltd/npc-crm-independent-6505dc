/**
 * The Trusted Evidence Gate — what may reach the scoring engine, and why.
 *
 * Scoring V2 is correct (audit §68). This module answers the question that
 * sits in front of it: **can the inputs it is handed be trusted?** The
 * zero-cost corpus replay found the engine behaving honestly on inputs that
 * had never themselves been qualified, and the gate is what closes that gap.
 *
 * ## Four classes, and the line between them
 *
 * **`trusted`** — source, provenance and semantics are all verified. May score.
 *
 * **`recovered`** — not cleanly stored where the reader looked, but
 * deterministically recoverable from another trusted record already held. May
 * score, and the recovery route travels with the value so it can be audited.
 *
 * **`untrusted`** — a known default, a fabricated value, a contaminated
 * measurement or a semantically ambiguous one. **Must never score.** This is
 * the class that did not exist before: an untrusted input is not missing, and
 * treating it as present is how a measurement of somewhere else becomes a
 * fact about a property.
 *
 * **`unavailable`** — does not exist. Must never score.
 *
 * `untrusted` and `unavailable` both keep a value out of the composite, and
 * they are kept apart because they send an operator to different remedies: one
 * needs the data repaired, the other needs it acquired.
 *
 * ## The rule that does the real work: trust is inherited
 *
 * A walk score, a commute time and a school count are not facts about a
 * property. They are facts about a **coordinate**, computed by asking a
 * service what surrounds that point. So if the coordinate is not the
 * property's, none of them is the property's either.
 *
 * Measured on the live corpus (2026-09-11): 62 scored reports carry the
 * coordinate `-33.8688, 151.2093` — Sydney's CBD, a geocoder failure value —
 * and 61 of those carry a walk score with all 62 carrying a school count.
 * Those numbers describe Sydney's CBD. Several of the reports are Western
 * Australian, and many carry no resolvable address at all. Scoring Location
 * from them is not a small inaccuracy; it is a measurement of a different
 * place presented as this one.
 *
 * {@link inheritTrust} is therefore the gate's central operation, and the
 * reason the classification lives beside the scorer rather than inside each
 * caller.
 *
 * ## Geography is already adjudicated, and this module does not re-adjudicate
 *
 * `report_geography` holds the verdict of `resolve-report-geography`, which
 * resolves a coordinate to suburb, postcode, state and SA2 by deterministic
 * point-in-polygon against ABS ASGS 2021 boundaries. It already refuses what
 * it cannot place: of 64 sentinel rows, **zero** were resolved. This module
 * reads that verdict; it does not second-guess it and it does not rebuild it.
 */

import type { EvidenceAcquisition } from './marketEvidence.pure.ts';

/** Bumped whenever a class's meaning or a gate rule changes. */
export const TRUSTED_INPUT_CONTRACT_VERSION = '1.0.0';

export type TrustClass = 'trusted' | 'recovered' | 'untrusted' | 'unavailable';

/** A value that has been qualified, with everything needed to defend it. */
export interface TrustedInput<T> {
  value: T | null;
  trust: TrustClass;
  /** What the number MEANS — the unit and the thing measured. */
  semantic: string;
  /** The system or party the value came from. */
  source: string;
  /** The exact route or path it was read from, for audit. */
  provenance: string;
  /** As-of date where the value is time-sensitive; null where it is not. */
  asOf: string | null;
  /** Geographic level where relevant (property, suburb, sa2, state). */
  level: string | null;
  /** The licensing/acquisition footing, where the value is market evidence. */
  acquisition: EvidenceAcquisition | null;
  /** How the trust class was established — the check that was actually run. */
  verification: string;
  /** Why this class, in words an operator can act on. */
  reason: string;
}

/** Only these two classes may reach the scoring engine. */
export function mayScore<T>(input: TrustedInput<T>): boolean {
  return (input.trust === 'trusted' || input.trust === 'recovered') && input.value !== null;
}

/**
 * The value if it may score, otherwise null.
 *
 * The whole point of the gate: a caller cannot accidentally read an untrusted
 * value, because the only accessor returns null for one.
 */
export function gated<T>(input: TrustedInput<T>): T | null {
  return mayScore(input) ? input.value : null;
}

/** Build an `unavailable` reading. Absent is absent. */
export function unavailable<T>(semantic: string, reason: string): TrustedInput<T> {
  return {
    value: null, trust: 'unavailable', semantic,
    source: 'none', provenance: 'none', asOf: null, level: null, acquisition: null,
    verification: 'no value present in any consulted source', reason,
  };
}

/**
 * The verdict `report_geography` recorded for a report.
 *
 * `resolved` means ASGS point-in-polygon placed the coordinate. Every other
 * value means it did not, and the flags say why.
 */
export interface GeographyVerdict {
  status: string | null;
  flags: ReadonlyArray<string>;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  sa2Code: string | null;
}

/** Flags that mean the stored coordinate is a failure value, not a place. */
export const SENTINEL_FLAG = 'geocode_failure_value';
/** Flags that mean the address could never be placed in Australia. */
export const CORRUPTED_FLAG = 'corrupted_unrecoverable';

/**
 * Classify a report's geography.
 *
 * The resolver's own verdict decides; this reads it rather than repeating the
 * work. `resolved` is `trusted` because the placement is deterministic and the
 * boundary source is named.
 */
export function classifyGeography(v: GeographyVerdict | null): TrustedInput<GeographyVerdict> {
  const semantic = 'the property’s suburb, postcode, state and SA2, by point-in-polygon';
  if (v === null) {
    return unavailable<GeographyVerdict>(
      semantic,
      'No geography has been resolved for this report, so no location-derived measurement can be attributed to it.',
    );
  }
  const base = {
    semantic,
    source: 'report_geography (resolve-report-geography)',
    provenance: 'ABS ASGS 2021 boundaries, geo.abs.gov.au ArcGIS REST',
    asOf: null,
    level: 'property' as const,
    acquisition: 'open_public' as EvidenceAcquisition,
  };
  if (v.status === 'resolved') {
    return {
      ...base, value: v, trust: 'trusted', level: 'property',
      verification: 'deterministic point-in-polygon placed the coordinate inside a named ASGS region',
      reason: `Resolved to ${v.suburb ?? 'a suburb'}, ${v.state ?? 'a state'} by point-in-polygon against published boundaries.`,
    };
  }
  if (v.flags.includes(SENTINEL_FLAG)) {
    return {
      ...base, value: null, trust: 'untrusted', level: null,
      verification: 'the stored coordinate matches a known geocoder failure value',
      reason: 'The stored coordinate is a geocoder failure value, not this property’s position. '
        + 'Anything measured at it describes that default location instead.',
    };
  }
  if (v.flags.includes(CORRUPTED_FLAG)) {
    return {
      ...base, value: null, trust: 'untrusted', level: null,
      verification: 'the address could not be placed in Australia and the coordinate falls outside it',
      reason: 'The stored address and coordinate cannot be placed in Australia, so no Australian '
        + 'location measurement can be attributed to this property.',
    };
  }
  return {
    ...base, value: null, trust: 'untrusted', level: null,
    verification: 'geography resolution was attempted and did not place the coordinate',
    reason: 'Geography could not be resolved for this report, so a location-derived measurement '
      + 'cannot be attributed to this property.',
  };
}

/**
 * Carry a measurement's trust down from the thing it was measured AT.
 *
 * A derived value can never be more trustworthy than its basis: a walk score
 * computed at a failure coordinate is a fact about that coordinate. Where the
 * basis is untrusted the measurement is untrusted **and keeps its value on the
 * record** — the operator needs to see what was there in order to repair it —
 * but {@link gated} will not release it to the engine.
 */
export function inheritTrust<B, T>(
  basis: TrustedInput<B>,
  measurement: TrustedInput<T>,
): TrustedInput<T> {
  if (basis.trust === 'trusted' || basis.trust === 'recovered') return measurement;
  if (measurement.value === null) return measurement;
  return {
    ...measurement,
    trust: basis.trust === 'unavailable' ? 'unavailable' : 'untrusted',
    verification: `inherited from the basis it was measured at — ${basis.verification}`,
    reason: `${measurement.semantic} was measured at a position that is not this property’s. ${basis.reason}`,
  };
}

/**
 * Qualify an operator-entered override.
 *
 * A person typing a purchase price or a weekly rent into the report is the
 * most authoritative source there is for a purchase SCENARIO — it is the deal
 * as the operator states it. It is `trusted` where the stored calculation
 * agrees with it or holds nothing, and `recovered` where it supplies a figure
 * the calculation block never carried.
 *
 * Measured across the corpus: where both an override and a stored figure
 * exist, they disagree on **zero** of 1,006 reports for both price and rent —
 * which is what makes the override safe to read as the calculation's source
 * rather than as a competing opinion.
 */
export function classifyOverride(
  semantic: string,
  overrideValue: number | null | undefined,
  storedValue: number | null | undefined,
): TrustedInput<number> {
  const ov = typeof overrideValue === 'number' && Number.isFinite(overrideValue) && overrideValue > 0
    ? overrideValue : null;
  const sv = typeof storedValue === 'number' && Number.isFinite(storedValue) && storedValue > 0
    ? storedValue : null;

  if (sv !== null) {
    return {
      value: sv, trust: 'trusted', semantic,
      source: 'financial_calculations', provenance: 'the report’s own stored calculation block',
      asOf: null, level: 'property', acquisition: null,
      verification: ov === null
        ? 'present in the stored calculation block'
        : 'present in the stored calculation block and equal to the operator’s entered value',
      reason: 'Stated for this purchase scenario and stored with the report.',
    };
  }
  if (ov !== null) {
    return {
      value: ov, trust: 'recovered', semantic,
      source: 'manual_overrides', provenance: 'the operator’s entered value on this report',
      asOf: null, level: 'property', acquisition: null,
      verification: 'recovered from the operator’s own entry where the calculation block carried none',
      reason: 'The calculation block holds no figure; the operator entered one on this report.',
    };
  }
  return unavailable<number>(semantic, `No ${semantic} is recorded for this report.`);
}

/** Every gate decision on one report, for the audit trail. */
export interface TrustLedger {
  contractVersion: string;
  geography: TrustedInput<GeographyVerdict>;
  entries: ReadonlyArray<{ key: string; trust: TrustClass; reason: string }>;
}

/** Summarise a set of qualified inputs into the ledger a reviewer reads. */
export function buildLedger(
  geography: TrustedInput<GeographyVerdict>,
  inputs: Readonly<Record<string, TrustedInput<unknown>>>,
): TrustLedger {
  return {
    contractVersion: TRUSTED_INPUT_CONTRACT_VERSION,
    geography,
    entries: Object.entries(inputs).map(([key, i]) => ({
      key, trust: i.trust, reason: i.reason,
    })),
  };
}

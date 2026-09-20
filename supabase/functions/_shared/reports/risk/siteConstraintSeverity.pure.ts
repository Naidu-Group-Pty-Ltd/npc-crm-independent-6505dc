/**
 * The approved conversion from retrieved site constraints to a 0-100 answer.
 *
 * This is the method `riskEvidenceConnection.pure.ts` left a slot for:
 *
 * > Approval has somewhere to land. When a method is approved it is one entry
 * > in `CONVERSIONS`; nothing else in the pipeline changes.
 *
 * Approved 20 September 2026 by the platform owner, against the demonstration
 * in `docs/reports/SCORING_V2_METHODOLOGY.md` §8c. Versioned, so a stored
 * assessment names the basis it was scored on.
 *
 * ## The rule the whole method turns on
 *
 * **A returned designation is a reading; an empty answer is not.**
 *
 * `propertyRiskSchema.pure.ts` recorded that the site controls could not be
 * scored because *"an address-point query is never clearance for a parcel — a
 * layer that misses the point may still cross the lot"*. That is exactly
 * right, and it bites on NEGATIVES alone. A layer that DID intersect the
 * address point has established that the lot is affected: the point is inside
 * the polygon, and no parcel-grain query can make that less true. So a
 * positive finding is scoreable at coordinate grain today, and a completed
 * negative still is not.
 *
 * It is `assessPepEvidence`'s asymmetry, which the schema names as the
 * governing rule: **a HIT is a signal, a MISS is not a clearance.**
 *
 * Two consequences follow and both are enforced below rather than promised:
 *
 * * {@link scoreSiteConstraints} reads `findings` and nothing else. It never
 *   sees a register outcome, so it cannot rate an absence even by mistake.
 * * With no findings it returns **null** — no answer, not a safe one. A site
 *   over which nothing was mapped has not been cleared; it has been asked
 *   about at a point.
 *
 * ## What a score means here
 *
 * **The severity of what the registers returned** — never the completeness of
 * the sweep. Those are two readings and `RiskQuestionCoverage` already carries
 * the second, which is why this one may stay narrow: a report shows the score
 * beside the coverage, and a high score on a thin sweep reads as what it is.
 *
 * ## The basis
 *
 * Severity is keyed on `ConstraintKind` first — the repo's own triage, in
 * `planningConstraints.pure.ts`'s words:
 *
 * > A reader triages by this before anything else: a hazard changes insurance
 * > and construction cost, a control changes what can be built, and a context
 * > reading changes neither but says what the area is FOR.
 *
 * So the ordering is not invented here: a `hazard` outranks a `protection`
 * outranks a `control`, and a `context` reading deducts nothing at all
 * because the publisher's own vocabulary says it changes neither. Family
 * refines kind within that, and every deduction below is stated with what it
 * does to the property rather than with an adjective.
 *
 * **The ordinary development envelope is not an adverse finding.** A maximum
 * building height, a minimum lot size and a floor space ratio are what every
 * suburban lot in the country carries; they bound optionality slightly and
 * they are not a risk. They deduct 6. Getting this wrong in the other
 * direction would score a normal R2 house as constrained, which is the defect
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 names from the opposite side.
 */

import type { ConstraintFamily, ConstraintKind } from '../../planning/planningConstraints.pure.ts';

/** Bumped whenever a deduction, the combination or the rule changes. */
export const SITE_CONSTRAINT_SEVERITY_VERSION = '1.0.0';

/**
 * Points deducted from 100 for ONE returned finding of that family.
 *
 * Each is stated with the obligation or exposure it creates, because a number
 * with no reason beside it is the invented scale this module exists to avoid.
 * Higher is worse; the scale is the answer's own (0-100, higher is safer).
 */
export const FAMILY_DEDUCTION: Readonly<Record<ConstraintFamily, number>> = Object.freeze({
  // ── control: what may be built ───────────────────────────────────────────
  /** Land reserved for public acquisition. The state may compulsorily acquire it. */
  acquisition: 45,
  /** An ANEF/ANEC contour: disclosure, construction attenuation, amenity. */
  airportNoise: 15,
  /** A state significant resource overlay constrains and can override consent. */
  mineralResource: 15,
  /** Caps how many dwellings the land may carry. */
  dwellingDensity: 8,
  /** The ordinary development envelope — every suburban lot carries these. */
  minimumLotSize: 6,
  height: 6,
  floorSpaceRatio: 6,
  design: 5,
  parking: 4,
  developmentContributions: 4,
  infrastructureContribution: 4,

  // ── hazard: insurance, construction cost, physical loss ──────────────────
  /** Insurability and financeability, and the largest single downside here. */
  flood: 35,
  /** BAL-rated construction, insurance loading, evacuation exposure. */
  bushfire: 30,
  /** Geotechnical investigation before any works, and a loss exposure. */
  landslide: 30,
  /** Remediation liability that can exceed the land's value. */
  contamination: 30,
  /** Erosion and inundation, and planned-retreat exposure on a long hold. */
  coastal: 28,
  erosion: 25,
  /** A management plan at excavation. Routine in coastal NSW and QLD. */
  acidSulfateSoils: 12,
  salinity: 10,
  groundwater: 8,

  // ── protection: works constrained to protect something ───────────────────
  /** Alteration and demolition constrained; consent pathway lengthens. */
  heritage: 25,
  biodiversity: 20,
  wetlands: 20,
  environmentallySensitive: 18,
  riparian: 15,
  vegetation: 15,
  drinkingWaterCatchment: 12,
  scenicProtection: 12,
  foreshoreBuildingLine: 12,

  // ── context: says what the area is FOR, and changes neither ──────────────
  regionalPlan: 0,
  growthArea: 0,

  /** A family the vocabulary does not name. Modest, never zero, never large. */
  other: 8,
});

/**
 * A `context` reading deducts nothing, whatever its family says.
 *
 * The publisher's own triage is that it "changes neither" what may be built
 * nor the physical exposure. Deducting for it would score a property for
 * sitting inside a strategic plan.
 */
const NIL_KINDS: ReadonlySet<ConstraintKind> = new Set<ConstraintKind>(['context']);

/** What the method reads. Deliberately only what a register RETURNED. */
export interface SeverityFinding {
  readonly family: ConstraintFamily;
  readonly kind: ConstraintKind;
  readonly label?: string | null;
}

export interface SeverityResult {
  /** 0-100, higher is safer. */
  readonly answer: number;
  /** Version of the basis, for the stored assessment. */
  readonly version: string;
  /** Every finding that contributed, with what it cost, largest first. */
  readonly deductions: ReadonlyArray<{ family: ConstraintFamily; kind: ConstraintKind; points: number; applied: number }>;
  /** One sentence a report may print. */
  readonly basis: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Combine several findings without simply adding them.
 *
 * Sorted worst-first, each subsequent finding applies at half the weight of
 * the one before it. Two reasons, and neither is taste:
 *
 * * **Summing double-counts.** A flood overlay and a riparian overlay on the
 *   same creek frontage describe one situation twice; three ordinary
 *   development standards are one development envelope.
 * * **Summing saturates.** Six routine controls would reach zero and rank a
 *   normal suburban lot with a contaminated flood-prone one, which is the
 *   opposite of discrimination.
 *
 * The worst finding therefore dominates, which is how a purchaser reads a
 * constraint set, and additional findings deepen it without ever running away.
 */
export function combineDeductions(points: readonly number[]): number {
  return [...points]
    .sort((a, b) => b - a)
    .reduce((total, p, i) => total + p * 0.5 ** i, 0);
}

/**
 * Score the constraints a register RETURNED for this site.
 *
 * Returns null where nothing was returned — which is not a safe site, it is an
 * unanswered question. The caller keeps its own refusal for that case.
 */
export function scoreSiteConstraints(
  findings: readonly SeverityFinding[],
): SeverityResult | null {
  if (!findings.length) return null;

  const deductions = findings
    .map((f) => ({
      family: f.family,
      kind: f.kind,
      points: NIL_KINDS.has(f.kind) ? 0 : (FAMILY_DEDUCTION[f.family] ?? FAMILY_DEDUCTION.other),
    }))
    .sort((a, b) => b.points - a.points);

  // Every finding that costs nothing is still reported: a context reading is
  // evidence the register returned, and dropping it would hide a retrieval.
  const scoring = deductions.filter((d) => d.points > 0);
  if (!scoring.length) {
    return {
      answer: 100,
      version: SITE_CONSTRAINT_SEVERITY_VERSION,
      deductions: deductions.map((d) => ({ ...d, applied: 0 })),
      basis:
        `${deductions.length} reading${deductions.length === 1 ? '' : 's'} returned, all of them `
        + 'context that states what the area is for rather than what constrains this land.',
    };
  }

  const combined = combineDeductions(scoring.map((d) => d.points));
  const applied = deductions.map((d) => {
    const rank = scoring.findIndex((s) => s === d);
    return { ...d, applied: rank < 0 ? 0 : Number((d.points * 0.5 ** rank).toFixed(2)) };
  });

  const worst = scoring[0];
  return {
    answer: clamp(Math.round(100 - combined)),
    version: SITE_CONSTRAINT_SEVERITY_VERSION,
    deductions: applied,
    basis:
      `${scoring.length} constraint${scoring.length === 1 ? '' : 's'} returned at this site, led by `
      + `${worst.family} (${worst.kind}). Scored on what the registers returned; it is not a `
      + 'statement about what they did not.',
  };
}

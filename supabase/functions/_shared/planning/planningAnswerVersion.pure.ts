/**
 * What SHAPE of planning answer a cached row holds.
 *
 * ## The defect
 *
 * `planning-data-service` caches its answer for seven days under a key that is
 * the coordinate and nothing else. That is right for the coordinate — a
 * property does not move — and wrong for the ANSWER, because the answer's
 * shape changes when a register is added, and the cache has no way to know.
 *
 * Measured on the two subject rows, 17 September 2026:
 *
 * | | cached at | bytes | `constraints` | `constraintsAsked` | `constraintRegisters` |
 * | --- | --- | ---: | --- | --- | --- |
 * | Kellyville | `2026-09-17T08:58Z` | 4,494 | 2 readings | 21 families | 3 registers answered |
 * | Maryborough | `2026-09-16T23:37Z` | 1,293 | **absent** | **absent** | **absent** |
 *
 * The constraint register shipped between those two runs. Maryborough's row is
 * a complete, `live`, in-date answer from BEFORE it existed — so for seven
 * days every report at that coordinate was served an answer with no overlay,
 * no hazard and no strategic-designation reading in it, while the registers
 * that hold them answer at that exact point.
 *
 * It does not produce a false statement: `buildPlanningFacts` reads
 * `constraintsAsked` to decide what may be called "checked and not mapped",
 * and an absent list produces no such claim. The consequence is
 * UNDER-reporting, which is the safe direction and is still wrong — a report
 * says less than the registers would have told it, and nothing anywhere
 * reports that.
 *
 * ## The rule
 *
 * **A cached answer whose shape predates the code reading it is never
 * served.** The version is part of the cache key, so a deployment that widens
 * the answer simply stops matching the narrow rows: nothing is migrated,
 * nothing is deleted, no row is rewritten, and the old rows age out under the
 * TTL they already have. A miss costs one re-fetch of a free, open-licensed
 * register.
 *
 * Bumping it is a decision, not a side effect — but forgetting to is the
 * failure mode, so `PLANNING_ANSWER_KEYS` records the shape this version
 * stands for and `planningAnswerVersion.spec.ts` reads the service's own
 * answer literal and fails when the two drift.
 */

/**
 * The current answer shape.
 *
 * | version | what it added |
 * | --- | --- |
 * | (none) | zoning, parcel, development instruments, development activity |
 * | `c2` | the constraint register — `constraints`, `constraintsAsked`, `constraintRegisters` (shipped 17 Sep 2026, between the two subject runs above) |
 * | `c3` | the forward investment programme — `investmentProgramme` (shipped 18 Sep 2026). A `c2` row was cached before any programme was read, so serving one would report a property as having no funded investment near it when the programme was never asked. Exactly the fault `c2` exists for. |
 */
export const PLANNING_ANSWER_VERSION = 'c3' as const;

/** Every top-level key the answer of this version carries. */
export const PLANNING_ANSWER_KEYS: readonly string[] = [
  'constraintRegisters',
  'constraints',
  'constraintsAsked',
  'coordinate',
  'developmentActivity',
  'developmentInstruments',
  'fetchedAt',
  'investmentProgramme',
  'jurisdiction',
  'parcel',
  'verification',
  'zoning',
];

/**
 * The cache key for a coordinate, at this answer shape.
 *
 * Six decimal places is ~0.1 m, which is the precision the service has always
 * keyed on; it is kept exactly so a version bump is the only thing that
 * changes about a key.
 */
export function planningCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}@${PLANNING_ANSWER_VERSION}`;
}

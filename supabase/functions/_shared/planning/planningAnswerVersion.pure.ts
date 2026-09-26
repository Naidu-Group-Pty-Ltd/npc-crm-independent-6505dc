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
 * | `c4` | the instrument's own land use table — `landUse` (shipped 19 Sep 2026). A `c3` row carries a zone code and nothing that says what may be built on it, and a zone code alone is what lets "E3 Productivity Support" be read as a residential property in the wrong zone when the table in fact permits a dwelling house with consent. Serving a `c3` row would withhold the reading the section is now written around. |
 * | `c5` | which instrument the controls belong to and which amendment of it — `instrumentCurrency` — plus `providers`, the record of which registers were consulted and which ANSWERED (shipped 22 Sep 2026, W3.4). The amendment was being parsed off layer 8 of the NSW principal Identify and handed to `console.log`, so every `c4` row carries the register's Instrument column with no statement of which amendment is in force. Serving one under-reports in exactly the direction `c2` was written for, and a stale `providers` would report a refinement as unanswered on a deployment where it answers. |
 * | `c6` | South Australia's zone, read from the Planning and Design Code's own layer (`parseSaZoning`, shipped 23 Sep 2026, W3.4's third half). No key is added — `zoning` has always been there — but a `c5` row at a South Australian coordinate says the zone is `not_integrated` where the Code's layer now answers, so serving one withholds the zone for seven days on exactly the properties this adds it for. The shape did not widen; its CONTENT did, which is the same fault by another route. |
 * | `c7` | Western Australia's designated bush fire prone areas, read from the Fire and Emergency Services Commissioner's own layer (OBRM-026, CC BY 4.0, shipped 25 Sep 2026). No key is added, but a `c6` row at a Western Australian coordinate carries no constraint register at all, so serving one would print "Bushfire — Not searched" for seven days over a register that now answers. The same fault as `c6`, one state along. |
 */
export const PLANNING_ANSWER_VERSION = 'c7' as const;

/** Every top-level key the answer of this version carries. */
export const PLANNING_ANSWER_KEYS: readonly string[] = [
  'constraintRegisters',
  'constraints',
  'constraintsAsked',
  'coordinate',
  'developmentActivity',
  'developmentInstruments',
  'fetchedAt',
  'instrumentCurrency',
  'investmentProgramme',
  'jurisdiction',
  'landUse',
  'parcel',
  'providers',
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

/**
 * One distance per school, so the narrative and the record cannot disagree.
 *
 * ## The defect this exists to end
 *
 * Measured 2026-09-07 on `28 Bligh Street, Muswellbrook NSW 2333` (5 Sep,
 * compass-40), the document a client receives says:
 *
 * > The closest listed primary catchment is **Muswellbrook Public School at
 * > 0.29 km**, and a nearby independent option, **Pacific Brook Christian
 * > School, is 0.46 km away**.
 *
 * The report's own stored `location_intelligence.schools.topSchools` holds
 * **0.21** and **0.42** for the same two schools.
 *
 * Neither figure is the model inventing one. **Two services compute the same
 * quantity and both reach the report**: `school-data-service` measures its own
 * distances and is interpolated into the prompt, while
 * `location-intelligence-service` measures them separately into
 * `location_intelligence`, which is what is stored, projected and rendered. The
 * model quotes the first; every downstream surface reads the second.
 *
 * ## The rule
 *
 * The **stored** figure is the authority, because it is the one the record
 * keeps and every other surface reads. Where both sources name the same school,
 * the prompt is given the stored distance so the prose it writes matches the
 * record. Where only the prompt's source knows a school, its own distance
 * stands — dropping the school would lose real information, and this is a
 * reconciliation rather than a filter.
 *
 * Nothing here judges which service measures better. That is a separate
 * question about two implementations of a great-circle distance; this one is
 * only that a document must not state a figure its own record contradicts.
 *
 * Names are matched case- and punctuation-insensitively because the two
 * services take them from the same place and differ only in spacing and
 * apostrophes (`St Joseph's` / `St Josephs`).
 */

/** A school as either service describes it. Only `name` is relied upon. */
export interface SchoolLike {
  name?: unknown;
  distance?: unknown;
  [key: string]: unknown;
}

/** `st josephs primary` — enough to match the same school across two services. */
export function schoolKey(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    // Apostrophes are REMOVED, not turned into a separator — otherwise
    // `St Joseph's` keys as `st joseph s` and never matches `St Josephs`,
    // which is the one spelling difference these two services actually
    // produce. Straight and curly both, because they mix.
    .replace(/['\u2018\u2019\u02BC]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const distanceOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The prompt's schools, with every distance the record also knows replaced by
 * the record's.
 *
 * Returns a new array; the inputs are not mutated. A school the record does not
 * name keeps the distance it arrived with.
 */
export function reconcileSchoolDistances<T extends SchoolLike>(
  promptSchools: readonly T[] | null | undefined,
  storedSchools: readonly SchoolLike[] | null | undefined,
): T[] {
  const list = Array.isArray(promptSchools) ? promptSchools : [];
  if (!Array.isArray(storedSchools) || storedSchools.length === 0) return [...list];

  const stored = new Map<string, number>();
  for (const s of storedSchools) {
    const key = schoolKey(s?.name);
    const d = distanceOf(s?.distance);
    if (key && d !== null && !stored.has(key)) stored.set(key, d);
  }
  if (stored.size === 0) return [...list];

  return list.map((school) => {
    const authoritative = stored.get(schoolKey(school?.name));
    return authoritative === undefined || distanceOf(school?.distance) === authoritative
      ? school
      : { ...school, distance: authoritative };
  });
}

/**
 * The nearest school, reconciled the same way.
 *
 * Separate because the prompt states it on its own line above the table, and a
 * heading that disagreed with the table under it would be the same defect one
 * level smaller.
 */
export function reconcileNearestSchool<T extends SchoolLike>(
  promptNearest: T | null | undefined,
  storedSchools: readonly SchoolLike[] | null | undefined,
): T | null | undefined {
  if (!promptNearest) return promptNearest;
  const [reconciled] = reconcileSchoolDistances([promptNearest], storedSchools);
  return reconciled;
}

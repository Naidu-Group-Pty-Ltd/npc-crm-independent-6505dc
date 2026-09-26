/**
 * The subject facts a caller supplied, as the row keeps them — and when.
 *
 * A report is written over many invocations. The FIRST carries what the
 * caller extracted — a listing scrape, a parsed PDF, the form — in
 * `propertyDetails`; every later one is a continuation that carries a report
 * id and nothing else, and reads the subject back from the row's
 * `manual_overrides`. The facts were written to `manual_overrides` only in
 * the FINAL write — and the final write is itself a continuation, with no
 * `propertyDetails` to write from — so a Compass report generated from a
 * listing never persisted them at all.
 *
 * Measured 24 Sep 2026 on report 79d677d6 (93 Schofields Farm Road, from a
 * realestate.com.au listing): the first invocation had 4 bedrooms, 2
 * bathrooms, 401 m² and a house, and wrote sections 1-5 from them; the
 * eleven continuations had none, so sections 6-16 were written saying the
 * bedroom and bathroom counts were not held, the scoring service was sent
 * the modelling default of 3 bedrooms, and Compass QA failed the document
 * twice with `attribute-asserted-and-withheld`. Report de783a4b (a one-bedroom
 * APARTMENT, from a listing) lost its property type the same way.
 *
 * The rule: the facts are banked by the invocation that has them, before the
 * first section is written, under the same precedence the final write always
 * used — what the caller extracted is the floor, and anything the row or the
 * operator already holds wins.
 */

/** A caller's facts, under the names `manual_overrides` uses. Only real values travel. */
export function extractedSubjectOverrides(details: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!details || typeof details !== 'object') return out;
  const d = details as Record<string, unknown>;
  const put = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '' || value === 0) return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    out[key] = value;
  };
  put('purchasePrice', d.price);
  put('weeklyRent', d.weeklyRent);
  put('landSizeSqm', d.landSizeSqm);
  put('buildSizeSqm', d.buildSizeSqm);
  put('landPrice', d.landPrice);
  put('buildPrice', d.buildPrice);
  put('bedrooms', d.beds);
  put('bathrooms', d.baths);
  put('carSpaces', d.carSpaces);
  // A continuation reads the type from here (`sourcePropertyType`), and the
  // final write never carried it: an apartment became an unclassified
  // property from the second invocation on.
  put('propertyType', typeof d.propertyType === 'string' ? d.propertyType.trim() : d.propertyType);
  if (typeof d.isNewBuild === 'boolean') out.isNewBuild = d.isNewBuild;
  put('buildType', d.buildType);
  return out;
}

/**
 * The `manual_overrides` to write so a continuation can read the subject, or
 * null where nothing would change. Extracted facts are the floor; every key
 * the row or the operator already holds keeps its value.
 */
export function overridesWithSubjectFacts(
  extracted: Record<string, unknown>,
  held: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const current = held && typeof held === 'object' ? held : {};
  const missing = Object.keys(extracted).filter((key) => current[key] === undefined || current[key] === null || current[key] === '');
  if (!missing.length) return null;
  return { ...extracted, ...current };
}

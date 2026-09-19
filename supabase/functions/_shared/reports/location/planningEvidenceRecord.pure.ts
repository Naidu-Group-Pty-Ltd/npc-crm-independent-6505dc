/**
 * The planning and development evidence a report was shown, kept on the row.
 *
 * ## What was missing
 *
 * `planning-data-service` has answered since 2026-09-06, the generator stores
 * its answer on `enhancedData.planningData`, and `buildPlanningFacts` /
 * `buildInfrastructureEvidence` turn it into the two tables a client's
 * document carries. **None of it was ever persisted.** Measured on both
 * subject rows in production on 17 September 2026: `investment_reports` has no
 * `enhanced_data` column, and the final save writes `report_content`,
 * `sources_content`, `demographics_data`, `economic_data`,
 * `financial_calculations`, `investment_score`, `location_intelligence`,
 * `market_fact_snapshot`, `property_specs`, `validation_flags`,
 * `data_sources`, `report_scope`, `generation_engine` and `status` — and the
 * planning evidence is in none of them.
 *
 * `data_sources.planning` carries the zoning HEADLINE (jurisdiction, council,
 * zone, licence, currency date) and nothing else, so the constraint register,
 * the per-control provenance and every development the DA register named
 * existed only as prose inside `report_content`. Nothing downstream — no
 * projection, no template binding, no regeneration, no fork — could read a
 * single one of them, and a later reader had no way to check a sentence
 * against the evidence it was written from. That is the shape of the defect
 * S2 traced for the location readings: obtained in full, and not carried into
 * the saved record.
 *
 * ## Where it goes, and why there
 *
 * Beside the location readings, under two keys of its own. It is the same
 * kind of fact — what the registers said about this location, frozen at
 * generation — and `location_intelligence` already carries a non-amenity key
 * (`__acquisition`), so the object is a record about a place rather than a
 * pure amenity blob. It needs no new column, which means no migration stands
 * between the evidence and the row it belongs to.
 *
 * Three rules.
 *
 * **Nothing here is derived.** The two objects are stored exactly as the
 * renderers were handed them, so a stored report and its document cannot
 * disagree about what was retrieved.
 *
 * **It never touches the enrichment's own reuse.** `assessEnrichmentReuse`
 * reads `__acquisition` and refuses anything without it, so these keys are
 * inert to it — and they are composed at the SAVE rather than written into
 * `enhancedData.locationIntelligence`, so a reused enrichment can never carry
 * a previous run's planning with it.
 *
 * **Absent is absent.** A run with no planning evidence stores none and
 * returns the object it was given, unchanged and identical by reference, so
 * every row written before this and every report on a property with no
 * coordinate is byte-identical to what it is today.
 */

/** Where the planning facts sit on the persisted location record. */
export const PLANNING_EVIDENCE_KEY = 'planning' as const;
/** Where the development and infrastructure evidence sits. */
export const INFRASTRUCTURE_EVIDENCE_KEY = 'infrastructure' as const;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Is there anything worth recording?
 *
 * An evidence object is always produced — `buildPlanningFacts` answers with a
 * full set of named absences when nothing was retrieved — so "not null" is not
 * the question. The question is whether a register answered at all, because
 * storing a page of "unavailable" cells against a property that has no
 * coordinate records a lookup nobody made.
 */
function worthRecording(facts: unknown, infrastructure: unknown): boolean {
  const anyStated = isRecord(facts) && facts.anyStated === true;
  const anyEvidenced = isRecord(infrastructure) && infrastructure.anyEvidenced === true;
  const enrichmentRan = isRecord(infrastructure) && infrastructure.enrichmentMissing === false;
  return anyStated || anyEvidenced || enrichmentRan;
}

/**
 * The location record with the planning evidence recorded beside it.
 *
 * Returns the input unchanged — the same reference — when there is nothing to
 * record, so a caller can hand the result straight to the save without
 * branching and without changing a single existing row's shape.
 */
export function withPlanningEvidence(
  locationIntelligence: unknown,
  facts: unknown,
  infrastructure: unknown,
): unknown {
  if (!worthRecording(facts, infrastructure)) return locationIntelligence;
  const base = isRecord(locationIntelligence) ? locationIntelligence : {};
  return {
    ...base,
    [PLANNING_EVIDENCE_KEY]: facts ?? null,
    [INFRASTRUCTURE_EVIDENCE_KEY]: infrastructure ?? null,
  };
}

/** The planning facts a stored row carries, or null. The one reader. */
export function planningEvidenceFrom(locationIntelligence: unknown): unknown | null {
  return isRecord(locationIntelligence) ? locationIntelligence[PLANNING_EVIDENCE_KEY] ?? null : null;
}

/** The infrastructure evidence a stored row carries, or null. */
export function infrastructureEvidenceFrom(locationIntelligence: unknown): unknown | null {
  return isRecord(locationIntelligence) ? locationIntelligence[INFRASTRUCTURE_EVIDENCE_KEY] ?? null : null;
}

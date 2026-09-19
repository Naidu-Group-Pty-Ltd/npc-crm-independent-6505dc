/**
 * May this deployment seed its own Market News Feed source registry?
 *
 * ## The defect this exists for
 *
 * `market_sources` is reference data that migrations INSERT. A clone is
 * provisioned by copying the schema and the migration LEDGER, and the rows
 * those migrations insert do not travel with it. Measured 19 Sep 2026 on the
 * clone `plisdzywzleljorrphxv`: all seven seeding migrations recorded as
 * applied, `market_sources` holding **0 rows**, and 310 ingestion runs having
 * produced nothing at all. The same is true of the other two clones.
 *
 * `market-updates-ingest` answers that correctly — 422, "the source registry
 * has not been seeded in this environment" — and there is nothing an operator
 * can do about it from inside the product. Re-running the migration needs
 * database credentials a tenant does not have, and every clone provisioned
 * after this one starts in the same state.
 *
 * Rows do not reach a clone. **Code does** — the clone runs all 440 of this
 * repository's edge functions. So the registry ships as code
 * (`canonicalRegistry.generated.ts`) and a deployment with nothing to ingest
 * from fills its own registry once, from the manifest, and gets on with it.
 *
 * ## The rules
 *
 * **Only an EMPTY registry may be seeded.** Not "no enabled sources", not
 * "none currently ingestable" — empty. A deployment whose sources are all
 * switched off is an operator's decision, and re-inserting rows they disabled
 * would be this product overruling them; a deployment that has never had any
 * is a provisioning gap with no owner. The two look similar in a count and
 * are opposite in meaning, so the line is drawn where it cannot be confused.
 *
 * **Seeding is additive and never destructive.** Rows are inserted on conflict
 * do nothing, keyed by `source_key`. Nothing is updated, nothing is deleted,
 * and no existing configuration is read or rewritten — so a partially
 * populated registry (which this refuses to seed anyway) could not be damaged
 * even if the guard above were wrong.
 *
 * **It never fails the act it accompanies.** A seed that cannot be written
 * leaves the ingestion reporting the condition it already had. The operator
 * reads "the registry has not been seeded", which remains true, rather than a
 * second and more confusing failure about the repair.
 *
 * **What it did is recorded**, so a reader can tell a self-seeded registry
 * from a migrated one, and so the act is auditable rather than mysterious.
 *
 * Pure + deterministic + JSON-safe: no Deno, no network, no clocks.
 */
import {
  CANONICAL_MARKET_SOURCES,
  type CanonicalMarketSource,
} from './canonicalRegistry.generated.ts';

export type RegistrySeedDecision =
  | { seed: true; reason: 'registry_empty'; sources: readonly CanonicalMarketSource[] }
  | { seed: false; reason: 'has_sources' }
  | { seed: false; reason: 'nothing_to_seed' };

export interface RegistryCounts {
  /** Rows in `market_sources`, whatever their status. */
  total: number;
}

/**
 * The decision, from the one count that can distinguish the two cases.
 *
 * Deliberately NOT given the canonical or enabled counts: a narrower input is
 * a narrower mistake, and the only state this may act on is "there is nothing
 * here at all".
 */
export function decideRegistrySeed(counts: RegistryCounts): RegistrySeedDecision {
  if (!Number.isFinite(counts.total) || counts.total > 0) {
    return { seed: false, reason: 'has_sources' };
  }
  if (CANONICAL_MARKET_SOURCES.length === 0) {
    return { seed: false, reason: 'nothing_to_seed' };
  }
  return { seed: true, reason: 'registry_empty', sources: CANONICAL_MARKET_SOURCES };
}

/**
 * One manifest entry as a `market_sources` row.
 *
 * The column list mirrors what the seeding migrations write. `enabled` and
 * `registry_status` come from the manifest because they are properties of the
 * source as its defining migration left it, not defaults invented here.
 */
export function seedRowFor(source: CanonicalMarketSource): Record<string, unknown> {
  return {
    source_key: source.source_key,
    name: source.name,
    description: source.description,
    source_type: source.adapter_type,
    url: source.primary_url,
    adapter_type: source.adapter_type,
    primary_url: source.primary_url,
    feed_urls: source.feed_urls,
    listing_urls: source.listing_urls,
    source_authority: source.source_authority,
    reliability_tier: source.reliability_tier,
    default_segments: source.default_segments,
    category: source.category,
    geography: 'Australia',
    refresh_frequency_minutes: source.refresh_frequency_minutes,
    refresh_frequency_hours: Math.max(1, Math.ceil(source.refresh_frequency_minutes / 60)),
    copyright_mode: source.copyright_mode,
    perspective: source.perspective,
    adapter_config: source.adapter_config,
    extraction_policy: { metadata_only: true, full_article: false },
    enabled: source.enabled,
    registry_status: source.registry_status,
    legal_storage_policy: 'metadata_excerpt_transformative_summary',
    health_status: 'healthy',
    /*
      `ingest_mode` is what the ingest query filters on, and a BEFORE INSERT
      trigger (`market_sources_sync_ingest_mode`) derives `enabled` back from
      it — so this field decides both, and `enabled` above is only the input
      to it.
    
      The mapping is the trigger's OWN rule for a row that names no mode:
      `enabled ? 'live' : 'disabled'`. Writing `'shadow'` for a disabled source
      would be a different thing entirely — shadow sources ARE fetched and
      classified on every run, they simply never publish. The four sources the
      migrations disabled are paywalled or unreachable (AFR, Bloomberg, ASIC's
      newsroom, NAB economics), so shadowing them would spend a request per
      source per run, for ever, on pages known not to answer.
    */
    ingest_mode: source.enabled ? 'live' : 'disabled',
  };
}

export function seedRows(
  sources: readonly CanonicalMarketSource[] = CANONICAL_MARKET_SOURCES,
): Array<Record<string, unknown>> {
  return sources.map(seedRowFor);
}

/** What to say about a seed that ran, for the run record and the operator. */
export function describeSeed(inserted: number, attempted: number): string {
  if (inserted === 0) {
    return `The source registry was empty and could not be filled from the built-in `
      + `catalogue of ${attempted} sources.`;
  }
  return `The source registry was empty and has been filled from the built-in `
    + `catalogue: ${inserted} of ${attempted} sources added.`;
}

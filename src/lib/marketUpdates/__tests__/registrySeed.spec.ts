/**
 * A deployment with an empty source registry may fill it; one whose sources an
 * operator switched off may not.
 *
 * Measured 19 Sep 2026 across all three clones: every seeding migration
 * recorded as applied, `market_sources` holding zero rows, hundreds of
 * ingestion runs behind them having produced nothing. Clone provisioning
 * copies the schema and the migration ledger; the rows those migrations INSERT
 * do not travel.
 */
import { describe, expect, it } from 'vitest';

import {
  CANONICAL_MARKET_SOURCES,
  CANONICAL_MARKET_SOURCE_COUNT,
} from '../../../../supabase/functions/_shared/marketSources/canonicalRegistry.generated';
import {
  decideRegistrySeed,
  describeSeed,
  seedRowFor,
  seedRows,
} from '../../../../supabase/functions/_shared/marketSources/registrySeed.pure';

describe('decideRegistrySeed', () => {
  it('seeds a registry that has never had a row', () => {
    const decision = decideRegistrySeed({ total: 0 });
    expect(decision.seed).toBe(true);
    expect(decision.reason).toBe('registry_empty');
  });

  it('never touches a deployment that already has sources', () => {
    // The prime's registry is the live production one. Nothing here may write
    // to it, and "has sources" is the only guard that matters.
    for (const total of [1, 20, 43, 500]) {
      expect(decideRegistrySeed({ total }).seed, `total=${total}`).toBe(false);
    }
  });

  it('never resurrects sources an operator disabled', () => {
    // A registry with rows is a registry somebody has decided about, whatever
    // their enablement. Re-inserting there would be the product overruling an
    // operator, which is why the decision is given only the total.
    expect(decideRegistrySeed({ total: 43 }).reason).toBe('has_sources');
  });

  it('refuses a count it cannot read rather than seeding on a guess', () => {
    expect(decideRegistrySeed({ total: Number.NaN }).seed).toBe(false);
  });
});

describe('the shipped catalogue', () => {
  it('carries the sources the migrations define', () => {
    expect(CANONICAL_MARKET_SOURCES.length).toBe(CANONICAL_MARKET_SOURCE_COUNT);
    expect(CANONICAL_MARKET_SOURCE_COUNT).toBeGreaterThan(30);
  });

  it('gives every source the fields an adapter needs', () => {
    for (const s of CANONICAL_MARKET_SOURCES) {
      expect(s.source_key, 'source_key').toBeTruthy();
      expect(s.name, `${s.source_key} name`).toBeTruthy();
      expect(s.adapter_type, `${s.source_key} adapter_type`).toBeTruthy();
      expect(s.primary_url, `${s.source_key} primary_url`).toMatch(/^https?:\/\//);
      expect(Array.isArray(s.feed_urls), `${s.source_key} feed_urls`).toBe(true);
      expect(Array.isArray(s.listing_urls), `${s.source_key} listing_urls`).toBe(true);
      expect(Array.isArray(s.default_segments), `${s.source_key} segments`).toBe(true);
      expect(s.refresh_frequency_minutes, `${s.source_key} cadence`).toBeGreaterThan(0);
    }
  });

  it('names every source exactly once', () => {
    const keys = CANONICAL_MARKET_SOURCES.map((s) => s.source_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('seedRowFor', () => {
  it('makes a row the ingest query can actually find', () => {
    // The ingest reads `registry_status = 'canonical'` AND
    // `ingest_mode in ('live','shadow')`. A seeded row that misses either is a
    // row that was written and can never be ingested from.
    for (const source of CANONICAL_MARKET_SOURCES) {
      const row = seedRowFor(source);
      expect(row.registry_status, source.source_key).toBe('canonical');
      // An enabled source must land in the set the ingest query reads.
      if (source.enabled) expect(row.ingest_mode, source.source_key).toBe('live');
    }
  });

  it('carries the enablement the defining migration gave it', () => {
    const disabled = CANONICAL_MARKET_SOURCES.find((s) => !s.enabled);
    expect(disabled, 'the catalogue should carry at least one disabled source').toBeTruthy();
    const row = seedRowFor(disabled!);
    expect(row.enabled).toBe(false);
    /*
      'disabled', not 'shadow'. A BEFORE INSERT trigger derives `enabled` from
      `ingest_mode`, and its own rule for a row naming no mode is
      `enabled ? 'live' : 'disabled'` — so this reproduces what the migration
      would have produced. Shadow is not the same thing: a shadow source IS
      fetched and classified every run and merely never publishes, and these
      four are paywalled or unreachable, so shadowing them would spend a
      request per source per run for ever on pages known not to answer.
    */
    expect(row.ingest_mode).toBe('disabled');
  });

  it('derives the hourly cadence from the minute one rather than inventing it', () => {
    const row = seedRowFor({ ...CANONICAL_MARKET_SOURCES[0], refresh_frequency_minutes: 90 });
    expect(row.refresh_frequency_hours).toBe(2);
    const fast = seedRowFor({ ...CANONICAL_MARKET_SOURCES[0], refresh_frequency_minutes: 15 });
    expect(fast.refresh_frequency_hours).toBe(1);
  });

  it('produces one row per catalogue entry', () => {
    expect(seedRows().length).toBe(CANONICAL_MARKET_SOURCE_COUNT);
  });

  it('keeps every cadence inside the column\'s CHECK', () => {
    // `market_sources_refresh_frequency_minutes_check` is
    // `between 15 and 10080`. One row outside it fails the whole insert, and
    // the seeder writes all 43 in a single statement.
    for (const source of CANONICAL_MARKET_SOURCES) {
      const minutes = seedRowFor(source).refresh_frequency_minutes as number;
      expect(minutes, source.source_key).toBeGreaterThanOrEqual(15);
      expect(minutes, source.source_key).toBeLessThanOrEqual(10080);
    }
  });

  it('writes only values the column CHECKs accept', () => {
    // Every one of these is a constraint a single bad row would fail the whole
    // 43-row insert on, silently, into a catch that logs and carries on.
    for (const source of CANONICAL_MARKET_SOURCES) {
      const row = seedRowFor(source);
      expect(['live', 'shadow', 'disabled'], source.source_key).toContain(row.ingest_mode);
      expect(['canonical', 'archived_legacy', 'unresolved_legacy'], source.source_key)
        .toContain(row.registry_status);
      expect(['healthy', 'degraded', 'failed', 'disabled'], source.source_key)
        .toContain(row.health_status);
      expect([
        'link_metadata_only',
        'metadata_excerpt_transformative_summary',
        'licensed_metadata_excerpt_transformative_summary',
      ], source.source_key).toContain(row.legal_storage_policy);
    }
  });
});

describe('describeSeed', () => {
  it('says what was added', () => {
    expect(describeSeed(43, 43)).toMatch(/43 of 43 sources added/);
  });

  it('never claims a repair that added nothing', () => {
    expect(describeSeed(0, 43)).toMatch(/could not be filled/i);
  });
});

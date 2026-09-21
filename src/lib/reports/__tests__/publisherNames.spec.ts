/**
 * A database key is never the name of a publisher.
 *
 * Page 36 of the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026 printed, in the column headed *Where it is published*:
 *
 *   | The market's median sale price and its growth | vic_vpsr_suburb | … |
 *   | The one-year growth rate                      | vic_vpsr_suburb | … |
 *
 * directly beside a row that reads "Vicmap Planning — plan_zone
 * (opendata.maps.vic.gov.au WFS)" and gets it right.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { providerName } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';

const UNION_SOURCE = 'supabase/functions/_shared/reports/market/marketEvidence.pure.ts';

/**
 * Every member of `EvidenceProvider`, read out of the type itself.
 *
 * There is no runtime list to import, and writing one here would be a second
 * copy that drifts — the same reason the router's CI test reads the router's
 * source rather than a list beside it.
 */
function providersInTheUnion(): string[] {
  const src = readFileSync(UNION_SOURCE, 'utf8');
  const at = src.indexOf('export type EvidenceProvider =');
  expect(at).toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf(';', at));
  return [...new Set([...body.matchAll(/\|\s*'([a-z0-9_]+)'/g)].map((m) => m[1]))];
}

/** `vic_vpsr_suburb` — an identifier, not a name. */
const LOOKS_LIKE_A_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

describe('every provider has a name a reader can use', () => {
  const providers = providersInTheUnion();

  it('reads a real union', () => {
    expect(providers.length).toBeGreaterThanOrEqual(14);
    // The two that shipped without one.
    expect(providers).toContain('vic_vpsr_suburb');
    expect(providers).toContain('sa_lsg_suburb');
  });

  it.each(providersInTheUnion())('%s renders as a name, never as the key', (p) => {
    const name = providerName(p as never);
    expect(name).not.toBe(p);
    expect(name).not.toMatch(LOOKS_LIKE_A_KEY);
    expect(name).not.toContain('_');
    expect(name.length).toBeGreaterThan(3);
  });

  it('names the two archived suburb series after their publishers', () => {
    expect(providerName('vic_vpsr_suburb' as never)).toContain('Valuer-General');
    expect(providerName('sa_lsg_suburb' as never)).toContain('Land Services SA');
  });
});

describe('the fallback names the absence rather than the key', () => {
  it('never prints an identifier it was not given a name for', () => {
    // A provider read back from the database is a string, not the union, so
    // the runtime guard has to hold even though the compiler now refuses a
    // missing entry at the call site.
    expect(providerName('some_new_registry' as never)).toBe('Publisher not recorded');
    expect(providerName('' as never)).toBe('Publisher not recorded');
  });

  it('passes through something that is already a name', () => {
    expect(providerName('Bendigo Council' as never)).toBe('Bendigo Council');
  });
});

/*
 * The same defect, one module over.
 *
 * Page 35 of the same document printed, under "What each dimension rested on":
 *
 *   Demand. transactionVolume: 76 sales in Golden Square, VIC, 37% above the
 *           3-period average of 56. Population growth: 0.4% annual …
 *
 * Every other bullet names its measure in words. Demand alone printed a
 * camelCase key, because `COMPONENT_LABELS[key] ?? key` fell back to the
 * identifier and `transactionVolume` — the PRIMARY demand measure — was never
 * added, so every report that scores Demand has printed it.
 */
describe('a scored component is named in words, or not named at all', () => {
  const SCORERS = [
    'supabase/functions/_shared/reports/market/growthScoring.pure.ts',
    'supabase/functions/_shared/reports/market/demandScoring.pure.ts',
  ];

  /** Every `key: '…'` a scorer can emit on a component, read from its source. */
  const componentKeys = (): string[] => {
    const keys = new Set<string>();
    for (const f of SCORERS) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bkey:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) keys.add(m[1]);
    }
    return [...keys];
  };

  const IS_AN_IDENTIFIER = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;

  it('finds the keys it is meant to judge', () => {
    const keys = componentKeys();
    expect(keys).toContain('transactionVolume');
    expect(keys).toContain('populationDriver');
    expect(keys).toContain('longTerm');
  });

  /*
   * The scan is deliberately broader than the components this renderer reads —
   * it also picks up the confidence factors (`geography`, `sample`, `history`,
   * `freshness`), which are single English words and perfectly good labels.
   * The property being asserted is the one that matters and the one that
   * failed: a camelCase FIELD NAME is either given a name or dropped, never
   * printed.
   */
  it.each(componentKeys())('%s never renders as a camelCase field name', async (key) => {
    const { labelOfComponent } = await import(
      '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure'
    );
    const label = labelOfComponent(key);
    expect(label === null || !IS_AN_IDENTIFIER.test(label)).toBe(true);
    if (IS_AN_IDENTIFIER.test(key)) expect(label).not.toBe(key);
  });

  it('names the primary demand measure rather than dropping it', async () => {
    const { labelOfComponent } = await import(
      '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure'
    );
    // `DEMAND_PRIMARY`'s transaction volume is the one measure this deployment
    // is entitled to score Demand on, so it is named rather than left unlabelled.
    expect(labelOfComponent('transactionVolume')).toBe('Sales volume');
  });

  it('drops the label for a component this build has no name for', async () => {
    const { labelOfComponent } = await import(
      '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure'
    );
    expect(labelOfComponent('someNewSignal')).toBeNull();
    // …and passes through something that is already a phrase.
    expect(labelOfComponent('Auction clearance')).toBe('Auction clearance');
  });
});

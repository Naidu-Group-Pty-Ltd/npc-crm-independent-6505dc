import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decideProvider } from '../../../supabase/functions/_shared/aml/providerEnvironment.ts';

/**
 * Identity verification runs live or not at all.
 *
 * Production sat with an **active** selfhosted IDV provider in simulator mode.
 * The configuration screen read as configured; every request refused to
 * execute it, because production must never run the deterministic simulator;
 * and the customer was told electronic verification was unavailable. Nothing
 * reconciled the three.
 */

describe('production never executes a simulator for identity verification', () => {
  it('refuses a real provider left in simulator mode', () => {
    const d = decideProvider({
      environment: 'production', providerKey: 'selfhosted', mode: 'simulator',
      adapterWired: true, adapterConfigured: true,
    });
    expect(d.kind).toBe('refuse');
    expect(d.kind === 'refuse' && d.message).toMatch(/still in simulator mode/i);
    // The refusal must name what to do, and must say nothing was recorded
    // against the customer.
    expect(d.kind === 'refuse' && d.message).toMatch(/no verification attempt was recorded/i);
  });

  it('refuses when nothing is configured at all', () => {
    const d = decideProvider({
      environment: 'production', providerKey: 'simulator', mode: 'simulator',
      adapterWired: false, adapterConfigured: false,
    });
    expect(d.kind === 'refuse' && d.code).toBe('provider_not_configured');
  });

  it('never returns a simulator decision in production, whatever the inputs', () => {
    for (const providerKey of ['selfhosted', 'simulator', 'anything']) {
      for (const mode of ['simulator', 'live'] as const) {
        for (const wired of [true, false]) {
          for (const configured of [true, false]) {
            const d = decideProvider({
              environment: 'production', providerKey, mode,
              adapterWired: wired, adapterConfigured: configured,
            });
            expect(d.kind, `${providerKey}/${mode}/${wired}/${configured}`).not.toBe('simulator');
          }
        }
      }
    }
  });

  it('still allows the simulator outside production, where it is the safe default', () => {
    for (const environment of ['test', 'local', 'staging'] as const) {
      expect(decideProvider({
        environment, providerKey: 'selfhosted', mode: 'simulator',
        adapterWired: true, adapterConfigured: true,
      }).kind).toBe('simulator');
    }
  });

  it('goes live only when the adapter is wired and configured', () => {
    expect(decideProvider({
      environment: 'production', providerKey: 'selfhosted', mode: 'live',
      adapterWired: true, adapterConfigured: true,
    })).toEqual({ kind: 'live' });
  });
});

describe('an IDV provider cannot be active in simulator mode', () => {
  const migration = readFileSync(
    'supabase/migrations/20260807000000_no_simulator_idv_in_production.sql', 'utf8');

  it('deactivates any active simulator IDV row', () => {
    expect(migration).toMatch(/UPDATE aml\.provider_configs[\s\S]*SET active = false/);
    expect(migration).toContain("capability = 'idv'");
    expect(migration).toContain("mode = 'simulator'");
  });

  it('leaves screening alone — its simulator is not on the identity path', () => {
    // Comments name it for context; no statement may touch it.
    const statements = migration.split('\n')
      .filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(statements).not.toContain('pep_sanctions');
    expect(statements).not.toContain('local_lists');
  });

  it('enforces it going forward with a trigger', () => {
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON aml.provider_configs');
    expect(migration).toMatch(/RAISE EXCEPTION/);
  });

  it('carries a rollback', () => {
    expect(migration).toContain('-- ROLLBACK:');
  });

  it('no longer seeds an active simulator IDV provider', () => {
    const seed = readFileSync(
      'supabase/migrations/20260802120000_seed_selfhosted_kyc_providers.sql', 'utf8');
    const idvBlock = seed.slice(0, seed.indexOf("'pep_sanctions'"));
    expect(idvBlock).toContain('false,');
  });
});

describe('the configuration screen offers no simulator for identity verification', () => {
  const page = readFileSync('src/pages/aml/AmlConfiguration.tsx', 'utf8');

  it('hides the simulator mode option for idv', () => {
    expect(page).toContain('form.capability !== "idv"');
  });

  it('defaults a new idv provider to live', () => {
    expect(page).toMatch(/capability: "idv"[\s\S]{0,200}?mode: "live"/);
  });
});

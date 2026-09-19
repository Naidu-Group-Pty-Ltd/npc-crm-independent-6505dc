import { describe, expect, it } from 'vitest';
import { decideProvider } from '../../../supabase/functions/_shared/aml/providerEnvironment.ts';

/**
 * Readiness contracts for electronic IDV.
 *
 * These pin the decision that currently makes the Client Portal answer
 * `manual_verification_required` in production, so the reason stays legible and
 * so no future change can quietly let the simulator serve a real client.
 *
 * Observed production state at the time of writing:
 *   environment=production, no aml.provider_configs row for capability=idv,
 *   mode=simulator, adapter_wired=false, both service secrets absent
 *   → decideProvider refuses with `provider_not_configured`
 *   → clientSafeIdvAvailability maps that to manual_verification_required.
 */

const base = {
  environment: 'production' as const,
  providerKey: 'selfhosted',
  mode: 'live' as const,
  adapterWired: true,
  adapterConfigured: true,
};

describe('electronic IDV readiness', () => {
  it('a fully configured self-hosted provider goes live', () => {
    expect(decideProvider(base)).toEqual({ kind: 'live' });
  });

  it('nothing configured in production refuses as not_configured', () => {
    // The exact production condition: no provider row → simulator defaults.
    const d = decideProvider({
      ...base, providerKey: 'simulator', mode: 'simulator',
      adapterWired: false, adapterConfigured: false,
    });
    expect(d.kind).toBe('refuse');
    expect(d.kind === 'refuse' && d.code).toBe('provider_not_configured');
  });

  it('a live provider with no adapter wired is misconfigured, not unconfigured', () => {
    // Distinct code on purpose: this reads as "temporarily unavailable" to the
    // client, because it is an operator error rather than a deliberate absence.
    const d = decideProvider({ ...base, adapterWired: false });
    expect(d.kind === 'refuse' && d.code).toBe('provider_misconfigured');
  });

  it('a live provider missing its service URL or token is misconfigured', () => {
    const d = decideProvider({ ...base, adapterConfigured: false });
    expect(d.kind === 'refuse' && d.code).toBe('provider_misconfigured');
    expect(d.kind === 'refuse' && d.message).toMatch(/service URL|credentials/i);
  });

  it('the simulator can never serve production, however it is selected', () => {
    // Both selection routes must be refused — a live-mode row pointing at the
    // simulator key is still the simulator.
    for (const sel of [
      { providerKey: 'simulator', mode: 'live' as const },
      { providerKey: 'selfhosted', mode: 'simulator' as const },
      { providerKey: 'simulator', mode: 'simulator' as const },
    ]) {
      const d = decideProvider({ ...base, ...sel });
      expect(d.kind, `${sel.providerKey}/${sel.mode}`).toBe('refuse');
    }
  });

  it('non-production keeps the simulator usable', () => {
    const d = decideProvider({
      ...base, environment: 'development' as any,
      providerKey: 'simulator', mode: 'simulator',
      adapterWired: false, adapterConfigured: false,
    });
    expect(d).toEqual({ kind: 'simulator' });
  });

  it('every refusal states that no attempt was recorded', () => {
    // A refused resolution must never look like a consumed customer attempt.
    for (const sel of [
      { providerKey: 'simulator', mode: 'simulator' as const, adapterWired: false, adapterConfigured: false },
      { ...base, adapterWired: false },
      { ...base, adapterConfigured: false },
    ]) {
      const d = decideProvider({ ...base, ...sel });
      expect(d.kind).toBe('refuse');
      expect(d.kind === 'refuse' && d.message).toMatch(/No verification attempt was recorded/i);
    }
  });
});

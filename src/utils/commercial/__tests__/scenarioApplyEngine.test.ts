import { describe, expect, it, vi } from 'vitest';
import { applyCommercialScenarioProposal, type CommercialScenarioSetters } from '../scenarioApplyEngine';

const proposalWith = (adjustments: Record<string, unknown>) => ({
  name: 'AI proposal',
  reasoning: 'Test proposal',
  estimatedImpact: 'Test impact',
  adjustments,
});

describe('applyCommercialScenarioProposal', () => {
  it('applies recognised enum and lender profile values', () => {
    const setters = {
      setGstTreatment: vi.fn(),
      setLeaseStatus: vi.fn(),
      setGuarantees: vi.fn(),
      setRelatedPartyTenant: vi.fn(),
      setScenarioType: vi.fn(),
      applyProfile: vi.fn(),
    } satisfies CommercialScenarioSetters;

    const changed = applyCommercialScenarioProposal(proposalWith({
      gstTreatment: 'plusGst',
      leaseStatus: 'fullyLeased',
      guarantees: 'yes',
      relatedPartyTenant: 'no',
      scenarioType: 'Acquire Commercial Asset',
      profile: 'mainstreamCommercialBank',
    }), setters);

    expect(changed).toEqual([
      'gstTreatment', 'leaseStatus', 'guarantees', 'relatedPartyTenant', 'scenarioType', 'profile',
    ]);
    expect(setters.applyProfile).toHaveBeenCalledWith('mainstreamCommercialBank');
  });

  it('ignores malformed enum and lender profile values', () => {
    const setters = {
      setGstTreatment: vi.fn(),
      setLeaseStatus: vi.fn(),
      setGuarantees: vi.fn(),
      setRelatedPartyTenant: vi.fn(),
      setScenarioType: vi.fn(),
      applyProfile: vi.fn(),
    } satisfies CommercialScenarioSetters;

    const changed = applyCommercialScenarioProposal(proposalWith({
      gstTreatment: 'invalid',
      leaseStatus: 42,
      guarantees: true,
      relatedPartyTenant: { value: 'yes' },
      scenarioType: 'Invented Scenario',
      profile: 'secondTierLender',
    }), setters);

    expect(changed).toEqual([]);
    Object.values(setters).forEach(setter => expect(setter).not.toHaveBeenCalled());
  });
});

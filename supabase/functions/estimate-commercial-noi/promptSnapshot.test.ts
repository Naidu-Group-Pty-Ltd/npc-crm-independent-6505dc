import { describe, expect, it } from 'vitest';
import { buildNoiPromptSnapshot } from './promptSnapshot';

describe('buildNoiPromptSnapshot', () => {
  it('only exposes estimate-specific fields to the AI prompt', () => {
    const result = buildNoiPromptSnapshot({
      propertyId: 'internal-property-id',
      address: '1 Example Street',
      assetSubtype: 'warehouse',
      selectedClient: 'Private Client',
      ownershipEntity: 'Private Entity',
      tenant: 'Private Tenant',
      linkedPropertyRecord: {
        user_id: 'internal-user-id',
        notes: 'confidential notes',
        industrial_financing: { lender: 'Private Lender' },
      },
      futureSensitiveColumn: 'must not leak',
      currentNoiInputs: {
        marketRent: 100_000,
        leaseType: 'net',
        originalScrapedValues: { notes: 'untrusted free form' },
        outgoings: { council: 10_000, secretFutureCost: 50_000 },
      },
    });

    expect(result).toEqual({
      address: '1 Example Street',
      assetSubtype: 'warehouse',
      currentNoiInputs: {
        marketRent: 100_000,
        leaseType: 'net',
        outgoings: { council: 10_000 },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/internal|Private|confidential|future|untrusted/i);
  });
});

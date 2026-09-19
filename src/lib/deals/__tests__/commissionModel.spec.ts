import { describe, expect, it } from 'vitest';

import {
  agentFeeEntry,
  agentFeeLabelFor,
  agentFeeReceiptPatch,
  commissionModelFor,
  hasTrailAndClawback,
} from '../commissionModel.pure';

describe('commissionModelFor', () => {
  it('tracks a house-and-land deal per build stage', () => {
    expect(commissionModelFor('house_and_land')).toBe('per_build_stage');
  });

  it('gives an existing-property purchase an agent fee', () => {
    // The reported case: the Commission section said nothing applied.
    expect(commissionModelFor('existing_property')).toBe('agent_fee');
  });

  it('gives a refinance an agent fee too', () => {
    expect(commissionModelFor('refinance')).toBe('agent_fee');
  });

  it('answers "none" for a type it does not know, rather than guessing', () => {
    // A new deal type must not silently inherit somebody else's commission
    // arrangement — showing nothing is recoverable, showing the wrong figure
    // against a client's file is not.
    expect(commissionModelFor('commercial_lease')).toBe('none');
    expect(commissionModelFor(null)).toBe('none');
    expect(commissionModelFor(undefined)).toBe('none');
  });
});

describe('agentFeeLabelFor', () => {
  it('names a refinance commission and a purchase fee differently', () => {
    expect(agentFeeLabelFor('refinance')).toBe('Commission & clawback');
    expect(agentFeeLabelFor('existing_property')).toBe('Agent fee / commission');
  });
});

describe('hasTrailAndClawback', () => {
  it('is a refinance concept only', () => {
    // An agent fee is paid once. Drawing an empty clawback window against one
    // would invent an obligation the deal does not carry.
    expect(hasTrailAndClawback('refinance')).toBe(true);
    expect(hasTrailAndClawback('existing_property')).toBe(false);
    expect(hasTrailAndClawback('house_and_land')).toBe(false);
  });
});

describe('agentFeeEntry', () => {
  const purchase = {
    deal_type: 'existing_property',
    commission_estimate: 12500,
    commission_received: false,
    commission_received_date: null,
  };

  it('gives an existing-property purchase one entry', () => {
    expect(agentFeeEntry(purchase)).toEqual({
      label: 'Agent fee / commission',
      amount: 12500,
      received: false,
      receivedDate: null,
    });
  });

  it('answers null for a house-and-land deal', () => {
    // Its commission is already counted per build payment. A second entry
    // here would double it in "Total Received", which is worse than not
    // showing the deal at all.
    expect(agentFeeEntry({ ...purchase, deal_type: 'house_and_land' })).toBeNull();
  });

  it('answers null for a deal type that earns nothing', () => {
    expect(agentFeeEntry({ ...purchase, deal_type: 'commercial_lease' })).toBeNull();
  });

  it('reports an unrecorded fee as null, never as zero', () => {
    // £0 and "nobody has told us yet" are different facts, and a zero here
    // would be summed into an expected total as though it were known.
    expect(agentFeeEntry({ ...purchase, commission_estimate: null })?.amount).toBeNull();
    expect(agentFeeEntry({ ...purchase, commission_estimate: undefined })?.amount).toBeNull();
    expect(agentFeeEntry({ ...purchase, commission_estimate: Number.NaN })?.amount).toBeNull();
  });

  it('keeps a genuine zero fee', () => {
    expect(agentFeeEntry({ ...purchase, commission_estimate: 0 })?.amount).toBe(0);
  });

  it('reads a deal written before the columns existed as not received', () => {
    expect(agentFeeEntry({ deal_type: 'refinance', commission_estimate: 900 })).toEqual({
      label: 'Commission & clawback',
      amount: 900,
      received: false,
      receivedDate: null,
    });
  });

  it('suppresses a date left behind by a cleared flag', () => {
    // The reading must not be able to contradict itself: a row that says
    // "not received" beside the day it arrived is unreadable.
    const entry = agentFeeEntry({
      ...purchase,
      commission_received: false,
      commission_received_date: '2026-08-01',
    });
    expect(entry?.receivedDate).toBeNull();
  });

  it('carries the date once it is received', () => {
    const entry = agentFeeEntry({
      ...purchase,
      commission_received: true,
      commission_received_date: '2026-09-05',
    });
    expect(entry).toMatchObject({ received: true, receivedDate: '2026-09-05' });
  });
});

describe('agentFeeReceiptPatch', () => {
  it('sets the flag and the date together', () => {
    expect(agentFeeReceiptPatch(true, '2026-09-05')).toEqual({
      commission_received: true,
      commission_received_date: '2026-09-05',
    });
  });

  it('clears the date when the flag is cleared', () => {
    // Un-marking a receipt must not leave the day it "arrived" on the record.
    expect(agentFeeReceiptPatch(false, '2026-09-05')).toEqual({
      commission_received: false,
      commission_received_date: null,
    });
  });
});

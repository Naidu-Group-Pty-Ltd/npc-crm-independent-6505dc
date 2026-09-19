/**
 * Database vocabulary never reaches the operator.
 *
 * `reportTypeLabel` fell back to the raw key, and five migrated formats had
 * never been added to the map — so the Template Library's Report-type filter
 * drew `cash_flow_comparison`, `client_details`, `commercial_capacity`,
 * `investment_compass` and `market_intelligence` as chips. That is column
 * values in a control a person reads, and it is most of what the 19 Sep 2026
 * clone audit meant by "too messy and looks unprofessional".
 *
 * The same rule the AML partner roster already answers to, asserted the same
 * way: no rendered label may be an underscore-cased identifier.
 */
import { describe, expect, it } from 'vitest';

import { REPORT_TYPE_LABELS, reportTypeLabel } from '../taxonomy';

/** Every report-type key the seeded catalogue can hold. */
const SEEDED_KEYS = [
  'investment', 'cashflow', 'qa', 'borrowing_capacity', 'portfolio',
  'suburb', 'postcode', 'statewide', 'comparison', 'formara',
  'cash_flow_comparison', 'client_details', 'commercial_capacity',
  'investment_compass', 'market_intelligence',
];

describe('reportTypeLabel', () => {
  it('has a written label for every format the catalogue seeds', () => {
    const missing = SEEDED_KEYS.filter((key) => !REPORT_TYPE_LABELS[key]);
    expect(missing).toEqual([]);
  });

  it('never renders an underscore-cased identifier', () => {
    for (const key of SEEDED_KEYS) {
      expect(reportTypeLabel(key)).not.toMatch(/_/);
    }
  });

  it('humanises a key nobody has labelled rather than printing it', () => {
    // A format added tomorrow reads as words on the day it appears, instead of
    // waiting for somebody to notice the chip.
    expect(reportTypeLabel('some_new_format')).toBe('Some New Format');
    expect(reportTypeLabel('another-one')).toBe('Another One');
  });

  it('answers null for no value', () => {
    expect(reportTypeLabel(null)).toBeNull();
    expect(reportTypeLabel(undefined)).toBeNull();
    expect(reportTypeLabel('')).toBeNull();
  });
});

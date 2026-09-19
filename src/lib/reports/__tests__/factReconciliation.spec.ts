/**
 * Pins the fact reconciliation rule: a fact is contradicted only when the
 * recorded value NEVER appears in the prose in that fact's vocabulary and a
 * different value appears repeatedly. Comparative prose about other
 * properties must never trip it — a disclosure surface earns trust by what
 * it does not cry wolf about.
 */
import { describe, expect, it } from 'vitest';

import {
  factFindingToFlag,
  reconcileFacts,
} from '../../../../supabase/functions/_shared/reports/investment/factReconciliation.pure';

describe('counted facts (bedrooms, bathrooms, car spaces)', () => {
  it('flags a count the prose repeats against a record it never states', () => {
    const text = 'This 4-bedroom residence offers generous living. The 4 bedroom layout suits families.';
    const findings = reconcileFacts(text, { bedrooms: 3 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ fact: 'bedrooms', expected: 3, found: 4, occurrences: 2 });
    expect(findings[0].snippet).toContain('4-bedroom');
  });

  it('comparative prose beside the correct count is not a contradiction', () => {
    const text = 'This 3 bedroom home competes with 4-bedroom stock nearby; 4-bedroom sales set the ceiling.';
    expect(reconcileFacts(text, { bedrooms: 3 })).toHaveLength(0);
  });

  it('a single divergent mention is not a finding', () => {
    const text = 'Demand for 4-bedroom homes is strong in the area.';
    expect(reconcileFacts(text, { bedrooms: 3 })).toHaveLength(0);
  });

  it('word-form numbers are outside the vocabulary and never judged', () => {
    const text = 'This four-bedroom residence is exceptional. A four bedroom plan.';
    expect(reconcileFacts(text, { bedrooms: 3 })).toHaveLength(0);
  });

  it('bathrooms and car spaces use the same rule', () => {
    const text = 'Featuring 3 bathrooms and a double garage. All 3 bathrooms are renovated. 2 car spaces plus 2 car spaces on title.';
    const findings = reconcileFacts(text, { bathrooms: 2, carSpaces: 2 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ fact: 'bathrooms', expected: 2, found: 3 });
  });
});

describe('weekly rent', () => {
  it('flags a repeated rent the record never supports', () => {
    const text = 'Expected rent of $780 per week. At $780/week the yield is strong.';
    const findings = reconcileFacts(text, { weeklyRent: 739 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ fact: 'weeklyRent', expected: 739, found: 780 });
  });

  it('a mention within 5% matches the record', () => {
    const text = 'Currently achieving $745 per week; comparable homes ask $780 per week and $780 per week again.';
    expect(reconcileFacts(text, { weeklyRent: 739 })).toHaveLength(0);
  });
});

describe('purchase price (context-anchored)', () => {
  it('flags a repeated context-anchored price that contradicts the record', () => {
    const text = [
      'The purchase price of $1,250,000 positions this asset well.',
      'At an asking price of $1,250,000 the entry point is competitive.',
    ].join(' ');
    const findings = reconcileFacts(text, { purchasePrice: 1_190_000 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ fact: 'purchasePrice', expected: 1_190_000, found: 1_250_000 });
  });

  it('a million-suffixed mention of the recorded price matches', () => {
    const text = 'Purchase price of $1.19 million. Listed price around $1.19 million.';
    expect(reconcileFacts(text, { purchasePrice: 1_190_000 })).toHaveLength(0);
  });

  it('deposit and duty figures near the price context cannot outvote the stated price', () => {
    const text = 'The purchase price of $1,190,000 requires a deposit of $238,000; stamp duty on the purchase is $47,737.';
    expect(reconcileFacts(text, { purchasePrice: 1_190_000 })).toHaveLength(0);
  });

  it('money with no price context is never judged', () => {
    const text = 'Median house values reached $1,300,000 this year. Nearby sales hit $1,300,000.';
    expect(reconcileFacts(text, { purchasePrice: 1_190_000 })).toHaveLength(0);
  });
});

describe('land size (context-anchored)', () => {
  it('flags a repeated land size that contradicts the record', () => {
    const text = 'Set on a 702 sqm block. The 702 sqm land parcel allows future expansion.';
    const findings = reconcileFacts(text, { landSizeSqm: 650 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ fact: 'landSizeSqm', expected: 650, found: 702 });
  });

  it('building areas in sqm are not land mentions', () => {
    const text = 'Offering 180 sqm of internal living and 180 sqm under roof.';
    expect(reconcileFacts(text, { landSizeSqm: 650 })).toHaveLength(0);
  });
});

describe('measured against production prose (closing pass)', () => {
  /**
   * The one false positive in 18 production reports: a spec list whose
   * " - " separator was read as the hyphen of "3-bathroom", so the bedroom
   * count leaked into the bathroom match while the true "Bathrooms: 2" —
   * label-first, as every generated spec table writes it — never counted as
   * the recorded value appearing.
   */
  it('a "Bedrooms: 3 - Bathrooms: 2" list is not a bathroom contradiction', () => {
    const text = [
      '- Property Type: Not specified - Bedrooms: 3 - Bathrooms: 2 - **Location: Unknown**',
      'The plan offers 3 bedrooms with 2 bathrooms.',
      'Bedrooms: 3 - Bathrooms: 2 again in the summary.',
    ].join('\n');
    expect(reconcileFacts(text, { bedrooms: 3, bathrooms: 2 })).toHaveLength(0);
  });

  it('label-first mentions count as the recorded value appearing', () => {
    const text = '| Bedrooms | 4 |\n| Bathrooms | 2 |\n| Parking | 2 |\nA family home.';
    expect(reconcileFacts(text, { bedrooms: 4, bathrooms: 2, carSpaces: 2 })).toHaveLength(0);
    expect(reconcileFacts('Bedrooms: 3\nBathrooms: **2**\nParking: 2', { bedrooms: 3, bathrooms: 2, carSpaces: 2 })).toHaveLength(0);
  });

  it('a genuine repeated contradiction still surfaces', () => {
    const text = 'Bedrooms: 3\nThe 3-bedroom layout suits families. Three bedrooms and a 3 bedroom plan.';
    const [finding] = reconcileFacts(text, { bedrooms: 4 });
    expect(finding).toMatchObject({ fact: 'bedrooms', expected: 4, found: 3 });
  });

  /**
   * The one true positive in the same 18: the record priced the lot at
   * $693,100 and the prose anchored its whole money section on the suburb
   * median, $625,000, six times. That is the class disclosure exists for.
   */
  it('a purchase price replaced by the suburb median is caught', () => {
    const text = [
      'Purchase price benchmark $625,000 for houses in the suburb.',
      '| Purchase Price | $625,000 | Median house price |',
      'Total upfront costs assume a purchase price of $625,000.',
    ].join('\n');
    const [finding] = reconcileFacts(text, { purchasePrice: 693_100 });
    expect(finding).toMatchObject({ fact: 'purchasePrice', expected: 693_100, found: 625_000 });
  });
});

describe('edges', () => {
  it('empty prose and absent facts produce nothing', () => {
    expect(reconcileFacts('', { bedrooms: 3 })).toHaveLength(0);
    expect(reconcileFacts('A 4 bedroom home. A 4 bedroom home.', {})).toHaveLength(0);
  });

  it('a finding converts to the validation_flags vocabulary', () => {
    const [finding] = reconcileFacts('A 4-bedroom home. The 4 bedroom plan.', { bedrooms: 3 });
    const flag = factFindingToFlag(finding);
    expect(flag.type).toBe('fact');
    expect(flag.severity).toBe('warning');
    expect(flag.field).toBe('bedrooms');
    expect(flag.message).toContain('bedroom count');
    expect(flag.message).toContain('4');
    expect(flag.message).toContain('3');
    expect(flag.value.snippet).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Derived figures
//
// Every phrase below is a verbatim production string, taken from
// investment_reports.report_content on 2026-09-07, and the verdict beside it
// is the one this detector must reach. The prose false positives are the ones
// a hand-written pattern actually produced against the corpus long tail — they
// are kept as cases because that is the only way a later widening of the gap
// gets caught.
// ---------------------------------------------------------------------------

describe('gross and net yield', () => {
  it('reads the figure out of the working column the generator prints', () => {
    // 543 of the corpus's 2,153 gross mentions are this exact shape.
    const text = [
      '| Metric | Working | Value |',
      '| Gross Rental Yield | $33,800 ÷ $700,000 × 100 | 4.83% |',
      '| Net Rental Yield | $23,000 ÷ $700,000 × 100 | 3.29% |',
    ].join('\n');
    expect(reconcileFacts(text, { grossYieldPct: 4.83, netYieldPct: 3.29 })).toHaveLength(0);
  });

  it('accepts the prose roundings of a two-decimal figure', () => {
    for (const written of ['4.8', '4.83', '5']) {
      const text = `The gross rental yield of ${written}% is typical. A gross yield of ${written}% suits investors.`;
      expect(reconcileFacts(text, { grossYieldPct: 4.83 })).toHaveLength(0);
    }
  });

  it('flags a yield the report repeats against the one it was told to use', () => {
    // Measured: this is the shape of a real divergence — the model recomputed
    // on 49 letting weeks instead of the 52 it was handed.
    const text = [
      '| Gross Rental Yield | $33,000 ÷ $700,000 × 100 | 4.73% |',
      'A gross rental yield of 4.73% places this mid-range.',
      'The gross yield of 4.73% supports the case.',
    ].join('\n');
    const [finding] = reconcileFacts(text, { grossYieldPct: 5.02 });
    expect(finding).toMatchObject({ fact: 'grossYieldPct', expected: 5.02, found: 4.73, occurrences: 3 });
  });

  it('keeps a negative net yield negative', () => {
    // 62 corpus mentions are negative. Dropping the sign would turn every
    // negatively geared property into its positive twin and flag them all.
    const text = [
      '| Net Rental Yield | -$8,400 ÷ $700,000 × 100 | -1.73% |',
      'The net yield of **-1.73%** reflects the gearing.',
    ].join('\n');
    expect(reconcileFacts(text, { netYieldPct: -1.73 })).toHaveLength(0);
    const [finding] = reconcileFacts(text, { netYieldPct: 3.39 });
    expect(finding).toMatchObject({ fact: 'netYieldPct', found: -1.73 });
  });

  it('never reads a sentence as a statement of the figure', () => {
    // Each of these was a real false positive before the gap rule required a
    // delimiter or adjacency. The recorded yield appears nowhere, so anything
    // the detector picked up would be reported.
    const prose = [
      'The gross rental yield provides substantial buffering against interest rate increases. A 1% rise is absorbable.',
      'The net rental yield reflects the balance between rental income ($27,500 annually at 96% occupancy) and costs.',
      'This gross rental yield significantly exceeds the Melbourne metropolitan average of 3.2% for comparable stock.',
      'The gross yield necessitates leverage for returns. Sensitivity to RBA cash rate (4.35% currently) is material.',
      'The gross yield supports serviceability. Monthly IO payments of $2,583 equate to 48% of net income.',
      'This net yield is substantially higher than comparable metropolitan properties (1.5-2.0% typically).',
    ];
    for (const sentence of prose) {
      const text = `${sentence}\n${sentence}`;
      expect(reconcileFacts(text, { grossYieldPct: 4.83, netYieldPct: 3.39 })).toHaveLength(0);
    }
  });

  it('reads the figure off an equation the model shows its working for', () => {
    const text = [
      'Gross Rental Yield: (Annual Rent / Property Value) = ($27,040 / $590,000) = 4.6%',
      'Net Rental Yield: [($450 × 52) - ($1,500 + $1,800 + $1,200 + $22,968)] / $590,000 = 3.2%',
    ].join('\n');
    expect(reconcileFacts(text, { grossYieldPct: 4.6, netYieldPct: 3.2 })).toHaveLength(0);
  });

  it('does not file the net figure under gross when one sentence carries both', () => {
    // `gross yield and N%` occurs 20 times in the corpus; the gap may not
    // cross a second `yield`.
    const text = 'The gross yield and net yield of 3.39% are shown. The gross yield and net yield of 3.39% again.';
    const findings = reconcileFacts(text, { grossYieldPct: 4.83, netYieldPct: 3.39 });
    expect(findings).toHaveLength(0);
  });

  it('ignores the plural, which is always somebody else s market', () => {
    const text = 'Suburb gross yields sit below 4.0%. Comparable gross yields below 4.0% are the norm.';
    expect(reconcileFacts(text, { grossYieldPct: 5.4 })).toHaveLength(0);
  });
});

describe('loan-to-value ratio', () => {
  it('reads the value-first form, which is how the corpus states it', () => {
    const text = 'Loan: **$560,000** (80% LVR, 6.5% interest). Under an 80% LVR the deposit is $140,000.';
    expect(reconcileFacts(text, { lvrPct: 80 })).toHaveLength(0);
  });

  it('flags an LVR the analysis repeats against the one the record holds', () => {
    // The real defect: nine to twelve mentions of 90% on reports whose record
    // and whose customer s own override both say 80.
    const text = [
      'Loan: **$604,800** (90% LVR, 6.5% interest).',
      'A 90% LVR requires lenders mortgage insurance.',
      'Servicing at 90% LVR leaves little buffer.',
    ].join('\n');
    const [finding] = reconcileFacts(text, { lvrPct: 80 });
    expect(finding).toMatchObject({ fact: 'lvrPct', expected: 80, found: 90, occurrences: 3 });
  });

  it('never lets a prose connective introduce the number', () => {
    // Each of these was a real false positive. `LVR, 6.5%` and `LVR at 6.5%`
    // are the interest rate; `banks cap LVR at 95%` is policy rather than this
    // loan; `would result in an LVR of 65%` is a projection. Only a structural
    // connector — a table pipe, a label's colon, an equals — may introduce it.
    const prose = [
      'Serviceability is confirmed; banks cap LVR at 95% for investors.',
      'The LVR, 6.5% interest and a 30-year term set the repayment.',
      'Ten years of growth would result in a healthy LVR of 65% on this loan.',
    ];
    for (const sentence of prose) {
      expect(reconcileFacts(`${sentence}\n${sentence}`, { lvrPct: 80 })).toHaveLength(0);
    }
  });

  it('a sensitivity scenario beside the real LVR is not a contradiction', () => {
    // Value-first is admitted, so a modelled scenario IS collected — and the
    // report-level rule is what makes that safe: the loan's own LVR appears in
    // the same document, so nothing is reported.
    const text = [
      'Loan: **$560,000** (80% LVR, 6.5% interest).',
      'Under a 70% LVR the buffer widens; a 70% LVR would need a larger deposit.',
    ].join('\n');
    expect(reconcileFacts(text, { lvrPct: 80 })).toHaveLength(0);
  });

  it('does not judge the projection s final LVR against the settlement LVR', () => {
    // `| Final LVR | 52% |` is the last row of the ten-year table and it is
    // correct — a CURRENT LVR is a different quantity from an origination one.
    const text = [
      '| Closing Balance | $478,000 | $455,000 | $431,000 |',
      '| Final LVR | 52% |',
      '| Final LVR | 52% |',
    ].join('\n');
    expect(reconcileFacts(text, { lvrPct: 80 })).toHaveLength(0);
  });

  it('reads a labelled field or a table cell', () => {
    for (const text of ['**LVR:** 80%\n**LVR:** 80%', '| LVR | 80% |\n| LVR | 80% |', 'LVR = 80%\nLVR = 80%']) {
      expect(reconcileFacts(text, { lvrPct: 80 })).toHaveLength(0);
      expect(reconcileFacts(text, { lvrPct: 60 })).toHaveLength(1);
    }
  });
});

describe('a percentage carries its unit into the disclosure', () => {
  it('says 4.73% rather than 4.73', () => {
    const text = 'A gross rental yield of 4.73% is typical. The gross yield of 4.73% holds.';
    const flag = factFindingToFlag(reconcileFacts(text, { grossYieldPct: 5.02 })[0]);
    expect(flag.field).toBe('grossYieldPct');
    expect(flag.message).toContain('gross rental yield of 4.73%');
    expect(flag.message).toContain('record says 5.02%');
  });
});

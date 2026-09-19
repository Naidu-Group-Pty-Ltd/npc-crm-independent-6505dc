/**
 * What a Commercial & Industrial Capacity template may bind, and the contract
 * rules that are easiest to break here.
 *
 * The format's own doc states four. Three of them can be asserted at this layer
 * and are, below: figures come from the stored run rather than a recomputation;
 * the analysis is labelled as model-written wherever it appears; and collections
 * are capped because the page model cannot paginate.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCommercialCapacity, applyCommercialCapacityProjection, CAPS,
} from '../../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { ANALYSIS_PROVENANCE_NOTE }
  from '../../../../supabase/functions/_shared/reports/commercialCapacity/render.pure';
import { COMMERCIAL_CAPACITY_TEMPLATES }
  from '../../../../scripts/template-library/investmentCompass/commercialCapacity';

const m = (value: number, unit = 'aud', precision?: number) =>
  (precision === undefined ? { value, unit } : { value, unit, precision });

function snapshot(over: Record<string, any> = {}): any {
  return {
    meta: {
      subject: 'Marlborough Industrial Pty Ltd',
      reference: 'CI-0001',
      title: 'Unit 4, 12 Marlborough St',
      assessedOn: '2026-08-01T00:00:00.000Z',
      assessmentId: 'a1',
      segment: 'industrial',
      assessmentTypeLabel: 'Purchase',
      engineVersion: '1.0.0',
      policyVersion: '2026.08.0',
      lenderProfile: 'Tier 2',
    },
    property: {
      address: '12 Marlborough St',
      assetClass: 'Industrial',
      gstTreatment: 'Going concern',
      lettableArea: m(1200, 'sqm'),
      purchasePrice: m(3_000_000),
      valuation: m(3_050_000),
      valuationBasis: 'As is',
    },
    headline: {
      outcome: 'outside_current_assumptions',
      outcomeLabel: 'Outside current assumptions',
      outcomeReason: 'The debt service coverage ratio falls below the floor.',
      maximumCapacity: m(1_800_000),
      requestedLoan: m(2_400_000),
      difference: m(-600_000),
      requiredContribution: m(600_000),
      bindingConstraint: 'Debt service coverage ratio',
      assessmentRate: m(0.0785, 'rate'),
      loanTerm: m(5, 'years'),
      amortisation: m(20, 'years'),
      monthlyDebtService: m(14_800),
      surplus: m(-2_100),
      sensitisedSurplus: m(-4_300),
    },
    narrative: 'On the figures supplied the facility does not service.',
    ratios: { lvr: m(0.6, 'rate', 0), dscr: m(1.02, 'ratio', 2), dscrFloor: m(1.25, 'ratio', 2) },
    // The payload's own shape — cap, threshold, actual, applied — which this
    // fixture used to misstate as `limit`/`status`, exactly the phantom fields
    // the projection was reading. See `ConstraintRow`.
    constraints: [
      { label: 'Debt service coverage ratio', cap: m(1_800_000), formula: 'NOI ÷ min DSCR 1.25x', binding: true, applied: true, threshold: m(1.25, 'ratio', 2), actual: m(1.02, 'ratio', 2) },
      { label: 'Loan-to-value ratio', cap: m(1_982_500), formula: 'Valuation × max LVR 65%', binding: false, applied: true, threshold: m(0.65, 'rate', 0), actual: m(0.6, 'rate', 0) },
      { label: 'Debt yield', cap: m(2_100_000), formula: 'NOI ÷ minimum debt yield', binding: false, applied: false, threshold: null, actual: null },
    ],
    serviceability: {
      rows: [
        { label: 'Net operating income', amount: m(178_000, 'aud/year'), emphasis: 'normal', direction: 'favourable' },
        { label: 'Less proposed facility at the assessment rate', amount: m(-180_100, 'aud/year'), emphasis: 'normal', direction: 'adverse' },
        { label: 'Surplus after debt service', amount: m(-2_100, 'aud/year'), emphasis: 'total', direction: 'adverse' },
      ],
      assessmentRateBasis: 'Contract rate 6.85% plus 1.00% buffer.',
    },
    transaction: {
      lines: [{ label: 'Purchase price', amount: m(3_000_000) }],
      totalProjectCost: m(3_180_000),
      borrowerContribution: m(780_000),
      fundingGap: null,
      cashOut: null,
    },
    propertyIncome: {
      lines: [{ label: 'Passing rent', amount: m(210_000) }],
      netOperatingIncome: m(178_000),
      capitalisationRate: m(0.058, 'rate'),
      breakEvenOccupancy: m(0.82, 'rate'),
      wale: m(3.4, 'years', 1),
      tenantCount: m(2, 'count'),
      tenantConcentration: m(0.62, 'rate'),
      tenancies: [
        { tenant: 'Alpha Pty Ltd', area: m(520, 'count'), passingRent: m(130_000, 'aud/year'), expiry: '2029-10-31', remainingTerm: m(3.2, 'years'), share: m(0.62, 'rate') },
        { tenant: 'Beta Pty Ltd', area: null, passingRent: m(80_000, 'aud/year'), expiry: null, remainingTerm: null, share: m(0.38, 'rate') },
      ],
    },
    businessIncome: {
      adjustedEbitda: m(0), assessableIncome: m(0), trend: null,
      periods: [], selectionBasis: '', verificationStatus: '', decliningIncome: false,
    },
    portfolio: {
      rows: [
        { label: 'Portfolio LVR', current: m(0.584, 'rate', 1), proposed: m(0.651, 'rate', 1), change: m(0.067, 'rate', 1), direction: 'adverse' },
        { label: 'Net equity', current: m(1_019_000), proposed: m(1_499_000), change: null, direction: 'favourable' },
      ],
      direction: 'weakens',
      assetCount: m(1, 'count'),
      crossCollateralisedShare: m(0, 'rate'),
    },
    compliance: {
      classificationLabel: 'Business purpose (indicative)',
      requiresComplianceReview: false,
      requiresSpecialistReview: true,
      flags: [],
    },
    outstanding: [{ label: 'Signed leases', blocking: true }],
    nextActions: ['Obtain executed leases'],
    warnings: [],
    method: [{ label: 'Debt service', detail: 'Sized on 20-year amortisation' }],
    analysis: null,
    disclaimer: 'Indicative only.',
    ...over,
  };
}

const ANALYSIS = {
  interpretation: 'The deal is short on servicing rather than on security.',
  findings: [
    { title: 'Security is adequate', detail: 'LVR sits inside the ceiling.', significance: 'strength' },
    { title: 'Servicing is short', detail: 'DSCR is 1.02 against a 1.25 floor.', significance: 'risk' },
  ],
  scenarios: [
    {
      name: 'Extend amortisation',
      reasoning: 'A longer amortisation lowers monthly debt service.',
      estimatedImpact: 'DSCR to ~1.20',
      executionRisk: 'medium',
      evidenceRequired: ['Lender term sheet', 'Updated cash flow'],
    },
  ],
  questionsForCredit: ['Is a 25-year amortisation available on this asset class?'],
  model: 'google/gemini-2.5-flash',
  generatedAt: '2026-08-02T00:00:00.000Z',
};

describe('figures are restated, never recomputed', () => {
  const { capacity } = projectCommercialCapacity(snapshot());

  it('unwraps Measures to the bare value a filter can format', () => {
    expect((capacity.headline as any).maximumCapacity).toBe(1_800_000);
    expect((capacity.headline as any).assessmentRate).toBeCloseTo(0.0785);
    // Not the Measure object — a template has no syntax to reach into one.
    expect((capacity.headline as any).maximumCapacity).not.toHaveProperty('value');
  });

  it('publishes both versions, so a figure can be checked against what produced it', () => {
    expect((capacity.meta as any).engineVersion).toBe('1.0.0');
    expect((capacity.meta as any).policyVersion).toBe('2026.08.0');
  });

  it('derives no totals of its own', () => {
    // The transaction total is the engine's, not lines summed here. Summing
    // would be a second engine, and a document that disagrees with the
    // calculator a broker was looking at is worse than one with a gap.
    const t = capacity.transaction as any;
    expect(t.totalProjectCost).toBe(3_180_000);
    expect(t.lines[0].amount).toBe(3_000_000);
    expect(t.totalProjectCost).not.toBe(t.lines[0].amount);
  });
});

describe('a decline is the corpus, so it is named rather than implied', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const h = () => capacity.headline as any;

  it('names a shortfall as a shortfall and publishes it unsigned', () => {
    // Every assessment in production is short. A master reading `difference`
    // alone prints a negative under a heading that says "headroom".
    expect(h().differenceLabel).toBe('Shortfall');
    expect(h().differenceAbsolute).toBe(600_000);
    expect(h().isShortfall).toBe(true);
  });

  it('says headroom when there is headroom, and publishes no shortfall flag', () => {
    const up = projectCommercialCapacity(snapshot({
      headline: { ...snapshot().headline, difference: m(250_000) },
    })).capacity.headline as any;
    expect(up.differenceLabel).toBe('Headroom');
    expect(up.isShortfall).toBeUndefined();
  });

  it('carries the binding test, which is what the document turns on', () => {
    expect(h().bindingConstraint).toBe('Debt service coverage ratio');
    expect((capacity.constraints as any[])[0].binding).toBe(true);
    expect((capacity.constraints as any[])[1].binding).toBeUndefined();
  });
});

describe('the analysis is labelled as model-written, or it is not published', () => {
  it('publishes the provenance note alongside the analysis', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect(capacity.analysisProvenance).toBe(ANALYSIS_PROVENANCE_NOTE);
    expect((capacity.analysis as any).interpretation).toContain('short on servicing');
    expect((capacity.analysis as any).model).toBe('google/gemini-2.5-flash');
  });

  it('publishes neither when there is no analysis', () => {
    const { capacity } = projectCommercialCapacity(snapshot());
    expect(capacity.analysis).toBeUndefined();
    expect(capacity.analysisProvenance).toBeUndefined();
  });

  it('keeps significance as the judgement it is', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    const findings = (capacity.analysis as any).findings;
    expect(findings.map((f: any) => f.significance)).toEqual(['strength', 'risk']);
  });

  it('joins evidence into something a table cell can print', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect((capacity.analysis as any).scenarios[0].evidence)
      .toBe('Lender term sheet; Updated cash flow');
  });
});

describe('collections are capped and absent means absent', () => {
  it('caps constraints and says how many there were', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      label: `Test ${i}`, cap: m(1_000_000 + i), formula: '', binding: false, applied: true,
      threshold: m(2, 'ratio'), actual: m(1, 'ratio'),
    }));
    const { capacity } = projectCommercialCapacity(snapshot({ constraints: many }));
    expect((capacity.constraints as any[]).length).toBe(CAPS.constraints);
    expect(capacity.constraintCount).toBe(14);
    expect(capacity.constraintsOmitted).toContain('6 further tests');
  });

  it('never publishes an empty string or a null', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      narrative: '', warnings: [], method: [], outstanding: [], nextActions: [],
      property: { ...snapshot().property, valuationBasis: '', valuation: null },
    }));
    const walk = (v: unknown): void => {
      if (v === '' || v === null) throw new Error('published an empty value');
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    expect(() => walk(capacity)).not.toThrow();
    expect(capacity.narrative).toBeUndefined();
    expect(capacity.method).toBeUndefined();
    expect((capacity.property as any).valuation).toBeUndefined();
  });

  it('writes nothing at all when the snapshot is empty', () => {
    const target: Record<string, unknown> = {};
    applyCommercialCapacityProjection(target, {} as any);
    expect(target.capacity).toBeUndefined();
  });
});

describe('the constraints table, in the legacy table\'s own columns', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const rows = () => capacity.constraints as any[];

  it('composes Permits, Policy and This deal with the legacy\'s formatter', () => {
    // The projection used to read `limit`, `headroom` and `status` — fields
    // `ConstraintRow` has never had — so the tests table printed its Limit and
    // Status columns empty on every row of the table the format exists for.
    expect(rows()[0].capLabel).toBe('$1,800,000');
    expect(rows()[0].thresholdLabel).toBe('1.25x');
    expect(rows()[0].actualLabel).toBe('1.02x');
    expect(rows()[1].thresholdLabel).toBe('65%');
  });

  it('keeps three status states, because "not run" is not "passed"', () => {
    expect(rows()[0].statusLabel).toBe('Binds');
    expect(rows()[1].statusLabel).toBe('Does not bind');
    expect(rows()[2].statusLabel).toBe('Not applicable');
  });

  it('prints the em dash for what a not-applied test does not have', () => {
    expect(rows()[2].capLabel).toBe('—');
    expect(rows()[2].thresholdLabel).toBe('—');
    expect(rows()[2].actualLabel).toBe('—');
  });

  it('explains the binding test in the legacy\'s sentences, formula included', () => {
    expect(capacity.bindingTitle)
      .toBe('The debt service coverage ratio is what sets this capacity');
    expect(capacity.bindingExplanation).toBe(
      'Of the tests applied, the debt service coverage ratio permits the smallest facility — '
      + '$1,800,000. Every other test would allow more, so lifting them changes nothing until '
      + 'this one moves. It is calculated as NOI ÷ min DSCR 1.25x.',
    );
  });

  it('says so when no single test bound', () => {
    const none = snapshot();
    none.constraints = none.constraints.map((c: any) => ({ ...c, binding: false }));
    const { capacity: c2 } = projectCommercialCapacity(none);
    expect(c2.bindingTitle).toBe('No single binding test');
    expect(c2.bindingExplanation).toContain('did not resolve to one binding constraint');
  });
});

describe('the answer page\'s policy table and terms', () => {
  const { capacity } = projectCommercialCapacity(snapshot());

  it('composes the ratio rows with their labelled bounds', () => {
    const rows = capacity.ratioRows as any[];
    expect(rows.map((x) => x.label)).toEqual(['Loan to value', 'Debt service cover']);
    expect(rows[1]).toEqual({ label: 'Debt service cover', actualLabel: '1.02x', policyLabel: 'Minimum 1.25x' });
    // The fixture's LVR has no ceiling; the row carries no policy cell rather
    // than a dangling label.
    expect(rows[0].policyLabel).toBeUndefined();
  });

  it('folds the amortisation into the term, because the repayment is sized on it', () => {
    expect((capacity.headline as any).termLabel).toBe('5 years, amortised over 20 years');
    const flat = projectCommercialCapacity(snapshot({
      headline: { ...snapshot().headline, amortisation: null },
    }));
    expect((flat.capacity.headline as any).termLabel).toBe('5 years');
  });
});

describe('the serviceability ledger', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const svc = () => capacity.serviceability as any;

  it('carries the rows signed, with the direction in words', () => {
    expect(svc().rows).toHaveLength(3);
    expect(svc().rows[1].amountLabel).toBe('-$180,100');
    expect(svc().rows[1].effect).toBe('Reduces');
    expect(svc().rows[0].effect).toBe('Improves');
    expect(svc().rows[2].total).toBe(true);
  });

  it('carries the rate basis and the sensitivity sentence', () => {
    expect(svc().rateBasis).toBe('Contract rate 6.85% plus 1.00% buffer.');
    expect(svc().surplusNote).toContain("under the engine's rate sensitivity");
  });
});

describe('the tenancy schedule and the lease profile', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const pi = () => capacity.propertyIncome as any;

  it('composes each row\'s mixed units, em dashes for what is not recorded', () => {
    expect(pi().tenancies[0]).toEqual({
      tenant: 'Alpha Pty Ltd', areaLabel: '520 m²', rentLabel: '$130,000',
      shareLabel: '62%', expiry: '2029-10-31',
    });
    expect(pi().tenancies[1].areaLabel).toBe('—');
    expect(pi().tenancies[1].expiry).toBe('—');
    expect(pi().tenancyCount).toBe(2);
  });

  it('composes the lease-profile note without doubling the WALE\'s unit', () => {
    // "A WALE of 3.5 years years" is what the first legacy render printed.
    expect(pi().leaseNote).toContain('A WALE of 3.4 years across 2 tenancies.');
    expect(pi().leaseNote).not.toContain('years years');
    expect(pi().leaseNote).toContain('62% of the passing rent');
  });
});

describe('business income', () => {
  const periods = [
    { label: 'FY2026', periodEnd: '2026-06-30', basis: 'x', verification: 'Accountant-prepared', reportedEbitda: m(510_000, 'aud/year'), confirmedAddbacks: m(68_500, 'aud/year'), unconfirmedAddbacks: m(0, 'aud/year'), adjustedEbitda: m(578_500, 'aud/year'), assessable: m(520_650, 'aud/year') },
  ];

  it('carries the periods with the caption naming the selection basis', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      businessIncome: {
        adjustedEbitda: m(578_500, 'aud/year'), assessableIncome: m(520_650, 'aud/year'),
        trend: null, periods, selectionBasis: 'Weighted 3:2:1 across 3 periods', verificationStatus: 'Accountant-prepared', decliningIncome: false,
      },
    }));
    const bi = capacity.businessIncome as any;
    expect(bi.periods[0].reportedLabel).toBe('$510,000');
    expect(bi.periods[0].verification).toBe('Accountant-prepared');
    expect(bi.periodsCaption).toBe('Financial periods — assessed on a weighted 3:2:1 across 3 periods basis.');
    expect(bi.decliningNote).toBeUndefined();
  });

  it('composes the declining-earnings caution in the legacy\'s sentences', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      businessIncome: {
        adjustedEbitda: m(1), assessableIncome: m(1), trend: m(0.12, 'rate'),
        periods, selectionBasis: 'Most recent', verificationStatus: 'Lodged', decliningIncome: true,
      },
    }));
    expect((capacity.businessIncome as any).decliningNote)
      .toContain('fall across the periods assessed, by 12%');
  });
});

describe('portfolio impact', () => {
  const { capacity } = projectCommercialCapacity(snapshot());
  const pf = () => capacity.portfolio as any;

  it('signs the change with the fixed formatDelta, em dash when incomparable', () => {
    // The rate-delta bug this format\'s first render found: `(0.067).toFixed(0)`
    // is 0, so every changed rate printed "no change".
    expect(pf().rows[0].changeLabel).toBe('+6.7%');
    expect(pf().rows[1].changeLabel).toBe('—');
    expect(pf().rows[0].effect).toBe('Reduces');
  });

  it('frames the section in the legacy\'s sentence', () => {
    expect(pf().overview).toContain("this transaction weakens the borrower's position");
    expect(pf().overview).toContain('not always the direction the number moves');
  });

  it('stays silent about cross-collateralisation at zero', () => {
    expect(pf().crossCollateralisationNote).toBeUndefined();
    const xcoll = projectCommercialCapacity(snapshot({
      portfolio: { ...snapshot().portfolio, crossCollateralisedShare: m(0.4, 'rate') },
    }));
    expect((xcoll.capacity.portfolio as any).crossCollateralisationNote)
      .toContain('40% of the portfolio is cross-collateralised');
  });
});

describe('compliance and the risk indicators', () => {
  it('publishes the classification with the reviews as words', () => {
    const { capacity } = projectCommercialCapacity(snapshot());
    expect(capacity.compliance).toEqual({
      classification: 'Business purpose (indicative)',
      complianceReview: 'No',
      specialistReview: 'Yes',
    });
  });

  it('caps the flags and says how many there were', () => {
    const flags = Array.from({ length: 4 }, (_, i) => ({
      code: `F${i}`, severity: 'review', message: `Flag ${i}`, action: `Fix ${i}`,
    }));
    const { capacity } = projectCommercialCapacity(snapshot({
      compliance: { ...snapshot().compliance, flags },
    }));
    const comp = capacity.compliance as any;
    expect(comp.flags).toHaveLength(CAPS.flags);
    expect(comp.flagCount).toBe(4);
    expect(comp.flagsOmitted).toContain('2 further compliance flags');
  });

  it('sorts risk indicators critical-first and words the severity', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      warnings: [
        { severity: 'info', category: 'Verification', message: 'Unverified income.' },
        { severity: 'critical', category: 'Financial', message: 'Over capacity.' },
        { severity: 'warning', category: 'Financial', message: 'DSCR below floor.' },
      ],
    }));
    const w = capacity.warnings as any[];
    // Critical rows are hoisted; the rest keep their recorded order — the
    // legacy's own `[...critical, ...other]`, not a full severity sort.
    expect(w.map((x) => x.severityLabel)).toEqual(['Critical', 'For information', 'Warning']);
    expect(w[0].label).toBe('Over capacity.');
    expect(capacity.warningsOmitted).toBeUndefined();
  });

  it('says when the four-row table drops the mildest', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      warnings: Array.from({ length: 5 }, (_, i) => ({
        severity: i === 0 ? 'critical' : 'info', category: 'X', message: `W${i}`,
      })),
    }));
    expect(capacity.warningsOmitted).toBe('1 further risk indicator is not shown here.');
  });
});

describe('the transaction notes', () => {
  it('composes the valuation sidenote whole, contribution folded in', () => {
    const { capacity } = projectCommercialCapacity(snapshot());
    expect((capacity.transaction as any).valuationNote).toBe(
      '$3,050,000 on a as is basis, against a purchase price of $3,000,000. Lending is '
      + 'assessed on the lower of price and valuation. At the assessed capacity the borrower '
      + 'would need to contribute $600,000.',
    );
    expect((capacity.transaction as any).fundingGapNote).toBeUndefined();
  });

  it('composes the funding-shortfall caution when a gap exists', () => {
    const { capacity } = projectCommercialCapacity(snapshot({
      transaction: { ...snapshot().transaction, fundingGap: m(180_000) },
    }));
    expect((capacity.transaction as any).fundingGapNote)
      .toContain('$180,000 of the total project cost is not covered');
  });
});

describe('the analysis attribution', () => {
  it('names the model and the date it wrote, as the legacy prints them', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect((capacity.analysis as any).attribution)
      .toBe('Written by google/gemini-2.5-flash on 02 August 2026.');
  });

  it('composes each scenario\'s detail as reasoning then effect', () => {
    const { capacity } = projectCommercialCapacity(snapshot({ analysis: ANALYSIS }));
    expect((capacity.analysis as any).scenarios[0].detail)
      .toBe('A longer amortisation lowers monthly debt service. DSCR to ~1.20');
  });
});

describe('the fifty masters', () => {
  it('exist, uniquely', () => {
    expect(COMMERCIAL_CAPACITY_TEMPLATES).toHaveLength(50);
    expect(new Set(COMMERCIAL_CAPACITY_TEMPLATES.map((t) => t.slug)).size).toBe(50);
  });

  it('never draw the model prose without the sentence saying a model wrote it', () => {
    // The contract's fourth rule, enforced structurally rather than by review.
    for (const master of COMMERCIAL_CAPACITY_TEMPLATES) {
      for (const page of master.schema.pages as any[]) {
        const json = JSON.stringify(page);
        if (json.includes('{{capacity.analysis.interpretation}}')) {
          expect(json, `${master.slug}: ${page.name} prints the reading unlabelled`)
            .toContain('{{capacity.analysisProvenance}}');
        }
      }
    }
  });
});

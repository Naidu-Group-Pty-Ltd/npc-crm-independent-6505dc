/**
 * The Strategy Rationale Brief, typeset (BORROWING_CAPACITY.md §17).
 *
 * The owner's instruction for moving it off jsPDF was that the content is
 * "predominantly just a transition of that information into the new template
 * structure" — nothing added, nothing reworded. So these specs hold the
 * typeset brief to the jsPDF brief's own words: every literal the generator
 * prints is found in its source and then in what the composer produces, and
 * the Samuel Lavis baseline brief of 28 Sep 2026 is reproduced line for line.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

import {
  composeStrategyRationale,
  readStrategyRationale,
  strategyRationaleFileName,
  type RationaleContextInput,
  type RationaleReportInput,
} from '../strategyRationale.pure';
import { renderStrategyRationaleBody } from '../strategyRationaleRender.pure';
import { parseRenderRequest } from '../route.pure';
import { SAMPLE_GLOBAL_SETTINGS } from './fixtures/sampleAssessment';

const LEGACY = readFileSync(
  resolve(__dirname, '../../../../components/borrowing-capacity/scenarios/StrategyRationalePDF.ts'),
  'utf8',
);

/** The baseline brief the What-If tab produced for Samuel Lavis on 28 Sep 2026. */
const BASELINE_REPORT: RationaleReportInput = {
  headline: 'Baseline scenario — no levers applied. Borrowing capacity remains at $761,404.',
  bullets: [],
  reconciliation: 'No levers applied — no per-lever attribution to reconcile.',
  sequence: [],
  caveats: ['Standard lender verification applies — payslips, bureau check, valuations, and contract review must all be completed before unconditional approval.'],
};
const BASELINE_CONTEXT: RationaleContextInput = { baseCapacity: 761404, scenarioCapacity: 761404 };

const RICH_REPORT: RationaleReportInput = {
  headline: 'Scenario lifts borrowing capacity by $184,250.',
  subHeadline: 'Two levers carry the uplift.',
  bullets: [
    { what: 'Consolidate the car loan', why: 'Serviced over 30 years.', capacityImpact: 96400, cashflowNote: 'Repayments fall by $644/mo.', severity: 'positive' },
    { what: 'Release equity', why: 'At the revised valuation.', capacityImpact: 42950, severity: 'caution' },
  ],
  reconciliation: 'Base + levers = scenario.',
  sequence: [{ step: 1, action: 'Order a valuation', detail: 'Desktop.', owner: 'broker' }],
  caveats: ['Valuation must hold.'],
  capitalFlow: {
    totalRouted: 120000, totalAvailable: 120000, monthlyServicingDelta: 812, debtBalanceDelta: 120000,
    overcommitted: true, remainder: 0,
    legs: [{ sourceLabel: 'Equity', sinkLabel: 'Deposit', sinkType: 'deposit', amount: 120000, monthlyServicingDelta: 812, debtBalanceDelta: 120000, note: 'At 6.4%.' }],
  },
};
const RICH_CONTEXT: RationaleContextInput = {
  baseCapacity: 761404, scenarioCapacity: 945654, effectivePurchasePower: 918000,
  targetPurchasePrice: 900000, meetsTarget: true, scenarioName: 'Consolidate',
  valuationAssumptions: [{ address: '14 Wattle Grove', originalValue: 700000, newValue: 780000, basis: 'desktop', source: 'CoreLogic' }],
  crossCollatPool: {
    enabled: true, propertyAddresses: ['A', 'B'], blendedTargetLVR: 0.8, lenderMaxLVR: 0.9,
    allocationStrategy: 'highest_equity_first', totalPoolValue: 1480000, totalPoolDebt: 950000, poolReleaseAmount: 234000,
  },
};

const baseline = composeStrategyRationale(BASELINE_REPORT, BASELINE_CONTEXT, '28 September 2026, 20:15');
const rich = composeStrategyRationale(RICH_REPORT, RICH_CONTEXT, '28 September 2026, 20:15');

const html = (doc: typeof baseline) => renderStrategyRationaleBody({
  document: doc,
  clientName: 'Samuel Lavis',
  palette: resolveReportPalette({ preset: 'signature' }),
  company: resolveCompanyBlock(SAMPLE_GLOBAL_SETTINGS.contactDetails as never, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
  masthead: mastheadFor(SAMPLE_GLOBAL_SETTINGS.contactDetails as never),
});
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

describe('the brief says what the jsPDF brief says', () => {
  // Each is a literal the generator prints; the first expectation proves the
  // scan is reading the generator, the second that the composer prints it.
  const LITERALS = [
    'Strategy Rationale Brief',
    'Borrowing Capacity Scenario — Finance Hand-off',
    'Pre-scenario',
    ' vs base',
    'Loan + cash − costs',
    'Baseline scenario — no levers applied.',
    'How the math reconciles',
    'No execution steps required — baseline scenario.',
    'Caveats & assumptions',
    'POOL OVERCOMMITTED — sinks were clamped to available pool.',
    'Finance must validate each basis before submission. AVM/desktop figures are advisory only.',
    'Equity release methodology — cross-collateralised',
    'Net capital impact: ',
    ' capacity',
  ];
  const composed = [baseline, rich, composeStrategyRationale(RICH_REPORT, { ...RICH_CONTEXT, targetPurchasePrice: null }, '')]
    .map((d) => text(html(d))).join(' ');

  it.each(LITERALS)('prints "%s"', (literal) => {
    expect(LEGACY).toContain(literal);
    expect(composed).toContain(literal);
  });

  it('reproduces the Samuel Lavis baseline brief, line for line', () => {
    const body = text(html(baseline));
    for (const line of [
      'Baseline scenario — no levers applied. Borrowing capacity remains at $761,404.',
      'Base capacity', '$761,404', 'Pre-scenario', 'Scenario capacity', '+$0 vs base',
      'What we propose & why (0 levers)', 'Baseline scenario — no levers applied.',
      'How the math reconciles', 'No levers applied — no per-lever attribution to reconcile.',
      'Recommended execution sequence (0 steps)', 'No execution steps required — baseline scenario.',
      'Caveats & assumptions',
      'Standard lender verification applies — payslips, bureau check, valuations, and contract review must all be completed before unconditional approval.',
      'Samuel Lavis', '28 September 2026, 20:15',
    ]) {
      expect(body, line).toContain(line);
    }
  });

  it('prints the purchase-power box only where the modeller has one, with the target as it is stated', () => {
    expect(baseline.kpis.map((k) => k.label)).toEqual(['Base capacity', 'Scenario capacity']);
    expect(rich.kpis[2]).toMatchObject({ label: 'Purchase power', value: '$918,000', foot: 'Target $900,000 ✓' });
  });

  it('keeps every lever, step, leg, valuation and the pool method', () => {
    const body = text(html(rich));
    for (const s of [
      'Consolidate the car loan', 'Serviced over 30 years.', '+$96,400 capacity', 'Cash-flow: Repayments fall by $644/mo.',
      'Release equity', 'CAUTION', 'Order a valuation — Desktop.', 'BROKER',
      'Capital allocation flow (1 leg)', 'Equity → Deposit', '+$812/mo', '+$120,000 debt', 'At 6.4%.',
      'Valuation assumptions (1 override)', '14 Wattle Grove: $700,000 → $780,000 (+$80,000) — basis: Desktop val · source: CoreLogic',
      'Pool of 2 securities (A; B).', 'Pool release: $234,000.',
    ]) {
      expect(body, s).toContain(s);
    }
  });

  it('names the file as the jsPDF brief always has', () => {
    expect(LEGACY).toContain('Strategy_Rationale_${safeName}_${dateStr}.pdf');
    expect(strategyRationaleFileName('Samuel Lavis', '2026-09-28T10:15:00Z')).toBe('Strategy_Rationale_Samuel_Lavis_2026-09-28.pdf');
  });
});

describe('the typeset brief is one memo', () => {
  it('sets its parts as subheads in a single chapter', () => {
    const h = html(baseline);
    expect((h.match(/<section class="chapter/g) ?? []).length).toBe(1);
    expect(h).toContain('<h2>What we propose &amp; why (0 levers)</h2>');
  });

  it('keeps a heading with its opening block', () => {
    expect(html(baseline)).toMatch(/<div class="keep-together"><h2>How the math reconciles<\/h2><p>/);
  });

  it('escapes what arrives', () => {
    const read = readStrategyRationale({ ...baseline, headline: '<script>x</script>' });
    expect(read.ok).toBe(true);
    if (read.ok) expect(html(read.document)).not.toContain('<script>');
  });
});

describe('the server reads the brief back', () => {
  it('as the composer made it', () => {
    for (const doc of [baseline, rich]) {
      const read = readStrategyRationale(JSON.parse(JSON.stringify(doc)));
      expect(read).toEqual({ ok: true, document: doc });
    }
  });

  it('refuses one with no headline, and bounds what it keeps', () => {
    expect(readStrategyRationale({}).ok).toBe(false);
    const read = readStrategyRationale({ headline: 'x'.repeat(10_000), bullets: Array.from({ length: 100 }, () => ({ what: 'w' })) });
    expect(read.ok && read.document.headline.length).toBe(4_000);
    expect(read.ok && read.document.bullets.length).toBe(40);
  });
});

describe('the route', () => {
  const clientId = '3f2b8a1c-4d5e-4f60-8a7b-9c0d1e2f3a4b';

  it('draws the Snapshot for every caller that names no document', () => {
    const parsed = parseRenderRequest({ clientId });
    expect(parsed.ok && parsed.request.document).toBe('snapshot');
    expect(parsed.ok && parsed.request.rationale).toBeNull();
  });

  it('reads the brief when it is asked for, and refuses a document it does not draw', () => {
    const parsed = parseRenderRequest({ clientId, document: 'strategy_rationale', rationale: baseline });
    expect(parsed.ok && parsed.request.rationale?.headline).toBe(baseline.headline);
    expect(parseRenderRequest({ clientId, document: 'strategy_rationale' }).ok).toBe(false);
    expect(parseRenderRequest({ clientId, document: 'something_else' })).toEqual({ ok: false, error: 'unknown document' });
  });

  it('echoes the document it drew, so an older deployment cannot pass a Snapshot off as the brief', () => {
    const handler = readFileSync(
      resolve(__dirname, '../../../../../supabase/functions/render-borrowing-capacity-pdf/index.ts'),
      'utf8',
    );
    expect(handler).toContain('document: request.document,');
    const deliver = readFileSync(resolve(__dirname, '../deliverStrategyRationale.ts'), 'utf8');
    expect(deliver).toContain("data.document === 'strategy_rationale'");
  });
});

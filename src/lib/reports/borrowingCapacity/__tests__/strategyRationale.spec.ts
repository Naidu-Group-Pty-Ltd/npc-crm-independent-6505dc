/**
 * The Strategy Rationale Brief, typeset (BORROWING_CAPACITY.md §17).
 *
 * The owner's instruction for moving it off jsPDF was that the content is
 * "predominantly just a transition of that information into the new template
 * structure" — nothing added, nothing reworded. So these specs hold the
 * typeset brief to the jsPDF brief's own words: every literal the generator
 * prints is found in its source and then in what the composer produces, and
 * the Samuel Lavis baseline brief of 28 Sep 2026 is reproduced line for line.
 *
 * The audit of 1 Oct 2026 (§22) changed some of those words, in both briefs
 * at once: "maths", "Cash flow", a target cleared in words rather than a tick,
 * "Desktop valuation", and the over-committed pool in plain English. Where the
 * jsPDF brief now prints a constant the composer exports, rather than a
 * literal of its own, the parity is by construction and is asserted as the
 * import.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';

import {
  BASIS_LABEL,
  composeStrategyRationale,
  POOL_OVERCOMMITTED_NOTE,
  readStrategyRationale,
  RECONCILE_TITLE,
  strategyRationaleFileName,
  type RationaleContextInput,
  type RationaleReportInput,
} from '../strategyRationale.pure';
import { MEMO_CHAPTER_CLASS, SECTION_SUBHEAD_CLASS } from '@/lib/reportDesign/primitives.pure';
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
    'Caveats & assumptions',
    'Finance must validate each basis before submission. AVM/desktop figures are advisory only.',
    'Clears the ',
    'Cash flow: ',
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

  it.each([
    ['RECONCILE_TITLE', RECONCILE_TITLE],
    ['POOL_OVERCOMMITTED_NOTE', POOL_OVERCOMMITTED_NOTE],
    ['BASIS_LABEL', BASIS_LABEL.desktop],
  ])('prints %s, which the jsPDF brief imports rather than restates', (name, value) => {
    expect(LEGACY).toMatch(new RegExp(`\\b${name}\\b`));
    expect(composed).toContain(value);
  });

  it('says it in the report\'s words, not the capital router\'s or a chip\'s (§22)', () => {
    for (const machine of ['math reconciles', 'Cash-flow', 'sinks', 'clamped', 'OVERCOMMITTED', 'Desktop val ', '✓', 'BROKER']) {
      expect(composed, machine).not.toContain(machine);
    }
  });

  it('reproduces the Samuel Lavis baseline brief\'s words', () => {
    const body = text(html(baseline));
    for (const line of [
      'Baseline scenario — no levers applied. Borrowing capacity remains at $761,404.',
      'Base capacity', '$761,404', 'Pre-scenario', 'Scenario capacity', '+$0 vs base',
      'Caveats & assumptions',
      'Standard lender verification applies — payslips, bureau check, valuations, and contract review must all be completed before unconditional approval.',
      'Samuel Lavis', '28 September 2026, 20:15',
    ]) {
      expect(body, line).toContain(line);
    }
  });

  /**
   * §22. The baseline brief headed its finding "Baseline scenario — no levers
   * applied." and said so three more times, under "(0 levers)", the
   * reconciliation and "(0 steps)". Both briefs now leave an empty part out,
   * and the empty sequence's line, which called any scenario with no steps a
   * baseline, is gone with it.
   */
  it('leaves out a part with nothing in it, in both briefs', () => {
    const body = text(html(baseline));
    for (const empty of ['(0 levers)', '(0 steps)', RECONCILE_TITLE, 'No levers applied — no per-lever attribution', 'No execution steps required']) {
      expect(body, empty).not.toContain(empty);
    }
    expect(body.match(/no levers applied/gi)).toHaveLength(1);
    expect(LEGACY).not.toMatch(/doc\.text\('(?:No execution steps required|Baseline scenario — no levers applied)/);
    expect(LEGACY).toContain('if (report.bullets.length > 0) {');
    expect(LEGACY).toContain('if (report.sequence.length > 0) {');
    const noSteps = text(html(composeStrategyRationale({ ...RICH_REPORT, sequence: [] }, RICH_CONTEXT, '')));
    expect(noSteps).not.toContain('baseline scenario');
    expect(noSteps).toContain(RECONCILE_TITLE);
  });

  it('prints the purchase-power box only where the modeller has one, with the target as it is stated', () => {
    expect(baseline.kpis.map((k) => k.label)).toEqual(['Base capacity', 'Scenario capacity']);
    expect(rich.kpis[2]).toMatchObject({ label: 'Purchase power', value: '$918,000', foot: 'Clears the $900,000 target' });
    const short = composeStrategyRationale(RICH_REPORT, { ...RICH_CONTEXT, meetsTarget: false }, '');
    expect(short.kpis[2].foot).toBe('Short of the $900,000 target');
  });

  it('keeps every lever, step, leg, valuation and the pool method', () => {
    const body = text(html(rich));
    for (const s of [
      'Consolidate the car loan', 'Serviced over 30 years.', '+$96,400 capacity', 'Cash flow: Repayments fall by $644/mo.',
      'Release equity', 'CAUTION', 'Order a valuation — Desktop.', 'Broker',
      'Capital allocation flow (1 leg)', 'Equity → Deposit', '+$812/mo', '+$120,000 debt', 'At 6.4%.',
      'Valuation assumptions (1 override)', '14 Wattle Grove: $700,000 → $780,000 (+$80,000) — basis: Desktop valuation · source: CoreLogic',
      'Pool of 2 securities (A; B).', 'Pool release: $234,000.',
    ]) {
      expect(body, s).toContain(s);
    }
  });

  it('names the typeset file readably, and the jsPDF brief keeps its own name (§22)', () => {
    expect(strategyRationaleFileName('Samuel Lavis', '2026-09-28T10:15:00Z')).toBe('Strategy Rationale Brief - Samuel Lavis - 28 Sep 2026.pdf');
    expect(strategyRationaleFileName('', '2026-09-28')).toBe('Strategy Rationale Brief - Client - 28 Sep 2026.pdf');
    expect(LEGACY).toContain('Strategy_Rationale_${safeName}_${dateStr}.pdf');
  });
});

describe('the typeset brief is one memo', () => {
  it('sets its parts as subheads in a single chapter', () => {
    const h = html(rich);
    expect((h.match(/<section class="chapter/g) ?? []).length).toBe(1);
    expect(h).toContain(`<h2 class="${SECTION_SUBHEAD_CLASS}">What we propose &amp; why (2 levers)</h2>`);
  });

  /**
   * §22. Its header repeated the cover word for word under a "SECTION 01" that
   * numbered the only section, and the running head said "Strategy Rationale
   * Brief" on both sides of every page.
   */
  it('opens on its finding, and the running head names the client', () => {
    const h = html(rich);
    expect(h).toMatch(new RegExp(`<section class="chapter[^"]*\\b${MEMO_CHAPTER_CLASS}\\b`));
    expect(h).toContain('data-chapter-title="Samuel Lavis"');
    expect(h).toContain('<h1>Scenario lifts borrowing capacity by $184,250.</h1>');
    expect(h).toContain('<div class="chapter-dek">Two levers carry the uplift.</div>');
    expect(h).not.toContain('class="chapter-no"');
    expect(h).not.toMatch(/<h1>Strategy Rationale Brief<\/h1>/);
  });

  it('keeps a heading with its opening block', () => {
    expect(html(rich)).toMatch(new RegExp(`<div class="keep-together"><h2 class="${SECTION_SUBHEAD_CLASS}">How the maths reconciles</h2><p>`));
  });

  /**
   * §22. A four-step sequence was kept whole with its heading, and moved to
   * the next page whole, leaving a quarter of a page white above it.
   */
  it('keeps a long table by its height, with its heading on its first rows', () => {
    const long = composeStrategyRationale({
      ...RICH_REPORT,
      sequence: Array.from({ length: 12 }, (_, i) => ({ step: i + 1, action: `Step ${i + 1} of the execution, set out in full so the row wraps`, owner: 'finance' as const })),
    }, RICH_CONTEXT, '');
    const h = html(long);
    const at = h.indexOf('Recommended execution sequence (12 steps)');
    expect(h.slice(at - 60, at)).not.toContain('keep-together');
    expect(h).toContain('<tbody class="lead">');
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

/**
 * What the Strategy Rationale gives a person deciding (28 Sep 2026).
 *
 * Measured on Masline Nyawo's brief and Snapshot of that day: every scenario
 * read as a loss of $300k–$590k, for three reasons, each pinned here.
 *
 * 1. The Calculator assessed her living costs at $0. The saved assessment's
 *    `expense_method` said 'declared' whatever had been chosen, the modal
 *    restored it, and she has no declared expenses on file. The scenario
 *    engine floors at HEM, so every scenario was measured against a base
 *    about $400k too high.
 * 2. The advisor "cleared the DTI constraint" by switching ON a 10x cap for a
 *    client the Calculator assessed without one, which cut capacity to
 *    exactly 10.00x.
 * 3. The brief printed capacity beside purchase power and never said they
 *    answer different questions.
 *
 * And the jsPDF brief printed every arrow as `!’`, "2 securityies", and an
 * address cut to "Innisfa".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';
import { advisorRationaleFromCard } from '@/components/borrowing-capacity/scenarios/advisorRationale.pure';
import {
  DEFAULT_EXPENSE_METHOD,
  readExpenseMethodChoice,
  recordedExpenseMethod,
  restorableExpenseMethod,
} from '@/lib/borrowingCapacityExpenseMethod.pure';
import {
  dtiOverrideTightens,
  withholdTighteningDtiOverride,
} from '@/lib/advisorDtiOverride.pure';
import { standardFontText } from '@/lib/pdf/standardFontText';

import {
  ADVISOR_OPTIONS_NOTE,
  CAPACITY_READING_NOTE,
  EQUITY_RELEASE_READING_NOTE,
  advisorOptionLine,
  composeAdvisorSection,
  composeStrategyRationale,
  rationaleReadingNote,
  readStrategyRationale,
  type RationaleContextInput,
  type RationaleReportInput,
} from '../strategyRationale.pure';
import { renderStrategyRationaleBody } from '../strategyRationaleRender.pure';
import { SAMPLE_GLOBAL_SETTINGS } from './fixtures/sampleAssessment';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('the living-expense method is the one the adviser chose', () => {
  it('records the choice, and what it applied', () => {
    expect(readExpenseMethodChoice('hybrid')).toBe('hybrid');
    expect(readExpenseMethodChoice('declared_higher')).toBeNull();
    expect(recordedExpenseMethod({ choice: 'hybrid', hemBenchmark: 3360, declaredExpenses: 0, fallback: 'declared' })).toBe('hem');
    expect(recordedExpenseMethod({ choice: 'hybrid', hemBenchmark: 3360, declaredExpenses: 4200, fallback: 'declared' })).toBe('declared_higher');
    expect(recordedExpenseMethod({ choice: 'declared', hemBenchmark: 3360, declaredExpenses: 0, fallback: 'declared' })).toBe('declared');
    // An older browser sends no choice, and the column says what it said before.
    expect(recordedExpenseMethod({ choice: null, hemBenchmark: 3360, declaredExpenses: 0, fallback: 'declared' })).toBe('declared');
  });

  it('restores only a recorded choice, never the old column stamp', () => {
    expect(DEFAULT_EXPENSE_METHOD).toBe('hybrid');
    expect(restorableExpenseMethod({ expenseMethod: 'declared' })).toBe('declared');
    expect(restorableExpenseMethod({ calculationMode: 'bank' })).toBe('hybrid');
    expect(restorableExpenseMethod(null)).toBe('hybrid');
  });

  it('the modal restores from the recorded choice and sends the method with every calculation', () => {
    const modal = read('../../../../components/borrowing-capacity/BorrowingCapacityModal.tsx');
    expect(modal).toContain('setExpenseMethod(restorableExpenseMethod(assumptions));');
    expect(modal).not.toMatch(/assessment\.expense_method/);
    expect(modal.match(/livingExpenses: effectiveExpensesForCalc,\n\s+expenseMethod,/g)?.length).toBe(2);
  });

  it('the server stores the choice beside the lender settings and the applied method in the column', () => {
    const fn = read('../../../../../supabase/functions/calculate-borrowing-capacity/index.ts');
    expect(fn).toContain('expenseMethod: expenseMethodChoice,');
    expect(fn).toContain('expense_method: expenseMethodRecorded,');
  });
});

describe('the advisor may relax a DTI cap, never impose one', () => {
  const off = { dtiCapEnabled: false, dtiCapLimit: 6 };
  const on6 = { dtiCapEnabled: true, dtiCapLimit: 6 };

  it('reads which proposals tighten', () => {
    expect(dtiOverrideTightens(off, { enabled: true, value: 10 })).toBe(true);
    expect(dtiOverrideTightens(on6, { enabled: true, value: 8 })).toBe(false);
    expect(dtiOverrideTightens(on6, { enabled: true, value: 5 })).toBe(true);
    expect(dtiOverrideTightens(off, { enabled: false, value: 10 })).toBe(false);
    expect(dtiOverrideTightens(off, null)).toBe(false);
  });

  it('withholds the cap, keeps the lender, and says why', () => {
    const { adjustments, note } = withholdTighteningDtiOverride(
      { dtiCapOverride: { enabled: true, value: 10, lenderProfile: 'non_bank' }, lenderProfile: null },
      off,
    );
    expect(adjustments.dtiCapOverride).toBeNull();
    expect(adjustments.lenderProfile).toBe('non_bank');
    expect(note).toMatch(/^DTI cap of 10x not applied: the assessment applies no DTI cap/);
    const untouched = { dtiCapOverride: { enabled: true, value: 8 } };
    expect(withholdTighteningDtiOverride(untouched, on6)).toEqual({ adjustments: untouched, note: null });
  });

  it('is applied before the engine measures, on the server and in the browser', () => {
    const preview = read('../../../../../supabase/functions/bc-scenario-agent/aiScenarioPreview.ts');
    expect(preview.indexOf('withholdTighteningDtiOverride(scenario.adjustments'))
      .toBeLessThan(preview.indexOf('const deltas = adjustmentsToDeltas(scenario.adjustments)'));
    const agent = read('../../../../components/borrowing-capacity/scenarios/BCScenarioAgent.tsx');
    expect(agent).toContain('withholdTighteningDti(normalizeAIScenario(rawScenario))');
    expect(agent).toContain('withholdTighteningDti(normalizeAIScenario(scenario))');
  });

  it('and the prompt stops asking for it where no cap is enforced', () => {
    const fn = read('../../../../../supabase/functions/bc-scenario-agent/index.ts');
    expect(fn).toContain("Do NOT set 'dtiCapOverride'");
  });
});

/** Masline's three cards as the agent carries them on Apply. */
const CARD = {
  name: 'Valuation Uplift to 80% Deposit',
  reasoning: 'Pool Cahill St and Delonax Ct to release ~$186k.',
  executionRisk: 'high',
  engineValidation: {
    validationIssues: [
      { deltaId: 'dti-cap', deltaType: 'dti_cap_change', severity: 'warn', message: 'DTI cap of 10x not applied: the assessment applies no DTI cap, so a 10x cap would lower capacity rather than lift it. The lender chosen must still accept this client\'s debt-to-income ratio; confirm its policy before submission.' },
      { deltaId: 'dti-honest', deltaType: 'dti_cap_change', severity: 'warning', message: 'Honest DTI 10.60× (>6× APRA trigger). Numerator $1,240,000' },
    ],
  },
  advisorOptions: [
    { name: '90% LVR Purchase + Debt Cleanse', applied: false, capacity: 761738, purchasePower: 874178, targetPrice: 900000, meetsTarget: false, shortfall: 25822, executionRisk: 'high' },
    { name: 'Valuation Uplift to 80% Deposit', applied: true, capacity: 669738, purchasePower: 843893, targetPrice: 900000, meetsTarget: false, shortfall: 56107, executionRisk: 'high' },
    { name: 'Portfolio Restructure & Clean Slate', applied: false, capacity: 951241, purchasePower: 1002622, targetPrice: 900000, meetsTarget: true, shortfall: 0, executionRisk: 'medium' },
  ],
};

describe('the brief sets the choice beside the alternatives', () => {
  const section = composeAdvisorSection(advisorRationaleFromCard(CARD))!;

  it('lists every option with the engine\'s figures, the applied one marked', () => {
    expect(section.optionsTitle).toBe('Options the advisor put forward (3)');
    expect(section.options.map(advisorOptionLine)).toEqual([
      '90% LVR Purchase + Debt Cleanse — capacity $761,738 · purchase power $874,178 · Short by $25,822 · HIGH risk',
      'Valuation Uplift to 80% Deposit (applied) — capacity $669,738 · purchase power $843,893 · Short by $56,107 · HIGH risk',
      'Portfolio Restructure & Clean Slate — capacity $951,241 · purchase power $1,002,622 · Clears $900,000 · MEDIUM risk',
    ]);
  });

  it('quotes the advisor\'s guardrails and leaves the engine\'s working figures on the card', () => {
    expect(section.cautionsTitle).toBe('What the calculation engine flagged');
    expect(section.cautions).toHaveLength(1);
    expect(section.cautions[0]).toMatch(/^DTI cap of 10x not applied/);
  });

  it('offers no table of one', () => {
    const one = composeAdvisorSection(advisorRationaleFromCard({ ...CARD, advisorOptions: CARD.advisorOptions.slice(1, 2) }))!;
    expect(one.options).toEqual([]);
    expect(one.optionsTitle).toBe('');
  });
});

const REPORT: RationaleReportInput = {
  headline: 'The selected combination reduces borrowing capacity from $856,932 to $669,738 (-$187,194).',
  bullets: [{ what: 'Release pooled equity', why: 'Pools two securities.', capacityImpact: -99000, severity: 'caution' }],
  reconciliation: 'Base + levers = scenario.',
  sequence: [],
  caveats: [],
};
const POOL = {
  enabled: true, propertyAddresses: ['17 Cahill Street', '6/2 Delonax Court'], blendedTargetLVR: 0.8, lenderMaxLVR: 0.95,
  allocationStrategy: 'highest_equity_first' as const, totalPoolValue: 900000, totalPoolDebt: 534000, poolReleaseAmount: 186000,
};
const CONTEXT: RationaleContextInput = {
  baseCapacity: 856932, scenarioCapacity: 669738, effectivePurchasePower: 843893,
  targetPurchasePrice: 900000, meetsTarget: false, crossCollatPool: POOL,
  advisor: advisorRationaleFromCard(CARD),
};

describe('the brief says how to read capacity beside purchase power', () => {
  it('where capacity falls and purchase power is reported, and names released equity only where it is released', () => {
    expect(rationaleReadingNote(CONTEXT)).toBe(`${CAPACITY_READING_NOTE} ${EQUITY_RELEASE_READING_NOTE}`);
    expect(rationaleReadingNote({ ...CONTEXT, crossCollatPool: null })).toBe(CAPACITY_READING_NOTE);
    expect(rationaleReadingNote({ ...CONTEXT, scenarioCapacity: 900000 })).toBeNull();
    expect(rationaleReadingNote({ ...CONTEXT, effectivePurchasePower: null })).toBeNull();
  });

  it('is drawn under the figures by the typeset brief, the jsPDF brief and the panel', () => {
    const doc = composeStrategyRationale(REPORT, CONTEXT, '29 September 2026, 02:03');
    const html = renderStrategyRationaleBody({
      document: doc,
      clientName: 'Masline Nyawo',
      palette: resolveReportPalette({ preset: 'signature' }),
      company: resolveCompanyBlock(SAMPLE_GLOBAL_SETTINGS.contactDetails as never, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
      masthead: mastheadFor(SAMPLE_GLOBAL_SETTINGS.contactDetails as never),
    });
    const body = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
    expect(body.indexOf('Purchase power')).toBeLessThan(body.indexOf(CAPACITY_READING_NOTE));
    for (const s of ['Options the advisor put forward (3)', 'Valuation Uplift to 80% Deposit (applied)', 'Clears $900,000', ADVISOR_OPTIONS_NOTE, 'What the calculation engine flagged']) {
      expect(body, s).toContain(s);
    }
    expect(read('../../../../components/borrowing-capacity/scenarios/StrategyRationalePDF.ts')).toContain('rationaleReadingNote(context)');
    expect(read('../../../../components/borrowing-capacity/scenarios/StrategyRationalePanel.tsx')).toContain('rationaleReadingNote(pdfContext)');
  });

  it('survives the server\'s read', () => {
    const doc = composeStrategyRationale(REPORT, CONTEXT, '');
    expect(readStrategyRationale(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, document: doc });
  });
});

describe('what the jsPDF brief prints', () => {
  it('prints an arrow, a tick and a minus sign in the built-in font\'s characters', () => {
    expect(standardFontText('Revalue 17 Cahill Street → $480,000')).toBe('Revalue 17 Cahill Street to $480,000');
    expect(standardFontText('Target $900,000 ✓')).toBe('Target $900,000 met');
    expect(standardFontText('−$1,463/mo')).toBe('-$1,463/mo');
    expect(standardFontText('Plain text — unchanged · kept')).toBe('Plain text — unchanged · kept');
  });

  it('guards every jsPDF document that prints a lever label', () => {
    for (const f of [
      '../../../../components/borrowing-capacity/scenarios/StrategyRationalePDF.ts',
      '../../../../components/borrowing-capacity/BorrowingCapacityPDFReport.tsx',
    ]) {
      expect(read(f), f).toContain('guardStandardFontText(new jsPDF(');
    }
  });

  it('names a property by its whole street line and counts securities in English', () => {
    const modeller = read('../../../../components/borrowing-capacity/scenarios/StrategyScenarioModeling.tsx');
    expect(modeller).not.toContain('address?.slice(0, 25)');
    expect(modeller).not.toMatch(/\(\$\{memberIds\.length\} security\)/);
    for (const f of [
      '../../../../utils/strategyRationaleEngine.ts',
      '../../../../components/borrowing-capacity/scenarios/StrategyRationalePDF.ts',
      '../../../../../supabase/functions/_shared/reports/borrowingCapacity/strategyRationale.pure.ts',
    ]) {
      expect(read(f), f).not.toContain("'' : 'ies'");
    }
  });
});

/**
 * The Strategy Advisor's reasoning, carried with the scenario it explains.
 *
 * The advisor is told to write each card's `reasoning` "as if it will be
 * quoted directly into a finance handoff (because it will)", and nothing
 * quoted it: applying a card moved its levers and left its explanation on the
 * card. These specs hold the one composer (`composeAdvisorSection`) to every
 * surface that prints it — the panel's copied text, the typeset brief, the
 * jsPDF brief, the saved scenario and the Snapshot's scenario pages — and hold
 * the brief without an advisor to exactly what it printed before.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';
import { advisorRationaleFromCard } from '@/components/borrowing-capacity/scenarios/advisorRationale.pure';

import {
  ADVISOR_ADJUSTED_NOTE,
  ADVISOR_PROVENANCE_NOTE,
  ADVISOR_SECTION_TITLE,
  composeAdvisorSection,
  composeStrategyRationale,
  readStrategyRationale,
  type RationaleContextInput,
  type RationaleReportInput,
} from '../strategyRationale.pure';
import { renderStrategyRationaleBody } from '../strategyRationaleRender.pure';
import { toScenarioRows } from '../normalise.pure';
import { SAMPLE_GLOBAL_SETTINGS } from './fixtures/sampleAssessment';

const REPORT: RationaleReportInput = {
  headline: 'Scenario lifts borrowing capacity by $112,400.',
  bullets: [{ what: 'Consolidate the car loan', why: 'Serviced over 30 years.', capacityImpact: 112400, severity: 'positive' }],
  reconciliation: 'Base + levers = scenario.',
  sequence: [{ step: 1, action: 'Pay out the car loan at settlement', owner: 'finance' }],
  caveats: ['Standard lender verification applies.'],
};
const CONTEXT: RationaleContextInput = { baseCapacity: 548000, scenarioCapacity: 660400 };

/** A card as the advisor's tool call returns it, for a $650k investment purchase. */
const CARD = {
  name: 'Consolidate and buy at $650k',
  reasoning: 'Paying out the **$18,400 car loan** removes $612/mo of commitments, which at the assessment rate is worth ~$112k of capacity.\n\nThat takes her past the $650k target with the 20% deposit she holds, avoiding LMI.',
  estimatedImpact: '+$115K',
  executionRisk: 'medium',
  evidenceRequired: ['Car loan payout letter from Toyota Finance', 'Three months of offset statements showing the $130k deposit'],
  rejectedLevers: [{ lever: 'Interest-only on the home loan', reason: 'Her lender caps owner-occupier IO at 1 year.' }],
  adjustments: {},
};

const html = (context: RationaleContextInput) => renderStrategyRationaleBody({
  document: composeStrategyRationale(REPORT, context, '28 September 2026, 20:15'),
  clientName: 'Samuel Lavis',
  palette: resolveReportPalette({ preset: 'signature' }),
  company: resolveCompanyBlock(SAMPLE_GLOBAL_SETTINGS.contactDetails as never, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
  masthead: mastheadFor(SAMPLE_GLOBAL_SETTINGS.contactDetails as never),
});
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

describe('an advisor card becomes the rationale\'s reasoning', () => {
  const input = advisorRationaleFromCard(CARD)!;

  it('carries the reasoning, risk, evidence and set-aside levers — and not the model\'s own estimate', () => {
    expect(input).toMatchObject({
      scenarioName: 'Consolidate and buy at $650k',
      executionRisk: 'medium',
      evidenceRequired: CARD.evidenceRequired,
      rejectedLevers: CARD.rejectedLevers,
      adjustedSince: false,
    });
    expect(JSON.stringify(input)).not.toContain('+$115K');
  });

  it('is nothing where the card wrote no reasoning', () => {
    expect(advisorRationaleFromCard({ ...CARD, reasoning: '   ' })).toBeNull();
    expect(advisorRationaleFromCard(null)).toBeNull();
  });

  it('reads an older card shape without trusting it', () => {
    const read = advisorRationaleFromCard({ reasoning: 'Why.', executionRisk: 'extreme', evidenceRequired: 'x', rejectedLevers: [null, { lever: 'IO' }] });
    expect(read).toMatchObject({ scenarioName: 'Suggested scenario', executionRisk: null, evidenceRequired: [], rejectedLevers: [{ lever: 'IO', reason: '' }] });
  });
});

describe('the advisor section is worded once', () => {
  const section = composeAdvisorSection(advisorRationaleFromCard(CARD))!;

  it('keeps every paragraph the advisor wrote, as print', () => {
    expect(section.title).toBe(ADVISOR_SECTION_TITLE);
    expect(section.scenarioLine).toBe('Scenario: Consolidate and buy at $650k');
    expect(section.paragraphs).toEqual([
      'Paying out the $18,400 car loan removes $612/mo of commitments, which at the assessment rate is worth ~$112k of capacity.',
      'That takes her past the $650k target with the 20% deposit she holds, avoiding LMI.',
    ]);
    expect(section.riskLine).toBe('Execution risk: MEDIUM');
    expect(section.evidenceTitle).toBe('Evidence required before submission (2 items)');
    expect(section.rejected).toEqual(['Interest-only on the home loan — Her lender caps owner-occupier IO at 1 year.']);
  });

  it('always says who wrote it, and says when the levers have moved since', () => {
    expect(section.notes).toEqual([ADVISOR_PROVENANCE_NOTE]);
    const moved = composeAdvisorSection({ ...advisorRationaleFromCard(CARD)!, adjustedSince: true })!;
    expect(moved.notes).toEqual([ADVISOR_PROVENANCE_NOTE, ADVISOR_ADJUSTED_NOTE]);
  });
});

describe('the Strategy Rationale Brief prints it', () => {
  const withAdvisor = { ...CONTEXT, advisor: advisorRationaleFromCard(CARD) };

  it('under the capacity figures and before the per-lever account', () => {
    const body = text(html(withAdvisor));
    const at = (s: string) => body.indexOf(s);
    for (const s of [
      ADVISOR_SECTION_TITLE, 'Scenario: Consolidate and buy at $650k',
      'Paying out the $18,400 car loan removes $612/mo',
      'avoiding LMI.', 'Execution risk: MEDIUM',
      'Car loan payout letter from Toyota Finance',
      'Interest-only on the home loan — Her lender caps owner-occupier IO at 1 year.',
      ADVISOR_PROVENANCE_NOTE,
    ]) expect(body, s).toContain(s);
    expect(at('Scenario capacity')).toBeLessThan(at(ADVISOR_SECTION_TITLE));
    expect(at(ADVISOR_SECTION_TITLE)).toBeLessThan(at('What we propose & why'));
  });

  it('and a brief with no advisor is exactly the brief it was', () => {
    expect(html({ ...CONTEXT, advisor: null })).toBe(html(CONTEXT));
    expect(text(html(CONTEXT))).not.toContain(ADVISOR_SECTION_TITLE);
  });

  it('survives the server\'s read, and the read will not drop the provenance line', () => {
    const doc = composeStrategyRationale(REPORT, withAdvisor, '');
    const read = readStrategyRationale(JSON.parse(JSON.stringify(doc)));
    expect(read).toEqual({ ok: true, document: doc });
    const tampered = readStrategyRationale({ ...doc, advisor: { ...doc.advisor, notes: ['Prepared by our credit team.'] } });
    expect(tampered.ok && tampered.document.advisor?.notes).toEqual([ADVISOR_PROVENANCE_NOTE]);
  });

  it('is drawn by the jsPDF brief and copied by the panel through the same composer', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, '../../../../components/borrowing-capacity/scenarios', p), 'utf8');
    expect(src('StrategyRationalePDF.ts')).toContain('composeAdvisorSection(context.advisor)');
    const panel = src('StrategyRationalePanel.tsx');
    expect(panel).toContain('composeAdvisorSection(advisor)');
    expect(panel).toContain("advisor: advisor ?? null");
  });
});

describe('a scenario saved from a card carries it to the Snapshot', () => {
  const base = { isBase: true, name: 'Base', result: { borrowingCapacity: 548000, monthlySurplus: 900 }, adjustedInputs: {} };
  const saved = {
    isBase: false,
    name: 'Consolidate and buy at $650k',
    result: { borrowingCapacity: 660400, monthlySurplus: 1512 },
    adjustedInputs: {},
    advisorRationale: advisorRationaleFromCard(CARD),
  };

  it('on the saved scenario\'s own row', () => {
    const rows = toScenarioRows([base, saved])!;
    expect(rows[1].advisor?.paragraphs[1]).toBe('That takes her past the $650k target with the 20% deposit she holds, avoiding LMI.');
    expect(rows[0].advisor).toBeUndefined();
  });

  it('and a scenario built by hand has no advisor field at all', () => {
    const rows = toScenarioRows([base, { ...saved, advisorRationale: undefined }])!;
    expect('advisor' in rows[1]).toBe(false);
  });

  it('the modeller writes it into every preset it hands on', () => {
    const modeller = readFileSync(
      resolve(__dirname, '../../../../components/borrowing-capacity/scenarios/StrategyScenarioModeling.tsx'),
      'utf8',
    );
    // Save, Apply to Calculator, and the presets sent to the Snapshot.
    expect(modeller.match(/^\s+advisorRationale,$/gm)?.length).toBe(3);
    expect(modeller).toContain('advisorRationaleFromCard(scenario)');
    expect(modeller).toContain('setAdvisorApplied(null);');
  });
});

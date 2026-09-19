import { describe, expect, it } from 'vitest';
import {
  JOURNEY_PHASES,
  deriveDealJourney,
  phaseForCategory,
  stageDisplayOf,
  type JourneyStage,
} from './dealJourney.pure';

const stage = (over: Partial<JourneyStage> & Pick<JourneyStage, 'stage_number' | 'stage_name'>): JourneyStage => ({
  stage_category: null,
  status: 'pending',
  display_order: over.stage_number,
  ...over,
});

/** The real House & Land template, abridged to what the derivation reads. */
const HNL = [
  stage({ stage_number: 1, stage_name: 'Lot Secured', stage_category: 'Land' }),
  stage({ stage_number: 2, stage_name: 'Contract Review', stage_category: 'Legal' }),
  stage({ stage_number: 3, stage_name: 'Final Deposit', stage_category: 'Deposit' }),
  stage({ stage_number: 4, stage_name: 'Subject to Finance', stage_category: 'Finance' }),
  stage({ stage_number: 5, stage_name: 'Unconditional', stage_category: 'Finance' }),
  stage({ stage_number: 6, stage_name: 'Settlement Date Agreed', stage_category: 'Legal' }),
  stage({ stage_number: 7, stage_name: 'Land Settlement', stage_category: 'Settlement' }),
];

const withStatuses = (template: JourneyStage[], statuses: JourneyStage['status'][]) =>
  template.map((s, i) => ({ ...s, status: statuses[i] ?? 'pending' }));

describe('phaseForCategory', () => {
  it('maps every template category onto a phase', () => {
    expect(phaseForCategory('Onboarding')).toBe('onboarding');
    expect(phaseForCategory('Advisory')).toBe('advisory');
    expect(phaseForCategory('Acquisition')).toBe('acquisition');
    expect(phaseForCategory('Land')).toBe('acquisition');
    expect(phaseForCategory('Deposit')).toBe('deposit');
    expect(phaseForCategory('Finance')).toBe('finance');
    expect(phaseForCategory('Legal')).toBe('legal');
    expect(phaseForCategory('Settlement')).toBe('settlement');
    expect(phaseForCategory('Commission')).toBe('finalised');
    expect(phaseForCategory('Finalised')).toBe('finalised');
  });

  it('is case-insensitive and honest about the unknown', () => {
    expect(phaseForCategory('LEGAL')).toBe('legal');
    expect(phaseForCategory(' settlement ')).toBe('settlement');
    expect(phaseForCategory('mystery')).toBeNull();
    expect(phaseForCategory(null)).toBeNull();
    expect(phaseForCategory(undefined)).toBeNull();
  });
});

describe('deriveDealJourney — the single current-stage rule', () => {
  it('badge and column can no longer disagree: an advanced deal with a stale stored stage reads from its stages', () => {
    // The reported case: stages moved to Contract Review while the stored
    // column still said Lot Secured — the card wore S1 inside Legal.
    const journey = deriveDealJourney({
      deal_type: 'house_and_land',
      current_stage: 'Lot Secured',
      current_stage_number: 1,
      stages: withStatuses(HNL, ['complete', 'in_progress']),
    });
    expect(journey.stageLabel).toBe('Contract Review');
    expect(journey.stageNumber).toBe(2);
    expect(journey.phaseId).toBe('legal');
  });

  it('prefers the in-progress stage over an earlier pending one', () => {
    const journey = deriveDealJourney({
      stages: withStatuses(HNL, ['complete', 'pending', 'pending', 'in_progress']),
    });
    expect(journey.stageLabel).toBe('Subject to Finance');
    expect(journey.phaseId).toBe('finance');
  });

  it('falls back to the first pending stage when nothing is in progress', () => {
    const journey = deriveDealJourney({
      stages: withStatuses(HNL, ['complete', 'complete', 'pending']),
    });
    expect(journey.stageLabel).toBe('Final Deposit');
    expect(journey.phaseId).toBe('deposit');
  });

  it('Land Settlement is the settlement phase, not the old Finance fall-through', () => {
    const journey = deriveDealJourney({
      deal_type: 'house_and_land',
      stages: withStatuses(HNL, ['complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'in_progress']),
    });
    expect(journey.phaseId).toBe('settlement');
    expect(journey.stageLabel).toBe('Land Settlement');
  });

  it('a refinance sitting at Commission Confirmed reads as finalised', () => {
    const journey = deriveDealJourney({
      deal_type: 'refinance',
      stages: [
        stage({ stage_number: 12, stage_name: 'Refinance Settlement Complete', stage_category: 'Finalised', status: 'complete', display_order: 12 }),
        stage({ stage_number: 13, stage_name: 'Commission Confirmed', stage_category: 'Commission', status: 'in_progress', display_order: 13 }),
      ],
    });
    expect(journey.phaseId).toBe('finalised');
  });

  it('orders by display_order, not stage_number', () => {
    const journey = deriveDealJourney({
      stages: [
        stage({ stage_number: 2, stage_name: 'Second', stage_category: 'Legal', display_order: 5 }),
        stage({ stage_number: 1, stage_name: 'First', stage_category: 'Deposit', display_order: 1 }),
      ],
    });
    expect(journey.stageLabel).toBe('First');
  });

  it('names the stage after the current one as next', () => {
    const journey = deriveDealJourney({
      stages: withStatuses(HNL, ['complete', 'in_progress']),
    });
    expect(journey.nextStage?.stage_name).toBe('Final Deposit');
  });
});

describe('deriveDealJourney — construction is derived from the build', () => {
  const finishedLand = withStatuses(HNL, Array(7).fill('complete') as JourneyStage['status'][]);
  const payments = [
    { stage_name: 'Deposit', paid_to_builder: true, display_order: 1 },
    { stage_name: 'Slab/Base', paid_to_builder: true, display_order: 2 },
    { stage_name: 'Frame', paid_to_builder: false, display_order: 3 },
  ];

  it('a settled-land H&L deal with an unpaid build stage is in construction, not finalised', () => {
    const journey = deriveDealJourney({
      deal_type: 'house_and_land',
      stages: finishedLand,
      buildPayments: payments,
    });
    expect(journey.phaseId).toBe('construction');
    expect(journey.stageLabel).toBe('Build: Frame');
    expect(journey.isSettled).toBe(false);
    expect(journey.build).toEqual({ total: 3, paid: 2, pct: 67, currentName: 'Frame' });
  });

  it('is finalised and settled once every build payment is made', () => {
    const journey = deriveDealJourney({
      deal_type: 'house_and_land',
      stages: finishedLand,
      buildPayments: payments.map((p) => ({ ...p, paid_to_builder: true })),
    });
    expect(journey.phaseId).toBe('finalised');
    expect(journey.isSettled).toBe(true);
  });

  it('never puts a non-H&L deal into construction', () => {
    const journey = deriveDealJourney({
      deal_type: 'existing_property',
      stages: [stage({ stage_number: 1, stage_name: 'Settlement Complete', stage_category: 'Finalised', status: 'complete' })],
      buildPayments: payments,
    });
    expect(journey.phaseId).toBe('finalised');
  });
});

describe('deriveDealJourney — finished and legacy deals', () => {
  it('a finished deal keeps its last completed stage as the label', () => {
    const journey = deriveDealJourney({
      deal_type: 'existing_property',
      stages: [
        stage({ stage_number: 6, stage_name: 'Settlement Confirmed', stage_category: 'Legal', status: 'complete', display_order: 6 }),
        stage({ stage_number: 7, stage_name: 'Settlement Complete', stage_category: 'Finalised', status: 'complete', display_order: 7 }),
      ],
    });
    expect(journey.phaseId).toBe('finalised');
    expect(journey.stageLabel).toBe('Settlement Complete');
    expect(journey.isSettled).toBe(true);
  });

  it('skipped stages settle the journey but never count as completed work', () => {
    const journey = deriveDealJourney({
      stages: [
        stage({ stage_number: 1, stage_name: 'A', stage_category: 'Deposit', status: 'complete' }),
        stage({ stage_number: 2, stage_name: 'B', stage_category: 'Finance', status: 'skipped' }),
      ],
    });
    expect(journey.stagesComplete).toBe(true);
    expect(journey.completedStages).toBe(1);
    expect(journey.progressPct).toBe(50);
  });

  it('a deal with no stages keeps the stored stage text and the legacy numeric phase', () => {
    expect(deriveDealJourney({ current_stage: 'Lot Secured', current_stage_number: 1, stages: [] }).phaseId).toBe('onboarding');
    expect(deriveDealJourney({ current_stage: 'Strategy', current_stage_number: 2 }).phaseId).toBe('advisory');
    const late = deriveDealJourney({ current_stage: 'Finance in Progress', current_stage_number: 4 });
    expect(late.phaseId).toBe('finance');
    expect(late.stageLabel).toBe('Finance in Progress');
    expect(deriveDealJourney({}).stageLabel).toBe('Not started');
  });
});

describe('deriveDealJourney — the phase strip', () => {
  it('draws only this deal\'s phases, in canonical order, with the current one marked', () => {
    const journey = deriveDealJourney({
      deal_type: 'house_and_land',
      stages: withStatuses(HNL, ['complete', 'in_progress']),
      buildPayments: [{ stage_name: 'Deposit', paid_to_builder: false, display_order: 1 }],
    });
    const ids = journey.phases.map((p) => p.phase.id);
    // H&L: acquisition, deposit, finance, legal, settlement + derived
    // construction + the always-present finalised — no onboarding/advisory.
    expect(ids).toEqual(['acquisition', 'deposit', 'finance', 'legal', 'settlement', 'construction', 'finalised']);
    const canonical = JOURNEY_PHASES.map((p) => p.id).filter((id) => ids.includes(id));
    expect(ids).toEqual(canonical);
    expect(journey.phases.find((p) => p.phase.id === 'legal')?.state).toBe('current');
    expect(journey.phases.find((p) => p.phase.id === 'acquisition')?.state).toBe('done');
    expect(journey.phases.find((p) => p.phase.id === 'finance')?.state).toBe('upcoming');
  });

  it('marks every phase done once the deal is settled', () => {
    const journey = deriveDealJourney({
      deal_type: 'existing_property',
      stages: [
        stage({ stage_number: 1, stage_name: 'Deposit', stage_category: 'Deposit', status: 'complete' }),
        stage({ stage_number: 2, stage_name: 'Settlement Complete', stage_category: 'Finalised', status: 'complete' }),
      ],
    });
    expect(journey.isSettled).toBe(true);
    expect(journey.phases.every((p) => p.state === 'done')).toBe(true);
  });

  it('the finalised chip is always present, even for templates that never spell it', () => {
    const journey = deriveDealJourney({ deal_type: 'house_and_land', stages: HNL });
    expect(journey.phases.at(-1)?.phase.id).toBe('finalised');
    expect(journey.phases.at(-1)?.state).toBe('upcoming');
  });
});

describe('stageDisplayOf', () => {
  it('prints what the badge prints', () => {
    expect(stageDisplayOf({ stages: withStatuses(HNL, ['complete', 'in_progress']) })).toBe('Contract Review');
    expect(stageDisplayOf({ current_stage: 'Legacy stage', stages: [] })).toBe('Legacy stage');
  });
});

/**
 * The forward-only scoring policy, as executable proofs.
 *
 * Every check below is one of the properties the production closeout requires.
 * They are written against the policy module and against the SOURCE of the
 * scoring service, because the service's scorer is not exported — and a rule
 * asserted over the source cannot be quietly unwired, which is the same guard
 * pattern `scoringMethodology.spec.ts` already uses for the V2 engine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSESSED_LABEL,
  claimPermits,
  PRODUCTION_SCORING_AUTHORITY,
  authorityOf,
  mayPublishDimensionScores,
  mayPublishOverallGrade,
  INPUT_CLASSES,
  INPUT_OWNER,
  NOT_ASSESSED_REASON,
  OVERALL_GRADE_UNAVAILABLE,
  SCORING_INPUT_POLICY_VERSION,
  admissibleInputs,
  policyStamp,
  ruleOn,
  type LegacyScoringAuthority,
} from '../market/scoringInputPolicy.pure';
import { composeScoreDimensionsSection, gradedLine } from '../investment/scoreSections.pure';

/*
 * The stamp type cannot spell `v2` — this service is not V2 — but the policy
 * has to be exercised as though an authorised engine had written it, so the
 * cast is stated once here rather than at each call.
 */
const AUTHORISED = 'v2' as unknown as LegacyScoringAuthority;

const ROOT = join(__dirname, '..', '..', '..', '..');
const SERVICE = readFileSync(
  join(ROOT, 'supabase', 'functions', 'investment-scoring-service', 'index.ts'), 'utf8',
);

/** The inputs each dimension presents today, from the live scorer. */
const PRESENTED = {
  yield: ['propertyPrice', 'weeklyRent', 'cashFlow'],
  growth: ['priceGrowth1Year', 'priceGrowth3Year', 'populationGrowth'],
  location: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
  demand: ['vacancyRate', 'daysOnMarket', 'medianSuburbPrice', 'unemploymentRate'],
  risk: ['lvr', 'cashFlow', 'vacancyRate', 'daysOnMarket', 'priceGrowth1Year'],
} as const;

const MIN_DIMENSIONS = 3;

/** How many dimensions could score, given what the record presents. */
function measuredCount(verified: string[] = []): number {
  const y = admissibleInputs('yield', [...PRESENTED.yield], verified);
  const yieldOk = y.includes('propertyPrice') && y.includes('weeklyRent');
  return [
    yieldOk,
    admissibleInputs('growth', [...PRESENTED.growth], verified).length > 0,
    admissibleInputs('location', [...PRESENTED.location], verified).length > 0,
    admissibleInputs('demand', [...PRESENTED.demand], verified).length > 0,
    admissibleInputs('risk', [...PRESENTED.risk], verified).length > 0,
  ].filter(Boolean).length;
}

describe('an overall grade requires sufficient verified evidence', () => {
  it('today’s inputs yield too few measured dimensions, so no grade may be issued', () => {
    // Everything the record can offer, nothing declared verified.
    expect(measuredCount()).toBeLessThan(MIN_DIMENSIONS);
    expect(measuredCount()).toBe(1); // Yield alone
  });

  it('a grade becomes permitted once enough inputs are genuinely verified', () => {
    const verified = ['walkScore', 'commuteTimeCBD', 'priceGrowth1Year', 'priceGrowth3Year'];
    expect(measuredCount(verified)).toBeGreaterThanOrEqual(MIN_DIMENSIONS);
  });

  it('the stamp records whether a grade was issued, and the policy version', () => {
    const withheld = policyStamp(['yield'], false, new Date('2026-09-11T00:00:00Z'));
    expect(withheld.gradeIssued).toBe(false);
    expect(withheld.inputPolicyVersion).toBe(SCORING_INPUT_POLICY_VERSION);
    expect(withheld.evaluatedAt).toBe('2026-09-11T00:00:00.000Z');

    // Two distinct reasons a grade is withheld, and the more fundamental one
    // wins: with no authorised engine it does not matter what the evidence
    // would have supported. Under an authorised engine the evidence reason is
    // the one an operator can act on.
    expect(withheld.eligibility).toBe('no_authorised_scoring_system');
    expect(policyStamp(['yield'], false, new Date(), AUTHORISED).eligibility)
      .toBe('insufficient_verified_evidence');

    // A grade is issued only where both hold.
    expect(policyStamp(['yield', 'growth', 'location'], true, new Date()).gradeIssued).toBe(false);
    const issued = policyStamp(['yield', 'growth', 'location'], true, new Date(), AUTHORISED);
    expect(issued.gradeIssued).toBe(true);
    expect(issued.eligibility).toBe('issued');
  });
});

describe('untrusted and unavailable inputs cannot reach a property grade', () => {
  it('Location’s templated inputs are refused until repaired', () => {
    expect(admissibleInputs('location', [...PRESENTED.location])).toEqual([]);
    for (const input of PRESENTED.location) {
      expect(ruleOn('location', input, []).reason).toBe('awaiting_repair');
    }
  });

  it('Growth is refused for want of evidence — and never becomes 50', () => {
    expect(admissibleInputs('growth', [...PRESENTED.growth])).toEqual([]);
    expect(ruleOn('growth', 'priceGrowth1Year', []).reason).toBe('awaiting_evidence');
    // The policy returns admissibility only. It cannot express a substitute
    // value at all, which is what makes the 50 unreachable by construction.
    expect(Object.values(INPUT_CLASSES)).not.toContain(50 as unknown as string);
  });

  it('Demand is refused for want of evidence — and never becomes 50', () => {
    expect(admissibleInputs('demand', [...PRESENTED.demand])).toEqual([]);
    expect(ruleOn('demand', 'vacancyRate', []).reason).toBe('awaiting_evidence');
  });

  it('an input nobody classified is refused rather than admitted', () => {
    expect(ruleOn('growth', 'someNewSignal', []).admitted).toBe(false);
    expect(ruleOn('growth', 'someNewSignal', ['someNewSignal']).reason).toBe('unclassified');
  });
});

describe('the buyer’s position cannot move the property grade', () => {
  it('LVR and cash flow are owned by finance and forbidden to every dimension', () => {
    expect(INPUT_OWNER.lvr).toBe('finance');
    expect(INPUT_OWNER.cashFlow).toBe('finance');
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
      expect(ruleOn(dim, 'lvr', []).admitted, `${dim} must not read lvr`).toBe(false);
      expect(ruleOn(dim, 'cashFlow', []).admitted, `${dim} must not read cashFlow`).toBe(false);
      // Declaring a buyer fact "verified" must not open it either: this is an
      // ownership refusal, not a trust one.
      expect(ruleOn(dim, 'lvr', ['lvr']).reason).toBe('not_owned_by_dimension');
    }
  });

  it('Risk has no admissible input left, so it cannot score from the buyer', () => {
    expect(admissibleInputs('risk', [...PRESENTED.risk])).toEqual([]);
    expect(admissibleInputs('risk', [...PRESENTED.risk], ['lvr', 'cashFlow'])).toEqual([]);
  });
});

describe('trusted Yield survives', () => {
  it('operator-entered price and rent score without any declaration', () => {
    const admitted = admissibleInputs('yield', [...PRESENTED.yield]);
    expect(admitted).toContain('propertyPrice');
    expect(admitted).toContain('weeklyRent');
  });

  it('cash flow is still excluded from Yield — it is the buyer’s, not the asset’s', () => {
    expect(admissibleInputs('yield', [...PRESENTED.yield])).not.toContain('cashFlow');
  });

  it('a missing rent leaves Yield unscoreable rather than partially scored', () => {
    const admitted = admissibleInputs('yield', ['propertyPrice']);
    expect(admitted).toEqual(['propertyPrice']);
    expect(admitted.includes('weeklyRent')).toBe(false);
  });
});

describe('what the client is told', () => {
  it('no grade is stated as unavailable evidence, never as a bad property', () => {
    const all = `${OVERALL_GRADE_UNAVAILABLE.value} ${OVERALL_GRADE_UNAVAILABLE.explanation}`;
    expect(OVERALL_GRADE_UNAVAILABLE.value).toMatch(/not available/i);
    expect(all).toMatch(/insufficient verified/i);
    // Never a verdict about the asset.
    expect(all).not.toMatch(/\b(poor|bad|weak|risky|unsuitable|avoid|fail)\b/i);
    // Never an F, a zero or any grade letter standing in for the absence.
    expect(all).not.toMatch(/\bgrade [A-F]\b/);
    expect(all).not.toMatch(/\b0 out of 100\b/);
  });

  it('every dimension has a reason a non-technical reader can act on', () => {
    for (const [dim, reason] of Object.entries(NOT_ASSESSED_REASON)) {
      expect(reason, dim).toMatch(/^Not assessed — /);
      // No engineering vocabulary reaches a client.
      expect(reason, dim).not.toMatch(
        /untrusted|gate|dimension|provenance|hasData|null|composite|admissib/i,
      );
    }
    expect(ASSESSED_LABEL).toBe('Measured');
  });

  it('an absent grade is not rendered as a verdict anywhere', () => {
    // The projection both the viewer and the PDF read returns nothing at all
    // rather than inventing a line, so the two cannot disagree.
    expect(gradedLine({ grade: 'N/A', totalScore: null })).toBeUndefined();
    expect(gradedLine({ grade: null, totalScore: null })).toBeUndefined();
    expect(gradedLine({ totalScore: 72, grade: 'B+' })).toMatch(/Graded B\+ at 72/);
  });
});

describe('the change is forward-only and confined to the property scorer', () => {
  it('the service gates its data points through the policy', () => {
    expect(SERVICE).toContain("from '../_shared/reports/market/scoringInputPolicy.pure.ts'");
    expect(SERVICE).toMatch(/admissibleInputs\(dimension, presented, verified\)/);
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk']) {
      expect(SERVICE, `${dim} must be gated`).toContain(`admitted('${dim}'`);
    }
  });

  it('the area scorer is untouched — it is a different product surface', () => {
    // Area scoring composes marketMomentum/economicStrength/... and must keep
    // deciding its own coverage; widening this policy onto it would change a
    // surface nothing in this programme measured.
    expect(SERVICE).toContain('marketMomentum: { ...marketMomentum, hasData: mmPoints.length > 0');
  });

  it('nothing here reads or rewrites a stored score', () => {
    const policySrc = readFileSync(
      join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
      'utf8',
    );
    for (const forbidden of ['supabase', 'from(', 'update(', 'insert(', 'upsert(', 'fetch(']) {
      expect(policySrc, `policy must not ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('a refused input stays visible for audit rather than disappearing', () => {
    expect(SERVICE).toContain('dataPointsPresented');
  });
});

// ---------------------------------------------------------------------------
// The production-authority boundary
// ---------------------------------------------------------------------------

const SCORE_SECTIONS = readFileSync(
  join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'investment', 'scoreSections.pure.ts'),
  'utf8',
);

/** A stored score as the service now writes one for a NEW report. */
const newReportScore = (over: Record<string, unknown> = {}) => ({
  totalScore: null,
  grade: 'N/A',
  breakdown: {
    yieldScore: { score: 72, hasData: true, weight: 100, dataPoints: ['propertyPrice', 'weeklyRent'] },
    growthScore: { score: 50, hasData: false, weight: 0, excluded: true },
  },
  coverage: { dataInsufficient: true },
  policy: {
    scoringSystem: 'investment-scoring-service',
    authority: 'unavailable',
    dimensionScoresAuthoritative: false,
    gradeIssued: false,
    eligibility: 'no_authorised_scoring_system',
  },
  ...over,
});

/** A score issued before the policy — a historical snapshot. */
const historicalScore = {
  totalScore: 58,
  grade: 'B',
  breakdown: {
    yieldScore: { score: 65, hasData: true, weight: 15 },
    locationScore: { score: 40, hasData: true, weight: 25 },
    riskScore: { score: 100, hasData: true, weight: 5 },
  },
  coverage: { dataInsufficient: false },
};

describe('the production scoring authority', () => {
  it('no engine is authorised to grade a new report today', () => {
    expect(PRODUCTION_SCORING_AUTHORITY).toBe('unavailable');
    expect(mayPublishOverallGrade(PRODUCTION_SCORING_AUTHORITY)).toBe(false);
    expect(mayPublishDimensionScores(PRODUCTION_SCORING_AUTHORITY)).toBe(false);
  });

  it('verifying inputs does NOT make V1 the authoritative grade engine', () => {
    // Three V1 inputs declared verified — enough evidence for three measured
    // dimensions — still yields no grade, because evidence is not authority.
    const verified = ['walkScore', 'commuteTimeCBD', 'priceGrowth1Year', 'priceGrowth3Year'];
    expect(measuredCount(verified)).toBeGreaterThanOrEqual(MIN_DIMENSIONS);

    const stamp = policyStamp(
      ['yield', 'location', 'growth'], true, new Date(), PRODUCTION_SCORING_AUTHORITY,
    );
    expect(stamp.gradeIssued).toBe(false);
    expect(stamp.eligibility).toBe('no_authorised_scoring_system');
    expect(stamp.dimensionScoresAuthoritative).toBe(false);
  });

  it('a grade is issued only when authority AND evidence both hold', () => {
    expect(policyStamp(['yield'], false, new Date(), AUTHORISED).gradeIssued).toBe(false);
    expect(policyStamp(['yield', 'growth', 'location'], true, new Date(), AUTHORISED).gradeIssued).toBe(true);
    expect(policyStamp(['yield', 'growth', 'location'], true, new Date(), 'unavailable').gradeIssued)
      .toBe(false);
  });

  it('an unstamped score is a historical snapshot, never withheld', () => {
    expect(authorityOf(historicalScore)).toBe('legacy_snapshot');
    expect(authorityOf(newReportScore())).toBe('unavailable');
    expect(authorityOf(null)).toBe('legacy_snapshot');
  });
});

describe('a verified metric is not an authorised scored dimension', () => {
  it('verified Yield inputs remain admissible as facts', () => {
    const admitted = admissibleInputs('yield', [...PRESENTED.yield]);
    expect(admitted).toContain('propertyPrice');
    expect(admitted).toContain('weeklyRent');
  });

  it('but a legacy Yield dimension SCORE is not published for a new report', () => {
    // The stored breakdown carries yieldScore 72 with hasData true. It must not
    // reach a client as an assessment, because no methodology is authorised.
    expect(composeScoreDimensionsSection(newReportScore(), 'Dimensions')).toBeNull();
    expect(gradedLine(newReportScore({ totalScore: 72, grade: 'B' }))).toBeUndefined();
  });

  it('a historical snapshot keeps its own dimension scores and verdict', () => {
    const section = composeScoreDimensionsSection(historicalScore, 'Dimensions');
    expect(section).not.toBeNull();
    expect(section).toMatch(/Yield/);
    expect(gradedLine(historicalScore)).toMatch(/Graded B at 58/);
  });

  it('the gate is on the score, never on the finance block', () => {
    // Deterministic finance values come from `financial_calculations` through
    // the binding projection; nothing in the authority path touches them.
    const policySrc = readFileSync(
      join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
      'utf8',
    );
    for (const finance of ['grossYield', 'stampDuty', 'weeklyCashFlow', 'financial_calculations']) {
      expect(policySrc, `policy must not reach ${finance}`).not.toContain(finance);
    }
    // The section composer gates dimensions and the verdict, and nothing else.
    // It reads the stamp the run wrote rather than re-deriving the decision —
    // and it must not import from `market/`, a boundary the investment
    // source-of-truth spec enforces independently.
    expect(SCORE_SECTIONS).toContain('if (!dimensionScoresMayBeShown(score)) return [];');
    expect(SCORE_SECTIONS).toContain('if (!overallGradeMayBeShown(score)) return undefined;');
    expect(SCORE_SECTIONS).not.toContain('scoringInputPolicy');
  });

  it('no surface labels a V1 result as the frozen V2 assessment', () => {
    expect(SCORE_SECTIONS).not.toMatch(/2\.1\.0-shadow/);
    const stamp = policyStamp(['yield'], true, new Date(), PRODUCTION_SCORING_AUTHORITY);
    expect(stamp.scoringSystem).toBe('investment-scoring-service');
    expect(JSON.stringify(stamp)).not.toMatch(/v2|shadow/i);
  });

  it('front-end and PDF agree that no grade is available', () => {
    // One predicate, one answer: the viewer reads `policy.gradeIssued` and the
    // projection reads the authority — both refuse the same score.
    const score = newReportScore();
    expect(score.policy.gradeIssued).toBe(false);
    expect(gradedLine(score)).toBeUndefined();
    expect(composeScoreDimensionsSection(score, 'Dimensions')).toBeNull();
  });

  it('the service withholds the composite, not just the letter', () => {
    expect(SERVICE).toContain('policy.gradeIssued ? computedTotal : null');
  });
});

// ---------------------------------------------------------------------------
// Qualitative claims obey the same boundary as the numbers
// ---------------------------------------------------------------------------

describe('an unauthorised assessment cannot be published as prose', () => {
  /** What a NEW report permits today: Yield measured, no authorised engine. */
  const today = claimPermits({
    authority: PRODUCTION_SCORING_AUTHORITY,
    measuredDimensions: ['yield'],
    admittedInputs: ['propertyPrice', 'weeklyRent'],
  });

  it('makes no claim from any dimension score', () => {
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
      expect(today.fromDimensionScore(dim), `${dim} must not speak`).toBe(false);
    }
  });

  it('makes no claim from an input the policy refused', () => {
    for (const input of ['walkScore', 'commuteTimeCBD', 'schoolsNearby',
      'vacancyRate', 'daysOnMarket', 'populationGrowth', 'priceGrowth1Year',
      'medianSuburbPrice', 'unemploymentRate']) {
      expect(today.fromInput(input), `${input} must not speak`).toBe(false);
    }
  });

  it('still describes the facts an operator supplied', () => {
    expect(today.fromInput('propertyPrice')).toBe(true);
    expect(today.fromInput('weeklyRent')).toBe(true);
  });

  it('a legacy snapshot keeps the qualitative output it was issued with', () => {
    const historical = claimPermits({
      authority: 'legacy_snapshot',
      measuredDimensions: ['yield', 'location', 'risk'],
      admittedInputs: ['propertyPrice', 'weeklyRent', 'walkScore'],
    });
    expect(historical.fromDimensionScore('location')).toBe(true);
    expect(historical.fromInput('walkScore')).toBe(true);
    // Still only what that run measured.
    expect(historical.fromDimensionScore('growth')).toBe(false);
  });

  it('an authorised V2 run may speak from what it measured', () => {
    const activated = claimPermits({
      authority: 'v2',
      measuredDimensions: ['yield', 'growth', 'location'],
      admittedInputs: ['propertyPrice', 'weeklyRent', 'priceGrowth1Year'],
    });
    expect(activated.fromDimensionScore('growth')).toBe(true);
    expect(activated.fromDimensionScore('demand')).toBe(false);
    expect(activated.fromInput('priceGrowth1Year')).toBe(true);
  });

  it('every SWOT claim in the service is gated', () => {
    // No claim may be pushed from an ungated condition. Each `push` into a SWOT
    // bucket must sit under a `permits.` test.
    const swot = SERVICE.slice(SERVICE.indexOf('function analyzeSWOT'));
    const body = swot.slice(0, swot.indexOf('\n}'));
    const pushes = body.split('\n').filter((l) => /\.push\('/.test(l));
    expect(pushes.length).toBeGreaterThan(8);
    // Walk the conditions: every push is preceded by an `if (permits.` line.
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/\.push\('/.test(lines[i])) continue;
      const guard = lines.slice(Math.max(0, i - 3), i).join(' ');
      expect(guard, `ungated claim: ${lines[i].trim()}`).toMatch(/permits\./);
    }
  });

  it('the dwelling-type and state verdict is gone', () => {
    expect(SERVICE).not.toContain('Unit market in this state may face oversupply');
  });
});

describe('verified inputs never rehabilitate V1', () => {
  it('verification widens evidence and never touches authority', () => {
    const everythingVerified = claimPermits({
      authority: PRODUCTION_SCORING_AUTHORITY,
      measuredDimensions: ['yield', 'growth', 'location', 'demand', 'risk'],
      admittedInputs: ['walkScore', 'priceGrowth1Year', 'vacancyRate'],
    });
    // Inputs speak — they were admitted. Dimensions do not — none is authorised.
    expect(everythingVerified.fromInput('walkScore')).toBe(true);
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
      expect(everythingVerified.fromDimensionScore(dim)).toBe(false);
    }
  });

  it('the wiring is documented as a derivation with a decision behind it, never a request field', () => {
    // Until 16 Sep 2026 this test pinned "not wired to the live request
    // path". The wiring event the header required — the location repair plus
    // an owner decision — happened (IPV 1.1.0), and what the prose must now
    // record is the shape that keeps the boundary: derived from the
    // enrichment's acquisition stamp, never read off the request.
    const policySrc = readFileSync(
      join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
      'utf8',
    );
    expect(policySrc).toMatch(/wired to exactly one live path, and it is derived, never\s*\n?\s*\* read/i);
    expect(policySrc).toMatch(/never trusted: a caller cannot assert verification/i);
    expect(policySrc).toMatch(/trusted evidence → Scoring V2/);
    // The overstated claim must not return.
    expect(policySrc).not.toMatch(/opens by itself/);
    expect(policySrc).not.toMatch(/no later code change is required/);
    expect(SERVICE).toMatch(/internal and test use only/i);
  });
});

// ---------------------------------------------------------------------------
// The legacy service cannot impersonate V2
// ---------------------------------------------------------------------------

describe('legacy V1 can never be activated as V2', () => {
  const POLICY_SRC = readFileSync(
    join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
    'utf8',
  );

  it('the production constant is typed so that v2 is not expressible', () => {
    // `LegacyScoringAuthority = Exclude<ScoringAuthority, 'v2'>` — assigning
    // 'v2' to the constant or passing it to the stamp is a compile error, so
    // no single edit inside the legacy service can relabel its output as V2.
    expect(POLICY_SRC).toContain("export type LegacyScoringAuthority = Exclude<ScoringAuthority, 'v2'>");
    expect(POLICY_SRC).toContain('export const PRODUCTION_SCORING_AUTHORITY: LegacyScoringAuthority');
    expect(POLICY_SRC).toContain('authority: LegacyScoringAuthority = PRODUCTION_SCORING_AUTHORITY');
    expect(POLICY_SRC).toContain('authority: LegacyScoringAuthority;');
  });

  it('a stamp from this service can only say legacy_snapshot or unavailable', () => {
    for (const authority of ['unavailable', 'legacy_snapshot'] as const) {
      const stamp = policyStamp(['yield'], true, new Date(), authority);
      expect(stamp.authority).toBe(authority);
      expect(stamp.gradeIssued).toBe(false); // neither may publish a grade
    }
  });

  it('activation is documented as wiring the real engine, not a label change', () => {
    expect(POLICY_SRC).toMatch(/Scoring V2 engine → score output contract/);
    expect(POLICY_SRC).toMatch(/shadowScorer\.pure\.ts/);
    expect(POLICY_SRC).toMatch(/scoreOutputContract\.pure\.ts/);
    expect(POLICY_SRC).toMatch(/not a label change/i);
  });

  it('the legacy service never imports the V2 engine itself — it reaches V2 only through the activation module (ME-8)', () => {
    expect(SERVICE).not.toContain('shadowScorer');
    expect(SERVICE).not.toContain('scoreOutputContract');
    expect(SERVICE).not.toContain('scoreInvestmentV2');
    expect(SERVICE).toContain("from '../_shared/reports/market/scoringV2Production.pure.ts'");
  });
});

describe('buyer finance is not property-quality commentary', () => {
  it('leverage and cash flow are admitted to no dimension', () => {
    for (const dim of ['yield', 'growth', 'location', 'demand', 'risk'] as const) {
      expect(admissibleInputs(dim, ['lvr', 'cashFlow'])).toEqual([]);
    }
  });

  it('so no property SWOT claim can be made from them, under any authority', () => {
    for (const authority of ['unavailable', 'legacy_snapshot', 'v2'] as const) {
      const permits = claimPermits({
        authority,
        measuredDimensions: ['yield', 'growth', 'location', 'demand', 'risk'],
        // Even if a caller somehow presented them as admitted inputs for a
        // dimension, ownership refuses them upstream in `admissibleInputs`.
        admittedInputs: admissibleInputs('risk', ['lvr', 'cashFlow', 'propertyPrice']),
      });
      expect(permits.fromInput('lvr'), authority).toBe(false);
      expect(permits.fromInput('cashFlow'), authority).toBe(false);
    }
  });

  it('the comments say the claims are permanently gated, not that they survive', () => {
    expect(SERVICE).toMatch(/owned by `finance` and admitted to NO dimension/);
    expect(SERVICE).not.toMatch(/so it survives the scoring authority/);
    expect(POLICY_DOC).toMatch(/Buyer facts are a separate case/);
  });
});

const POLICY_DOC = readFileSync(
  join(ROOT, 'supabase', 'functions', '_shared', 'reports', 'market', 'scoringInputPolicy.pure.ts'),
  'utf8',
);

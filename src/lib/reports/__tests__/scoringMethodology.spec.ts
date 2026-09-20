/**
 * The methodology document and the code may not disagree — and the engine may
 * not be wired.
 *
 * `SCORING_V2_METHODOLOGY.md` is the one authoritative statement of the V2
 * methodology. A document like that goes stale the day someone edits a
 * constant, so every load-bearing number and version in it is pinned here to
 * the module that enforces it. Change a weight, a threshold, a rule or a
 * version and this spec names the sentence that now lies.
 *
 * The second describe is the wiring guard. Until 15 Sep 2026 it asserted that
 * no production entrypoint imported the engine (shadow-only). Under the ME-8
 * activation it asserts the inverse shape: exactly one entrypoint
 * (`investment-scoring-service`) reaches the engine, and only through
 * `scoringV2Production.pure.ts` — the module that records the decision — so
 * a second caller or a direct import is still a failing build rather than a
 * convention. Asserted against the sources, not promised in prose.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { COMPOSITE_WEIGHTS, MIN_DIMENSIONS_FOR_GRADE, SHADOW_METHODOLOGY_VERSION } from '../market/shadowScorer.pure';
import { ELIGIBILITY_RULES, ELIGIBILITY_VERSION, GRADE_THRESHOLDS } from '../market/gradeEligibility.pure';
import { SCORE_OUTPUT_CONTRACT_VERSION } from '../market/scoreOutputContract.pure';
import { GROWTH_METHODOLOGY_VERSION } from '../market/growthScoring.pure';
import { DEMAND_METHODOLOGY_VERSION } from '../market/demandScoring.pure';
import { YIELD_METHODOLOGY_VERSION } from '../market/yieldScoring.pure';
import { LOCATION_METHODOLOGY_VERSION } from '../market/locationScoring.pure';
import {
  MINIMUM_INDEPENDENT_CATEGORIES,
  RISK_METHODOLOGY_STATUS,
  RISK_MODEL_D_VERSION,
} from '../risk/riskModelD.pure';
import { FINANCE_SUITABILITY_VERSION } from '../risk/financeSuitability.pure';
import { SCORING_V2_ACTIVATION } from '../market/scoringV2Production.pure';
import {
  MIN_VALID_DIMENSIONS_TO_PUBLISH,
  SCORE_PUBLICATION_POLICY_VERSION,
} from '../market/scorePublicationPolicy.pure';

const ROOT = join(__dirname, '..', '..', '..', '..');
const DOC = readFileSync(join(ROOT, 'docs', 'reports', 'SCORING_V2_METHODOLOGY.md'), 'utf8');

describe('the methodology document agrees with the code', () => {
  it('states the composition version and every component version', () => {
    for (const v of [
      SHADOW_METHODOLOGY_VERSION,
      GROWTH_METHODOLOGY_VERSION,
      DEMAND_METHODOLOGY_VERSION,
      YIELD_METHODOLOGY_VERSION,
      LOCATION_METHODOLOGY_VERSION,
      RISK_MODEL_D_VERSION,
      FINANCE_SUITABILITY_VERSION,
      ELIGIBILITY_VERSION,
      SCORE_OUTPUT_CONTRACT_VERSION,
    ]) {
      expect(DOC, `document must state version ${v}`).toContain(`\`${v}\``);
    }
  });

  it('states the exact composite weights, and they sum to 1', () => {
    const sum = Object.values(COMPOSITE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    for (const w of Object.values(COMPOSITE_WEIGHTS)) {
      expect(DOC, `weight ${w} must appear`).toContain(`**${w.toFixed(2)}**`);
    }
  });

  it('states the grade thresholds, A+ 85 and A 75 among them', () => {
    const a = GRADE_THRESHOLDS.find(([, g]) => g === 'A+')![0];
    const b = GRADE_THRESHOLDS.find(([, g]) => g === 'A')![0];
    expect(a).toBe(85);
    expect(b).toBe(75);
    expect(DOC).toContain('| A+ | **85** |');
    expect(DOC).toContain('| A | **75** |');
  });

  it('states every eligibility rule number', () => {
    const r = ELIGIBILITY_RULES;
    expect(DOC).toContain(`**${r.aMinGrowthConfidence}**`);
    expect(DOC).toContain(`**${r.aPlusMinGrowthConfidence}**`);
    expect(DOC).toContain(`**${r.aMinGrowthCoverage.toFixed(2)}**`);
    expect(DOC).toContain(`**${r.aPlusMinGrowthCoverage.toFixed(2)}**`);
    expect(DOC).toContain(`**${r.aMinEvidenceQuality.toFixed(2)}**`);
    expect(DOC).toContain(`**${r.aPlusMinEvidenceQuality.toFixed(2)}**`);
    // 3.0.0 — the gate is about the QUALITY of what was assessed, never how
    // many dimensions happened to answer. The document must say so, because
    // the number alone is the same on both readings.
    expect(DOC).toContain('minimum evidence quality over the assessed dimensions');
    expect(DOC).not.toContain('minimum overall evidence coverage');
  });

  it('records that the delivered-points ceiling is gone, and what replaced it', () => {
    // S5/S6 §8. The supersession is documented rather than tidied away: a
    // reader who finds the 2.0.0 reasoning elsewhere must be able to see why
    // it no longer applies, or the ceiling comes back.
    expect(DOC).toMatch(/why 3\.0\.0 removed it/i);
    expect(DOC).toMatch(/solely because a dimension was unavailable/);
    // And the rule that replaced it is stated as a SELECTION rule.
    expect(DOC).toMatch(/never omit a low-scoring dimension to\s+improve the result/);
    expect(DOC).toContain('`gradeEligibility.pure.ts`, version `4.0.0`');
    expect(ELIGIBILITY_VERSION).toBe('4.0.0');
    // 4.0.0 — the third hiding place of the same penalty. The doc must say
    // which absence stopped capping and which quality floor still does, or
    // the `hasGrowth &&` comes back on the next edit.
    expect(DOC).toMatch(/4\.0\.0/);
    // Newline-tolerant: the doc is wrapped, so `.` would stop at the break.
    expect(DOC.replace(/\s+/g, ' ')).toMatch(/an absence is no longer a cap/i);
    expect(DOC).toMatch(/evidenceQualityCoverage/);
  });

  it('states the publication policy the five-dimension gate was superseded by', () => {
    expect(DOC).toContain(`\`${SCORE_PUBLICATION_POLICY_VERSION}\``);
    expect(DOC).toMatch(/\| 4 of 5 \| issue a \*\*qualified\*\* score and grade/);
    expect(DOC).toMatch(/\| 3 of 5 \| issue a \*\*qualified\*\* score and grade/);
    expect(DOC).toMatch(/\| 0–2 of 5 \| no overall score, no grade, no gauge/);
    expect(MIN_VALID_DIMENSIONS_TO_PUBLISH).toBe(3);
    // §7's arithmetic, in the document, in the same words as the code.
    expect(DOC).toMatch(/Σ\(score × original weight\) \/ Σ\(original weights of\s*\n?\s*valid\)/);
    expect(DOC).toMatch(/rounded \*\*once\*\*/);
  });

  it('states the composition floors and Model D rules as the code has them', () => {
    expect(DOC).toContain(`\`MIN_DIMENSIONS_FOR_GRADE\``);
    expect(MIN_DIMENSIONS_FOR_GRADE).toBe(3);
    expect(DOC).toContain('Fewer than **3** measured dimensions');
    expect(DOC).toContain(`\`MINIMUM_INDEPENDENT_CATEGORIES = ${MINIMUM_INDEPENDENT_CATEGORIES}\``);
    // Model D's honesty label travels into the document verbatim.
    expect(DOC).toContain(RISK_METHODOLOGY_STATUS);
  });

  it('is versioned without the shadow suffix, and the document records the activation', () => {
    expect(SHADOW_METHODOLOGY_VERSION.endsWith('-shadow')).toBe(false);
    /*
     * RENEGOTIATED 20 September 2026. This pinned the literal `2.1.0`, in a
     * test whose subject is the SUFFIX and the activation record — so every
     * legitimate bump failed a test that is not about the number. The
     * property it exists for is asserted instead: the version carries no
     * shadow suffix, it is a semver, and the document states the same one the
     * code does (which is what "the document records the activation" means).
     */
    expect(SHADOW_METHODOLOGY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(DOC, 'the document states the version the code is at')
      .toContain(`\`${SHADOW_METHODOLOGY_VERSION}\``);
    expect(DOC).toMatch(/production grade engine/i);
    expect(DOC).toMatch(/ME-8/);
    expect(DOC).toContain(`\`${SCORING_V2_ACTIVATION.approvedOn}\``);
    // RENEGOTIATED — S5/S6 §8. The condition is gone and the document says so
    // rather than falling silent, which is what lets a later reader tell a
    // removed rule from one nobody wrote down.
    expect(DOC).toMatch(/Growth was required, and is not any more/);
    expect(SCORING_V2_ACTIVATION.requiredDimensions).toEqual([]);
    // The safeguard that DID survive is named in the same breath, so the
    // removal cannot read as "no growth evidence, no consequence".
    expect(DOC).toMatch(/printed letter cannot exceed \*\*B\+\*\*/);
  });
});

describe('the engine is reached only through the activation module — asserted, not promised', () => {
  // The modules that constitute Scoring V2. A production entrypoint importing
  // any of them DIRECTLY is the wiring this guard exists to catch: the one
  // authorised path is `scoringV2Production.pure.ts`, imported by
  // `investment-scoring-service` alone. `investment/scoringV2.pure.ts` is the
  // earlier unwired analysis module and is held to the same rule.
  const ENGINE_MARKERS = [
    'shadowScorer',
    'scoreOutputContract',
    'riskModelD',
    'scoreInvestmentV2',
    'investment/scoringV2',
  ];
  const ACTIVATION_MODULE = 'scoringV2Production';
  const ACTIVATED_ENTRYPOINT = 'investment-scoring-service';

  it('no production edge-function entrypoint imports the V2 engine itself', () => {
    const fnRoot = join(ROOT, 'supabase', 'functions');
    const offenders: string[] = [];
    for (const dir of readdirSync(fnRoot, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === '_shared') continue;
      const entry = join(fnRoot, dir.name, 'index.ts');
      if (!existsSync(entry)) continue;
      const src = readFileSync(entry, 'utf8');
      for (const marker of ENGINE_MARKERS) {
        if (src.includes(marker)) offenders.push(`${dir.name}: ${marker}`);
      }
      if (dir.name !== ACTIVATED_ENTRYPOINT && src.includes(ACTIVATION_MODULE)) {
        offenders.push(`${dir.name}: ${ACTIVATION_MODULE}`);
      }
    }
    expect(offenders, 'Scoring V2 is reached through scoringV2Production by investment-scoring-service and nothing else').toEqual([]);
  });

  it('the scoring service reaches the engine through the activation module, and the activation is approved', () => {
    const src = readFileSync(join(ROOT, 'supabase', 'functions', ACTIVATED_ENTRYPOINT, 'index.ts'), 'utf8');
    expect(src).toContain("from '../_shared/reports/market/scoringV2Production.pure.ts'");
    expect(src).toContain('SCORING_V2_ACTIVATION.approved');
    expect(src).toContain('scoreForProduction(');
    expect(SCORING_V2_ACTIVATION.approved).toBe(true);
    expect(SCORING_V2_ACTIVATION.reference).toBe('ME-8');
  });
});

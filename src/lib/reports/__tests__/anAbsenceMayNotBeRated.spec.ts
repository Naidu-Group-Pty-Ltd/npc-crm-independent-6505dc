/**
 * An absence may not be rated, and a chart that says it rates one is not drawn.
 *
 * The case, from page 23 of the 9 Hollow Street Compass issued on
 * 20 Sep 2026 — read off the delivered PDF's own text layer, not off the
 * source that produced it:
 *
 *     Risk exposure index (1=Low, 5=High, Not assessed shown as 5)
 *                    Exposure level
 *     Crime              3   3   3   4   4   4   5
 *
 *     Risk | Exposure level | Evidence chip | Due-diligence focus
 *     Crime | Not assessed | Unverified | State crime register and local police data
 *
 * The register three lines below is right: crime exposure was NOT assessed.
 * The drawing puts it on the measured risks' own scale, at the top of it,
 * and the title states the convention that let it.
 */
import { describe, it, expect } from 'vitest';
import {
  declaredAbsenceRating,
  withholdRatedAbsenceCharts,
  ABSENCE_WORDS,
} from '../investment/ratedAbsence.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import {
  NOT_ASSESSED,
  RISK_EXPOSURE_LEVELS,
  riskRegisterInstruction,
} from '../investment/riskRegister.pure';

/** The directive that produced the page above, reconstructed from its geometry. */
const HOLLOW = '{{heatmap: 3,3,3,4,4,4,5 | rows=Crime | cols=Exposure level'
  + ' | title=Risk exposure index (1=Low, 5=High, Not assessed shown as 5)}}';

describe('the confession', () => {
  it('reads the convention the delivered document declared', () => {
    const r = declaredAbsenceRating('Risk exposure index (1=Low, 5=High, Not assessed shown as 5)');
    expect(r).not.toBeNull();
    expect(r?.word.toLowerCase()).toBe('not assessed');
    expect(r?.value).toBe(5);
  });

  it('reads it in either order and past the connectives a writer uses', () => {
    for (const text of [
      'no data = 0',
      'unknown treated as 3',
      'Scale 1-5, n/a shown as 1',
      'Not measured is plotted as 0',
      'Legend: 5 = Not assessed',
      '0 means no data',
    ]) {
      expect(declaredAbsenceRating(text), text).not.toBeNull();
    }
  });

  it('every absence word it names can actually be found', () => {
    for (const word of ABSENCE_WORDS) {
      expect(declaredAbsenceRating(`Scale: ${word} shown as 4`), word).not.toBeNull();
    }
  });

  it('is silent on a COUNT of absences, which is a fact about the register', () => {
    // The bound: the connective is required. A number after the phrase is how
    // a register reports how many rows it could not fill.
    expect(declaredAbsenceRating('Risks not assessed: 3')).toBeNull();
    expect(declaredAbsenceRating('3 risks not assessed')).toBeNull();
    expect(declaredAbsenceRating('Vacancy rate not available')).toBeNull();
  });

  it('is silent on an ordinary chart title', () => {
    for (const text of [
      'Compound annual price growth · Houses, to March 2026',
      'Risk exposure index (1=Low, 5=High)',
      'Median sale price by quarter',
      'Tenure mix, ABS Census 2021, postal area 2155',
    ]) {
      expect(declaredAbsenceRating(text), text).toBeNull();
    }
  });
});

describe('what the reader is shown instead', () => {
  it('withholds the drawing and leaves the register that states it honestly', () => {
    const md = [
      'This register summarises the main risk themes for the property.',
      '',
      HOLLOW,
      '',
      '| Risk | Exposure level | Evidence |',
      '| --- | --- | --- |',
      '| Crime | Not assessed | Unverified |',
      '',
    ].join('\n');
    const out = withholdRatedAbsenceCharts(md);
    expect(out.withheld).toHaveLength(1);
    expect(out.withheld[0].kind).toBe('heatmap');
    expect(out.withheld[0].rating.value).toBe(5);
    expect(out.markdown).not.toContain('{{heatmap');
    expect(out.markdown).not.toContain('Not assessed shown as 5');
    // Nothing is worded in its place, and the register survives whole.
    expect(out.markdown).toContain('| Crime | Not assessed | Unverified |');
    expect(out.markdown).toContain('This register summarises');
    expect(out.markdown).not.toMatch(/withheld|not drawn|unavailable chart/i);
  });

  it('leaves no hole where the drawing stood', () => {
    const out = withholdRatedAbsenceCharts(`Before.\n\n${HOLLOW}\n\nAfter.`);
    expect(out.markdown).toBe('Before.\n\nAfter.');
  });

  it('is byte-identical on a document whose charts carry no convention', () => {
    const md = [
      'Intro.',
      '',
      '{{heatmap: 5.2,6.1,7.4 / 4.8,5.9,6.7 | rows=2024,2025 | cols=Q1,Q2,Q3 | title=Suburb Growth %}}',
      '',
      '{{bars: Structure 75, Pest 70 | title=Condition | max=100}}',
      '',
      '{{gauge: 54 | Investment Score | Weighted composite}}',
      '',
    ].join('\n');
    const out = withholdRatedAbsenceCharts(md);
    expect(out.withheld).toHaveLength(0);
    expect(out.markdown).toBe(md);
  });

  it('takes the whole series rather than the cells at the rated value', () => {
    /*
     * The reason, stated as a test: once 5 means both "high" and "we did not
     * look", every cell at 5 is ambiguous — so a chart with its 5s removed is
     * a risk register reading as a property with no high risks, which is the
     * more dangerous of the two documents.
     */
    const md = '{{bars: Flood 5, Bushfire 2, Crime 5 | title=Exposure (Not assessed shown as 5)}}';
    const out = withholdRatedAbsenceCharts(md);
    expect(out.markdown.trim()).toBe('');
    expect(out.withheld).toHaveLength(1);
  });
});

describe('where the rule is applied', () => {
  /*
   * Driven through `presentStoredMarkdown` rather than through the module, so
   * the test can see the WIRING and not only the implementation — the lesson
   * a vacuous condensed-tier spec paid for on 20 Sep 2026. Remove the call
   * from the read path and this fails; remove it from the write path alone
   * and nothing here notices, which is the point: every Compass already
   * stored was written under the old habit.
   */
  const PAGE = [
    '## Risk Dashboard',
    '',
    '### Summary Risk Register',
    '',
    'This register summarises the main risk themes for the property in Golden Square.',
    '',
    HOLLOW,
    '',
    '| Risk | Exposure level | Evidence chip |',
    '| --- | --- | --- |',
    '| Crime | Not assessed | Unverified |',
    '| Supply & market balance | Moderate | Verified |',
    '',
  ].join('\n');

  it('a stored document loses the drawing and keeps the register', () => {
    const out = presentStoredMarkdown(PAGE);
    expect(out).not.toContain('{{heatmap');
    expect(out).not.toContain('Not assessed shown as 5');
    expect(out).toContain('| Crime | Not assessed | Unverified |');
    expect(out).toContain('| Supply & market balance | Moderate | Verified |');
    expect(out).toContain('Summary Risk Register');
  });

  it('the section it stood in is not left empty and is not collected', () => {
    // `dropEmptySections` runs in the same pass. The register is what keeps
    // the heading alive, which is the reason the drawing could go at all.
    expect(presentStoredMarkdown(PAGE)).toContain('Risk Dashboard');
  });
});

describe('the request and the guarantee say the same thing', () => {
  it('the register instruction tells the model an absence gets no position', () => {
    const text = riskRegisterInstruction();
    expect(text).toContain(NOT_ASSESSED);
    expect(text).toMatch(/NEVER on a chart/);
    expect(text).toMatch(/no position on a scale/);
  });

  it('the exposure that may not be drawn is named once, not spelled twice', () => {
    // A literal at each end is how two ends drift — the rule
    // `AML_COMMAND_REFRESH_EVENT` already pays for.
    expect(RISK_EXPOSURE_LEVELS).toContain(NOT_ASSESSED);
    expect(declaredAbsenceRating(`Exposure (${NOT_ASSESSED} shown as 5)`)).not.toBeNull();
  });
});

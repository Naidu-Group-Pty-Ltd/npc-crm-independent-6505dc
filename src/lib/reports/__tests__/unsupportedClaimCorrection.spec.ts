/**
 * A detected error is not a corrected report.
 *
 * `compassQAValidator` has reported `portal-sourced-hazard-clearance` and
 * `unpublished-delivery-horizon` since 18 Sep 2026 and neither was ever
 * removed from a document — the finding went to `validation_flags` and the
 * claim went to the client. `evidenceClaims.pure.ts` is the correction half,
 * and this file pins the four rules it answers to:
 *
 *   1. what is REPORTED is what is REMOVED (one declaration, two readers)
 *   2. the unit of the correction is the unit of the assertion
 *   3. nothing is concealed — every removal carries its rule, text and reason
 *   4. it removes and never rewrites
 *
 * The prose in `MEASURED` is verbatim from the rendered 48 Redfern Street
 * PDFs; the timeline is verbatim from the Kellyville Compass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  correctUnsupportedEvidenceClaims,
  findPortalSourcedClearances,
  findUnpublishedHorizons,
  PERMITTED_ABSENCE_RE,
} from '../investment/evidenceClaims.pure';
import { runQAValidation } from '../compassQAValidator';
import { CHECKED_NOT_MAPPED_LEAD } from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

/** The sentence, as it printed. */
const MEASURED_CLEARANCE =
  'The subject site sits within an established residential pocket, with multiple nearby addresses on the '
  + 'street recording no bushfire, flood or heritage overlays on public mapping at the time they were last '
  + 'updated.[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles, 2024-2026]';

/** The timeline, as it drew. */
const MEASURED_TIMELINE =
  '{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)", '
  + '0-2y "High-tech data centres Norwest (three approvals at $93.18m)", '
  + '0-2y "Terrace housing project Gables ($29.75m)"}}';

const doc = (body: string) => `# Report\n\n## Environmental risk\n\n${body}\n`;

describe('the hazard clearance is removed, by the sentence', () => {
  it('removes the measured Redfern Street sentence', () => {
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(MEASURED_CLEARANCE));
    expect(markdown).not.toContain('no bushfire, flood or heritage overlays');
    expect(removed).toHaveLength(1);
    expect(removed[0].rule).toBe('portal-sourced-hazard-clearance');
  });

  it('keeps the sentences either side of it', () => {
    const before = 'The lot is 612 square metres and falls gently to the rear.';
    const after = 'A parcel-level check of the State hazard registers is listed in the due diligence schedule.';
    const { markdown } = correctUnsupportedEvidenceClaims(doc(`${before} ${MEASURED_CLEARANCE} ${after}`));
    expect(markdown).toContain(before);
    expect(markdown).toContain(after);
    expect(markdown).not.toContain('Property.com.au');
  });

  it('removes a neighbouring-parcel clearance that names no portal at all', () => {
    const { removed } = correctUnsupportedEvidenceClaims(
      doc('Adjoining properties record no flood overlay, so the site is considered clear.'),
    );
    expect(removed.map((r) => r.rule)).toEqual(['portal-sourced-hazard-clearance']);
    expect(removed[0].reason).toContain('neighbouring');
  });

  it('takes the whole line when the line WAS the claim, and leaves no hole', () => {
    const { markdown } = correctUnsupportedEvidenceClaims(
      `## Risk\n\n${MEASURED_CLEARANCE}\n\n## Planning\n\nThe zone is R2.\n`,
    );
    expect(markdown).not.toMatch(/\n{3,}/);
    expect(markdown).toContain('## Planning');
  });
});

describe('what a listing IS may still be cited', () => {
  it('keeps an asking price sourced to a portal', () => {
    const line = 'The property is advertised at $845,000.[realestate.com.au listing, 12 Sep 2026]';
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(line));
    expect(markdown).toContain(line);
    expect(removed).toHaveLength(0);
  });

  it('keeps the one absence a register may state', () => {
    const line = 'Bushfire prone land: checked and not mapped at this coordinate (NSW Hazard layer, 17 Sep 2026).';
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(line));
    expect(markdown).toContain(line);
    expect(removed).toHaveLength(0);
  });

  /*
   * The exemption is a KEY on the planning table's own words. The table's lead
   * became "Checked and not mapped at the property" on 25 Sep 2026 and this
   * pattern still read "at this coordinate", so the one permitted absence could
   * be removed — the test above could not see it, because a sentence that names
   * neither a portal nor a neighbour is kept with or without the exemption.
   */
  it('recognises the absence in the words the planning table prints today, and in the stored ones', () => {
    expect(PERMITTED_ABSENCE_RE.test(CHECKED_NOT_MAPPED_LEAD)).toBe(true);
    expect(PERMITTED_ABSENCE_RE.test('**Checked and not mapped at this coordinate:** bushfire, flood.')).toBe(true);
  });

  it('keeps the permitted absence even beside a neighbouring parcel, in either spelling', () => {
    for (const where of ['the property', 'this coordinate']) {
      const line = `Flood: checked and not mapped at ${where}, and there is no overlay on the adjoining lots either `
        + '(NSW Planning Portal — Hazard, 17 Sep 2026).';
      const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(line));
      expect(removed, where).toHaveLength(0);
      expect(markdown, where).toContain(line);
    }
    // …and the same clearance WITHOUT the table's words is still the defect.
    const unsupported = 'There is no flood overlay on the adjoining lots, so the site is clear.';
    expect(correctUnsupportedEvidenceClaims(doc(unsupported)).removed).toHaveLength(1);
  });

  it('keeps a hazard absence that rests on neither a portal nor a neighbour', () => {
    const line = 'The constraint register returned no heritage overlay at the parcel centroid.';
    const { markdown } = correctUnsupportedEvidenceClaims(doc(line));
    expect(markdown).toContain(line);
  });
});

describe('the delivery horizon is removed, by the stop', () => {
  it('drops a timeline whose every stop is a horizon', () => {
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(MEASURED_TIMELINE));
    expect(markdown).not.toContain('{{timeline:');
    expect(removed).toHaveLength(3);
    expect(new Set(removed.map((r) => r.rule))).toEqual(new Set(['unpublished-delivery-horizon']));
  });

  it('keeps a dated stop beside a dropped horizon', () => {
    const mixed = '{{timeline: Determined Jul 2026 "Castle Hill mixed-use ($181.9m)", '
      + '0-2y "Norwest data centres ($93.18m)", Gazetted 2023 "Sydney Metro West corridor"}}';
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(mixed));
    expect(markdown).toContain('Determined Jul 2026');
    expect(markdown).toContain('Gazetted 2023');
    expect(markdown).not.toContain('0-2y');
    expect(removed).toHaveLength(1);
  });

  it('leaves a timeline with no horizon at all byte-identical', () => {
    const dated = '{{timeline: Determined Jul 2026 "A", Gazetted 2023 "B", 2024 "C"}}';
    const input = doc(dated);
    const { markdown, removed } = correctUnsupportedEvidenceClaims(input);
    expect(markdown).toBe(input);
    expect(removed).toHaveLength(0);
  });
});

describe('what is reported is what is removed', () => {
  const both = doc(`${MEASURED_CLEARANCE}\n\n${MEASURED_TIMELINE}`);

  it('the validator reports both as errors before the correction', () => {
    const rules = runQAValidation(both, 'compass-40').findings
      .filter((f) => f.severity === 'error')
      .map((f) => f.rule);
    expect(rules).toContain('portal-sourced-hazard-clearance');
    expect(rules).toContain('unpublished-delivery-horizon');
  });

  it('and reports neither after it', () => {
    const { markdown } = correctUnsupportedEvidenceClaims(both);
    const rules = runQAValidation(markdown, 'compass-40').findings.map((f) => f.rule);
    expect(rules).not.toContain('portal-sourced-hazard-clearance');
    expect(rules).not.toContain('unpublished-delivery-horizon');
  });

  it('the finders the validator reads are the finders the corrector reads', () => {
    expect(findPortalSourcedClearances(both)).toHaveLength(1);
    expect(findUnpublishedHorizons(both)).toHaveLength(1);
    // A document the finders call clean is a document the corrector leaves alone.
    const clean = doc('The zone is R2 under the Cumberland LEP 2021, current at 5 August 2026.');
    expect(findPortalSourcedClearances(clean)).toHaveLength(0);
    expect(findUnpublishedHorizons(clean)).toHaveLength(0);
    expect(correctUnsupportedEvidenceClaims(clean).markdown).toBe(clean);
  });
});

describe('nothing is concealed, and nothing is rewritten', () => {
  it('every removal carries its rule, the text that went, and why', () => {
    const { removed } = correctUnsupportedEvidenceClaims(doc(`${MEASURED_CLEARANCE}\n\n${MEASURED_TIMELINE}`));
    expect(removed.length).toBeGreaterThan(0);
    for (const r of removed) {
      expect(r.rule).toMatch(/^(portal-sourced-hazard-clearance|unpublished-delivery-horizon)$/);
      expect(r.text.trim().length).toBeGreaterThan(0);
      expect(r.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('introduces no text of its own — the output is a subsequence of the input', () => {
    const input = doc(`${MEASURED_CLEARANCE}\n\n${MEASURED_TIMELINE}\n\nThe zone is R2.`);
    const { markdown } = correctUnsupportedEvidenceClaims(input);
    const inputWords = new Set(input.split(/\s+/).filter(Boolean));
    for (const w of markdown.split(/\s+/).filter(Boolean)) {
      // `{{timeline:…}}` reassembly is the one place a token can be re-cut, and
      // it is composed from kept stops, never written.
      if (w.startsWith('{{timeline:')) continue;
      expect(inputWords.has(w), w).toBe(true);
    }
  });

  it('does not touch "Confidence: High" — the honest word is one a person picks', () => {
    // Rule 11 reads the lines BELOW the rating for the outstanding check.
    const block = 'Environmental Risk — Level: Moderate — Confidence: High\n\nRequired check: obtain the '
      + 'parcel-level flood certificate from council.';
    const { markdown, removed } = correctUnsupportedEvidenceClaims(doc(block));
    expect(markdown).toContain('Confidence: High');
    expect(removed).toHaveLength(0);
    // …and the validator still says so, so the judgement reaches a person.
    expect(runQAValidation(doc(block), 'compass-40').findings.map((f) => f.rule))
      .toContain('risk-confidence-overstated');
  });
});

describe('the generation paths all correct before they store', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it.each([
    ['supabase/functions/generate-investment-report/index.ts', 'the parent Compass'],
    ['supabase/functions/fork-investment-report/index.ts', 'the Financial and Strategic children'],
    ['supabase/functions/_shared/reports/investment/condenseCompose.pure.ts', 'the Briefing and Snapshot'],
  ])('%s corrects %s', (path) => {
    expect(read(path)).toContain('correctUnsupportedEvidenceClaims');
  });

  it('the validator holds no second copy of the corrector\'s patterns', () => {
    for (const p of [
      'supabase/functions/_shared/compassQAValidator.ts',
      'src/lib/reports/compassQAValidator.ts',
    ]) {
      const src = read(p);
      expect(src).toContain('evidenceClaims.pure');
      // The regexes moved; a re-declared copy here is the drift this closes.
      expect(src).not.toMatch(/const\s+PORTALS\s*=/);
      expect(src).not.toMatch(/const\s+HORIZON\s*=/);
      expect(src).not.toMatch(/const\s+HAZARD_ABSENCE\s*=/);
    }
  });

  it('the generator files what it corrected, so the row records the removal', () => {
    const src = read('supabase/functions/generate-investment-report/index.ts');
    expect(src).toContain("type: 'correction'");
    expect(src).toContain('claimGuard.removed');
  });
});

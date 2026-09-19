/**
 * A timeline bucket is a delivery horizon, and no register here publishes one.
 *
 * The Kellyville Compass drew, verbatim:
 *
 * > `{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)",
 * > 0-2y "High‑tech data centres Norwest (three approvals at $93.18m)",
 * > 0-2y "Terrace housing project Gables ($29.75m)" | title=Recent large‑scale
 * > projects in The Hills LGA}}`
 *
 * Every date behind those three is a DETERMINATION — the date a decision was
 * recorded — and the evidence table prints "Not published by this register" in
 * its Delivery timing column on every row, because neither the NSW DA register
 * nor the Queensland instrument layers publish a delivery date for anything.
 * "0-2y" is a completion the report has no source for, drawn three times.
 *
 * The rule in `infrastructureRules` tells the model not to; this is what
 * catches it if the model does it anyway, on the produced document, with no
 * model in the loop. It judges the prose because the evidence table is
 * appended after the validator runs — and the prose is the right thing to
 * judge, because the claim is the model's.
 */
import { describe, expect, it } from 'vitest';
import { runQAValidation } from '../compassQAValidator';

const findings = (markdown: string) =>
  runQAValidation(markdown, 'compass-40').findings.filter((f) => f.rule === 'unpublished-delivery-horizon');

/** The directive exactly as the Kellyville report drew it. */
const KELLYVILLE = '{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)", '
  + '0-2y "High-tech data centres Norwest (three approvals at $93.18m)", '
  + '0-2y "Terrace housing project Gables ($29.75m)" | title=Recent large-scale projects in The Hills LGA}}';

describe('the horizon the registers did not publish', () => {
  it('reports the directive that shipped', () => {
    const f = findings(KELLYVILLE);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('error');
    expect(f[0].message).toMatch(/places 3 items in a future delivery horizon \(0-2y\)/);
  });

  it('names each distinct horizon once rather than repeating it', () => {
    const f = findings('{{timeline: 0-2y "A", 3-5y "B", 3-5y "C", 5y+ "D"}}');
    expect(f[0].message).toMatch(/\(0-2y, 3-5y, 5y\+\)/);
    expect(f[0].message).toMatch(/places 4 items/);
  });

  it('reads a relative term as a horizon too', () => {
    for (const bucket of ['Short term', 'medium-term', 'Long term', 'Next 5 years']) {
      expect(findings(`{{timeline: ${bucket} "Something"}}`), bucket).toHaveLength(1);
    }
  });

  it('tells the author what a stop may be labelled with', () => {
    expect(findings(KELLYVILLE)[0].message).toMatch(/Determined Jul 2026/);
  });
});

describe('what it deliberately leaves alone', () => {
  it('accepts a stop labelled by what its date IS', () => {
    expect(findings('{{timeline: Determined "Data centre, Norwest", Lodged "Shop top housing, Castle Hill"}}'))
      .toHaveLength(0);
    expect(findings('{{timeline: Determined Jul 2026 "Data centre, Norwest ($93.18m)"}}')).toHaveLength(0);
  });

  it('accepts a calendar year and "Existing"', () => {
    // A register states a gazettal year; "Existing" is the directive's own
    // documented first bucket and asserts nothing about the future.
    expect(findings('{{timeline: Existing "Road access", 2023 "Gazetted: Wide Bay Burnett Regional Plan"}}'))
      .toHaveLength(0);
  });

  it('says nothing about a document with no timeline at all', () => {
    expect(findings('The register lists five developments, none with a published delivery date.')).toHaveLength(0);
  });

  it('does not read a horizon out of ordinary prose', () => {
    // A report may legitimately discuss a 3-5 year hold. The rule is about a
    // timeline BUCKET, so it looks only inside the directive.
    expect(findings('A 3-5 year hold is the shortest horizon over which these costs are recovered. '
      + 'Short term, rates may move against the position.')).toHaveLength(0);
  });
});

describe('the rule reaches both copies of the validator', () => {
  it('is in the edge module too, byte-identical but for the import paths', async () => {
    const fs = await import('node:fs/promises');
    const edge = await fs.readFile(
      'supabase/functions/_shared/compassQAValidator.ts', 'utf8');
    const front = await fs.readFile('src/lib/reports/compassQAValidator.ts', 'utf8');
    const strip = (s: string) => s.split('\n')
      .filter((l) => !/^(import|} from|export \{)/.test(l.trim()) && !/from '\.\.?\//.test(l))
      .join('\n');
    expect(strip(edge)).toBe(strip(front));
    expect(edge).toContain("rule: 'unpublished-delivery-horizon'");
  });
});

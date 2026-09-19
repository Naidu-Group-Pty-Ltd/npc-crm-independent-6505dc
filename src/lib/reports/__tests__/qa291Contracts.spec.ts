/**
 * Section contracts the audit of 291 Stone Mason Drive found unenforced
 * (QA-291SM, 15 Sep 2026): QA-17 (a score names its basis), QA-20 (confidence
 * is evidence held, not reassurance), QA-33 (a promise of a table is a table;
 * a pair of lists is two lists; a cut never splits a bullet from its
 * explanation).
 */
import { describe, expect, it } from 'vitest';
import { postProcessReportMarkdown } from '@/lib/reports/compassPostProcessor';
import { runQAValidation } from '@/lib/reports/compassQAValidator';
import {
  composeScoreDimensionsSection,
  dimensionLabel,
  scoreBasisLine,
} from '@/lib/reports/investment/scoreSections.pure';

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

describe('QA-33 — the word-cap cut keeps every block whole and every sub-section represented', () => {
  const strengths = Array.from({ length: 30 }, (_, i) =>
    `- **Strength ${i}:** ${words(18, 's')}`).join('\n');
  const limitations = Array.from({ length: 6 }, (_, i) =>
    `- **Limitation ${i}:** ${words(18, 'l')}`).join('\n');
  const section = `## Amenity & Access

${words(40, 'intro')}

### Strengths

${strengths}

### Limitations

${limitations}
`;

  it('keeps the second list when the first alone would have spent the cap', () => {
    const { markdown, report } = postProcessReportMarkdown(section, 'compass-40');
    expect(report.sectionsTrimmed.length).toBeGreaterThan(0);
    expect(markdown).toContain('### Strengths');
    expect(markdown).toContain('### Limitations');
    expect(markdown).toMatch(/- \*\*Limitation 0:\*\*/);
  });

  it('never leaves a bullet title without the explanation that continued it', () => {
    const body = `## Amenity & Access

${words(30, 'p')}

- **Positioned in a commuter suburb**
  ${words(40, 'a')}
- **Residential form aligned with local preferences**
  ${words(400, 'b')}
- **Third**
  ${words(40, 'c')}
`;
    const { markdown } = postProcessReportMarkdown(body, 'compass-40');
    // The second item did not fit whole, so neither its title nor its
    // explanation survives; the cut is at a block boundary.
    if (!markdown.includes('b399')) expect(markdown).not.toContain('Residential form aligned');
    expect(markdown).not.toMatch(/\*\*\n\s*$/);
  });
});

describe('QA-33 — the validator refuses an unkept promise', () => {
  it('flags a lead-in to a table or matrix that nothing follows', () => {
    const md = `## Amenity & Access

The matrix below groups the main amenities by type, with indicative distance bands.

## Schools & Education

Fine.
`;
    const { findings } = runQAValidation(md, 'compass-40');
    expect(findings.some((f) => f.rule === 'promised-table')).toBe(true);
  });

  it('is satisfied by a table or a chart directive after the promise', () => {
    const table = `## Amenity & Access

The matrix below groups the main amenities by type.

| Amenity | Band |
| --- | --- |
| Schools | 0–2 km |
`;
    const directive = `## Amenity & Access

The matrix below groups the main amenities by type.

{{heatmap: Schools 1,2 | rows=Schools | cols=Primary,Secondary}}
`;
    expect(runQAValidation(table, 'compass-40').findings.some((f) => f.rule === 'promised-table')).toBe(false);
    expect(runQAValidation(directive, 'compass-40').findings.some((f) => f.rule === 'promised-table')).toBe(false);
  });

  it('flags "Strengths and Limitations" that carries no limitations', () => {
    const md = `## Property Fit

### Strengths and Limitations

Strengths

- One strength.
- Another strength.

## Risk Dashboard

x
`;
    const { findings } = runQAValidation(md, 'compass-40');
    expect(findings.some((f) => f.rule === 'unbalanced-pair')).toBe(true);
    const balanced = md.replace('- Another strength.\n', '- Another strength.\n\nLimitations\n\n- Tandem parking.\n');
    expect(runQAValidation(balanced, 'compass-40').findings.some((f) => f.rule === 'unbalanced-pair')).toBe(false);
  });
});

describe('QA-20 — confidence is evidence held', () => {
  it('flags a high-confidence rating whose required check is still outstanding', () => {
    const md = `## Risk Dashboard

Environmental Risk (Bushfire & Flood) - Level: Moderate - Confidence: High

- Why it matters: hazard seasons.
- Required check: obtain the RFS bushfire mapping and council flood overlays for the lot.
`;
    const { findings } = runQAValidation(md, 'compass-40');
    expect(findings.some((f) => f.rule === 'risk-confidence-overstated')).toBe(true);
  });
  it('does not flag a rating that names no outstanding check', () => {
    const md = `## Risk Dashboard

Crime Risk - Level: Low - Confidence: High

- Why it matters: BOCSAR 2025 rate for the suburb is below the state median (retrieved 1 Sep 2026).
`;
    expect(runQAValidation(md, 'compass-40').findings.some((f) => f.rule === 'risk-confidence-overstated')).toBe(false);
  });
});

describe('QA-18 — the validator reports a score the record does not hold', () => {
  it('names the claim', () => {
    const md = '## Executive Verdict\n\nOverall investment fit is rated 68/100.\n';
    const { findings } = runQAValidation(md, 'compass-40', { recordedScores: [39, 30, 58, 75] });
    const f = findings.find((x) => x.rule === 'unrecorded-score');
    expect(f?.message).toMatch(/rated 68|68\/100/);
    expect(runQAValidation(md, 'compass-40').findings.some((x) => x.rule === 'unrecorded-score')).toBe(false);
  });
});

describe('QA-17 — a score names what it rests on', () => {
  const score = {
    totalScore: 39, grade: 'D', recommendation: 'CAUTION',
    breakdown: {
      yieldScore: { score: 30, weight: 33, available: true, details: 'Gross yield: 3.60%' },
      serviceabilityScore: { score: 80, weight: 22, available: true, details: 'LVR 80%; no borrower serviceability assessment is part of this score' },
      cashflowScore: { score: 10, weight: 45, available: true, details: 'Weekly net: $-931' },
    },
  };
  it('labels the LVR band as the proxy it is', () => {
    expect(dimensionLabel('serviceabilityScore')).toBe('serviceability (LVR proxy)');
  });
  it('prints the basis under the dimension table', () => {
    const md = composeScoreDimensionsSection(score, 'Score Breakdown')!;
    expect(md).toContain('| Serviceability (LVR proxy) | 22% | 80/100 |');
    expect(md).toContain('_Scored from: yield — Gross yield: 3.60%; serviceability (LVR proxy) — LVR 80%;');
    expect(scoreBasisLine({ totalScore: 50, breakdown: { yieldScore: { score: 50, weight: 100 } } })).toBeUndefined();
  });
});

describe('QA-08 — the standard renderer never rewrites a figure it did not label', () => {
  it('injects the record\'s rate, growth and LVR only into an explicit "Label: NN%"', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    const src = readFileSync(resolve(__dirname, '../investment/investmentPdfDocument.ts'), 'utf8');
    // The audited Financial report printed every sensitivity row as
    // "Interest Rate: 6.5% (+1.0 pt)" because the pattern was `Interest Rate.*?NN%`.
    expect(src).not.toMatch(/pattern:\s*\/Interest Rate\.\*\?/);
    expect(src).not.toMatch(/pattern:\s*\/Capital Growth\.\*\?/);
    expect(src).not.toMatch(/pattern:\s*\/LVR\.\*\?/);
    expect(src).toContain('pattern: /\\bInterest Rate\\s*:\\s*[\\d.]+%/gi');
    expect(src).toContain('pattern: /\\bLVR\\s*:\\s*[\\d.]+%/gi');
  });
});

describe('the standard renderer keeps a minus sign', () => {
  it('maps U+2212 to a hyphen-minus before the WinAnsi strip', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    const src = readFileSync(resolve(__dirname, '../investment/investmentPdfDocument.ts'), 'utf8');
    const strip = src.indexOf('const stripEmojis = ');
    const winAnsi = src.indexOf("[^\\x00-\\x7F\\xA0-\\xFF]", strip);
    const minus = src.indexOf("\\u2212", strip);
    expect(minus).toBeGreaterThan(strip);
    expect(minus).toBeLessThan(winAnsi);
  });
});


/**
 * The risk register is a scan; the detail blocks are the reading.
 *
 * §4 of the 18 September 2026 instruction, in its own words: *"replace
 * paragraph-heavy risk tables with a concise summary register and readable
 * detail blocks covering finding / evidence / implication / next action"*, and
 * *"keep risk exposure separate from evidence completeness"*.
 *
 * The section had been declared as `Risk | Level | Why It Matters | Required
 * Check` - four columns, one an explanation and another an instruction, over
 * roughly eight risks inside a 550-word cap. A grid is the wrong container for
 * two paragraphs, and every attempt to make it fit made it smaller rather than
 * shorter.
 */
import { describe, expect, it } from 'vitest';
import {
  RISK_DETAIL_PARTS,
  RISK_EVIDENCE_READINGS,
  RISK_EXPOSURE_LEVELS,
  RISK_REGISTER_CELL_MAX_WORDS,
  RISK_REGISTER_COLUMNS,
  findOverlongRegisterCells,
  riskRegisterInstruction,
} from '../investment/riskRegister.pure';
import { runQAValidation } from '../compassQAValidator';

const register = (rows: string[]) =>
  ['| Risk | Exposure | Evidence |', '| --- | --- | --- |', ...rows].join('\n');

describe('exposure and evidence are different questions', () => {
  it('the two vocabularies share no value', () => {
    const overlap = RISK_EXPOSURE_LEVELS.filter(
      (l) => (RISK_EVIDENCE_READINGS as readonly string[]).includes(l),
    );
    expect(overlap).toEqual([]);
  });

  it('they are two columns of the register, never one', () => {
    expect(RISK_REGISTER_COLUMNS).toContain('Exposure');
    expect(RISK_REGISTER_COLUMNS).toContain('Evidence');
  });

  it('"Not assessed" is a LEVEL, so an unsearched register can never read as Low', () => {
    expect(RISK_EXPOSURE_LEVELS).toContain('Not assessed');
    expect(RISK_EXPOSURE_LEVELS).not.toContain('Minimal');
    expect(RISK_EXPOSURE_LEVELS).not.toContain('Negligible');
    expect(RISK_EXPOSURE_LEVELS).not.toContain('Favourable');
  });

  it('"Not searched" is an EVIDENCE reading, so a search nobody ran is never a clearance', () => {
    expect(RISK_EVIDENCE_READINGS).toContain('Not searched');
    expect(RISK_EVIDENCE_READINGS).not.toContain('Clear');
    expect(RISK_EVIDENCE_READINGS).not.toContain('None');
  });
});

describe('a detail block carries the four things a reader needs', () => {
  it('finding, evidence, implication, next check - in that order', () => {
    expect([...RISK_DETAIL_PARTS]).toEqual(['Finding', 'Evidence', 'Implication', 'Next check']);
  });

  it('the instruction states all four, and the cap, and the two vocabularies', () => {
    const text = riskRegisterInstruction();
    for (const part of RISK_DETAIL_PARTS) expect(text, part).toContain(part);
    expect(text).toContain(String(RISK_REGISTER_CELL_MAX_WORDS));
    for (const level of RISK_EXPOSURE_LEVELS) expect(text, level).toContain(level);
    for (const reading of RISK_EVIDENCE_READINGS) expect(text, reading).toContain(reading);
  });

  it('it says the explanation belongs OUT of the grid', () => {
    expect(riskRegisterInstruction()).toContain('rather than in the grid');
  });
});

describe('a register cell carrying a paragraph', () => {
  const PARAGRAPH = 'The subject sits within a mapped bushfire prone area under the council scheme '
    + 'and a bushfire attack level assessment will be required before a development consent is issued.';

  it('is found', () => {
    const found = findOverlongRegisterCells(register([`| Bushfire | Moderate | ${PARAGRAPH} |`]));
    expect(found).toHaveLength(1);
    expect(found[0].risk).toBe('Bushfire');
    expect(found[0].column).toBe('Evidence');
    expect(found[0].words).toBeGreaterThan(RISK_REGISTER_CELL_MAX_WORDS);
  });

  it('a phrase is left alone', () => {
    expect(findOverlongRegisterCells(register([
      '| Bushfire | Moderate | Verified — NSW RFS map, 2026 |',
      '| Flood | Not assessed | Not searched |',
    ]))).toEqual([]);
  });

  it('markdown emphasis and a link are not words a reader counts', () => {
    expect(findOverlongRegisterCells(register([
      '| Bushfire | **Moderate** | [NSW RFS bushfire prone land map](https://example.test/a/very/long/path) |',
    ]))).toEqual([]);
  });

  it('a table that is not a risk register is never judged', () => {
    // A planning register's cells are prose on purpose, and that is the point
    // of them.
    const planning = [
      '| Control | Value | Instrument |',
      '| --- | --- | --- |',
      `| Bushfire | Mapped | ${PARAGRAPH} |`,
    ].join('\n');
    expect(findOverlongRegisterCells(planning)).toEqual([]);
  });

  it('a header naming a risk but no exposure is not a register', () => {
    const md = [
      '| Risk | Note |',
      '| --- | --- |',
      `| Bushfire | ${PARAGRAPH} |`,
    ].join('\n');
    expect(findOverlongRegisterCells(md)).toEqual([]);
  });

  it('two long cells in one row are two findings', () => {
    const found = findOverlongRegisterCells(register([
      `| Bushfire | ${PARAGRAPH} | ${PARAGRAPH} |`,
    ]));
    expect(found).toHaveLength(2);
  });

  it('prose after the table is not a cell', () => {
    const md = `${register(['| Bushfire | Moderate | Verified |'])}\n\n**Bushfire**\n\n`
      + `Finding: ${PARAGRAPH}`;
    expect(findOverlongRegisterCells(md)).toEqual([]);
  });
});

describe('the validator discloses it', () => {
  const md = `# Report\n\n## Risk Dashboard\n\n${register([
    '| Bushfire | Moderate | The subject sits within a mapped bushfire prone area under the council '
    + 'scheme and an assessment will be required before consent. |',
  ])}\n`;

  it('raises a warning, not an error - the content is right and the container is wrong', () => {
    // A two-line fixture is not a 20–26 page Compass — assert on the tier
    // with no page band so the document-level verdict is not the band's.
    const report = runQAValidation(md, 'briefing');
    const f = report.findings.find((x) => x.rule === 'risk-register-cell-overlong');
    expect(f?.severity).toBe('warning');
    expect(report.passed).toBe(true);
  });

  it('names the risk, the column and the remedy', () => {
    const f = runQAValidation(md, 'compass-40').findings
      .find((x) => x.rule === 'risk-register-cell-overlong');
    expect(f?.message).toContain('Bushfire');
    expect(f?.message).toContain('Evidence');
    expect(f?.message).toContain('detail block under the table');
  });
});

describe('the section registry and the module are one declaration', () => {
  it('the purpose the model is given states the shape this module defines', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('supabase/functions/_shared/compassSectionRegistry.ts', 'utf8');
    const purpose = src.split("id: 'compass.riskDashboard'")[1].split('},')[0];
    expect(purpose).toContain('SUMMARY REGISTER');
    expect(purpose).toContain('DETAIL BLOCK');
    for (const part of RISK_DETAIL_PARTS) expect(purpose, part).toContain(part);
    expect(purpose).toContain(`under ${RISK_REGISTER_CELL_MAX_WORDS} words`);
    // The rules the section already carried are untouched: removing a ceremony
    // must never remove a control.
    expect(purpose).toContain('Not assessed');
    expect(purpose).toContain('never the conclusion drawn from it');
    expect(purpose).toContain('never let a checklist of work still to do read as a clearance');
    expect(purpose).toContain('Covers crime, environmental');
  });
});

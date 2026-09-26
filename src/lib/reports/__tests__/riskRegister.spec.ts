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

  it('"Not checked" is an EVIDENCE reading, so a check nobody made is never a clearance', () => {
    // It read "Not searched" until 26 Sep 2026: the same absence, in the
    // machine room's word rather than the adviser's.
    expect(RISK_EVIDENCE_READINGS).toContain('Not checked');
    expect(RISK_EVIDENCE_READINGS).not.toContain('Not searched');
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
  /*
   * This suite used to read the registry's SOURCE TEXT and check it contained
   * the same sentences as this module. It passed, and it was pinning the
   * defect: the purpose was a verbatim string literal in the edge registry and
   * a second copy of that in the frontend mirror, so `riskRegisterInstruction`
   * — whose own header calls itself "one declaration" — had ZERO production
   * call sites and the copies had already diverged by four paragraphs.
   *
   * Every assertion below is the one it always made. What changed is what they
   * are made against: the registry's runtime `purpose`, which is now the
   * function's own output, plus the composition itself.
   */
  it('the registry COMPOSES the instruction rather than restating it', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of [
      'supabase/functions/_shared/compassSectionRegistry.ts',
      'src/lib/reports/compassSectionRegistry.ts',
    ]) {
      const src = readFileSync(file, 'utf8');
      const entry = src.split("id: 'compass.riskDashboard'")[1].split('},')[0];
      expect(entry, file).toContain('purpose: riskRegisterInstruction(),');
      expect(entry, `${file} must carry no second copy of the words`)
        .not.toContain('SUMMARY REGISTER');
    }
  });

  it('both registries hand the model the same words, and they are these', async () => {
    const edge = await import('../../../../supabase/functions/_shared/compassSectionRegistry.ts');
    const front = await import('../compassSectionRegistry');
    const of = (mod: { COMPASS_40_SECTIONS: { id: string; purpose: string }[] }) =>
      mod.COMPASS_40_SECTIONS.find((d) => d.id === 'compass.riskDashboard')!.purpose;
    expect(of(edge)).toBe(riskRegisterInstruction());
    expect(of(front)).toBe(riskRegisterInstruction());
  });

  it('the purpose the model is given states the shape this module defines', async () => {
    const { COMPASS_40_SECTIONS } = await import('../compassSectionRegistry');
    const purpose = COMPASS_40_SECTIONS.find((d) => d.id === 'compass.riskDashboard')!.purpose;
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

  it('SHOWS the markup rather than naming the columns', () => {
    /*
     * The reason the register printed as prose. The old wording asked for
     * "a SUMMARY REGISTER a reader can scan — Risk | Exposure | Evidence",
     * which is a description of columns written with pipes and no statement
     * that the thing is a table — and page 23 of the 9 Hollow Street Compass
     * reproduced exactly that line, with a bullet in front of its only row.
     * A prohibition with no demonstration of the permitted form is one a
     * model routes around.
     */
    const text = riskRegisterInstruction();
    expect(text).toContain('MARKDOWN TABLE');
    expect(text).toContain(`| ${RISK_REGISTER_COLUMNS.join(' | ')} |`);
    expect(text).toContain(`| ${RISK_REGISTER_COLUMNS.map(() => '---').join(' | ')} |`);
    expect(text, 'a worked row').toMatch(/\| Bushfire \| Not assessed \| Not checked \|/);
    expect(text, 'a worked detail block').toContain('- Finding:');
    expect(text).toMatch(/not as a bullet list/);
  });
});

/**
 * The question nothing asked.
 *
 * Every rule in the validator measures a section's LENGTH, its heading
 * density or the words it contains. None asks whether the section is the
 * thing its registry entry declares — so two of the three Compass reports
 * regenerated on 20 Sep 2026 shipped a Risk Dashboard with no summary
 * register in it, under nine other warnings each, and nothing said so.
 */
describe('a section that did not produce its declared shape', () => {
  const page = (body: string) => [
    '# Investment Compass',
    '',
    '## Risk Dashboard',
    '',
    body,
    '',
  ].join('\n');

  const PROSE_ONLY = [
    '### Planning, land use and development risk',
    '',
    'The key planning risk for this property is that the current zoning permits a dwelling',
    'house but does not support adding extra residential dwellings on this lot.',
    '',
    '### Market and value trajectory risk',
    '',
    'Recent recorded price growth has been solid but consistently below the wider benchmark.',
  ].join('\n');

  const findingsFor = (body: string) =>
    runQAValidation(page(body), 'compass-40').findings
      .filter((f) => f.rule.startsWith('risk-register-'));

  it('reports a Risk Dashboard written as prose with no register', () => {
    // 1 Crestview Avenue and 97 Poole Road, exactly: named risk sub-headings,
    // no exposure level and no evidence reading anywhere in the section.
    const found = findingsFor(PROSE_ONLY);
    expect(found.map((f) => f.rule)).toEqual(['risk-register-missing']);
    expect(found[0].severity).toBe('error');
    expect(found[0].sectionId).toBe('compass.riskDashboard');
    expect(found[0].message).toContain(RISK_REGISTER_COLUMNS.join(' | '));
  });

  it('tells a register written as PROSE apart from one never written', () => {
    /*
     * 9 Hollow Street's page 23, which is a different failure with a
     * different remedy: the words were there and the markup was not. Calling
     * both "missing" sends an operator to the wrong fix.
     */
    const found = findingsFor([
      'Risk | Exposure level | Evidence chip | Due-diligence focus',
      '- Crime | Not assessed | Unverified | State crime register and local police data',
    ].join('\n'));
    expect(found.map((f) => f.rule)).toEqual(['risk-register-not-marked-up']);
    expect(found[0].severity).toBe('warning');
  });

  it('says nothing about a section that produced its register', () => {
    const found = findingsFor([
      `| ${RISK_REGISTER_COLUMNS.join(' | ')} |`,
      `| ${RISK_REGISTER_COLUMNS.map(() => '---').join(' | ')} |`,
      '| Bushfire | Not assessed | Not searched |',
      '| Supply | Moderate | Verified |',
      '',
      '**Bushfire**',
      '',
      '- Finding: No mapped control at this coordinate.',
    ].join('\n'));
    expect(found).toEqual([]);
  });

  it('a header with no row under it is a promise, not a register', () => {
    const found = findingsFor([
      `| ${RISK_REGISTER_COLUMNS.join(' | ')} |`,
      `| ${RISK_REGISTER_COLUMNS.map(() => '---').join(' | ')} |`,
    ].join('\n'));
    expect(found.map((f) => f.rule)).toEqual(['risk-register-missing']);
  });

  it('is asked of the Risk Dashboard alone, by id and never by heading text', () => {
    const other = runQAValidation(
      '# R\n\n## Market Positioning\n\nNo register here, and none is owed.\n',
      'compass-40',
    ).findings.filter((f) => f.rule.startsWith('risk-register-'));
    expect(other).toEqual([]);
  });
});

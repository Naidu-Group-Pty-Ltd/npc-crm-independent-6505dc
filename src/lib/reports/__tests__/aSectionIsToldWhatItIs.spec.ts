/**
 * A section is told what it is — and the telling cannot be trimmed away.
 *
 * Measured on 24 Sep 2026 from `function_logs`: every section call of both
 * Compass runs logged `trimmed true`, with base budgets of 13,938–18,914
 * bytes. The structure guide sat at the head of that base, so the head the
 * trim keeps held the first 8.5–11.6 KB of an 18.7 KB guide. The document's
 * rules began 15,043 bytes in and the Risk Dashboard's instructions 10,288 —
 * so neither reached the model on any call, and none of the five Compass
 * reports finished on 23–24 Sep carried the declared risk register.
 *
 * The first describe block REPLAYS that measurement against the real
 * registry: under the old layout, the rules and the Risk Dashboard's entry
 * fall outside every logged head. That is the proof this spec can see the
 * defect. The rest asserts the repair: the contract travels in the system
 * message, budgeted first; the base carries an outline; and a Risk Dashboard
 * written without its register earns one corrected retry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compassSections } from '../../../../supabase/functions/_shared/compassSectionRegistry';
import {
  documentOutline,
  documentRules,
  documentTitle,
  RISK_DASHBOARD_SECTION_ID,
  SECTION_CONTRACT_HEADING,
  sectionContract,
  sectionGuideEntry,
  sectionRepairNote,
  sectionShapeShortfall,
} from '../../../../supabase/functions/_shared/compassSectionContract';
import {
  RISK_EVIDENCE_READINGS,
  RISK_EXPOSURE_LEVELS,
  RISK_REGISTER_COLUMNS,
} from '../../../../supabase/functions/_shared/reports/investment/riskRegister.pure';

const GEN = 'supabase/functions/generate-investment-report/index.ts';
const generator = readFileSync(GEN, 'utf8');
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/** The generator's `compactPromptContext`, which runs before the trim measures. */
const compact = (v: string) => v
  .replace(/\r\n/g, '\n')
  .replace(/[\t ]{2,}/g, ' ')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim();

/** Live code only — a comment may name what the code must not do. */
const live = (src: string) => src.split('\n')
  .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
  .join('\n');

/** The body of `generateReportSection`, from its signature to the next top-level function. */
function generateReportSectionBody(): string {
  const at = generator.indexOf('async function generateReportSection(');
  expect(at, 'generateReportSection exists').toBeGreaterThan(0);
  const next = generator.indexOf('\nasync function ', at + 10);
  const nextFn = generator.indexOf('\nfunction ', at + 10);
  const end = [next, nextFn].filter((n) => n > at).sort((a, b) => a - b)[0] ?? generator.length;
  return generator.slice(at, end);
}

describe('the measurement, replayed against the real registry', () => {
  /*
   * The old guide, rebuilt in its old layout from the same pieces the new
   * contract composes, and wrapped exactly as the generator wrapped it. If the
   * pieces drift from the text the model is sent, `sectionContract` drifts
   * with them — they are one text.
   */
  const oldGuide = [
    `# ${documentTitle('compass-40')}`,
    '',
    ...compassSections().flatMap((s) => [sectionGuideEntry(s), '']),
    ['', documentRules('compass-40'), ''].join('\n'),
  ].join('\n');
  const oldHead = compact(`
---
**REFERENCE TEMPLATE STRUCTURE (Follow this structure closely):**

The following is extracted from your reference templates. Use this structure and formatting as a guide for generating the report. If the template was truncated, follow the section-generation task and canonical rules as the authority:

${oldGuide}

---

`);
  const offsetOf = (needle: string) => {
    const i = oldHead.indexOf(needle);
    expect(i, needle).toBeGreaterThan(0);
    return bytes(oldHead.slice(0, i));
  };
  /** What `limitPromptContext` kept of the head for a logged budget (base 49,319 B on Lawley). */
  const keptHead = (budget: number) => {
    const notice = `\n\n[Base prompt for Risk Dashboard truncated from ${(49319).toLocaleString()} bytes to stay within Perplexity's 100KB message limit. Prioritise extracted specifications and request fresh web research for missing details.]\n\n`;
    return Math.floor((budget - bytes(notice)) * 0.62);
  };
  // Every base budget logged on 24 Sep 2026, 01:47–05:31Z, lowest and highest.
  const LOGGED_BUDGETS = [13_938, 14_004, 16_194, 16_734, 18_914];

  it('put the Risk Dashboard’s instructions beyond the head its own call kept', () => {
    /*
     * 60 Lawley Street's Risk Dashboard call (24 Sep 05:29:04Z) logged a
     * 14,004-byte budget. 9 Hollow Street's (05:28:38Z) logged 16,734 and
     * missed the entry by 65 bytes — true on the day, and too fine a margin to
     * assert against a registry whose wording will keep changing, so only the
     * first is pinned. Neither call received the register instruction.
     */
    const risk = offsetOf('## Risk Dashboard\n');
    expect(risk).toBeGreaterThan(keptHead(14_004));
  });

  it('put the document’s rules beyond every head the trim kept', () => {
    const rules = offsetOf('## MANDATORY WRITING STYLE');
    for (const budget of LOGGED_BUDGETS) {
      expect(rules, `budget ${budget}`).toBeGreaterThan(keptHead(budget));
    }
    // And the two rules whose absence reached a client page most directly.
    expect(offsetOf('## HARD EXCLUSIONS')).toBeGreaterThan(keptHead(Math.max(...LOGGED_BUDGETS)));
    expect(offsetOf('## RECOMMENDATION FORMAT')).toBeGreaterThan(keptHead(Math.max(...LOGGED_BUDGETS)));
  });

  it('spent the head the trim keeps on other sections’ instructions', () => {
    // The outline that replaces it is a small fraction of what it displaced.
    expect(bytes(documentOutline('compass-40'))).toBeLessThan(bytes(oldGuide) / 10);
  });
});

describe('what a section is told now', () => {
  const rules = documentRules('compass-40');

  it('carries its own entry and the document’s rules, whole, for every Compass section', () => {
    for (const s of compassSections()) {
      const c = sectionContract(s, 'compass-40');
      expect(c.startsWith(SECTION_CONTRACT_HEADING), s.id).toBe(true);
      expect(c, s.id).toContain(`## ${s.name}\n`);
      expect(c, s.id).toContain(`- Purpose: ${s.purpose}`);
      expect(c, s.id).toContain(`Narrative word ceiling: ${s.maxWordCount} (a ceiling, not a target)`);
      expect(c, s.id).toContain(rules);
      // The entry comes before the rules, because the rules refer to "the
      // per-section word ceiling given above".
      expect(c.indexOf(`## ${s.name}\n`), s.id).toBeLessThan(c.indexOf('## LENGTH AND STRUCTURE'));
    }
  });

  it('shows the Risk Dashboard its register in markup', () => {
    const risk = compassSections().find((s) => s.id === RISK_DASHBOARD_SECTION_ID);
    expect(risk, 'the registry still declares the Risk Dashboard').toBeTruthy();
    const c = sectionContract(risk!, 'compass-40');
    expect(c).toContain(`| ${RISK_REGISTER_COLUMNS.join(' | ')} |`);
    expect(c).toContain(`| ${RISK_REGISTER_COLUMNS.map(() => '---').join(' | ')} |`);
  });

  it('keeps the rules the tier has and invents none for a tier that has none', () => {
    expect(rules).toMatch(/## HARD EXCLUSIONS \(Compass/);
    expect(rules).toMatch(/## CONSISTENCY CHECKS/);
    // RENEGOTIATED 25 Sep 2026: the rule is ONE recommendation. The three
    // adviser labels this line pinned moved to `recommendationContract`, which
    // hands them to the two recommendation sections only where the page prints
    // no verdict (`oneRecommendation.spec.ts`) — the 60 Lawley Street Compass
    // printed STRONG BUY on its cover and "Proceed with caution" in its text.
    expect(rules).toMatch(/## RECOMMENDATION FORMAT\nThe document makes ONE recommendation\./);
    expect(documentRules('financial-analysis')).toBe('');
  });

  it('gives the base an outline that names every section, in order, and instructs none', () => {
    const outline = documentOutline('compass-40');
    let cursor = 0;
    compassSections().forEach((s, i) => {
      const line = `${i + 1}. ${s.name} — up to ${s.maxWordCount} words`;
      const at = outline.indexOf(line);
      expect(at, line).toBeGreaterThanOrEqual(cursor);
      cursor = at;
    });
    for (const s of compassSections()) {
      expect(outline, `${s.id}'s purpose belongs to its own call`).not.toContain(s.purpose);
    }
    expect(outline).not.toContain('## HARD EXCLUSIONS');
  });
});

describe('the generator sends it where nothing can trim it', () => {
  const body = generateReportSectionBody();

  it('builds every canonical section with its registry id and its contract', () => {
    expect(generator).toMatch(/registryId: section\.id,/);
    expect(generator).toMatch(/contract: sectionContract\(section, tier\),/);
    expect(generator).toMatch(/canonicalSectionsToGenerationSections\(compassSections\(\), 'compassSection', tier\)/);
  });

  it('puts the outline, not the guide, into the base prompt', () => {
    expect(generator).toContain("templateContext = documentOutline('compass-40');");
    expect(live(generator)).not.toMatch(/buildCanonicalTemplateContext/);
    expect(live(generator)).not.toMatch(/compassStyleRules/);
  });

  it('budgets the contract before the system prompt is trimmed, and appends it after', () => {
    // Composed from the section's own contract and any correction it earned.
    expect(body).toMatch(/const sectionContractBlock = \[sectionDef\.contract \?\? '', correction \?\? ''\]/);
    // Its bytes come off the system budget BEFORE the operator's prompt is trimmed…
    expect(body).toMatch(/PERPLEXITY_SAFE_SYSTEM_MESSAGE_BYTES - byteLength\(sectionContractBlock\)/);
    // …and it is concatenated OUTSIDE that trim, so it is never cut.
    expect(body).toMatch(/const safeSystemMessage = withSectionContract\(limitPromptContext\(\s*systemMessage,/);
    // The compact prompt is the one that runs when the full one was refused.
    expect(body).toMatch(/\? withSectionContract\('You are an Australian property investment analyst/);
  });

  it('leaves the user message’s pin exactly as it was, so no planning evidence is displaced', () => {
    /*
     * The evidence pin reached 45,601 bytes on a NSW run (23 Sep 13:29Z). A
     * 7.4 KB Risk Dashboard contract added to it would have left the user
     * message over its 70,000-byte ceiling, and the final safety trim keeps
     * the TAIL — cutting the planning controls table at the head of the pin.
     */
    const pinLine = body.split('\n').find((l) => /const pinnedBlock = /.test(l)) ?? '';
    expect(pinLine).toMatch(/pinnedContext\.trim\(\)/);
    expect(pinLine).not.toMatch(/contract|correction/);
  });

  it('logs the contract’s size on every call, so production can show it arrived', () => {
    expect(body).toMatch(/section contract \$\{byteLength\(sectionContractBlock\)\} bytes, never trimmed/);
  });
});

describe('a Risk Dashboard written without its register', () => {
  const RD = RISK_DASHBOARD_SECTION_ID;
  const register = [
    '## Risk Dashboard',
    '',
    `| ${RISK_REGISTER_COLUMNS.join(' | ')} |`,
    '| --- | --- | --- |',
    '| Bushfire | Not assessed | Not searched |',
    '| Flood | Low | Verified |',
  ].join('\n');

  it('is a shortfall when there is no register, and only for the Risk Dashboard', () => {
    const prose = '## Risk Dashboard\n\n### Crime\nCrime was not assessed.\n\n### Flood\nThe flood layer holds nothing here.';
    expect(sectionShapeShortfall(RD, prose)).toMatch(/No summary register/);
    expect(sectionShapeShortfall(RD, register)).toBeNull();
    for (const s of compassSections().filter((x) => x.id !== RD)) {
      expect(sectionShapeShortfall(s.id, prose), s.id).toBeNull();
    }
    expect(sectionShapeShortfall(undefined, prose)).toBeNull();
  });

  it('is not a shortfall when the read path would repair it', () => {
    // Pipe-separated prose is promoted to a table on every read path, so a
    // second model call would buy nothing the reader does not already get.
    const piped = [
      '## Risk Dashboard',
      '',
      'Risk | Exposure | Evidence',
      'Crime | Not assessed | Not searched',
      'Flood | Low | Verified',
    ].join('\n');
    expect(sectionShapeShortfall(RD, piped)).toBeNull();
  });

  it('earns a correction that shows the markup and both vocabularies', () => {
    const note = sectionRepairNote(RD) ?? '';
    expect(note).toContain(`"| ${RISK_REGISTER_COLUMNS.join(' | ')} |"`);
    expect(note).toContain(RISK_EXPOSURE_LEVELS.join(' / '));
    expect(note).toContain(RISK_EVIDENCE_READINGS.join(' / '));
    expect(note).not.toMatch(/\byour (previous|earlier)\b/i);  // the model has no memory of it
    for (const s of compassSections().filter((x) => x.id !== RD)) {
      expect(sectionRepairNote(s.id), s.id).toBeNull();
    }
  });

  it('cannot pass validation, and its one retry carries the correction', () => {
    const validator = generator.slice(
      generator.indexOf('function validateSectionContent('),
      generator.indexOf('// ROBUSTNESS INFRASTRUCTURE'),
    );
    expect(validator).toMatch(/const shapeShortfall = sectionShapeShortfall\(sectionDef\.registryId, content \|\| ''\);/);
    const penalty = Number(validator.match(/if \(shapeShortfall\) \{\s*issues\.push\(shapeShortfall\);\s*score -= (\d+);/)?.[1]);
    const threshold = Number(validator.match(/isValid: score >= (\d+)/)?.[1]);
    expect(Number.isFinite(penalty) && Number.isFinite(threshold)).toBe(true);
    // No other merit can carry a section without its register past the bar.
    expect(100 - penalty).toBeLessThan(threshold);

    const loop = generator.slice(generator.indexOf('let sectionCorrection: string | null = null;'));
    expect(loop).toMatch(/sectionCorrection = sectionRepairNote\(sectionDef\.registryId\);/);
    expect(loop.slice(0, 2_500)).toMatch(/sectionDeadlineAt,\s*sectionCorrection,\s*\);/);
  });
});

describe('the schema validator that never ran is gone', () => {
  it('is not called from the generator', () => {
    /*
     * It answered 401 to every generator call (five of five, 23 Sep 13:30Z –
     * 24 Sep 05:32Z) because it was invoked through an anon client; its answer
     * sits under `data` while the reader took `.issues` from the top; and its
     * required sections are the legacy layout, none of them a Compass section.
     */
    expect(live(generator)).not.toMatch(/report-schema-validator/);
    // What it fed is still defined, and empty, so the flag list is unchanged.
    expect(generator).toMatch(/const schemaValidationFlags: any\[\] = \[\];/);
  });
});

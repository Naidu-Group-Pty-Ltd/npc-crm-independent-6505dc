/**
 * The contract the Compass is written against — and the legacy template it
 * replaced.
 *
 * Measured on 17 Sep 2026: `propertyPrompt` was 79,603 bytes and **76,415 of
 * them (96%) were the legacy 38-page reference template**, carried verbatim
 * under "MANDATORY REPORT STRUCTURE — 38-PAGE REFERENCE TEMPLATE / YOU MUST
 * FOLLOW THIS EXACT STRUCTURE, LENGTH, AND FORMAT". The remaining 3,188 bytes
 * were the property's own facts.
 *
 * That template is a different document: 27 sections including *Purchase &
 * Ongoing Costs*, *Rental Assessment & Yield Calculation*, *Loan Structure &
 * Repayment Analysis*, *Cashflow Analysis* and *Sensitivity Analysis* — the
 * financial modelling the Compass is defined by NOT carrying — demanding
 * "12,000-15,000 words minimum" against a registry that capped the document at
 * 5,010. It is written as fill-in-the-blanks and its point 8 instructs the
 * model to "Include [citation] markers", which another line of the same prompt
 * forbids and a regex downstream strips.
 *
 * `generateReportSection` trims head-tail, so both ends of every trim were
 * legacy: the model received about 53 KB of the wrong contract on each of the
 * eleven section calls.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COMPASS_DOCUMENT_CONTRACT,
  compassDocumentContract,
} from '../../../../supabase/functions/_shared/reports/investment/compassDocumentContract.pure';

const GEN = 'supabase/functions/generate-investment-report/index.ts';
const source = () => readFileSync(GEN, 'utf8');

/** `propertyPrompt`'s own text, from its opening backtick to its close. */
function propertyPrompt(): string {
  const s = source();
  const open = s.indexOf('const propertyPrompt = `');
  expect(open, 'propertyPrompt must exist').toBeGreaterThan(0);
  const rest = s.slice(open);
  const close = rest.indexOf('\n\n    // Select the appropriate prompt based on report scope');
  expect(close, 'propertyPrompt must close').toBeGreaterThan(0);
  return rest.slice(0, close);
}

describe('the legacy 38-page template is gone from the live prompt', () => {
  it('names no reference template and demands no page or word count', () => {
    const p = propertyPrompt();
    expect(p).not.toContain('38-PAGE REFERENCE TEMPLATE');
    expect(p).not.toContain('MANDATORY REPORT STRUCTURE');
    expect(p).not.toMatch(/12,000-15,000 words/);
    expect(p).not.toMatch(/EXACT structure, length, and format/i);
  });

  it('carries none of the financial sections the Compass must not hold', () => {
    const p = propertyPrompt();
    for (const heading of [
      '# Purchase & Ongoing Costs',
      '# Rental Assessment & Yield Calculation',
      '# Loan Structure & Repayment Analysis',
      '# Cashflow Analysis',
      '# Sensitivity Analysis',
      '# 10-Year Investment Projections',
      'PRE-CALCULATED ANNUAL COSTS',
      'PRE-CALCULATED FINANCIAL VALUES',
    ]) {
      expect(p, heading).not.toContain(heading);
    }
  });

  it('asks for no citation markers, and no bracketed placeholders', () => {
    const p = propertyPrompt();
    // Point 8 of the legacy formatting requirements: "Include [citation]
    // markers where data is sourced from external references" — while another
    // line of the same prompt forbade them and a regex stripped them.
    expect(p).not.toMatch(/Include \[citation\] markers/);
    // The fill-in-the-blank shapes the model reproduced into client documents.
    for (const shape of ['[Suburb name]', '[School Name]', '[Station Name]', '[XX]', '[X.X]', 'X,XXX,XXX']) {
      expect(p, shape).not.toContain(shape);
    }
  });

  it('is an order of magnitude smaller, so nothing is trimmed away', () => {
    /*
     * The trim is head-tail at `PERPLEXITY_SAFE_USER_MESSAGE_BYTES` (70,000),
     * so at 79,603 bytes the model lost the middle of the prompt on every
     * section call and kept the legacy template's two ends. The whole prompt
     * now fits, which means the evidence pack reaches every section intact.
     */
    expect(Buffer.byteLength(propertyPrompt(), 'utf8')).toBeLessThan(20_000);
  });

  it('injects the contract from the shared module rather than restating it', () => {
    expect(source()).toContain("import { compassDocumentContract } from '../_shared/reports/investment/compassDocumentContract.pure.ts'");
    expect(propertyPrompt()).toContain('${compassDocumentContract(_brandPp.companyName)}');
  });
});

describe('the evidence pack is what the report may state', () => {
  const p = propertyPrompt();

  it('carries every retrieved evidence block', () => {
    for (const block of [
      'planningStatBlocks(enhancedData)',
      // The open paren, like `reconcileNearestSchool(` below: what this
      // asserts is that the block is COMPOSED, and the argument shape is
      // incidental — it now carries the trusted state for the
      // forward-demand sentence. Pinning a call site's argument is the
      // defect `headMarker`'s spec had, where the asserted argument was
      // one 39 masters discard.
      'regionalTrendBlocks(',
      'macroEconomicBlock(enhancedData)',
      'demographicsStatBlocks(enhancedData)',
      'climateStatBlocks(enhancedData)',
      'crimeStatBlocks(enhancedData)',
      'reconcileNearestSchool(',
      'reconcileSchoolDistances(',
      // Composed, like their five siblings above, rather than written inline.
      // The two inline blocks these replace read six field names, four of
      // which nothing in the repository writes — including `commuteToCbd`,
      // whose only occurrence anywhere was the line that read it.
      'amenityFactBlocks(enhancedData.locationIntelligence)',
      'transportFactBlocks(enhancedData.locationIntelligence)',
    ]) {
      expect(p, block).toContain(block);
    }
  });

  it('states an absent register as a fact about the CHECK', () => {
    // The rule every absence in this product answers to. A category nobody
    // reached must never read as a category with nothing in it.
    expect(p).toMatch(/No school register reading was retrieved/);
    // The amenity and transport absences moved into `amenityFactBlocks.pure.ts`
    // with the blocks themselves, and are asserted there by EXECUTION against
    // the shape `location-intelligence-service` publishes — which is stronger
    // than grepping a template literal, and is why the old inline blocks could
    // carry four dead field names while this file passed.
  });

  // `absent is never zero` has a mirror: a reached-and-empty category IS a
  // finding, and a rural address with no hospital within five kilometres is a
  // fact worth printing. Asserted in `amenityFactBlocks.spec.ts`, where the
  // rule now lives and can be exercised rather than matched.

  it('states the price and the rent once, and forbids analysing them', () => {
    // Asserted as the RULE — a price line is present, singular, and not
    // analysed — rather than as the words. This pinned the literal
    // `**Asking price:**`, and that label was itself the defect: the figure
    // behind it is `mergedOverrides.purchasePrice || propertyDetails?.price`,
    // so an adviser's accepted modelling input was being announced to the
    // model as the market's asking price. `subjectPriceLine` names the rung
    // it came from, and the spec that owns the wording is
    // `subjectPrice.spec.ts`.
    // The label is COMPUTED now (it depends on which rung the figure came
    // from), so the source carries the call rather than the words.
    expect(p).toMatch(/\$\{subjectPriceLine\(subjectPrice\)\}/);
    expect(p).toMatch(/may be stated ONCE, in the\s+property snapshot/);
    expect(p).toMatch(/no yield, no LVR, no loan, no\s+cash flow, no projection/);
  });
});

describe('the contract itself', () => {
  it('asks for a consequence, not a restatement', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Every finding ends in a consequence/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Never restate a table in a paragraph/);
    // The five labels the post-processor strips are named where the writing
    // happens, not only where it is cleaned up afterwards.
    for (const label of ['What This Means', 'Why This Matters', 'Key Takeaway', 'What To Watch', 'NPC View']) {
      expect(COMPASS_DOCUMENT_CONTRACT, label).toContain(label);
    }
  });

  it('says what depth is, because the legacy answer was length', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Depth is not length/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/A retrieved fact they could not easily get themselves/);
  });

  it('shows the invented paragraph beside the evidenced one', () => {
    // The worked examples are the load-bearing part: a prohibition with no
    // demonstration of the permitted form is one a model routes around.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Thin —/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Substantial —/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/\*\*Invented —/);
    // And it says WHY the invented one is dangerous, which is that it is
    // indistinguishable from the good one to the person acting on it.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/the reader cannot\s+tell it from the paragraph above/);
  });

  it('keeps absence and clearance apart', () => {
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/An absence is not a clearance/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/Not screened is not clear/);
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/never as a fact about the property/);
  });

  it('forbids the modelling, the minted rating, the forecast and the placeholder', () => {
    const c = COMPASS_DOCUMENT_CONTRACT;
    expect(c).toMatch(/\*\*No financial modelling\.\*\*/);
    expect(c).toMatch(/\*\*No rating you invented, in any form\.\*\*/);
    expect(c).toMatch(/\*\*No forecast\.\*\*/);
    expect(c).toMatch(/\*\*No citation markers\*\*/);
    expect(c).toMatch(/never write "N\/A", "TBD", "\[XX\]"/);
  });

  it('puts the tenant’s own name in it and never leaves the token', () => {
    const filled = compassDocumentContract('Naidu Property Consulting Services');
    expect(filled).toContain('Naidu Property Consulting Services');
    expect(filled).not.toContain('{{COMPANY}}');
    // An unnamed tenant still reads as a sentence.
    expect(compassDocumentContract('   ')).toContain('your adviser');
    expect(compassDocumentContract('   ')).not.toContain('{{COMPANY}}');
  });

  it('is about method, never about structure', () => {
    /*
     * Two statements of a structure is how the two come to disagree — the
     * defect this module exists to remove. The section registry owns the
     * structure; this owns the standard.
     */
    const c = COMPASS_DOCUMENT_CONTRACT;
    expect(c).not.toMatch(/^# \d+\./m);
    expect(c).not.toMatch(/MUST FOLLOW THIS EXACT STRUCTURE/);
    expect(c).not.toMatch(/\bminimum\b.{0,20}\bwords\b/i);
  });
});

describe('a citation marker leaves a space where a word needs one', () => {
  /*
   * `**Top strengths (locationand dwelling):**` reached page 2 of the 17 Sep
   * 2026 regeneration of 262 Pallas Street. Verified in the stored bytes:
   * `20 737472656e67746873 20 28 6c6f636174696f6e 616e64 20` — " strengths
   * (locationand " — with nothing at all between the two words.
   *
   * The model writes `location[1]and dwelling`: the marker attaches to the
   * word before it and the next word follows with no space of its own, so a
   * stripper that removes the marker outright joins them. The cause of the
   * markers is fixed too — the legacy prompt's point 8 said "Include
   * [citation] markers where data is sourced from external references" — but
   * the stripper has to be right for every marker a live search still leaves.
   */
  const strip = (t: string) => t
    .replace(/(\w)\[\d+\](?:\[\d+\])*(\w)/g, '$1 $2')
    .replace(/\[\d+\](?:\[\d+\])*/g, '');

  it('separates two words a marker was sitting between', () => {
    expect(strip('strengths (location[1]and dwelling)')).toBe('strengths (location and dwelling)');
    expect(strip('the rate[1][3]rose sharply')).toBe('the rate rose sharply');
  });

  it('leaves punctuation alone, so a full stop does not gain a space', () => {
    expect(strip('the cash rate[1]. Demand held.')).toBe('the cash rate. Demand held.');
    expect(strip('median[2], which is')).toBe('median, which is');
    expect(strip('held steady [1] over the period')).toBe('held steady  over the period');
  });

  it('is the shape the generator actually carries', () => {
    const gen = readFileSync(GEN, 'utf8');
    expect(gen).toContain("out.replace(/(\\w)\\[\\d+\\](?:\\[\\d+\\])*(\\w)/g, '$1 $2');");
  });
});

/**
 * One structure contract, and only one.
 *
 * The legacy 38-page template was removed from the Compass prompt on 17 Sep
 * 2026 and a SECOND one was left behind it: the COMPASS-40 overlay, ~3.9 KB
 * appended after everything else — so never trimmed, and the last thing the
 * model read. Written against the legacy document, it named sections the
 * canonical registry no longer has, gave PAGE caps that fought the registry's
 * WORD ceilings ("Transport — ONE 2-3 page section" against a 450-word
 * budget), and named neither of the two sections v4.0 added. A model could be
 * asked for "Planning, Zoning & What Is Mapped Over the Land" and handed, last
 * of all, a list of this document's sections that did not contain it.
 *
 * These tests hold the two halves of removing it: the second contract is gone,
 * and every control it carried is still enforced somewhere.
 */
describe('the Compass prompt states its structure exactly once', () => {
  const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');

  it('concatenates no second structure contract onto the prompt', () => {
    // Word-bounded, so the live `compass40OverlayActive` flag — which still
    // selects the canonical registry and labels the stored run — is not
    // mistaken for the deleted prompt string it used to also gate.
    const ghosts = [
      /\bcompass40Overlay\b/,
      /\bcompass40Banner\b/,
      /COMPASS-40 OVERLAY/,
      /MANDATORY OVERRIDES TO THE TEMPLATE ABOVE/,
    ];
    const live = generator.split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
    for (const ghost of ghosts) {
      expect(live.filter((l) => ghost.test(l)), `${ghost} is back in live code`).toEqual([]);
    }
    // And nothing else may be prepended or appended under the engine flag.
    const assignments = generator.split('\n').filter((l) => /^\s*prompt = /.test(l));
    expect(assignments.some((l) => /compass40/i.test(l)), 'a compass-only prompt concatenation').toBe(false);
  });

  it('keeps every control the overlay carried', () => {
    /*
     * Removing a ceremony must never remove a control. Each of these was in
     * the overlay or its banner, and each is now in
     * `buildCanonicalTemplateContext`, which is injected on the same runs.
     */
    const guide = generator.slice(
      generator.indexOf('const compassStyleRules'),
      generator.indexOf('## RECOMMENDATION FORMAT') + 400,
    );
    expect(guide).toContain('EDITORIAL_LABELS');           // forbidden labels, all forms
    expect(guide).toContain('no permitted number');         // …with no allowance
    expect(guide).toMatch(/\[citation\]/);                  // no placeholder markers
    expect(guide).toMatch(/DO NOT repeat education, transport or employment/);
    expect(guide).toMatch(/DO NOT include transition paragraphs/);
    expect(guide).toMatch(/word ceiling/);
    expect(guide).toMatch(/Bed \/ bath \/ car \/ land size/);
    expect(guide).toMatch(/Property type .* MUST be identical/);
    expect(guide).toMatch(/RECOMMENDATION FORMAT/);
    // The one line only the banner had.
    expect(guide).toMatch(/Finish every sentence and every paragraph/);
  });

  it('never puts the registry\u2019s own guide through the byte cap', () => {
    /*
     * `TEMPLATE_CONTEXT_MAX_BYTES` is 12,000 and exists for the OTHER source
     * of that string — an uploaded `report_structure_templates.parsed_content`
     * of no bounded size. The canonical guide is built from the section
     * registry, so its size is a fact about this repository's own code, and
     * v4.0's two new sections took it to 12,397 bytes.
     *
     * Measured 17 Sep 2026: at `mode: 'head'` the cap cut 665 bytes off the
     * END of every Compass run's guide — the CONSISTENCY CHECKS block and the
     * whole RECOMMENDATION FORMAT block — and replaced them with a notice
     * telling the model to "request fresh web research for missing details".
     * Two of those controls had just been carried over from the deleted
     * overlay on the ground that removing a ceremony must not remove a
     * control; they were being removed by arithmetic instead.
     */
    expect(generator).toMatch(/templateContextIsCanonical\s*\n?\s*\?\s*templateContext/);
    // The flag is set exactly where the canonical guide is built, and nowhere
    // else — an uploaded row must never be able to claim it.
    const setters = generator.split('\n').filter((l) => /templateContextIsCanonical = true/.test(l));
    expect(setters).toHaveLength(1);
    const at = generator.indexOf('templateContextIsCanonical = true');
    expect(generator.slice(at - 200, at)).toContain('buildCanonicalTemplateContext');
  });

  it('excludes the modelling and permits the price, which the overlay had backwards', () => {
    /*
     * The overlay removed "Purchase Price" and "Weekly Rent" outright — "no
     * card, no table cell, no inline mention" — which contradicted three
     * things at once: `TIER_CONTENT.compass.identityFigures` is true, the
     * masters print both on the cover band and the dashboard, and Market
     * Positioning cannot place a property in its market without naming what it
     * costs. What is excluded is the ANALYSIS and the KPI-row form.
     */
    const exclusions = generator.slice(
      generator.indexOf('## HARD EXCLUSIONS (Compass'),
      generator.indexOf('## LENGTH AND STRUCTURE'),
    );
    expect(exclusions).toMatch(/DO NOT include deposit, stamp duty/);
    expect(exclusions, 'the modelling is still excluded').toMatch(/gross\/net yield/);
    expect(exclusions, 'a blanket ban on the price is the defect').not.toMatch(/DO NOT include purchase price/i);
    expect(exclusions).toMatch(/asking price and the indicative weekly rent MAY be stated/);
    expect(exclusions).toMatch(/may not be analysed/);
    expect(exclusions).toMatch(/KPI row/);
    // The contract says the same thing in its own words, and the two must not
    // drift: one permits, the other must not forbid.
    expect(COMPASS_DOCUMENT_CONTRACT).toMatch(/price and\s+the indicative rent may be stated once/);
  });
});

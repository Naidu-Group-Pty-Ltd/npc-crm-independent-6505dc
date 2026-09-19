/**
 * A listing ADVERTISES; the record GOVERNS.
 *
 * ## The contradiction, in one document
 *
 * On 18 Annabelle Crescent the record holds `bedrooms: null`,
 * `bathrooms: null`, `parking: 2`, `land_size_sqm: 765`. The specification
 * table the prompt builds therefore printed a Parking row and a Land size row
 * and NO bedroom or bathroom row — correctly.
 *
 * The delivered Compass says, twice, that the property is *"marketed as a
 * 3-bedroom, 1-bathroom, 2-car house"*, sourced to "listings data" — and then
 * says, in its own Property Fit section, that *"the property record contains
 * no bedroom or bathroom count, so the dwelling's fit can only be assessed on
 * land, form and setting"*. One document, both claims. The same shape on 262
 * Pallas Street: *"2 bedrooms, 1 bathroom and 1 car space"* against a record
 * holding `bedrooms: null, bathrooms: null, parking: 1`.
 *
 * ## Why the model did it
 *
 * The prompt told it to. Two near-identical instruction lists — one for a
 * scraped URL, one for an uploaded PDF — each opened by naming the listing
 * *"the PRIMARY source of truth for this property's specifications"* and
 * instructing the model to *"extract and use the EXACT property
 * specifications from the listing (bedrooms, bathrooms, land size, price)"*.
 *
 * Downstream, the specification table says the opposite in terms: *"The table
 * above contains every physical attribute on record … do not state a land
 * size, floor area, bedroom or bathroom count, parking count, year built or
 * condition that is not in it."*
 *
 * Two statements of one rule is how the two come to disagree, and this pair
 * disagreed in the worst arrangement available: the listing block is
 * PREPENDED, so its instruction sits at the head of the prompt where
 * `limitPromptContext` never trims it, while the prohibition sits downstream
 * in the part that can be trimmed away. The listing won on placement.
 *
 * ## What these pin
 *
 * Source-level, because the fault is what the prompt SAYS. The price
 * instruction is deliberately untouched and asserted to still be there: what
 * a price is used for is settled by the financial engine, not by this prompt,
 * and narrowing it would reach into protected territory for no defect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERATOR = resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts');
const src = readFileSync(GENERATOR, 'utf8');

/**
 * The source with its comments removed.
 *
 * Every prohibition below is about what the PROMPT says, and this repo's
 * comments deliberately quote the wording that was wrong so the record of it
 * survives the fix. Asserting over the raw file therefore fails on its own
 * explanation — which is what happened here first: the "never instructs the
 * model to take the counts from the listing" test failed on the block comment
 * that records the instruction it removed.
 */
const prompts = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** The attributes the specification table governs. */
const GOVERNED = ['bedroom', 'bathroom', 'land size', 'floor area', 'year built', 'condition'];

describe('the listing may not supply a physical attribute', () => {
  it('never calls the listing the source of truth for specifications', () => {
    expect(prompts).not.toMatch(/PRIMARY source of truth for this property's specifications/i);
    expect(prompts).not.toMatch(/scraped content is the PRIMARY source of truth for this property\b/i);
  });

  it('never instructs the model to take the counts from the listing', () => {
    // The exact instruction that produced the claim, in either branch.
    expect(prompts).not.toMatch(/EXACT property specifications from the (listing|document)\s*\(bedrooms/i);
  });

  it('states that the record governs, and names every attribute it governs', () => {
    const rule = src.slice(src.indexOf('RECORD_GOVERNS_PHYSICAL_ATTRIBUTES'));
    expect(rule).toContain('do NOT come from this listing');
    for (const attr of GOVERNED) {
      expect(rule.toLowerCase(), attr).toContain(attr);
    }
    // And says what to do when the record is silent, which is the case that
    // produced the contradiction.
    expect(rule).toContain('NOT RECORDED');
  });

  it('puts the rule where the trim cannot reach it — inside the prepended block', () => {
    // `documentContextSection` is prepended, so a rule carried INSIDE it is
    // never trimmed. A rule that only lives downstream is the arrangement
    // that lost.
    const block = src.slice(src.indexOf('const documentContextSection'), src.indexOf('prompt = documentContextSection'));
    const instructions = src.slice(src.indexOf('const sourceSpecificInstructions'), src.indexOf('const limitedDocumentContent'));
    expect(instructions).toContain('RECORD_GOVERNS_PHYSICAL_ATTRIBUTES');
    expect(block).toContain('sourceSpecificInstructions');
  });

  it('does not repeat a governed attribute in the extracted-specifications summary', () => {
    const summary = src.slice(src.indexOf('const extractedDetailsSummary'), src.indexOf('const extractedDetailsText'));
    for (const key of ['Bedrooms:', 'Bathrooms:', 'Land Size:', 'Building Size:', 'Car Spaces:']) {
      expect(summary, key).not.toContain(key);
    }
    // The price and the property type stay: neither is a physical attribute
    // the specification table governs, and the price is protected.
    expect(summary).toContain('Price:');
    expect(summary).toContain('Property Type:');
  });

  it('is ONE instruction list, because two is how the two disagreed', () => {
    expect(prompts).not.toContain('CRITICAL INSTRUCTIONS FOR PDF-UPLOADED LISTINGS:');
    expect(prompts).not.toContain('CRITICAL INSTRUCTIONS FOR URL-SCRAPED LISTINGS:');
    expect(src).toContain('CRITICAL INSTRUCTIONS FOR THIS ${sourceLabel}:');
  });

  it('leaves the price instruction and the listing’s real job alone', () => {
    // A fix that stripped the listing of everything would cost the report its
    // description, features and renovations, which nothing else supplies.
    const instructions = src.slice(src.indexOf('const sourceSpecificInstructions'), src.indexOf('const limitedDocumentContent'));
    expect(instructions).toContain('use it for financial calculations');
    expect(instructions).toContain('features, upgrades, and selling points');
    expect(instructions).toContain('renovations, improvements, or unique characteristics');
    expect(instructions).toContain('Verify the suburb/postcode');
  });

  it('keeps the specification table’s own prohibition', () => {
    // The downstream rule is not replaced by the upstream one; both stand, and
    // now they agree.
    expect(src).toContain('The table above contains every physical attribute on record');
    expect(src).toMatch(/do not state a land size, floor area, bedroom or\s*\n?bathroom count/);
  });
});

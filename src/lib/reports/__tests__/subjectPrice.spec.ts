/**
 * One price, named by whose it is.
 *
 * From the Compass for 18 Annabelle Crescent, Kellyville:
 *
 * > On listings data, 18 Annabelle Crescent is currently marketed as a
 * > 3-bedroom, 1-bathroom, 2-car house on a 765 m² allotment, with a price
 * > guide around **$1.55m**. That guide positions the property **below the
 * > prevailing Kellyville house median**
 *
 * $1.55m is in no field of the record. The record holds
 * `manual_overrides.purchasePrice = 1490000` — which `initialCosts.propertyValue`
 * models, which `loanAmount = 1192000` is exactly 80% of, and which
 * `keyMetrics.lvr = 80` agrees with. The narrative and the Financial report
 * disagreed by $60,000.
 *
 * The prompt's own line is why: `**Asking price:** $1,490,000`, from
 * `mergedOverrides.purchasePrice || propertyDetails?.price || 0` — an
 * adviser's accepted modelling input, labelled as the market's asking price.
 *
 * `manual_overrides.propertyValue` (1,500,000 on the same record) is a
 * THIRD, separate field and stays separate: these tests assert the two are
 * never conflated to make them agree.
 */
import { describe, expect, it } from 'vitest';
import {
  describeSubjectPrice,
  subjectPriceLine,
  subjectPriceRules,
} from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';

/** Annabelle's real record. */
const ANNABELLE = { overridePurchasePrice: 1_490_000, listingPrice: 1_425_000 };

describe('the rung decides the label', () => {
  it('names an accepted override as what the analysis is modelled on', () => {
    const p = describeSubjectPrice(ANNABELLE);
    expect(p.basis).toBe('accepted_input');
    expect(p.value).toBe(1_490_000);
    expect(p.label).toBe('Purchase price this analysis is modelled on');
    expect(p.provenance).toMatch(/recorded by the adviser/);
  });

  it('keeps the generator’s own precedence — the override still wins', () => {
    // Nothing here may change WHICH figure is used: it carries the loan, the
    // LVR, every projection and the Cash Flow.
    expect(describeSubjectPrice(ANNABELLE).value).toBe(1_490_000);
  });

  it('names a listing price as the listing’s, when that is the rung', () => {
    const p = describeSubjectPrice({ listingPrice: 1_425_000 });
    expect(p.basis).toBe('listing_record');
    expect(p.value).toBe(1_425_000);
    expect(p.label).toBe('Price recorded on the listing');
  });

  it('answers not_recorded rather than zero', () => {
    for (const input of [{}, { overridePurchasePrice: 0 }, { overridePurchasePrice: null },
      { overridePurchasePrice: 'x' }, { listingPrice: NaN }]) {
      const p = describeSubjectPrice(input as never);
      expect(p.basis, JSON.stringify(input)).toBe('not_recorded');
      expect(p.value).toBeNull();
    }
  });

  it('never calls an accepted input an asking price', () => {
    const p = describeSubjectPrice(ANNABELLE);
    for (const wrong of ['asking price', 'list price', 'guide', 'marketed']) {
      expect(`${p.label} ${p.provenance}`.toLowerCase(), wrong).not.toContain(wrong);
    }
  });
});

describe('the line a reader and the model both see', () => {
  it('carries the figure and whose it is', () => {
    expect(subjectPriceLine(describeSubjectPrice(ANNABELLE)))
      .toBe('**Purchase price this analysis is modelled on:** $1,490,000 — recorded by the adviser for this '
        + 'assessment — it is the figure every projection, the loan and the lending ratio in the Financial '
        + 'Analysis Report are built on.');
  });

  it('says not recorded rather than printing a zero', () => {
    expect(subjectPriceLine(describeSubjectPrice({}))).toBe('**Purchase price:** not recorded.');
  });
});

describe('the rules stop a second price', () => {
  const rules = subjectPriceRules(describeSubjectPrice(ANNABELLE));

  it('names the one recorded price and its provenance', () => {
    expect(rules).toMatch(/exactly ONE recorded price/);
    expect(rules).toContain('$1,490,000');
  });

  it('forbids every shape the invented figure could take', () => {
    for (const shape of ['price guide', 'marketed range', 'listed at', 'on the market for',
      'estimated value', 'recent sale price']) {
      expect(rules, shape).toContain(shape);
    }
    expect(rules).toMatch(/that\s+belief is not a retrieval/);
  });

  it('permits a comparison against a SOURCED median, with its limitations', () => {
    // The defect was never the comparison — it was comparing an unsourced
    // $1.55m against an unsourced $1.96m. A sourced comparison is useful
    // analysis a reader needs, so the rule keeps it and makes its provenance
    // travel.
    expect(rules).toMatch(/You MAY compare this price with a median the market evidence table carries/);
    expect(rules).toMatch(/name the publisher, the geography, the\s+dwelling split and the period/);
    expect(rules).toMatch(/a suburb median of all houses is not a\s+statement about this house/);
  });

  it('refuses a median the table does not carry', () => {
    expect(rules).toMatch(/Do NOT compare it against a median, a "prevailing" level or a "typical" \s*figure the table does not carry/);
  });

  it('forbids the VERDICT rather than the comparison', () => {
    expect(rules).toMatch(/A comparison is a description, never a valuation/);
    for (const verdict of ['undervalued', 'a bargain', 'priced below its worth', 'good buying', 'cheap']) {
      expect(rules, verdict).toContain(verdict);
    }
    expect(rules).toMatch(/do not infer equity,\s+an instant gain or a margin from the gap/);
  });

  it('says what a comparison may discuss instead', () => {
    // A prohibition with no permitted form is one a model routes around.
    expect(rules).toMatch(/land size, condition, age, position, the spread any median hides/);
  });

  it('tells the model this figure is not an advertised price', () => {
    expect(rules).toMatch(/is the adviser’s accepted input, not an advertised price/);
    expect(rules).toMatch(/Do NOT call it the\s+"asking price"/);
  });

  it('says the opposite where the price IS the listing’s', () => {
    const listed = subjectPriceRules(describeSubjectPrice({ listingPrice: 1_425_000 }));
    expect(listed).toMatch(/is what the listing recorded/);
    expect(listed).toMatch(/Do NOT present it as a valuation, an appraisal/);
  });

  it('forbids every price where none is recorded, and any comparison', () => {
    const none = subjectPriceRules(describeSubjectPrice({}));
    expect(none).toMatch(/No price is recorded for this property/);
    expect(none).toMatch(/there is nothing to compare/);
  });
});

describe('purchasePrice and propertyValue stay separate', () => {
  it('reads only purchasePrice — propertyValue is never a rung', () => {
    // Annabelle carries purchasePrice 1,490,000 AND propertyValue 1,500,000.
    // They answer different questions (what the analysis is modelled on, what
    // the property is assessed to be worth) and the $10,000 between them is
    // information. Neither is ever written over the other to make them agree.
    const p = describeSubjectPrice({ ...ANNABELLE, propertyValue: 1_500_000 } as never);
    expect(p.value).toBe(1_490_000);
    expect(subjectPriceLine(p)).not.toContain('1,500,000');
    expect(subjectPriceRules(p)).not.toContain('1,500,000');
  });

  it('does not fall back to propertyValue when purchasePrice is absent', () => {
    const p = describeSubjectPrice({ propertyValue: 1_500_000 } as never);
    expect(p.basis).toBe('not_recorded');
  });
});

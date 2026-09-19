/**
 * Stage 1 — three rules the core reporting content depends on.
 *
 * Each was found by execution against the live corpus on 2026-09-07, not by
 * reading code, and each is the same class of defect: the record knows
 * something the report does not use, or does not know something the report
 * asserts anyway.
 *
 *  1. A yield rests on a rent. Where none is established the yield is absent.
 *  2. WHO is buying decides the duty scale, and the request already says.
 *  3. WHAT is being bought decides the duty category, and the request already
 *     says that too.
 *
 * The adoption-safety cases matter more than the new behaviour: these rules
 * sit on paths every investment report takes, so the bar is "a report with a
 * recorded rent, an owner-occupier buyer or an established dwelling resolves
 * to exactly what it resolved to before".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeFinancialChapters } from '../investment/financialChapters.pure';
import { toFinancial } from '../../../../supabase/functions/_shared/reports/investment/normalise.pure';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { buildRecordedFactsBlock } from '../investment/condenseFacts.pure';
import { rentIsEstablished } from '../investment/rentalEvidence.pure';
import { normalisePropertyType } from '../investment/overrides.pure';
import {
  AUSTRALIAN_STATES,
  DUTY_SCHEDULES,
  calculateStampDuty,
} from '../../../utils/stampDutyCalculator';

// The real shape of `Lot 2267 Hunza Road TRUGANINA (Grandview Estate)`,
// 2026-12-23: `income` null outright, both yields stored.
const UNFOUNDED = {
  income: null,
  assumptions: null,
  keyMetrics: { lvr: 80, netRentalYield: 2.57, grossRentalYield: 4.05 },
};

// A report that HAS rental evidence. Every assertion against this one is an
// adoption-safety assertion: it must render exactly as it did before.
const FOUNDED = {
  income: { weeklyRent: 600, annualRent: 31200 },
  assumptions: null,
  keyMetrics: { lvr: 80, netRentalYield: 4.1, grossRentalYield: 5.67 },
};

describe('rentIsEstablished', () => {
  it('accepts a weekly or an annual rent, however the record spells it', () => {
    expect(rentIsEstablished({ weeklyRent: 600 })).toBe(true);
    expect(rentIsEstablished({ annualRent: 31200 })).toBe(true);
    expect(rentIsEstablished({ grossAnnualRent: 31200 })).toBe(true);
    expect(rentIsEstablished({ annual: 31200 })).toBe(true);
    expect(rentIsEstablished({ weeklyRent: '$600' })).toBe(true);
  });

  it('does NOT treat a zero rent as evidence', () => {
    // `weeklyRent: 0` is the shape the original 0.00%-yield defect wrote.
    // Admitting it would readmit every figure this rule exists to remove.
    expect(rentIsEstablished({ weeklyRent: 0 })).toBe(false);
    expect(rentIsEstablished({ weeklyRent: 0, annualRent: 0 })).toBe(false);
  });

  it('answers false for an absent, null or non-object income block', () => {
    expect(rentIsEstablished(null)).toBe(false);
    expect(rentIsEstablished(undefined)).toBe(false);
    expect(rentIsEstablished({})).toBe(false);
    expect(rentIsEstablished('600')).toBe(false);
  });
});

describe('a yield whose rent is not established is absent — on every path', () => {
  // Four readers print a yield. They ask one shared rule rather than each
  // deciding, because three of them agreeing and one not is exactly how the
  // FIN table and the bound template came to disagree about the same report.

  it('the FIN chapter composer prints neither yield', () => {
    const chapters = composeFinancialChapters(
      { financialCalculations: UNFOUNDED, investmentScore: null } as never,
    );
    const rental = chapters.find((c) => /Rental/i.test(c.heading));
    // Every row suppressed, so the chapter itself has nothing to say.
    expect(rental).toBeUndefined();
  });

  it('the WeasyPrint normaliser publishes neither yield', () => {
    const model = toFinancial(UNFOUNDED) as unknown as Record<string, unknown> | null;
    expect(model).not.toBeNull();
    expect(model!.grossYield).toBeNull();
    expect(model!.netYield).toBeNull();
    // The model itself survives — the LVR is still a fact about the record.
    expect(model!.lvr).toBe(80);
  });

  it('the template binding projection publishes neither yield', () => {
    const p = projectInvestmentReport({ financial_calculations: UNFOUNDED } as never) as {
      financials?: Record<string, unknown>;
    };
    expect(p.financials?.grossYield).toBeUndefined();
    expect(p.financials?.netYield).toBeUndefined();
  });

  it('the recorded-facts block hands the model no yield to repeat', () => {
    // The widest consequence: an unfounded yield published here comes back as
    // a figure the model states as authoritative.
    const facts = buildRecordedFactsBlock(
      projectInvestmentReport({ financial_calculations: UNFOUNDED } as never) as never,
    );
    expect(facts ?? '').not.toMatch(/yield/i);
  });
});

describe('adoption safety — a report WITH rental evidence is untouched', () => {
  it('the FIN chapter prints the same four rows it always did', () => {
    const chapters = composeFinancialChapters(
      { financialCalculations: FOUNDED, investmentScore: null } as never,
    );
    const rental = chapters.find((c) => /Rental/i.test(c.heading));
    expect(rental).toBeDefined();
    expect(rental!.markdown).toContain('| Weekly rent | $600 |');
    expect(rental!.markdown).toContain('| Annual rent | $31,200 |');
    expect(rental!.markdown).toContain('| Gross rental yield | 5.67% |');
    expect(rental!.markdown).toContain('| Net rental yield | 4.1% |');
  });

  it('the normaliser and the binding projection both keep the figures', () => {
    const model = toFinancial(FOUNDED) as unknown as Record<string, unknown>;
    expect(model.grossYield).toBe(5.67);
    expect(model.netYield).toBe(4.1);

    // A tier that MAY carry the modelling: this asserts the projection keeps
    // the figures it is given, not what a tier is allowed to publish (which
    // `tierContent.pure.ts` decides and stage 3 covers).
    const p = projectInvestmentReport({ financial_calculations: FOUNDED, report_tier: 'financial' } as never) as {
      financials?: Record<string, unknown>;
    };
    expect(p.financials?.grossYield).toBe(5.67);
    expect(p.financials?.netYield).toBe(4.1);
  });
});

describe('one property-type vocabulary', () => {
  it('maps every spelling the record actually holds onto the engine vocabulary', () => {
    expect(normalisePropertyType('house')).toBe('house');
    expect(normalisePropertyType('Apartment')).toBe('unit');
    expect(normalisePropertyType('flat')).toBe('unit');
    expect(normalisePropertyType('unit')).toBe('unit');
    expect(normalisePropertyType('villa')).toBe('townhouse');
    expect(normalisePropertyType('duplex')).toBe('townhouse');
    expect(normalisePropertyType('townhouse')).toBe('townhouse');
  });

  it('leaves an unresolvable type unresolved rather than calling it a house', () => {
    // 145 stored reports say `residential property` and 72 say `land`. Neither
    // is a house, and asserting one is the silent assumption being removed.
    expect(normalisePropertyType('residential property')).toBeUndefined();
    expect(normalisePropertyType('land')).toBeUndefined();
    expect(normalisePropertyType('house_and_land')).toBeUndefined();
    expect(normalisePropertyType(undefined)).toBeUndefined();
  });

  it('the generator sends the normalised type, not the raw string', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    expect(source).toMatch(/propertyType: normalisePropertyType\(sourcePropertyType\)/);
    expect(source).toMatch(/const effectivePropertyType = normalisePropertyType\(sourcePropertyType\)/);

    // The engine, the validation service and the scoring service all take the
    // one answer. No call site may reintroduce the silent house default.
    expect(source, "the silent `|| 'house'` fallback is back")
      .not.toMatch(/propertyType: propertyDetails\?\.propertyType \|\| 'house'/);

    // Exactly one site still sends the raw string: the market rent lookup,
    // whose vocabulary is the published series' rather than the engine's.
    const rawSites = source.match(/propertyType: propertyDetails\?\.propertyType[^,\n]*/g) ?? [];
    expect(rawSites).toHaveLength(1);
    expect(rawSites[0]).toContain('toLowerCase()');
  });
});

describe('the duty assessment uses what the request already tells it', () => {
  const svc = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/financial-calculator-service/index.ts'),
    'utf8',
  );

  it('derives the scale from the buyer rather than hardcoding owner-occupier', () => {
    expect(svc).toMatch(/const intent = borrowerType === 'owner_occupier' \? 'owner_occupier' : 'investor'/);
    expect(svc, 'the hardcoded owner-occupier intent is back')
      .not.toMatch(/intent: 'owner_occupier'/);
  });

  it('derives the category from the build type, so vacant land is reachable', () => {
    expect(svc).toMatch(/buildType === 'land_only'\s*\?\s*'vacant_land'/);
  });

  it('the generator passes the build type to the engine, not only to the prompt', () => {
    const gen = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
      'utf8',
    );
    expect(gen).toMatch(/buildType: effectiveBuildType/);
  });

  it('an investor is assessed on a different scale where a state has one', () => {
    // Measured: QLD's home concession is a flat rebate, so the gap is the same
    // at every price. This is the figure the 12 stored QLD investor reports
    // were understated by.
    const price = 750_000;
    const asOwnerOccupier = calculateStampDuty({
      propertyValue: price, state: 'QLD', intent: 'owner_occupier',
      category: 'established', schedule: DUTY_SCHEDULES.QLD,
    });
    const asInvestor = calculateStampDuty({
      propertyValue: price, state: 'QLD', intent: 'investor',
      category: 'established', schedule: DUTY_SCHEDULES.QLD,
    });
    expect(asInvestor.totalDuty - asOwnerOccupier.totalDuty).toBe(7_175);
  });

  it('the category changes nothing for a buyer who is not a first home buyer', () => {
    // Scoping the vacant-land gap honestly: it is first-home relief only, and
    // 0 stored reports are FHB-eligible. Stated as a test so a future change
    // that makes category affect the base scale has to say so.
    for (const state of AUSTRALIAN_STATES) {
      for (const propertyValue of [350_000, 600_000, 900_000]) {
        const established = calculateStampDuty({
          propertyValue, state, intent: 'investor',
          category: 'established', isFirstHomeBuyer: false, schedule: DUTY_SCHEDULES[state],
        });
        const vacantLand = calculateStampDuty({
          propertyValue, state, intent: 'investor',
          category: 'vacant_land', isFirstHomeBuyer: false, schedule: DUTY_SCHEDULES[state],
        });
        expect(vacantLand.totalDuty, `${state} @ ${propertyValue}`).toBe(established.totalDuty);
      }
    }
  });
});

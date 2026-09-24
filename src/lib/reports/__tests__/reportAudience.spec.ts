/**
 * Who a document is written for — investor, owner-occupier or both.
 *
 * The owner, 23 Sep 2026: advisers, brokers and buyer's agents serve "either
 * an investor or alternatively a owner-occupied client", and the reports must
 * be "reflective of that specifically", chosen "as a toggle". See
 * `audienceContent.pure.ts` for the three rules these pin: the audience
 * decides what is PUBLISHED and never what is computed; a mixed section is
 * never cut into; and the owner-occupier's section is placed by the
 * document's own shape.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_DESCRIPTION,
  LETTING_FIGURE_KEYS,
  applyAudienceToMarkdown,
  audiencePolicyFor,
  audienceWording,
  isLettingSectionHeading,
  readReportAudience,
} from '../../../../supabase/functions/_shared/reports/investment/audienceContent.pure';
import {
  OWNER_OCCUPIER_SECTION_HEADING,
  composeOwnerOccupierLens,
  distanceText,
} from '../../../../supabase/functions/_shared/reports/location/ownerOccupierLens.pure';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import {
  EXISTING_DWELLING_CAVEAT,
  READING_LIMIT,
} from '../../../../supabase/functions/_shared/planning/landUsePermissibility.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

/**
 * A stored report row, in the shape the stored columns have and with nothing
 * real in it.
 *
 * Every name and figure below is invented. A spec may only read what the
 * repository carries (`noLocalOnlyFixtures.spec.ts`), and the rows under
 * `reports/fixtures/` are customers' records, gitignored on purpose — a spec
 * that read one passed on the machine that wrote it and could only ever fail
 * on a runner. The shapes are the ones `location-intelligence-service`, the
 * Census projection, the RBA reader and the financial engine store.
 */
const RECORD: Record<string, any> = {
  id: 'audience-spec',
  report_tier: 'compass',
  location_intelligence: {
    schools: {
      topSchools: [
        { name: 'Wattle Grove Public School', distance: 0.09 },
        { name: "St Brigid's Primary School", distance: 0.7 },
        { name: 'Ironbark High School', distance: 0.82 },
        // The same school answered twice — named once, at its nearest.
        { name: 'Wattle Grove Public School', distance: 1.4 },
        { name: 'Casuarina College', distance: 2.1 },
      ],
    },
    lifestyle: { nearestShopping: 'Wattle Grove Shopping Village', nearestPark: 'Banksia Reserve' },
    healthcare: { nearestHospital: 'Wattle Grove Physiotherapy', distanceToHospital: 0.15 },
    transport: {
      verdict: 'stops_nearby',
      nearestStation: 'Main Rd opp Banksia Ave',
      distanceToStation: 0.1,
      stopsWithin1km: 117,
      stopsWithinRadius: 117,
      radiusMetres: 1600,
      sources: ['Transport for NSW Open Data (CC BY 4.0)'],
    },
    __acquisition: {
      stages: {
        amenitySources: { schools: 'register', shopping: 'register', recreation: 'register', healthcare: 'register' },
      },
    },
  },
  demographics_data: {
    housing: { source: 'ABS Census 2021 (POA 2999)', ownerOccupierRate: 73.3, renterRate: 24.8, averageHouseholdSize: 3.3 },
    income: { source: 'ABS Census 2021 (POA 2999)', medianAge: 35 },
  },
  economic_data: {
    lendingRates: {
      source: 'RBA statistical table F5 (Indicator Lending Rates)',
      ownerOccupier: { discountedVariable: { value: 6.8, periodLabel: 'July 2026' } },
      investor: { discountedVariable: { value: 7.13, periodLabel: 'July 2026' } },
    },
  },
  financial_calculations: {
    income: { weeklyRent: 850, annualRent: 44200, occupancyWeeks: 50, effectiveAnnualRent: 42500 },
    keyMetrics: {
      lvr: 80, annualNet: -31240, weeklyNet: -601, netRentalYield: 2.61, occupancyWeeks: 50,
      totalInvestment: 312400, cashOnCashReturn: -10.0, grossRentalYield: 3.07, annualLoanPayments: 67200,
    },
    annualCosts: {
      landTax: 3200, strataFees: 0, waterRates: 900, lettingFees: 850, maintenance: 1800,
      councilRates: 2100, landlordInsurance: 1600, propertyManagement: 2975, totalAnnual: 13425,
    },
    assumptions: { capitalGrowth: 5.2, occupancyWeeks: 50 },
    loanDetails: {
      lvr: 80, loanAmount: 1152000, interestRate: 5.83, loanType: 'principal_and_interest',
      annualPayment: 81252, weeklyPayment: 1562, monthlyPayment: 6771,
    },
    initialCosts: {
      lmi: 0, deposit: 288000, legalFees: 2200, stampDuty: 59415, loanAmount: 1152000,
      totalUpfront: 350115, propertyValue: 1440000, inspectionFees: 500,
    },
  },
};

const SECTION = { heading: OWNER_OCCUPIER_SECTION_HEADING, body: '| Living here | What the evidence shows |\n| --- | --- |\n| Schools | A, 90 m |' };

/** A Financial Analysis as the fork stores it: H2 sections, letting chapters among them. */
const FINANCIAL_DOC = [
  '# Financial Analysis Report: 1 Test Street',
  '',
  '## Client Investment Decision Summary',
  'The verdict.',
  '',
  '## Financial Input Snapshot',
  'The inputs.',
  '',
  '## Price, Rent & Yield Market Positioning',
  'Where the price sits.',
  '',
  '## Rental Assessment, Gross Yield & Net Yield',
  'Rent $850 a week.',
  '',
  '### How the yield is calculated',
  'Gross over price.',
  '',
  '## Loan Structure, Repayments & Cashflow Impact',
  'The loan.',
  '',
  '## Vacancy Risk, Tenant Income & Rent Sustainability',
  'Tenants.',
  '',
  '## Tenant & Buyer Profile',
  'Who buys and who rents here.',
  '',
  '## Investor Suitability Profile',
  'What holding requires.',
  '',
  '## Holding Strategy',
  'Hold or sell.',
  '',
  '## Financial Recommendation & Portfolio Fit',
  'The recommendation.',
  '',
  '## Disclaimer',
  'General advice only.',
  '',
].join('\n');

describe('the audience', () => {
  it('reads anything it does not recognise as the investor', () => {
    expect(readReportAudience('owner_occupier')).toBe('owner_occupier');
    expect(readReportAudience('both')).toBe('both');
    for (const v of [undefined, null, '', 'Owner-occupier', 'tenant', 3]) expect(readReportAudience(v)).toBe('investor');
  });

  it('is byte-identical for the investor, whatever is handed to it', () => {
    const out = applyAudienceToMarkdown(FINANCIAL_DOC, 'investor', SECTION);
    expect(out.markdown).toBe(FINANCIAL_DOC);
    expect(out.placed).toBe(false);
    expect(out.removed).toEqual([]);
    expect(applyAudienceToMarkdown(FINANCIAL_DOC, undefined, SECTION).markdown).toBe(FINANCIAL_DOC);
  });

  it("leaves a letting's chapters out of an owner-occupier's copy, whole, and keeps what is mixed", () => {
    const out = applyAudienceToMarkdown(FINANCIAL_DOC, 'owner_occupier', null);
    expect(out.removed).toEqual([
      'Rental Assessment, Gross Yield & Net Yield',
      'Vacancy Risk, Tenant Income & Rent Sustainability',
      'Investor Suitability Profile',
      'Holding Strategy',
    ]);
    // Taken with their sub-headings, and nothing after them.
    expect(out.markdown).not.toContain('Rent $850 a week.');
    expect(out.markdown).not.toContain('How the yield is calculated');
    expect(out.markdown).toContain('## Loan Structure, Repayments & Cashflow Impact');
    // A chapter that speaks to a buyer as well is never cut into.
    expect(out.markdown).toContain('## Tenant & Buyer Profile');
    expect(out.markdown).toContain('## Price, Rent & Yield Market Positioning');
    expect(out.placed).toBe(false);
  });

  it('places the owner-occupier section after the opening run, at the document\'s own level', () => {
    const out = applyAudienceToMarkdown(FINANCIAL_DOC, 'owner_occupier', SECTION);
    expect(out.placedBefore).toBe('Price, Rent & Yield Market Positioning');
    const lines = out.markdown.split('\n');
    const at = lines.indexOf(`## ${OWNER_OCCUPIER_SECTION_HEADING}`);
    expect(at).toBeGreaterThan(lines.indexOf('## Financial Input Snapshot'));
    expect(at).toBeLessThan(lines.indexOf('## Price, Rent & Yield Market Positioning'));

    const h1 = FINANCIAL_DOC.replace(/^## /gm, '# ');
    const placed = applyAudienceToMarkdown(h1, 'both', SECTION).markdown;
    expect(placed).toContain(`\n# ${OWNER_OCCUPIER_SECTION_HEADING}\n`);
  });

  it('keeps everything for "both" and adds the section', () => {
    const out = applyAudienceToMarkdown(FINANCIAL_DOC, 'both', SECTION);
    expect(out.removed).toEqual([]);
    expect(out.markdown).toContain('## Holding Strategy');
    expect(out.markdown).toContain(`## ${OWNER_OCCUPIER_SECTION_HEADING}`);
    // Only the section was added.
    expect(out.markdown.replace(`## ${OWNER_OCCUPIER_SECTION_HEADING}\n\n${SECTION.body}\n\n`, '')).toBe(FINANCIAL_DOC);
  });

  it('takes a document that opens on no opening section after its first, and never misreads a sub-heading or a fence', () => {
    const doc = [
      '# Investment Report', '', '# 1. Location Overview', 'Where it is.', '',
      '# 2. Market Positioning', 'The market.', '', '# 11.1 Rental Market', 'A numbered sub-heading.', '',
      '```', '# Rental Market', '```', '',
    ].join('\n');
    const out = applyAudienceToMarkdown(doc, 'owner_occupier', SECTION);
    expect(out.placedBefore).toBe('2. Market Positioning');
    expect(out.removed).toEqual([]);
    expect(out.markdown).toContain('# 11.1 Rental Market');
    expect(out.markdown).toContain('```\n# Rental Market\n```');
  });

  it('names the letting sections through the registry, not by matching words', () => {
    expect(isLettingSectionHeading('Rental Market')).toBe(true);
    expect(isLettingSectionHeading('Holding Strategy')).toBe(true);
    expect(isLettingSectionHeading('Tenant & Buyer Profile')).toBe(false);
    expect(isLettingSectionHeading('Tenant Demand and Occupier Personas')).toBe(false);
    expect(isLettingSectionHeading('Loan Structure, Repayments & Cashflow Impact')).toBe(false);
    expect(isLettingSectionHeading('7.1 Rental Assessment & Yield Calculation')).toBe(false);
  });

  it('rewords the two places a tier promises a return, and nothing else', () => {
    expect(audienceWording('financial', 'owner_occupier').standfirst).not.toMatch(/returns/i);
    expect(audienceWording('financial', 'investor').standfirst).toMatch(/what it returns/);
    expect(audienceWording('compass', 'owner_occupier').companionNote).not.toMatch(/yield|cash flow/i);
    expect(audienceWording('due_diligence', 'owner_occupier')).toEqual(audienceWording('strategic', 'investor'));
    expect(audienceWording('briefing', 'owner_occupier')).toEqual(audienceWording('briefing', 'investor'));
    // Every description names what the choice does, not how it is built.
    for (const d of Object.values(AUDIENCE_DESCRIPTION)) expect(d).not.toMatch(/projection|binding|markdown/i);
  });
});

describe("the owner-occupier's section", () => {
  const record = RECORD;
  const lens = composeOwnerOccupierLens({
    locationIntelligence: record.location_intelligence,
    demographicsData: record.demographics_data,
    economicData: record.economic_data,
    carriesPlanningRegister: true,
  });

  it('answers a home buyer from the stored record, row by row', () => {
    expect(lens?.heading).toBe(OWNER_OCCUPIER_SECTION_HEADING);
    const body = lens!.body;
    expect(body).toContain("| Schools | Wattle Grove Public School, 90 m; St Brigid's Primary School, 700 m; Ironbark High School, 820 m — the nearest by straight-line distance. |");
    expect(body).toContain('Nearest shopping: Wattle Grove Shopping Village. Nearest park: Banksia Reserve.');
    expect(body).toContain('Nearest health care: Wattle Grove Physiotherapy, 150 m in a straight line.');
    expect(body).toContain('Nearest public transport stop: Main Rd opp Banksia Ave, 100 m in a straight line; 117 boarding places within 1.6 km.');
    expect(body).toContain('At the 2021 Census (ABS), 73.3% of occupied homes in postcode 2999 were owner-occupied and 24.8% rented; the average household was 3.3 people and the median age was 35.');
    expect(body).toContain("Banks' discounted variable home loan rate was 6.80% for an owner-occupier and 7.13% for an investor in July 2026 (RBA statistical table F5).");
    expect(body).toContain('*Places: © OpenStreetMap contributors. Stops: Transport for NSW Open Data (CC BY 4.0).*');
  });

  it('rates nothing, states no saturating count and prints no placeholder', () => {
    const body = lens!.body;
    expect(body).not.toMatch(/\b(excellent|good|poor|safe|well served|high quality|strong|weak|attractive)\b/i);
    expect(body).not.toMatch(/\b10 (parks|restaurants|shopping|facilities)\b/i);
    expect(body).not.toMatch(/N\/A|unavailable|not available|unknown/i);
    // A hospital is named only where the record's place is one.
    expect(body).not.toMatch(/nearest hospital/i);
  });

  it('keeps a land-use sentence\'s qualifications with it where the tier prints no planning register', () => {
    const li = {
      ...record.location_intelligence,
      planning: {
        landUse: {
          status: 'retrieved', instrument: 'The Hills Local Environmental Plan 2019', zoneCode: 'R2', objectives: null,
          permittedWithoutConsent: [], permittedWithConsent: ['Dwelling houses'], prohibited: ['Secondary dwellings'],
          source: null, sourceUrl: null, licence: null, retrievedAt: '2026-09-20T03:00:00Z', note: null,
        },
      },
    };
    const inCompass = composeOwnerOccupierLens({ locationIntelligence: li, carriesPlanningRegister: true, economicData: record.economic_data })!;
    const inSnapshot = composeOwnerOccupierLens({ locationIntelligence: li, carriesPlanningRegister: false, economicData: record.economic_data })!;
    const sentence = 'Under The Hills Local Environmental Plan 2019, as read on 20 Sep 2026, a dwelling house is permitted with development consent, and secondary dwellings (granny flats) are prohibited.';
    expect(inCompass.body).toContain(`| The land | ${sentence} |`);
    expect(inCompass.body).not.toContain(READING_LIMIT);
    expect(inSnapshot.body).toContain(`*${EXISTING_DWELLING_CAVEAT} ${READING_LIMIT}*`);
  });

  it('reads the Census and nothing that only calls itself the Census', () => {
    const generated = {
      housing: { source: 'ABS Census 2021 estimates', ownerOccupierRate: 70, renterRate: 28, averageHouseholdSize: 2.6 },
      income: { source: 'ABS Census 2021 estimates', medianAge: 38 },
    };
    const out = composeOwnerOccupierLens({
      locationIntelligence: record.location_intelligence, demographicsData: generated, economicData: record.economic_data,
    })!;
    expect(out.body).not.toContain('Neighbourhood');
  });

  it('prints a commute only where it was measured to this property\'s own centre', () => {
    const base = { ...record.location_intelligence };
    const withCommute = (commute: unknown) => composeOwnerOccupierLens({ locationIntelligence: { ...base, commute } })!.body;
    expect(withCommute({ durationMinutes: 38, distanceKm: 31.2, mode: 'driving', destination: 'Sydney CBD', destinationOwnCentre: 'yes' }))
      .toContain('A drive to Sydney CBD was measured at 38 minutes (31.2 km by road), without traffic.');
    expect(withCommute({ durationMinutes: 114, distanceKm: 150, mode: 'driving', destination: 'Melbourne CBD', destinationOwnCentre: 'no' }))
      .not.toContain('Melbourne');
    expect(withCommute({ durationMinutes: 10125, mode: 'estimated', destination: 'Sydney CBD' })).not.toContain('Sydney CBD');
    expect(withCommute({ durationMinutes: 38, mode: 'driving' })).not.toContain('A drive');
  });

  it('says nothing about transport outside the loaded networks, and is not drawn on fewer than two rows', () => {
    const outside = { transport: { verdict: 'outside_loaded_networks', nearestStation: 'N/A', distanceToStation: null } };
    expect(composeOwnerOccupierLens({ locationIntelligence: outside })).toBeNull();
    const oneRow = { schools: { nearestSchool: 'A School', distanceToSchool: 0.4 } };
    expect(composeOwnerOccupierLens({ locationIntelligence: oneRow })).toBeNull();
  });

  it('owes a line about land tax only where the financial model is printed', () => {
    const args = { locationIntelligence: record.location_intelligence, economicData: record.economic_data };
    expect(composeOwnerOccupierLens({ ...args, carriesFinancialModelling: true })!.body).toContain('exempt from land tax');
    expect(composeOwnerOccupierLens({ ...args, carriesFinancialModelling: false })!.body).not.toContain('land tax');
  });

  it('writes distances the way a reader says them', () => {
    expect(distanceText(0.09)).toBe('90 m');
    expect(distanceText(0.004)).toBe('10 m');
    expect(distanceText(1.25)).toBe('1.3 km');
    expect(distanceText(12)).toBe('12 km');
  });
});

describe('what an owner-occupier\'s projection publishes', () => {
  const record = RECORD;
  const financial = { ...record, report_tier: 'financial' };

  it('is byte-identical for the investor', () => {
    expect(projectInvestmentReport(financial as never, { audience: 'investor' }))
      .toEqual(projectInvestmentReport(financial as never));
    expect(projectInvestmentReport(financial as never).report).not.toHaveProperty('ownerOccupier');
  });

  it('withholds every figure that describes a letting and prints the rest as held', () => {
    const investor = projectInvestmentReport(financial as never);
    const owner = projectInvestmentReport(financial as never, { audience: 'owner_occupier' });
    for (const key of LETTING_FIGURE_KEYS) expect(owner.financials, key).not.toHaveProperty(key);
    expect(investor.financials).toHaveProperty('weeklyRent');
    for (const key of ['purchasePrice', 'loanAmount', 'annualRepayment', 'annualRates', 'annualMaintenance', 'stampDuty']) {
      expect(owner.financials[key], key).toBe(investor.financials[key]);
    }
    expect(owner.assumptions).not.toHaveProperty('vacancy');
    expect(owner.assumptions.capitalGrowth).toBe(investor.assumptions.capitalGrowth);
    expect(owner.report.ownerOccupier).toBe(true);
    expect(owner.report.audience).toBe('owner_occupier');
    expect(String(owner.report.standfirst)).not.toMatch(/returns/i);
  });

  it('narrows "Land tax and strata" to the strata levy a home still pays', () => {
    const fin = JSON.parse(JSON.stringify(record.financial_calculations));
    fin.annualCosts.strataFees = 2400;
    const withStrata = { ...financial, financial_calculations: fin };
    const investor = projectInvestmentReport(withStrata as never);
    const owner = projectInvestmentReport(withStrata as never, { audience: 'owner_occupier' });
    expect(investor.financials.annualOtherCosts).toBe(3200 + 2400);
    expect(owner.financials.annualOtherCosts).toBe(2400);
    // Nil strata: the line is not drawn at all for a home.
    expect(projectInvestmentReport(financial as never, { audience: 'owner_occupier' }).financials)
      .not.toHaveProperty('annualOtherCosts');
  });

  it('keeps the rest of the document the investor gets for "both"', () => {
    const investor = projectInvestmentReport(financial as never);
    const both = projectInvestmentReport(financial as never, { audience: 'both' });
    expect(both.financials).toEqual(investor.financials);
    expect(both.report.audience).toBe('both');
    expect(both.report).not.toHaveProperty('ownerOccupier');
  });
});

describe("the masters' owner-occupier band", () => {
  const OWNER = 'report && report.ownerOccupier';
  const letting = new RegExp(`\\{\\{\\s*(?:financials|assumptions)\\.(?:${[...LETTING_FIGURE_KEYS, 'vacancy', 'occupancyWeeks'].join('|')})\\b`);

  it('is drawn in place of the investor band, at the same position, on every master', () => {
    for (const template of INVESTMENT_COMPASS_TEMPLATES) {
      const dashboard = template.schema.pages.find((p: { name?: string }) => p.name === 'Executive dashboard');
      expect(dashboard, template.name).toBeDefined();
      const bands = (dashboard!.blocks as Array<{ type: string; conditional?: string; props: Record<string, unknown> }>)
        .filter((b) => b.type === 'kpi-grid');
      const owner = bands.filter((b) => b.conditional === OWNER);
      const investor = bands.filter((b) => b.conditional === `!(${OWNER})`);
      expect(owner, template.name).toHaveLength(1);
      expect(investor, template.name).toHaveLength(1);
      expect(owner[0].props.y, template.name).toBe(investor[0].props.y);
    }
  });

  it('can never bind a figure that describes a letting', () => {
    for (const template of INVESTMENT_COMPASS_TEMPLATES) {
      const dashboard = template.schema.pages.find((p: { name?: string }) => p.name === 'Executive dashboard')!;
      const owner = (dashboard.blocks as Array<{ conditional?: string; props: Record<string, unknown> }>)
        .find((b) => b.conditional === OWNER)!;
      expect(JSON.stringify(owner.props.items), template.name).not.toMatch(letting);
    }
  });

  it('is chosen by a flag only an owner-occupier\'s projection sets', () => {
    expect(audiencePolicyFor('owner_occupier').lettingFigures).toBe(false);
    expect(audiencePolicyFor('both').lettingFigures).toBe(true);
    expect(audiencePolicyFor('investor').lettingFigures).toBe(true);
  });
});

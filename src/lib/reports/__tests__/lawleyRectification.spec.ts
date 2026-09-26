/**
 * 60 Lawley Street, Spalding WA 6530 — the Investment Compass of 25 Sep 2026.
 *
 * Every test below names a defect read off that delivered document (or the
 * prompt that wrote it) and drives the REAL module that produces the page:
 * the scoring engine, the binding projection, the strategy composers, the
 * read-path scrub every renderer applies, the planning and infrastructure
 * composers and the prompt blocks the generator pins. Nothing here is a copy
 * of the code it checks.
 *
 * Two kinds of test, and the difference matters:
 *
 *  - DEFECT tests fail on the revision the document was generated from
 *    (08296a305) and pass after the repair — each is the reproduction.
 *  - PRESERVATION tests (named so) pass on both revisions. They are here to
 *    show what did NOT move: above all the score, which the brief forbids
 *    this repair to change. The frozen-input pins were measured on 08296a305.
 *
 * The market values in the scoring fixture are the illustrative state-series
 * shape `gradeFollowsScore.spec.ts` already uses; they are not Lawley's own
 * figures, and nothing here asserts a grade the property holds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  scoreForProduction,
  type ProductionScoringInput,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { verdictWatchPoints } from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import {
  buildMonitorRows,
  composeExitOutlook,
  composeGradeMethodology,
  composeMonitoringPlan,
  composeSwot,
  readStrategyRecord,
} from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import type { MarketFacts } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import type { SubjectPrice } from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';
import {
  headingSequence,
  mergeBlocksIntoSections,
} from '../../../../supabase/functions/_shared/reports/investment/documentPlacement.pure';
import {
  REGISTER_POINTER,
  dedupeRegisterTables,
} from '../../../../supabase/functions/_shared/reports/investment/registerTables.pure';
import { mergeAdjacentDuplicateHeadings } from '../../../../supabase/functions/_shared/reports/investment/sectionFolding.pure';
import {
  dropEmptySections,
  presentStoredMarkdown,
} from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import { chartContext, renderTiles } from '@/lib/reportDesign/charts.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { parseVizDirective } from '../../../../supabase/functions/_shared/reports/vizDirectives.pure';
import { directiveAsMarkdown, refusedRows } from '../../../../supabase/functions/_shared/reports/vizDirectiveTables.pure';
import { renderVizDirective } from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { sectionGuideEntry } from '../../../../supabase/functions/_shared/compassSectionContract';
import { COMPASS_40_SECTIONS } from '../../../../supabase/functions/_shared/compassSectionRegistry';
import { COMPASS_40_SECTIONS as FRONTEND_COMPASS_SECTIONS } from '@/lib/reports/compassSectionRegistry';
import { runQAValidation } from '@/lib/reports/compassQAValidator';
import { runQAValidation as runSharedQAValidation } from '../../../../supabase/functions/_shared/compassQAValidator';
import {
  populationTrendBlock,
  populationTrendPin,
  regionalTrendBlocks,
} from '../../../../supabase/functions/_shared/reports/regionalPromptBlocks.pure';
import { scoreAmenityWalkability } from '../../../../supabase/functions/_shared/reports/market/amenityWalkability.pure';
import {
  commuteSentence,
  transportFactBlocks,
} from '../../../../supabase/functions/_shared/reports/location/amenityFactBlocks.pure';
import {
  PORTAL_FIGURE_PERMITTED_FORM,
  marketFactRules,
} from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import { buildPlanningFacts } from '../../../../supabase/functions/_shared/planning/planningFacts.pure';
import { buildInfrastructureEvidence } from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';
import {
  WA_BUSHFIRE_LAYER,
  WA_BUSHFIRE_LICENCE,
  WA_BUSHFIRE_MAPSERVER,
  WA_BUSHFIRE_SOURCE,
  buildWaBushfireIdentify,
  parseNamedLayerConstraints,
} from '../../../../supabase/functions/_shared/planning/planningConstraints.pure';
import {
  NO_STATE_LAYER_NOTE,
  OVERLAY_COVERAGE,
} from '../../../../supabase/functions/_shared/planning/planningControlGuide.pure';
import { PLANNING_ANSWER_VERSION } from '../../../../supabase/functions/_shared/planning/planningAnswerVersion.pure';
import { OVERRIDE_FIELD_PATHS } from '@/components/reports/overrideOriginalValue';
import {
  DEFAULT_INVESTMENT_PRESENTATION_OPTIONS,
  filterReportContent,
} from '@/lib/reports/investment/presentationOptions';

const REPO = resolve(__dirname, '../../../..');
const source = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');

// ── the scoring fixture ──────────────────────────────────────────────────────
//
// The shape `gradeFollowsScore.spec.ts` drives the engine with: Lawley's own
// subject, price, rent and location readings, and a growth series at a chosen
// grain. At `state` grain it is the ABS series for Western Australia — the
// evidence the delivered report's grade rested on.

const NOW = new Date('2026-09-24T01:54:00Z');
type Level = 'suburb' | 'state' | 'national';

const point = (value: unknown, level: Level, areaName: string) => ({
  value, level, areaName,
  dwellingType: level === 'suburb' ? 'house' : 'any',
  dwellingTypeMatched: level === 'suburb',
  provider: level === 'suburb' ? 'vic_vpsr_suburb' : 'abs_res_dwell',
  asOf: '2026-06-30',
  sampleSize: level === 'suburb' ? 120 : null,
  periodsAvailable: 60,
  method: 'calculated',
  licensingStatus: 'open',
  acquisition: 'open_licence',
  sourceNote: null,
});

function growthPoints(level: Level, areaName: string) {
  const series = Array.from({ length: 24 }, (_, i) => ({
    period: `20${20 + Math.floor(i / 4)}-Q${(i % 4) + 1}`,
    value: Math.round(550_000 * Math.pow(1.11, i / 4)),
  }));
  return {
    priceSeries: point(series, level, areaName),
    growth1Year: point(12, level, areaName),
    growth3YearCagr: point(14, level, areaName),
    growth5YearCagr: point(11, level, areaName),
    benchmarkGrowth1Year: point(6, 'national', 'Australia'),
    benchmarkGrowth3YearCagr: point(6, 'national', 'Australia'),
    benchmarkGrowth5YearCagr: point(6.5, 'national', 'Australia'),
  };
}

function lawleyInput(points: Record<string, unknown>): ProductionScoringInput {
  return {
    subject: { suburb: 'Spalding', postcode: '6530', state: 'WA', dwellingType: 'house', resolvedFrom: 'coordinate' },
    market: {
      points: points as ProductionScoringInput['market']['points'],
      providersConsulted: ['abs_res_dwell'] as never,
      providersUnavailable: [{ provider: 'domain', reason: 'HTTP 403' }] as never,
    },
    property: { price: 499_000, weeklyRent: 525, annualOutgoings: null, propertyType: 'house' },
    finance: { lvr: 80, weeklyCashFlow: -192 },
    location: {
      walkScore: 70, commuteTimeCBD: 11, schoolsNearby: 7,
      commuteDestination: { label: 'Geraldton', ownCentre: 'yes' },
      amenities: [
        { category: 'Public Transport', count: 0, distance: null },
        { category: 'Schools', count: 7, distance: 0.75 },
        { category: 'Healthcare', count: 5, distance: 0.49 },
        { category: 'Shopping', count: 10, distance: 1.61 },
        { category: 'Recreation', count: 10, distance: 0.11 },
      ],
    },
    verifiedInputs: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
    now: NOW,
  };
}

const STATE_SERIES = () => scoreForProduction(lawleyInput(growthPoints('state', 'Western Australia')));
const SUBURB_SERIES = () => scoreForProduction(lawleyInput(growthPoints('suburb', 'Spalding')));

const LAWLEY_CAUTION = 'Capital growth is measured for Western Australia as a whole and across all dwelling '
  + "types, not for this property's suburb and dwelling type.";

/** Numbers only — everything the brief says must not move. */
function scoringNumbers(r: ReturnType<typeof scoreForProduction>) {
  const b = r.breakdown as unknown as Record<string, { score: number; weight: number; excluded: boolean }>;
  return {
    totalScore: r.totalScore,
    grade: r.grade,
    growth: [b.growthScore.score, b.growthScore.weight, b.growthScore.excluded],
    location: [b.locationScore.score, b.locationScore.weight, b.locationScore.excluded],
    yield: [b.yieldScore.score, b.yieldScore.weight, b.yieldScore.excluded],
    demand: [b.demandScore.weight, b.demandScore.excluded],
    risk: [b.riskScore.weight, b.riskScore.excluded],
    confidence: r.v2.dimensions.map((d) => [d.key, d.confidence ?? null]),
    risks: r.risks,
    caution: r.evidenceCaution?.statement ?? null,
  };
}

// ── 1. The verdict page ───────────────────────────────────────────────────────

describe('PRESERVATION — identical frozen inputs give identical scores (measured on 08296a305)', () => {
  it('state-series growth: 87, A+, weights 50/31/19, Demand and Risk excluded', () => {
    expect(scoringNumbers(STATE_SERIES())).toEqual({
      totalScore: 87,
      grade: 'A+',
      growth: [88, 50, false],
      location: [79, 31, false],
      yield: [98, 19, false],
      demand: [0, true],
      risk: [0, true],
      confidence: [['growth', 44], ['location', null], ['yield', null], ['demand', 17], ['risk', null]],
      risks: [],
      caution: LAWLEY_CAUTION,
    });
  });

  it('suburb-series growth: the same composite, with no caution', () => {
    const n = scoringNumbers(SUBURB_SERIES());
    expect(n.totalScore).toBe(87);
    expect(n.grade).toBe('A+');
    expect(n.caution).toBeNull();
  });

  it('is deterministic — two runs over one frozen input serialise identically', () => {
    expect(JSON.stringify(STATE_SERIES())).toBe(JSON.stringify(STATE_SERIES()));
  });
});

describe('the verdict page lists what to watch (page 3: an A+ with no watch point)', () => {
  it('reads the run\'s evidence caution where a V2 record has no weaknesses', () => {
    const record = STATE_SERIES();
    expect(record.weaknesses).toEqual([]);
    expect(verdictWatchPoints(record)).toEqual([LAWLEY_CAUTION]);
  });

  it('reaches the page: the projection binds it as `summary.watch`', () => {
    const p = projectInvestmentReport({
      property_address: '60 Lawley Street, Spalding WA 6530',
      investment_score: STATE_SERIES(),
    } as never);
    expect(p.summary.watch).toEqual([LAWLEY_CAUTION]);
  });

  it('changes nothing else — a record with weaknesses prints exactly those, and a V1 record\'s purchase risks are never read', () => {
    expect(verdictWatchPoints({ weaknesses: ['Limited recent growth'], risks: ['x'], v2: {} }))
      .toEqual(['Limited recent growth']);
    expect(verdictWatchPoints({
      weaknesses: [], risks: ['Significant negative cash flow requiring ongoing funding'],
    })).toEqual([]);
    expect(verdictWatchPoints(null)).toEqual([]);
  });

  it('PRESERVATION — scoring OFF: a row carrying no score binds no strength and no watch point', () => {
    // The adapter nulls `investment_score` when "Include scoring" is off.
    const p = projectInvestmentReport({ property_address: '60 Lawley Street', investment_score: null } as never);
    expect(p.summary.watch).toBeUndefined();
    expect(p.summary.strength).toBeUndefined();
  });
});

describe('the growth strength names the geography it was measured for', () => {
  it('a state series is credited as a state series, in the caution\'s own words', () => {
    expect(STATE_SERIES().strengths[0])
      .toBe('Measured capital growth is strong for Western Australia as a whole, across all dwelling types');
  });

  it('PRESERVATION — a suburb series keeps the sentence it always had', () => {
    expect(SUBURB_SERIES().strengths[0]).toBe('Measured capital growth in this suburb is strong');
  });
});

describe('page 3\'s configuration line says what it does not hold', () => {
  it('"2 car" alone is never printed as the whole configuration', () => {
    const p = projectInvestmentReport({
      property_address: '60 Lawley Street',
      property_specs: { parking: 2, bedrooms: null, bathrooms: null },
    } as never);
    expect(p.property.configuration).toBe('2 car · bedrooms and bathrooms not recorded');
  });

  it('PRESERVATION — a complete configuration is unchanged, and nothing held draws no row', () => {
    const full = projectInvestmentReport({
      property_address: 'x', property_specs: { bedrooms: 3, bathrooms: 1, parking: 2 },
    } as never);
    expect(full.property.configuration).toBe('3 bed · 1 bath · 2 car');
    const none = projectInvestmentReport({ property_address: 'x', property_specs: {} } as never);
    expect(none.property.configuration).toBeUndefined();
  });

  it('the operator can now record the rooms and the build year through the existing override route', () => {
    expect(OVERRIDE_FIELD_PATHS.bedrooms).toBe('propertySpecs.bedrooms');
    expect(OVERRIDE_FIELD_PATHS.bathrooms).toBe('propertySpecs.bathrooms');
    expect(OVERRIDE_FIELD_PATHS.yearBuilt).toBe('propertySpecs.yearBuilt');
    const modal = source('src/components/reports/ManualDataOverrideModal.tsx');
    for (const key of ['bedrooms', 'bathrooms', 'yearBuilt']) {
      expect(modal, key).toMatch(new RegExp(`key: '${key}'`));
    }
    // …and the generator already reads all three from the merged overrides.
    const generator = source('supabase/functions/generate-investment-report/index.ts');
    expect(generator).toContain('mergedOverrides.bedrooms');
    expect(generator).toContain('mergedOverrides.bathrooms');
    expect(generator).toContain('mergedOverrides.yearBuilt');
  });
});

// ── 2. SWOT, method and the closing sections ──────────────────────────────────

const NO_MARKET: MarketFacts = {
  rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true,
};
const PRICE: SubjectPrice = {
  basis: 'accepted_input',
  value: 499_000,
  label: 'Purchase price this analysis is modelled on',
  provenance: 'recorded by the adviser for this assessment',
};

/** A Lawley-shaped strategy record. The rooms and the year are what an operator would record. */
function lawleyStrategy(specs: Record<string, unknown> = {}) {
  return readStrategyRecord({
    propertyAddress: '60 Lawley Street, Spalding WA 6530',
    propertySpecs: { property_type: 'house', parking: 2, land_size_sqm: 728, ...specs },
    investmentScore: STATE_SERIES(),
    dataSources: { planning: { zoneStatus: 'licence_restricted', council: 'GREATER GERALDTON' } },
    locationIntelligence: {
      transport: { nearestStation: null, distanceToStation: null, stationsWithin2km: 0, source: 'osm_amenity_register' },
    },
  }, {
    market: NO_MARKET,
    price: PRICE,
    carriesModelling: false,
    transport: null,
    measuredAt: '2026-09-25T01:32:00.000Z',
  });
}

describe('the SWOT reads the dwelling (page 16: "no weakness identified" beside a one-bathroom 1970s house)', () => {
  it('names a single bathroom and an older build as weaknesses where the record holds them', () => {
    const swot = composeSwot(lawleyStrategy({ bedrooms: 3, bathrooms: 1, year_built: 1979 }), 'SWOT Analysis');
    expect(swot).toContain('One bathroom serving 3 bedrooms.');
    expect(swot).toContain('An older dwelling, built in 1979.');
    expect(swot).toMatch(/it is a limitation of the layout, not a defect/);
    expect(swot).toMatch(/Age is not a defect/);
  });

  it('PRESERVATION — invents nothing where the record holds neither fact', () => {
    const swot = composeSwot(lawleyStrategy(), 'SWOT Analysis');
    expect(swot).not.toMatch(/One bathroom|An older dwelling/);
    // A two-bathroom house and a recent build are not weaknesses either.
    const newer = composeSwot(lawleyStrategy({ bedrooms: 4, bathrooms: 2, year_built: 2012 }), 'SWOT Analysis');
    expect(newer).not.toMatch(/One bathroom|An older dwelling/);
  });

  it('says which evidence it read — a council route is not a register measurement, a portal figure is not a register reading', () => {
    const swot = composeSwot(lawleyStrategy(), 'SWOT Analysis');
    expect(swot).toContain('A route or timetable described elsewhere in this report comes from the operator\'s '
      + 'or council\'s own published pages; it is not a measurement and is not scored.');
    expect(swot).toContain('The sources checked for this report hold no figure for vacancy, days on market');
  });
});

describe('the grade\'s method leaves the SWOT for the appendix (pages 16-18: three quarters of the SWOT was method)', () => {
  it('the SWOT carries no method table; `composeGradeMethodology` carries it whole', () => {
    const rec = lawleyStrategy();
    expect(composeSwot(rec, 'SWOT Analysis')).not.toContain('### How this grade was reached');
    const method = composeGradeMethodology(rec) ?? '';
    expect(method.startsWith('### How this grade was reached')).toBe(true);
  });

  it('says the record HOLDS the adjusted weights, and never "reconstructed" beside "nothing is re-derived"', () => {
    const method = composeGradeMethodology(lawleyStrategy()) ?? '';
    expect(method).not.toContain('This record does not hold them, so they are reconstructed');
    expect(method).not.toContain('This record does not hold the adjusted weights the scoring method used');
    expect(method).toMatch(/adjusted weights (below )?are the ones the record holds/);
    expect(method).toContain('No figure in this table is re-derived by this report');
  });

  it('scoring OFF removes the method from the document; ON leaves it byte-identical', () => {
    const doc = [
      '## Final Recommendation', '', 'Proceed with caution.', '',
      '## Appendix, Source Notes & Disclaimer', '', 'Sources.', '',
      composeGradeMethodology(lawleyStrategy()) ?? '', '',
      '### Disclaimer', '', 'General information only.', '',
    ].join('\n');
    expect(filterReportContent(doc, DEFAULT_INVESTMENT_PRESENTATION_OPTIONS)).toBe(doc);
    const off = filterReportContent(doc, { ...DEFAULT_INVESTMENT_PRESENTATION_OPTIONS, includeScoring: false });
    expect(off).not.toContain('How this grade was reached');
    expect(off).toContain('## Appendix, Source Notes & Disclaimer');
    expect(off).toContain('### Disclaimer');
    expect(off).toContain('Proceed with caution.');
  });
});

describe('the exit outlook describes only what it draws (page 19 introduced a projection the Compass does not carry)', () => {
  it('a Compass (no modelling) promises no future-year position', () => {
    const exit = composeExitOutlook(lawleyStrategy(), 'Resale Liquidity & Exit Outlook');
    expect(exit).not.toContain('What the position looks like at a future year');
    expect(exit).toContain('None of the sources checked for this report holds days on market, time to sell or buyer depth');
  });
});

describe('monitoring separates research still owed from readings to watch (page 21: "On request")', () => {
  it('a planning control no register answered is a first check, with an event, never "On request"', () => {
    const rec = lawleyStrategy();
    const planning = buildMonitorRows(rec).find((r) => /planning/i.test(r.what));
    expect(planning?.firstCheck).toBe(true);
    expect(planning?.cadence).not.toBe('On request');
    const plan = composeMonitoringPlan(rec, 'Monitoring & Review Plan');
    expect(plan).toContain('### First checks still owed');
    expect(plan.indexOf('### First checks still owed')).toBeLessThan(plan.indexOf('planning controls that apply'));
    expect(plan).not.toMatch(/\bOn request\b/);
  });
});

// ── 3. Document assembly ──────────────────────────────────────────────────────

const PLANNING_PART = '### Planning controls retrieved for this property\n\n| Control | Reading | Standing | Evidence |\n|---|---|---|---|\n| Zone | Not retrieved | — | licence |\n';
const INFRA_PART = '### Infrastructure and development retrieved for this property\n\nNo project register answered.\n';
const METHOD_PART = '### How this grade was reached\n\nThe method.\n';

const blocks = () => [
  { into: 'planning', markdown: PLANNING_PART, fallback: { heading: 'Planning controls and development registers', markdown: `## Planning controls and development registers\n\n${PLANNING_PART}`, order: 89 } },
  { into: 'infrastructure', markdown: INFRA_PART, fallback: { heading: 'Infrastructure and development registers', markdown: `## Infrastructure and development registers\n\n${INFRA_PART}`, order: 89 } },
  { into: 'provenance', markdown: METHOD_PART, fallback: { heading: 'How this grade was reached', markdown: METHOD_PART.replace(/^###\s+/, '## '), order: 89 } },
];

const COMPASS_DOC = [
  '## Zoning, Planning and Development Considerations', '', 'The zone could not be read.', '',
  '## Infrastructure and Growth Context', '', 'No register named a project.', '',
  '## SWOT Analysis', '', 'Quadrants.', '',
  '## Final Recommendation', '', 'Proceed with caution.', '',
  '## Appendix, Source Notes & Disclaimer', '', 'Sources.', '',
].join('\n');

describe('evidence closes the chapter it is evidence for (page 10 pointed to page 21, past the recommendation)', () => {
  it('each register lands at the end of its own chapter, and the recommendation stays the last assessment', () => {
    const out = mergeBlocksIntoSections(COMPASS_DOC, blocks(), 'compass');
    expect(out.indexOf(PLANNING_PART.trim())).toBeGreaterThan(out.indexOf('The zone could not be read.'));
    expect(out.indexOf(PLANNING_PART.trim())).toBeLessThan(out.indexOf('## Infrastructure and Growth Context'));
    expect(out.indexOf(INFRA_PART.trim())).toBeLessThan(out.indexOf('## SWOT Analysis'));
    expect(out.indexOf(METHOD_PART.trim())).toBeGreaterThan(out.indexOf('## Appendix, Source Notes & Disclaimer'));
    expect(headingSequence(out).slice(-2)).toEqual(['Final Recommendation', 'Appendix, Source Notes & Disclaimer']);
    expect(out).not.toContain('## Planning controls and development registers');
  });

  it('a chapter that is absent falls back to the old placement, so nothing is lost', () => {
    const noPlanning = COMPASS_DOC.replace('## Zoning, Planning and Development Considerations\n\nThe zone could not be read.\n\n', '');
    const out = mergeBlocksIntoSections(noPlanning, blocks(), 'compass');
    expect(out).toContain('## Planning controls and development registers');
    expect(out).toContain(PLANNING_PART.trim());
  });

  it('no blocks, or blocks already present, leave the document byte-identical', () => {
    expect(mergeBlocksIntoSections(COMPASS_DOC, [], 'compass')).toBe(COMPASS_DOC);
    const once = mergeBlocksIntoSections(COMPASS_DOC, blocks(), 'compass');
    expect(mergeBlocksIntoSections(once, blocks(), 'compass')).toBe(once);
  });
});

describe('a reproduced register points at the register that is actually there', () => {
  const TABLE = '| Control | Reading | Standing | Evidence |\n|---|---|---|---|\n| Zone | Not retrieved | — | licence |';

  it('the chapter\'s copy gives way to the register sub-heading, which keeps its rows', () => {
    const md = [
      '## Zoning, Planning and Development Considerations', '', 'As tabled:', '', TABLE, '', 'Prose.', '',
      '### Planning controls retrieved for this property', '', TABLE, '| Height | Not retrieved | — | — |', '',
      '## Infrastructure and Growth Context', '', 'Next.', '',
    ].join('\n');
    const out = dedupeRegisterTables(md);
    expect(out.replaced).toHaveLength(1);
    expect(out.markdown).toContain('*Set out in full under “Planning controls retrieved for this property”.*');
    expect(out.markdown).toContain('| Height | Not retrieved | — | — |');
    expect(out.markdown).not.toContain('Planning controls and development registers');
  });

  it('PRESERVATION — a stored report with the old register section keeps its pointer word for word', () => {
    const md = [
      '## Zoning', '', TABLE, '',
      '## Planning controls and development registers', '', TABLE, '',
    ].join('\n');
    expect(dedupeRegisterTables(md).markdown).toContain(REGISTER_POINTER);
  });
});

describe('a heading printed twice in a row is printed once (page 18: "Crime and personal safety" twice)', () => {
  it('folds two depths of one heading, and a bold line standing in for it', () => {
    const md = [
      '## Risk Dashboard', '',
      '### Crime and personal safety', '', '#### Crime and personal safety', '', 'Area statistics only.', '',
      '### Infrastructure timing', '', '**Infrastructure timing**', '', 'Not assessed.', '',
    ].join('\n');
    const out = mergeAdjacentDuplicateHeadings(md).markdown;
    expect(out.match(/Crime and personal safety/g)).toHaveLength(1);
    expect(out.match(/Infrastructure timing/g)).toHaveLength(1);
    expect(out).toContain('### Infrastructure timing');
    expect(out).toContain('Area statistics only.');
  });

  it('PRESERVATION — a line of content between them means the second opens something, and it stays', () => {
    const md = '### Crime and personal safety\n\nThe register.\n\n**Crime and personal safety**\n\nMore.\n';
    expect(mergeAdjacentDuplicateHeadings(md).markdown).toBe(md);
  });
});

describe('an empty "Disclaimer" heading is dropped; the disclaimer and the notes are not', () => {
  it('a heading over nothing but footnote definitions goes, and the definitions stay', () => {
    const md = '## Appendix, Source Notes & Disclaimer\n\nSources.\n\n### Disclaimer\n\n[^1]: ABS, Regional population, 2025.\n';
    const out = dropEmptySections(md);
    expect(out.dropped).toContain('Disclaimer');
    expect(out.markdown).not.toContain('### Disclaimer');
    expect(out.markdown).toContain('[^1]: ABS, Regional population, 2025.');
  });

  it('PRESERVATION — a heading with its own text after the notes is kept', () => {
    const md = '### Disclaimer\n\n[^1]: A note.\n\nThis report is general information only.\n';
    expect(dropEmptySections(md).markdown).toContain('### Disclaimer');
  });
});

describe('our own words never reach the page as labels (page 10 "ConfidenceChip:", page 7 "Date something happened")', () => {
  const DOC = [
    '## Zoning, Planning and Development Considerations', '',
    'ConfidenceChip: Desktop retrieval — parcel-level planning confirmation required', '',
    'Risk register: the entries below are read from the registers.', '',
    '| Project | Status | Date something happened |', '|---|---|---|', '| Road upgrade | Funded | 2024-05-01 |', '',
  ].join('\n');

  it('the read path every renderer applies rewrites both, keeping the model\'s own statement', () => {
    const out = presentStoredMarkdown(DOC);
    expect(out).not.toMatch(/ConfidenceChip|confidence_?chip/i);
    expect(out).toContain('Confidence: Desktop retrieval — parcel-level planning confirmation required');
    expect(out).not.toContain('Date something happened');
    expect(out).toContain('Recorded milestone date');
    expect(out).toContain('| Road upgrade | Funded | 2024-05-01 |');
    // An ordinary lead-in a writer may use is not ours.
    expect(out).toContain('Risk register: the entries below are read from the registers.');
  });

  it('PRESERVATION — leaves a fenced block and a clean document exactly as they were', () => {
    const fenced = '## Notes\n\n```\nconfidenceChip: literal\n```\n';
    expect(presentStoredMarkdown(fenced)).toContain('confidenceChip: literal');
    const clean = '## Heading\n\nConfidence: stated plainly.\n';
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });

  it('the section guide no longer hands the model an identifier to print', () => {
    for (const section of COMPASS_40_SECTIONS) {
      const entry = sectionGuideEntry(section);
      expect(entry, section.id).not.toMatch(/confidenceChip|planningActionTable|attributeTable|infrastructureTimeline/);
    }
  });

  it('the infrastructure purpose asks for a recorded milestone, in both registry mirrors', () => {
    for (const list of [COMPASS_40_SECTIONS, FRONTEND_COMPASS_SECTIONS]) {
      const purposes = list.map((s) => s.purpose).join('\n');
      expect(purposes).not.toContain('the date something HAPPENED');
      expect(purposes).toContain('Recorded milestone');
    }
  });
});

describe('one recommendation (cover "STRONG BUY", p.21 "proceed only after"; then "Proceed with caution" on the regeneration)', () => {
  /*
   * RENEGOTIATED 25 Sep 2026. Item 9 was first answered by telling both
   * sections what "the scoring model's classification" is and that their own
   * Proceed / Proceed with caution / Not suitable verdict must not be softened
   * to match it. The regeneration obeyed: its cover said STRONG BUY, its
   * Executive Verdict and Final Recommendation said "Proceed with caution",
   * and it told the client the difference was what "the model does not
   * measure". Two verdicts, explained in the platform's vocabulary. This block
   * pinned that instruction; it now pins its removal. The rule itself — one
   * recommendation, the one the cover prints, with its conditions kept as
   * conditions — is `oneRecommendation.spec.ts`.
   */
  it('neither section is told the grade is a model\'s classification, in either registry mirror', () => {
    for (const list of [COMPASS_40_SECTIONS, FRONTEND_COMPASS_SECTIONS]) {
      const verdict = list.find((s) => s.id === 'compass.executiveVerdict')!.purpose;
      const closing = list.find((s) => s.id === 'compass.finalRecommendation')!.purpose;
      for (const purpose of [verdict, closing]) {
        expect(purpose).not.toContain('classification');
        expect(purpose).not.toContain('the model does not measure');
        expect(purpose).toContain('the recommendation this document issues');
      }
      // The qualification is kept — as a condition of the one recommendation.
      expect(verdict).toContain('each written as a condition of the recommendation with the check that settles it');
      expect(closing).toContain('with every condition the recommendation depends on kept and stated as a condition');
    }
  });
});

describe('a summary card grows for its words (page 4: "TENANT DEMAND / Established family-oriented…")', () => {
  it('draws a three-line phrase whole, as page 4\'s four cards had it', () => {
    const svg = renderTiles(chartContext(resolveReportPalette()), [
      { label: 'Market momentum', value: 'WA growth', sub: '14.0% p.a. over five years' },
      { label: 'Planning controls', value: 'Verification required', sub: 'Zone and overlays not retrieved' },
      { label: 'Tenant demand', value: 'Established family-oriented rental demand', sub: 'Geraldton locality' },
      { label: 'Infrastructure outlook', value: 'Registers not assessed', sub: 'No project finding available' },
    ], { title: 'At a glance' });
    const text = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    expect(svg).not.toContain('…');
    expect(text).toEqual(expect.arrayContaining(['Established', 'family-oriented', 'rental demand']));
  });
});

describe('a comparison with one side left is not drawn (page 14: the subject alone under "competing Houses")', () => {
  const ONE_SIDED = 'Subject · 3-bed house, 12 Example Road n/a, 7 Sample Street n/a | title=Visible competing Houses in Spalding';

  it('declines on both paths — the drawn figure and the tabulated one — caption included', () => {
    const d = parseVizDirective('bars', ONE_SIDED)!;
    expect(renderVizDirective(chartContext(resolveReportPalette()), d)).toBeNull();
    expect(directiveAsMarkdown(d)).toBeNull();
    expect(refusedRows(['Subject · 3-bed house', '12 Example Road n/a'])).toEqual([]);
  });

  it('PRESERVATION — two real sides still make a table', () => {
    const d = parseVizDirective('bars', 'Subject · 3-bed house, 12 Example Road · 4-bed house | title=Two listings')!;
    const md = directiveAsMarkdown(d) ?? '';
    expect(md).toContain('| Subject | 3-bed house |');
    expect(md).toContain('| 12 Example Road | 4-bed house |');
  });
});

describe('QA reads a run-in second list ("**Watch points:** …") as a second list', () => {
  const md = [
    '## Property Fit', '', '### Strengths and watch points', '',
    '- Established street', '- Level block', '',
    '**Watch points:** one bathroom; older construction', '',
    '## Risk Dashboard', '', 'x', '',
  ].join('\n');

  it('in both copies of the validator', () => {
    for (const run of [runQAValidation, runSharedQAValidation]) {
      expect(run(md, 'compass-40').findings.some((f) => f.rule === 'unbalanced-pair')).toBe(false);
    }
  });

  it('PRESERVATION — a pair with no second list is still reported', () => {
    const lone = md.replace('**Watch points:** one bathroom; older construction\n', '');
    expect(runQAValidation(lone, 'compass-40').findings.some((f) => f.rule === 'unbalanced-pair')).toBe(true);
  });
});

// ── 4. The evidence each section is handed ───────────────────────────────────

const REGIONAL = {
  regionalTrends: {
    sa2: { name: 'Geraldton - East' },
    population: {
      source: 'ABS Regional population 2024-25',
      latest: { year: 2025, erp: 12_413 },
      oneYear: { window: '2024 to 2025', annualPercent: 0.4, changePeople: 49, totalPercent: 0.4 },
      fiveYear: { window: '2020 to 2025', annualPercent: 0.32, changePeople: 198, totalPercent: 1.62 },
    },
  },
};

describe('population figures are stated with their window (page 4 said "0.3% between 2020 and 2025")', () => {
  it('the table names the five-year total and the yearly rate as different figures', () => {
    expect(populationTrendBlock(REGIONAL)).toContain('+198 people, +1.62% in total (an average of 0.32% a year)');
  });

  it('the rule carries the permitted sentence and names the SA2 as a statistical area', () => {
    const block = regionalTrendBlocks(REGIONAL);
    expect(block).toContain('rose 1.62% between 2020 and 2025, by 198 people');
    expect(block).toContain('an average of 0.32% a year over those 5 years');
    expect(block).toContain('never "Geraldton - East\'s population"');
  });

  it('rides the pinned context, so no trim can separate the figure from its rule', () => {
    const pin = populationTrendPin(REGIONAL);
    expect(pin).toContain('in total (an average of 0.32% a year)');
    expect(pin).toContain('HOW TO STATE THE POPULATION FIGURES');
    expect(populationTrendPin({})).toBe('');
  });

  it('PRESERVATION — a one-year row reads as it did', () => {
    expect(populationTrendBlock(REGIONAL)).toContain('| 1-year change (2024 to 2025) | +49 people, +0.4% |');
  });
});

describe('transport: a station count is not "no public transport" (pages 9-10 against pages 17 and 20)', () => {
  const LAWLEY_TRANSPORT = {
    transport: { nearestStation: null, distanceToStation: null, stationsWithin2km: 0, source: 'osm_amenity_register' },
  };

  it('the prompt block states the count, what it cannot see, and never "no reading was retrieved"', () => {
    const block = transportFactBlocks(LAWLEY_TRANSPORT);
    expect(block).not.toContain('No public-transport reading was retrieved');
    expect(block).toContain('Transit stations within 2 km (OpenStreetMap): **0**');
    expect(block).toContain('bus stops are not in it');
    expect(block).toContain('A count of stations is not a finding that the area has no public transport');
  });

  it('a route or a timetable found in a search may be attributed, never quantified or taken from a profile', () => {
    const block = transportFactBlocks(LAWLEY_TRANSPORT);
    expect(block).toMatch(/Do NOT state a frequency, a number of services/);
    expect(block).toMatch(/never take service information from a council, community or locality profile/);
  });

  it('the score\'s own detail says what it counted — and the score does not move', () => {
    const amenities = [
      { category: 'Public Transport', count: 0, distance: null },
      { category: 'Schools', count: 7, distance: 0.75 },
    ];
    const r = scoreAmenityWalkability(amenities as never);
    const transit = r.components.find((c) => c.category === 'Public Transport');
    expect(transit?.detail).toMatch(/^no transit station within the searched radius \(a count of rail, tram and interchange stations/);
    expect(transit?.detail).not.toBe('no public transport within the searched radius');
  });

  it('a drive is called a free-flow drive, and a journey planner\'s answer is called one', () => {
    const drive = commuteSentence(
      { durationMinutes: 11, distanceKm: 6.2, destination: 'Geraldton', mode: 'driving', destinationOwnCentre: 'yes' }, {});
    expect(drive).toContain('Measured drive to **Geraldton**: 11 minutes / 6.2 km');
    expect(drive).toContain('not a peak-hour commute');
    const transit = commuteSentence(
      { durationMinutes: 38, destination: 'Geraldton', mode: 'public_transit', destinationOwnCentre: 'yes' }, {});
    expect(transit).toContain('Measured public-transport journey to **Geraldton**');
    expect(transit).not.toContain('driving');
  });
});

describe('a portal\'s figure has a permitted form (pages 13-14 quoted REIWA, Domain and PropertyValue)', () => {
  const HELD: MarketFacts = {
    rows: [{
      key: 'growth5YearCagr', label: 'Price growth, 5 years (compound annual)', value: '11.0%',
      describes: 'Western Australia — all dwellings', publisher: 'ABS', note: null, benchmark: false,
    }],
    withheld: [], unavailable: [], consulted: ['abs_res_dwell'], anyStated: true, evidenceMissing: false,
  };

  it('is in both branches of the rules, and carries no number of its own', () => {
    expect(marketFactRules(NO_MARKET)).toContain(`1a. ${PORTAL_FIGURE_PERMITTED_FORM}`);
    expect(marketFactRules(HELD)).toContain(`1a. ${PORTAL_FIGURE_PERMITTED_FORM}`);
    expect(PORTAL_FIGURE_PERMITTED_FORM).not.toMatch(/\d/);
  });

  it('the ABS series is named as the measure it is', () => {
    expect(source('supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts'))
      .toContain("abs_res_dwell: 'Australian Bureau of Statistics — mean price of residential dwellings'");
  });
});

describe('the generator pins the evidence it used to trim away, and moves the syntax reference out of the way', () => {
  const generator = source('supabase/functions/generate-investment-report/index.ts');

  it('pins the population trend and the transport reading', () => {
    expect(generator).toContain('const population = populationTrendPin(enhancedData);');
    expect(generator).toContain('transportFactBlocks(enhancedData.locationIntelligence),');
  });

  it('pins the attributes on record, so a searched room count is never "the supplied property records" (pp.3-4)', () => {
    // One composition, drawn in the base prompt and in the pin.
    expect(generator).toContain('const recordedAttributesBlock = `| Property Characteristic | Value |');
    expect(generator).toContain("'# The property — every physical attribute on record',\n      recordedAttributesBlock,");
    expect(generator).toContain('${recordedAttributesBlock}');
    // The prohibition keeps its permitted form beside it.
    expect(generator).toContain('An attribute you find in a listing or any other search is not a record');
    expect(generator).toContain('write that it is to be confirmed against the contract,');
  });

  it('carries the shortcode vocabulary in the system message, not in every section\'s user message', () => {
    expect(generator).not.toContain('${EDITORIAL_PRIMITIVES_BLOCK}\n');
    expect(generator).toContain('const editorialSystemBlock = `\\n\\n---\\n\\n${EDITORIAL_PRIMITIVES_BLOCK.trim()}`;');
    expect(generator).toContain('- byteLength(editorialSystemBlock) - 200');
  });

  it('merges the registers into their chapters after the composed sections are placed', () => {
    const placed = generator.indexOf('reportContent = placeBlocksByDeclaredOrder(reportContent, placeableBlocks');
    const merged = generator.indexOf('reportContent = mergeBlocksIntoSections(reportContent, mergeableBlocks');
    expect(placed).toBeGreaterThan(0);
    expect(merged).toBeGreaterThan(placed);
    expect(generator).not.toMatch(/placeableBlocks\.push\(\{\s*heading: 'Planning controls and development registers'/);
  });
});

// ── 5. Western Australian planning ───────────────────────────────────────────

const WA_PLANNING = (overrides: Record<string, unknown> = {}) => buildPlanningFacts({
  planningData: {
    fetchedAt: '2026-09-25T01:32:00.000Z',
    jurisdiction: 'WA',
    coordinate: { latitude: -28.7247, longitude: 114.6283 },
    zoning: { status: 'licence_restricted', note: 'WA planning scheme data (SLIP) is published for personal, non-commercial use.' },
    developmentInstruments: {
      status: 'not_integrated',
      note: 'State development-instrument layers are integrated for Queensland only so far.',
    },
    constraints: [],
    constraintsAsked: [],
    constraintRegisters: { answered: [], unavailable: [] },
  },
  overrides: overrides as never,
});

describe('a Western Australian lot is described in Western Australia\'s terms (a "floor space ratio" three times)', () => {
  it('lists the R-Code, the height and the plot ratio — never a floor space ratio', () => {
    const labels = WA_PLANNING().controls.map((c) => c.label);
    expect(labels).toEqual(['Residential density code (R-Code)', 'Maximum building height', 'Plot ratio']);
    const code = WA_PLANNING().controls[0];
    expect(code.value).toBeNull();
    expect(code.note).toMatch(/Residential Design Codes of Western Australia/);
  });

  it('PRESERVATION — keeps a minimum lot size an operator recorded', () => {
    const labels = WA_PLANNING({ minimumLotSize: 600 }).controls.map((c) => [c.label, c.value]);
    expect(labels[0]).toEqual(['Minimum lot size', '600 m²']);
  });

  it('PRESERVATION — every other jurisdiction keeps its three rows', () => {
    const nsw = buildPlanningFacts({ planningData: { jurisdiction: 'NSW', fetchedAt: '2026-09-25T00:00:00Z' } });
    expect(nsw.controls.map((c) => c.label)).toEqual(['Minimum lot size', 'Maximum building height', 'Floor space ratio']);
  });
});

describe('a note about our build is written in the reader\'s words (printed four times)', () => {
  // The service's own diagnostic words stay in the service; the page prints
  // an adviser's sentence (`readerNote`, serviceNote.pure.ts).
  const READER = 'State-level development designations are not covered by this report for Western Australia. Any '
    + 'that affect the property will appear on the local government’s planning certificate.';

  it('in the planning table', () => {
    expect(WA_PLANNING().instruments.note).toBe(READER);
  });

  it('in the infrastructure register the model is handed', () => {
    const evidence = buildInfrastructureEvidence({
      planningData: {
        jurisdiction: 'WA',
        fetchedAt: '2026-09-25T01:32:00.000Z',
        developmentInstruments: {
          status: 'not_integrated',
          note: 'State development-instrument layers are integrated for Queensland only so far.',
        },
      },
    });
    const reading = evidence.readings.find((r) => r.register === 'development instruments');
    expect(reading?.note).toBe(READER);
    expect(reading?.reading).toBe('not_searched');
  });

  it('the service writes the reader\'s sentence itself from now on', () => {
    const service = source('supabase/functions/planning-data-service/index.ts');
    expect(service).not.toContain('integrated for Queensland only so far');
  });
});

describe('Western Australia\'s bush fire prone areas are read (the page said "Bushfire | Not searched")', () => {
  /*
   * The publisher's own answer, measured 25 Sep 2026 from this repository's
   * sandbox at a point inside the designated polygon nearest Lawley Street
   * (~850 m away). Verbatim, so the parse is tested on the real shape.
   */
  const POSITIVE = {
    results: [{
      layerId: 23,
      layerName: 'Bushfire Prone Areas (OBRM-026)',
      displayFieldName: 'LGA',
      value: 'GREATER GERALDTON',
      attributes: {
        OBJECTID: '58', Shape: 'Polygon', LGA: 'GREATER GERALDTON',
        Designation: 'Bush Fire Prone Area (additional planning and building requirements may apply to development on this site)',
        Type: 'BPA', 'Designation Date': '12/13/2025', 'Planning Area': 'Bushfire Prone Area 2',
        'Transition Period': 'No', 'st_area(shape)': '0.421087', 'st_perimeter(shape)': '49.169944',
      },
    }],
  };
  const parse = (body: unknown) => parseNamedLayerConstraints(body, {
    asked: ['bushfire'],
    source: WA_BUSHFIRE_SOURCE,
    licence: WA_BUSHFIRE_LICENCE,
    instrument: 'Designation of bush fire prone areas by the Fire and Emergency Services Commissioner',
    family: { family: 'bushfire', kind: 'hazard' },
    valueAttribute: 'Designation',
    dateAttribute: 'Designation Date',
  } as never);

  it('asks the one open-licence layer by explicit id', () => {
    const url = new URL(buildWaBushfireIdentify(114.6283, -28.7247));
    expect(url.href.startsWith(WA_BUSHFIRE_MAPSERVER)).toBe(true);
    expect(url.searchParams.get('layers')).toBe(`all:${WA_BUSHFIRE_LAYER}`);
    expect(WA_BUSHFIRE_LICENCE).toBe('CC BY 4.0');
  });

  it('files a designation as a designation, with the publisher\'s own date', () => {
    const out = parse(POSITIVE);
    expect(out.status).toBe('ok');
    const [reading] = out.readings;
    expect(reading.family).toBe('bushfire');
    expect(reading.label).toBe('Bushfire Prone Areas (OBRM-026) — Bush Fire Prone Area (additional planning and '
      + 'building requirements may apply to development on this site)');
    expect(reading.label).not.toContain('GREATER GERALDTON');
    expect(reading.currencyDate).toBe('2025-12-13');
  });

  it('PRESERVATION — an empty answer at the point is "searched, nothing mapped" — and says which register was asked', () => {
    const out = parse({ results: [] });
    expect(out.status).toBe('none_at_point');
    expect(out.asked).toEqual(['bushfire']);
  });

  it('the service asks it for WA, and a cached answer from before cannot withhold it', () => {
    const service = source('supabase/functions/planning-data-service/index.ts');
    expect(service).toContain("} else if (jurisdiction === 'WA') {");
    expect(service).toContain('buildWaBushfireIdentify(lng, lat)');
    expect(service).toContain("valueAttribute: 'Designation'");
    expect(PLANNING_ANSWER_VERSION).toBe('c7');
  });

  it('coverage says what is read and what is still not, in one sentence per jurisdiction', () => {
    expect(OVERLAY_COVERAGE.WA).toBe('partial_state_layers_read');
    expect(NO_STATE_LAYER_NOTE.WA).toMatch(/bush fire prone area designation is read/);
    expect(NO_STATE_LAYER_NOTE.WA).toMatch(/planning scheme zones, density codes and other overlays, and its floodplain mapping/);
    expect(NO_STATE_LAYER_NOTE.WA).toMatch(/nothing here says whether any of them applies\./);
  });
});

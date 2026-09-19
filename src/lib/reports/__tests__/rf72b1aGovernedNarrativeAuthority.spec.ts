/**
 * RF-7.2B.1A — GOVERNED NARRATIVE AUTHORITY.
 *
 * The prose fixtures below are VERBATIM from two reports this pipeline
 * generated in production on 2026-09-11, both of which recorded
 * `market.demographics` as `absent` in `market_fact_snapshot` and then stated
 * demographic figures anyway:
 *
 *   09f8569e-21ca-48b9-a3b9-57f4793d0836   48 Redfern Street, Cowra NSW 2794
 *   3fbbcfe6-eaad-490c-a10d-cfaa757820f5   28 Bligh Street, Muswellbrook NSW 2333
 *
 * They are kept as regression evidence rather than paraphrased, because the
 * detector has to survive the sentences that actually occurred — footnote
 * markers, en-dashed ranges, `{{…}}` visual directives and all. Muswellbrook's
 * claimed figures disagree with the record the platform holds for POA 2333
 * (population 13,795, median age 36, median household income $1,640/wk), which
 * is what makes the false attribution the serious half of the defect.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  auditGovernedNarrativeAuthority,
  governedAuthorityBlockFromFlags,
  governedAuthorityBlocks,
  governedCategoryDirective,
  governedCategoryStanding,
  governedFaultToFlag,
} from '../contract/governedNarrativeAuthority.pure';
import type { SnapshotFact } from '../contract/safeGenerationInputs.pure';

const absentFact = (name: string): SnapshotFact => ({
  name,
  status: 'absent',
  value: null,
  source: 'withheld',
  dataset: null,
  grain: null,
  geographyId: null,
  referencePeriod: null,
  asOf: null,
  ruling: 'Withheld: no trusted geography for this property.',
});

const presentFact = (name: string, value: number): SnapshotFact => ({
  name,
  status: 'present',
  value,
  source: 'abs_census_poa',
  dataset: 'ABS Census 2021 GCP DataPack (POA)',
  grain: 'postcode',
  geographyId: '2333',
  referencePeriod: '2021',
  asOf: '2026-09-06',
  ruling: 'Observed and owned; published as stated.',
});

/** The shape the two production reports actually carried. */
const WITHHELD = { facts: [absentFact('market.demographics')] };

/** A partially-resolved report: three demographic figures held, the rest not. */
const ADMISSIBLE = {
  facts: [
    presentFact('market.population', 13795),
    presentFact('market.medianAge', 36),
    presentFact('market.medianHouseholdIncomeWeekly', 1640),
  ],
};

/**
 * Everything the gate can evidence, present. Built fact by fact rather than
 * by asserting a category, because the gate emits per metric and a fixture
 * that skipped one would prove the opposite of what it claims.
 */
const FULLY_ADMISSIBLE = {
  facts: [
    presentFact('market.demographics', 1),
    presentFact('market.population', 13795),
    presentFact('market.medianAge', 36),
    presentFact('market.medianHouseholdIncomeWeekly', 1640),
    presentFact('market.medianRentWeekly', 300),
    presentFact('market.medianMortgageMonthly', 1517),
    presentFact('market.ownerOccupierRate', 60.5),
    presentFact('market.renterRate', 36.2),
    presentFact('abs.seifa.irsdDecile', 2),
    presentFact('abs.seifa.irsadDecile', 2),
    presentFact('abs.seifa.ierDecile', 3),
    presentFact('abs.seifa.ieoDecile', 1),
    presentFact('abs.unemploymentRate', 5.7),
    presentFact('abs.labourForceParticipation', 59.3),
    presentFact('abs.labourForce', 6406),
    presentFact('abs.industryShare.Mining', 32),
  ],
};

// --- production prose, verbatim ------------------------------------------

const COWRA_POPULATION =
  'ABS regional population spreadsheets for 2023–24 show the Cowra SA2 at around '
  + '9,150–9,138 residents, a very small movement over the year, while the Cowra Shire '
  + 'ERP series reported roughly 12,659 residents in 2023 rising to around 12,680–12,721 '
  + 'by 2024–25.';

const COWRA_SPARKLINE =
  '{{margin: Cowra Shire ERP trend, 2015–2024 | spark=12759,12720,12690,12659,12680,12721 '
  + '| label=Population stability}}';

const COWRA_QUALITATIVE =
  'Cowra functions as a regional centre with schools, health services, retail and light '
  + 'industrial employment, so tenants are typically local workers, families and retirees '
  + 'rather than transient short-stay populations.';

const MUSWELLBROOK_CENSUS =
  'According to the Australian Bureau of Statistics 2021 Census, Muswellbrook township '
  + 'recorded 12,272 residents, with a median age of 35 and an average household size of '
  + '2.5 people, indicating a mix of young families, couples and single-person households.';

const MUSWELLBROOK_INCOME =
  'The Muswellbrook LGA records a median personal income of around $55,000–$56,000 per '
  + 'year and a median weekly household income of approximately $1,603, according to ABS '
  + '2021 Census data and NEMA\'s LGA profile.';

const MUSWELLBROOK_LABOUR =
  'The Muswellbrook Local Government Area has a labour force of around 7,700–8,000 people, '
  + 'with approximately 7,300–8,500 residents employed across full-time and part-time roles, '
  + 'according to 2021 Census data.';

const MUSWELLBROOK_QUALITATIVE =
  'The land size allows for yard space, off-street parking and privacy—features that remain '
  + 'central to demand in Muswellbrook\'s regional setting, where households often value '
  + 'space and practicality over compact urban living.';

describe('RF-7.2B.1A — category standing', () => {
  it('reads a withheld demographics umbrella as withheld', () => {
    expect(governedCategoryStanding(WITHHELD).demographics).toBe('withheld');
  });

  it('reads a category with no fact at all as withheld, never admissible', () => {
    const standing = governedCategoryStanding({ facts: [] });
    expect(standing.demographics).toBe('withheld');
    expect(standing.seifa).toBe('withheld');
    expect(standing.employment).toBe('withheld');
  });

  it('reads a fully-evidenced category as admissible', () => {
    expect(governedCategoryStanding(FULLY_ADMISSIBLE).demographics).toBe('admissible');
  });

  it('does NOT read a partly-evidenced category as admissible', () => {
    // population/age/income held; rent, mortgage, tenure and household size not.
    expect(governedCategoryStanding(ADMISSIBLE).demographics).toBe('withheld');
  });
});

describe('RF-7.2B.1A — pre-generation directive', () => {
  it('names the category and the specific substitutions it forbids', () => {
    const directive = governedCategoryDirective(WITHHELD);
    expect(directive).toContain('NOT AVAILABLE');
    expect(directive).toContain('resident demographics');
    expect(directive).toMatch(/median age/i);
    // Not a generic "do not invent data" — the banned routes are named.
    expect(directive).toMatch(/web search/i);
    expect(directive).toMatch(/SA2/);
    expect(directive).toMatch(/\bLGA\b/);
    expect(directive).toMatch(/ERP/);
    expect(directive).toMatch(/Census/);
  });

  it('keeps qualitative discussion explicitly permitted', () => {
    expect(governedCategoryDirective(WITHHELD)).toMatch(/qualitatively/i);
  });

  it('is empty when every governed figure is admissible, so a healthy prompt is unchanged', () => {
    expect(governedCategoryDirective(FULLY_ADMISSIBLE)).toBe('');
  });

  it('names the specific missing figures when a category is only PARTLY available', () => {
    const directive = governedCategoryDirective(ADMISSIBLE);
    expect(directive).toMatch(/PARTLY AVAILABLE/);
    expect(directive).toMatch(/median rent/i);
    expect(directive).toMatch(/tenure split/i);
    // and must not claim the figures it DOES hold are unavailable
    expect(directive).not.toMatch(/- resident population;/);
  });
});

describe('RF-7.2B.1A — post-generation authority audit (BLOCK cases)', () => {
  it('blocks a population claim while demographics are withheld', () => {
    const faults = auditGovernedNarrativeAuthority(COWRA_POPULATION, WITHHELD);
    expect(faults.length).toBeGreaterThan(0);
    expect(faults.some((f) => f.category === 'demographics')).toBe(true);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a median-age claim', () => {
    const faults = auditGovernedNarrativeAuthority(
      'The suburb records a median age of 35 across its resident base.',
      WITHHELD,
    );
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a household-income claim', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_INCOME, WITHHELD);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks a false ABS/Census attribution and names it as one', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_CENSUS, WITHHELD);
    expect(faults.some((f) => f.kind === 'false_attribution')).toBe(true);
    expect(governedAuthorityBlocks(faults)).toBe(true);
  });

  it('blocks cross-grain substitution (SA2 / LGA / township / shire / ERP)', () => {
    const faults = auditGovernedNarrativeAuthority(COWRA_SPARKLINE, WITHHELD);
    expect(faults.some((f) => f.kind === 'cross_grain_substitution')).toBe(true);
  });

  it('blocks a withheld employment claim', () => {
    const faults = auditGovernedNarrativeAuthority(MUSWELLBROOK_LABOUR, WITHHELD);
    expect(faults.some((f) => f.category === 'employment')).toBe(true);
  });

  it('catches the whole Cowra passage as one report body', () => {
    const body = [COWRA_QUALITATIVE, COWRA_POPULATION, COWRA_SPARKLINE].join('\n\n');
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(body, WITHHELD))).toBe(true);
  });
});

describe('RF-7.2B.1A — PASS cases (the detector must not be brittle)', () => {
  it('passes qualitative tenant and demand commentary carrying no governed number', () => {
    expect(auditGovernedNarrativeAuthority(COWRA_QUALITATIVE, WITHHELD)).toEqual([]);
    expect(auditGovernedNarrativeAuthority(MUSWELLBROOK_QUALITATIVE, WITHHELD)).toEqual([]);
  });

  it("passes the property's own figures, which are not governed facts", () => {
    const prose =
      'The dwelling offers three bedrooms and one bathroom on 988 m² of land, purchased '
      + 'at $555,000 with a weekly rent of $445 and an 80% loan-to-value ratio.';
    expect(auditGovernedNarrativeAuthority(prose, WITHHELD)).toEqual([]);
  });

  it('passes a census YEAR mentioned beside a governed term with no figure', () => {
    const prose = 'Population characteristics were last measured at the 2021 Census.';
    expect(auditGovernedNarrativeAuthority(prose, WITHHELD)).toEqual([]);
  });

  it('passes an admissible demographic fact quoted correctly', () => {
    const prose =
      'The postal area recorded a population of 13,795 at the 2021 Census, with a median '
      + 'age of 36 and a median weekly household income of $1,640.';
    expect(auditGovernedNarrativeAuthority(prose, ADMISSIBLE)).toEqual([]);
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(prose, ADMISSIBLE))).toBe(false);
  });

  it('raises no new fault on a healthy report whose figures are all admissible', () => {
    const body = [MUSWELLBROOK_CENSUS, MUSWELLBROOK_INCOME, MUSWELLBROOK_LABOUR].join('\n\n');
    expect(auditGovernedNarrativeAuthority(body, FULLY_ADMISSIBLE)).toEqual([]);
  });
});

/**
 * Calibration against real prose, not invented prose.
 *
 * Every unit below is verbatim from the stored Cowra report. They were pulled
 * by selecting every claim unit in that document containing ANY governed term,
 * which is the set a brittle detector would over-fire on. The point of the
 * block is the ratio: the detector must find the two fabrications and leave
 * the ten innocent units alone.
 */
describe('RF-7.2B.1A — calibration on the real Cowra document', () => {
  const INNOCENT: ReadonlyArray<readonly [string, string]> = [
    ['A', 'Cowra’s residential pocket around **48 Redfern Street** offers a straightforward regional house-and-land play: solid local amenity and community attachment, a genuine family-tenant market.'],
    ['B', 'The broader suburb context around Redfern Street is characterised by **free-standing houses on generous blocks**, many between 900 m² and 2,200 m².'],
    ['C', 'The subject asset at **48 Redfern Street, Cowra NSW 2794** is recorded as a **Residential Property on a 988 m² block with one parking space**.'],
    ['D', 'Cowra functions as a regional centre with schools, health services, retail and light industrial employment, so tenants are typically **local workers, families and retirees** rather than transient short-stay populations.'],
    ['F', '- **Owner-occupier appeal:** Strong, given the renovated interiors, sizeable block and conventional street character'],
    ['H', 'The broader LGA’s area of roughly 2,800 square kilometres and a single main town centre mean Cowra functions as the primary location for schooling, healthcare, retail, and community services.'],
    ['I', '### Population and Development Trajectory'],
    ['J', 'The population trend insight is that Cowra’s headcount has been broadly stable to mildly growing over the past decade, with modest short-term fluctuations rather than rapid expansion or steep decline.'],
    ['K', 'The New South Wales Government’s Cowra Regional Economic Development Strategy describes Cowra as a major population centre in the central west, located on the Lachlan River.'],
    ['L', 'From an occupier fit perspective, the property’s layout and land size make it **best suited to long-term family renters and owner-occupiers who value space and a traditional home**.'],
  ];

  it.each(INNOCENT)('passes real unit %s', (_id, text) => {
    expect(auditGovernedNarrativeAuthority(text, WITHHELD)).toEqual([]);
  });

  it('blocks the fabricated resident population (real unit G)', () => {
    const g =
      'Cowra Shire’s estimated resident population was about 12,721 people as at June 2025 '
      + 'according to the Cowra Shire demographic profile, with the Cowra SA2 containing around '
      + '9,150–9,273 residents.';
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(g, WITHHELD))).toBe(true);
  });

  it('blocks a model-drawn occupier-mix chart asserting a tenure split (real unit E)', () => {
    const e =
      '{{donut: Family renters 45, Local owner-occupiers 35, Professionals & small households 20 '
      + '| title=Likely occupier mix | center=45% | centerSub=Family renters}}';
    expect(governedAuthorityBlocks(auditGovernedNarrativeAuthority(e, WITHHELD))).toBe(true);
  });
});

/**
 * Source-level wiring, because a pure module cannot tell you whether
 * production calls it — and the first draft of this change injected the
 * directive into `propertyPrompt` alone, which is one of FOUR scope prompts.
 * An address report would have carried the rule and a suburb report would
 * not. That is the same "exists but is not wired" shape RF-7.2B.1 was opened
 * to close, so it is pinned here rather than trusted.
 */
describe('RF-7.2B.1A — wired into the real generator', () => {
  const generator = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/generate-investment-report/index.ts'),
    'utf-8',
  );

  it('imports the module', () => {
    expect(generator).toContain('governedNarrativeAuthority.pure.ts');
  });

  it('appends the directive AFTER the scope selects, so all four prompts carry it', () => {
    const selection = generator.indexOf('let prompt = reportScope ===');
    const injection = generator.indexOf('prompt += governedCategoryDirective(');
    expect(selection).toBeGreaterThan(-1);
    expect(injection).toBeGreaterThan(selection);
  });

  it('does not inject the directive into any single scope template instead', () => {
    expect(generator).not.toContain('${governedCategoryDirective(');
  });

  it('runs the audit over the assembled report and feeds validation_flags', () => {
    expect(generator).toContain('auditGovernedNarrativeAuthority(');
    expect(generator).toContain('...governedFlags,');
  });
});

/**
 * High-precision guard. A blocking audit that fires on ordinary numeric prose
 * would withhold good reports, which is a worse failure than the one being
 * fixed — so these are the shapes a careless detector trips on.
 */
/**
 * Fact-level authority. Proved from the gate rather than assumed: it emits one
 * snapshot fact per metric, so a path the ABS row lacks yields an ABSENT fact
 * beside present siblings. The categories are NOT atomic, and a present figure
 * must not authorise the absent one next to it.
 */
describe('RF-7.2B.1A — one present fact does not authorise its absent siblings', () => {
  const partial = (present: string[], absent: string[]) => ({
    facts: [
      ...present.map((n) => presentFact(n, 1)),
      ...absent.map((n) => absentFact(n)),
    ],
  });

  it('population present + median age absent → median age claim BLOCKS', () => {
    const snap = partial(['market.population'], ['market.medianAge', 'abs.medianAge']);
    const faults = auditGovernedNarrativeAuthority(
      'The suburb records a median age of 35 years.', snap);
    expect(faults.some((f) => f.topic === 'medianAge')).toBe(true);
  });

  it('population present + income absent → income claim BLOCKS', () => {
    const snap = partial(['market.population'],
      ['market.medianHouseholdIncomeWeekly', 'abs.medianWeeklyIncome']);
    const faults = auditGovernedNarrativeAuthority(
      'Median weekly household income is approximately $1,603.', snap);
    expect(faults.some((f) => f.topic === 'income')).toBe(true);
  });

  it('population present → a population claim still PASSES', () => {
    const snap = partial(['market.population'], ['market.medianAge']);
    const faults = auditGovernedNarrativeAuthority(
      'The postal area recorded a population of 13,795.', snap);
    expect(faults.some((f) => f.topic === 'population')).toBe(false);
  });

  it('one SEIFA index present + another absent → the absent index BLOCKS', () => {
    const snap = partial(['abs.seifa.irsdDecile'], ['abs.seifa.ieoDecile']);
    const faults = auditGovernedNarrativeAuthority(
      'The area scores an IEO decile of 1.', snap);
    expect(faults.some((f) => f.topic === 'seifaIeo')).toBe(true);
    // and the one it DOES hold is not blocked
    expect(auditGovernedNarrativeAuthority('The IRSD decile is 2.', snap)
      .some((f) => f.topic === 'seifaIrsd')).toBe(false);
  });

  it('industry share present + unemployment absent → unemployment claim BLOCKS', () => {
    const snap = partial(['abs.industryShare.Mining'],
      ['abs.unemploymentRate', 'market.unemploymentRate']);
    const faults = auditGovernedNarrativeAuthority(
      'The unemployment rate sits at 5.7%.', snap);
    expect(faults.some((f) => f.topic === 'unemployment')).toBe(true);
  });

  it('two different absent figures each report, rather than collapsing into one', () => {
    const snap = partial(['market.population'],
      ['market.medianAge', 'market.medianHouseholdIncomeWeekly']);
    const body = 'The median age is 35.\nMedian household income is $1,603.';
    const topics = auditGovernedNarrativeAuthority(body, snap).map((f) => f.topic);
    expect(topics).toContain('medianAge');
    expect(topics).toContain('income');
  });
});

describe('RF-7.2B.1A — false-positive guard', () => {
  const CLEAN: ReadonlyArray<readonly [string, string]> = [
    ['purchase price near demographic language',
      'The home suits the local tenant population and was purchased for $555,000.'],
    ['land size', 'The dwelling sits on 988 m² with a 136 m² build footprint.'],
    ['census year only', 'The area was last enumerated at the 2021 Census.'],
    ['interest rate', 'Modelling assumes an interest rate of 6.5% over a 30-year term.'],
    ['postcode', 'The property is located in Cowra NSW 2794.'],
    ['dates', 'Settlement is projected for 12 August 2026, with review in 2027.'],
    ['qualitative occupier commentary',
      'Demand is driven by families and retirees who value space near town services.'],
    ['weekly rent', 'The property returns $445 per week to its owner.'],
    ['stamp duty', 'Stamp duty of $19,162 and solicitor fees of $1,800 apply at settlement.'],
    ['occupancy', 'The model assumes 50 weeks of occupancy per year.'],
  ];

  it.each(CLEAN)('passes: %s', (_label, text) => {
    expect(auditGovernedNarrativeAuthority(text, WITHHELD)).toEqual([]);
  });

  it('passes a legitimate governed number when the snapshot fact is present', () => {
    const prose = 'The postal area recorded an unemployment rate of 5.7% at the 2021 Census.';
    const withEmployment = { facts: [presentFact('abs.unemploymentRate', 5.7)] };
    expect(auditGovernedNarrativeAuthority(prose, withEmployment)
      .filter((f) => f.category === 'employment')).toEqual([]);
  });
});

describe('RF-7.2B.1A — the stored verdict drives the delivery gate', () => {
  it('reads a blocking flag back out of stored validation_flags', () => {
    const [fault] = auditGovernedNarrativeAuthority(MUSWELLBROOK_CENSUS, WITHHELD);
    const stored = [governedFaultToFlag(fault)];
    const verdict = governedAuthorityBlockFromFlags(stored);
    expect(verdict.blocked).toBe(true);
    expect(verdict.categories).toContain('demographics');
  });

  it('does not block on other flag types', () => {
    const stored = [
      { type: 'market_claim', severity: 'high', field: 'x', message: 'm', value: { kind: 'grain' } },
      { type: 'quality', severity: 'medium', field: 'y', message: 'm', value: {} },
    ];
    expect(governedAuthorityBlockFromFlags(stored).blocked).toBe(false);
  });

  it('does not block a governed flag that is not marked blocking', () => {
    const stored = [{ type: 'governed_authority', severity: 'critical', field: 'f', message: 'm', value: { blocking: false } }];
    expect(governedAuthorityBlockFromFlags(stored).blocked).toBe(false);
  });

  it('fails OPEN on absent or unreadable flags — 1,190 stored reports predate this', () => {
    expect(governedAuthorityBlockFromFlags(null).blocked).toBe(false);
    expect(governedAuthorityBlockFromFlags(undefined).blocked).toBe(false);
    expect(governedAuthorityBlockFromFlags('not an array').blocked).toBe(false);
    expect(governedAuthorityBlockFromFlags([]).blocked).toBe(false);
    expect(governedAuthorityBlockFromFlags([null, 3, 'x']).blocked).toBe(false);
  });
});

describe('RF-7.2B.1A — enforcement is wired into the client deliverable', () => {
  const pdf = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/render-investment-report-pdf/index.ts'),
    'utf-8',
  );
  const regen = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/regenerate-report-qualitative/index.ts'),
    'utf-8',
  );

  it('the PDF route selects validation_flags and refuses a blocked report', () => {
    expect(pdf).toContain('governedAuthorityBlockFromFlags');
    expect(pdf).toMatch(/validation_flags/);
    expect(pdf).toContain('report_not_client_ready');
    expect(pdf).toContain('status: 409');
  });

  it('the refusal retains the report rather than deleting or failing it', () => {
    expect(pdf).not.toMatch(/delete\(\)[\s\S]{0,120}governed/i);
    expect(pdf).toMatch(/retained for review/i);
  });

  it('the portal refuses a blocked report even when a PDF was rendered earlier', () => {
    const portal = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/get-portal-client-data/index.ts'),
      'utf-8',
    );
    expect(portal).toContain('governedAuthorityBlockFromFlags');
    expect(portal).toContain('report_not_client_ready');
    // The check must run on the SOURCE report whenever one exists — not only
    // when storage_path is missing, because this function caches that path and
    // never consults the investment report again once it has.
    const check = portal.indexOf('governedAuthorityBlockFromFlags');
    const cache = portal.indexOf("let storagePath = report.storage_path");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(cache);
  });

  it('qualitative regeneration carries the same directive and audit', () => {
    expect(regen).toContain('governedCategoryDirective(safeGeneration.snapshot)');
    expect(regen).toContain('auditGovernedNarrativeAuthority(');
    expect(regen).toContain('updatePayload.validation_flags');
  });

  it('regeneration reuses the shared module, never its own category list', () => {
    expect(regen).toContain('governedNarrativeAuthority.pure.ts');
    expect(regen).not.toMatch(/const\s+\w*CATEGORIES\w*\s*[:=]/);
  });
});

/*
 * The template route is the OTHER renderer, and `produceInvestmentDocument`
 * asks it FIRST. Measured in production 2026-09-12: `report_templates` carries
 * three active `investment_compass` rows plus one `investment`, and
 * `template_render_jobs` holds eleven succeeded `final`-mode Investment Compass
 * renders (most recent 2026-09-04). A gate on the fallback alone was a gate on
 * the path that is taken second.
 */
describe('RF-7.2B.1A — the template route is gated too, and it is tried first', () => {
  const tpl = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/render-template-pdf/index.ts'),
    'utf-8',
  );
  const route = readFileSync(
    resolve(__dirname, '../../reportTemplate/routeReportThroughTemplate.ts'),
    'utf-8',
  );
  const produce = readFileSync(
    resolve(__dirname, '../investment/deliverInvestmentPdf.ts'),
    'utf-8',
  );

  it('the template route really is attempted before the standard renderer', () => {
    // The ORDER is the rule: a person's chosen template wins, and the standard
    // document is what happens when there isn't one. RC-3.1 replaced the
    // standard renderer (Cloud Run WeasyPrint → the browser's pdf-lib
    // generator) and left that order exactly as it was.
    const templated = produce.indexOf('tryTemplateDocument(');
    const standard = produce.indexOf('generateInvestmentPdfBlob(');
    expect(templated).toBeGreaterThan(-1);
    expect(standard).toBeGreaterThan(-1);
    expect(templated).toBeLessThan(standard);
  });

  /**
   * The gate used to be the render SERVICE's alone: the route named the report
   * to `render-template-pdf`, which read `validation_flags` and answered 409,
   * and the browser's standard generator never asked — so a blocked report
   * drew a PDF and saved it whenever no template was active.
   *
   * It sits above both presentations now, which is strictly stronger. The
   * service still keeps its own reading for a `final` render (RS-2 brought
   * the print engine back for the templated document), and that is a second
   * gate behind the first rather than the only one: a client can be handed a
   * stale row, a server cannot.
   */
  it('the readiness gate runs before a presentation is chosen at all', () => {
    const gate = produce.indexOf('assertInvestmentReportClientReady(');
    const templated = produce.indexOf('tryTemplateDocument(');
    const standard = produce.indexOf('generateInvestmentPdfBlob(');
    expect(gate, 'nothing checks client readiness before the document is produced')
      .toBeGreaterThan(-1);
    expect(gate).toBeLessThan(templated);
    expect(gate).toBeLessThan(standard);
    // And it is the SAME rule the portal applies, imported rather than
    // re-implemented — two readings of one row is how they come to disagree.
    const readiness = readFileSync(
      resolve(__dirname, '../investment/clientReadiness.ts'),
      'utf-8',
    );
    expect(readiness).toContain('governedAuthorityBlockFromFlags');
    expect(readiness).toContain('governedNarrativeAuthority.pure');
  });

  it('the route never names the render service itself — one client, one transport', () => {
    // The final render goes through `weasyRenderClient`, the one module that
    // names the function, so the route cannot address it by a second spelling
    // or a hand-rolled fetch.
    expect(route).not.toContain("'render-template-pdf'");
    expect(route).toContain("from '@/lib/reportTemplate/weasyRenderClient'");
  });

  it('the renderer reads the stored verdict and refuses with the same 409', () => {
    expect(tpl).toContain('governedAuthorityBlockFromFlags');
    expect(tpl).toContain('governedNarrativeAuthority.pure.ts');
    expect(tpl).toContain('report_not_client_ready');
    expect(tpl).toContain('status: 409');
  });

  // The CALL site, not the import line — `indexOf` finds the import first, and
  // an import sits before everything, so anchoring on it would make the
  // ordering assertions below pass whatever the code did.
  const callSite = tpl.indexOf('governedAuthorityBlockFromFlags(', tpl.indexOf('\n', tpl.indexOf('import { governedAuthorityBlockFromFlags')));

  it('the refusal happens BEFORE the document is drawn', () => {
    const draw = tpl.indexOf('await callWeasyPrint(');
    expect(callSite).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(-1);
    expect(callSite).toBeLessThan(draw);
  });

  it('a preview is exempt — the refusal is about a finished client document', () => {
    expect(tpl).toMatch(/mode === 'final' && boundReportId/);
  });

  it('the check is scoped to investment reports and leaves the other nine formats alone', () => {
    // Ordering, not a byte window: the lookup must sit inside the guard and
    // before the verdict is read. A distance assertion breaks the moment a
    // comment is added, which says nothing about whether the code is right.
    const guard = tpl.indexOf("mode === 'final' && boundReportId");
    const lookup = tpl.indexOf("from('investment_reports')", guard);
    const flags = tpl.indexOf('validation_flags', lookup);
    expect(guard).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(guard);
    expect(flags).toBeGreaterThan(lookup);
    expect(flags).toBeLessThan(callSite);
  });

  it('an unnamed report renders exactly as it did — the gate cannot break the other formats', () => {
    // No reportId in the payload means no lookup and no refusal: a Cash Flow or
    // Client Details render is untouched by this.
    expect(tpl).toMatch(/typeof payload\.reportId === 'string'/);
    expect(tpl).toMatch(/:\s*null;/);
  });
});

describe('RF-7.2B.1A — the fault is blocking, not advisory', () => {
  it('emits a critical, blocking validation flag', () => {
    const [fault] = auditGovernedNarrativeAuthority(MUSWELLBROOK_CENSUS, WITHHELD);
    const flag = governedFaultToFlag(fault);
    expect(flag.type).toBe('governed_authority');
    expect(flag.severity).toBe('critical');
    expect(flag.value.blocking).toBe(true);
    expect(flag.value.readiness).toBe('blocked');
  });

  it('does not block when there is nothing to block', () => {
    expect(governedAuthorityBlocks([])).toBe(false);
  });
});

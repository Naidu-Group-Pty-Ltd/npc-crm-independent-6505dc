/**
 * The seeded Template Library catalogue.
 *
 * Each entry is a complete, renderable `ReportTemplate`. Every value that a
 * report supplies is a `{{binding}}`; every colour is a `token:*` reference.
 * Nothing is hard-coded that a customer would want to change.
 *
 * `buildSeedCatalogue.ts` validates all of it against the live Zod schema and
 * the production renderer allow-list before writing a migration, so a template
 * that would not render cannot reach the catalogue.
 */
import {
  barChart, beginTemplate, callout, checklist, contents, cover, currentAccent,
  currentVoice, decision, definitions, disclaimerPage, donutChart, featureList,
  flow, heading, kpis, lineChart, page, processSteps, prose, riskRegister, rule,
  scorecard, signature, strengthsWatch, table, timeline, twoColumn,
  withFurniture,
  type PageDef,
  brandMark,} from './blocks';
import { STANDARD_DISCLAIMER, voiceTokens } from './designSystem';
import { CASH_FLOW_TEMPLATES } from './templatesCashFlow';
import { EXTENDED_TEMPLATES } from './templatesExtended';

export interface SeedTemplate {
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: string;
  reportType: string | null;
  tier?: string | null;
  industry: string[];
  tags: string[];
  style: string;
  accessTier: string;
  schema: {
    version: 1;
    name: string;
    /**
     * Compiled by `voiceTokens()`. Wider than the original three categories:
     * it also carries `radii`, `typeScale` and the `fontFaces` that make the
     * voice's display face actually load in WeasyPrint.
     */
    tokens: ReturnType<typeof voiceTokens>;
    pages: PageDef[];
  };
}

/**
 * Compile the active voice into a template schema.
 *
 * The palette used to be passed in here, one of six ad-hoc colourways with no
 * relationship to the product's own brand. It now comes from the voice the
 * template declared through `beginTemplate()`, which also fixes the type,
 * paper and rhythm — see `designSystem.ts` for why the two are bound together.
 */
function schema(name: string, pages: PageDef[]) {
  return {
    version: 1 as const,
    name,
    tokens: voiceTokens(currentVoice(), currentAccent()),
    pages,
  };
}

const FOOTER = '{{property.address}} · {{client.name}}';
const SUBURB_FOOTER = '{{property.suburb}} market analysis · {{client.name}}';

// ═════════════════════════════════════════════════════════════════════════════
// 1. Investor Compass — the flagship investment report
// ═════════════════════════════════════════════════════════════════════════════

function investorCompass(): SeedTemplate {
  beginTemplate('corporate', 'gold', 'investment');
  const pages = [
    cover({
      eyebrow: 'Investment Analysis',
      title: '{{property.address}}',
      subtitle: 'Prepared for {{client.name}}',
      footnote: '{{reportType | upper}}',
    }),
    withFurniture(page('Contents', flow([
      contents('Contents'),
    ])), FOOTER),
    withFurniture(page('Executive summary', flow([
      heading('Executive summary', 'The position in one page: what the property is, what it costs, what it returns, and what we recommend.'),
      kpis([
        { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}' },
        { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}' },
        { label: 'Gross yield', value: '{{financials.grossYield | percent}}' },
        { label: 'Cash on cash', value: '{{financials.cashOnCash | percent}}' },
      ]),
      rule(),
      prose('{{summary.narrative}}', 72),
      strengthsWatch(
        ['{{summary.strength.0}}', '{{summary.strength.1}}', '{{summary.strength.2}}'],
        ['{{summary.watch.0}}', '{{summary.watch.1}}'],
      ),
      // The recommendation belongs on the summary page as well as its own: a
      // reader who gets no further than page one should still know the answer.
      callout('Recommendation', '{{recommendation.headline}}', 'info', 72),
      definitions('Basis of assessment', [
        { term: 'Capital growth assumed', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
        { term: 'Rental growth assumed', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
        { term: 'Interest rate assumed', definition: '{{assumptions.interestRate | percent}}' },
      ]),
    ])), FOOTER),
    withFurniture(page('The property', flow([
      heading('The property', 'Physical attributes, tenure and current use.'),
      // The three paths with no source anywhere are gone, for the reason
      // `reportBindingProjection.pure.ts` states in its header and the
      // Investment Compass masters already act on: `property.suburb`,
      // `property.tenancy` and `property.rationale` have no column and no
      // producer, so each printed a term with nothing beside it — and the
      // callout printed a titled panel with an empty body — on every report.
      //
      // Land area, year built and zoning stay: they are real columns, and
      // `landArea` now resolves on 114 rows through the finance-run fallback.
      // A definition list is not a table, so it cannot take the per-row
      // conditional the Compass property table uses; the Compass's own page is
      // where a reader gets the guarded version.
      definitions('Property detail', [
        { term: 'Address', definition: '{{property.address}}' },
        { term: 'Property type', definition: '{{property.type}}' },
        { term: 'Land area', definition: '{{property.landArea}}' },
        { term: 'Bedrooms / bathrooms / parking', definition: '{{property.configuration}}' },
        { term: 'Year built', definition: '{{property.yearBuilt}}' },
        { term: 'Zoning', definition: '{{property.zoning}}' },
      ]),
    ])), FOOTER),
    withFurniture(page('Financial analysis', flow([
      heading('Financial analysis', 'Acquisition costs, funding structure and the first-year position.'),
      table(
        ['Item', 'Amount', 'Basis'],
        [
          ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'],
          ['Deposit', '{{financials.deposit | currency}}', 'Cash at exchange'],
          ['Stamp duty', '{{financials.stampDuty | currency}}', 'State schedule'],
          ['Legal and conveyancing', '{{financials.legalFees | currency}}', 'Estimate'],
          ['Building and pest', '{{financials.inspectionFees | currency}}', 'Estimate'],
          // `financials.loanFees` was here and has no column and no producer,
          // so the row printed a label, a blank and "Lender schedule" on every
          // report. (LMI is not a loan fee.)
          // Not "Sum of the above", for the reason the Investment Compass
          // master records at length: the figure is `initialCosts.totalUpfront`,
          // it is printed under a purchase price that is not a cash cost, and it
          // equals deposit + duty + legal + inspection + LMI on 29 of the 167
          // stored runs that carry the block (largest gap $93,000). The voice
          // templates carry their own copy of this table, so they carried their
          // own copy of the claim.
          ['Total upfront cash', '{{financials.totalCost | currency}}', 'Cash required at settlement'],
        ],
        [0.46, 0.27, 0.27],
      ),
      table(
        ['Cash flow', 'Weekly', 'Annual'],
        [
          ['Rental income', '{{financials.weeklyRent | currency}}', '{{financials.annualRent | currency}}'],
          ['Loan repayments', '{{financials.weeklyRepayment | currency}}', '{{financials.annualRepayment | currency}}'],
          ['Council and water rates', '{{financials.weeklyRates | currency}}', '{{financials.annualRates | currency}}'],
          ['Insurance', '{{financials.weeklyInsurance | currency}}', '{{financials.annualInsurance | currency}}'],
          ['Management and maintenance', '{{financials.weeklyManagement | currency}}', '{{financials.annualManagement | currency}}'],
          ['Net position', '{{financials.weeklyNet | currency}}', '{{financials.annualNet | currency}}'],
        ],
        [0.46, 0.27, 0.27],
      ),
    ])), FOOTER),
    withFurniture(page('Projection', flow([
      heading('Ten-year projection', 'Modelled on the growth and cost assumptions stated below.'),
      lineChart({
        title: 'Projected equity position',
        dataPath: 'projection.equitySeries',
        caption: 'Property value less loan balance, by year',
        data: [
          { label: 'Yr 1', value: 0 }, { label: 'Yr 2', value: 0 }, { label: 'Yr 3', value: 0 },
          { label: 'Yr 4', value: 0 }, { label: 'Yr 5', value: 0 }, { label: 'Yr 6', value: 0 },
          { label: 'Yr 7', value: 0 }, { label: 'Yr 8', value: 0 }, { label: 'Yr 9', value: 0 },
          { label: 'Yr 10', value: 0 },
        ],
      }),
      definitions('Assumptions', [
        { term: 'Capital growth', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
        { term: 'Rental growth', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy}}' },
      ]),
    ])), FOOTER),
    withFurniture(page('Market context', flow([
      heading('Market context', 'How {{property.suburb}} has performed and what is driving it.'),
      barChart({
        title: 'Median price, last five years',
        dataPath: 'market.priceSeries',
        caption: 'Source: {{market.source}}',
        data: [
          { label: 'Y-4', value: 0 }, { label: 'Y-3', value: 0 }, { label: 'Y-2', value: 0 },
          { label: 'Y-1', value: 0 }, { label: 'Now', value: 0 },
        ],
        height: 176,
      }),
      table(
        ['Indicator', 'Suburb', 'Region'],
        [
          ['Median price', '{{market.medianPrice | currency}}', '{{market.regionMedianPrice | currency}}'],
          ['12-month growth', '{{market.growth12m | percent}}', '{{market.regionGrowth12m | percent}}'],
          ['Median rent', '{{market.medianRent | currency}}', '{{market.regionMedianRent | currency}}'],
          ['Vacancy rate', '{{market.vacancy | percent}}', '{{market.regionVacancy | percent}}'],
          ['Days on market', '{{market.daysOnMarket}}', '{{market.regionDaysOnMarket}}'],
        ],
        [0.44, 0.28, 0.28],
      ),
    ])), FOOTER),
    withFurniture(page('Assessment', flow([
      heading('Assessment', 'Scored against the criteria in the client brief.'),
      // `rating` is a controlled vocabulary that selects the chip colour
      // (RATING_PALETTE in blocks/_chips.html.ts) and is deliberately NOT
      // resolved as a binding by the renderer. Ships a neutral default the
      // author sets per report in the Builder.
      scorecard('Investment scorecard', [
        { category: 'Location', rating: 'Moderate', note: '{{scorecard.locationNote}}' },
        { category: 'Yield', rating: 'Moderate', note: '{{scorecard.yieldNote}}' },
        { category: 'Growth outlook', rating: 'Moderate', note: '{{scorecard.growthNote}}' },
        { category: 'Condition', rating: 'Moderate', note: '{{scorecard.conditionNote}}' },
        { category: 'Tenant appeal', rating: 'Moderate', note: '{{scorecard.tenantAppealNote}}' },
      ]),
      // Same contract as the scorecard: `rating` and `confidence` are
      // vocabularies, `risk` / `why` / `ddAction` are bindable.
      riskRegister('Risks', [
        {
          risk: '{{risks.0.risk}}', rating: 'Medium', confidence: 'Indicative',
          why: '{{risks.0.why}}', ddAction: '{{risks.0.action}}',
        },
        {
          risk: '{{risks.1.risk}}', rating: 'Medium', confidence: 'Indicative',
          why: '{{risks.1.why}}', ddAction: '{{risks.1.action}}',
        },
        {
          risk: '{{risks.2.risk}}', rating: 'Medium', confidence: 'Indicative',
          why: '{{risks.2.why}}', ddAction: '{{risks.2.action}}',
        },
      ]),
    ])), FOOTER),
    withFurniture(page('Recommendation', flow([
      heading('Recommendation'),
      decision('{{recommendation.headline}}', '{{recommendation.rationale}}', 104),
      checklist('Next steps', [
        { action: '{{nextSteps.0.action}}', owner: '{{nextSteps.0.owner}}', timing: '{{nextSteps.0.timing}}' },
        { action: '{{nextSteps.1.action}}', owner: '{{nextSteps.1.owner}}', timing: '{{nextSteps.1.timing}}' },
        { action: '{{nextSteps.2.action}}', owner: '{{nextSteps.2.owner}}', timing: '{{nextSteps.2.timing}}' },
        { action: '{{nextSteps.3.action}}', owner: '{{nextSteps.3.owner}}', timing: '{{nextSteps.3.timing}}' },
      ]),
      signature('{{author.name}}', '{{author.title}}'),
    ])), FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'investor-compass',
    name: 'Investor Compass',
    description: 'The full investment analysis: property, financials, projection, market and recommendation.',
    longDescription:
      'A nine-page investment report built for a client who wants the whole picture. Opens with a '
      + 'one-page executive summary carrying four headline metrics, then works through the property, '
      + 'the acquisition and cash-flow numbers, a ten-year projection, suburb market context, a scored '
      + 'assessment with a risk register, and a signed recommendation. Every figure is bound to live '
      + 'report data.',
    category: 'investment',
    reportType: 'investment',
    tier: 'compass',
    industry: ['property', 'finance'],
    tags: ['comprehensive', 'flagship', 'client-facing', 'scorecard', 'projection'],
    style: 'corporate',
    accessTier: 'standard',
    schema: schema('Investor Compass', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Executive Brief
// ═════════════════════════════════════════════════════════════════════════════

function executiveBrief(): SeedTemplate {
  beginTemplate('minimal', 'gold', 'investment');
  const pages = [
    cover({
      eyebrow: 'Executive Brief',
      title: '{{property.address}}',
      subtitle: 'Prepared for {{client.name}}',
      titleSize: 34,
    }),
    withFurniture(page('The position', flow([
      heading('The position', 'Everything material, on one page.'),
      kpis([
        { label: 'Price', value: '{{financials.purchasePrice | currency}}' },
        { label: 'Rent p.w.', value: '{{financials.weeklyRent | currency}}' },
        { label: 'Gross yield', value: '{{financials.grossYield | percent}}' },
        { label: 'Net weekly', value: '{{financials.weeklyNet | currency}}' },
      ]),
      rule(),
      prose('{{summary.narrative}}', 92),
      twoColumn(
        { heading: 'For', body: '{{summary.for}}' },
        { heading: 'Against', body: '{{summary.against}}' },
        120,
      ),
    ])), FOOTER),
    withFurniture(page('Numbers', flow([
      heading('The numbers'),
      table(
        ['Item', 'Weekly', 'Annual'],
        [
          ['Rental income', '{{financials.weeklyRent | currency}}', '{{financials.annualRent | currency}}'],
          ['Loan repayments', '{{financials.weeklyRepayment | currency}}', '{{financials.annualRepayment | currency}}'],
          ['Holding costs', '{{financials.weeklyHolding | currency}}', '{{financials.annualHolding | currency}}'],
          ['Net position', '{{financials.weeklyNet | currency}}', '{{financials.annualNet | currency}}'],
        ],
        [0.46, 0.27, 0.27],
      ),
      callout('Funding', '{{financials.fundingNote}}'),
      decision('{{recommendation.headline}}', '{{recommendation.rationale}}', 96),
    ])), FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'executive-brief',
    name: 'Executive Brief',
    description: 'Two pages of substance for a client who has already decided how they think.',
    longDescription:
      'A condensed investment report for repeat clients and time-poor decision-makers. One page of '
      + 'position — four metrics, a narrative, and an explicit for/against — then one page of numbers '
      + 'and a recommendation. Deliberately monochrome so the figures carry the page.',
    category: 'investment',
    reportType: 'investment',
    tier: 'executive',
    industry: ['property', 'finance'],
    tags: ['concise', 'decision', 'client-facing'],
    style: 'minimal',
    accessTier: 'standard',
    schema: schema('Executive Brief', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. Property Snapshot
// ═════════════════════════════════════════════════════════════════════════════

function propertySnapshot(): SeedTemplate {
  beginTemplate('minimal', 'gold', 'investment');
  const pages = [
    withFurniture(page('Snapshot', flow([
      brandMark(),
      heading('{{property.address}}', '{{property.suburb}} · prepared for {{client.name}}', 62),
      rule(),
      kpis([
        { label: 'Price', value: '{{financials.purchasePrice | currency}}' },
        { label: 'Rent p.w.', value: '{{financials.weeklyRent | currency}}' },
        { label: 'Gross yield', value: '{{financials.grossYield | percent}}' },
        { label: 'Net weekly', value: '{{financials.weeklyNet | currency}}' },
      ]),
      definitions('At a glance', [
        { term: 'Property type', definition: '{{property.type}}' },
        { term: 'Configuration', definition: '{{property.configuration}}' },
        { term: 'Land area', definition: '{{property.landArea}}' },
        { term: 'Suburb median', definition: '{{market.medianPrice | currency}}' },
        { term: '12-month growth', definition: '{{market.growth12m | percent}}' },
        { term: 'Vacancy rate', definition: '{{market.vacancy | percent}}' },
      ]),
      callout('Assessment', '{{summary.narrative}}', 'info', 80),
    ])), FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'property-snapshot',
    name: 'Property Snapshot',
    description: 'A single page with the four numbers that matter and a short assessment.',
    longDescription:
      'The fastest thing in the library. One page, no cover: headline metrics, an at-a-glance detail '
      + 'list and a short written assessment. Built for shortlisting, open-home follow-ups and quick '
      + 'client questions where a full report would be overkill.',
    category: 'investment',
    reportType: 'investment',
    tier: 'snapshot',
    industry: ['property'],
    tags: ['quick', 'one-page', 'shortlist'],
    style: 'minimal',
    accessTier: 'standard',
    schema: schema('Property Snapshot', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. Due Diligence Dossier
// ═════════════════════════════════════════════════════════════════════════════

function dueDiligenceDossier(): SeedTemplate {
  beginTemplate('technical', 'gold', 'investment');
  const pages = [
    cover({
      eyebrow: 'Due Diligence',
      title: '{{property.address}}',
      subtitle: 'Investigation report for {{client.name}}',
      footnote: 'Confidential',
    }),
    withFurniture(page('Scope', flow([
      heading('Scope and method', 'What was investigated, by whom, and against what standard.'),
      definitions('Engagement', [
        { term: 'Property', definition: '{{property.address}}' },
        { term: 'Instructed by', definition: '{{client.name}}' },
        { term: 'Investigation period', definition: '{{dd.period}}' },
        { term: 'Prepared by', definition: '{{author.name}}' },
      ]),
      processSteps('Method', [
        { title: 'Document review', body: '{{dd.method.documents}}' },
        { title: 'Physical inspection', body: '{{dd.method.inspection}}' },
        { title: 'Searches and enquiries', body: '{{dd.method.searches}}' },
        { title: 'Third-party reports', body: '{{dd.method.reports}}' },
      ]),
    ])), FOOTER),
    withFurniture(page('Findings', flow([
      heading('Findings', 'Every matter identified, with its status.'),
      table(
        ['Ref', 'Matter', 'Finding', 'Status'],
        [
          ['1', '{{dd.findings.0.matter}}', '{{dd.findings.0.finding}}', '{{dd.findings.0.status}}'],
          ['2', '{{dd.findings.1.matter}}', '{{dd.findings.1.finding}}', '{{dd.findings.1.status}}'],
          ['3', '{{dd.findings.2.matter}}', '{{dd.findings.2.finding}}', '{{dd.findings.2.status}}'],
          ['4', '{{dd.findings.3.matter}}', '{{dd.findings.3.finding}}', '{{dd.findings.3.status}}'],
          ['5', '{{dd.findings.4.matter}}', '{{dd.findings.4.finding}}', '{{dd.findings.4.status}}'],
          ['6', '{{dd.findings.5.matter}}', '{{dd.findings.5.finding}}', '{{dd.findings.5.status}}'],
        ],
        [0.08, 0.28, 0.44, 0.20],
      ),
      riskRegister('Matters requiring action', [
        {
          risk: '{{dd.risks.0.risk}}', rating: 'Medium', confidence: 'Indicative',
          why: '{{dd.risks.0.why}}', ddAction: '{{dd.risks.0.action}}',
        },
        {
          risk: '{{dd.risks.1.risk}}', rating: 'Medium', confidence: 'Indicative',
          why: '{{dd.risks.1.why}}', ddAction: '{{dd.risks.1.action}}',
        },
      ]),
    ])), FOOTER),
    withFurniture(page('Checklist', flow([
      heading('Outstanding items', 'Nothing here is closed until it is signed off.'),
      checklist('Before exchange', [
        { action: '{{dd.checklist.0.action}}', owner: '{{dd.checklist.0.owner}}', timing: '{{dd.checklist.0.timing}}' },
        { action: '{{dd.checklist.1.action}}', owner: '{{dd.checklist.1.owner}}', timing: '{{dd.checklist.1.timing}}' },
        { action: '{{dd.checklist.2.action}}', owner: '{{dd.checklist.2.owner}}', timing: '{{dd.checklist.2.timing}}' },
        { action: '{{dd.checklist.3.action}}', owner: '{{dd.checklist.3.owner}}', timing: '{{dd.checklist.3.timing}}' },
        { action: '{{dd.checklist.4.action}}', owner: '{{dd.checklist.4.owner}}', timing: '{{dd.checklist.4.timing}}' },
      ]),
      decision('{{dd.conclusion.headline}}', '{{dd.conclusion.body}}', 96),
      signature('{{author.name}}', '{{author.title}}'),
    ])), FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'due-diligence-dossier',
    name: 'Due Diligence Dossier',
    description: 'Scope, method, findings, risks and a pre-exchange checklist.',
    longDescription:
      'A five-page investigation record for the period between offer and exchange. States what was '
      + 'investigated and how, tabulates every finding with a status, escalates the ones that need '
      + 'action into a risk register, and closes with an owner-and-date checklist plus a signed '
      + 'conclusion. Designed to be defensible after the fact.',
    category: 'investment',
    reportType: 'investment',
    tier: 'compass',
    industry: ['property', 'legal'],
    tags: ['due-diligence', 'risk', 'checklist', 'pre-exchange'],
    style: 'technical',
    accessTier: 'premium',
    schema: schema('Due Diligence Dossier', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Suburb Market Compass
// ═════════════════════════════════════════════════════════════════════════════

function suburbCompass(): SeedTemplate {
  beginTemplate('editorial', 'amethyst', 'suburb');
  const pages = [
    cover({
      eyebrow: 'Suburb Analysis',
      title: '{{property.suburb}}',
      subtitle: 'Market analysis for {{client.name}}',
    }),
    withFurniture(page('Market at a glance', flow([
      heading('{{property.suburb}} at a glance'),
      kpis([
        { label: 'Median price', value: '{{market.medianPrice | currency}}' },
        { label: '12-month growth', value: '{{market.growth12m | percent}}' },
        { label: 'Median rent', value: '{{market.medianRent | currency}}' },
        { label: 'Vacancy', value: '{{market.vacancy | percent}}' },
      ]),
      barChart({
        title: 'Median price, last five years',
        dataPath: 'market.priceSeries',
        caption: 'Source: {{market.source}}',
        data: [
          { label: 'Y-4', value: 0 }, { label: 'Y-3', value: 0 }, { label: 'Y-2', value: 0 },
          { label: 'Y-1', value: 0 }, { label: 'Now', value: 0 },
        ],
        height: 180,
      }),
      prose('{{market.narrative}}', 80),
    ])), SUBURB_FOOTER),
    withFurniture(page('Demand and supply', flow([
      heading('Demand and supply'),
      table(
        ['Indicator', 'Suburb', 'Region', 'State'],
        [
          ['Median price', '{{market.medianPrice | currency}}', '{{market.regionMedianPrice | currency}}', '{{market.stateMedianPrice | currency}}'],
          ['12-month growth', '{{market.growth12m | percent}}', '{{market.regionGrowth12m | percent}}', '{{market.stateGrowth12m | percent}}'],
          ['Median rent', '{{market.medianRent | currency}}', '{{market.regionMedianRent | currency}}', '{{market.stateMedianRent | currency}}'],
          ['Gross yield', '{{market.grossYield | percent}}', '{{market.regionGrossYield | percent}}', '{{market.stateGrossYield | percent}}'],
          ['Vacancy rate', '{{market.vacancy | percent}}', '{{market.regionVacancy | percent}}', '{{market.stateVacancy | percent}}'],
          ['Days on market', '{{market.daysOnMarket}}', '{{market.regionDaysOnMarket}}', '{{market.stateDaysOnMarket}}'],
        ],
        [0.34, 0.22, 0.22, 0.22],
      ),
      donutChart({
        title: 'Dwelling mix',
        dataPath: 'market.dwellingMix',
        caption: 'Source: {{market.censusSource}}',
        data: [
          { label: 'Houses', value: 0 }, { label: 'Units', value: 0 }, { label: 'Townhouses', value: 0 },
        ],
        height: 186,
      }),
    ])), SUBURB_FOOTER),
    withFurniture(page('Outlook', flow([
      heading('Outlook', 'What is likely to drive the next twelve to thirty-six months.'),
      featureList('Drivers', [
        { icon: '▲', title: '{{market.drivers.0.title}}', body: '{{market.drivers.0.body}}' },
        { icon: '▲', title: '{{market.drivers.1.title}}', body: '{{market.drivers.1.body}}' },
        { icon: '▼', title: '{{market.drivers.2.title}}', body: '{{market.drivers.2.body}}' },
        { icon: '▼', title: '{{market.drivers.3.title}}', body: '{{market.drivers.3.body}}' },
      ]),
      strengthsWatch(
        ['{{market.strength.0}}', '{{market.strength.1}}', '{{market.strength.2}}'],
        ['{{market.watch.0}}', '{{market.watch.1}}'],
      ),
      decision('{{market.conclusion.headline}}', '{{market.conclusion.body}}'),
    ])), SUBURB_FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'suburb-market-compass',
    name: 'Suburb Market Compass',
    description: 'Suburb performance against region and state, with drivers and an outlook.',
    longDescription:
      'A five-page suburb study. Headline metrics and a five-year price series, then a comparison '
      + 'table that puts the suburb against its region and its state on the same six indicators, a '
      + 'dwelling-mix breakdown, and an outlook section that names the drivers rather than gesturing '
      + 'at them.',
    category: 'suburb',
    reportType: 'suburb',
    tier: 'compass',
    industry: ['property'],
    tags: ['market', 'comparison', 'outlook', 'research'],
    style: 'editorial',
    accessTier: 'standard',
    schema: schema('Suburb Market Compass', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. Suburb Snapshot
// ═════════════════════════════════════════════════════════════════════════════

function suburbSnapshot(): SeedTemplate {
  beginTemplate('minimal', 'amethyst', 'suburb');
  const pages = [
    withFurniture(page('Snapshot', flow([
      brandMark(),
      heading('{{property.suburb}}', 'Market snapshot prepared for {{client.name}}', 60),
      rule(),
      kpis([
        { label: 'Median price', value: '{{market.medianPrice | currency}}' },
        { label: 'Growth 12m', value: '{{market.growth12m | percent}}' },
        { label: 'Median rent', value: '{{market.medianRent | currency}}' },
        { label: 'Vacancy', value: '{{market.vacancy | percent}}' },
      ]),
      barChart({
        title: 'Median price, last five years',
        dataPath: 'market.priceSeries',
        data: [
          { label: 'Y-4', value: 0 }, { label: 'Y-3', value: 0 }, { label: 'Y-2', value: 0 },
          { label: 'Y-1', value: 0 }, { label: 'Now', value: 0 },
        ],
        height: 172,
      }),
      callout('Read', '{{market.narrative}}', 'info', 86),
    ])), SUBURB_FOOTER),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'suburb-snapshot',
    name: 'Suburb Snapshot',
    description: 'One page: four suburb metrics, a five-year price chart and a short read.',
    longDescription:
      'The suburb equivalent of the Property Snapshot. Four metrics, one chart, one paragraph — '
      + 'enough to answer "is this suburb worth a closer look" without committing anyone to a '
      + 'full market study.',
    category: 'suburb',
    reportType: 'suburb',
    tier: 'snapshot',
    industry: ['property'],
    tags: ['quick', 'one-page', 'market'],
    style: 'minimal',
    accessTier: 'standard',
    schema: schema('Suburb Snapshot', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. Postcode Market Analysis
// ═════════════════════════════════════════════════════════════════════════════

function postcodeAnalysis(): SeedTemplate {
  beginTemplate('technical', 'amethyst', 'postcode');
  const pages = [
    cover({
      eyebrow: 'Postcode Analysis',
      title: '{{market.postcode}}',
      subtitle: 'Zone market analysis for {{client.name}}',
    }),
    withFurniture(page('Zone overview', flow([
      heading('Zone overview', 'Every suburb in the postcode, on one basis.'),
      kpis([
        { label: 'Suburbs', value: '{{market.suburbCount}}' },
        { label: 'Median price', value: '{{market.medianPrice | currency}}' },
        { label: 'Growth 12m', value: '{{market.growth12m | percent}}' },
        { label: 'Gross yield', value: '{{market.grossYield | percent}}' },
      ]),
      table(
        ['Suburb', 'Median', 'Growth 12m', 'Rent', 'Yield'],
        [
          ['{{market.suburbs.0.name}}', '{{market.suburbs.0.median | currency}}', '{{market.suburbs.0.growth | percent}}', '{{market.suburbs.0.rent | currency}}', '{{market.suburbs.0.yield | percent}}'],
          ['{{market.suburbs.1.name}}', '{{market.suburbs.1.median | currency}}', '{{market.suburbs.1.growth | percent}}', '{{market.suburbs.1.rent | currency}}', '{{market.suburbs.1.yield | percent}}'],
          ['{{market.suburbs.2.name}}', '{{market.suburbs.2.median | currency}}', '{{market.suburbs.2.growth | percent}}', '{{market.suburbs.2.rent | currency}}', '{{market.suburbs.2.yield | percent}}'],
          ['{{market.suburbs.3.name}}', '{{market.suburbs.3.median | currency}}', '{{market.suburbs.3.growth | percent}}', '{{market.suburbs.3.rent | currency}}', '{{market.suburbs.3.yield | percent}}'],
          ['{{market.suburbs.4.name}}', '{{market.suburbs.4.median | currency}}', '{{market.suburbs.4.growth | percent}}', '{{market.suburbs.4.rent | currency}}', '{{market.suburbs.4.yield | percent}}'],
        ],
        [0.32, 0.19, 0.19, 0.15, 0.15],
      ),
    ])), '{{market.postcode}} · {{client.name}}'),
    withFurniture(page('Comparison', flow([
      heading('Where the value sits'),
      barChart({
        title: 'Median price by suburb',
        dataPath: 'market.suburbPriceSeries',
        caption: 'Source: {{market.source}}',
        data: [
          { label: 'S1', value: 0 }, { label: 'S2', value: 0 }, { label: 'S3', value: 0 },
          { label: 'S4', value: 0 }, { label: 'S5', value: 0 },
        ],
        height: 184,
      }),
      barChart({
        title: 'Gross yield by suburb',
        dataPath: 'market.suburbYieldSeries',
        data: [
          { label: 'S1', value: 0 }, { label: 'S2', value: 0 }, { label: 'S3', value: 0 },
          { label: 'S4', value: 0 }, { label: 'S5', value: 0 },
        ],
        height: 184,
      }),
    ])), '{{market.postcode}} · {{client.name}}'),
    withFurniture(page('Conclusion', flow([
      heading('Conclusion'),
      strengthsWatch(
        ['{{market.strength.0}}', '{{market.strength.1}}', '{{market.strength.2}}'],
        ['{{market.watch.0}}', '{{market.watch.1}}'],
      ),
      decision('{{market.conclusion.headline}}', '{{market.conclusion.body}}', 96),
    ])), '{{market.postcode}} · {{client.name}}'),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'postcode-market-analysis',
    name: 'Postcode Market Analysis',
    description: 'Every suburb in a postcode compared on the same five indicators.',
    longDescription:
      'A five-page zone study for buyers who have narrowed to a postcode but not a street. Puts each '
      + 'suburb in the zone on the same five indicators, charts price against yield so the trade-off '
      + 'is visible, and closes with a strengths-and-watch summary.',
    category: 'postcode',
    reportType: 'postcode',
    industry: ['property'],
    tags: ['zone', 'comparison', 'research'],
    style: 'technical',
    accessTier: 'standard',
    schema: schema('Postcode Market Analysis', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. Statewide Market Review
// ═════════════════════════════════════════════════════════════════════════════

function statewideReview(): SeedTemplate {
  beginTemplate('editorial', 'amethyst', 'statewide');
  const pages = [
    cover({
      eyebrow: 'Statewide Review',
      title: '{{market.state}} Property Market',
      subtitle: 'Prepared for {{client.name}}',
    }),
    withFurniture(page('State of the market', flow([
      heading('State of the market'),
      kpis([
        { label: 'State median', value: '{{market.stateMedianPrice | currency}}' },
        { label: 'Growth 12m', value: '{{market.stateGrowth12m | percent}}' },
        { label: 'Median rent', value: '{{market.stateMedianRent | currency}}' },
        { label: 'Vacancy', value: '{{market.stateVacancy | percent}}' },
      ]),
      lineChart({
        title: 'State median price, ten years',
        dataPath: 'market.stateSeries',
        caption: 'Source: {{market.source}}',
        data: Array.from({ length: 10 }, (_, i) => ({ label: `Y-${9 - i}`, value: 0 })),
      }),
      prose('{{market.narrative}}', 74),
    ])), '{{market.state}} market review'),
    withFurniture(page('Regions', flow([
      heading('Regional performance'),
      table(
        ['Region', 'Median', 'Growth 12m', 'Rent', 'Vacancy'],
        [
          ['{{market.regions.0.name}}', '{{market.regions.0.median | currency}}', '{{market.regions.0.growth | percent}}', '{{market.regions.0.rent | currency}}', '{{market.regions.0.vacancy | percent}}'],
          ['{{market.regions.1.name}}', '{{market.regions.1.median | currency}}', '{{market.regions.1.growth | percent}}', '{{market.regions.1.rent | currency}}', '{{market.regions.1.vacancy | percent}}'],
          ['{{market.regions.2.name}}', '{{market.regions.2.median | currency}}', '{{market.regions.2.growth | percent}}', '{{market.regions.2.rent | currency}}', '{{market.regions.2.vacancy | percent}}'],
          ['{{market.regions.3.name}}', '{{market.regions.3.median | currency}}', '{{market.regions.3.growth | percent}}', '{{market.regions.3.rent | currency}}', '{{market.regions.3.vacancy | percent}}'],
          ['{{market.regions.4.name}}', '{{market.regions.4.median | currency}}', '{{market.regions.4.growth | percent}}', '{{market.regions.4.rent | currency}}', '{{market.regions.4.vacancy | percent}}'],
          ['{{market.regions.5.name}}', '{{market.regions.5.median | currency}}', '{{market.regions.5.growth | percent}}', '{{market.regions.5.rent | currency}}', '{{market.regions.5.vacancy | percent}}'],
        ],
        [0.32, 0.18, 0.18, 0.16, 0.16],
      ),
      barChart({
        title: 'Twelve-month growth by region',
        dataPath: 'market.regionGrowthSeries',
        data: [
          { label: 'R1', value: 0 }, { label: 'R2', value: 0 }, { label: 'R3', value: 0 },
          { label: 'R4', value: 0 }, { label: 'R5', value: 0 }, { label: 'R6', value: 0 },
        ],
        height: 176,
      }),
    ])), '{{market.state}} market review'),
    withFurniture(page('Outlook', flow([
      heading('Outlook and policy'),
      featureList('What is moving the market', [
        { icon: '◆', title: '{{market.drivers.0.title}}', body: '{{market.drivers.0.body}}' },
        { icon: '◆', title: '{{market.drivers.1.title}}', body: '{{market.drivers.1.body}}' },
        { icon: '◆', title: '{{market.drivers.2.title}}', body: '{{market.drivers.2.body}}' },
        { icon: '◆', title: '{{market.drivers.3.title}}', body: '{{market.drivers.3.body}}' },
      ]),
      timeline('Key dates ahead', [
        { label: '{{market.calendar.0.label}}', date: '{{market.calendar.0.date}}', note: '{{market.calendar.0.note}}' },
        { label: '{{market.calendar.1.label}}', date: '{{market.calendar.1.date}}', note: '{{market.calendar.1.note}}' },
        { label: '{{market.calendar.2.label}}', date: '{{market.calendar.2.date}}', note: '{{market.calendar.2.note}}' },
        { label: '{{market.calendar.3.label}}', date: '{{market.calendar.3.date}}', note: '{{market.calendar.3.note}}' },
      ]),
      decision('{{market.conclusion.headline}}', '{{market.conclusion.body}}'),
    ])), '{{market.state}} market review'),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'statewide-market-review',
    name: 'Statewide Market Review',
    description: 'State-level performance, regional breakdown, drivers and a forward calendar.',
    longDescription:
      'A five-page macro review for clients deciding which region to enter. A ten-year state price '
      + 'series, a six-region comparison table with a growth chart beneath it, then the drivers and a '
      + 'forward calendar of the dates that will move the market.',
    category: 'statewide',
    reportType: 'statewide',
    industry: ['property', 'finance'],
    tags: ['macro', 'regional', 'outlook'],
    style: 'editorial',
    accessTier: 'premium',
    schema: schema('Statewide Market Review', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. Property Comparison Matrix
// ═════════════════════════════════════════════════════════════════════════════

function comparisonMatrix(): SeedTemplate {
  beginTemplate('technical', 'info', 'comparison');
  const pages = [
    cover({
      eyebrow: 'Comparison',
      title: 'Property Comparison',
      subtitle: 'Prepared for {{client.name}}',
    }),
    withFurniture(page('Side by side', flow([
      heading('Side by side', 'The same twelve measures for every property under consideration.'),
      table(
        ['Measure', 'Property A', 'Property B', 'Property C'],
        [
          ['Address', '{{comparison.a.address}}', '{{comparison.b.address}}', '{{comparison.c.address}}'],
          ['Price', '{{comparison.a.price | currency}}', '{{comparison.b.price | currency}}', '{{comparison.c.price | currency}}'],
          ['Weekly rent', '{{comparison.a.rent | currency}}', '{{comparison.b.rent | currency}}', '{{comparison.c.rent | currency}}'],
          ['Gross yield', '{{comparison.a.yield | percent}}', '{{comparison.b.yield | percent}}', '{{comparison.c.yield | percent}}'],
          ['Net weekly', '{{comparison.a.net | currency}}', '{{comparison.b.net | currency}}', '{{comparison.c.net | currency}}'],
          ['Land area', '{{comparison.a.land}}', '{{comparison.b.land}}', '{{comparison.c.land}}'],
          ['Configuration', '{{comparison.a.config}}', '{{comparison.b.config}}', '{{comparison.c.config}}'],
          ['Year built', '{{comparison.a.built}}', '{{comparison.b.built}}', '{{comparison.c.built}}'],
          ['Suburb median', '{{comparison.a.median | currency}}', '{{comparison.b.median | currency}}', '{{comparison.c.median | currency}}'],
          ['Growth 12m', '{{comparison.a.growth | percent}}', '{{comparison.b.growth | percent}}', '{{comparison.c.growth | percent}}'],
          ['Vacancy', '{{comparison.a.vacancy | percent}}', '{{comparison.b.vacancy | percent}}', '{{comparison.c.vacancy | percent}}'],
          ['Condition', '{{comparison.a.condition}}', '{{comparison.b.condition}}', '{{comparison.c.condition}}'],
        ],
        [0.28, 0.24, 0.24, 0.24],
        20,
      ),
    ])), 'Property comparison · {{client.name}}'),
    withFurniture(page('Scored', flow([
      heading('Scored against the brief'),
      barChart({
        title: 'Gross yield',
        dataPath: 'comparison.yieldSeries',
        data: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }, { label: 'C', value: 0 }],
        height: 168,
      }),
      scorecard('Weighted assessment', [
        { category: 'Property A', rating: 'Moderate', note: '{{comparison.a.scoreNote}}' },
        { category: 'Property B', rating: 'Moderate', note: '{{comparison.b.scoreNote}}' },
        { category: 'Property C', rating: 'Moderate', note: '{{comparison.c.scoreNote}}' },
      ]),
      decision('{{comparison.recommendation.headline}}', '{{comparison.recommendation.body}}', 96),
    ])), 'Property comparison · {{client.name}}'),
    disclaimerPage(STANDARD_DISCLAIMER),
  ];

  return {
    slug: 'property-comparison-matrix',
    name: 'Property Comparison Matrix',
    description: 'Three properties, twelve measures, one recommendation.',
    longDescription:
      'A four-page comparison for a client choosing between shortlisted properties. A twelve-row '
      + 'matrix puts them on identical measures, a yield chart and a weighted scorecard turn that into '
      + 'a ranking, and the recommendation says which one and why.',
    category: 'comparison',
    reportType: 'comparison',
    industry: ['property'],
    tags: ['comparison', 'shortlist', 'decision'],
    style: 'technical',
    accessTier: 'standard',
    schema: schema('Property Comparison Matrix', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. Ten-Year Cash Flow Projection
// ═════════════════════════════════════════════════════════════════════════════

function cashFlowProjection(): SeedTemplate {
  beginTemplate('technical', 'evergreen', 'cash_flow');
  const pages = [
    cover({
      eyebrow: 'Cash Flow',
      title: 'Ten-Year Projection',
      subtitle: '{{property.address}} · {{client.name}}',
    }),
    withFurniture(page('Position', flow([
      heading('Opening position', 'The numbers the projection is built from.'),
      kpis([
        { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}' },
        { label: 'Loan amount', value: '{{financials.loanAmount | currency}}' },
        { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}' },
        { label: 'Net weekly', value: '{{financials.weeklyNet | currency}}' },
      ]),
      definitions('Assumptions', [
        { term: 'Capital growth', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
        { term: 'Rental growth', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
        { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
        { term: 'Expense inflation', definition: '{{assumptions.expenseInflation | percent}} per annum' },
        { term: 'Vacancy allowance', definition: '{{assumptions.vacancy}}' },
        { term: 'Marginal tax rate', definition: '{{assumptions.taxRate | percent}}' },
      ]),
    ])), 'Ten-year projection · {{property.address}}'),
    withFurniture(page('Projection', flow([
      heading('Year by year'),
      table(
        ['Year', 'Rent', 'Costs', 'Pre-tax', 'After tax', 'Value'],
        Array.from({ length: 10 }, (_, i) => ([
          `${i + 1}`,
          `{{cashflow.${i}.rent | currency}}`,
          `{{cashflow.${i}.costs | currency}}`,
          `{{cashflow.${i}.preTax | currency}}`,
          `{{cashflow.${i}.afterTax | currency}}`,
          `{{cashflow.${i}.value | currency}}`,
        ])),
        [0.11, 0.18, 0.18, 0.18, 0.18, 0.17],
        20,
      ),
    ])), 'Ten-year projection · {{property.address}}'),
    withFurniture(page('Equity', flow([
      heading('Equity and cash position'),
      lineChart({
        title: 'Projected equity',
        dataPath: 'cashflow.equitySeries',
        caption: 'Property value less loan balance',
        data: Array.from({ length: 10 }, (_, i) => ({ label: `Yr ${i + 1}`, value: 0 })),
      }),
      barChart({
        title: 'After-tax cash position by year',
        dataPath: 'cashflow.afterTaxSeries',
        data: Array.from({ length: 10 }, (_, i) => ({ label: `${i + 1}`, value: 0 })),
        height: 180,
      }),
    ])), 'Ten-year projection · {{property.address}}'),
    withFurniture(page('Read', flow([
      heading('What the projection says'),
      callout('Break-even', '{{cashflow.breakEvenNote}}', 'info', 72),
      prose('{{cashflow.narrative}}', 96),
      decision('{{cashflow.conclusion.headline}}', '{{cashflow.conclusion.body}}', 96),
    ])), 'Ten-year projection · {{property.address}}'),
    disclaimerPage(
      STANDARD_DISCLAIMER
      + ' Projections are modelled outcomes on stated assumptions, not forecasts. Small changes to '
      + 'the growth, interest or vacancy assumptions produce materially different results.',
    ),
  ];

  return {
    slug: 'ten-year-cash-flow-projection',
    name: 'Ten-Year Cash Flow Projection',
    description: 'Assumptions, a year-by-year table, equity and cash charts, and the read.',
    longDescription:
      'A six-page projection that states its assumptions before it states its results — the whole '
      + 'point of a ten-year model being to make the assumptions arguable. A full year-by-year table '
      + 'with pre- and after-tax positions, equity and cash charts, and a closing read that says '
      + 'where the break-even sits.',
    category: 'cash_flow',
    reportType: 'cashflow',
    industry: ['property', 'finance'],
    tags: ['projection', 'cash-flow', 'assumptions', 'tax'],
    style: 'technical',
    accessTier: 'standard',
    schema: schema('Ten-Year Cash Flow Projection', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 11. Client Fact Find
// ═════════════════════════════════════════════════════════════════════════════

function clientFactFind(): SeedTemplate {
  beginTemplate('minimal', 'orchid', 'client_form');
  const pages = [
    cover({
      eyebrow: 'Client Intake',
      title: 'Client Fact Find',
      subtitle: 'Prepared for {{client.name}}',
      titleSize: 36,
    }),
    withFurniture(page('About you', flow([
      heading('About you', 'Confirm the details we hold, and correct anything that has changed.'),
      definitions('Personal', [
        { term: 'Full name', definition: '{{client.name}}' },
        { term: 'Email', definition: '{{client.email}}' },
        { term: 'Phone', definition: '{{client.phone}}' },
        { term: 'Address', definition: '{{client.address}}' },
        { term: 'Date of birth', definition: '{{client.dateOfBirth}}' },
        { term: 'Employment', definition: '{{client.employment}}' },
      ]),
      definitions('Financial position', [
        { term: 'Gross annual income', definition: '{{client.income | currency}}' },
        { term: 'Existing property', definition: '{{client.existingProperty}}' },
        { term: 'Available deposit', definition: '{{client.deposit | currency}}' },
        { term: 'Existing debts', definition: '{{client.debts | currency}}' },
        { term: 'Pre-approval', definition: '{{client.preApproval}}' },
      ]),
    ])), 'Client fact find · {{client.name}}'),
    withFurniture(page('Your objectives', flow([
      heading('Your objectives', 'What you are trying to achieve, in your words.'),
      definitions('Brief', [
        { term: 'Primary objective', definition: '{{brief.objective}}' },
        { term: 'Investment horizon', definition: '{{brief.horizon}}' },
        { term: 'Target return', definition: '{{brief.targetReturn}}' },
        { term: 'Maximum price', definition: '{{brief.maxPrice | currency}}' },
        { term: 'Preferred locations', definition: '{{brief.locations}}' },
        { term: 'Property type', definition: '{{brief.propertyType}}' },
        { term: 'Deal breakers', definition: '{{brief.dealBreakers}}' },
      ]),
      callout('Risk tolerance', '{{brief.riskTolerance}}', 'info', 72),
      signature('{{client.name}}', 'Client'),
    ])), 'Client fact find · {{client.name}}'),
    disclaimerPage(
      'The information collected in this form is used to provide the services you have engaged us '
      + 'for, and is handled in accordance with our privacy policy and applicable privacy law. '
      + 'Please review every entry before signing: we act on what is recorded here.',
    ),
  ];

  return {
    slug: 'client-fact-find',
    name: 'Client Fact Find',
    description: 'Personal details, financial position and the brief — signed by the client.',
    longDescription:
      'A four-page intake document for a new engagement. Confirms the details on file rather than '
      + 'asking for them cold, records the financial position, then captures the brief in the '
      + 'client\'s own terms including deal breakers and risk tolerance. Ends with a client '
      + 'signature block.',
    category: 'client_form',
    reportType: 'formara',
    industry: ['property', 'finance'],
    tags: ['intake', 'onboarding', 'client-facing', 'signature'],
    style: 'minimal',
    accessTier: 'standard',
    schema: schema('Client Fact Find', pages),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 12. Compliance File Review
// ═════════════════════════════════════════════════════════════════════════════

function complianceFileReview(): SeedTemplate {
  beginTemplate('corporate', 'bronze', 'compliance');
  const pages = [
    cover({
      eyebrow: 'Quality Assurance',
      title: 'Compliance File Review',
      subtitle: 'File {{review.reference}}',
      footnote: 'Internal',
    }),
    withFurniture(page('Outcome', flow([
      heading('Outcome', 'The result, and what has to happen next.'),
      kpis([
        { label: 'Result', value: '{{review.result}}' },
        { label: 'Items checked', value: '{{review.checkedCount}}' },
        { label: 'Items failed', value: '{{review.failedCount}}' },
        { label: 'Remediation due', value: '{{review.dueDate}}' },
      ]),
      definitions('Review detail', [
        { term: 'File reference', definition: '{{review.reference}}' },
        { term: 'Client', definition: '{{client.name}}' },
        { term: 'Adviser', definition: '{{review.adviser}}' },
        { term: 'Reviewer', definition: '{{review.reviewer}}' },
        { term: 'Review date', definition: '{{review.date}}' },
        { term: 'Review type', definition: '{{review.type}}' },
      ]),
    ])), 'File review {{review.reference}} · internal'),
    withFurniture(page('Checklist', flow([
      heading('Review checklist', 'Every item checked, with the reviewer\'s comment.'),
      table(
        ['Ref', 'Item', 'Comment', 'Result'],
        [
          ['1', '{{review.items.0.item}}', '{{review.items.0.comment}}', '{{review.items.0.result}}'],
          ['2', '{{review.items.1.item}}', '{{review.items.1.comment}}', '{{review.items.1.result}}'],
          ['3', '{{review.items.2.item}}', '{{review.items.2.comment}}', '{{review.items.2.result}}'],
          ['4', '{{review.items.3.item}}', '{{review.items.3.comment}}', '{{review.items.3.result}}'],
          ['5', '{{review.items.4.item}}', '{{review.items.4.comment}}', '{{review.items.4.result}}'],
          ['6', '{{review.items.5.item}}', '{{review.items.5.comment}}', '{{review.items.5.result}}'],
          ['7', '{{review.items.6.item}}', '{{review.items.6.comment}}', '{{review.items.6.result}}'],
          ['8', '{{review.items.7.item}}', '{{review.items.7.comment}}', '{{review.items.7.result}}'],
        ],
        [0.08, 0.30, 0.42, 0.20],
        20,
      ),
    ])), 'File review {{review.reference}} · internal'),
    withFurniture(page('Remediation', flow([
      heading('Remediation', 'Owned, dated, and closed only by the reviewer.'),
      checklist('Required actions', [
        { action: '{{review.actions.0.action}}', owner: '{{review.actions.0.owner}}', timing: '{{review.actions.0.due}}' },
        { action: '{{review.actions.1.action}}', owner: '{{review.actions.1.owner}}', timing: '{{review.actions.1.due}}' },
        { action: '{{review.actions.2.action}}', owner: '{{review.actions.2.owner}}', timing: '{{review.actions.2.due}}' },
      ]),
      callout('Reviewer note', '{{review.note}}', 'warning', 78),
      signature('{{review.reviewer}}', 'Reviewer'),
    ])), 'File review {{review.reference}} · internal'),
    disclaimerPage(
      'This review is an internal quality-assurance record. It is prepared for the purposes of '
      + 'supervision and monitoring, is not advice to any client, and should not be provided outside '
      + 'the organisation without approval.',
    ),
  ];

  return {
    slug: 'compliance-file-review',
    name: 'Compliance File Review',
    description: 'One client file reviewed against the standard checklist, with remediation.',
    longDescription:
      'A five-page internal QA record. Leads with the outcome and the counts, tabulates every '
      + 'checklist item with the reviewer\'s comment and result, and closes with owned, dated '
      + 'remediation actions and a reviewer signature. Marked internal throughout.',
    category: 'compliance',
    reportType: null,
    industry: ['property', 'finance', 'legal'],
    tags: ['compliance', 'quality-assurance', 'internal', 'audit'],
    style: 'corporate',
    accessTier: 'premium',
    schema: schema('Compliance File Review', pages),
  };
}

/**
 * The catalogue.
 *
 * Twelve core templates below, twenty-eight more in `templatesExtended.ts` —
 * forty in total. The split is for file size, not for meaning: every entry goes
 * through the same validation in `buildSeedCatalogue.ts` and lands in the same
 * migration. `templatesExtended` imports only the `SeedTemplate` *type* from
 * here, which erases at build time, so there is no runtime import cycle.
 */
export const CORE_TEMPLATES: SeedTemplate[] = [
  investorCompass(),
  executiveBrief(),
  propertySnapshot(),
  dueDiligenceDossier(),
  suburbCompass(),
  suburbSnapshot(),
  postcodeAnalysis(),
  statewideReview(),
  comparisonMatrix(),
  cashFlowProjection(),
  clientFactFind(),
  complianceFileReview(),
];

export const SEED_TEMPLATES: SeedTemplate[] = [
  ...CORE_TEMPLATES,
  ...EXTENDED_TEMPLATES,
  ...CASH_FLOW_TEMPLATES,
];

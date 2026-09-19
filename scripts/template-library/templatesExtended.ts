/**
 * Template Library — extended catalogue.
 *
 * The twelve templates in `templates.ts` proved the pipeline; these twenty-eight
 * take the library to forty, which is the size the platform was scoped for.
 *
 * Same contract as the core set, enforced by `buildSeedCatalogue.ts` before a
 * migration is written: parses against the live Zod schema, uses only
 * production-renderer block types, passes the publish gate, has no empty page,
 * and references colours only as `token:*` so a partner brand applies in full.
 *
 * Variety is deliberate. A library of forty near-identical layouts is worse
 * than a library of twelve good ones, so page structures differ by purpose —
 * a one-page snapshot is not a nine-page dossier with pages removed.
 */
import {
  barChart, beginTemplate, callout, checklist, contents, cover, currentAccent,
  currentVoice, decision, definitions, disclaimerPage, donutChart, featureList,
  flow, heading, kpis, lineChart, page, processSteps, prose, riskRegister, rule,
  scorecard, signature, strengthsWatch, table, timeline, twoColumn,
  withFurniture,
  type PageDef,
  brandMark,} from './blocks';
import {
  STANDARD_DISCLAIMER as DISCLAIMER,
  voiceTokens,
  type AccentName,
} from './designSystem';
import type { SeedTemplate } from './templates';

interface Spec {
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: string;
  reportType: string | null;
  tier?: string | null;
  industry: string[];
  tags: string[];
  accessTier?: string;
  pages: PageDef[];
}

function make(s: Spec): SeedTemplate {
  return {
    slug: s.slug, name: s.name, description: s.description,
    longDescription: s.longDescription, category: s.category,
    reportType: s.reportType, tier: s.tier ?? null,
    industry: s.industry, tags: s.tags, style: currentVoice().id,
    accessTier: s.accessTier ?? 'standard',
    schema: {
      version: 1 as const, name: s.name,
      tokens: voiceTokens(currentVoice(), currentAccent()),
      pages: s.pages,
    },
  };
}

const FOOT = '{{property.address}} · {{client.name}}';
const MKT_FOOT = '{{property.suburb}} · {{client.name}}';

// ═══════════════════════════════════════════════════════════════════════════
// Investment
// ═══════════════════════════════════════════════════════════════════════════

function offMarketBrief(): SeedTemplate {
  beginTemplate('luxury', 'gold', 'investment');
  return make({
    slug: 'off-market-opportunity-brief',
    name: 'Off-Market Opportunity Brief',
    description: 'A time-sensitive brief on a property that never reached a portal.',
    longDescription:
      'Three pages for an opportunity that will not wait. Leads with the deadline and the '
      + 'ask, states what is known and what is not, and closes with the decision required. '
      + 'Written to be read in five minutes on a phone.',
    category: 'investment', reportType: 'investment', tier: 'snapshot',
    industry: ['property'], tags: ['off-market', 'urgent', 'decision'],
    pages: [
      withFurniture(page('Opportunity', flow([
        brandMark(),
        heading('{{property.address}}', 'Off-market opportunity · prepared for {{client.name}}', 62),
        rule(),
        callout('Time sensitive', '{{opportunity.deadline}}', 'warning', 62),
        kpis([
          { label: 'Guide', value: '{{financials.purchasePrice | currency}}' },
          { label: 'Est. rent p.w.', value: '{{financials.weeklyRent | currency}}' },
          { label: 'Est. yield', value: '{{financials.grossYield | percent}}' },
          { label: 'Suburb median', value: '{{market.medianPrice | currency}}' },
        ]),
        prose('{{opportunity.narrative}}', 88),
      ])), FOOT),
      withFurniture(page('What we know', flow([
        heading('What we know', 'And, just as importantly, what we do not.'),
        definitions('Confirmed', [
          { term: 'Vendor position', definition: '{{opportunity.vendorPosition}}' },
          { term: 'Reason for sale', definition: '{{opportunity.reason}}' },
          { term: 'Settlement preference', definition: '{{opportunity.settlement}}' },
          { term: 'Tenancy', definition: '{{property.tenancy}}' },
          { term: 'Condition', definition: '{{property.condition}}' },
        ]),
        strengthsWatch(
          ['{{opportunity.strength.0}}', '{{opportunity.strength.1}}'],
          ['{{opportunity.unknown.0}}', '{{opportunity.unknown.1}}', '{{opportunity.unknown.2}}'],
        ),
        decision('{{opportunity.recommendation}}', '{{opportunity.rationale}}', 92),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function renovationUplift(): SeedTemplate {
  beginTemplate('technical', 'gold', 'investment');
  return make({
    slug: 'renovation-uplift-analysis',
    name: 'Renovation Uplift Analysis',
    description: 'Scope, cost and the value it actually adds — with the margin stated.',
    longDescription:
      'Five pages for a value-add purchase. Prices the scope line by line, models the '
      + 'end value against comparable renovated stock, and states the margin after costs '
      + 'rather than the headline uplift.',
    category: 'investment', reportType: 'investment',
    industry: ['property'], tags: ['renovation', 'value-add', 'margin'],
    pages: [
      cover({
        eyebrow: 'Renovation Analysis', title: '{{property.address}}',
        subtitle: 'Value-add assessment for {{client.name}}',
      }),
      withFurniture(page('Position', flow([
        heading('Opening position'),
        kpis([
          { label: 'Purchase', value: '{{financials.purchasePrice | currency}}' },
          { label: 'Reno budget', value: '{{reno.budget | currency}}' },
          { label: 'End value', value: '{{reno.endValue | currency}}' },
          { label: 'Margin', value: '{{reno.margin | currency}}' },
        ]),
        prose('{{reno.narrative}}', 78),
        callout('The margin, not the uplift', '{{reno.marginNote}}', 'info', 70),
      ])), FOOT),
      withFurniture(page('Scope', flow([
        heading('Scope and cost', 'Priced from quotes where held, estimates where not.'),
        table(
          ['Item', 'Scope', 'Cost', 'Basis'],
          [
            ['Kitchen', '{{reno.items.0.scope}}', '{{reno.items.0.cost | currency}}', '{{reno.items.0.basis}}'],
            ['Bathrooms', '{{reno.items.1.scope}}', '{{reno.items.1.cost | currency}}', '{{reno.items.1.basis}}'],
            ['Flooring', '{{reno.items.2.scope}}', '{{reno.items.2.cost | currency}}', '{{reno.items.2.basis}}'],
            ['Painting', '{{reno.items.3.scope}}', '{{reno.items.3.cost | currency}}', '{{reno.items.3.basis}}'],
            ['External', '{{reno.items.4.scope}}', '{{reno.items.4.cost | currency}}', '{{reno.items.4.basis}}'],
            ['Contingency', '{{reno.items.5.scope}}', '{{reno.items.5.cost | currency}}', '{{reno.items.5.basis}}'],
          ],
          [0.2, 0.4, 0.2, 0.2],
        ),
        barChart({
          title: 'Cost by trade', dataPath: 'reno.costSeries',
          data: [{ label: 'Kitchen', value: 0 }, { label: 'Bath', value: 0 }, { label: 'Floor', value: 0 }, { label: 'Paint', value: 0 }, { label: 'Ext', value: 0 }],
          height: 168,
        }),
      ])), FOOT),
      withFurniture(page('Uplift', flow([
        heading('End value and margin'),
        table(
          ['Line', 'Amount', 'Note'],
          [
            ['Purchase price', '{{financials.purchasePrice | currency}}', 'Contract'],
            ['Acquisition costs', '{{reno.acquisitionCosts | currency}}', 'Duty, legals, inspections'],
            ['Renovation cost', '{{reno.budget | currency}}', 'Scope above'],
            ['Holding cost during works', '{{reno.holdingCost | currency}}', '{{reno.holdingWeeks}} weeks'],
            ['Total invested', '{{reno.totalInvested | currency}}', 'Sum'],
            ['End value', '{{reno.endValue | currency}}', 'Comparable renovated stock'],
            ['Margin before selling costs', '{{reno.margin | currency}}', '{{reno.marginPercent | percent}}'],
          ],
          [0.42, 0.28, 0.30],
        ),
        riskRegister('Risks to the margin', [
          { risk: '{{reno.risks.0.risk}}', rating: 'Medium', confidence: 'Indicative', why: '{{reno.risks.0.why}}', ddAction: '{{reno.risks.0.action}}' },
          { risk: '{{reno.risks.1.risk}}', rating: 'High', confidence: 'Indicative', why: '{{reno.risks.1.why}}', ddAction: '{{reno.risks.1.action}}' },
        ]),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function firstHomeBuyer(): SeedTemplate {
  beginTemplate('editorial', 'gold', 'investment');
  return make({
    slug: 'first-home-buyer-report',
    name: 'First-Home Buyer Report',
    description: 'Grants, duty, deposit and the real monthly cost — in plain language.',
    longDescription:
      'Four pages written for someone buying their first property. Explains what the '
      + 'concessions actually save, what the monthly cost really is once rates and '
      + 'insurance are counted, and what happens if rates move.',
    category: 'investment', reportType: 'investment', tier: 'executive',
    industry: ['property', 'finance'], tags: ['first-home', 'grants', 'affordability'],
    pages: [
      cover({
        eyebrow: 'First Home', title: 'Your First Property',
        subtitle: 'Prepared for {{client.name}}', titleSize: 36,
      }),
      withFurniture(page('What you can do', flow([
        heading('What you can do', 'Based on the deposit and income you have told us about.'),
        kpis([
          { label: 'Deposit', value: '{{client.deposit | currency}}' },
          { label: 'Borrowing capacity', value: '{{finance.capacity | currency}}' },
          { label: 'Max purchase', value: '{{finance.maxPurchase | currency}}' },
          { label: 'Monthly cost', value: '{{finance.monthlyCost | currency}}' },
        ]),
        definitions('Concessions you qualify for', [
          { term: 'First home owner grant', definition: '{{grants.fhog}}' },
          { term: 'Stamp duty concession', definition: '{{grants.dutyConcession}}' },
          { term: 'Deposit scheme', definition: '{{grants.depositScheme}}' },
          { term: 'Total benefit', definition: '{{grants.total | currency}}' },
        ]),
        callout('What this means', '{{finance.narrative}}', 'info', 74),
      ])), FOOT),
      withFurniture(page('The real cost', flow([
        heading('The real monthly cost', 'Not just the loan repayment.'),
        table(
          ['Item', 'Monthly', 'Annual'],
          [
            ['Loan repayment', '{{finance.monthlyRepayment | currency}}', '{{finance.annualRepayment | currency}}'],
            ['Council rates', '{{finance.monthlyRates | currency}}', '{{finance.annualRates | currency}}'],
            ['Water', '{{finance.monthlyWater | currency}}', '{{finance.annualWater | currency}}'],
            ['Insurance', '{{finance.monthlyInsurance | currency}}', '{{finance.annualInsurance | currency}}'],
            ['Strata (if applicable)', '{{finance.monthlyStrata | currency}}', '{{finance.annualStrata | currency}}'],
            ['Maintenance allowance', '{{finance.monthlyMaintenance | currency}}', '{{finance.annualMaintenance | currency}}'],
            ['Total', '{{finance.monthlyCost | currency}}', '{{finance.annualCost | currency}}'],
          ],
          [0.44, 0.28, 0.28],
        ),
        barChart({
          title: 'Monthly cost if rates move', caption: 'Repayment only',
          dataPath: 'finance.rateScenarios',
          data: [{ label: '-1%', value: 0 }, { label: 'Now', value: 0 }, { label: '+1%', value: 0 }, { label: '+2%', value: 0 }],
          height: 160,
        }),
      ])), FOOT),
      withFurniture(page('Next', flow([
        heading('What happens next'),
        processSteps('Your path to settlement', [
          { title: 'Finance pre-approval', body: '{{steps.0}}' },
          { title: 'Search and inspect', body: '{{steps.1}}' },
          { title: 'Offer and contract review', body: '{{steps.2}}' },
          { title: 'Building and pest', body: '{{steps.3}}' },
          { title: 'Exchange and settle', body: '{{steps.4}}' },
        ]),
        checklist('Before you start', [
          { action: '{{prep.0.action}}', owner: '{{prep.0.owner}}', timing: '{{prep.0.timing}}' },
          { action: '{{prep.1.action}}', owner: '{{prep.1.owner}}', timing: '{{prep.1.timing}}' },
          { action: '{{prep.2.action}}', owner: '{{prep.2.owner}}', timing: '{{prep.2.timing}}' },
        ]),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function smsfAssessment(): SeedTemplate {
  beginTemplate('corporate', 'gold', 'investment');
  return make({
    slug: 'smsf-property-assessment',
    name: 'SMSF Property Assessment',
    description: 'Fund position, LRBA structure, compliance boundaries and the numbers.',
    longDescription:
      'Five pages for a property acquisition inside a self-managed super fund. Covers the '
      + 'fund position, the limited recourse borrowing structure, the compliance boundaries '
      + 'that constrain the purchase, and a cash-flow position on fund terms.',
    category: 'investment', reportType: 'investment',
    industry: ['property', 'finance', 'legal'], tags: ['smsf', 'lrba', 'compliance'], accessTier: 'premium',
    pages: [
      cover({
        eyebrow: 'SMSF Acquisition', title: '{{property.address}}',
        subtitle: 'Fund assessment for {{client.name}}', footnote: 'CONFIDENTIAL',
      }),
      withFurniture(page('Fund position', flow([
        heading('Fund position'),
        kpis([
          { label: 'Fund balance', value: '{{smsf.balance | currency}}' },
          { label: 'Available', value: '{{smsf.available | currency}}' },
          { label: 'LRBA amount', value: '{{smsf.lrba | currency}}' },
          { label: 'LVR', value: '{{smsf.lvr | percent}}' },
        ]),
        definitions('Fund detail', [
          { term: 'Fund name', definition: '{{smsf.name}}' },
          { term: 'Members', definition: '{{smsf.members}}' },
          { term: 'Trustee structure', definition: '{{smsf.trustee}}' },
          { term: 'Investment strategy allows property', definition: '{{smsf.strategyAllows}}' },
          { term: 'Liquidity after purchase', definition: '{{smsf.liquidityAfter | currency}}' },
        ]),
      ])), FOOT),
      withFurniture(page('Structure', flow([
        heading('Borrowing structure', 'Limited recourse, held on bare trust.'),
        processSteps('How the acquisition is structured', [
          { title: 'Bare trust established', body: '{{smsf.structure.0}}' },
          { title: 'LRBA facility approved', body: '{{smsf.structure.1}}' },
          { title: 'Fund contributes deposit and costs', body: '{{smsf.structure.2}}' },
          { title: 'Property acquired by trustee', body: '{{smsf.structure.3}}' },
        ]),
        callout('Compliance boundaries', '{{smsf.boundaries}}', 'warning', 86),
      ])), FOOT),
      withFurniture(page('Numbers', flow([
        heading('Cash flow on fund terms'),
        table(
          ['Item', 'Annual', 'Note'],
          [
            ['Rental income', '{{smsf.rentalIncome | currency}}', 'Net of vacancy'],
            ['Loan interest', '{{smsf.interest | currency}}', '{{smsf.rate | percent}}'],
            ['Rates and insurance', '{{smsf.outgoings | currency}}', 'Fund pays'],
            ['Fund admin attributable', '{{smsf.adminCost | currency}}', 'Apportioned'],
            ['Net to fund', '{{smsf.netToFund | currency}}', 'Before contributions'],
            ['Contributions required', '{{smsf.contributionsRequired | currency}}', 'To service'],
          ],
          [0.42, 0.26, 0.32],
        ),
        riskRegister('Compliance and financial risks', [
          { risk: '{{smsf.risks.0.risk}}', rating: 'High', confidence: 'Verified', why: '{{smsf.risks.0.why}}', ddAction: '{{smsf.risks.0.action}}' },
          { risk: '{{smsf.risks.1.risk}}', rating: 'Medium', confidence: 'Indicative', why: '{{smsf.risks.1.why}}', ddAction: '{{smsf.risks.1.action}}' },
        ]),
      ])), FOOT),
      disclaimerPage(
        DISCLAIMER + ' SMSF acquisitions are subject to superannuation law and the fund\'s '
        + 'own trust deed and investment strategy. Obtain licensed SMSF and legal advice '
        + 'before proceeding.',
      ),
    ],
  });
}

function commercialAssessment(): SeedTemplate {
  beginTemplate('technical', 'gold', 'investment');
  return make({
    slug: 'commercial-property-assessment',
    name: 'Commercial Property Assessment',
    description: 'Tenancy schedule, WALE, outgoings recovery and capitalised value.',
    longDescription:
      'Six pages for a commercial acquisition. Leads with the income, because that is what '
      + 'is being bought: tenancy schedule, weighted average lease expiry, outgoings '
      + 'recovery and the capitalisation that produces the value.',
    category: 'investment', reportType: 'investment',
    industry: ['property', 'finance'], tags: ['commercial', 'wale', 'capitalisation', 'tenancy'], accessTier: 'premium',
    pages: [
      cover({
        eyebrow: 'Commercial', title: '{{property.address}}',
        subtitle: 'Acquisition assessment for {{client.name}}',
      }),
      withFurniture(page('Income', flow([
        heading('Income position'),
        kpis([
          { label: 'Net income', value: '{{commercial.netIncome | currency}}' },
          { label: 'Passing yield', value: '{{commercial.passingYield | percent}}' },
          { label: 'WALE', value: '{{commercial.wale}}' },
          { label: 'Occupancy', value: '{{commercial.occupancy | percent}}' },
        ]),
        table(
          ['Tenant', 'Area', 'Rent p.a.', 'Expiry', 'Review'],
          [
            ['{{commercial.tenants.0.name}}', '{{commercial.tenants.0.area}}', '{{commercial.tenants.0.rent | currency}}', '{{commercial.tenants.0.expiry}}', '{{commercial.tenants.0.review}}'],
            ['{{commercial.tenants.1.name}}', '{{commercial.tenants.1.area}}', '{{commercial.tenants.1.rent | currency}}', '{{commercial.tenants.1.expiry}}', '{{commercial.tenants.1.review}}'],
            ['{{commercial.tenants.2.name}}', '{{commercial.tenants.2.area}}', '{{commercial.tenants.2.rent | currency}}', '{{commercial.tenants.2.expiry}}', '{{commercial.tenants.2.review}}'],
            ['{{commercial.tenants.3.name}}', '{{commercial.tenants.3.area}}', '{{commercial.tenants.3.rent | currency}}', '{{commercial.tenants.3.expiry}}', '{{commercial.tenants.3.review}}'],
          ],
          [0.28, 0.16, 0.2, 0.18, 0.18],
        ),
      ])), FOOT),
      withFurniture(page('Lease expiry', flow([
        heading('Lease expiry profile', 'Where the income is exposed.'),
        barChart({
          title: 'Income expiring by year', dataPath: 'commercial.expirySeries',
          data: [{ label: 'Y1', value: 0 }, { label: 'Y2', value: 0 }, { label: 'Y3', value: 0 }, { label: 'Y4', value: 0 }, { label: 'Y5+', value: 0 }],
        }),
        callout('Concentration', '{{commercial.concentrationNote}}', 'warning', 70),
      ])), FOOT),
      withFurniture(page('Outgoings', flow([
        heading('Outgoings and recovery'),
        table(
          ['Outgoing', 'Amount', 'Recoverable', 'Net cost'],
          [
            ['Council rates', '{{commercial.outgoings.0.amount | currency}}', '{{commercial.outgoings.0.recoverable}}', '{{commercial.outgoings.0.net | currency}}'],
            ['Land tax', '{{commercial.outgoings.1.amount | currency}}', '{{commercial.outgoings.1.recoverable}}', '{{commercial.outgoings.1.net | currency}}'],
            ['Insurance', '{{commercial.outgoings.2.amount | currency}}', '{{commercial.outgoings.2.recoverable}}', '{{commercial.outgoings.2.net | currency}}'],
            ['Management', '{{commercial.outgoings.3.amount | currency}}', '{{commercial.outgoings.3.recoverable}}', '{{commercial.outgoings.3.net | currency}}'],
            ['Repairs and maintenance', '{{commercial.outgoings.4.amount | currency}}', '{{commercial.outgoings.4.recoverable}}', '{{commercial.outgoings.4.net | currency}}'],
          ],
          [0.34, 0.22, 0.22, 0.22],
        ),
        donutChart({
          title: 'Recoverable vs non-recoverable', dataPath: 'commercial.recoveryMix',
          data: [{ label: 'Recoverable', value: 0 }, { label: 'Owner cost', value: 0 }],
          height: 180,
        }),
      ])), FOOT),
      withFurniture(page('Valuation', flow([
        heading('Capitalised value'),
        table(
          ['Basis', 'Income', 'Cap rate', 'Value'],
          [
            ['Passing', '{{commercial.netIncome | currency}}', '{{commercial.capRate | percent}}', '{{commercial.valuePassing | currency}}'],
            ['Market', '{{commercial.marketIncome | currency}}', '{{commercial.capRate | percent}}', '{{commercial.valueMarket | currency}}'],
            ['Fully leased', '{{commercial.fullyLeasedIncome | currency}}', '{{commercial.capRate | percent}}', '{{commercial.valueFullyLeased | currency}}'],
          ],
          [0.28, 0.26, 0.2, 0.26],
        ),
        decision('{{commercial.recommendation.headline}}', '{{commercial.recommendation.body}}', 96),
        signature('{{author.name}}', '{{author.title}}'),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function developmentFeasibility(): SeedTemplate {
  beginTemplate('technical', 'gold', 'investment');
  return make({
    slug: 'development-feasibility-study',
    name: 'Development Feasibility Study',
    description: 'Yield, costs, revenue, programme and the residual land value.',
    longDescription:
      'Six pages of development feasibility. Establishes the achievable yield under the '
      + 'planning controls, prices the build, models the revenue, and works back to a '
      + 'residual land value — the number that says whether the site is worth its price.',
    category: 'investment', reportType: 'investment',
    industry: ['property', 'finance'], tags: ['development', 'feasibility', 'residual', 'planning'], accessTier: 'premium',
    pages: [
      cover({
        eyebrow: 'Feasibility', title: '{{property.address}}',
        subtitle: 'Development study for {{client.name}}',
      }),
      withFurniture(page('Yield', flow([
        heading('Development yield', 'What the controls permit, and what fits.'),
        kpis([
          { label: 'Site area', value: '{{development.siteArea}}' },
          { label: 'Permitted GFA', value: '{{development.gfa}}' },
          { label: 'Dwellings', value: '{{development.dwellings}}' },
          { label: 'Residual land value', value: '{{development.residual | currency}}' },
        ]),
        definitions('Planning controls', [
          { term: 'Zoning', definition: '{{property.zoning}}' },
          { term: 'Height limit', definition: '{{development.heightLimit}}' },
          { term: 'Floor space ratio', definition: '{{development.fsr}}' },
          { term: 'Setbacks', definition: '{{development.setbacks}}' },
          { term: 'Parking requirement', definition: '{{development.parking}}' },
          { term: 'Affordable housing', definition: '{{development.affordable}}' },
        ]),
      ])), FOOT),
      withFurniture(page('Costs', flow([
        heading('Development costs'),
        table(
          ['Item', 'Rate', 'Amount', 'Note'],
          [
            ['Construction', '{{development.costs.0.rate}}', '{{development.costs.0.amount | currency}}', '{{development.costs.0.note}}'],
            ['Professional fees', '{{development.costs.1.rate}}', '{{development.costs.1.amount | currency}}', '{{development.costs.1.note}}'],
            ['Authority contributions', '{{development.costs.2.rate}}', '{{development.costs.2.amount | currency}}', '{{development.costs.2.note}}'],
            ['Finance cost', '{{development.costs.3.rate}}', '{{development.costs.3.amount | currency}}', '{{development.costs.3.note}}'],
            ['Selling and marketing', '{{development.costs.4.rate}}', '{{development.costs.4.amount | currency}}', '{{development.costs.4.note}}'],
            ['Contingency', '{{development.costs.5.rate}}', '{{development.costs.5.amount | currency}}', '{{development.costs.5.note}}'],
            ['Total development cost', '', '{{development.totalCost | currency}}', ''],
          ],
          [0.32, 0.18, 0.24, 0.26],
        ),
      ])), FOOT),
      withFurniture(page('Revenue', flow([
        heading('Revenue and margin'),
        table(
          ['Product', 'No.', 'Avg price', 'Gross revenue'],
          [
            ['{{development.products.0.type}}', '{{development.products.0.count}}', '{{development.products.0.price | currency}}', '{{development.products.0.revenue | currency}}'],
            ['{{development.products.1.type}}', '{{development.products.1.count}}', '{{development.products.1.price | currency}}', '{{development.products.1.revenue | currency}}'],
            ['{{development.products.2.type}}', '{{development.products.2.count}}', '{{development.products.2.price | currency}}', '{{development.products.2.revenue | currency}}'],
            ['Total', '{{development.dwellings}}', '', '{{development.grossRevenue | currency}}'],
          ],
          [0.34, 0.14, 0.24, 0.28],
        ),
        table(
          ['Feasibility line', 'Amount'],
          [
            ['Gross realisation', '{{development.grossRevenue | currency}}'],
            ['Less selling costs and GST', '{{development.sellingCosts | currency}}'],
            ['Net realisation', '{{development.netRevenue | currency}}'],
            ['Less total development cost', '{{development.totalCost | currency}}'],
            ['Less developer margin at {{development.marginPercent | percent}}', '{{development.developerMargin | currency}}'],
            ['Residual land value', '{{development.residual | currency}}'],
          ],
          [0.62, 0.38],
        ),
      ])), FOOT),
      withFurniture(page('Programme', flow([
        heading('Programme and risk'),
        timeline('Indicative programme', [
          { label: 'DA lodged', date: '{{development.programme.0.date}}', note: '{{development.programme.0.note}}' },
          { label: 'DA approved', date: '{{development.programme.1.date}}', note: '{{development.programme.1.note}}' },
          { label: 'Construction start', date: '{{development.programme.2.date}}', note: '{{development.programme.2.note}}' },
          { label: 'Practical completion', date: '{{development.programme.3.date}}', note: '{{development.programme.3.note}}' },
        ]),
        riskRegister('Feasibility risks', [
          { risk: '{{development.risks.0.risk}}', rating: 'High', confidence: 'Indicative', why: '{{development.risks.0.why}}', ddAction: '{{development.risks.0.action}}' },
          { risk: '{{development.risks.1.risk}}', rating: 'High', confidence: 'Indicative', why: '{{development.risks.1.why}}', ddAction: '{{development.risks.1.action}}' },
          { risk: '{{development.risks.2.risk}}', rating: 'Medium', confidence: 'Planned', why: '{{development.risks.2.why}}', ddAction: '{{development.risks.2.action}}' },
        ]),
      ])), FOOT),
      disclaimerPage(
        DISCLAIMER + ' Feasibility outcomes are highly sensitive to construction cost, '
        + 'sales rate and approval timing. Small movements in any of these change the '
        + 'residual land value materially.',
      ),
    ],
  });
}

function portfolioReview(): SeedTemplate {
  beginTemplate('luxury', 'gold', 'investment');
  return make({
    slug: 'portfolio-review',
    name: 'Portfolio Review',
    description: 'Every holding on one basis: equity, yield, debt and what to do next.',
    longDescription:
      'Six pages reviewing a whole portfolio rather than a single asset. Consolidates '
      + 'equity and debt, ranks holdings by contribution, flags the underperformers, and '
      + 'recommends what to hold, improve or divest.',
    category: 'investment', reportType: 'portfolio',
    industry: ['property', 'finance'], tags: ['portfolio', 'equity', 'review', 'annual'],
    pages: [
      cover({
        eyebrow: 'Portfolio Review', title: 'Annual Portfolio Review',
        subtitle: 'Prepared for {{client.name}}',
      }),
      withFurniture(page('Contents', flow([contents('Contents')])), '{{client.name}} portfolio review'),
      withFurniture(page('Position', flow([
        heading('Consolidated position'),
        kpis([
          { label: 'Properties', value: '{{portfolio.count}}' },
          { label: 'Total value', value: '{{portfolio.value | currency}}' },
          { label: 'Total debt', value: '{{portfolio.debt | currency}}' },
          { label: 'Net equity', value: '{{portfolio.equity | currency}}' },
        ]),
        kpis([
          { label: 'Portfolio LVR', value: '{{portfolio.lvr | percent}}' },
          { label: 'Gross yield', value: '{{portfolio.grossYield | percent}}' },
          { label: 'Net cash flow p.a.', value: '{{portfolio.netCashFlow | currency}}' },
          { label: '12-month growth', value: '{{portfolio.growth12m | percent}}' },
        ]),
        prose('{{portfolio.narrative}}', 84),
      ])), '{{client.name}} portfolio review'),
      withFurniture(page('Holdings', flow([
        heading('Holdings', 'Every property on the same six measures.'),
        table(
          ['Property', 'Value', 'Debt', 'Equity', 'Yield', 'Net p.a.'],
          [
            ['{{portfolio.holdings.0.address}}', '{{portfolio.holdings.0.value | currency}}', '{{portfolio.holdings.0.debt | currency}}', '{{portfolio.holdings.0.equity | currency}}', '{{portfolio.holdings.0.yield | percent}}', '{{portfolio.holdings.0.net | currency}}'],
            ['{{portfolio.holdings.1.address}}', '{{portfolio.holdings.1.value | currency}}', '{{portfolio.holdings.1.debt | currency}}', '{{portfolio.holdings.1.equity | currency}}', '{{portfolio.holdings.1.yield | percent}}', '{{portfolio.holdings.1.net | currency}}'],
            ['{{portfolio.holdings.2.address}}', '{{portfolio.holdings.2.value | currency}}', '{{portfolio.holdings.2.debt | currency}}', '{{portfolio.holdings.2.equity | currency}}', '{{portfolio.holdings.2.yield | percent}}', '{{portfolio.holdings.2.net | currency}}'],
            ['{{portfolio.holdings.3.address}}', '{{portfolio.holdings.3.value | currency}}', '{{portfolio.holdings.3.debt | currency}}', '{{portfolio.holdings.3.equity | currency}}', '{{portfolio.holdings.3.yield | percent}}', '{{portfolio.holdings.3.net | currency}}'],
            ['{{portfolio.holdings.4.address}}', '{{portfolio.holdings.4.value | currency}}', '{{portfolio.holdings.4.debt | currency}}', '{{portfolio.holdings.4.equity | currency}}', '{{portfolio.holdings.4.yield | percent}}', '{{portfolio.holdings.4.net | currency}}'],
          ],
          [0.28, 0.15, 0.14, 0.15, 0.13, 0.15], 20,
        ),
        barChart({
          title: 'Equity by property', dataPath: 'portfolio.equitySeries',
          data: [{ label: 'P1', value: 0 }, { label: 'P2', value: 0 }, { label: 'P3', value: 0 }, { label: 'P4', value: 0 }, { label: 'P5', value: 0 }],
          height: 166,
        }),
      ])), '{{client.name}} portfolio review'),
      withFurniture(page('Assessment', flow([
        heading('Assessment'),
        scorecard('Portfolio scorecard', [
          { category: 'Diversification', rating: 'Moderate', note: '{{portfolio.scores.diversificationNote}}' },
          { category: 'Gearing', rating: 'Moderate', note: '{{portfolio.scores.gearingNote}}' },
          { category: 'Cash flow', rating: 'Watch', note: '{{portfolio.scores.cashFlowNote}}' },
          { category: 'Growth', rating: 'Strong', note: '{{portfolio.scores.growthNote}}' },
        ]),
        strengthsWatch(
          ['{{portfolio.strength.0}}', '{{portfolio.strength.1}}'],
          ['{{portfolio.watch.0}}', '{{portfolio.watch.1}}'],
        ),
      ])), '{{client.name}} portfolio review'),
      withFurniture(page('Actions', flow([
        heading('Recommended actions'),
        decision('{{portfolio.recommendation.headline}}', '{{portfolio.recommendation.body}}', 96),
        checklist('This year', [
          { action: '{{portfolio.actions.0.action}}', owner: '{{portfolio.actions.0.owner}}', timing: '{{portfolio.actions.0.timing}}' },
          { action: '{{portfolio.actions.1.action}}', owner: '{{portfolio.actions.1.owner}}', timing: '{{portfolio.actions.1.timing}}' },
          { action: '{{portfolio.actions.2.action}}', owner: '{{portfolio.actions.2.owner}}', timing: '{{portfolio.actions.2.timing}}' },
          { action: '{{portfolio.actions.3.action}}', owner: '{{portfolio.actions.3.owner}}', timing: '{{portfolio.actions.3.timing}}' },
        ]),
        signature('{{author.name}}', '{{author.title}}'),
      ])), '{{client.name}} portfolio review'),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Suburb / postcode / statewide
// ═══════════════════════════════════════════════════════════════════════════

function marketBrief(opts: {
  slug: string; name: string; description: string; longDescription: string;
  category: string; reportType: string; subject: string; tier?: string;
  accent: AccentName; tags: string[];
}): SeedTemplate {
  beginTemplate('minimal', opts.accent, opts.category);
  return make({
    slug: opts.slug, name: opts.name, description: opts.description,
    longDescription: opts.longDescription, category: opts.category,
    reportType: opts.reportType, tier: opts.tier ?? 'executive',
    industry: ['property'], tags: opts.tags,
    pages: [
      withFurniture(page('Brief', flow([
        brandMark(),
        heading(opts.subject, 'Market brief prepared for {{client.name}}', 62),
        rule(),
        kpis([
          { label: 'Median price', value: '{{market.medianPrice | currency}}' },
          { label: 'Growth 12m', value: '{{market.growth12m | percent}}' },
          { label: 'Median rent', value: '{{market.medianRent | currency}}' },
          { label: 'Vacancy', value: '{{market.vacancy | percent}}' },
        ]),
        prose('{{market.narrative}}', 92),
        strengthsWatch(
          ['{{market.strength.0}}', '{{market.strength.1}}'],
          ['{{market.watch.0}}', '{{market.watch.1}}'],
        ),
      ])), MKT_FOOT),
      withFurniture(page('Evidence', flow([
        heading('The evidence'),
        barChart({
          title: 'Median price, five years', dataPath: 'market.priceSeries',
          data: [{ label: 'Y-4', value: 0 }, { label: 'Y-3', value: 0 }, { label: 'Y-2', value: 0 }, { label: 'Y-1', value: 0 }, { label: 'Now', value: 0 }],
          height: 174,
        }),
        table(
          ['Indicator', 'Now', 'Year ago', 'Change'],
          [
            ['Median price', '{{market.medianPrice | currency}}', '{{market.medianPriceLast | currency}}', '{{market.growth12m | percent}}'],
            ['Median rent', '{{market.medianRent | currency}}', '{{market.medianRentLast | currency}}', '{{market.rentGrowth12m | percent}}'],
            ['Gross yield', '{{market.grossYield | percent}}', '{{market.grossYieldLast | percent}}', '{{market.yieldChange}}'],
            ['Vacancy', '{{market.vacancy | percent}}', '{{market.vacancyLast | percent}}', '{{market.vacancyChange}}'],
            ['Days on market', '{{market.daysOnMarket}}', '{{market.daysOnMarketLast}}', '{{market.domChange}}'],
          ],
          [0.34, 0.22, 0.22, 0.22],
        ),
        decision('{{market.conclusion.headline}}', '{{market.conclusion.body}}', 90),
      ])), MKT_FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function marketSnapshot(opts: {
  slug: string; name: string; description: string; longDescription: string;
  category: string; reportType: string; subject: string;
  accent: AccentName; tags: string[];
}): SeedTemplate {
  beginTemplate('minimal', opts.accent, opts.category);
  return make({
    slug: opts.slug, name: opts.name, description: opts.description,
    longDescription: opts.longDescription, category: opts.category,
    reportType: opts.reportType, tier: 'snapshot',
    industry: ['property'], tags: opts.tags,
    pages: [
      withFurniture(page('Snapshot', flow([
        brandMark(),
        heading(opts.subject, 'Snapshot for {{client.name}}', 60),
        rule(),
        kpis([
          { label: 'Median price', value: '{{market.medianPrice | currency}}' },
          { label: 'Growth 12m', value: '{{market.growth12m | percent}}' },
          { label: 'Median rent', value: '{{market.medianRent | currency}}' },
          { label: 'Vacancy', value: '{{market.vacancy | percent}}' },
        ]),
        barChart({
          title: 'Median price, five years', dataPath: 'market.priceSeries',
          data: [{ label: 'Y-4', value: 0 }, { label: 'Y-3', value: 0 }, { label: 'Y-2', value: 0 }, { label: 'Y-1', value: 0 }, { label: 'Now', value: 0 }],
          height: 176,
        }),
        callout('Read', '{{market.narrative}}', 'info', 88),
      ])), MKT_FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function suburbGrowthDrivers(): SeedTemplate {
  beginTemplate('editorial', 'amethyst', 'suburb');
  return make({
    slug: 'suburb-growth-drivers',
    name: 'Suburb Growth Drivers',
    description: 'What is actually driving the suburb — infrastructure, jobs, supply.',
    longDescription:
      'Four pages that go past the price series and name the causes: committed '
      + 'infrastructure, employment change, planned supply and demographic shift, each '
      + 'with a stated confidence level rather than an assertion.',
    category: 'suburb', reportType: 'suburb',
    industry: ['property'], tags: ['drivers', 'infrastructure', 'research', 'outlook'],
    pages: [
      cover({
        eyebrow: 'Growth Drivers', title: '{{property.suburb}}',
        subtitle: 'What is driving this market · {{client.name}}',
      }),
      withFurniture(page('Drivers', flow([
        heading('The drivers', 'Named, and rated for how confident we are in each.'),
        featureList('What is moving this market', [
          { icon: '▲', title: '{{drivers.0.title}}', body: '{{drivers.0.body}}' },
          { icon: '▲', title: '{{drivers.1.title}}', body: '{{drivers.1.body}}' },
          { icon: '▲', title: '{{drivers.2.title}}', body: '{{drivers.2.body}}' },
          { icon: '▼', title: '{{drivers.3.title}}', body: '{{drivers.3.body}}' },
        ]),
        riskRegister('Confidence in each driver', [
          { risk: '{{drivers.0.title}}', rating: 'Strong', confidence: 'Verified', why: '{{drivers.0.evidence}}', ddAction: '{{drivers.0.watch}}' },
          { risk: '{{drivers.1.title}}', rating: 'Moderate', confidence: 'Planned', why: '{{drivers.1.evidence}}', ddAction: '{{drivers.1.watch}}' },
          { risk: '{{drivers.2.title}}', rating: 'Moderate', confidence: 'Indicative', why: '{{drivers.2.evidence}}', ddAction: '{{drivers.2.watch}}' },
        ]),
      ])), MKT_FOOT),
      withFurniture(page('Supply', flow([
        heading('Supply pipeline', 'Approved, under construction and proposed.'),
        table(
          ['Project', 'Type', 'Dwellings', 'Status', 'Completion'],
          [
            ['{{supply.0.name}}', '{{supply.0.type}}', '{{supply.0.dwellings}}', '{{supply.0.status}}', '{{supply.0.completion}}'],
            ['{{supply.1.name}}', '{{supply.1.type}}', '{{supply.1.dwellings}}', '{{supply.1.status}}', '{{supply.1.completion}}'],
            ['{{supply.2.name}}', '{{supply.2.type}}', '{{supply.2.dwellings}}', '{{supply.2.status}}', '{{supply.2.completion}}'],
            ['{{supply.3.name}}', '{{supply.3.type}}', '{{supply.3.dwellings}}', '{{supply.3.status}}', '{{supply.3.completion}}'],
          ],
          [0.3, 0.18, 0.16, 0.18, 0.18],
        ),
        barChart({
          title: 'Dwellings completing by year', dataPath: 'supply.completionSeries',
          data: [{ label: 'Y1', value: 0 }, { label: 'Y2', value: 0 }, { label: 'Y3', value: 0 }, { label: 'Y4', value: 0 }],
          height: 168,
        }),
      ])), MKT_FOOT),
      withFurniture(page('Outlook', flow([
        heading('Outlook'),
        timeline('What to watch and when', [
          { label: '{{watch.0.label}}', date: '{{watch.0.date}}', note: '{{watch.0.note}}' },
          { label: '{{watch.1.label}}', date: '{{watch.1.date}}', note: '{{watch.1.note}}' },
          { label: '{{watch.2.label}}', date: '{{watch.2.date}}', note: '{{watch.2.note}}' },
          { label: '{{watch.3.label}}', date: '{{watch.3.date}}', note: '{{watch.3.note}}' },
        ]),
        decision('{{drivers.conclusion.headline}}', '{{drivers.conclusion.body}}', 96),
      ])), MKT_FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function suburbRentalMarket(): SeedTemplate {
  beginTemplate('technical', 'amethyst', 'suburb');
  return make({
    slug: 'suburb-rental-market-report',
    name: 'Suburb Rental Market Report',
    description: 'Rents by type and bedroom, vacancy, days to lease and tenant demand.',
    longDescription:
      'Four pages for a landlord or an investor pricing a rental. Breaks rents down by '
      + 'dwelling type and bedroom count rather than quoting one median, and pairs them '
      + 'with vacancy and days-to-lease so the price has a speed attached.',
    category: 'suburb', reportType: 'suburb',
    industry: ['property'], tags: ['rental', 'vacancy', 'yield', 'leasing'],
    pages: [
      cover({
        eyebrow: 'Rental Market', title: '{{property.suburb}}',
        subtitle: 'Rental market report for {{client.name}}',
      }),
      withFurniture(page('Rents', flow([
        heading('Rents by type and size'),
        kpis([
          { label: 'Median rent', value: '{{market.medianRent | currency}}' },
          { label: 'Vacancy', value: '{{market.vacancy | percent}}' },
          { label: 'Days to lease', value: '{{market.daysToLease}}' },
          { label: 'Gross yield', value: '{{market.grossYield | percent}}' },
        ]),
        table(
          ['Type', '1 bed', '2 bed', '3 bed', '4 bed'],
          [
            ['House', '{{rental.house.1}}', '{{rental.house.2}}', '{{rental.house.3}}', '{{rental.house.4}}'],
            ['Townhouse', '{{rental.town.1}}', '{{rental.town.2}}', '{{rental.town.3}}', '{{rental.town.4}}'],
            ['Unit', '{{rental.unit.1}}', '{{rental.unit.2}}', '{{rental.unit.3}}', '{{rental.unit.4}}'],
          ],
          [0.28, 0.18, 0.18, 0.18, 0.18],
        ),
        barChart({
          title: 'Median rent by bedroom count', dataPath: 'rental.bedroomSeries',
          data: [{ label: '1 bed', value: 0 }, { label: '2 bed', value: 0 }, { label: '3 bed', value: 0 }, { label: '4 bed', value: 0 }],
          height: 166,
        }),
      ])), MKT_FOOT),
      withFurniture(page('Demand', flow([
        heading('Tenant demand'),
        lineChart({
          title: 'Vacancy rate, 24 months', dataPath: 'rental.vacancySeries',
          data: Array.from({ length: 8 }, (_, i) => ({ label: `M${i * 3}`, value: 0 })),
        }),
        definitions('Who is renting here', [
          { term: 'Dominant household type', definition: '{{rental.householdType}}' },
          { term: 'Median tenant age', definition: '{{rental.tenantAge}}' },
          { term: 'Average tenancy length', definition: '{{rental.tenancyLength}}' },
          { term: 'Proportion renting', definition: '{{rental.rentingShare | percent}}' },
        ]),
      ])), MKT_FOOT),
      withFurniture(page('Pricing', flow([
        heading('Pricing recommendation'),
        decision('{{rental.recommendation.headline}}', '{{rental.recommendation.body}}', 96),
        checklist('To achieve it', [
          { action: '{{rental.actions.0.action}}', owner: '{{rental.actions.0.owner}}', timing: '{{rental.actions.0.timing}}' },
          { action: '{{rental.actions.1.action}}', owner: '{{rental.actions.1.owner}}', timing: '{{rental.actions.1.timing}}' },
          { action: '{{rental.actions.2.action}}', owner: '{{rental.actions.2.owner}}', timing: '{{rental.actions.2.timing}}' },
        ]),
      ])), MKT_FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparison
// ═══════════════════════════════════════════════════════════════════════════

function headToHead(): SeedTemplate {
  beginTemplate('minimal', 'info', 'comparison');
  return make({
    slug: 'two-property-head-to-head',
    name: 'Two-Property Head-to-Head',
    description: 'Two properties, one page of differences, one recommendation.',
    longDescription:
      'Three pages for the final two on a shortlist. Shows only what differs between '
      + 'them — identical attributes are noise at this stage — and commits to one.',
    category: 'comparison', reportType: 'comparison',
    industry: ['property'], tags: ['comparison', 'shortlist', 'decision', 'concise'],
    pages: [
      withFurniture(page('Head to head', flow([
        brandMark(),
        heading('Head to head', 'Prepared for {{client.name}}', 60),
        rule(),
        table(
          ['Measure', 'Property A', 'Property B'],
          [
            ['Address', '{{comparison.a.address}}', '{{comparison.b.address}}'],
            ['Price', '{{comparison.a.price | currency}}', '{{comparison.b.price | currency}}'],
            ['Weekly rent', '{{comparison.a.rent | currency}}', '{{comparison.b.rent | currency}}'],
            ['Gross yield', '{{comparison.a.yield | percent}}', '{{comparison.b.yield | percent}}'],
            ['Net weekly', '{{comparison.a.net | currency}}', '{{comparison.b.net | currency}}'],
            ['Land area', '{{comparison.a.land}}', '{{comparison.b.land}}'],
            ['Condition', '{{comparison.a.condition}}', '{{comparison.b.condition}}'],
            ['Suburb growth 12m', '{{comparison.a.growth | percent}}', '{{comparison.b.growth | percent}}'],
          ],
          [0.34, 0.33, 0.33],
        ),
        twoColumn(
          { heading: 'Property A', body: '{{comparison.a.summary}}' },
          { heading: 'Property B', body: '{{comparison.b.summary}}' },
          126,
        ),
      ])), 'Head to head · {{client.name}}'),
      withFurniture(page('Decision', flow([
        heading('The decision'),
        barChart({
          title: 'Net weekly position', dataPath: 'comparison.netSeries',
          data: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }], height: 160,
        }),
        decision('{{comparison.recommendation.headline}}', '{{comparison.recommendation.body}}', 104),
        callout('If the recommendation is not taken', '{{comparison.alternative}}', 'warning', 74),
      ])), 'Head to head · {{client.name}}'),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function buyVsHold(): SeedTemplate {
  beginTemplate('technical', 'info', 'comparison');
  return make({
    slug: 'buy-vs-hold-comparison',
    name: 'Buy, Hold or Sell Comparison',
    description: 'The three options for an existing holding, modelled over ten years.',
    longDescription:
      'Four pages modelling what happens to an existing property under three courses of '
      + 'action — hold as is, improve and hold, or sell and redeploy — over the same '
      + 'ten-year horizon on the same assumptions.',
    category: 'comparison', reportType: 'comparison',
    industry: ['property', 'finance'], tags: ['comparison', 'hold', 'divest', 'projection'],
    pages: [
      cover({
        eyebrow: 'Options Analysis', title: 'Buy, Hold or Sell',
        subtitle: '{{property.address}} · {{client.name}}',
      }),
      withFurniture(page('Options', flow([
        heading('The three options', 'Modelled on identical assumptions.'),
        table(
          ['Measure', 'Hold as is', 'Improve and hold', 'Sell and redeploy'],
          [
            ['Capital required', '{{options.a.capital | currency}}', '{{options.b.capital | currency}}', '{{options.c.capital | currency}}'],
            ['Net cash flow yr 1', '{{options.a.cashFlow | currency}}', '{{options.b.cashFlow | currency}}', '{{options.c.cashFlow | currency}}'],
            ['Value at year 10', '{{options.a.value10 | currency}}', '{{options.b.value10 | currency}}', '{{options.c.value10 | currency}}'],
            ['Equity at year 10', '{{options.a.equity10 | currency}}', '{{options.b.equity10 | currency}}', '{{options.c.equity10 | currency}}'],
            ['Transaction costs', '{{options.a.costs | currency}}', '{{options.b.costs | currency}}', '{{options.c.costs | currency}}'],
            ['Tax consequence', '{{options.a.tax}}', '{{options.b.tax}}', '{{options.c.tax}}'],
            ['Reversibility', '{{options.a.reversibility}}', '{{options.b.reversibility}}', '{{options.c.reversibility}}'],
          ],
          [0.28, 0.24, 0.24, 0.24],
        ),
      ])), FOOT),
      withFurniture(page('Projection', flow([
        heading('Equity over ten years'),
        lineChart({
          title: 'Projected equity by option', caption: 'Same growth and rate assumptions throughout',
          dataPath: 'options.equitySeries',
          data: Array.from({ length: 10 }, (_, i) => ({ label: `Yr ${i + 1}`, value: 0 })),
        }),
        definitions('Assumptions', [
          { term: 'Capital growth', definition: '{{assumptions.capitalGrowth | percent}} per annum' },
          { term: 'Rental growth', definition: '{{assumptions.rentalGrowth | percent}} per annum' },
          { term: 'Interest rate', definition: '{{assumptions.interestRate | percent}}' },
          { term: 'Selling costs', definition: '{{assumptions.sellingCosts | percent}}' },
        ]),
      ])), FOOT),
      withFurniture(page('Recommendation', flow([
        heading('Recommendation'),
        decision('{{options.recommendation.headline}}', '{{options.recommendation.body}}', 104),
        riskRegister('What could change the answer', [
          { risk: '{{options.risks.0.risk}}', rating: 'Medium', confidence: 'Indicative', why: '{{options.risks.0.why}}', ddAction: '{{options.risks.0.action}}' },
          { risk: '{{options.risks.1.risk}}', rating: 'Medium', confidence: 'Indicative', why: '{{options.risks.1.why}}', ddAction: '{{options.risks.1.action}}' },
        ]),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function portfolioComparison(): SeedTemplate {
  beginTemplate('technical', 'info', 'comparison');
  return make({
    slug: 'portfolio-comparison',
    name: 'Portfolio Comparison',
    description: 'Rank every holding on contribution, and say which one is the drag.',
    longDescription:
      'Four pages comparing holdings against each other rather than against the market. '
      + 'Ranks by contribution to equity and to cash flow, then names the property that '
      + 'is costing the portfolio the most to keep.',
    category: 'comparison', reportType: 'portfolio',
    industry: ['property', 'finance'], tags: ['portfolio', 'ranking', 'contribution'],
    pages: [
      cover({
        eyebrow: 'Portfolio', title: 'Holding Comparison',
        subtitle: 'Prepared for {{client.name}}',
      }),
      withFurniture(page('Ranked', flow([
        heading('Ranked by contribution'),
        table(
          ['Rank', 'Property', 'Equity', 'Net p.a.', 'Growth 12m', 'Contribution'],
          [
            ['1', '{{ranking.0.address}}', '{{ranking.0.equity | currency}}', '{{ranking.0.net | currency}}', '{{ranking.0.growth | percent}}', '{{ranking.0.contribution}}'],
            ['2', '{{ranking.1.address}}', '{{ranking.1.equity | currency}}', '{{ranking.1.net | currency}}', '{{ranking.1.growth | percent}}', '{{ranking.1.contribution}}'],
            ['3', '{{ranking.2.address}}', '{{ranking.2.equity | currency}}', '{{ranking.2.net | currency}}', '{{ranking.2.growth | percent}}', '{{ranking.2.contribution}}'],
            ['4', '{{ranking.3.address}}', '{{ranking.3.equity | currency}}', '{{ranking.3.net | currency}}', '{{ranking.3.growth | percent}}', '{{ranking.3.contribution}}'],
            ['5', '{{ranking.4.address}}', '{{ranking.4.equity | currency}}', '{{ranking.4.net | currency}}', '{{ranking.4.growth | percent}}', '{{ranking.4.contribution}}'],
          ],
          [0.1, 0.28, 0.17, 0.15, 0.15, 0.15], 20,
        ),
        barChart({
          title: 'Net annual cash flow by property', dataPath: 'ranking.netSeries',
          data: [{ label: 'P1', value: 0 }, { label: 'P2', value: 0 }, { label: 'P3', value: 0 }, { label: 'P4', value: 0 }, { label: 'P5', value: 0 }],
          height: 168,
        }),
      ])), '{{client.name}} portfolio'),
      withFurniture(page('The drag', flow([
        heading('The drag', 'The holding costing the portfolio the most to keep.'),
        callout('Underperformer', '{{drag.summary}}', 'warning', 84),
        table(
          ['Measure', 'This property', 'Portfolio average'],
          [
            ['Net annual cash flow', '{{drag.net | currency}}', '{{portfolio.avgNet | currency}}'],
            ['Gross yield', '{{drag.yield | percent}}', '{{portfolio.avgYield | percent}}'],
            ['12-month growth', '{{drag.growth | percent}}', '{{portfolio.avgGrowth | percent}}'],
            ['LVR', '{{drag.lvr | percent}}', '{{portfolio.lvr | percent}}'],
            ['Maintenance last 12m', '{{drag.maintenance | currency}}', '{{portfolio.avgMaintenance | currency}}'],
          ],
          [0.4, 0.3, 0.3],
        ),
        decision('{{drag.recommendation.headline}}', '{{drag.recommendation.body}}', 92),
      ])), '{{client.name}} portfolio'),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cash flow
// ═══════════════════════════════════════════════════════════════════════════

function cashFlowSnapshot(): SeedTemplate {
  beginTemplate('minimal', 'evergreen', 'cash_flow');
  return make({
    slug: 'cash-flow-snapshot',
    name: 'Cash Flow Snapshot',
    description: 'One page: what it earns, what it costs, what it leaves.',
    longDescription:
      'A single page for a quick answer. Income, costs and the net weekly position, with '
      + 'a break-even rent so the margin for error is visible at a glance.',
    category: 'cash_flow', reportType: 'cashflow', tier: 'snapshot',
    industry: ['property', 'finance'], tags: ['quick', 'one-page', 'cash-flow'],
    pages: [
      withFurniture(page('Snapshot', flow([
        brandMark(),
        heading('{{property.address}}', 'Cash flow snapshot for {{client.name}}', 60),
        rule(),
        kpis([
          { label: 'Rent p.w.', value: '{{financials.weeklyRent | currency}}' },
          { label: 'Costs p.w.', value: '{{financials.weeklyCosts | currency}}' },
          { label: 'Net p.w.', value: '{{financials.weeklyNet | currency}}' },
          { label: 'Break-even rent', value: '{{financials.breakEvenRent | currency}}' },
        ]),
        table(
          ['Item', 'Weekly', 'Annual'],
          [
            ['Rental income', '{{financials.weeklyRent | currency}}', '{{financials.annualRent | currency}}'],
            ['Loan repayment', '{{financials.weeklyRepayment | currency}}', '{{financials.annualRepayment | currency}}'],
            ['Rates and water', '{{financials.weeklyRates | currency}}', '{{financials.annualRates | currency}}'],
            ['Insurance', '{{financials.weeklyInsurance | currency}}', '{{financials.annualInsurance | currency}}'],
            ['Management', '{{financials.weeklyManagement | currency}}', '{{financials.annualManagement | currency}}'],
            ['Maintenance allowance', '{{financials.weeklyMaintenance | currency}}', '{{financials.annualMaintenance | currency}}'],
            ['Net position', '{{financials.weeklyNet | currency}}', '{{financials.annualNet | currency}}'],
          ],
          [0.44, 0.28, 0.28],
        ),
        callout('What it means', '{{financials.narrative}}', 'info', 72),
      ])), FOOT),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function negativeGearing(): SeedTemplate {
  beginTemplate('technical', 'evergreen', 'cash_flow');
  return make({
    slug: 'negative-gearing-analysis',
    name: 'Negative Gearing Analysis',
    description: 'Pre-tax shortfall, deductions, depreciation and the after-tax position.',
    longDescription:
      'Four pages showing what a negatively geared holding actually costs after tax. '
      + 'Separates cash deductions from depreciation, applies the marginal rate, and '
      + 'states the real weekly cost rather than the headline shortfall.',
    category: 'cash_flow', reportType: 'cashflow',
    industry: ['property', 'finance'], tags: ['tax', 'gearing', 'depreciation', 'deductions'],
    pages: [
      cover({
        eyebrow: 'Tax Position', title: 'Negative Gearing Analysis',
        subtitle: '{{property.address}} · {{client.name}}',
      }),
      withFurniture(page('Position', flow([
        heading('Before and after tax'),
        kpis([
          { label: 'Pre-tax shortfall', value: '{{tax.preTaxWeekly | currency}}' },
          { label: 'Tax benefit', value: '{{tax.benefitWeekly | currency}}' },
          { label: 'After-tax cost', value: '{{tax.afterTaxWeekly | currency}}' },
          { label: 'Marginal rate', value: '{{tax.marginalRate | percent}}' },
        ]),
        prose('{{tax.narrative}}', 82),
        callout('Depreciation is not cash', '{{tax.depreciationNote}}', 'warning', 74),
      ])), FOOT),
      withFurniture(page('Deductions', flow([
        heading('Deductions'),
        table(
          ['Deduction', 'Annual', 'Cash cost?', 'Note'],
          [
            ['Loan interest', '{{tax.deductions.0.amount | currency}}', 'Yes', '{{tax.deductions.0.note}}'],
            ['Council and water rates', '{{tax.deductions.1.amount | currency}}', 'Yes', '{{tax.deductions.1.note}}'],
            ['Insurance', '{{tax.deductions.2.amount | currency}}', 'Yes', '{{tax.deductions.2.note}}'],
            ['Management fees', '{{tax.deductions.3.amount | currency}}', 'Yes', '{{tax.deductions.3.note}}'],
            ['Repairs', '{{tax.deductions.4.amount | currency}}', 'Yes', '{{tax.deductions.4.note}}'],
            ['Capital works (Div 43)', '{{tax.deductions.5.amount | currency}}', 'No', '{{tax.deductions.5.note}}'],
            ['Plant and equipment (Div 40)', '{{tax.deductions.6.amount | currency}}', 'No', '{{tax.deductions.6.note}}'],
            ['Total deductions', '{{tax.totalDeductions | currency}}', '', ''],
          ],
          [0.36, 0.22, 0.16, 0.26], 20,
        ),
      ])), FOOT),
      withFurniture(page('Sensitivity', flow([
        heading('If the rate changes'),
        barChart({
          title: 'After-tax weekly cost by marginal rate', dataPath: 'tax.rateSeries',
          data: [{ label: '32.5%', value: 0 }, { label: '37%', value: 0 }, { label: '45%', value: 0 }],
          height: 168,
        }),
        decision('{{tax.conclusion.headline}}', '{{tax.conclusion.body}}', 96),
      ])), FOOT),
      disclaimerPage(
        DISCLAIMER + ' Taxation outcomes depend on individual circumstances and current '
        + 'law. This is not tax advice; obtain advice from a registered tax agent.',
      ),
    ],
  });
}

function equityPosition(): SeedTemplate {
  beginTemplate('corporate', 'evergreen', 'cash_flow');
  return make({
    slug: 'equity-position-report',
    name: 'Equity Position Report',
    description: 'Usable equity across the portfolio, and what it could fund.',
    longDescription:
      'Four pages answering "how much can I actually access". Values each holding, nets '
      + 'off debt, applies lender LVR limits to get usable rather than paper equity, and '
      + 'shows what that would fund at current serviceability.',
    category: 'cash_flow', reportType: 'cashflow',
    industry: ['property', 'finance'], tags: ['equity', 'lvr', 'release', 'capacity'],
    pages: [
      cover({
        eyebrow: 'Equity', title: 'Equity Position',
        subtitle: 'Prepared for {{client.name}}',
      }),
      withFurniture(page('Position', flow([
        heading(
          'Usable equity',
          'Paper equity is not accessible equity. Usable equity is calculated at a '
          + '{{equity.lvrLimit | percent}} lender LVR limit.',
        ),
        kpis([
          { label: 'Total value', value: '{{equity.totalValue | currency}}' },
          { label: 'Total debt', value: '{{equity.totalDebt | currency}}' },
          { label: 'Paper equity', value: '{{equity.paper | currency}}' },
          { label: 'Usable equity', value: '{{equity.usable | currency}}' },
        ]),
        table(
          // Column headers are static labels. `renderDataTableHtml` escapes
          // `headers` verbatim and only resolves `rows[].cells`, so a binding
          // here would print its own braces in the customer's PDF. The LVR
          // limit the column is computed at is stated in the heading instead.
          ['Property', 'Value', 'Debt', 'LVR', 'Usable equity'],
          [
            ['{{equity.holdings.0.address}}', '{{equity.holdings.0.value | currency}}', '{{equity.holdings.0.debt | currency}}', '{{equity.holdings.0.lvr | percent}}', '{{equity.holdings.0.usable | currency}}'],
            ['{{equity.holdings.1.address}}', '{{equity.holdings.1.value | currency}}', '{{equity.holdings.1.debt | currency}}', '{{equity.holdings.1.lvr | percent}}', '{{equity.holdings.1.usable | currency}}'],
            ['{{equity.holdings.2.address}}', '{{equity.holdings.2.value | currency}}', '{{equity.holdings.2.debt | currency}}', '{{equity.holdings.2.lvr | percent}}', '{{equity.holdings.2.usable | currency}}'],
            ['{{equity.holdings.3.address}}', '{{equity.holdings.3.value | currency}}', '{{equity.holdings.3.debt | currency}}', '{{equity.holdings.3.lvr | percent}}', '{{equity.holdings.3.usable | currency}}'],
          ],
          [0.28, 0.18, 0.18, 0.14, 0.22],
        ),
      ])), '{{client.name}} equity position'),
      withFurniture(page('What it funds', flow([
        heading('What the equity would fund'),
        table(
          ['Scenario', 'Deposit available', 'Borrowing capacity', 'Max purchase'],
          [
            ['Conservative', '{{equity.scenarios.0.deposit | currency}}', '{{equity.scenarios.0.capacity | currency}}', '{{equity.scenarios.0.maxPurchase | currency}}'],
            ['Base', '{{equity.scenarios.1.deposit | currency}}', '{{equity.scenarios.1.capacity | currency}}', '{{equity.scenarios.1.maxPurchase | currency}}'],
            ['Stretch', '{{equity.scenarios.2.deposit | currency}}', '{{equity.scenarios.2.capacity | currency}}', '{{equity.scenarios.2.maxPurchase | currency}}'],
          ],
          [0.26, 0.24, 0.25, 0.25],
        ),
        callout('The constraint', '{{equity.constraintNote}}', 'warning', 78),
        decision('{{equity.recommendation.headline}}', '{{equity.recommendation.body}}', 92),
      ])), '{{client.name}} equity position'),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Client forms
// ═══════════════════════════════════════════════════════════════════════════

function buyerBrief(): SeedTemplate {
  beginTemplate('minimal', 'orchid', 'client_form');
  return make({
    slug: 'buyer-brief-form',
    name: 'Buyer Brief',
    description: 'The mandate, in the client\'s words, signed before the search starts.',
    longDescription:
      'Three pages capturing what the client is actually looking for, including the '
      + 'walk-away conditions. Signed, so that when a property is presented there is an '
      + 'agreed standard to judge it against.',
    category: 'client_form', reportType: 'formara',
    industry: ['property'], tags: ['brief', 'mandate', 'intake', 'signature'],
    pages: [
      withFurniture(page('Your brief', flow([
        brandMark(),
        heading('Your brief', 'What we will be searching for, in your words.', 62),
        rule(),
        definitions('The mandate', [
          { term: 'Purpose', definition: '{{brief.purpose}}' },
          { term: 'Budget', definition: '{{brief.budget | currency}}' },
          { term: 'Maximum stretch', definition: '{{brief.maxStretch | currency}}' },
          { term: 'Locations', definition: '{{brief.locations}}' },
          { term: 'Property type', definition: '{{brief.propertyType}}' },
          { term: 'Minimum configuration', definition: '{{brief.configuration}}' },
          { term: 'Minimum land', definition: '{{brief.minLand}}' },
          { term: 'Target yield', definition: '{{brief.targetYield | percent}}' },
        ]),
      ])), 'Buyer brief · {{client.name}}'),
      withFurniture(page('Boundaries', flow([
        heading('Boundaries', 'What would make us walk away.'),
        checklist('Deal breakers', [
          { action: '{{brief.dealBreakers.0}}', owner: '', timing: '' },
          { action: '{{brief.dealBreakers.1}}', owner: '', timing: '' },
          { action: '{{brief.dealBreakers.2}}', owner: '', timing: '' },
          { action: '{{brief.dealBreakers.3}}', owner: '', timing: '' },
        ]),
        callout('Willing to compromise on', '{{brief.compromises}}', 'info', 74),
        definitions('How we will work', [
          { term: 'Reporting frequency', definition: '{{brief.reporting}}' },
          { term: 'Decision authority', definition: '{{brief.authority}}' },
          { term: 'Target timeframe', definition: '{{brief.timeframe}}' },
        ]),
        signature('{{client.name}}', 'Client'),
      ])), 'Buyer brief · {{client.name}}'),
      disclaimerPage(
        'This brief records the instructions you have given us. We will act on what is '
        + 'recorded here, so please review every entry before signing and tell us if '
        + 'anything changes.',
      ),
    ],
  });
}

function riskProfile(): SeedTemplate {
  beginTemplate('corporate', 'orchid', 'client_form');
  return make({
    slug: 'risk-profile-questionnaire',
    name: 'Risk Profile Questionnaire',
    description: 'Capacity, tolerance and time horizon — recorded and signed.',
    longDescription:
      'Three pages separating what a client can afford to lose from what they are '
      + 'comfortable losing. Records both, notes where they diverge, and is signed so the '
      + 'profile can be relied on later.',
    category: 'client_form', reportType: 'formara',
    industry: ['property', 'finance'], tags: ['risk', 'profile', 'intake', 'compliance'],
    pages: [
      withFurniture(page('Capacity', flow([
        brandMark(),
        heading('Your capacity for risk', 'What your position can absorb.', 62),
        rule(),
        definitions('Financial position', [
          { term: 'Household income', definition: '{{risk.income | currency}}' },
          { term: 'Surplus after commitments', definition: '{{risk.surplus | currency}}' },
          { term: 'Cash reserves', definition: '{{risk.reserves | currency}}' },
          { term: 'Existing debt', definition: '{{risk.debt | currency}}' },
          { term: 'Dependants', definition: '{{risk.dependants}}' },
          { term: 'Income stability', definition: '{{risk.incomeStability}}' },
        ]),
        callout('Capacity assessment', '{{risk.capacityAssessment}}', 'info', 72),
      ])), 'Risk profile · {{client.name}}'),
      withFurniture(page('Tolerance', flow([
        heading('Your tolerance for risk', 'What you are comfortable with, which is a different question.'),
        table(
          ['Question', 'Response'],
          [
            ['Investment time horizon', '{{risk.horizon}}'],
            ['Comfortable with negative cash flow', '{{risk.negativeCashFlow}}'],
            ['Reaction to a 20% value fall', '{{risk.valueFall}}'],
            ['Reaction to 3 months vacancy', '{{risk.vacancy}}'],
            ['Preference: growth or income', '{{risk.growthOrIncome}}'],
            ['Previous investment experience', '{{risk.experience}}'],
          ],
          [0.56, 0.44],
        ),
        scorecard('Assessed profile', [
          { category: 'Capacity', rating: 'Moderate', note: '{{risk.capacityNote}}' },
          { category: 'Tolerance', rating: 'Moderate', note: '{{risk.toleranceNote}}' },
          { category: 'Time horizon', rating: 'Strong', note: '{{risk.horizonNote}}' },
        ]),
        signature('{{client.name}}', 'Client'),
      ])), 'Risk profile · {{client.name}}'),
      disclaimerPage(
        'This questionnaire records your circumstances and preferences at the date '
        + 'signed. Tell us if they change — we rely on it when making recommendations.',
      ),
    ],
  });
}

function onboardingPack(): SeedTemplate {
  beginTemplate('luxury', 'orchid', 'client_form');
  return make({
    slug: 'client-onboarding-pack',
    name: 'Client Onboarding Pack',
    description: 'Engagement terms, fees, service standards and what we need from you.',
    longDescription:
      'Four pages issued at the start of an engagement. States the scope, the fees and '
      + 'when they fall due, the service standards the client can hold us to, and the '
      + 'documents needed before work begins.',
    category: 'client_form', reportType: 'formara',
    industry: ['property', 'finance'], tags: ['onboarding', 'engagement', 'fees', 'signature'],
    pages: [
      cover({
        eyebrow: 'Welcome', title: 'Client Onboarding',
        subtitle: 'Prepared for {{client.name}}', titleSize: 36,
      }),
      withFurniture(page('Engagement', flow([
        heading('What we will do'),
        processSteps('Scope of engagement', [
          { title: 'Brief', body: '{{engagement.scope.0}}' },
          { title: 'Search', body: '{{engagement.scope.1}}' },
          { title: 'Assess', body: '{{engagement.scope.2}}' },
          { title: 'Negotiate', body: '{{engagement.scope.3}}' },
          { title: 'Settle', body: '{{engagement.scope.4}}' },
        ]),
        definitions('Service standards', [
          { term: 'Response time', definition: '{{engagement.responseTime}}' },
          { term: 'Reporting', definition: '{{engagement.reporting}}' },
          { term: 'Point of contact', definition: '{{author.name}}' },
        ]),
      ])), 'Onboarding · {{client.name}}'),
      withFurniture(page('Fees', flow([
        heading('Fees'),
        table(
          ['Item', 'Basis', 'Amount', 'When payable'],
          [
            ['Engagement fee', '{{fees.0.basis}}', '{{fees.0.amount | currency}}', '{{fees.0.when}}'],
            ['Success fee', '{{fees.1.basis}}', '{{fees.1.amount | currency}}', '{{fees.1.when}}'],
            ['Disbursements', '{{fees.2.basis}}', '{{fees.2.amount | currency}}', '{{fees.2.when}}'],
          ],
          [0.24, 0.34, 0.2, 0.22],
        ),
        callout('What is not included', '{{fees.exclusions}}', 'warning', 76),
        checklist('What we need from you', [
          { action: '{{onboarding.needs.0.action}}', owner: '{{client.name}}', timing: '{{onboarding.needs.0.timing}}' },
          { action: '{{onboarding.needs.1.action}}', owner: '{{client.name}}', timing: '{{onboarding.needs.1.timing}}' },
          { action: '{{onboarding.needs.2.action}}', owner: '{{client.name}}', timing: '{{onboarding.needs.2.timing}}' },
        ]),
        signature('{{client.name}}', 'Client'),
      ])), 'Onboarding · {{client.name}}'),
      disclaimerPage(DISCLAIMER),
    ],
  });
}

function inspectionChecklist(): SeedTemplate {
  beginTemplate('technical', 'gold', 'client_form');
  return make({
    slug: 'property-inspection-checklist',
    name: 'Property Inspection Checklist',
    description: 'A structured record of one inspection, with a scored outcome.',
    longDescription:
      'Three pages to complete on site. Records condition room by room, notes defects '
      + 'with an indicative cost, scores the property against the brief, and ends with a '
      + 'proceed or pass recommendation while it is still fresh.',
    category: 'client_form', reportType: 'formara',
    industry: ['property'], tags: ['inspection', 'checklist', 'on-site', 'condition'],
    pages: [
      withFurniture(page('Inspection', flow([
        brandMark(),
        heading('{{property.address}}', 'Inspection record · {{inspection.date}}', 62),
        rule(),
        definitions('Inspection detail', [
          { term: 'Inspected by', definition: '{{author.name}}' },
          { term: 'Date and time', definition: '{{inspection.date}}' },
          { term: 'Weather', definition: '{{inspection.weather}}' },
          { term: 'Present', definition: '{{inspection.present}}' },
        ]),
        table(
          ['Area', 'Condition', 'Defects noted', 'Est. cost'],
          [
            ['Exterior and roof', '{{inspection.areas.0.condition}}', '{{inspection.areas.0.defects}}', '{{inspection.areas.0.cost | currency}}'],
            ['Kitchen', '{{inspection.areas.1.condition}}', '{{inspection.areas.1.defects}}', '{{inspection.areas.1.cost | currency}}'],
            ['Bathrooms', '{{inspection.areas.2.condition}}', '{{inspection.areas.2.defects}}', '{{inspection.areas.2.cost | currency}}'],
            ['Living areas', '{{inspection.areas.3.condition}}', '{{inspection.areas.3.defects}}', '{{inspection.areas.3.cost | currency}}'],
            ['Bedrooms', '{{inspection.areas.4.condition}}', '{{inspection.areas.4.defects}}', '{{inspection.areas.4.cost | currency}}'],
            ['Services', '{{inspection.areas.5.condition}}', '{{inspection.areas.5.defects}}', '{{inspection.areas.5.cost | currency}}'],
          ],
          [0.26, 0.2, 0.34, 0.2], 20,
        ),
      ])), 'Inspection · {{property.address}}'),
      withFurniture(page('Assessment', flow([
        heading('Against the brief'),
        scorecard('Scored on site', [
          { category: 'Location', rating: 'Moderate', note: '{{inspection.scores.locationNote}}' },
          { category: 'Condition', rating: 'Moderate', note: '{{inspection.scores.conditionNote}}' },
          { category: 'Layout', rating: 'Strong', note: '{{inspection.scores.layoutNote}}' },
          { category: 'Tenant appeal', rating: 'Moderate', note: '{{inspection.scores.appealNote}}' },
        ]),
        decision('{{inspection.recommendation.headline}}', '{{inspection.recommendation.body}}', 92),
        signature('{{author.name}}', '{{author.title}}'),
      ])), 'Inspection · {{property.address}}'),
      disclaimerPage(
        'This is a visual inspection record only. It is not a building or pest report and '
        + 'does not cover anything concealed, inaccessible or requiring specialist '
        + 'assessment. Obtain qualified reports before exchange.',
      ),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Compliance
// ═══════════════════════════════════════════════════════════════════════════

function amlKycRecord(): SeedTemplate {
  beginTemplate('corporate', 'bronze', 'compliance');
  return make({
    slug: 'aml-kyc-verification-record',
    name: 'AML/KYC Verification Record',
    description: 'Identity verified, source of funds established, risk rated and signed.',
    longDescription:
      'Four pages recording customer due diligence: identity evidence sighted, beneficial '
      + 'ownership where the customer is not an individual, source of funds, screening '
      + 'results and the resulting risk rating with the reason recorded.',
    category: 'compliance', reportType: null,
    industry: ['finance', 'legal'], tags: ['aml', 'kyc', 'identity', 'internal'], accessTier: 'premium',
    pages: [
      cover({
        eyebrow: 'Customer Due Diligence', title: 'AML/KYC Verification',
        subtitle: 'Record for {{client.name}}', footnote: 'INTERNAL',
      }),
      withFurniture(page('Identity', flow([
        heading('Identity verification'),
        table(
          ['Evidence', 'Type', 'Reference', 'Sighted', 'Verified'],
          [
            ['Primary photographic', '{{kyc.primary.type}}', '{{kyc.primary.ref}}', '{{kyc.primary.sighted}}', '{{kyc.primary.verified}}'],
            ['Secondary', '{{kyc.secondary.type}}', '{{kyc.secondary.ref}}', '{{kyc.secondary.sighted}}', '{{kyc.secondary.verified}}'],
            ['Address evidence', '{{kyc.address.type}}', '{{kyc.address.ref}}', '{{kyc.address.sighted}}', '{{kyc.address.verified}}'],
          ],
          [0.24, 0.2, 0.22, 0.17, 0.17],
        ),
        definitions('Beneficial ownership', [
          { term: 'Customer type', definition: '{{kyc.customerType}}' },
          { term: 'Beneficial owners identified', definition: '{{kyc.beneficialOwners}}' },
          { term: 'Ownership evidence', definition: '{{kyc.ownershipEvidence}}' },
          { term: 'Politically exposed person', definition: '{{kyc.pep}}' },
        ]),
      ])), 'AML/KYC · internal'),
      withFurniture(page('Funds and screening', flow([
        heading('Source of funds and screening'),
        definitions('Source of funds', [
          { term: 'Stated source', definition: '{{kyc.sourceOfFunds}}' },
          { term: 'Evidence obtained', definition: '{{kyc.fundsEvidence}}' },
          { term: 'Consistent with profile', definition: '{{kyc.fundsConsistent}}' },
        ]),
        table(
          ['Screening', 'Provider', 'Date', 'Result'],
          [
            ['Sanctions', '{{kyc.screening.0.provider}}', '{{kyc.screening.0.date}}', '{{kyc.screening.0.result}}'],
            ['PEP', '{{kyc.screening.1.provider}}', '{{kyc.screening.1.date}}', '{{kyc.screening.1.result}}'],
            ['Adverse media', '{{kyc.screening.2.provider}}', '{{kyc.screening.2.date}}', '{{kyc.screening.2.result}}'],
          ],
          [0.26, 0.26, 0.22, 0.26],
        ),
        scorecard('Risk rating', [
          { category: 'Customer risk', rating: 'Low', note: '{{kyc.risk.customerNote}}' },
          { category: 'Product risk', rating: 'Low', note: '{{kyc.risk.productNote}}' },
          { category: 'Geographic risk', rating: 'Low', note: '{{kyc.risk.geoNote}}' },
          { category: 'Overall', rating: 'Low', note: '{{kyc.risk.overallNote}}' },
        ]),
        signature('{{kyc.verifier}}', 'Verifying officer'),
      ])), 'AML/KYC · internal'),
      disclaimerPage(
        'This is an internal customer due diligence record maintained under the '
        + 'organisation\'s AML/CTF programme. It contains personal information and must '
        + 'not be disclosed outside the organisation except as required by law.',
      ),
    ],
  });
}

function adviceRecord(): SeedTemplate {
  beginTemplate('corporate', 'bronze', 'compliance');
  return make({
    slug: 'advice-record-and-disclosure',
    name: 'Advice Record & Disclosure',
    description: 'What was advised, on what basis, and what was disclosed.',
    longDescription:
      'Four pages recording a piece of advice so it can be defended later: the client\'s '
      + 'stated circumstances, the recommendation, the reasoning, the alternatives '
      + 'considered, and every conflict and fee disclosed at the time.',
    category: 'compliance', reportType: null,
    industry: ['finance', 'legal'], tags: ['advice', 'disclosure', 'conflicts', 'internal'], accessTier: 'premium',
    pages: [
      cover({
        eyebrow: 'Advice Record', title: 'Advice & Disclosure',
        subtitle: '{{client.name}} · {{advice.date}}', footnote: 'INTERNAL',
      }),
      withFurniture(page('Basis', flow([
        heading('Basis of advice', 'What we were told, and what we relied on.'),
        definitions('Client circumstances relied on', [
          { term: 'Objectives', definition: '{{advice.objectives}}' },
          { term: 'Financial situation', definition: '{{advice.financialSituation}}' },
          { term: 'Needs', definition: '{{advice.needs}}' },
          { term: 'Risk profile', definition: '{{advice.riskProfile}}' },
          { term: 'Information not provided', definition: '{{advice.gaps}}' },
        ]),
        callout('Scope limitation', '{{advice.scopeLimitation}}', 'warning', 76),
      ])), 'Advice record · internal'),
      withFurniture(page('Advice', flow([
        heading('The advice given'),
        decision('{{advice.recommendation}}', '{{advice.reasoning}}', 104),
        table(
          ['Alternative considered', 'Why not recommended'],
          [
            ['{{advice.alternatives.0.option}}', '{{advice.alternatives.0.reason}}'],
            ['{{advice.alternatives.1.option}}', '{{advice.alternatives.1.reason}}'],
            ['{{advice.alternatives.2.option}}', '{{advice.alternatives.2.reason}}'],
          ],
          [0.4, 0.6],
        ),
      ])), 'Advice record · internal'),
      withFurniture(page('Disclosure', flow([
        heading('Disclosures made'),
        table(
          ['Disclosure', 'Detail', 'Made on', 'Acknowledged'],
          [
            ['Fees payable', '{{advice.disclosures.0.detail}}', '{{advice.disclosures.0.date}}', '{{advice.disclosures.0.ack}}'],
            ['Referral arrangement', '{{advice.disclosures.1.detail}}', '{{advice.disclosures.1.date}}', '{{advice.disclosures.1.ack}}'],
            ['Conflict of interest', '{{advice.disclosures.2.detail}}', '{{advice.disclosures.2.date}}', '{{advice.disclosures.2.ack}}'],
            ['Licensing', '{{advice.disclosures.3.detail}}', '{{advice.disclosures.3.date}}', '{{advice.disclosures.3.ack}}'],
          ],
          [0.24, 0.38, 0.18, 0.2],
        ),
        signature('{{author.name}}', '{{author.title}}'),
      ])), 'Advice record · internal'),
      disclaimerPage(
        'This is an internal advice record maintained for supervision, monitoring and '
        + 'regulatory purposes. It is not itself advice to the client.',
      ),
    ],
  });
}

function complianceAttestation(): SeedTemplate {
  beginTemplate('corporate', 'bronze', 'compliance');
  return make({
    slug: 'annual-compliance-attestation',
    name: 'Annual Compliance Attestation',
    description: 'Obligations, evidence, exceptions and a signed attestation.',
    longDescription:
      'Three pages attesting compliance for a period. Lists each obligation with the '
      + 'evidence relied on, records exceptions honestly rather than omitting them, and '
      + 'is signed by the responsible officer.',
    category: 'compliance', reportType: null,
    industry: ['finance', 'legal', 'general'], tags: ['attestation', 'annual', 'governance', 'internal'],
    pages: [
      withFurniture(page('Attestation', flow([
        brandMark(),
        heading('Annual compliance attestation', 'Period {{attestation.period}}', 62),
        rule(),
        kpis([
          { label: 'Obligations', value: '{{attestation.obligationCount}}' },
          { label: 'Compliant', value: '{{attestation.compliantCount}}' },
          { label: 'Exceptions', value: '{{attestation.exceptionCount}}' },
          { label: 'Overdue actions', value: '{{attestation.overdueCount}}' },
        ]),
        table(
          ['Obligation', 'Evidence relied on', 'Status'],
          [
            ['{{attestation.items.0.obligation}}', '{{attestation.items.0.evidence}}', '{{attestation.items.0.status}}'],
            ['{{attestation.items.1.obligation}}', '{{attestation.items.1.evidence}}', '{{attestation.items.1.status}}'],
            ['{{attestation.items.2.obligation}}', '{{attestation.items.2.evidence}}', '{{attestation.items.2.status}}'],
            ['{{attestation.items.3.obligation}}', '{{attestation.items.3.evidence}}', '{{attestation.items.3.status}}'],
            ['{{attestation.items.4.obligation}}', '{{attestation.items.4.evidence}}', '{{attestation.items.4.status}}'],
            ['{{attestation.items.5.obligation}}', '{{attestation.items.5.evidence}}', '{{attestation.items.5.status}}'],
          ],
          [0.36, 0.4, 0.24], 20,
        ),
      ])), 'Attestation {{attestation.period}} · internal'),
      withFurniture(page('Exceptions', flow([
        heading('Exceptions', 'Recorded, not omitted.'),
        riskRegister('Exceptions and remediation', [
          { risk: '{{attestation.exceptions.0.item}}', rating: 'Medium', confidence: 'Verified', why: '{{attestation.exceptions.0.why}}', ddAction: '{{attestation.exceptions.0.action}}' },
          { risk: '{{attestation.exceptions.1.item}}', rating: 'Low', confidence: 'Verified', why: '{{attestation.exceptions.1.why}}', ddAction: '{{attestation.exceptions.1.action}}' },
        ]),
        callout('Attestation', '{{attestation.statement}}', 'info', 88),
        signature('{{attestation.officer}}', 'Responsible officer'),
      ])), 'Attestation {{attestation.period}} · internal'),
      disclaimerPage(
        'This attestation is an internal governance record. It reflects the position at '
        + 'the date signed based on the evidence listed.',
      ),
    ],
  });
}

function complaintsRegister(): SeedTemplate {
  beginTemplate('minimal', 'bronze', 'compliance');
  return make({
    slug: 'complaints-register-report',
    name: 'Complaints Register Report',
    description: 'Complaints received, resolved, outstanding — and what caused them.',
    longDescription:
      'Three pages summarising complaints for a period. Reports volume and resolution '
      + 'time, but spends most of its space on root cause, because the count matters far '
      + 'less than what keeps producing it.',
    category: 'compliance', reportType: null,
    industry: ['finance', 'legal', 'general'], tags: ['complaints', 'root-cause', 'internal'],
    pages: [
      withFurniture(page('Summary', flow([
        brandMark(),
        heading('Complaints register', 'Period {{complaints.period}}', 62),
        rule(),
        kpis([
          { label: 'Received', value: '{{complaints.received}}' },
          { label: 'Resolved', value: '{{complaints.resolved}}' },
          { label: 'Outstanding', value: '{{complaints.outstanding}}' },
          { label: 'Avg days to resolve', value: '{{complaints.avgDays}}' },
        ]),
        table(
          ['Ref', 'Received', 'Category', 'Status', 'Days open'],
          [
            ['{{complaints.items.0.ref}}', '{{complaints.items.0.received}}', '{{complaints.items.0.category}}', '{{complaints.items.0.status}}', '{{complaints.items.0.days}}'],
            ['{{complaints.items.1.ref}}', '{{complaints.items.1.received}}', '{{complaints.items.1.category}}', '{{complaints.items.1.status}}', '{{complaints.items.1.days}}'],
            ['{{complaints.items.2.ref}}', '{{complaints.items.2.received}}', '{{complaints.items.2.category}}', '{{complaints.items.2.status}}', '{{complaints.items.2.days}}'],
            ['{{complaints.items.3.ref}}', '{{complaints.items.3.received}}', '{{complaints.items.3.category}}', '{{complaints.items.3.status}}', '{{complaints.items.3.days}}'],
          ],
          [0.16, 0.2, 0.26, 0.2, 0.18],
        ),
      ])), 'Complaints {{complaints.period}} · internal'),
      withFurniture(page('Root cause', flow([
        heading('Root cause', 'The count matters less than what keeps producing it.'),
        donutChart({
          title: 'Complaints by category', dataPath: 'complaints.categorySeries',
          data: [{ label: 'Service', value: 0 }, { label: 'Fees', value: 0 }, { label: 'Advice', value: 0 }, { label: 'Other', value: 0 }],
          height: 186,
        }),
        riskRegister('Systemic issues identified', [
          { risk: '{{complaints.systemic.0.issue}}', rating: 'Medium', confidence: 'Verified', why: '{{complaints.systemic.0.why}}', ddAction: '{{complaints.systemic.0.action}}' },
          { risk: '{{complaints.systemic.1.issue}}', rating: 'Low', confidence: 'Indicative', why: '{{complaints.systemic.1.why}}', ddAction: '{{complaints.systemic.1.action}}' },
        ]),
      ])), 'Complaints {{complaints.period}} · internal'),
      disclaimerPage(
        'This register is an internal governance record. Individual complaint detail is '
        + 'held separately and is subject to privacy obligations.',
      ),
    ],
  });
}

export const EXTENDED_TEMPLATES: SeedTemplate[] = [
  // Investment
  offMarketBrief(),
  renovationUplift(),
  firstHomeBuyer(),
  smsfAssessment(),
  commercialAssessment(),
  developmentFeasibility(),
  portfolioReview(),
  // Suburb
  marketBrief({
    slug: 'suburb-executive-brief', name: 'Suburb Executive Brief',
    description: 'Two pages on a suburb: the numbers, the read, the conclusion.',
    longDescription:
      'A condensed suburb study for a reader who wants the position without the research '
      + 'trail. Headline metrics and a written read on page one, the supporting evidence '
      + 'and a conclusion on page two.',
    category: 'suburb', reportType: 'suburb', subject: '{{property.suburb}}', accent: 'amethyst', tags: ['concise', 'market', 'decision'],
  }),
  suburbGrowthDrivers(),
  suburbRentalMarket(),
  // Postcode
  marketBrief({
    slug: 'postcode-executive-brief', name: 'Postcode Executive Brief',
    description: 'Two pages on a postcode: the numbers, the read, the conclusion.',
    longDescription:
      'The zone-level equivalent of the suburb brief. Aggregate metrics for the postcode '
      + 'with a written read, then the evidence and a conclusion.',
    category: 'postcode', reportType: 'postcode', subject: 'Postcode {{market.postcode}}', accent: 'amethyst', tags: ['zone', 'concise', 'market'],
  }),
  marketSnapshot({
    slug: 'postcode-snapshot', name: 'Postcode Snapshot',
    description: 'One page: four postcode metrics, a price chart and a short read.',
    longDescription:
      'A single page to answer whether a postcode deserves a closer look. Four metrics, '
      + 'a five-year price series and one paragraph.',
    category: 'postcode', reportType: 'postcode', subject: 'Postcode {{market.postcode}}', accent: 'amethyst', tags: ['quick', 'one-page', 'zone'],
  }),
  // Statewide
  marketBrief({
    slug: 'statewide-executive-brief', name: 'Statewide Executive Brief',
    description: 'Two pages on a state market: the numbers, the read, the conclusion.',
    longDescription:
      'A condensed state-level market brief for readers deciding whether to look further '
      + 'at a state before commissioning a full review.',
    category: 'statewide', reportType: 'statewide', subject: '{{market.state}} Market', accent: 'amethyst', tags: ['macro', 'concise', 'market'],
  }),
  marketSnapshot({
    slug: 'statewide-snapshot', name: 'Statewide Snapshot',
    description: 'One page: four state metrics, a price chart and a short read.',
    longDescription:
      'A single page of state-level market position — the fastest way to see whether a '
      + 'state is worth a closer look.',
    category: 'statewide', reportType: 'statewide', subject: '{{market.state}}', accent: 'amethyst', tags: ['quick', 'one-page', 'macro'],
  }),
  // Comparison
  headToHead(),
  buyVsHold(),
  portfolioComparison(),
  // Cash flow
  cashFlowSnapshot(),
  negativeGearing(),
  equityPosition(),
  // Client forms
  buyerBrief(),
  riskProfile(),
  onboardingPack(),
  inspectionChecklist(),
  // Compliance
  amlKycRecord(),
  adviceRecord(),
  complianceAttestation(),
  complaintsRegister(),
];

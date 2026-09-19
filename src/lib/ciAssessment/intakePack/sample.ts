/**
 * The worked example.
 *
 * A blank pack tells you what is being asked. It does not tell you how much
 * detail an answer needs, what "beneficial ownership" is supposed to look like
 * written down, or that the entity named against a portfolio property has to
 * match the entity on the Ownership sheet exactly. Those are the things people
 * get wrong, and they get them wrong in a client meeting where there is no time
 * to go back and ask.
 *
 * So this file holds one complete, coherent deal — a two-tenant industrial
 * facility bought by a trust with a related operating company guaranteeing —
 * and everything demonstrative is generated from it: the filled workbook, the
 * filled interview guide, and the reference viewer in the app.
 *
 * Three properties are deliberate:
 *
 *  - **It is a payload, not a document.** The filled files are produced by the
 *    ordinary generators with this payload passed in, so the example cannot
 *    drift from the template — there is only one template.
 *  - **It is arithmetically real.** The figures close: funding balances,
 *    ownership totals 100%, the add-backs reconcile to the periods they name.
 *    A test parses the generated workbook back and compares it to this payload,
 *    so an example that stopped being true would fail the build.
 *  - **It is obviously fictional.** Names, ABNs and addresses are invented, and
 *    every generated artefact says so on its face. A demonstration file that
 *    could be mistaken for a real client's is a file that ends up on a real
 *    client's record.
 */

import {
  emptyAssessmentPayload, type AssessmentPayload,
} from '../types';
import type { PackDetails, ProceedAnswers } from './workbook';

/** Shown wherever the example is offered, so nobody has to open it to know. */
export const SAMPLE_SUMMARY = {
  headline: 'Two-tenant industrial facility, $5.85m, bought by a family trust',
  detail: 'A worked example with every sheet filled in — a trust borrower with a corporate '
    + 'trustee, a related operating company guaranteeing, two existing properties, two '
    + 'financial periods with confirmed add-backs, and two tenancies.',
} as const;

export const SAMPLE_DETAILS: PackDetails = {
  clientName: 'Asteron Industrial Holdings Pty Ltd ATF Asteron Industrial Property Trust',
  propertyDescription: '88 Foundry Link, Truganina VIC 3029',
  reference: 'EXAMPLE-CI-2026-001',
  adviser: 'Maya Collins',
  interviewDate: '30/07/2026',
  completedDate: '31/07/2026',
};

/**
 * The example assessment.
 *
 * Built from `emptyAssessmentPayload` and then overwritten field by field, so a
 * field added to the payload type arrives here with its real default rather
 * than as `undefined`.
 */
export function sampleAssessment(): AssessmentPayload {
  const payload = emptyAssessmentPayload('industrial_investment');

  payload.property = {
    ...payload.property,
    address: '88 Foundry Link',
    suburb: 'Truganina',
    state: 'VIC',
    postcode: '3029',
    classification: 'industrial',
    assetClass: 'warehouse',
    purchasePrice: 5_850_000,
    currentValuation: 5_950_000,
    valuationDate: '2026-07-18',
    valuationSource: 'Southern Cross Valuations Pty Ltd (fictional)',
    valuationConfidence: 'high',
    contractDate: '2026-07-22',
    settlementDate: '2026-09-30',
    gstTreatment: 'going_concern',
    goingConcern: true,
    lettableAreaSqm: 3_240,
    siteAreaSqm: 5_480,
    stampDuty: 380_250,
    legalCosts: 18_500,
    valuationCosts: 7_500,
    lenderFees: 22_000,
    fitOut: 85_000,
    plantAndEquipment: 0,
    repairs: 35_000,
    immediateCapex: 120_000,
    contingency: 50_000,
    depositOrContribution: 2_493_250,
    refinanceAmount: 0,
    proposedEquityRelease: 0,
  };

  // A trust with a corporate trustee, plus the operating company as guarantor.
  // The company holds 0% of the property but guarantees the facility — which is
  // exactly the shape people leave off a fact-find and exactly the shape that
  // changes the assessment.
  payload.ownership = {
    entities: [
      {
        id: 'sample-entity-trust',
        entityName: 'Asteron Industrial Holdings Pty Ltd ATF Asteron Industrial Property Trust',
        structure: 'trust',
        abnAcn: '25 689 472 311 / ACN 689 472 311',
        ownershipPercent: 100,
        directors: 'Olivia Bennett; Daniel Wu',
        trustees: 'Asteron Industrial Holdings Pty Ltd (corporate trustee)',
        beneficiaries: 'Bennett Family Trust (60%); Wu Family Trust (40%)',
        isGuarantor: true,
        relatedEntities: 'Asteron Distribution Services Pty Ltd',
        yearsTrading: 6,
        industry: 'Industrial property investment',
        borrowerExperience: 'experienced',
        residency: 'australian',
        taxResidency: 'australian',
        beneficialOwnership: 'Olivia Bennett (60%) and Daniel Wu (40%) through their respective '
          + 'family trusts. No other party holds more than 25% or exercises control.',
      },
      {
        id: 'sample-entity-opco',
        entityName: 'Asteron Distribution Services Pty Ltd',
        structure: 'company',
        abnAcn: '69 731 845 622 / ACN 731 845 622',
        ownershipPercent: 0,
        directors: 'Olivia Bennett; Daniel Wu',
        trustees: 'Not applicable',
        beneficiaries: 'Not applicable',
        isGuarantor: true,
        relatedEntities: 'Asteron Industrial Property Trust',
        yearsTrading: 11,
        industry: 'Third-party logistics and warehousing',
        borrowerExperience: 'experienced',
        residency: 'australian',
        taxResidency: 'australian',
        beneficialOwnership: 'Olivia Bennett (60%); Daniel Wu (40%).',
      },
    ],
    borrowingPurpose: 'Acquire a fully leased multi-tenanted industrial logistics facility as a '
      + 'long-term investment held by the family trust, with the related operating company taking '
      + 'part of the space under an arm\'s-length lease.',
    purposeIsPredominantlyBusiness: true,
    naturalPersonBorrower: false,
    residentialSecurityInvolved: false,
  };

  payload.income = {
    periods: [
      {
        id: 'sample-period-fy2025',
        label: 'FY2025',
        periodEnd: '2025-06-30',
        basis: 'financial_statements',
        verification: 'verified',
        salaryWages: 0,
        businessRevenue: 8_950_000,
        ebitda: 1_145_000,
        ebit: 960_000,
        npat: 612_000,
        depreciation: 185_000,
        interestExpense: 98_000,
        directorRemuneration: 240_000,
        distributions: 0,
        rentReceived: 120_000,
        dividends: 156_000,
        otherRecurringIncome: 45_000,
        nonRecurringIncome: 35_000,
      },
      {
        id: 'sample-period-fy2024',
        label: 'FY2024',
        periodEnd: '2024-06-30',
        basis: 'financial_statements',
        verification: 'verified',
        salaryWages: 0,
        businessRevenue: 8_100_000,
        ebitda: 975_000,
        ebit: 805_000,
        npat: 488_000,
        depreciation: 170_000,
        interestExpense: 112_000,
        directorRemuneration: 220_000,
        distributions: 0,
        rentReceived: 80_000,
        dividends: 150_000,
        otherRecurringIncome: 38_000,
        nonRecurringIncome: 0,
      },
    ],
    addbacks: [
      {
        id: 'sample-addback-1',
        periodId: 'sample-period-fy2025',
        category: 'director_remuneration',
        amount: 80_000,
        reason: 'Discretionary remuneration above the documented market replacement salary for the '
          + 'role. The directors have confirmed in writing that it will be reduced to market on '
          + 'settlement.',
        source: 'FY2025 financial statements; accountant add-back letter dated 12/07/2026',
        confirmed: true,
        confirmedBy: 'Maya Collins',
        confirmedAt: '2026-07-28T00:00:00.000Z',
      },
      {
        id: 'sample-addback-2',
        periodId: 'sample-period-fy2025',
        category: 'one_off',
        amount: 35_000,
        reason: 'Non-recurring warehouse relocation and systems implementation costs incurred once '
          + 'on consolidating two sites.',
        source: 'FY2025 general ledger extract; accountant confirmation dated 12/07/2026',
        confirmed: true,
        confirmedBy: 'Maya Collins',
        confirmedAt: '2026-07-28T00:00:00.000Z',
      },
      {
        id: 'sample-addback-3',
        periodId: 'sample-period-fy2024',
        category: 'director_remuneration',
        amount: 70_000,
        reason: 'Discretionary remuneration above the documented market replacement salary, on the '
          + 'same basis as FY2025.',
        source: 'FY2024 financial statements; accountant add-back letter dated 12/07/2026',
        confirmed: true,
        confirmedBy: 'Maya Collins',
        confirmedAt: '2026-07-28T00:00:00.000Z',
      },
    ],
    assessableIncomeBasis: 'weighted',
    otherIncomeNotes: 'Dividends are paid from the operating company to the trust and are '
      + 'recurring, but they are not contracted — treat with the usual caution.',
  };

  // Both existing properties are held by the same trust that is borrowing, which
  // is what makes this a group position rather than a standalone deal.
  payload.portfolio = {
    assets: [
      {
        id: 'sample-asset-1',
        address: '45 Commerce Crescent, Derrimut VIC 3026',
        ownershipEntity: 'Asteron Industrial Holdings Pty Ltd ATF Asteron Industrial Property Trust',
        ownershipPercent: 100,
        assetType: 'industrial',
        currentValue: 2_850_000,
        valuationDate: '2026-03-14',
        existingLender: 'National Australia Bank',
        currentBalance: 1_550_000,
        facilityLimit: 1_650_000,
        interestRate: 6.45,
        repaymentType: 'principalAndInterest',
        remainingTermYears: 16,
        annualRepayments: null,
        annualRent: 192_000,
        leaseExpiry: '2029-08-31',
        vacancyPercent: 3,
        outgoings: 8_000,
        managementCosts: 7_680,
        rates: 12_000,
        insurance: 9_000,
        maintenance: 0,
        capitalExpenditure: 0,
        crossCollateralised: false,
        clientPropertyId: null,
      },
      {
        id: 'sample-asset-2',
        address: '9 Market Lane, Sunshine West VIC 3020',
        ownershipEntity: 'Asteron Industrial Holdings Pty Ltd ATF Asteron Industrial Property Trust',
        ownershipPercent: 100,
        assetType: 'commercial',
        currentValue: 1_650_000,
        valuationDate: '2026-03-14',
        existingLender: 'Commonwealth Bank of Australia',
        currentBalance: 690_000,
        facilityLimit: 750_000,
        interestRate: 6.65,
        repaymentType: 'interestOnly',
        remainingTermYears: 3,
        annualRepayments: 45_885,
        annualRent: 121_000,
        leaseExpiry: '2028-06-30',
        vacancyPercent: 4,
        outgoings: 6_000,
        managementCosts: 4_840,
        rates: 7_000,
        insurance: 5_000,
        maintenance: 0,
        capitalExpenditure: 0,
        crossCollateralised: false,
        clientPropertyId: null,
      },
    ],
    liabilities: [
      {
        id: 'sample-liability-1',
        description: 'Jungheinrich forklift and materials-handling fleet',
        liabilityType: 'equipment_finance',
        ownershipEntity: 'Asteron Distribution Services Pty Ltd',
        lender: 'Westpac Equipment Finance',
        balance: 285_000,
        limit: 320_000,
        interestRate: 7.75,
        repaymentType: 'principalAndInterest',
        remainingTermYears: 4,
        annualRepayments: 84_000,
        isContingent: false,
        securedAgainstAssetId: null,
        clientLiabilityId: null,
      },
      {
        id: 'sample-liability-2',
        description: 'Corporate purchasing credit card',
        liabilityType: 'credit_card',
        ownershipEntity: 'Asteron Distribution Services Pty Ltd',
        lender: 'American Express',
        balance: 18_400,
        limit: 50_000,
        interestRate: 19.99,
        repaymentType: 'principalAndInterest',
        remainingTermYears: 1,
        annualRepayments: null,
        isContingent: false,
        securedAgainstAssetId: null,
        clientLiabilityId: null,
      },
    ],
    relatedEntityDebtSharePercent: 100,
  };

  payload.lease = {
    ...payload.lease,
    tenancies: [
      {
        id: 'sample-tenancy-1',
        tenantName: 'Atlas Cold Chain Pty Ltd',
        areaSqm: 1_800,
        annualRent: 255_000,
        leaseCommencement: '2023-10-01',
        leaseExpiry: '2030-09-30',
        optionsYears: 5,
        annualEscalationPercent: 3.25,
        tenantQuality: 'national',
        verification: 'verified',
      },
      {
        id: 'sample-tenancy-2',
        tenantName: 'Nova Equipment Services Pty Ltd',
        areaSqm: 1_440,
        annualRent: 168_000,
        leaseCommencement: '2025-03-01',
        leaseExpiry: '2029-02-28',
        optionsYears: 3,
        annualEscalationPercent: 3,
        tenantQuality: 'established_sme',
        verification: 'verified',
      },
    ],
    leaseBasis: 'net',
    recoverableOutgoings: 92_000,
    nonRecoverableOutgoings: 18_500,
    vacancyAllowancePercent: 3,
    managementAllowancePercent: 2,
    marketRentAnnual: 445_000,
    rentFreeMonths: 0,
  };

  payload.loan = {
    ...payload.loan,
    requestedLoan: 4_095_000,
    actualRatePercent: 6.85,
    repaymentType: 'interestOnly',
    interestOnlyPeriodYears: 3,
    loanTermYears: 5,
    amortisationYears: 20,
    residualBalloonAmount: 0,
    establishmentFees: 20_000,
    annualFees: 1_800,
    lenderPolicyProfile: 'mainstreamCommercialBank',
  };

  payload.internalNotes = 'Worked example. Fictional data for reference only.';

  return payload;
}

/** Answers for the Next steps sheet and the guide's closing section. */
export const SAMPLE_PROCEED: ProceedAnswers = {
  answers: {
    'proceed.decision': 'Yes',
    'proceed.timeframe': 'Settlement required by 30/09/2026; credit approval needed by 22/08/2026.',
    'proceed.lenders': 'Indicative discussions only with their existing bank. No formal application lodged.',
    'proceed.adviser': 'No external broker. Accountant is Harborline Advisory (fictional).',
    'proceed.concerns': 'Confirm the valuation and the reliance on the related-party lease; '
      + 'establish whether the equipment facility can stay where it is.',
    'proceed.contact': 'Olivia Bennett — 0400 000 000 — olivia.bennett@example.com',
  },
  documents: {
    'doc.contract': { held: 'Yes', received: '23/07/2026' },
    'doc.leases': { held: 'Yes', received: '24/07/2026' },
    'doc.financials': { held: 'Yes', received: '25/07/2026' },
    'doc.noa': { held: 'Yes', received: '25/07/2026' },
    'doc.trustDeed': { held: 'Yes', received: '26/07/2026' },
    'doc.constitution': { held: 'Yes', received: '26/07/2026' },
    'doc.rates': { held: 'Yes', received: '27/07/2026' },
    'doc.loanStatements': { held: 'Yes', received: '27/07/2026' },
    'doc.identification': { held: 'Yes', received: '28/07/2026' },
    'doc.planning': { held: 'N/A', received: 'No development or change of use proposed.' },
    'doc.atoPortal': { held: 'Yes', received: '29/07/2026' },
  },
  signOff: {
    'signoff.clientName': 'Olivia Bennett',
    'signoff.capacity': 'Director of the corporate trustee',
    'signoff.signature': 'Signed — fictional example',
    'signoff.date': '31/07/2026',
    'signoff.completedBy': 'Maya Collins',
    'signoff.adviserSignature': 'Signed — fictional example',
    'signoff.adviserDate': '31/07/2026',
  },
};

/**
 * Why an answer is written the way it is.
 *
 * Keyed by field key. These are the notes that turn an example from "here is
 * some data" into "here is what good looks like" — so they are written only
 * where the answer format is genuinely non-obvious, not on every field.
 */
export const SAMPLE_NOTES: Readonly<Record<string, string>> = {
  'property.currentValuation': 'Recorded even though it exceeds the price. Lending is struck '
    + 'against the lower of the two, so both figures have to be here for the check to mean anything.',
  'property.depositOrContribution': 'Set so the funding closes exactly: price plus all costs, '
    + 'less the loan. If this is a guess, the Summary sheet will show a shortfall.',
  'property.contingency': 'A contingency is a cost, not a buffer held back. It has to be funded '
    + 'like any other line or the funding does not close.',
  'entity.name': 'The full legal name as it will appear on the contract — trustee company *and* '
    + 'the trust it acts for. "Asteron Industrial Holdings Pty Ltd" alone is a different borrower.',
  'entity.structure': 'Trust, not Company. The trustee being a company does not make the borrower '
    + 'a company, and the assessment treats the two differently.',
  'entity.ownershipPercent': 'The operating company is at 0% — it guarantees but holds nothing. '
    + 'Shares must total 100% across the parties that actually hold the asset.',
  'entity.beneficialOwnership': 'Written out in full, naming who controls what. "As per trust '
    + 'deed" is the answer that comes back from AML asking for it again.',
  'entity.isGuarantor': 'Yes for both — the guarantee is what brings the operating company\'s '
    + 'earnings into the picture at all.',
  'period.label': 'Use the same label everywhere. The add-back sheet and the Summary both find '
    + 'the period by this exact text, so "FY2025" and "2025" are two different periods.',
  'period.ebitda': 'Left as reported. Adjustments belong on the add-back sheet where they carry '
    + 'a reason and a source, not folded silently into this figure.',
  'period.nonRecurringIncome': 'Recorded honestly even though default policy shades it to nil. '
    + 'Hiding it does not improve the outcome and does undermine the file.',
  'addback.reason': 'Specific, and it says what will change and when. "Directors\' wages too high" '
    + 'is not a reason a credit officer can act on.',
  'addback.source': 'Names the document and its date. An add-back with no source is excluded from '
    + 'income no matter how reasonable it sounds.',
  'addback.confirmed': 'Yes only once it has actually been checked against the source. This is the '
    + 'switch that lets the amount count.',
  'asset.ownershipEntity': 'Character-for-character the same name as on the Ownership sheet. A '
    + 'near-miss here is what turns one group position into two unrelated ones.',
  'asset.annualRepayments': 'Left blank on the first property so the workbook derives it from '
    + 'balance, rate and term; filled on the second because it is interest-only and known.',
  'liability.limit': 'The card is recorded at its $50,000 limit, not its $18,400 balance. That is '
    + 'how it will be assessed, so that is how it should be captured.',
  'liability.ownershipEntity': 'Held by the operating company, not the trust. Naming the wrong '
    + 'entity moves the debt onto the wrong balance sheet.',
  'tenancy.annualRent': 'Gross rent as the lease is written. Vacancy and management allowances are '
    + 'applied once, on the Lease terms sheet — not netted off here as well.',
  'tenancy.tenantQuality': 'Honest rather than flattering. A related-party tenant recorded as '
    + '"National tenant" is the kind of thing that unravels at credit.',
  'lease.nonRecoverableOutgoings': 'What the landlord actually absorbs under a net lease. This '
    + 'comes straight off net rent in the Summary.',
  'loan.repaymentType': 'Interest only for the first three years, on a five-year facility that '
    + 'amortises over twenty. All three numbers matter and they are all recorded.',
};

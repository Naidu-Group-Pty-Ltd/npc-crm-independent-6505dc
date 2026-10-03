/**
 * A `generate-portfolio-analysis` answer — a FIXTURE, not anybody's data.
 *
 * Every field the analysis dialog's on-screen preview reads is present, in the
 * shape the function answers it, so the dialog can be opened and exported in a
 * test without a model call. The client, the addresses and the figures are
 * invented.
 */
export const FIXTURE_CLIENT_ID = '0f6a3f0e-2f4b-4c39-9a51-6f3f1b2c9d11';

const P1 = '1 Example Street, Sampleton QLD 4000';
const P2 = '2/14 Specimen Road, Testvale NSW 2000';

export const portfolioAnalysisResponse = {
  success: true,
  clientId: FIXTURE_CLIENT_ID,
  clientName: 'Avery Sample',
  portfolioMetrics: {
    totalProperties: 2,
    investmentCount: 2,
    ownerOccupiedCount: 0,
    smsfCount: 0,
    totalValue: 1_250_000,
    totalDebt: 820_000,
    totalEquity: 430_000,
    averageLVR: 65.6,
    totalMonthlyRentalIncome: 4_680,
    totalMonthlyExpenses: 4_150,
    netMonthlyCashflow: 530,
    averageYield: 4.5,
    smsfTotalValue: 0,
    smsfTotalEquity: 0,
    smsfCompliantCount: 0,
    smsfPendingAuditCount: 0,
    smsfNonCompliantCount: 0,
  },
  propertyAnalyses: [
    {
      propertyNumber: 1, address: P1, propertyType: 'investment', value: 640_000, equity: 240_000,
      lvr: '62.5', grossYield: '4.9', netMonthlyCashflow: 410, portfolioContribution: '51.2',
    },
    {
      propertyNumber: 2, address: P2, propertyType: 'investment', value: 610_000, equity: 190_000,
      lvr: '68.9', grossYield: '4.1', netMonthlyCashflow: 120, portfolioContribution: '48.8',
    },
  ],
  analysis: {
    personalizedNarrative: {
      openingStatement: 'Dear Avery, this analysis looks at the two investment properties you hold today.',
      portfolioJourney: 'You bought the Sampleton house first and the Testvale unit three years later.',
    },
    executiveSummary: {
      overallHealth: 'Good',
      healthScore: 78,
      keyStrengths: ['Both properties return a positive monthly cash flow.'],
      keyConcerns: ['Both loans are variable, so the portfolio moves with the cash rate.'],
      primaryRecommendation: 'Hold both properties and review the Testvale loan before its fixed period ends.',
    },
    compositionAnalysis: {
      assetAllocation: 'Two residential investments across two states.',
      diversificationScore: 6,
      propertyMixAssessment: 'A house and a unit, in different markets.',
      recommendations: ['Keep the next purchase outside both current markets.'],
    },
    propertyStrategicContext: [
      {
        address: P1,
        strategicRole: 'The growth asset.',
        capitalGrowthAnalysis: 'Land content carries most of its value.',
        individualOutlook: 'Steady.',
      },
    ],
    financialHealth: {
      cashflowStatus: 'Positive',
      equityPosition: 'Moderate',
      debtServiceability: 'Comfortable',
      lvrRisk: 'Moderate',
      analysis: 'Rent covers the outgoings on both properties with $530 a month to spare.',
    },
    propertyRankings: [
      {
        rank: 1, address: P1, performanceRating: 'Good',
        strengths: ['Yield above the portfolio average.'], concerns: ['Older roof.'],
        recommendation: 'Hold.',
      },
      {
        rank: 2, address: P2, performanceRating: 'Fair',
        strengths: ['Low vacancy.'], concerns: ['Strata levies rising.'],
        recommendation: 'Hold and review the levies.',
      },
    ],
    riskAssessment: {
      overallRiskLevel: 'Medium',
      concentrationRisk: 'Two properties.',
      interestRateSensitivity: 'Both loans are variable.',
      vacancyRisk: 'Low in both markets.',
      marketRisks: ['A rate rise would narrow the monthly surplus.'],
      mitigationStrategies: ['Keep three months of outgoings in an offset account.'],
    },
    interestRateSensitivity: {
      investmentProperties: {
        currentMonthlyCashflow: 530,
        plusOnePercentImpact: -683,
        plusTwoPercentImpact: -1_367,
        available: true,
        unavailableReason: null,
        unavailableExplanation: null,
        loansCovered: 2,
        balanceCovered: 820_000,
        commentary: 'A one-point rise costs about $683 a month across both loans.',
      },
      ownerOccupiedProperties: {
        currentMonthlyRepayment: null,
        plusOnePercentImpact: null,
        plusTwoPercentImpact: null,
        available: false,
        unavailableReason: 'no_owner_occupied',
        unavailableExplanation: 'No home loan is recorded.',
        loansCovered: 0,
        balanceCovered: 0,
        commentary: '',
      },
      combinedCommentary: 'The investment loans carry all of the rate exposure.',
    },
    marketConditions: {
      marketCycleSummary: 'Prices have steadied after two years of growth.',
      rbaOutlook: 'The cash rate is on hold.',
      lendingEnvironment: 'Serviceability buffers are unchanged.',
      clientPositioning: 'Well placed to hold.',
    },
    growthOpportunities: {
      equityReleaseOptions: ['About $90,000 is usable equity at 80% LVR.'],
      refinancingOpportunities: ['Compare the Testvale rate at the end of its term.'],
      nextPurchaseRecommendations: ['A third market, under $650,000.'],
      optimizationStrategies: ['Offset the surplus against the larger loan.'],
    },
    projections: {
      years: 10,
      projectedPortfolioValue: 1_850_000,
      projectedDebt: 820_000,
      projectedEquity: 1_030_000,
      projectedMonthlyCashflow: null,
      assumptions: ['Capital growth at the recorded rate for each property.'],
      plainEnglishSummary: 'If growth runs at the recorded rates, equity roughly doubles in ten years.',
    },
    actionPlan: {
      twelveMonthActions: ['Review the Testvale loan.'],
      optimisationScenarios: ['Paying $500 a month into offset saves about $2,600 of interest a year.'],
    },
    borrowingCapacityUtilisation: null,
    strategicRecommendations: {
      shortTerm: ['Review the Testvale loan.'],
      mediumTerm: ['Build the offset balance.'],
      longTerm: ['Plan the third purchase.'],
      priorityActions: ['Review the Testvale loan.'],
    },
  },
  borrowingCapacity: null,
  generatedAt: '2026-10-01T04:00:00.000Z',
  processingTimeMs: 41_000,
};

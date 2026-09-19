import { calculateIncomeTax, getMarginalTaxRate } from '@/utils/borrowingCapacityCalculations';

export interface CGTCostBaseItem {
  label: string;
  amount: number;
}

export interface CGTInputs {
  salePrice: number;
  purchasePrice: number;
  purchaseDate: string; // ISO date string
  saleDate: string; // ISO date string
  costBaseAdditions: CGTCostBaseItem[];
  sellingCosts: CGTCostBaseItem[]; // agent commission, legal, marketing
  ownershipPercentage: number; // 0-100
  grossAnnualIncome: number;
  isMainResidence: boolean;
}

export interface CGTResult {
  // Cost base
  totalCostBase: number;
  costBaseBreakdown: { label: string; amount: number }[];

  // Gain calculation
  grossCapitalGain: number;
  yourShareOfGain: number;
  holdingPeriodMonths: number;
  eligibleForDiscount: boolean;
  cgtDiscount: number;
  taxableCapitalGain: number;

  // Tax calculation
  incomeBeforeGain: number;
  taxOnIncomeAlone: number;
  taxOnIncomeWithGain: number;
  estimatedCGT: number;
  marginalTaxRate: number;
  effectiveCGTRate: number;

  // Net proceeds
  totalSellingCosts: number;
  netProceeds: number;

  // Flags
  isMainResidence: boolean;
  isCapitalLoss: boolean;
}

/**
 * Calculate months between two dates
 */
function monthsBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

/**
 * Calculate Australian Capital Gains Tax
 * Uses the "tax on total income" method for accuracy:
 * CGT = Tax(income + gain) - Tax(income alone)
 */
export function calculateCGT(inputs: CGTInputs): CGTResult {
  const {
    salePrice,
    purchasePrice,
    purchaseDate,
    saleDate,
    costBaseAdditions,
    sellingCosts,
    ownershipPercentage,
    grossAnnualIncome,
    isMainResidence,
  } = inputs;

  // Build cost base
  const totalAdditions = costBaseAdditions.reduce((sum, item) => sum + item.amount, 0);
  const totalSellingCosts = sellingCosts.reduce((sum, item) => sum + item.amount, 0);
  const totalCostBase = purchasePrice + totalAdditions + totalSellingCosts;

  const costBaseBreakdown = [
    { label: 'Purchase Price', amount: purchasePrice },
    ...costBaseAdditions.filter(i => i.amount > 0),
    ...sellingCosts.filter(i => i.amount > 0),
  ];

  // Gross capital gain
  const grossCapitalGain = salePrice - totalCostBase;
  const isCapitalLoss = grossCapitalGain < 0;

  // Ownership share
  const ownershipFraction = ownershipPercentage / 100;
  const yourShareOfGain = Math.round(grossCapitalGain * ownershipFraction);

  // Holding period & discount eligibility
  const holdingPeriodMonths = monthsBetween(purchaseDate, saleDate);
  const eligibleForDiscount = holdingPeriodMonths >= 12 && !isCapitalLoss;

  // Main residence exemption
  if (isMainResidence) {
    return {
      totalCostBase,
      costBaseBreakdown,
      grossCapitalGain,
      yourShareOfGain,
      holdingPeriodMonths,
      eligibleForDiscount,
      cgtDiscount: 0,
      taxableCapitalGain: 0,
      incomeBeforeGain: grossAnnualIncome,
      taxOnIncomeAlone: calculateIncomeTax(grossAnnualIncome),
      taxOnIncomeWithGain: calculateIncomeTax(grossAnnualIncome),
      estimatedCGT: 0,
      marginalTaxRate: getMarginalTaxRate(grossAnnualIncome),
      effectiveCGTRate: 0,
      totalSellingCosts,
      netProceeds: salePrice - totalSellingCosts,
      isMainResidence: true,
      isCapitalLoss,
    };
  }

  // CGT discount (50% if held > 12 months)
  const cgtDiscount = eligibleForDiscount ? Math.round(yourShareOfGain * 0.5) : 0;
  const taxableCapitalGain = isCapitalLoss ? 0 : yourShareOfGain - cgtDiscount;

  // Tax calculation using marginal method
  const taxOnIncomeAlone = calculateIncomeTax(grossAnnualIncome);
  const taxOnIncomeWithGain = calculateIncomeTax(grossAnnualIncome + taxableCapitalGain);
  const estimatedCGT = isCapitalLoss ? 0 : taxOnIncomeWithGain - taxOnIncomeAlone;

  const marginalTaxRate = getMarginalTaxRate(grossAnnualIncome + taxableCapitalGain);
  const effectiveCGTRate = taxableCapitalGain > 0 ? estimatedCGT / yourShareOfGain : 0;

  // Net proceeds after CGT and selling costs
  const netProceeds = salePrice - totalSellingCosts - estimatedCGT;

  return {
    totalCostBase,
    costBaseBreakdown,
    grossCapitalGain,
    yourShareOfGain,
    holdingPeriodMonths,
    eligibleForDiscount,
    cgtDiscount,
    taxableCapitalGain,
    incomeBeforeGain: grossAnnualIncome,
    taxOnIncomeAlone,
    taxOnIncomeWithGain,
    estimatedCGT,
    marginalTaxRate,
    effectiveCGTRate,
    totalSellingCosts,
    netProceeds,
    isMainResidence: false,
    isCapitalLoss,
  };
}

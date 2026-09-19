/**
 * Lenders Mortgage Insurance (LMI) Calculation Utilities
 * 
 * Supports two modes:
 * 1. Display Deduction: LMI subtracted from capacity at output layer
 * 2. Debt Capitalised: LMI added to total debt, recalculated through serviceability
 */

// ============================================
// TYPES
// ============================================

export type LmiMode = 'none' | 'display_deduction' | 'debt_capitalised';

export interface LmiInput {
  propertyValue: number;
  depositAmount: number;
  loanAmount: number; // The proposed or calculated loan
  isFirstHomeBuyer?: boolean;
  lmiManualOverride?: number | null; // If set, skips auto-estimation
}

export interface LmiEstimate {
  lmiAmount: number;
  lvr: number;
  lvrBand: string;
  estimatedRate: number; // % of loan amount
  isLmiRequired: boolean;
  breakdown: string;
}

export interface LmiImpact {
  lmiAmount: number;
  lmiMode: LmiMode;
  /** Original capacity before LMI adjustment */
  grossCapacity: number;
  /** Capacity after LMI adjustment (depends on mode) */
  adjustedCapacity: number;
  /** Net available for property purchase (capacity - LMI in display mode) */
  netPurchaseCapacity: number;
  /** How much capacity was reduced */
  capacityReduction: number;
  /** DTI impact (only in debt_capitalised mode) */
  dtiImpact: number;
  /** Effective LVR after LMI capitalisation */
  effectiveLVR: number;
}

// ============================================
// LMI TIER TABLE
// ============================================

// Industry-standard LMI premium rates as % of loan amount
// Rates vary by LVR band and loan size. These are mid-range estimates.
// Source: Aggregated from Genworth/QBE published schedules
const LMI_RATE_TABLE: {
  lvrMin: number;
  lvrMax: number;
  band: string;
  rates: { maxLoan: number; rate: number }[];
}[] = [
  {
    lvrMin: 0,
    lvrMax: 80,
    band: '≤ 80%',
    rates: [{ maxLoan: Infinity, rate: 0 }],
  },
  {
    lvrMin: 80.01,
    lvrMax: 85,
    band: '80.01% – 85%',
    rates: [
      { maxLoan: 300000, rate: 0.50 },
      { maxLoan: 500000, rate: 0.67 },
      { maxLoan: 750000, rate: 0.85 },
      { maxLoan: 1000000, rate: 1.05 },
      { maxLoan: Infinity, rate: 1.20 },
    ],
  },
  {
    lvrMin: 85.01,
    lvrMax: 90,
    band: '85.01% – 90%',
    rates: [
      { maxLoan: 300000, rate: 1.40 },
      { maxLoan: 500000, rate: 1.75 },
      { maxLoan: 750000, rate: 2.10 },
      { maxLoan: 1000000, rate: 2.50 },
      { maxLoan: Infinity, rate: 2.80 },
    ],
  },
  {
    lvrMin: 90.01,
    lvrMax: 95,
    band: '90.01% – 95%',
    rates: [
      { maxLoan: 300000, rate: 2.90 },
      { maxLoan: 500000, rate: 3.30 },
      { maxLoan: 750000, rate: 3.70 },
      { maxLoan: 1000000, rate: 4.10 },
      { maxLoan: Infinity, rate: 4.50 },
    ],
  },
];

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Calculate LVR from property value and loan amount
 */
export function calculateLVR(loanAmount: number, propertyValue: number): number {
  if (propertyValue <= 0) return 0;
  return Math.round((loanAmount / propertyValue) * 10000) / 100; // 2 decimal places
}

/**
 * Estimate LMI premium based on LVR and loan amount
 */
export function estimateLMI(input: LmiInput): LmiEstimate {
  const { propertyValue, depositAmount, loanAmount, isFirstHomeBuyer = false, lmiManualOverride } = input;

  // If manual override is provided, use it directly
  if (lmiManualOverride != null && lmiManualOverride > 0) {
    const lvr = calculateLVR(loanAmount, propertyValue);
    return {
      lmiAmount: Math.round(lmiManualOverride),
      lvr,
      lvrBand: getLvrBand(lvr),
      estimatedRate: propertyValue > 0 ? Math.round((lmiManualOverride / loanAmount) * 10000) / 100 : 0,
      isLmiRequired: lvr > 80,
      breakdown: 'Manual override applied',
    };
  }

  const lvr = calculateLVR(loanAmount, propertyValue);

  // No LMI needed if LVR ≤ 80%
  if (lvr <= 80) {
    return {
      lmiAmount: 0,
      lvr,
      lvrBand: '≤ 80%',
      estimatedRate: 0,
      isLmiRequired: false,
      breakdown: 'LVR within 80% threshold — no LMI required',
    };
  }

  // Find the matching tier
  const tier = LMI_RATE_TABLE.find(t => lvr >= t.lvrMin && lvr <= t.lvrMax);
  if (!tier) {
    return {
      lmiAmount: 0,
      lvr,
      lvrBand: 'Unknown',
      estimatedRate: 0,
      isLmiRequired: true,
      breakdown: 'LVR exceeds standard thresholds',
    };
  }

  // Find the rate based on loan size
  let estimatedRate = 0;
  for (const rateEntry of tier.rates) {
    if (loanAmount <= rateEntry.maxLoan) {
      estimatedRate = rateEntry.rate;
      break;
    }
  }

  // FHB discount (some lenders offer 10-20% LMI discount for FHB)
  if (isFirstHomeBuyer && estimatedRate > 0) {
    estimatedRate *= 0.85; // 15% discount
  }

  const lmiAmount = Math.round(loanAmount * (estimatedRate / 100));

  return {
    lmiAmount,
    lvr,
    lvrBand: tier.band,
    estimatedRate: Math.round(estimatedRate * 100) / 100,
    isLmiRequired: true,
    breakdown: `LVR ${lvr.toFixed(1)}% (${tier.band}) → ${estimatedRate.toFixed(2)}% of $${loanAmount.toLocaleString('en-AU')} loan${isFirstHomeBuyer ? ' (FHB discount applied)' : ''}`,
  };
}

/**
 * Get LVR band label
 */
function getLvrBand(lvr: number): string {
  if (lvr <= 80) return '≤ 80%';
  if (lvr <= 85) return '80.01% – 85%';
  if (lvr <= 90) return '85.01% – 90%';
  if (lvr <= 95) return '90.01% – 95%';
  return '> 95%';
}

/**
 * Calculate the impact of LMI on borrowing capacity
 * 
 * @param grossCapacity - The raw borrowing capacity before LMI
 * @param lmiAmount - The LMI premium
 * @param lmiMode - How to apply LMI
 * @param totalDebtBalances - Existing debt balances (for DTI recalc)
 * @param grossAnnualIncome - For DTI recalc
 * @param propertyValue - For effective LVR calc
 */
export function calculateLmiImpact(
  grossCapacity: number,
  lmiAmount: number,
  lmiMode: LmiMode,
  totalDebtBalances: number = 0,
  grossAnnualIncome: number = 0,
  propertyValue: number = 0,
): LmiImpact {
  if (lmiMode === 'none' || lmiAmount <= 0) {
    return {
      lmiAmount: 0,
      lmiMode,
      grossCapacity,
      adjustedCapacity: grossCapacity,
      netPurchaseCapacity: grossCapacity,
      capacityReduction: 0,
      dtiImpact: 0,
      effectiveLVR: propertyValue > 0 ? calculateLVR(grossCapacity, propertyValue) : 0,
    };
  }

  if (lmiMode === 'display_deduction') {
    // LMI is subtracted from usable capacity but doesn't change serviceability
    const netPurchaseCapacity = Math.max(0, grossCapacity - lmiAmount);
    return {
      lmiAmount,
      lmiMode,
      grossCapacity,
      adjustedCapacity: grossCapacity, // Capacity unchanged
      netPurchaseCapacity,
      capacityReduction: 0, // No reduction to max capacity
      dtiImpact: 0,
      effectiveLVR: propertyValue > 0 ? calculateLVR(grossCapacity, propertyValue) : 0,
    };
  }

  // debt_capitalised mode: LMI is added to total debt
  // This increases DTI and may reduce capacity in DTI-capped scenarios
  const originalDti = grossAnnualIncome > 0 
    ? (totalDebtBalances + grossCapacity) / grossAnnualIncome 
    : 0;
  const newDti = grossAnnualIncome > 0 
    ? (totalDebtBalances + grossCapacity + lmiAmount) / grossAnnualIncome 
    : 0;
  const dtiImpact = Math.round((newDti - originalDti) * 100) / 100;
  
  // The adjusted capacity accounts for LMI being part of the loan
  // Effective capacity for property purchase = grossCapacity (total loan covers property + LMI)
  const netPurchaseCapacity = Math.max(0, grossCapacity - lmiAmount);
  const effectiveLoan = grossCapacity + lmiAmount;
  
  return {
    lmiAmount,
    lmiMode,
    grossCapacity,
    adjustedCapacity: grossCapacity, // The total loan capacity stays the same from serviceability
    netPurchaseCapacity, // But less goes to property
    capacityReduction: 0,
    dtiImpact,
    effectiveLVR: propertyValue > 0 ? calculateLVR(effectiveLoan, propertyValue) : 0,
  };
}

/**
 * Iterative LMI convergence for debt_capitalised mode
 * Higher loan → higher LMI → need higher loan to cover it
 * Caps at 5 iterations to prevent infinite loops
 */
export function iterativeLmiConvergence(
  baseLoanAmount: number,
  propertyValue: number,
  isFirstHomeBuyer: boolean = false,
  maxIterations: number = 5,
): { convergedLoan: number; convergedLmi: number; iterations: number } {
  let currentLoan = baseLoanAmount;
  let currentLmi = 0;
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const estimate = estimateLMI({
      propertyValue,
      depositAmount: propertyValue - currentLoan,
      loanAmount: currentLoan,
      isFirstHomeBuyer,
    });

    if (Math.abs(estimate.lmiAmount - currentLmi) < 50) {
      // Converged (within $50)
      break;
    }

    currentLmi = estimate.lmiAmount;
    currentLoan = baseLoanAmount + currentLmi; // Total loan = property portion + LMI
  }

  return {
    convergedLoan: Math.round(currentLoan),
    convergedLmi: Math.round(currentLmi),
    iterations,
  };
}

/**
 * Format LMI for display
 */
export function formatLmiMode(mode: LmiMode): string {
  switch (mode) {
    case 'none': return 'Not Applied';
    case 'display_deduction': return 'Display Deduction';
    case 'debt_capitalised': return 'Capitalised to Loan';
  }
}

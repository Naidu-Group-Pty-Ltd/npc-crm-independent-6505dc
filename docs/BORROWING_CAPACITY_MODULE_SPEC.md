# Borrowing Capacity Calculator Module - Technical Specification

## Executive Summary

This document outlines the implementation plan for a **Borrowing Capacity Calculator** module, inspired by Quickli's approach, integrated into the NPC Portfolio Performance Reports system. The module will calculate how much a client can potentially borrow based on their income, expenses, liabilities, and stress-tested serviceability assumptions.

---

## 1. Module Overview

### 1.1 Purpose
Calculate and display borrowing power/capacity for clients based on their financial profile, using Australian lender-standard serviceability logic with stress testing.

### 1.2 Key Outputs
- **Borrowing Capacity Figure**: Maximum loan amount client can service
- **Serviceability Band**: Visual indicator (Green/Amber/Red)
- **Monthly Surplus/Deficit**: Net income after all commitments
- **Stress-Tested Capacity**: Capacity under +2-3% rate scenarios
- **Recommendations**: Actionable strategy guidance

### 1.3 Integration Points
| Component | Integration Type |
|-----------|------------------|
| Client Scorecard | New section |
| Portfolio Review Wizard | New step |
| Client Details Modal | Summary widget |
| Portfolio PDF Generator | New section |
| Client Tracker | Capacity column |

---

## 2. Data Architecture

### 2.1 Existing Data Sources

#### clients table
```typescript
{
  borrowing_capacity: number | null,      // Currently manual - will be calculated
  total_monthly_income: number | null,
  total_monthly_expenditure: number | null,
  total_debt: number | null,
  dependents_count: number | null,
  marital_status: string | null,          // 'single' | 'married' | 'de_facto'
  living_situation: string | null,        // 'renting' | 'owner_occupied' | 'living_with_parents'
}
```

#### client_income table
```typescript
{
  client_id: string,
  contact_type: string,                   // 'primary' | 'secondary'
  gross_salary: number | null,
  salary_frequency: string | null,        // 'weekly' | 'fortnightly' | 'monthly' | 'annual'
  bonus: number | null,
  commission: number | null,
  overtime_essential: number | null,
  overtime_non_essential: number | null,
  allowance: number | null,
  other_taxable_income: number | null,
}
```

#### client_liabilities table
```typescript
{
  client_id: string,
  liability_type: string,                 // 'home_loan' | 'investment_loan' | 'car_loan' | 'personal_loan' | 'credit_card' | 'hecs' | 'other'
  current_balance: number | null,
  credit_limit: number | null,            // For credit cards
  monthly_repayment: number | null,
  interest_rate: number | null,
  repayment_type: string | null,          // 'principal_interest' | 'interest_only'
}
```

#### client_properties table
```typescript
{
  client_id: string,
  value: number | null,
  loan_remaining: number | null,
  monthly_rental_income: number | null,
  interest_rate: number | null,
  // ... expense fields
}
```

### 2.2 New Database Table

```sql
-- Create borrowing_capacity_assessments table
CREATE TABLE public.borrowing_capacity_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  
  -- Input snapshot
  gross_annual_income NUMERIC,
  net_annual_income NUMERIC,
  rental_income_annual NUMERIC,
  total_existing_debt NUMERIC,
  existing_monthly_commitments NUMERIC,
  living_expenses_monthly NUMERIC,
  
  -- Calculation parameters
  interest_rate_used NUMERIC,             -- Rate used for calculation
  buffer_rate NUMERIC DEFAULT 3.0,        -- APRA buffer (currently 3%)
  assessment_rate NUMERIC,                -- Effective rate = interest_rate + buffer
  loan_term_years INTEGER DEFAULT 30,
  
  -- Results
  borrowing_capacity NUMERIC,
  monthly_surplus NUMERIC,
  serviceability_band TEXT,               -- 'green' | 'amber' | 'red'
  stress_tested_capacity NUMERIC,         -- Capacity at +1% above assessment
  
  -- Constraints
  max_lvr NUMERIC DEFAULT 80,
  max_dti_ratio NUMERIC,                  -- Debt-to-income ratio
  
  -- Metadata
  calculation_method TEXT DEFAULT 'npc_standard',
  assumptions JSONB,
  recommendations JSONB,
  warnings TEXT[],
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  calculated_by UUID REFERENCES custom_users(id)
);

-- Enable RLS
ALTER TABLE public.borrowing_capacity_assessments ENABLE ROW LEVEL SECURITY;

-- RLS Policies (public read for frontend, write via edge function)
CREATE POLICY "Allow public read" ON public.borrowing_capacity_assessments
  FOR SELECT USING (true);

CREATE POLICY "Allow service role insert/update" ON public.borrowing_capacity_assessments
  FOR ALL USING (true);

-- Index for quick lookups
CREATE INDEX idx_borrowing_capacity_client ON borrowing_capacity_assessments(client_id);
CREATE INDEX idx_borrowing_capacity_date ON borrowing_capacity_assessments(created_at DESC);
```

---

## 3. Calculation Logic

### 3.1 Income Assessment (Shading Rules)

| Income Type | Shading % | Notes |
|-------------|-----------|-------|
| Base Salary (PAYG) | 100% | Gross annual |
| Bonus | 80% | 2-year average if available |
| Commission | 80% | 2-year average |
| Overtime (Essential) | 100% | Regular/guaranteed |
| Overtime (Non-Essential) | 50% | Variable |
| Rental Income (Existing) | 80% | Net of expenses |
| Rental Income (Proposed) | 70% | Lower certainty |
| Self-Employed Income | 80-100% | Based on stability |
| Other Taxable | 80% | Case dependent |

### 3.2 Assessable Income Calculation

```typescript
interface IncomeAssessment {
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  incomeBreakdown: {
    baseSalary: number;
    shadedBonus: number;
    shadedCommission: number;
    shadedOvertime: number;
    shadedRental: number;
    shadedOther: number;
  };
}

function calculateAssessableIncome(
  primaryIncome: ClientIncome,
  secondaryIncome: ClientIncome | null,
  properties: ClientProperty[]
): IncomeAssessment {
  // Primary applicant
  const primaryBase = annualize(primaryIncome.gross_salary, primaryIncome.salary_frequency);
  const primaryBonus = (primaryIncome.bonus || 0) * 0.80;
  const primaryCommission = (primaryIncome.commission || 0) * 0.80;
  const primaryOvertimeEssential = (primaryIncome.overtime_essential || 0) * 1.0;
  const primaryOvertimeNonEssential = (primaryIncome.overtime_non_essential || 0) * 0.50;
  const primaryOther = (primaryIncome.other_taxable_income || 0) * 0.80;
  
  // Secondary applicant (if applicable)
  let secondaryTotal = 0;
  if (secondaryIncome) {
    // Same shading logic for secondary
  }
  
  // Rental income from existing properties
  const rentalIncome = properties.reduce((sum, p) => {
    const annualRent = (p.monthly_rental_income || 0) * 12;
    return sum + (annualRent * 0.80); // 80% shading
  }, 0);
  
  return {
    grossAnnualIncome: primaryBase + /* all components */,
    shadedAnnualIncome: /* sum of shaded components */,
    incomeBreakdown: { /* detailed breakdown */ }
  };
}
```

### 3.3 Living Expenses (HEM Benchmark)

The system uses Household Expenditure Measure (HEM) as a benchmark:

```typescript
// Simplified HEM table (actual varies by location and should be updated)
const HEM_TABLE = {
  single: {
    no_dependents: 1500,
    one_dependent: 2000,
    two_dependents: 2300,
    three_plus: 2600,
  },
  couple: {
    no_dependents: 2200,
    one_dependent: 2600,
    two_dependents: 2900,
    three_plus: 3200,
  }
};

function calculateLivingExpenses(
  maritalStatus: 'single' | 'married' | 'de_facto',
  dependentsCount: number,
  declaredExpenses?: number
): number {
  const status = maritalStatus === 'single' ? 'single' : 'couple';
  const dependentKey = getDependentKey(dependentsCount);
  const hemBenchmark = HEM_TABLE[status][dependentKey];
  
  // Use higher of HEM or declared expenses
  return Math.max(hemBenchmark, declaredExpenses || 0);
}
```

### 3.4 Existing Debt Servicing

```typescript
interface DebtServiceAssessment {
  totalMonthlyCommitments: number;
  debtBreakdown: {
    homeLoans: number;           // Actual repayment
    investmentLoans: number;     // Actual repayment
    personalLoans: number;       // Actual repayment
    carLoans: number;            // Actual repayment
    creditCards: number;         // 3% of limit (not balance)
    hecs: number;                // Based on income threshold
    other: number;
  };
}

function assessExistingDebts(liabilities: ClientLiability[]): DebtServiceAssessment {
  let breakdown = {
    homeLoans: 0,
    investmentLoans: 0,
    personalLoans: 0,
    carLoans: 0,
    creditCards: 0,
    hecs: 0,
    other: 0,
  };
  
  for (const liability of liabilities) {
    switch (liability.liability_type) {
      case 'home_loan':
      case 'investment_loan':
        // Use actual monthly repayment or calculate from balance/rate
        breakdown[liability.liability_type === 'home_loan' ? 'homeLoans' : 'investmentLoans'] += 
          liability.monthly_repayment || calculateRepayment(liability);
        break;
        
      case 'credit_card':
        // 3% of credit limit (standard lender assessment)
        breakdown.creditCards += (liability.credit_limit || 0) * 0.03;
        break;
        
      case 'hecs':
        // Based on income threshold - calculated separately
        break;
        
      default:
        breakdown.other += liability.monthly_repayment || 0;
    }
  }
  
  return {
    totalMonthlyCommitments: Object.values(breakdown).reduce((a, b) => a + b, 0),
    debtBreakdown: breakdown
  };
}
```

### 3.5 Serviceability Calculation

```typescript
interface ServiceabilityResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  stressTestedCapacity: number;
  dtiRatio: number;
  assessmentRate: number;
  assumptions: object;
  recommendations: string[];
  warnings: string[];
}

function calculateBorrowingCapacity(
  assessableIncome: IncomeAssessment,
  livingExpenses: number,
  debtService: DebtServiceAssessment,
  options: {
    interestRate?: number;      // Current market rate (default: fetch from LVR tiers)
    bufferRate?: number;        // APRA buffer (default: 3%)
    loanTermYears?: number;     // Default: 30
    maxLvr?: number;            // Default: 80%
  }
): ServiceabilityResult {
  const {
    interestRate = 6.5,
    bufferRate = 3.0,
    loanTermYears = 30,
    maxLvr = 80
  } = options;
  
  // Assessment rate = current rate + buffer
  const assessmentRate = interestRate + bufferRate;
  const monthlyAssessmentRate = (assessmentRate / 100) / 12;
  
  // Monthly net income
  const monthlyAssessableIncome = assessableIncome.shadedAnnualIncome / 12;
  
  // Monthly surplus available for new loan
  const monthlySurplus = monthlyAssessableIncome - livingExpenses - debtService.totalMonthlyCommitments;
  
  // Maximum new monthly repayment = surplus
  const maxNewRepayment = Math.max(0, monthlySurplus);
  
  // Reverse calculate max loan from repayment
  // Using P&I formula: Loan = Payment × ((1 - (1 + r)^-n) / r)
  const totalPeriods = loanTermYears * 12;
  const factor = (1 - Math.pow(1 + monthlyAssessmentRate, -totalPeriods)) / monthlyAssessmentRate;
  const borrowingCapacity = maxNewRepayment * factor;
  
  // Stress test at +1% above assessment
  const stressRate = (assessmentRate + 1) / 100 / 12;
  const stressFactor = (1 - Math.pow(1 + stressRate, -totalPeriods)) / stressRate;
  const stressTestedCapacity = maxNewRepayment * stressFactor;
  
  // Calculate DTI ratio
  const totalDebt = debtService.totalMonthlyCommitments * 12 + borrowingCapacity;
  const dtiRatio = totalDebt / assessableIncome.grossAnnualIncome;
  
  // Determine serviceability band
  let serviceabilityBand: 'green' | 'amber' | 'red';
  if (monthlySurplus > 500 && dtiRatio < 6) {
    serviceabilityBand = 'green';
  } else if (monthlySurplus > 0 && dtiRatio < 8) {
    serviceabilityBand = 'amber';
  } else {
    serviceabilityBand = 'red';
  }
  
  // Generate recommendations
  const recommendations = generateRecommendations(serviceabilityBand, dtiRatio, monthlySurplus);
  const warnings = generateWarnings(dtiRatio, maxLvr, debtService);
  
  return {
    borrowingCapacity: Math.round(borrowingCapacity),
    monthlySurplus: Math.round(monthlySurplus),
    serviceabilityBand,
    stressTestedCapacity: Math.round(stressTestedCapacity),
    dtiRatio: Math.round(dtiRatio * 100) / 100,
    assessmentRate,
    assumptions: {
      interestRate,
      bufferRate,
      loanTermYears,
      maxLvr,
      hemUsed: livingExpenses,
    },
    recommendations,
    warnings
  };
}
```

### 3.6 Recommendations Engine

```typescript
function generateRecommendations(
  band: 'green' | 'amber' | 'red',
  dtiRatio: number,
  monthlySurplus: number
): string[] {
  const recommendations: string[] = [];
  
  if (band === 'green') {
    recommendations.push('Strong borrowing position - ready for property acquisition');
    if (dtiRatio < 4) {
      recommendations.push('Consider accelerating portfolio growth given low debt levels');
    }
  } else if (band === 'amber') {
    recommendations.push('Moderate borrowing capacity - proceed with caution');
    if (monthlySurplus < 300) {
      recommendations.push('Build cash buffer before next acquisition');
    }
    recommendations.push('Consider reducing existing debt before new borrowing');
  } else {
    recommendations.push('Limited borrowing capacity - focus on debt reduction');
    recommendations.push('Review existing portfolio for refinancing opportunities');
    recommendations.push('Consider selling underperforming assets to improve position');
    if (dtiRatio > 8) {
      recommendations.push('Recommend broker reassessment before any new acquisitions');
    }
  }
  
  return recommendations;
}
```

---

## 4. Implementation Plan

### Phase 1: Foundation (Week 1)

#### 4.1.1 Database Migration
- [ ] Create `borrowing_capacity_assessments` table
- [ ] Add indexes and RLS policies
- [ ] Create utility functions for calculations

#### 4.1.2 Edge Function: `calculate-borrowing-capacity`
```
supabase/functions/calculate-borrowing-capacity/index.ts
```
- Fetch client income, liabilities, properties
- Apply shading rules
- Calculate living expenses (HEM)
- Assess existing debts
- Calculate borrowing capacity
- Generate recommendations
- Persist to database

#### 4.1.3 Utility Functions
```
src/utils/borrowingCapacityCalculations.ts
```
- Income shading functions
- HEM lookup table
- Debt assessment functions
- Serviceability formula
- Recommendation generator

### Phase 2: UI Components (Week 2)

#### 4.2.1 BorrowingCapacityCard Component
```
src/components/clients/BorrowingCapacityCard.tsx
```
- Compact card showing capacity figure
- Serviceability band indicator (Green/Amber/Red)
- Monthly surplus display
- Recalculate button
- Expand to view details

#### 4.2.2 BorrowingCapacityModal Component
```
src/components/clients/BorrowingCapacityModal.tsx
```
- Full breakdown view
- Income shading details
- Expense breakdown
- Debt servicing table
- Stress test results
- Recommendations list
- Override input fields

#### 4.2.3 BorrowingCapacityWizardStep
```
src/components/clients/review-wizard/BorrowingCapacityStep.tsx
```
- Integration with existing review wizard
- Side-by-side comparison with existing scorecard

### Phase 3: Integration (Week 3)

#### 4.3.1 Client Management Integration
- Add BorrowingCapacityCard to Client Details Modal
- Add capacity column to Client Tracker

#### 4.3.2 Portfolio Review Wizard
- Add new step after Scorecard
- Include in final review summary

#### 4.3.3 PDF Export
- Add borrowing capacity section to Portfolio Analysis PDF
- Include in executive summary

### Phase 4: Enhancement (Week 4)

#### 4.4.1 Scenario Modeling
- What-if calculator (change income, reduce debt)
- Rate change impact analysis
- Multi-property acquisition planning

#### 4.4.2 Historical Tracking
- Track capacity over time
- Show trends in dashboard
- Alert on significant changes

---

## 5. UI/UX Design

### 5.1 Serviceability Band Colors

| Band | Color | HSL | Condition |
|------|-------|-----|-----------|
| Green | Success | `142 76% 36%` | Surplus > $500, DTI < 6 |
| Amber | Warning | `38 92% 50%` | Surplus > $0, DTI < 8 |
| Red | Destructive | `0 84% 60%` | Surplus ≤ $0 or DTI ≥ 8 |

### 5.2 Card Layout

```
┌─────────────────────────────────────────┐
│ 💰 Borrowing Capacity          [↻] [⋮] │
├─────────────────────────────────────────┤
│                                         │
│         $850,000                        │
│     Estimated Capacity                  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  ● GREEN - Strong Position      │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Monthly Surplus    │  DTI Ratio        │
│     $1,850          │    4.2x           │
│                                         │
├─────────────────────────────────────────┤
│  ⓘ Based on 9.5% assessment rate       │
│    (6.5% market + 3% buffer)            │
└─────────────────────────────────────────┘
```

### 5.3 Breakdown Modal

```
┌──────────────────────────────────────────────────────────────┐
│ Borrowing Capacity Assessment                            [X] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  INCOME ASSESSMENT                                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Base Salary (PAYG)        $120,000    100%   $120,000  │  │
│  │ Bonus                      $15,000     80%    $12,000  │  │
│  │ Rental Income (Existing)   $36,000     80%    $28,800  │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Total Assessable Income                      $160,800  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  MONTHLY EXPENSES                                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Living Expenses (HEM)                         $2,600   │  │
│  │ Existing Loan Repayments                      $3,200   │  │
│  │ Credit Card (3% of limit)                       $450   │  │
│  │ Other Commitments                               $200   │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Total Monthly Commitments                     $6,450   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  SERVICEABILITY                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Monthly Income (Assessable)                  $13,400   │  │
│  │ Less: Total Commitments                      -$6,450   │  │
│  │ ──────────────────────────────────────────────────────  │  │
│  │ Monthly Surplus                               $6,950   │  │
│  │                                                         │  │
│  │ Max New Repayment (at 9.5%)        →        $6,950    │  │
│  │ Max Loan Amount                    →      $850,000    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  STRESS TEST                                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ At +1% (10.5% rate):              $780,000 capacity   │  │
│  │ At +2% (11.5% rate):              $715,000 capacity   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  RECOMMENDATIONS                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ✓ Strong borrowing position - ready for acquisition   │  │
│  │ ✓ Consider properties up to $1,060,000 at 80% LVR     │  │
│  │ ⓘ Capacity allows for premium metropolitan markets    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│                              [Recalculate]  [Export PDF]     │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. File Structure

```
src/
├── components/
│   └── clients/
│       ├── BorrowingCapacityCard.tsx       # Compact summary card
│       ├── BorrowingCapacityModal.tsx      # Detailed breakdown modal
│       ├── BorrowingCapacityOverrides.tsx  # Manual override inputs
│       └── review-wizard/
│           └── BorrowingCapacityStep.tsx   # Review wizard integration
│
├── utils/
│   └── borrowingCapacityCalculations.ts    # Core calculation logic
│
└── hooks/
    └── useBorrowingCapacity.tsx            # Data fetching & calculation hook

supabase/
└── functions/
    └── calculate-borrowing-capacity/
        └── index.ts                         # Edge function for calculation
```

---

## 7. API Contract

### 7.1 Edge Function Request

```typescript
POST /functions/v1/calculate-borrowing-capacity

{
  "clientId": "uuid",
  "overrides": {
    "grossAnnualIncome": number,      // Optional override
    "livingExpenses": number,          // Optional override
    "interestRate": number,            // Optional (default: market rate)
    "bufferRate": number,              // Optional (default: 3%)
    "loanTermYears": number,           // Optional (default: 30)
    "proposedPropertyValue": number,   // For scenario planning
    "proposedDeposit": number          // For scenario planning
  }
}
```

### 7.2 Edge Function Response

```typescript
{
  "success": true,
  "data": {
    "assessmentId": "uuid",
    "borrowingCapacity": 850000,
    "monthlySurplus": 1850,
    "serviceabilityBand": "green",
    "stressTestedCapacity": 780000,
    "dtiRatio": 4.2,
    "assessmentRate": 9.5,
    "incomeBreakdown": {
      "baseSalary": 120000,
      "shadedBonus": 12000,
      "shadedRental": 28800,
      "totalAssessable": 160800
    },
    "expenseBreakdown": {
      "livingExpenses": 2600,
      "existingLoans": 3200,
      "creditCards": 450,
      "other": 200,
      "totalMonthly": 6450
    },
    "stressTests": [
      { "rate": 10.5, "capacity": 780000 },
      { "rate": 11.5, "capacity": 715000 }
    ],
    "assumptions": {
      "interestRate": 6.5,
      "bufferRate": 3.0,
      "loanTermYears": 30,
      "maxLvr": 80,
      "hemUsed": 2600
    },
    "recommendations": [
      "Strong borrowing position - ready for acquisition",
      "Consider properties up to $1,060,000 at 80% LVR"
    ],
    "warnings": [],
    "calculatedAt": "2026-01-19T12:00:00Z"
  }
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests
- Income shading calculations
- HEM lookup logic
- Debt assessment formulas
- Serviceability calculation accuracy
- Recommendation generation

### 8.2 Integration Tests
- Edge function end-to-end
- Database persistence
- Frontend component rendering

### 8.3 Scenario Tests
| Scenario | Expected Band | Expected Capacity Range |
|----------|---------------|-------------------------|
| High income, no debt | Green | $1M+ |
| Average income, moderate debt | Amber | $400K-$700K |
| Low income, high debt | Red | <$200K |
| Couple, multiple properties | Green | $1.2M+ |
| Self-employed, variable income | Amber | Depends on stability |

---

## 9. Compliance Notes

### 9.1 Disclaimers Required
- "This is an indicative estimate only"
- "Not a formal credit assessment"
- "Speak to a licensed broker for actual approval"
- "Subject to lender policies and credit assessment"

### 9.2 Regulatory Alignment
- Uses APRA-standard 3% buffer rate
- Follows HEM benchmark methodology
- Applies standard income shading ratios
- Aligned with major bank assessment criteria

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Calculation accuracy vs broker estimate | Within 10% |
| User adoption rate | 70% of client reviews |
| Time to calculate | < 2 seconds |
| PDF export inclusion | 100% of portfolio reports |

---

## 11. Future Enhancements

### 11.1 Phase 2 Features
- Lender-specific calculations (vary by bank)
- Pre-approval integration
- Automatic recalculation on data change
- Multi-scenario comparison view

### 11.2 API Integrations
- Quickli API (if partnership established)
- Lender APIs for real-time rates
- Credit bureau integration (long-term)

---

## Appendix A: HEM Reference Table (2024)

| Situation | No Deps | 1 Dep | 2 Deps | 3+ Deps |
|-----------|---------|-------|--------|---------|
| Single | $1,500 | $2,000 | $2,300 | $2,600 |
| Couple | $2,200 | $2,600 | $2,900 | $3,200 |

*Note: HEM values should be updated annually*

---

## Appendix B: Income Shading Quick Reference

| Type | Shading |
|------|---------|
| Base PAYG | 100% |
| Bonus | 80% |
| Commission | 80% |
| Overtime (Essential) | 100% |
| Overtime (Variable) | 50% |
| Rental (Existing) | 80% |
| Rental (Proposed) | 70% |
| Self-Employed | 80-100% |
| Other | 80% |

---

*Document Version: 1.0*
*Last Updated: 2026-01-19*
*Author: NPC Development Team*

# Borrowing Capacity Calculator - Updated Implementation Plan

**Version**: 2.0  
**Date**: January 2026  
**Based On**: Quickli UI Analysis + Existing NPC Data Structures

---

## Executive Summary

This plan details the implementation of a **Quickli-inspired Borrowing Capacity Calculator** integrated into the NPC dashboard. Unlike Quickli's multi-lender comparison, we'll implement a **single-assessment model** that:

1. Auto-populates from existing client data
2. Uses APRA-compliant serviceability logic (3% buffer)
3. Produces clear capacity figures with Green/Amber/Red bands
4. Integrates into Client Scorecard, Review Wizard, and PDF exports

---

## 1. UI/UX Design (Quickli-Inspired)

### 1.1 Layout Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BORROWING CAPACITY CALCULATOR                          [Recalculate] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────┐  ┌───────────────────────────────┐  │
│  │     INPUT PANEL (LEFT)      │  │   RESULTS PANEL (RIGHT)       │  │
│  │                             │  │                               │  │
│  │  ▼ Applicants               │  │  ┌─────────────────────────┐  │  │
│  │    • Primary details        │  │  │  BORROWING CAPACITY     │  │  │
│  │    • Secondary details      │  │  │     $625,000            │  │  │
│  │                             │  │  │  ────────────────────   │  │  │
│  │  ▼ Income                   │  │  │  [████████████░░░]      │  │  │
│  │    • Base Salary: $95,000   │  │  │  Stress-tested: $580K   │  │  │
│  │    • Bonus (80%): $8,000    │  │  └─────────────────────────┘  │  │
│  │    • Rental: $24,000        │  │                               │  │
│  │                             │  │  ┌──────┬──────┬──────────┐   │  │
│  │  ▼ Living Expenses          │  │  │Surplus│ DTI  │Assessment│   │  │
│  │    ○ Simple: $1,500/mo      │  │  │$1,234 │ 5.2x │  9.50%   │   │  │
│  │    ● Detailed               │  │  └──────┴──────┴──────────┘   │  │
│  │      - Primary Residence    │  │                               │  │
│  │      - Food & Groceries     │  │  ┌─────────────────────────┐  │  │
│  │      - Transport            │  │  │  SERVICEABILITY BAND    │  │  │
│  │                             │  │  │  [  🟢 GREEN  ]         │  │  │
│  │  ▼ Existing Liabilities     │  │  │  Strong borrowing       │  │  │
│  │    + Home Loan: $450K       │  │  │  position               │  │  │
│  │    + Credit Card: $15K lim  │  │  └─────────────────────────┘  │  │
│  │    + HECS: $25K             │  │                               │  │
│  │                             │  │  ▼ Recommendations            │  │
│  │  ▼ Securities & Properties  │  │    • Ready for acquisition    │  │
│  │    + INV: $625K, 80% LVR    │  │    • Consider accelerating    │  │
│  │    + Add Security           │  │      portfolio growth         │  │
│  │                             │  │                               │  │
│  │  ▼ Proposed Loan            │  │  ▼ Assumptions Used           │  │
│  │    Amount: $500,000         │  │    • Buffer: 3.00%            │  │
│  │    Term: 30 years           │  │    • Assessment rate: 9.50%   │  │
│  │    LVR: 80%                 │  │    • Loan term: 30 years      │  │
│  │                             │  │    • HEM benchmark: $2,200    │  │
│  └─────────────────────────────┘  └───────────────────────────────┘  │
│                                                                       │
│  ⚠️ This calculator is for indicative purposes only. Recommend      │
│     broker assessment for formal lending advice.                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Hierarchy

```
BorrowingCapacityModule/
├── BorrowingCapacityCard.tsx          # Compact summary for Scorecard
├── BorrowingCapacityModal.tsx         # Full calculator modal
│   ├── ApplicantSection.tsx           # Applicant details accordion
│   ├── IncomeSection.tsx              # Income with shading display
│   ├── ExpensesSection.tsx            # Simple/Detailed toggle
│   ├── LiabilitiesSection.tsx         # Existing debts
│   ├── SecuritiesSection.tsx          # Properties + rental income
│   ├── ProposedLoanSection.tsx        # New loan parameters
│   └── ResultsPanel.tsx               # Real-time calculation display
├── BorrowingCapacityWizardStep.tsx    # Review Wizard integration
└── useBorrowingCapacity.ts            # Calculation hook
```

### 1.3 Color System (Serviceability Bands)

| Band | Color | Criteria | Message |
|------|-------|----------|---------|
| **Green** | `hsl(142 76% 36%)` | Surplus > $500/mo, DTI < 6 | "Strong borrowing position" |
| **Amber** | `hsl(38 92% 50%)` | Surplus > $0, DTI < 8 | "Moderate capacity - proceed with caution" |
| **Red** | `hsl(0 84% 60%)` | Surplus ≤ $0 or DTI ≥ 8 | "Limited capacity - focus on debt reduction" |

---

## 2. Data Architecture

### 2.1 Existing Data Sources (Already Available)

| Table | Fields Used | Purpose |
|-------|-------------|---------|
| `clients` | `marital_status`, `dependents_count`, `living_situation` | HEM lookup |
| `client_income` | `gross_salary`, `bonus`, `commission`, `overtime_*`, `allowance` | Income assessment |
| `client_liabilities` | `liability_type`, `current_balance`, `credit_limit`, `monthly_repayment` | Debt servicing |
| `client_properties` | `value`, `loan_remaining`, `monthly_rental_income`, `interest_rate` | Rental income + existing loans |

### 2.2 New Database Table

```sql
CREATE TABLE public.borrowing_capacity_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  
  -- Income Summary
  gross_annual_income NUMERIC NOT NULL DEFAULT 0,
  shaded_annual_income NUMERIC NOT NULL DEFAULT 0,
  income_breakdown JSONB,                    -- Detailed shading per component
  
  -- Expense Summary  
  living_expenses_monthly NUMERIC NOT NULL DEFAULT 0,
  expense_method TEXT DEFAULT 'hem',         -- 'hem' | 'declared' | 'hybrid'
  expense_breakdown JSONB,
  
  -- Liability Summary
  existing_commitments_monthly NUMERIC NOT NULL DEFAULT 0,
  liability_breakdown JSONB,
  
  -- Calculation Parameters
  interest_rate_used NUMERIC DEFAULT 6.50,
  buffer_rate NUMERIC DEFAULT 3.00,
  assessment_rate NUMERIC GENERATED ALWAYS AS (interest_rate_used + buffer_rate) STORED,
  loan_term_years INTEGER DEFAULT 30,
  proposed_loan_amount NUMERIC,
  proposed_lvr NUMERIC DEFAULT 80,
  
  -- Results
  borrowing_capacity NUMERIC NOT NULL DEFAULT 0,
  monthly_surplus NUMERIC NOT NULL DEFAULT 0,
  serviceability_band TEXT NOT NULL DEFAULT 'red',  -- 'green' | 'amber' | 'red'
  stress_tested_capacity NUMERIC DEFAULT 0,
  dti_ratio NUMERIC DEFAULT 0,
  
  -- Recommendations
  recommendations JSONB DEFAULT '[]',
  warnings TEXT[] DEFAULT '{}',
  assumptions JSONB DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by UUID REFERENCES custom_users(id)
);

-- Indexes
CREATE INDEX idx_bc_client ON borrowing_capacity_assessments(client_id);
CREATE INDEX idx_bc_band ON borrowing_capacity_assessments(serviceability_band);
CREATE INDEX idx_bc_created ON borrowing_capacity_assessments(created_at DESC);

-- RLS
ALTER TABLE public.borrowing_capacity_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.borrowing_capacity_assessments
  FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON public.borrowing_capacity_assessments
  FOR ALL USING (true);

-- Auto-update timestamp trigger
CREATE TRIGGER update_bc_updated_at
  BEFORE UPDATE ON public.borrowing_capacity_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

---

## 3. Calculation Engine

### 3.1 Income Shading Rules (APRA-Aligned)

```typescript
const INCOME_SHADING_RULES = {
  base_salary: { rate: 1.00, label: "Base Salary (PAYG)" },
  second_job: { rate: 0.80, label: "Second Job" },
  casual: { rate: 0.60, label: "Casual Income" },
  bonus: { rate: 0.80, label: "Bonus (avg 2yr)" },
  commission: { rate: 0.80, label: "Commission" },
  overtime_essential: { rate: 1.00, label: "Essential Overtime" },
  overtime_non_essential: { rate: 0.50, label: "Non-Essential Overtime" },
  allowances: { rate: 0.80, label: "Allowances" },
  rental_existing: { rate: 0.80, label: "Rental Income (Existing)" },
  rental_proposed: { rate: 0.70, label: "Rental Income (Proposed)" },
  investment_income: { rate: 0.80, label: "Investment Income" },
  government_payments: { rate: 1.00, label: "Government Payments" },
  self_employed: { rate: 0.80, label: "Self-Employed (2yr avg)" },
  other_taxable: { rate: 0.80, label: "Other Taxable" },
};
```

### 3.2 HEM Benchmark Table (Monthly)

```typescript
const HEM_BENCHMARKS = {
  single: {
    0: 1500,  // No dependents
    1: 2000,
    2: 2300,
    3: 2600,
  },
  couple: {
    0: 2200,
    1: 2600,
    2: 2900,
    3: 3200,  // 3+ dependents
  }
};
```

### 3.3 Liability Assessment Rules

```typescript
const LIABILITY_ASSESSMENT = {
  home_loan: "Use actual P&I repayment or calculate at assessment rate",
  investment_loan: "Use actual repayment (IO acceptable) + stress test",
  car_loan: "Use actual monthly repayment",
  personal_loan: "Use actual monthly repayment",
  credit_card: "3% of credit limit (not balance)",
  hecs: "Based on income threshold brackets",
  afterpay_bnpl: "5% of limit or actual monthly",
  other: "Use declared repayment",
};
```

### 3.4 Core Calculation Formula

```typescript
interface BorrowingCapacityResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  stressTestedCapacity: number;
  dtiRatio: number;
  assessmentRate: number;
  recommendations: string[];
  warnings: string[];
}

function calculateBorrowingCapacity(params: {
  shadedAnnualIncome: number;
  monthlyLivingExpenses: number;
  monthlyCommitments: number;
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
}): BorrowingCapacityResult {
  const { shadedAnnualIncome, monthlyLivingExpenses, monthlyCommitments, 
          interestRate, bufferRate, loanTermYears } = params;
  
  // Assessment rate = current rate + APRA buffer
  const assessmentRate = interestRate + bufferRate;
  const monthlyRate = (assessmentRate / 100) / 12;
  
  // Monthly net income available
  const monthlyIncome = shadedAnnualIncome / 12;
  const monthlySurplus = monthlyIncome - monthlyLivingExpenses - monthlyCommitments;
  
  // Max new repayment = available surplus
  const maxNewRepayment = Math.max(0, monthlySurplus);
  
  // Reverse-calculate max loan from repayment using P&I formula
  // Loan = Payment × [(1 - (1 + r)^-n) / r]
  const periods = loanTermYears * 12;
  const factor = (1 - Math.pow(1 + monthlyRate, -periods)) / monthlyRate;
  const borrowingCapacity = Math.round(maxNewRepayment * factor);
  
  // Stress test at +1% above assessment
  const stressRate = ((assessmentRate + 1) / 100) / 12;
  const stressFactor = (1 - Math.pow(1 + stressRate, -periods)) / stressRate;
  const stressTestedCapacity = Math.round(maxNewRepayment * stressFactor);
  
  // DTI ratio
  const totalAnnualDebt = (monthlyCommitments * 12) + (borrowingCapacity / loanTermYears);
  const dtiRatio = Math.round((totalAnnualDebt / shadedAnnualIncome) * 100) / 100;
  
  // Determine band
  let serviceabilityBand: 'green' | 'amber' | 'red';
  if (monthlySurplus > 500 && dtiRatio < 6) {
    serviceabilityBand = 'green';
  } else if (monthlySurplus > 0 && dtiRatio < 8) {
    serviceabilityBand = 'amber';
  } else {
    serviceabilityBand = 'red';
  }
  
  return {
    borrowingCapacity,
    monthlySurplus: Math.round(monthlySurplus),
    serviceabilityBand,
    stressTestedCapacity,
    dtiRatio,
    assessmentRate,
    recommendations: generateRecommendations(serviceabilityBand, dtiRatio, monthlySurplus),
    warnings: generateWarnings(dtiRatio, borrowingCapacity),
  };
}
```

---

## 4. Implementation Phases

### Phase 1: Foundation (Days 1-2)

| Task | Deliverable | Priority |
|------|-------------|----------|
| 1.1 | Database migration for `borrowing_capacity_assessments` | P0 |
| 1.2 | Edge function: `calculate-borrowing-capacity` | P0 |
| 1.3 | Utility: `src/utils/borrowingCapacityCalculations.ts` | P0 |
| 1.4 | Hook: `src/hooks/useBorrowingCapacity.ts` | P0 |

### Phase 2: UI Components (Days 3-4)

| Task | Deliverable | Priority |
|------|-------------|----------|
| 2.1 | `BorrowingCapacityCard.tsx` - Compact summary widget | P0 |
| 2.2 | `BorrowingCapacityModal.tsx` - Full calculator modal | P0 |
| 2.3 | `ResultsPanel.tsx` - Real-time results display | P0 |
| 2.4 | `IncomeSection.tsx` - Accordion with shading | P1 |
| 2.5 | `ExpensesSection.tsx` - Simple/Detailed toggle | P1 |
| 2.6 | `LiabilitiesSection.tsx` - Dynamic liability list | P1 |

### Phase 3: Integration (Day 5)

| Task | Deliverable | Priority |
|------|-------------|----------|
| 3.1 | Integrate into `ClientDetailsModal` (Insights tab) | P0 |
| 3.2 | Integrate into `ClientScoreCard` | P0 |
| 3.3 | Add to Portfolio Review Wizard as new step | P1 |
| 3.4 | Update Client Tracker with capacity column | P2 |

### Phase 4: Enhancements (Day 6+)

| Task | Deliverable | Priority |
|------|-------------|----------|
| 4.1 | Scenario modeling (what-if analysis) | P1 |
| 4.2 | Historical capacity tracking/charting | P2 |
| 4.3 | PDF export integration | P1 |
| 4.4 | Batch recalculation for all clients | P2 |

---

## 5. API Contract

### 5.1 Edge Function: `calculate-borrowing-capacity`

**Endpoint**: `POST /functions/v1/calculate-borrowing-capacity`

**Request Body**:
```typescript
interface CalculateBorrowingCapacityRequest {
  clientId: string;
  overrides?: {
    // Optional overrides for "what-if" scenarios
    grossAnnualIncome?: number;
    additionalIncome?: number;
    livingExpenses?: number;
    additionalLiabilities?: number;
    interestRate?: number;
    bufferRate?: number;
    loanTermYears?: number;
    proposedLoanAmount?: number;
  };
  saveResult?: boolean;  // Default: true
}
```

**Response**:
```typescript
interface CalculateBorrowingCapacityResponse {
  success: boolean;
  data?: {
    assessmentId: string;
    clientId: string;
    
    // Income Summary
    grossAnnualIncome: number;
    shadedAnnualIncome: number;
    incomeBreakdown: {
      component: string;
      grossAmount: number;
      shadingRate: number;
      shadedAmount: number;
    }[];
    
    // Expense Summary
    livingExpensesMonthly: number;
    expenseMethod: 'hem' | 'declared' | 'hybrid';
    hemBenchmark: number;
    
    // Liability Summary
    existingCommitmentsMonthly: number;
    liabilityBreakdown: {
      type: string;
      balance: number;
      limit?: number;
      monthlyServicing: number;
    }[];
    
    // Parameters
    interestRate: number;
    bufferRate: number;
    assessmentRate: number;
    loanTermYears: number;
    
    // Results
    borrowingCapacity: number;
    monthlySurplus: number;
    serviceabilityBand: 'green' | 'amber' | 'red';
    stressTestedCapacity: number;
    dtiRatio: number;
    
    // Guidance
    recommendations: string[];
    warnings: string[];
    assumptions: {
      key: string;
      value: string;
    }[];
    
    calculatedAt: string;
  };
  error?: string;
}
```

---

## 6. UI Component Specifications

### 6.1 BorrowingCapacityCard (Compact Widget)

```
┌──────────────────────────────────────────┐
│  💰 BORROWING CAPACITY        [Refresh]  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  $625,000                          │  │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░ 78% utilized    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Monthly Surplus     DTI Ratio           │
│  $1,234              5.2x                │
│                                          │
│  ┌─────────────────┐                     │
│  │  🟢 GREEN       │  Strong position    │
│  └─────────────────┘                     │
│                                          │
│  [View Full Assessment →]                │
└──────────────────────────────────────────┘
```

**States**:
- Loading (skeleton)
- No assessment (prompt to calculate)
- Calculated (show results)
- Error (show retry)

### 6.2 BorrowingCapacityModal (Full Calculator)

**Features**:
- Two-column layout (inputs left, results right)
- Collapsible accordion sections (Quickli-style)
- Real-time recalculation on input change
- Override capability for what-if scenarios
- Disclaimer banner at bottom

**Sections**:

1. **Applicants** - Pre-filled from client data
   - Primary/Secondary toggle
   - Relationship status
   - Dependants count

2. **Income** - Editable with shading display
   - Each income type shows: Gross → Shading% → Shaded Amount
   - Toggle for "Standard" vs "YTD Calculation"

3. **Living Expenses** - Simple/Detailed toggle
   - Simple: HEM benchmark (auto-calculated)
   - Detailed: Itemized expense categories

4. **Existing Liabilities** - Dynamic list
   - Auto-populated from `client_liabilities`
   - Add new liability button
   - Shows monthly servicing impact

5. **Securities & Properties** - From `client_properties`
   - Shows LVR, rental income
   - Identifies equity available

6. **Proposed Loan** - Optional
   - Loan amount, term, LVR
   - Calculates if affordable

---

## 7. Integration Points

### 7.1 Client Scorecard Enhancement

Add `BorrowingCapacityCard` below existing scores:

```tsx
// In ClientScoreCard.tsx
<BorrowingCapacityCard 
  clientId={clientId}
  variant="compact"
  onViewDetails={() => setShowModal(true)}
/>
```

### 7.2 Client Details Modal

Add as new tab or section in Insights:

```tsx
// In ClientDetailsModal.tsx - Insights tab
<TabsContent value="insights">
  <ClientScoreCard clientId={client.id} />
  <Separator className="my-4" />
  <BorrowingCapacityCard 
    clientId={client.id}
    variant="detailed"
  />
</TabsContent>
```

### 7.3 Portfolio Review Wizard

New step after Scorecard:

```tsx
// In review-wizard/index.tsx
const WIZARD_STEPS = [
  { id: 'completeness', component: DataCompletenessStep },
  { id: 'scorecard', component: ScorecardStep },
  { id: 'borrowing', component: BorrowingCapacityStep },  // NEW
  { id: 'metrics', component: MetricsReviewStep },
  // ...
];
```

### 7.4 PDF Export

Add section to Portfolio Analysis PDF:

```tsx
// In PortfolioAnalysisPDFGenerator.tsx
const borrowingSection = {
  title: 'Borrowing Capacity Assessment',
  content: [
    `Estimated Borrowing Capacity: ${formatCurrency(capacity)}`,
    `Serviceability Status: ${band}`,
    `Monthly Surplus: ${formatCurrency(surplus)}`,
    // recommendations...
  ]
};
```

---

## 8. File Structure

```
src/
├── components/
│   └── clients/
│       └── borrowing-capacity/
│           ├── BorrowingCapacityCard.tsx
│           ├── BorrowingCapacityModal.tsx
│           ├── sections/
│           │   ├── ApplicantSection.tsx
│           │   ├── IncomeSection.tsx
│           │   ├── ExpensesSection.tsx
│           │   ├── LiabilitiesSection.tsx
│           │   ├── SecuritiesSection.tsx
│           │   └── ProposedLoanSection.tsx
│           ├── ResultsPanel.tsx
│           └── ServiceabilityBadge.tsx
├── hooks/
│   └── useBorrowingCapacity.ts
├── utils/
│   └── borrowingCapacityCalculations.ts
└── types/
    └── borrowingCapacity.ts

supabase/
└── functions/
    └── calculate-borrowing-capacity/
        └── index.ts
```

---

## 9. Testing Strategy

### 9.1 Unit Tests
- Income shading calculations
- HEM lookup accuracy
- Liability servicing calculations
- Serviceability band determination

### 9.2 Integration Tests
- Edge function end-to-end
- Database persistence
- Client data aggregation

### 9.3 Scenario Tests
| Scenario | Expected Band | Notes |
|----------|---------------|-------|
| High income, low debt | Green | Ideal borrower |
| Moderate income, moderate debt | Amber | Proceed with caution |
| Low income, high debt | Red | Recommend debt reduction |
| Self-employed, variable income | Amber | Higher shading applied |
| Multiple properties, high LVR | Amber/Red | Equity constrained |

---

## 10. Compliance & Disclaimers

**Required Disclaimer** (visible in all views):
> "This calculator is for indicative purposes only and is not a replacement for professional mortgage advice. Borrowing capacity estimates are based on general lender criteria and may differ from actual loan approvals. Recommend consulting with a mortgage broker for formal assessment."

**Data Privacy**:
- All calculations stored with client consent
- No external API calls (all calculations local)
- RLS policies enforce access control

---

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Calculation accuracy vs broker estimate | ±10% |
| Time to first calculation | <3 seconds |
| Client data auto-population rate | >80% |
| User adoption (calculations per week) | 50+ |

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Inaccurate HEM benchmarks | Medium | Regular updates, allow overrides |
| Missing client income data | High | Prompt for data completion |
| Interest rate volatility | Low | Configurable rate, use RBA cash rate |
| Regulatory changes | Medium | Modular calculation engine |

---

## Next Steps

1. **Approve this plan**
2. **Phase 1**: Create database migration + edge function
3. **Phase 2**: Build UI components
4. **Phase 3**: Integrate into existing views
5. **Phase 4**: Testing and refinement

Ready to proceed with Phase 1?

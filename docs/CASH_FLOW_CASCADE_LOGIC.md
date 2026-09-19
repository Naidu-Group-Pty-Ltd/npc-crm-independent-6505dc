# Cash Flow Analysis - Relational Cascade Logic

## Overview

The 10-year cash flow projection table implements **chained cascade logic** where editing one value automatically updates all dependent values in subsequent years.

## Field Classification

### Rate Drivers (Affect downstream calculations)
| Field | Cascade Behavior |
|-------|------------------|
| **Capital Growth %** | Affects next year's property value |
| **CPI %** | Affects next year's rent & fixed expenses |
| **Interest Rate %** | Triggers full amortization engine recalculation |

### Chained Cascade Fields (Grow from previous year)
| Field | Formula |
|-------|---------|
| **Property Value** | `Year[N] = Year[N-1] × (1 + capitalGrowthRate[N])` |
| **Rental Income** | `Year[N] = Year[N-1] × (1 + cpiRate[N])` |
| **Fixed Expenses** | `Year[N] = Year[N-1] × (1 + cpiRate[N])` |

### Hybrid Fields
| Field | Behavior |
|-------|----------|
| **Property Expenses** | Fixed portion chains with CPI; Management fee = 7% of current rent |

### Locked Fields (No cascade - direct override)
| Field | Behavior |
|-------|----------|
| **Interest Payment** | Direct override, doesn't affect subsequent years |
| **Principal Payment** | Direct override, doesn't affect subsequent years |
| **Depreciation** | Uses schedule or direct override |
| **Land Tax** | Direct override |
| **LMI** | One-off Year 1 acquisition cost; impacts initial investment, ROI, and break-even |

## Dependency Graph

```
capitalGrowthRate[N] ──► propertyMarketValue[N] ──► equity[N], LVR[N], yields[N]
                                    │
                                    ▼
                         propertyMarketValue[N+1]

cpiGrowthRate[N] ──► rentalIncome[N] ──► rentalIncome[N+1]
              │              │
              │              └──► propertyExpenses[N] (mgmt fee portion)
              │
              └──► fixedExpenses[N] ──► fixedExpenses[N+1]

interestRate[N] ──► AMORTIZATION ENGINE ──► interestPayments[N]
                                       └──► principalPayments[N]
                                       └──► loanBalance[N] ──► equity[N]
```

## Example: Overriding CPI in Year 3

**Scenario:**
- Base CPI: 3%
- Year 2 rent: $30,000
- Year 3 CPI override: 5%

**Result:**
- Year 3 rent = $30,000 × 1.05 = $31,500 (uses overridden CPI)
- Year 4 rent = $31,500 × 1.03 = $32,445 (chains from Year 3, uses base CPI)
- Year 5+ continues chaining from previous year

## Interest Rate Changes

Interest rate overrides are passed to the amortization engine as `rateChanges[]`. This properly recalculates:
- Loan balance for all subsequent years
- Interest payments based on new rate and remaining balance
- Principal payments adjusted for rate change

## Implementation Location

- Primary projections: `CashFlowAnalysisModal.tsx` → `projections` useMemo (~lines 768-1003)
- Comparison projections: `CashFlowAnalysisModal.tsx` → `allComparisonProjections` useMemo (~lines 436-589)
- Amortization engine: `mortgageCalculations.ts` → `get10YearLoanProjection()`

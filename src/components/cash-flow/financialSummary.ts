export interface CashFlowFinancialSummary {
  purchasePrice: number | null;
  weeklyRent: number | null;
}

/**
 * The four fields the two headline figures can come from.
 *
 * Declared structurally rather than as `InvestmentReport` so anything carrying
 * these fields can be resolved by the one rule — the comparison picker offers a
 * candidate shape narrower than a full report, and a second copy of this
 * precedence is exactly how a list and a comparison come to disagree about
 * which reports have figures. `InvestmentReport` satisfies it, so every
 * existing caller is unchanged.
 */
export interface CashFlowFinancialSource {
  cash_flow_purchase_price?: number | null;
  cash_flow_weekly_rent?: number | null;
  manual_overrides?: any;
  financial_calculations?: any;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    const normalised = value.replace(/[$,\s]/g, '');
    if (!normalised) return null;
    const parsed = Number(normalised);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toPositiveNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * Resolve the two headline figures using the same precedence as the cash-flow
 * engine. List responses expose pre-resolved scalars; detail responses retain
 * the historical JSON shapes, so this also supports every persisted alias.
 */
export function resolveCashFlowFinancialSummary(report: CashFlowFinancialSource): CashFlowFinancialSummary {
  const financials = report.financial_calculations ?? {};
  const overrides = report.manual_overrides ?? {};

  return {
    purchasePrice: firstPositive(
      report.cash_flow_purchase_price,
      overrides.purchasePrice,
      financials.initialCosts?.propertyValue,
      financials.purchasePrice,
      financials.propertyValue,
      financials.purchase_price,
    ),
    weeklyRent: firstPositive(
      report.cash_flow_weekly_rent,
      overrides.weeklyRent,
      financials.income?.weeklyRent,
      financials.weeklyRent,
      financials.weekly_rent,
    ),
  };
}
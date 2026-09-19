/**
 * Shared AML finance comparison engine (Phase 7).
 *
 * One deterministic implementation of funding-reconciliation discrepancy
 * detection, used by both the staff-side `aml-finance` function and the
 * broker-side `finance-portal-aml-requests` function so a finance-portal
 * submission is compared exactly the way a staff-entered snapshot is.
 */

export type Comparison = {
  id?: string;
  case_id: string;
  purchase_file_id?: string | null;
  source?: string;
  purchase_price?: number | null;
  loan_amount?: number | null;
  lender?: string | null;
  lvr?: number | null;
  borrower_contribution?: number | null;
  refi_equity?: number | null;
  gift_amount?: number | null;
  gift_source?: string | null;
  smsf_lrba?: boolean;
  smsf_details?: any;
  loan_purpose?: string | null;
  funding_notes?: string | null;
  raw_payload?: any;
};

/** Deterministic discrepancy engine. */
export function detectDiscrepancies(current: Comparison, previous: Comparison | null, pf: any | null): Array<{
  kind: string; severity: "info"|"low"|"medium"|"high"|"critical"; summary: string; detail?: string;
  expected_value?: any; observed_value?: any;
}> {
  const out: any[] = [];
  const price = Number(current.purchase_price ?? 0);
  const loan = Number(current.loan_amount ?? 0);
  const contribution = Number(current.borrower_contribution ?? 0);
  const gift = Number(current.gift_amount ?? 0);
  const refi = Number(current.refi_equity ?? 0);
  const lvr = Number(current.lvr ?? 0);

  if (price > 0 && loan > 0) {
    const impliedLvr = (loan / price) * 100;
    if (lvr > 0 && Math.abs(impliedLvr - lvr) > 2.5) {
      out.push({
        kind: "lvr_mismatch", severity: "medium",
        summary: `Declared LVR ${lvr.toFixed(1)}% differs from loan÷price (${impliedLvr.toFixed(1)}%)`,
        expected_value: { lvr: Number(impliedLvr.toFixed(2)) }, observed_value: { lvr },
      });
    }
    const fundingGap = price - (loan + contribution + gift + refi);
    if (Math.abs(fundingGap) > 5000) {
      out.push({
        kind: "funding_gap", severity: fundingGap > 20000 ? "high" : "medium",
        summary: `Funding sources do not reconcile to price (gap ${fundingGap.toLocaleString(undefined,{maximumFractionDigits:0})})`,
        detail: `price=${price}, loan+contribution+gift+refi=${loan+contribution+gift+refi}`,
        expected_value: { total: price }, observed_value: { total: loan + contribution + gift + refi },
      });
    }
  }

  if (gift > 0 && !current.gift_source) {
    out.push({
      kind: "unexplained_gift", severity: "high",
      summary: `Gift of ${gift.toLocaleString()} declared without documented source`,
    });
  }
  if (gift > 0 && price > 0 && gift / price > 0.2) {
    out.push({
      kind: "large_gift_ratio", severity: "high",
      summary: `Gift represents ${((gift/price)*100).toFixed(0)}% of purchase price — enhanced SoF review required`,
    });
  }
  if (lvr > 95) {
    out.push({
      kind: "lvr_over_95", severity: "medium",
      summary: `LVR ${lvr.toFixed(1)}% exceeds 95% — confirm LMI + serviceability`,
    });
  }
  if (current.smsf_lrba) {
    out.push({
      kind: "smsf_lrba_declared", severity: "info",
      summary: "SMSF LRBA declared — verify trustee structure, custodian bare trust, single-acquirable-asset rule",
    });
  }

  if (previous) {
    if (previous.lender && current.lender && previous.lender !== current.lender) {
      out.push({
        kind: "lender_changed", severity: "low",
        summary: `Lender changed from ${previous.lender} to ${current.lender}`,
        expected_value: { lender: previous.lender }, observed_value: { lender: current.lender },
      });
    }
    const prevLoan = Number(previous.loan_amount ?? 0);
    if (prevLoan > 0 && loan > 0 && Math.abs(loan - prevLoan) / prevLoan > 0.1) {
      out.push({
        kind: "loan_amount_shift", severity: "medium",
        summary: `Loan amount moved by ${(((loan-prevLoan)/prevLoan)*100).toFixed(1)}% vs last snapshot`,
        expected_value: { loan_amount: prevLoan }, observed_value: { loan_amount: loan },
      });
    }
  }

  if (pf) {
    const pfPrice = Number(pf.purchase_price ?? 0);
    if (pfPrice > 0 && price > 0 && Math.abs(pfPrice - price) > 5000) {
      out.push({
        kind: "price_mismatch_pf", severity: "medium",
        summary: `Finance portal purchase price ${pfPrice.toLocaleString()} differs from AML capture ${price.toLocaleString()}`,
        expected_value: { purchase_price: pfPrice }, observed_value: { purchase_price: price },
      });
    }
    if (pf.lender && current.lender && String(pf.lender).toLowerCase() !== String(current.lender).toLowerCase()) {
      out.push({
        kind: "lender_mismatch_pf", severity: "low",
        summary: `Finance portal lender "${pf.lender}" differs from AML capture "${current.lender}"`,
      });
    }
  }

  return out;
}

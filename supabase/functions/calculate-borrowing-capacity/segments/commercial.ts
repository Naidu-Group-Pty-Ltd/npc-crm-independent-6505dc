// Phase 2 — Commercial segment evaluator.
// Pragmatic, edge-safe wrapper around the same math used in
// src/utils/commercial/borrowing/commercialBorrowingEngine.ts (ICR/DSCR/LVR caps).
// Pulls inputs directly from commercial_properties + commercial_leases (+ latest
// commercial_dcf_runs for loan + interest rate fallbacks).

import type { SegmentContribution, SegmentPolicy, SegmentPropertyRow } from './types.ts';

interface CommercialPropertyRow {
  id: string;
  client_id: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  valuation: number | null;
  purchase_price: number | null;
  outgoings_recoverable: any;
}

interface CommercialLeaseRow {
  property_id: string;
  base_rent_pa: number | null;
  outgoings_recovery_pct: number | null;
  status: string | null;
}

interface CommercialDcfRow {
  property_id: string;
  loan_amount: number | null;
  interest_rate: number | null;
  loan_term_years: number | null;
  outputs: any;
  updated_at: string;
}

function annualPI(loan: number, ratePct: number, termYears: number): number {
  if (loan <= 0 || ratePct <= 0 || termYears <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loan / termYears;
  const m = loan * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return m * 12;
}

function maxLoanByIcr(noi: number, ratePct: number, minIcr: number): number {
  if (noi <= 0 || ratePct <= 0 || minIcr <= 0) return 0;
  return (noi / minIcr) / (ratePct / 100);
}

function maxLoanByDscr(noi: number, ratePct: number, termYears: number, minDscr: number): number {
  if (noi <= 0 || ratePct <= 0 || minDscr <= 0 || termYears <= 0) return 0;
  const targetAnnualPi = noi / minDscr;
  const r = ratePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return (targetAnnualPi / 12) * n;
  return (targetAnnualPi / 12) * (1 - Math.pow(1 + r, -n)) / r;
}

export async function evaluateCommercialSegment(
  supabase: any,
  clientId: string,
  policy: SegmentPolicy,
): Promise<SegmentContribution> {
  const empty: SegmentContribution = {
    assetClass: 'commercial', propertyCount: 0, properties: [],
    grossAnnualIncome: 0, shadedAnnualIncome: 0, annualDebtService: 0,
    maxLoanByIcr: 0, maxLoanByDscr: 0, maxLoanByLvr: 0,
    headroom: 0, icr: 0, dscr: 0, weightedLvr: 0,
    band: 'green', warnings: [], assumptions: [],
  };

  const { data: props, error: propErr } = await supabase
    .from('commercial_properties')
    .select('id, client_id, address, suburb, state, postcode, valuation, purchase_price, outgoings_recoverable')
    .eq('client_id', clientId);

  if (propErr) {
    empty.warnings.push(`commercial fetch failed: ${propErr.message}`);
    return empty;
  }
  const properties: CommercialPropertyRow[] = props || [];
  if (properties.length === 0) return empty;

  const propIds = properties.map(p => p.id);
  const [leasesRes, dcfRes, finRes, capexRes] = await Promise.all([
    supabase.from('commercial_leases').select('property_id, base_rent_pa, outgoings_recovery_pct, status').in('property_id', propIds),
    supabase.from('commercial_dcf_runs').select('property_id, loan_amount, interest_rate, loan_term_years, outputs, updated_at').in('property_id', propIds).order('updated_at', { ascending: false }),
    supabase.from('commercial_financing').select('property_id, loan_balance, loan_amount, interest_rate, loan_term_years').in('property_id', propIds),
    supabase.from('commercial_capex').select('property_id, year, amount').in('property_id', propIds),
  ]);
  const leases: CommercialLeaseRow[] = leasesRes.data || [];
  const dcfRuns: CommercialDcfRow[] = dcfRes.data || [];
  const financingByProp = new Map<string, any>();
  for (const f of (finRes.data || [])) financingByProp.set(f.property_id, f);
  // Wave E: amortise capex reserve per property over a 5-yr forward horizon.
  const capexAnnualByProp = new Map<string, number>();
  const capexHorizon = 5;
  for (const c of (capexRes.data || [])) {
    const amt = Number(c.amount) || 0;
    if (amt <= 0) continue;
    const prev = capexAnnualByProp.get(c.property_id) ?? 0;
    capexAnnualByProp.set(c.property_id, prev + amt / capexHorizon);
  }

  // Latest DCF per property
  const latestDcfByProp = new Map<string, CommercialDcfRow>();
  for (const r of dcfRuns) {
    if (!latestDcfByProp.has(r.property_id)) latestDcfByProp.set(r.property_id, r);
  }

  let totalNoi = 0;
  let totalDebtService = 0;
  let totalLoanBalance = 0;
  let totalValue = 0;
  const propertyRows: SegmentPropertyRow[] = [];
  const assumptions: string[] = [
    `Commercial assessment rate ${policy.commercial.assessmentRatePct}% over ${policy.commercial.amortYears}yr P&I`,
    `Capex reserve amortised over ${capexHorizon} years deducted from NOI per property`,
  ];
  const warnings: string[] = [];

  for (const p of properties) {
    const propLeases = leases.filter(l => l.property_id === p.id && (l.status === 'occupied' || l.status === 'holdover'));
    const grossRent = propLeases.reduce((sum, l) => sum + (Number(l.base_rent_pa) || 0), 0);
    const recoveryWeighted = propLeases.length
      ? propLeases.reduce((sum, l) => sum + (Number(l.outgoings_recovery_pct) || 0), 0) / propLeases.length
      : 0;
    // Assume opex = 25% of gross rent if no recovery info; net recoveries reduce opex
    const grossOpex = grossRent * 0.25;
    const netOpex = grossOpex * Math.max(0, 1 - (recoveryWeighted / 100));
    const capexReserve = capexAnnualByProp.get(p.id) ?? 0;
    const noi = Math.max(0, grossRent - netOpex - capexReserve);

    const dcf = latestDcfByProp.get(p.id);
    const fin = financingByProp.get(p.id);
    // Relational financing wins; DCF is fallback; policy defaults last.
    const loanBalance = Number(fin?.loan_balance ?? fin?.loan_amount ?? dcf?.loan_amount) || 0;
    const interestRate = Number(fin?.interest_rate ?? dcf?.interest_rate) || policy.commercial.assessmentRatePct;
    const termYears = Number(fin?.loan_term_years ?? dcf?.loan_term_years) || policy.commercial.amortYears;
    const value = Number(p.valuation) || Number(p.purchase_price) || 0;
    const debtService = annualPI(loanBalance, Math.max(interestRate, policy.commercial.assessmentRatePct), termYears);

    totalNoi += noi;
    totalDebtService += debtService;
    totalLoanBalance += loanBalance;
    totalValue += value;

    propertyRows.push({
      id: p.id,
      address: [p.address, p.suburb, p.state, p.postcode].filter(Boolean).join(', ') || p.address,
      value, loanBalance, interestRate, monthlyRepayment: debtService / 12, noiPa: noi,
    });

    if (noi <= 0 && propLeases.length === 0) warnings.push(`No active lease on commercial property ${p.id.slice(0, 8)}`);
    if (loanBalance > 0 && !fin && !dcf) warnings.push(`No financing or DCF run on commercial property ${p.id.slice(0, 8)} — using defaults`);
  }

  const assessRate = policy.commercial.assessmentRatePct;
  const icrCap = maxLoanByIcr(totalNoi, assessRate, policy.commercial.minIcr);
  const dscrCap = maxLoanByDscr(totalNoi, assessRate, policy.commercial.amortYears, policy.commercial.minDscr);
  const lvrCap = totalValue * policy.commercial.maxLvr;
  const supportable = Math.min(icrCap, dscrCap, lvrCap);
  const headroom = supportable - totalLoanBalance;

  const annualInterestAtBalance = totalLoanBalance * (assessRate / 100);
  const icr = annualInterestAtBalance > 0 ? totalNoi / annualInterestAtBalance : 0;
  const dscr = totalDebtService > 0 ? totalNoi / totalDebtService : 0;
  const weightedLvr = totalValue > 0 ? totalLoanBalance / totalValue : 0;

  let band: 'green' | 'amber' | 'red' = 'green';
  if (icr < policy.commercial.minIcr || dscr < policy.commercial.minDscr || weightedLvr > policy.commercial.maxLvr) band = 'red';
  else if (icr < policy.commercial.minIcr * 1.15 || dscr < policy.commercial.minDscr * 1.15) band = 'amber';

  return {
    assetClass: 'commercial',
    propertyCount: properties.length,
    properties: propertyRows,
    grossAnnualIncome: totalNoi,
    shadedAnnualIncome: totalNoi,
    annualDebtService: totalDebtService,
    maxLoanByIcr: Math.round(icrCap),
    maxLoanByDscr: Math.round(dscrCap),
    maxLoanByLvr: Math.round(lvrCap),
    headroom: Math.round(headroom),
    icr: Math.round(icr * 100) / 100,
    dscr: Math.round(dscr * 100) / 100,
    weightedLvr: Math.round(weightedLvr * 10000) / 10000,
    band, warnings, assumptions,
  };
}

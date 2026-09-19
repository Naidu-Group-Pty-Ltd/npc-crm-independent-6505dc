// Phase 2 — Industrial segment evaluator.
// Mirrors src/utils/industrial/industrialBorrowingCapacity.ts in a lightweight,
// edge-safe form. Inputs come from industrial_properties (+ industrial_financing
// JSONB column added in Phase 1) and industrial_tenancies.

import type { SegmentContribution, SegmentPolicy, SegmentPropertyRow } from './types.ts';

interface IndustrialPropertyRow {
  id: string;
  client_id: string | null;
  property_name: string | null;
  street: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  current_valuation: number | null;
  purchase_price: number | null;
  industrial_financing: any;
}

interface IndustrialTenancyRow {
  property_id: string;
  base_rent_pa: number | null;
  outgoings_recovery_type: string | null;
}

function annualPI(loan: number, ratePct: number, termYears: number): number {
  if (loan <= 0 || ratePct <= 0 || termYears <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return loan / termYears;
  return loan * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) * 12;
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

export async function evaluateIndustrialSegment(
  supabase: any,
  clientId: string,
  policy: SegmentPolicy,
): Promise<SegmentContribution> {
  const empty: SegmentContribution = {
    assetClass: 'industrial', propertyCount: 0, properties: [],
    grossAnnualIncome: 0, shadedAnnualIncome: 0, annualDebtService: 0,
    maxLoanByIcr: 0, maxLoanByDscr: 0, maxLoanByLvr: 0,
    headroom: 0, icr: 0, dscr: 0, weightedLvr: 0,
    band: 'green', warnings: [], assumptions: [],
  };

  const { data: props, error: propErr } = await supabase
    .from('industrial_properties')
    .select('id, client_id, property_name, street, suburb, state, postcode, current_valuation, purchase_price, industrial_financing')
    .eq('client_id', clientId);

  if (propErr) {
    empty.warnings.push(`industrial fetch failed: ${propErr.message}`);
    return empty;
  }
  const properties: IndustrialPropertyRow[] = props || [];
  if (properties.length === 0) return empty;

  const propIds = properties.map(p => p.id);
  const { data: tenancyData } = await supabase
    .from('industrial_tenancies')
    .select('property_id, base_rent_pa, outgoings_recovery_type')
    .in('property_id', propIds);
  const tenancies: IndustrialTenancyRow[] = tenancyData || [];

  // Phase Wave-C: prefer relational industrial_financing rows; fall back to legacy JSONB.
  // Wave E: also pull industrial_capex so NOI is net of reserve.
  const [finRes, capexRes] = await Promise.all([
    supabase
      .from('industrial_financing')
      .select('property_id, lender, loan_amount, loan_balance, interest_rate, loan_term_years, io_period_years, repayment_type, lvr_pct')
      .in('property_id', propIds),
    supabase.from('industrial_capex').select('property_id, year, amount').in('property_id', propIds),
  ]);
  const financingByProp = new Map<string, any>();
  for (const row of (finRes.data || [])) financingByProp.set(row.property_id, row);
  const capexHorizon = 5;
  const capexAnnualByProp = new Map<string, number>();
  for (const c of (capexRes.data || [])) {
    const amt = Number(c.amount) || 0;
    if (amt <= 0) continue;
    const prev = capexAnnualByProp.get(c.property_id) ?? 0;
    capexAnnualByProp.set(c.property_id, prev + amt / capexHorizon);
  }

  let totalNoi = 0;
  let totalDebtService = 0;
  let totalLoanBalance = 0;
  let totalValue = 0;
  const rows: SegmentPropertyRow[] = [];
  const warnings: string[] = [];
  const assumptions = [
    `Industrial assessment rate ${policy.industrial.assessmentRatePct}% over ${policy.industrial.amortYears}yr P&I`,
    `Capex reserve amortised over ${capexHorizon} years deducted from NOI per property`,
  ];

  for (const p of properties) {
    const tens = tenancies.filter(t => t.property_id === p.id);
    const grossRent = tens.reduce((s, t) => s + (Number(t.base_rent_pa) || 0), 0);
    // Industrial: typical net-leased; if recovery_type is 'net' assume opex passes through fully (~10% opex), else 20%.
    const allNet = tens.length > 0 && tens.every(t => (t.outgoings_recovery_type || '').toLowerCase().includes('net'));
    const opexRate = allNet ? 0.10 : 0.20;
    const capexReserve = capexAnnualByProp.get(p.id) ?? 0;
    const noi = Math.max(0, grossRent * (1 - opexRate) - capexReserve);

    const relational = financingByProp.get(p.id);
    const legacy = (p.industrial_financing && typeof p.industrial_financing === 'object') ? p.industrial_financing : {};
    const fin = relational ?? legacy;
    const finSource: 'relational' | 'legacy' | 'none' = relational ? 'relational' : (Object.keys(legacy).length ? 'legacy' : 'none');
    const loanBalance = Number(fin.loan_balance ?? fin.loan_amount) || 0;
    const interestRate = Number(fin.interest_rate) || policy.industrial.assessmentRatePct;
    const termYears = Number(fin.loan_term_years) || policy.industrial.amortYears;
    const value = Number(p.current_valuation) || Number(p.purchase_price) || 0;
    const debtService = annualPI(loanBalance, Math.max(interestRate, policy.industrial.assessmentRatePct), termYears);

    totalNoi += noi;
    totalDebtService += debtService;
    totalLoanBalance += loanBalance;
    totalValue += value;

    rows.push({
      id: p.id,
      address: [p.property_name || p.street, p.suburb, p.state, p.postcode].filter(Boolean).join(', '),
      value, loanBalance, interestRate, monthlyRepayment: debtService / 12, noiPa: noi,
    });

    if (noi <= 0 && tens.length === 0) warnings.push(`No tenancy on industrial property ${p.id.slice(0, 8)}`);
    if (loanBalance > 0 && finSource === 'none') warnings.push(`No industrial_financing for property ${p.id.slice(0, 8)} — using policy defaults`);
    if (finSource === 'legacy') assumptions.push(`Industrial ${p.id.slice(0, 8)}: financing from legacy JSONB column (consider migrating to industrial_financing table)`);
  }

  const ar = policy.industrial.assessmentRatePct;
  const icrCap = maxLoanByIcr(totalNoi, ar, policy.industrial.minIcr);
  const dscrCap = maxLoanByDscr(totalNoi, ar, policy.industrial.amortYears, policy.industrial.minDscr);
  const lvrCap = totalValue * policy.industrial.maxLvr;
  const supportable = Math.min(icrCap, dscrCap, lvrCap);
  const headroom = supportable - totalLoanBalance;

  const annualInterestAtBalance = totalLoanBalance * (ar / 100);
  const icr = annualInterestAtBalance > 0 ? totalNoi / annualInterestAtBalance : 0;
  const dscr = totalDebtService > 0 ? totalNoi / totalDebtService : 0;
  const weightedLvr = totalValue > 0 ? totalLoanBalance / totalValue : 0;

  let band: 'green' | 'amber' | 'red' = 'green';
  if (icr < policy.industrial.minIcr || dscr < policy.industrial.minDscr || weightedLvr > policy.industrial.maxLvr) band = 'red';
  else if (icr < policy.industrial.minIcr * 1.15 || dscr < policy.industrial.minDscr * 1.15) band = 'amber';

  return {
    assetClass: 'industrial',
    propertyCount: properties.length,
    properties: rows,
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

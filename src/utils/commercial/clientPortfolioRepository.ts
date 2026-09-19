import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import type { ClientProfile, ClientScenario } from './clientPortfolioTypes';

const n = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const nameOf = (c: any) => [c?.primary_first_name, c?.primary_surname].filter(Boolean).join(' ') || c?.name || c?.clientName || 'Unknown Client';

export interface ClientProfileOption { clientId: string; clientName: string; source: 'supabase'; }

export async function searchClientProfiles(): Promise<ClientProfileOption[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', { mode: 'list', listOptions: { select: 'id, primary_first_name, primary_surname', orderBy: 'primary_first_name', orderAsc: true } });
    if (error) throw new Error(error.message);
    const records = data?.clients || data?.records || [];
    const mapped = records.map((r: any) => ({ clientId: r.id || r.client?.id, clientName: nameOf(r.client || r), source: 'supabase' as const })).filter((r: ClientProfileOption) => !!r.clientId);
    if (mapped.length) return mapped;
  } catch (err) {
    console.warn('[clientPortfolioRepository] client search failed', err);
  }
  return [];
}

function mapClientDataToProfile(clientId: string, payload: any): ClientProfile {
  const client = payload?.client || payload?.clients?.[0]?.client || payload?.clients?.[0] || payload || {};
  const properties = payload?.properties || payload?.clients?.[0]?.properties || [];
  const assets = payload?.assets || [];
  const liabilities = payload?.liabilities || [];
  const income = payload?.income || [];
  const business = payload?.businessFinancials || payload?.business_financials || {};
  const residentialAssets = properties.filter((p: any) => !['commercial', 'industrial'].includes(String(p.asset_class || p.property_type || '').toLowerCase())).map((p: any) => ({ id: p.id, address: p.address || p.full_address || 'Residential asset', assetType: 'residential' as const, subtype: p.property_type, currentValue: n(p.valuation ?? p.current_value ?? p.value), loanBalance: n(p.loan_balance), annualRent: n(p.rent_pa ?? p.annual_rent), expenses: n(p.expenses_pa) }));
  const commercialAssets = properties.filter((p: any) => String(p.asset_class || p.property_type || '').toLowerCase().includes('commercial')).map((p: any) => ({ id: p.id, address: p.address || p.full_address || 'Commercial asset', assetType: 'commercial' as const, subtype: p.asset_subtype || p.property_type, currentValue: n(p.valuation ?? p.current_value ?? p.value), loanBalance: n(p.loan_balance), annualRent: n(p.gross_passing_rent_pa ?? p.rent_pa), expenses: n(p.expenses_pa), noi: n(p.noi), leaseStatus: p.lease_status, capRate: n(p.cap_rate) }));
  const industrialAssets = properties.filter((p: any) => String(p.asset_class || p.property_type || '').toLowerCase().includes('industrial')).map((p: any) => ({ id: p.id, address: p.address || p.full_address || 'Industrial asset', assetType: 'industrial' as const, subtype: p.asset_subtype || p.property_type, currentValue: n(p.valuation ?? p.current_value ?? p.value), loanBalance: n(p.loan_balance), annualRent: n(p.gross_passing_rent_pa ?? p.rent_pa), expenses: n(p.expenses_pa), noi: n(p.noi), gla: n(p.gla_sqm ?? p.nla_sqm), siteArea: n(p.site_area_sqm), siteCover: n(p.site_cover), environmentalStatus: p.environmental_status || 'Unknown', asbestosStatus: p.asbestos_status || 'Unknown' }));
  const totalLiabilities = liabilities.reduce((sum: number, l: any) => sum + n(l.balance ?? l.limit ?? l.amount), 0);
  const annualDebtService = liabilities.reduce((sum: number, l: any) => sum + n(l.annual_repayment ?? l.annual_debt_service), 0);
  const cashAssets = assets.filter((a: any) => /cash|offset/i.test(String(a.asset_type || a.type || ''))).reduce((sum: number, a: any) => sum + n(a.value ?? a.balance), 0);
  const shareValue = assets.filter((a: any) => /share|etf|managed/i.test(String(a.asset_type || a.type || ''))).reduce((sum: number, a: any) => sum + n(a.value ?? a.balance), 0);
  return { clientId, clientName: nameOf(client), lastUpdated: client.updated_at || new Date().toISOString(), personalIncome: income.reduce((sum: number, i: any) => sum + n(i.annual_amount ?? i.amount), 0), businessIncome: n(business.ebitda_npbt ?? business.ebitda), ownershipStructures: [], residentialAssets, commercialAssets, industrialAssets, sharePortfolio: { portfolioValue: shareValue, listedShares: shareValue, etfs: 0, managedFunds: 0, dividendIncome: 0, marginLoan: 0, liquidityHaircutPct: 20, availableLiquidValue: shareValue * 0.8 }, cashAndOffsets: { cashBalance: cashAssets, offsetBalance: 0, businessCash: n(business.cash_reserves), availableEquityContribution: cashAssets + shareValue * 0.8, postSettlementLiquidity: cashAssets }, otherInvestments: 0, liabilities: { residentialLoans: 0, commercialLoans: 0, businessLoans: totalLiabilities, equipmentFinance: 0, vehicleFinance: 0, creditCards: 0, overdrafts: 0, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService }, existingLoans: { residentialLoans: 0, commercialLoans: 0, businessLoans: totalLiabilities, equipmentFinance: 0, vehicleFinance: 0, creditCards: 0, overdrafts: 0, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService }, businessFinancials: { businessRevenue: n(business.revenue), ebitdaNpbt: business.ebitda_npbt ?? business.ebitda ?? null, addbacks: n(business.addbacks), directorDrawings: n(business.director_drawings), existingRent: n(business.existing_rent), existingDebtService: n(business.existing_debt_service), equipmentFinance: n(business.equipment_finance), workingCapitalRequirement: n(business.working_capital_requirement), basAvailable: !!business.bas_available, financialsAvailable: !!business.financials_available, taxReturnsAvailable: !!business.tax_returns_available }, guarantors: [], taxProfile: {}, gstProfile: {}, latestBorrowingCapacity: undefined, scenarios: [] };
}

export async function fetchClientProfile(clientId: string): Promise<ClientProfile> {
  const { data, error } = await invokeSecureFunction('get-client-data', { clientId, include: { client: true, properties: true, employment: true, income: true, assets: true, liabilities: true, expenses: true, borrowingCapacity: true } });
  if (error) throw new Error(error.message);
  return mapClientDataToProfile(clientId, data);
}

export async function persistClientScenario(scenario: ClientScenario): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await invokeSecureFunction('manage-bc-scenarios', { operation: 'create', clientId: scenario.clientId, data: { name: scenario.scenarioName, is_base: scenario.scenarioType === 'Base Current Position', payload: scenario } });
    if (error) throw new Error(error.message);
    return { ok: true, id: data?.item?.id || scenario.scenarioId };
  } catch (err: any) {
    try {
      const { data, error } = await supabase.from('bc_scenarios').insert({ client_id: scenario.clientId, name: scenario.scenarioName, is_base: scenario.scenarioType === 'Base Current Position', payload: scenario as any }).select('id').single();
      if (error) throw error;
      return { ok: true, id: data?.id };
    } catch (fallbackErr: any) {
      return { ok: false, error: fallbackErr?.message || err?.message || 'Scenario persistence failed' };
    }
  }
}

export async function persistCommittedScenarioAssessment(scenario: ClientScenario): Promise<{ ok: boolean; error?: string }> {
  const current = scenario.resultingPosition;
  try {
    const { error } = await supabase.from('borrowing_capacity_assessments').insert({ client_id: scenario.clientId, borrowing_capacity: Math.max(0, current.borrowingCapacity), gross_annual_income: Math.max(0, current.annualGrossIncome), shaded_annual_income: Math.max(0, current.annualGrossIncome), existing_commitments_monthly: Math.max(0, current.annualDebtService / 12), living_expenses_monthly: 0, monthly_surplus: Math.round(current.afterTaxCashflow / 12), serviceability_band: current.riskRating, proposed_loan_amount: Math.max(0, (scenario.proposedChanges as any).proposedDebt ?? 0), recommendations: { scenario }, assumptions: { source: 'Commercial / Industrial scenario commit', currentPosition: scenario.currentPositionSnapshot, resultingPosition: scenario.resultingPosition } as any, warnings: scenario.warnings } as any);
    if (error) throw error;
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err?.message || 'Assessment persistence failed' }; }
}

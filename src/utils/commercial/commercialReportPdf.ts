/**
 * Commercial Investment Report — PDF Generator (client-side, jsPDF)
 *
 * Produces a Dark & Gold branded A4 PDF covering the full CRE schema:
 *   1. Cover               2. Executive Summary
 *   3. Asset Overview      4. Tenancy Schedule (rent roll)
 *   5. Income Analysis     6. Valuation & Yield
 *   7. DCF & Returns       8. Debt Structure (ICR/DSCR)
 *   9. Risk Assessment    10. Recommendation
 *  11. Disclaimer
 *
 * Self-contained — pulls live commercial data and runs the engines in
 * `src/utils/commercial/*`. No edge function dependency for v1.
 */
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import type { CommercialProperty, CommercialLease } from '@/hooks/useCommercialProperties';
import { commercialApi } from '@/hooks/useCommercialProperties';
import {
  calculateNoi,
  capRate,
  calculateYields,
  calculateWale,
  calculateCoverage,
  calculateCommercialBc,
  runDcf,
} from '@/utils/commercial';


// ─── Design tokens (parity with StrategyRationalePDF) ──────────────────────
const GOLD = { r: 212, g: 168, b: 67 };       // matches dark-gold theme primary
const DARK_BG = { r: 13, g: 13, b: 13 };
const WHITE = { r: 255, g: 255, b: 255 };
const GRAY = { r: 120, g: 120, b: 120 };
const LIGHT_GRAY = { r: 245, g: 245, b: 245 };
const BODY_TEXT = { r: 45, g: 45, b: 45 };
const GREEN = { r: 22, g: 163, b: 74 };
const RED = { r: 220, g: 38, b: 38 };
const AMBER = { r: 217, g: 119, b: 6 };

type RGB = { r: number; g: number; b: number };

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 12;

const fmtAud = (v: number) => {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-AU', { maximumFractionDigits: 0 });
  return v < 0 ? `-$${s}` : `$${s}`;
};
export const fmtPct = (v: number | null | undefined, dp = 2) =>
  (v != null && Number.isFinite(v) ? `${v.toFixed(dp)}%` : '—');
const fmtRatio = (v: number) => (isFinite(v) ? `${v.toFixed(2)}x` : '—');
const fmtNum = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-AU'));
const fmtDate = (d?: string | null) => (d ? format(new Date(d), 'dd MMM yyyy') : '—');

const setText = (doc: jsPDF, c: RGB) => doc.setTextColor(c.r, c.g, c.b);
const setFill = (doc: jsPDF, c: RGB) => doc.setFillColor(c.r, c.g, c.b);
const setDraw = (doc: jsPDF, c: RGB) => doc.setDrawColor(c.r, c.g, c.b);

interface RenderState {
  doc: jsPDF;
  y: number;
  pageNum: number;
  propertyLabel: string;
}

function newPage(state: RenderState) {
  state.doc.addPage();
  state.pageNum += 1;
  state.y = MARGIN + 14;
  drawHeader(state);
  drawFooter(state);
}

function ensureSpace(state: RenderState, needed: number) {
  if (state.y + needed > PAGE_H - 22) newPage(state);
}

function drawHeader(state: RenderState) {
  const { doc } = state;
  setFill(doc, DARK_BG);
  doc.rect(0, 0, PAGE_W, 10, 'F');
  setFill(doc, GOLD);
  doc.rect(0, 10, PAGE_W, 1.2, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('COMMERCIAL INVESTMENT REPORT', MARGIN, 6.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(state.propertyLabel, PAGE_W - MARGIN, 6.5, { align: 'right' });
}

function drawFooter(state: RenderState) {
  const { doc } = state;
  setText(doc, GRAY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Generated ${format(new Date(), 'dd MMM yyyy')}`, MARGIN, FOOTER_Y);
  doc.text(`Page ${state.pageNum}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
}

function sectionTitle(state: RenderState, num: number, title: string) {
  ensureSpace(state, 18);
  const { doc } = state;
  setFill(doc, GOLD);
  doc.rect(MARGIN, state.y, 3, 7, 'F');
  setText(doc, DARK_BG);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`${num}. ${title}`, MARGIN + 6, state.y + 5.5);
  state.y += 11;
}

function bodyText(state: RenderState, text: string, opts: { size?: number; bold?: boolean; color?: RGB } = {}) {
  const { doc } = state;
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(opts.size ?? 10);
  setText(doc, opts.color ?? BODY_TEXT);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  ensureSpace(state, lines.length * 4.5);
  doc.text(lines, MARGIN, state.y);
  state.y += lines.length * 4.5 + 1.5;
}

function kvGrid(state: RenderState, items: Array<[string, string]>, cols = 2) {
  const { doc } = state;
  const colW = CONTENT_W / cols;
  const rowH = 9;
  const rows = Math.ceil(items.length / cols);
  ensureSpace(state, rows * rowH + 2);
  items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * colW;
    const y = state.y + row * rowH;
    setText(doc, GRAY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(item[0].toUpperCase(), x, y);
    setText(doc, BODY_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(item[1], x, y + 5);
  });
  state.y += rows * rowH + 2;
}

function table(
  state: RenderState,
  headers: string[],
  rows: string[][],
  options: { colWidths?: number[]; align?: Array<'left' | 'right' | 'center'> } = {}
) {
  const { doc } = state;
  const colWidths = options.colWidths ?? headers.map(() => CONTENT_W / headers.length);
  const align = options.align ?? headers.map(() => 'left' as const);
  const rowH = 7;
  ensureSpace(state, rowH + 4);

  // Header
  setFill(doc, DARK_BG);
  doc.rect(MARGIN, state.y, CONTENT_W, rowH, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  let x = MARGIN;
  headers.forEach((h, i) => {
    const w = colWidths[i];
    const tx = align[i] === 'right' ? x + w - 2 : align[i] === 'center' ? x + w / 2 : x + 2;
    doc.text(h, tx, state.y + 4.8, { align: align[i] });
    x += w;
  });
  state.y += rowH;

  // Body
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setText(doc, BODY_TEXT);
  rows.forEach((row, ri) => {
    ensureSpace(state, rowH);
    if (ri % 2 === 0) {
      setFill(doc, LIGHT_GRAY);
      doc.rect(MARGIN, state.y, CONTENT_W, rowH, 'F');
    }
    let cx = MARGIN;
    row.forEach((cell, i) => {
      const w = colWidths[i];
      const tx = align[i] === 'right' ? cx + w - 2 : align[i] === 'center' ? cx + w / 2 : cx + 2;
      const text = doc.splitTextToSize(cell ?? '', w - 4)[0] ?? '';
      doc.text(text, tx, state.y + 4.8, { align: align[i] });
      cx += w;
    });
    state.y += rowH;
  });
  state.y += 3;
}

function statusChip(state: RenderState, label: string, color: RGB) {
  const { doc } = state;
  const w = doc.getTextWidth(label) + 6;
  setFill(doc, color);
  doc.roundedRect(MARGIN, state.y - 4, w, 6, 1, 1, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(label, MARGIN + 3, state.y);
  state.y += 6;
}

// ─── Aggregation helpers ───────────────────────────────────────────────────
function aggregateRentRoll(leases: CommercialLease[]) {
  const occupied = leases.filter(l => l.status === 'occupied' || l.status === 'holdover');
  const totalRent = occupied.reduce((s, l) => s + (l.base_rent_pa || 0), 0);
  const totalNla = leases.reduce((s, l) => s + (l.nla_sqm || 0), 0);
  const occupiedNla = occupied.reduce((s, l) => s + (l.nla_sqm || 0), 0);
  const occupancy = totalNla > 0 ? (occupiedNla / totalNla) : 0;
  const wale = calculateWale(occupied.map(l => ({
    base_rent_pa: l.base_rent_pa || 0,
    nla_sqm: l.nla_sqm || 0,
    lease_end: l.lease_end || new Date().toISOString(),
    status: l.status,
  })));
  return { totalRent, totalNla, occupiedNla, occupancy, wale, occupied };
}


function expiryProfile(leases: CommercialLease[]) {
  const buckets: Record<string, number> = { '0-1y': 0, '1-3y': 0, '3-5y': 0, '5y+': 0, 'Vacant/MTM': 0 };
  const now = Date.now();
  leases.forEach(l => {
    if (!l.lease_end || l.status === 'vacant') { buckets['Vacant/MTM'] += l.base_rent_pa || 0; return; }
    const years = (new Date(l.lease_end).getTime() - now) / (1000 * 60 * 60 * 24 * 365.25);
    if (years <= 1) buckets['0-1y'] += l.base_rent_pa || 0;
    else if (years <= 3) buckets['1-3y'] += l.base_rent_pa || 0;
    else if (years <= 5) buckets['3-5y'] += l.base_rent_pa || 0;
    else buckets['5y+'] += l.base_rent_pa || 0;
  });
  return buckets;
}

// ─── Public entry ──────────────────────────────────────────────────────────
export async function generateCommercialInvestmentReport(propertyId: string): Promise<void> {
  const [propRes, leasesRes] = await Promise.all([
    commercialApi.getProperty(propertyId),
    commercialApi.listLeases(propertyId),
  ]);
  if (propRes.error || !propRes.data) throw new Error(propRes.error?.message || 'Property not found');
  const property = propRes.data;
  const leases = leasesRes.data || [];

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const propertyLabel = [property.address, property.suburb, property.state, property.postcode]
    .filter(Boolean).join(', ');

  const state: RenderState = { doc, y: MARGIN + 14, pageNum: 1, propertyLabel };

  // ── 1. COVER ───────────────────────────────────────────────────────────
  setFill(doc, DARK_BG);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setFill(doc, GOLD);
  doc.rect(0, 130, PAGE_W, 1.5, 'F');

  setText(doc, GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('COMMERCIAL INVESTMENT REPORT', MARGIN, 80);

  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(property.address, CONTENT_W);
  doc.text(titleLines, MARGIN, 100);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  if (property.suburb) doc.text(`${property.suburb}, ${property.state ?? ''} ${property.postcode ?? ''}`.trim(), MARGIN, 120);

  setText(doc, GOLD);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(property.asset_class.replace('_', ' ').toUpperCase(), MARGIN, 142);
  doc.setFont('helvetica', 'normal');
  setText(doc, WHITE);
  doc.text(`Tenure: ${property.tenure}`, MARGIN, 150);
  doc.text(`Generated: ${format(new Date(), 'dd MMMM yyyy')}`, MARGIN, 157);

  newPage(state);

  // ── 2. EXECUTIVE SUMMARY ───────────────────────────────────────────────
  const noiResult = calculateNoi({
    grossRentalIncome: leases.reduce((s, l) => s + (l.base_rent_pa || 0), 0),
    recoveredOutgoings: 0,
    vacancyAllowancePct: 5,
    outgoings: property.outgoings_recoverable || {},
  });
  const passingYield = property.valuation && property.valuation > 0
    ? capRate({ noi: noiResult.noi, price: property.valuation }) : 0;

  const rentRoll = aggregateRentRoll(leases);

  sectionTitle(state, 1, 'Executive Summary');
  bodyText(state,
    `${property.address} is a ${property.asset_class.replace('_', ' ')} asset with ${leases.length} ` +
    `tenanc${leases.length === 1 ? 'y' : 'ies'} generating ${fmtAud(rentRoll.totalRent)} pa in passing rent. ` +
    `Weighted Average Lease Expiry (WALE) by income is ${rentRoll.wale.waleByIncome.toFixed(2)} years; ` +
    `occupancy by area is ${(rentRoll.occupancy * 100).toFixed(1)}%. ` +
    `On the current valuation of ${fmtAud(property.valuation || 0)}, the passing yield is ${fmtPct(passingYield)}.`
  );

  kvGrid(state, [
    ['Passing Rent', fmtAud(rentRoll.totalRent)],
    ['NOI (est.)', fmtAud(noiResult.noi)],
    ['Passing Yield', fmtPct(passingYield)],
    ['Valuation', fmtAud(property.valuation || 0)],
    ['WALE (income)', `${rentRoll.wale.waleByIncome.toFixed(2)} yrs`],
    ['WALE (area)', `${rentRoll.wale.waleByArea.toFixed(2)} yrs`],
    ['Occupancy', `${(rentRoll.occupancy * 100).toFixed(1)}%`],
    ['Total NLA', rentRoll.totalNla ? `${rentRoll.totalNla.toLocaleString('en-AU')} m²` : '—'],
  ]);

  // ── 3. ASSET OVERVIEW ──────────────────────────────────────────────────
  sectionTitle(state, 2, 'Asset Overview');
  kvGrid(state, [
    ['Asset Class', property.asset_class.replace('_', ' ').toUpperCase()],
    ['Tenure', property.tenure.toUpperCase()],
    ['Zoning', property.zoning ?? '—'],
    ['Year Built', fmtNum(property.year_built)],
    ['GFA', property.gfa_sqm ? `${property.gfa_sqm.toLocaleString('en-AU')} m²` : '—'],
    ['NLA', property.nla_sqm ? `${property.nla_sqm.toLocaleString('en-AU')} m²` : '—'],
    ['Site Area', property.site_area_sqm ? `${property.site_area_sqm.toLocaleString('en-AU')} m²` : '—'],
    ['Parking', fmtNum(property.parking_bays)],
    ['Acquisition Date', fmtDate(property.acquisition_date)],
    ['Acquisition Price', fmtAud(property.purchase_price || 0)],
    ['GST Treatment', property.gst_treatment.replace('_', ' ')],
    ['Valuer', property.valuer ?? '—'],
  ], 3);

  // ── 4. TENANCY SCHEDULE ────────────────────────────────────────────────
  sectionTitle(state, 3, 'Tenancy Schedule');
  if (leases.length === 0) {
    bodyText(state, 'No leases recorded — asset currently vacant or under acquisition.');
  } else {
    table(state,
      ['Tenant', 'Unit', 'NLA (m²)', 'Rent PA', 'Basis', 'Expiry', 'Status'],
      leases.map(l => [
        l.tenant_name || '—',
        l.suite_unit || '—',
        l.nla_sqm ? l.nla_sqm.toLocaleString('en-AU') : '—',
        fmtAud(l.base_rent_pa || 0),
        l.rent_basis,
        fmtDate(l.lease_end),
        l.status,
      ]),
      {
        colWidths: [38, 18, 20, 28, 18, 28, 24],
        align: ['left', 'left', 'right', 'right', 'center', 'center', 'center'],
      }
    );
  }

  // ── 5. INCOME ANALYSIS ─────────────────────────────────────────────────
  sectionTitle(state, 4, 'Income Analysis');
  table(state,
    ['Component', 'Annual'],
    [
      ['Potential Gross Income', fmtAud(noiResult.potentialGrossIncome)],
      ['Less: Vacancy Allowance (5%)', `(${fmtAud(noiResult.vacancyLoss)})`],
      ['Plus: Recovered Outgoings', fmtAud(noiResult.recoveredOutgoings || 0)],
      ['Effective Gross Income', fmtAud(noiResult.effectiveGrossIncome)],
      ['Less: Total Outgoings', `(${fmtAud(noiResult.totalOutgoings)})`],
      ['Net Operating Income', fmtAud(noiResult.noi)],
    ],
    { colWidths: [CONTENT_W * 0.65, CONTENT_W * 0.35], align: ['left', 'right'] }
  );

  // ── 6. VALUATION & YIELD ───────────────────────────────────────────────
  sectionTitle(state, 5, 'Valuation & Yield');
  const yields = calculateYields({
    passingNoi: noiResult.noi,
    marketNoi: noiResult.noi * 1.05,
    price: property.valuation || property.purchase_price || 0,
  });
  kvGrid(state, [
    ['Passing Yield', fmtPct(yields.passingYield)],
    ['Reversionary Yield', fmtPct(yields.reversionaryYield)],
    ['Equivalent Yield', fmtPct(yields.equivalentYield)],
    ['Valuation Date', fmtDate(property.valuation_date)],
    ['Valuer', property.valuer ?? '—'],
    ['Acquisition Yield', property.purchase_price ? fmtPct((noiResult.noi / property.purchase_price) * 100) : '—'],
  ], 3);

  // ── 7. DCF & RETURNS ───────────────────────────────────────────────────
  sectionTitle(state, 6, 'DCF & Returns (10-Year Hold)');
  const dcf = runDcf({
    purchasePrice: property.purchase_price || property.valuation || 0,
    initialNoi: noiResult.noi,
    holdPeriodYears: 10,
    discountRatePct: 8.5,
    terminalCapRatePct: 6.5,
    rentalGrowthPct: 3.0,
    vacancyAllowancePct: 5,
    capexSchedule: [],
    loanAmount: (property.purchase_price || 0) * 0.6,
    interestRatePct: 7.25,
    loanTermYears: 25,
    sellingCostsPct: 1.5,
  });
  kvGrid(state, [
    ['Discount Rate', '8.50%'],
    ['Terminal Cap', '6.50%'],
    ['Rental Growth', '3.00%'],
    ['Hold Period', '10 years'],
    ['Unlevered IRR', dcf.unleveredIrr != null ? fmtPct(dcf.unleveredIrr) : '—'],
    ['Levered IRR', dcf.leveredIrr != null ? fmtPct(dcf.leveredIrr) : '—'],
    ['NPV (unlevered)', fmtAud(dcf.unleveredNpv)],
    ['NPV (levered)', fmtAud(dcf.leveredNpv)],
    ['Equity Multiple', fmtRatio(dcf.equityMultiple)],
    ['Terminal Value', fmtAud(dcf.terminalValue)],
  ], 3);

  if (dcf.rows && dcf.rows.length > 0) {
    bodyText(state, 'Annual cash flow projection', { bold: true, size: 9.5 });
    table(state,
      ['Yr', 'NOI', 'Capex', 'Debt Svc', 'Levered CF'],
      dcf.rows.slice(0, 10).map(y => [
        String(y.year),
        fmtAud(y.noi),
        fmtAud(y.capex || 0),
        fmtAud(y.debtService || 0),
        fmtAud(y.leveredCf),
      ]),
      { colWidths: [12, 40, 35, 40, 47], align: ['center', 'right', 'right', 'right', 'right'] }
    );
  }



  // ── 8. DEBT STRUCTURE ──────────────────────────────────────────────────
  sectionTitle(state, 7, 'Debt Structure (ICR / DSCR)');
  const indicativeLoan = (property.purchase_price || property.valuation || 0) * 0.6;
  const coverage = calculateCoverage({
    noi: noiResult.noi,
    loanAmount: indicativeLoan,
    interestRatePct: 7.25,
    loanTermYears: 25,
  });
  const bc = calculateCommercialBc({
    noi: noiResult.noi,
    propertyValue: property.valuation || property.purchase_price || 0,
    interestRatePct: 7.25,
    bufferPct: 1.0,
    loanTermYears: 25,
    maxLvr: 0.65,
    minIcr: 1.5,
    minDscr: 1.25,
  });
  bodyText(state,
    `At an indicative 60% LVR (${fmtAud(indicativeLoan)}) and contract rate of 7.25%, ` +
    `the asset produces an ICR of ${fmtRatio(coverage.icr)} and DSCR of ${fmtRatio(coverage.dscr)}. ` +
    `Maximum commercial borrowing capacity (lender policy 65% LVR / 1.5x ICR / 1.25x DSCR @ +1% buffer) ` +
    `is ${fmtAud(bc.maxLoan)}, with ${bc.bindingConstraint.toUpperCase()} as the binding constraint.`
  );
  kvGrid(state, [
    ['Indicative LVR', '60%'],
    ['Contract Rate', '7.25%'],
    ['Term', '25 years'],
    ['ICR @ Indicative', fmtRatio(coverage.icr)],
    ['DSCR @ Indicative', fmtRatio(coverage.dscr)],
    ['Annual Debt Service', fmtAud(coverage.annualDebtService)],
    ['Max Commercial Loan', fmtAud(bc.maxLoan)],
    ['Binding Constraint', bc.bindingConstraint.toUpperCase()],
    ['Assessment Rate', `${bc.assessmentRatePct.toFixed(2)}%`],
  ], 3);

  // ── 9. RISK ASSESSMENT ─────────────────────────────────────────────────
  sectionTitle(state, 8, 'Risk Assessment');
  const exp = expiryProfile(leases);
  const topTenant = [...leases].sort((a, b) => (b.base_rent_pa || 0) - (a.base_rent_pa || 0))[0];
  const concentration = topTenant && rentRoll.totalRent > 0
    ? ((topTenant.base_rent_pa || 0) / rentRoll.totalRent) * 100
    : 0;

  bodyText(state, 'Lease expiry profile (by income)', { bold: true, size: 9.5 });
  table(state,
    ['Bucket', 'Income PA', '% of Total'],
    Object.entries(exp).map(([k, v]) => [
      k, fmtAud(v),
      rentRoll.totalRent > 0 ? `${((v / rentRoll.totalRent) * 100).toFixed(1)}%` : '0%',
    ]),
    { colWidths: [CONTENT_W * 0.3, CONTENT_W * 0.4, CONTENT_W * 0.3], align: ['left', 'right', 'right'] }
  );

  bodyText(state,
    `Tenant concentration: largest tenant${topTenant ? ` (${topTenant.tenant_name})` : ''} represents ` +
    `${concentration.toFixed(1)}% of total passing income. ` +
    (concentration > 50
      ? 'High single-tenant concentration is the dominant risk — re-leasing exposure on expiry should be modelled.'
      : concentration > 25
      ? 'Moderate concentration — diversification is reasonable but expiry timing warrants attention.'
      : 'Income is well diversified across the rent roll.')
  );

  // Traffic-light risk chips
  ensureSpace(state, 18);
  const concRisk = concentration > 50 ? RED : concentration > 25 ? AMBER : GREEN;
  const waleRisk = rentRoll.wale.waleByIncome < 2 ? RED : rentRoll.wale.waleByIncome < 4 ? AMBER : GREEN;
  const covRisk = coverage.icr < 1.25 ? RED : coverage.icr < 1.5 ? AMBER : GREEN;
  const yLabel = state.y;
  setText(state.doc, BODY_TEXT);
  state.doc.setFont('helvetica', 'bold');
  state.doc.setFontSize(9);
  state.doc.text('Risk indicators:', MARGIN, yLabel);
  state.y = yLabel + 5;
  const chipsY = state.y;
  drawChip(state.doc, MARGIN, chipsY, `Concentration ${concentration.toFixed(0)}%`, concRisk);
  drawChip(state.doc, MARGIN + 50, chipsY, `WALE ${rentRoll.wale.waleByIncome.toFixed(1)}y`, waleRisk);
  drawChip(state.doc, MARGIN + 95, chipsY, `ICR ${coverage.icr.toFixed(2)}x`, covRisk);
  state.y += 10;

  // ── 10. RECOMMENDATION ─────────────────────────────────────────────────
  sectionTitle(state, 9, 'Recommendation & Exit Strategy');
  const verdict = (() => {
    if (bc.band === 'green' && rentRoll.wale.waleByIncome >= 4 && concentration <= 40) {
      return { label: 'PROCEED', color: GREEN, body:
        'Asset metrics support acquisition at the indicative debt structure. WALE provides meaningful income runway and tenant concentration is within tolerance.' };
    }
    if (bc.band === 'amber' || rentRoll.wale.waleByIncome < 4 || concentration > 40) {
      return { label: 'PROCEED WITH CONDITIONS', color: AMBER, body:
        'Acquisition is supportable but requires mitigation — consider reduced LVR, tenant covenant strength review, or repositioning of short-WALE income.' };
    }
    return { label: 'DECLINE / RESTRUCTURE', color: RED, body:
      'Current metrics do not support the indicative debt structure. Revisit purchase price, debt assumptions, or seek a substantially de-risked tenancy profile before progressing.' };
  })();
  statusChip(state, verdict.label, verdict.color);
  bodyText(state, verdict.body);
  bodyText(state,
    'Suggested exit pathways: (i) hold for income with reviews compounding to market — re-test in Year 5; ' +
    '(ii) value-add via re-leasing or refurbishment to lift NOI and compress cap rate; ' +
    '(iii) divest on market peak when WALE exceeds 5 years and tenant covenants are investment-grade.'
  );

  // ── 11. DISCLAIMER ─────────────────────────────────────────────────────
  newPage(state);
  sectionTitle(state, 10, 'Disclaimer');
  bodyText(state,
    'This report has been prepared for the addressee on the basis of information supplied by the client ' +
    'and publicly available sources. Financial projections, including DCF, IRR, NPV, ICR and DSCR figures, ' +
    'are estimates based on stated assumptions and current market conditions; actual outcomes will vary.',
    { size: 9 }
  );
  bodyText(state,
    'No representation or warranty, express or implied, is made as to the accuracy or completeness of any ' +
    'information contained herein. This document does not constitute financial, taxation or legal advice and ' +
    'should not be relied upon as such. Recipients should obtain independent professional advice before ' +
    'making any investment decision.',
    { size: 9 }
  );
  bodyText(state,
    'Commercial property investment carries material risk including tenant default, capital loss, illiquidity, ' +
    'and changes in market rents, yields and lending conditions.',
    { size: 9 }
  );

  // ── Re-render headers/footers on all but cover ─────────────────────────
  const total = (doc as any).internal.getNumberOfPages();
  for (let p = 2; p <= total; p++) {
    doc.setPage(p);
    // header/footer already drawn on newPage; just make sure footer reflects total
    setText(doc, GRAY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Page ${p - 1} of ${total - 1}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
  }

  const fileName = `Commercial-Investment-Report_${property.address.replace(/[^a-z0-9]/gi, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
  doc.save(fileName);
}

function drawChip(doc: jsPDF, x: number, y: number, label: string, color: RGB) {
  const w = doc.getTextWidth(label) + 8;
  setFill(doc, color);
  doc.roundedRect(x, y - 4, w, 6, 1, 1, 'F');
  setText(doc, WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(label, x + 4, y);
}

/**
 * Industrial Investment Report — PDF Generator (jsPDF, Dark & Gold).
 *
 * Sections: Cover · Executive Summary · Asset Overview · Site Metrics ·
 * Rent Roll · Income & NOI · Yield · Capex Schedule · Serviceability ·
 * Risks · Recommendation · Disclaimer.
 */
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import {
  industrialApi,
  type IndustrialProperty,
  type IndustrialTenancy,
  type IndustrialCapexItem,
} from '@/hooks/useIndustrialProperties';
import {
  calculateIndustrialNoi,
  calculateIndustrialYields,
  calculateIndustrialWale,
  calcSiteMetrics,
  calculateIndustrialBc,
} from '@/utils/industrial';

const GOLD = { r: 212, g: 168, b: 67 };
const DARK_BG = { r: 13, g: 13, b: 13 };
const WHITE = { r: 255, g: 255, b: 255 };
const GRAY = { r: 120, g: 120, b: 120 };
const LIGHT_GRAY = { r: 245, g: 245, b: 245 };
const BODY_TEXT = { r: 45, g: 45, b: 45 };

type RGB = { r: number; g: number; b: number };
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 12;

const fmtAud = (v: number) => isFinite(v)
  ? (v < 0 ? `-$${Math.abs(v).toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : `$${v.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`)
  : '—';
const fmtPct = (v: number, dp = 2) => isFinite(v) ? `${v.toFixed(dp)}%` : '—';
const fmtRatio = (v: number) => isFinite(v) ? `${v.toFixed(2)}x` : '—';
const fmtNum = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('en-AU');
const fmtDate = (d?: string | null) => d ? format(new Date(d), 'dd MMM yyyy') : '—';

const setText = (doc: jsPDF, c: RGB) => doc.setTextColor(c.r, c.g, c.b);
const setFill = (doc: jsPDF, c: RGB) => doc.setFillColor(c.r, c.g, c.b);

interface State { doc: jsPDF; y: number; pageNum: number; label: string; }

function header(s: State) {
  setFill(s.doc, DARK_BG);
  s.doc.rect(0, 0, PAGE_W, 10, 'F');
  setFill(s.doc, GOLD);
  s.doc.rect(0, 10, PAGE_W, 1.2, 'F');
  setText(s.doc, WHITE);
  s.doc.setFont('helvetica', 'bold'); s.doc.setFontSize(9);
  s.doc.text('INDUSTRIAL INVESTMENT REPORT', MARGIN, 6.5);
  s.doc.setFont('helvetica', 'normal'); s.doc.setFontSize(8);
  s.doc.text(s.label, PAGE_W - MARGIN, 6.5, { align: 'right' });
}
function footer(s: State) {
  setText(s.doc, GRAY);
  s.doc.setFont('helvetica', 'normal'); s.doc.setFontSize(8);
  s.doc.text(`Generated ${format(new Date(), 'dd MMM yyyy')}`, MARGIN, FOOTER_Y);
  s.doc.text(`Page ${s.pageNum}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
}
function newPage(s: State) { s.doc.addPage(); s.pageNum++; s.y = MARGIN + 14; header(s); footer(s); }
function ensure(s: State, n: number) { if (s.y + n > PAGE_H - 22) newPage(s); }

function section(s: State, num: number, title: string) {
  ensure(s, 18);
  setFill(s.doc, GOLD);
  s.doc.rect(MARGIN, s.y, 3, 7, 'F');
  setText(s.doc, DARK_BG);
  s.doc.setFont('helvetica', 'bold'); s.doc.setFontSize(13);
  s.doc.text(`${num}. ${title}`, MARGIN + 6, s.y + 5.5);
  s.y += 11;
}

function body(s: State, text: string, bold = false) {
  s.doc.setFont('helvetica', bold ? 'bold' : 'normal');
  s.doc.setFontSize(10);
  setText(s.doc, BODY_TEXT);
  const lines = s.doc.splitTextToSize(text, CONTENT_W);
  ensure(s, lines.length * 4.5);
  s.doc.text(lines, MARGIN, s.y);
  s.y += lines.length * 4.5 + 2;
}

function kv(s: State, items: Array<[string, string]>, cols = 2) {
  const colW = CONTENT_W / cols;
  const rowH = 9;
  const rows = Math.ceil(items.length / cols);
  ensure(s, rows * rowH + 2);
  items.forEach((it, idx) => {
    const c = idx % cols, r = Math.floor(idx / cols);
    const x = MARGIN + c * colW, y = s.y + r * rowH;
    setText(s.doc, GRAY); s.doc.setFont('helvetica', 'normal'); s.doc.setFontSize(7.5);
    s.doc.text(it[0].toUpperCase(), x, y);
    setText(s.doc, BODY_TEXT); s.doc.setFont('helvetica', 'bold'); s.doc.setFontSize(10);
    s.doc.text(it[1], x, y + 5);
  });
  s.y += rows * rowH + 2;
}

function table(s: State, headers: string[], rows: string[][], widths?: number[], align?: Array<'left' | 'right' | 'center'>) {
  const w = widths ?? headers.map(() => CONTENT_W / headers.length);
  const al = align ?? headers.map(() => 'left' as const);
  const rowH = 7;
  ensure(s, rowH + 4);
  setFill(s.doc, DARK_BG);
  s.doc.rect(MARGIN, s.y, CONTENT_W, rowH, 'F');
  setText(s.doc, WHITE); s.doc.setFont('helvetica', 'bold'); s.doc.setFontSize(8.5);
  let x = MARGIN;
  headers.forEach((h, i) => {
    const tx = al[i] === 'right' ? x + w[i] - 2 : al[i] === 'center' ? x + w[i] / 2 : x + 2;
    s.doc.text(h, tx, s.y + 4.8, { align: al[i] });
    x += w[i];
  });
  s.y += rowH;
  s.doc.setFont('helvetica', 'normal'); s.doc.setFontSize(8.5);
  setText(s.doc, BODY_TEXT);
  rows.forEach((row, ri) => {
    ensure(s, rowH);
    if (ri % 2 === 0) { setFill(s.doc, LIGHT_GRAY); s.doc.rect(MARGIN, s.y, CONTENT_W, rowH, 'F'); }
    let cx = MARGIN;
    row.forEach((cell, i) => {
      const tx = al[i] === 'right' ? cx + w[i] - 2 : al[i] === 'center' ? cx + w[i] / 2 : cx + 2;
      const t = s.doc.splitTextToSize(cell ?? '', w[i] - 4)[0] ?? '';
      s.doc.text(t, tx, s.y + 4.8, { align: al[i] });
      cx += w[i];
    });
    s.y += rowH;
  });
  s.y += 3;
}

export async function generateIndustrialInvestmentReport(propertyId: string): Promise<void> {
  const [propRes, tenRes, capRes] = await Promise.all([
    industrialApi.getProperty(propertyId),
    industrialApi.listTenancies(propertyId),
    industrialApi.listCapex(propertyId),
  ]);
  if (propRes.error || !propRes.data) throw new Error(propRes.error?.message || 'Property not found');
  const property = propRes.data as IndustrialProperty;
  const tenancies = (tenRes.data || []) as IndustrialTenancy[];
  const capex = (capRes.data || []) as IndustrialCapexItem[];

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const label = [property.property_name, property.street, property.suburb, property.state, property.postcode]
    .filter(Boolean).join(', ');
  const s: State = { doc, y: MARGIN + 14, pageNum: 1, label };

  // ── Cover
  setFill(doc, DARK_BG); doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setFill(doc, GOLD); doc.rect(0, 110, PAGE_W, 2, 'F');
  setText(doc, GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('INDUSTRIAL INVESTMENT REPORT', PAGE_W / 2, 60, { align: 'center' });
  setText(doc, WHITE); doc.setFontSize(28);
  const titleLines = doc.splitTextToSize(property.property_name || property.street || 'Industrial Asset', CONTENT_W);
  doc.text(titleLines, PAGE_W / 2, 85, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  doc.text(label, PAGE_W / 2, 125, { align: 'center' });
  doc.setFontSize(10); setText(doc, GRAY);
  doc.text(`Prepared ${format(new Date(), 'dd MMMM yyyy')}`, PAGE_W / 2, 280, { align: 'center' });

  newPage(s);

  // Run engines
  const grossRent = tenancies.reduce((a, t) => a + (Number(t.base_rent_pa) || 0), 0);
  const horizon = new Date().getFullYear() + 10;
  const upcoming = capex.filter(i => i.year >= new Date().getFullYear() && i.year <= horizon);
  const capexReservePa = upcoming.length > 0
    ? upcoming.reduce((sum, i) => sum + Number(i.amount || 0), 0) / Math.max(1, horizon - new Date().getFullYear())
    : 0;
  const noi = calculateIndustrialNoi({
    grossRentalIncome: grossRent,
    vacancyAllowancePct: 4,
    outgoings: { management: grossRent * 0.025 },
    capexReservePa,
  });
  const price = Number(property.current_valuation) || Number(property.purchase_price) || 0;
  const yields = price > 0 ? calculateIndustrialYields({ passingNoi: noi.noi, marketNoi: noi.noi, price }) : null;
  const metrics = calcSiteMetrics({
    glaSqm: Number(property.gla_sqm) || 0,
    siteAreaSqm: Number(property.site_area_sqm) || 0,
    hardstandSqm: Number(property.hardstand_sqm) || 0,
    officePct: Number(property.office_pct) || 0,
    price,
  });
  const wale = calculateIndustrialWale(tenancies.map(t => ({
    base_rent_pa: Number(t.base_rent_pa) || 0,
    gla_sqm: Number(t.gla_sqm) || 0,
    lease_end: t.lease_end || null,
  })));
  const bc = price > 0 ? calculateIndustrialBc({
    noi: noi.noi, propertyValue: price, interestRatePct: 7.25, bufferPct: 1.0,
    loanTermYears: 20, maxLvr: 0.60, minIcr: 1.75, minDscr: 1.35,
  }) : null;

  // ── 1. Executive Summary
  section(s, 1, 'Executive Summary');
  body(s, `${property.property_name || property.street} is a ${property.asset_subtype.replace('_', ' ')} asset comprising ${fmtNum(property.gla_sqm)} m² GLA on a ${fmtNum(property.site_area_sqm)} m² site. The asset is leased to ${tenancies.length} tenant${tenancies.length === 1 ? '' : 's'} returning ${fmtAud(grossRent)} per annum at a passing yield of ${yields ? fmtPct(yields.passingYield) : '—'} on a value of ${fmtAud(price)}.`);
  kv(s, [
    ['Value', fmtAud(price)],
    ['Passing NOI', fmtAud(noi.noi)],
    ['Passing Yield', yields ? fmtPct(yields.passingYield) : '—'],
    ['WALE (income)', `${wale.waleByIncome.toFixed(2)} yrs`],
    ['Site Cover', fmtPct(metrics.siteCoverPct)],
    ['Indicative Max Loan', bc ? fmtAud(bc.maxLoan) : '—'],
  ], 3);

  // ── 2. Asset Overview
  section(s, 2, 'Asset Overview');
  kv(s, [
    ['Address', label || '—'],
    ['Sub-type', property.asset_subtype.replace('_', ' ')],
    ['Zoning', property.zoning ?? '—'],
    ['Year Built', property.year_built?.toString() ?? '—'],
    ['Condition', property.condition_rating ?? '—'],
    ['Status', property.status.replace('_', ' ')],
    ['Purchase Price', fmtAud(Number(property.purchase_price) || 0)],
    ['Purchase Date', fmtDate(property.purchase_date)],
    ['Current Valuation', fmtAud(Number(property.current_valuation) || 0)],
    ['Valuation Date', fmtDate(property.valuation_date)],
  ], 2);

  // ── 3. Site Metrics
  section(s, 3, 'Site & Building Metrics');
  kv(s, [
    ['GLA', `${fmtNum(property.gla_sqm)} m²`],
    ['Site Area', `${fmtNum(property.site_area_sqm)} m²`],
    ['Site Cover', fmtPct(metrics.siteCoverPct)],
    ['Coverage Band', metrics.coverageBand],
    ['Hardstand', `${fmtNum(property.hardstand_sqm)} m²`],
    ['Hardstand Ratio', fmtPct(metrics.hardstandRatioPct)],
    ['Office %', fmtPct(metrics.officePct)],
    ['Clearance', property.clearance_metres ? `${property.clearance_metres} m` : '—'],
    ['Power', property.power_kva ? `${property.power_kva} kVA` : '—'],
    ['Dock Doors', property.dock_doors?.toString() ?? '—'],
    ['Floor Load', property.ground_floor_load_kpa ? `${property.ground_floor_load_kpa} kPa` : '—'],
    ['$/m² GLA', fmtAud(metrics.pricePerSqmGla)],
  ], 3);

  // ── 4. Rent Roll
  section(s, 4, 'Rent Roll & Tenancy Schedule');
  if (tenancies.length === 0) {
    body(s, 'No tenancies recorded.');
  } else {
    table(s,
      ['Tenant', 'Unit', 'GLA m²', '$/m² PA', 'Rent PA', 'Expiry'],
      tenancies.map(t => [
        t.tenant_name,
        t.unit_label || '—',
        fmtNum(t.gla_sqm),
        t.base_rent_per_sqm_pa ? `$${Number(t.base_rent_per_sqm_pa).toFixed(2)}` : '—',
        fmtAud(Number(t.base_rent_pa) || 0),
        fmtDate(t.lease_end),
      ]),
      [50, 22, 22, 24, 30, 26],
      ['left', 'left', 'right', 'right', 'right', 'left'],
    );
    body(s, `Portfolio WALE: ${wale.waleByIncome.toFixed(2)} years (income-weighted), ${wale.waleByArea.toFixed(2)} years (area-weighted).`, true);
  }

  // ── 5. Income & NOI
  section(s, 5, 'Income & NOI');
  kv(s, [
    ['Gross Rental Income', fmtAud(noi.potentialGrossIncome)],
    ['Vacancy Loss (4%)', fmtAud(noi.vacancyLoss)],
    ['Effective Gross Income', fmtAud(noi.effectiveGrossIncome)],
    ['Total Outgoings', fmtAud(noi.totalOutgoings)],
    ['Capex Reserve (PA)', fmtAud(noi.capexReserve)],
    ['Net Operating Income', fmtAud(noi.noi)],
  ], 2);

  // ── 6. Yield
  section(s, 6, 'Yield & Valuation');
  if (yields) {
    kv(s, [
      ['Value', fmtAud(price)],
      ['Passing Yield', fmtPct(yields.passingYield)],
      ['Reversionary Yield', fmtPct(yields.reversionaryYield)],
      ['Equivalent Yield', fmtPct(yields.equivalentYield)],
    ], 2);
  } else {
    body(s, 'Insufficient pricing data to compute yields.');
  }

  // ── 7. Capex Schedule
  section(s, 7, 'Capex Schedule');
  if (capex.length === 0) {
    body(s, 'No capex items currently planned.');
  } else {
    table(s,
      ['Year', 'Category', 'Amount', 'Notes'],
      capex.sort((a, b) => a.year - b.year).map(c => [
        String(c.year),
        c.category.replace('_', ' '),
        fmtAud(Number(c.amount)),
        c.notes || '',
      ]),
      [20, 40, 35, 79],
      ['left', 'left', 'right', 'left'],
    );
  }

  // ── 8. Serviceability
  section(s, 8, 'Debt Serviceability');
  if (bc) {
    body(s, `Sized at 60% LVR, 7.25% rate plus 1.0% buffer over a 20-year term with industrial coverage benchmarks (ICR ≥ 1.75x, DSCR ≥ 1.35x).`);
    kv(s, [
      ['Max Loan', fmtAud(bc.maxLoan)],
      ['Implied LVR', fmtPct(bc.impliedLvr * 100)],
      ['Binding Constraint', bc.bindingConstraint.toUpperCase()],
      ['Assessment Rate', fmtPct(bc.assessmentRatePct)],
      ['ICR @ Max', fmtRatio(bc.coverageAtMax.icr)],
      ['DSCR @ Max', fmtRatio(bc.coverageAtMax.dscr)],
      ['Annual Interest', fmtAud(bc.coverageAtMax.annualInterest)],
      ['Annual Debt Service', fmtAud(bc.coverageAtMax.annualDebtService)],
    ], 2);
    bc.notes.forEach(n => body(s, `• ${n}`));
  } else {
    body(s, 'Insufficient pricing data to size debt.');
  }

  // ── 9. Risks
  section(s, 9, 'Risk Assessment');
  const risks: string[] = [];
  if (wale.waleByIncome < 3) risks.push(`Short WALE of ${wale.waleByIncome.toFixed(1)} years — concentrated re-leasing risk.`);
  if (metrics.coverageBand === 'over-developed') risks.push('Site is over-developed (>60% cover) — limited expansion or hardstand capacity.');
  if (metrics.coverageBand === 'under-developed') risks.push('Site is under-developed (<35% cover) — value-add potential but stranded land carrying cost.');
  if (tenancies.length === 1) risks.push('Single-tenant exposure — full vacancy risk on lease end.');
  if (!property.clearance_metres || property.clearance_metres < 8) risks.push('Sub-8 m clearance limits modern logistics fit-out.');
  if (capex.length > 0 && upcoming.reduce((s2, i) => s2 + Number(i.amount), 0) > grossRent * 2) {
    risks.push('Capex pipeline exceeds 2× annual rent — earnings drag during refurbishment cycle.');
  }
  if (risks.length === 0) risks.push('No material industrial-specific risks flagged based on the recorded data.');
  risks.forEach(r => body(s, `• ${r}`));

  // ── 10. Recommendation
  section(s, 10, 'Recommendation');
  let rec = 'Hold — fundamentals appear balanced.';
  if (bc && bc.band === 'green' && wale.waleByIncome >= 5 && metrics.coverageBand === 'balanced') {
    rec = 'Strong industrial fundamentals — pursue acquisition / retain and refinance to target LVR.';
  } else if (bc && bc.band === 'red') {
    rec = 'Caution — debt serviceability is constrained. Re-test pricing or consider equity injection.';
  } else if (wale.waleByIncome < 2) {
    rec = 'Pre-renewal strategy required — secure lease extensions before refinance event.';
  }
  body(s, rec, true);

  // ── 11. Disclaimer
  section(s, 11, 'Disclaimer');
  setText(s.doc, GRAY); s.doc.setFontSize(8); s.doc.setFont('helvetica', 'italic');
  const disc = 'This report is provided for informational purposes only and does not constitute investment, taxation or legal advice. Industrial market conditions, tenant covenants and capex assumptions may shift materially. Independent valuation, structural engineering and legal due diligence should be undertaken prior to any transaction. Figures are indicative and rounded to the nearest dollar.';
  const dl = s.doc.splitTextToSize(disc, CONTENT_W);
  ensure(s, dl.length * 4);
  s.doc.text(dl, MARGIN, s.y);

  const filename = `Industrial_Report_${(property.property_name || property.street || 'asset').replace(/[^\w]+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  s.doc.save(filename);
}

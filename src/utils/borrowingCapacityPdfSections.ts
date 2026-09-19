/**
 * Shared Borrowing Capacity PDF Sections
 * 
 * Embeddable jsPDF rendering functions that visually match the Borrowing Capacity
 * Calculator UI. Designed to be called from within any jsPDF document (PPR, Client
 * Finance Form, etc.) — NOT a standalone generator.
 * 
 * Each function accepts the current jsPDF doc, a y-position, and a page counter,
 * then draws its section and returns the new y-position. This allows the caller
 * to seamlessly integrate borrowing capacity pages into their own document flow.
 * 
 * Sections rendered:
 *   1. Section Cover / Title
 *   2. Executive KPIs (Capacity, Surplus, Band) — matching ResultsPanel.tsx
 *   3. Proposed Loan Serviceability Check
 *   4. Income Analysis with Shading Table — matching IncomeSection.tsx
 *   5. Tax Breakdown (2025-26) — matching ResultsPanel tax collapsible
 *   6. Living Expenses with HEM Breakdown — matching ExpensesSection.tsx
 *   7. Negative Property Cash Flows
 *   8. Liabilities Schedule with Assessment Rules — matching LiabilitiesSection.tsx
 *   9. Capacity Waterfall Breakdown
 *  10. Serviceability Verdict & Gauge
 *  11. Recommendations & Warnings
 *  12. Assumptions
 */

import type { jsPDF } from 'jspdf';
import { buildLiabilityServicing } from '@/utils/householdFinance';

// ─── Design tokens (brand) ──────────────────────────────────────────────────
const GOLD   = { r: 191, g: 155, b: 80 };
const NAVY   = { r: 13,  g: 38,  b: 77 };
const WHITE  = { r: 255, g: 255, b: 255 };
const GRAY   = { r: 128, g: 128, b: 128 };
const LGRAY  = { r: 245, g: 245, b: 245 };
const GREEN  = { r: 22,  g: 163, b: 74 };
const RED    = { r: 239, g: 68,  b: 68 };
const AMBER  = { r: 245, g: 158, b: 11 };
const BLUE   = { r: 59,  g: 130, b: 246 };
const DARK   = { r: 50,  g: 50,  b: 50 };
const MDARK  = { r: 80,  g: 80,  b: 80 };

type RGB = { r: number; g: number; b: number };

// ─── Layout constants ───────────────────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 15;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BCIncomeItem {
  label: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
}

export interface BCLiabilityItem {
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  calculationNote?: string;
}

export interface BCNegativeCashFlow {
  address: string;
  monthlyCashflow: number;
}

export interface BCHemBreakdown {
  householdType: string;
  dependentsCount: number;
  baseHem: number;
  incomeTier: string;
  multiplier: number;
  finalHem: number;
}

export interface BCTaxBreakdown {
  grossIncome: number;
  taxPayable: number;
  medicareLevy: number;
  totalTax: number;
  afterTaxIncome: number;
  effectiveTaxRate: number;
  marginalTaxRate: number;
  marginalBracket: string;
  monthlyTakeHome: number;
}

export interface BCProposedLoanCheck {
  proposedAmount: number;
  monthlyRepayment: number;
  isServiceable: boolean;
  headroom: number;
  utilizationPercent: number;
}

export interface BorrowingCapacityPdfData {
  // Core assessment
  borrowingCapacity: number;
  stressTestedCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
  assessmentRate: number;
  
  // Income
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  incomeBreakdown: BCIncomeItem[];
  
  // Tax
  taxBreakdown?: BCTaxBreakdown;
  
  // Expenses
  expenseMethod: 'hem' | 'declared' | 'hybrid';
  livingExpensesMonthly: number;
  hemBenchmark?: number;
  hemBreakdown?: BCHemBreakdown;
  declaredExpensesMonthly?: number;
  
  // Negative property cash flows
  negativePropertyCashFlows?: BCNegativeCashFlow[];
  totalNegativeCashFlows?: number;
  effectiveExpensesMonthly?: number;
  
  // Liabilities
  existingCommitmentsMonthly: number;
  liabilityBreakdown: BCLiabilityItem[];
  
  // Proposed loan check
  proposedLoanCheck?: BCProposedLoanCheck;
  
  // Recommendations & Warnings
  recommendations: string[];
  warnings: string[];
  
  // Assumptions
  assumptions?: { key: string; value: string }[];
  
  // Meta
  interestRate?: number;
  bufferRate?: number;
  loanTermYears?: number;
  calculatedAt?: string;
}

// ─── Sanitisation ───────────────────────────────────────────────────────────
function sanitize(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '');
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (v: number): string => {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `-$${s}` : `$${s}`;
};

function setColor(doc: jsPDF, c: RGB) { doc.setTextColor(c.r, c.g, c.b); }
function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(c.r, c.g, c.b); }

function bandColor(band: string): RGB {
  if (band === 'green') return GREEN;
  if (band === 'amber') return AMBER;
  return RED;
}

function bandLabel(band: string): string {
  if (band === 'green') return 'STRONG';
  if (band === 'amber') return 'MODERATE';
  return 'LIMITED';
}

function bandMessage(band: string): string {
  if (band === 'green') return 'Strong borrowing position';
  if (band === 'amber') return 'Moderate capacity - proceed with caution';
  return 'Limited capacity - focus on debt reduction';
}

function formatLiabilityType(type: string): string {
  const labels: Record<string, string> = {
    home_loan: 'Home Loan',
    investment_loan: 'Investment Loan',
    car_loan: 'Car Loan',
    personal_loan: 'Personal Loan',
    credit_card: 'Credit Card',
    hecs: 'HECS/HELP',
    afterpay_bnpl: 'BNPL',
    rent_expense: 'Rent Expense',
    other: 'Other',
  };
  return labels[type] || type.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Returns a short method description for how a liability is assessed */
function getDefaultMethodNote(type: string): string {
  const methods: Record<string, string> = {
    credit_card: '3% of limit',
    afterpay_bnpl: '5% of limit',
    hecs: 'ATO brackets',
    car_loan: 'P&I @ 8%/5yr',
    personal_loan: 'P&I @ 10%/7yr',
    home_loan: 'P&I @ 9.5%',
    investment_loan: 'P&I @ 9.5%',
  };
  return methods[type] || '';
}

// ─── Page management ────────────────────────────────────────────────────────

function addSectionFooter(doc: jsPDF, pageNum: number) {
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('Borrowing Capacity Assessment', MARGIN, FOOTER_Y);
  doc.text(`Page ${pageNum}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
  // CONFIDENTIAL label
  doc.setFontSize(6);
  setColor(doc, GOLD);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIDENTIAL', PAGE_W / 2, FOOTER_Y, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  setFill(doc, GOLD);
  doc.rect(MARGIN, FOOTER_Y - 4, CONTENT_W, 0.5, 'F');
}

function checkBreak(doc: jsPDF, y: number, needed: number, pageNum: { value: number }): number {
  if (y + needed > PAGE_H - 25) {
    addSectionFooter(doc, pageNum.value);
    doc.addPage();
    pageNum.value++;
    return 30;
  }
  return y;
}

// ─── Section header ─────────────────────────────────────────────────────────
function drawSectionHeader(doc: jsPDF, title: string, y: number): number {
  setFill(doc, GOLD);
  doc.rect(MARGIN, y - 1, 3, 14, 'F');
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text(sanitize(title), MARGIN + 8, y + 9);
  return y + 22;
}

// ─── Sub-section header ─────────────────────────────────────────────────────
function drawSubHeader(doc: jsPDF, title: string, y: number): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text(sanitize(title), MARGIN, y);
  return y + 8;
}

// ─── Table row ──────────────────────────────────────────────────────────────
function drawRow(
  doc: jsPDF,
  y: number,
  cols: { text: string; x: number; align?: 'left' | 'right'; bold?: boolean; color?: RGB }[],
  bg?: RGB,
  rowH = 8,
) {
  if (bg) {
    setFill(doc, bg);
    doc.rect(MARGIN, y - 4, CONTENT_W, rowH, 'F');
  }
  doc.setFontSize(9);
  for (const col of cols) {
    doc.setFont('helvetica', col.bold ? 'bold' : 'normal');
    setColor(doc, col.color || DARK);
    doc.text(sanitize(col.text), col.x, y, { align: col.align || 'left' });
  }
  return y + rowH + 2;
}

// ─── Rounded rect (manual via lines — jsPDF roundedRect) ────────────────────
function drawBadge(doc: jsPDF, x: number, y: number, text: string, bgColor: RGB, textColor: RGB = WHITE) {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const tw = doc.getTextWidth(sanitize(text)) + 12;
  setFill(doc, bgColor);
  doc.roundedRect(x, y - 3, tw, 12, 2, 2, 'F');
  setColor(doc, textColor);
  doc.text(sanitize(text), x + 6, y + 5);
  return tw;
}

// ─── Progress bar ───────────────────────────────────────────────────────────
function drawProgressBar(doc: jsPDF, x: number, y: number, width: number, height: number, percent: number, fillColor: RGB) {
  // Background
  setFill(doc, { r: 230, g: 230, b: 230 });
  doc.roundedRect(x, y, width, height, height / 2, height / 2, 'F');
  // Fill
  const fillW = Math.max(0, Math.min(percent / 100, 1)) * width;
  if (fillW > 0) {
    setFill(doc, fillColor);
    doc.roundedRect(x, y, fillW, height, height / 2, height / 2, 'F');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: Draw all borrowing capacity sections into an existing PDF
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renders the full Borrowing Capacity deep-dive into an existing jsPDF document.
 * 
 * @param doc - The existing jsPDF document instance
 * @param data - All borrowing capacity data to render
 * @param startY - The Y position to start drawing (will add new page if needed)
 * @param pageNum - Mutable page counter { value: number }
 * @param addNewPageFirst - If true, adds a new page before drawing (default: true)
 * @returns The final Y position after all sections are drawn
 */
export function drawBorrowingCapacitySections(
  doc: jsPDF,
  data: BorrowingCapacityPdfData,
  startY: number,
  pageNum: { value: number },
  addNewPageFirst: boolean = true,
): number {
  let y = startY;

  // ──────────────────────────────────────────────────────────────────────────
  // PAGE: SECTION TITLE
  // ──────────────────────────────────────────────────────────────────────────
  if (addNewPageFirst) {
    addSectionFooter(doc, pageNum.value);
    doc.addPage();
    pageNum.value++;
    y = 30;
  }

  // Section divider title
  setFill(doc, NAVY);
  doc.rect(MARGIN, y - 5, CONTENT_W, 22, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  setColor(doc, GOLD);
  doc.text('BORROWING CAPACITY ASSESSMENT', MARGIN + 10, y + 9);
  y += 30;

  // Date stamp
  if (data.calculatedAt) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY);
    doc.text(`Assessment Date: ${data.calculatedAt}`, MARGIN, y);
    y += 10;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // KPI BOXES (3-column) — mirrors ResultsPanel.tsx
  // ──────────────────────────────────────────────────────────────────────────
  y = drawSectionHeader(doc, 'Executive Summary', y);

  const boxW = (CONTENT_W - 10) / 3;
  const boxH = 38;

  // Box 1: Borrowing Capacity
  setFill(doc, LGRAY);
  doc.rect(MARGIN, y, boxW, boxH, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('BORROWING CAPACITY', MARGIN + 5, y + 10);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text(fmt(data.borrowingCapacity), MARGIN + 5, y + 22);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('Estimate', MARGIN + 5, y + 30);

  // Box 2: Monthly Surplus
  const b2x = MARGIN + boxW + 5;
  const surpColor = data.monthlySurplus >= 0 ? GREEN : RED;
  setFill(doc, LGRAY);
  doc.rect(b2x, y, boxW, boxH, 'F');
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.text('MONTHLY SURPLUS', b2x + 5, y + 10);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  setColor(doc, surpColor);
  doc.text(fmt(data.monthlySurplus), b2x + 5, y + 22);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('/month', b2x + 5, y + 30);

  // Box 3: Serviceability Band
  const b3x = MARGIN + (boxW + 5) * 2;
  const bc = bandColor(data.serviceabilityBand);
  setFill(doc, LGRAY);
  doc.rect(b3x, y, boxW, boxH, 'F');
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text('SERVICEABILITY', b3x + 5, y + 10);
  drawBadge(doc, b3x + 5, y + 17, bandLabel(data.serviceabilityBand), bc);

  y += boxH + 10;

  // Secondary metrics row (DTI, Stress-tested, Assessment Rate)
  const metricW = CONTENT_W / 3;

  // DTI
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('DTI Ratio:', MARGIN, y);
  const dtiColor = data.dtiRatio < 6 ? GREEN : data.dtiRatio < 8 ? AMBER : RED;
  doc.setFont('helvetica', 'bold');
  setColor(doc, dtiColor);
  doc.text(`${data.dtiRatio.toFixed(1)}x`, MARGIN + 22, y);

  // Stress-tested
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('Stress Tested:', MARGIN + metricW, y);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text(fmt(data.stressTestedCapacity), MARGIN + metricW + 30, y);

  // Assessment rate
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text('Assessment Rate:', MARGIN + metricW * 2, y);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text(`${data.assessmentRate.toFixed(2)}%`, MARGIN + metricW * 2 + 35, y);

  y += 8;

  // Capacity gauge / progress bar — taller for better visibility
  const gaugePercent = Math.min(100, (data.borrowingCapacity / 1500000) * 100);
  drawProgressBar(doc, MARGIN, y, CONTENT_W, 6, gaugePercent, bc);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text(fmt(data.borrowingCapacity), MARGIN, y + 12);
  doc.text('$1.5M', MARGIN + CONTENT_W, y + 12, { align: 'right' });
  // Band message below gauge
  doc.setFontSize(7);
  setColor(doc, bandColor(data.serviceabilityBand));
  doc.text(sanitize(bandMessage(data.serviceabilityBand)), MARGIN, y + 18);
  y += 24;

  // ──────────────────────────────────────────────────────────────────────────
  // PROPOSED LOAN CHECK (if provided) — mirrors ResultsPanel proposed loan UI
  // ──────────────────────────────────────────────────────────────────────────
  if (data.proposedLoanCheck) {
    y = checkBreak(doc, y, 50, pageNum);
    const plc = data.proposedLoanCheck;
    const plcBorder = plc.isServiceable ? GREEN : RED;
    const plcBg = plc.isServiceable ? { r: 240, g: 253, b: 244 } : { r: 254, g: 242, b: 242 };

    setFill(doc, plcBg);
    doc.rect(MARGIN, y - 2, CONTENT_W, 40, 'F');
    // Border
    doc.setDrawColor(plcBorder.r, plcBorder.g, plcBorder.b);
    doc.setLineWidth(0.8);
    doc.rect(MARGIN, y - 2, CONTENT_W, 40);
    doc.setLineWidth(0.2);
    doc.setDrawColor(0, 0, 0);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY);
    doc.text('PROPOSED LOAN CHECK', MARGIN + 5, y + 5);

    // Serviceable badge
    drawBadge(
      doc,
      MARGIN + CONTENT_W - 50,
      y + 1,
      plc.isServiceable ? 'Serviceable' : 'Not Serviceable',
      plc.isServiceable ? GREEN : RED,
    );

    // Metrics
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, DARK);
    const colW = CONTENT_W / 4;

    doc.text('Proposed Loan', MARGIN + 5, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(plc.proposedAmount), MARGIN + 5, y + 22);

    doc.setFont('helvetica', 'normal');
    doc.text('Est. Repayment', MARGIN + colW + 5, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.text(`${fmt(plc.monthlyRepayment)}/mo`, MARGIN + colW + 5, y + 22);

    doc.setFont('helvetica', 'normal');
    doc.text('Headroom', MARGIN + colW * 2 + 5, y + 16);
    doc.setFont('helvetica', 'bold');
    setColor(doc, plc.headroom >= 0 ? GREEN : RED);
    doc.text(`${plc.headroom >= 0 ? '+' : ''}${fmt(plc.headroom)}`, MARGIN + colW * 2 + 5, y + 22);

    doc.setFont('helvetica', 'normal');
    setColor(doc, DARK);
    doc.text('Utilization', MARGIN + colW * 3 + 5, y + 16);
    doc.setFont('helvetica', 'bold');
    // Display "Over Capacity" when utilization exceeds 999%, otherwise show percentage
    const utilDisplay = plc.utilizationPercent > 999 ? 'Over Capacity' : `${plc.utilizationPercent}%`;
    doc.text(utilDisplay, MARGIN + colW * 3 + 5, y + 22);

    // Progress bar
    drawProgressBar(doc, MARGIN + 5, y + 30, CONTENT_W - 10, 3, plc.utilizationPercent, plc.isServiceable ? GREEN : RED);

    y += 48;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INCOME ANALYSIS — mirrors IncomeSection.tsx
  // ──────────────────────────────────────────────────────────────────────────
  y = checkBreak(doc, y, 50, pageNum);
  y = drawSectionHeader(doc, 'Income Analysis', y);

  // Summary
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setColor(doc, MDARK);
  doc.text(`Gross Annual Income: ${fmt(data.grossAnnualIncome)}`, MARGIN, y);
  doc.text(`Shaded Annual Income: ${fmt(data.shadedAnnualIncome)}`, MARGIN + 85, y);
  y += 10;

  if (data.incomeBreakdown.length > 0) {
    // Table header
    const incCols = [
      { text: 'Source', x: MARGIN, bold: true, color: NAVY },
      { text: 'Gross Amount', x: MARGIN + 85, align: 'right' as const, bold: true, color: NAVY },
      { text: 'Shading', x: MARGIN + 115, align: 'right' as const, bold: true, color: NAVY },
      { text: 'Shaded Amount', x: MARGIN + CONTENT_W, align: 'right' as const, bold: true, color: NAVY },
    ];

    y = drawRow(doc, y, incCols);
    setFill(doc, GOLD);
    doc.rect(MARGIN, y - 9, CONTENT_W, 0.5, 'F');

    for (let i = 0; i < data.incomeBreakdown.length; i++) {
      const prevY = y;
      y = checkBreak(doc, y, 10, pageNum);
      if (y < prevY) {
        y = drawRow(doc, y, incCols);
        setFill(doc, GOLD);
        doc.rect(MARGIN, y - 9, CONTENT_W, 0.5, 'F');
      }
      const item = data.incomeBreakdown[i];
      const bg = i % 2 === 0 ? LGRAY : undefined;

      // Truncate label
      let label = sanitize(item.label);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      while (doc.getTextWidth(label) > 70 && label.length > 10) {
        label = label.slice(0, -4) + '...';
      }

      // Shading badge color
      const shadingColor = item.shadingRate >= 1 ? GREEN : item.shadingRate >= 0.8 ? AMBER : GRAY;

      y = drawRow(doc, y, [
        { text: label, x: MARGIN },
        { text: fmt(item.grossAmount), x: MARGIN + 85, align: 'right' },
        { text: `${(item.shadingRate * 100).toFixed(0)}%`, x: MARGIN + 115, align: 'right', color: shadingColor, bold: true },
        { text: fmt(item.shadedAmount), x: MARGIN + CONTENT_W, align: 'right', bold: true },
      ], bg);
    }

    // Total row
    y += 2;
    setFill(doc, GOLD);
    doc.rect(MARGIN, y - 4, CONTENT_W, 0.5, 'F');
    y += 2;
    y = drawRow(doc, y, [
      { text: 'Total', x: MARGIN, bold: true, color: NAVY },
      { text: fmt(data.grossAnnualIncome), x: MARGIN + 85, align: 'right', bold: true, color: NAVY },
      { text: '', x: MARGIN + 115, align: 'right' },
      { text: fmt(data.shadedAnnualIncome), x: MARGIN + CONTENT_W, align: 'right', bold: true, color: GREEN },
    ]);

    // Shading info box — dynamically sized to fit all rules
    y += 3;
    const shadingRules = [
      'Base salary: 100%',
      'Bonus/Commission: 80%',
      'Positive property cash flow: 80%',
      'Non-essential overtime: 50%',
    ];
    const shadingBoxH = 8 + shadingRules.length * 4 + 4;
    y = checkBreak(doc, y, shadingBoxH + 8, pageNum);
    setFill(doc, LGRAY);
    doc.rect(MARGIN, y - 2, CONTENT_W, shadingBoxH, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, MDARK);
    doc.text('Income Shading Applied:', MARGIN + 4, y + 4);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY);
    shadingRules.forEach((rule, i) => {
      doc.text(`- ${rule}`, MARGIN + 4, y + 10 + i * 4);
    });
    y += shadingBoxH + 5;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TAX BREAKDOWN (2025-26) — mirrors ResultsPanel tax collapsible
  // ──────────────────────────────────────────────────────────────────────────
  if (data.taxBreakdown) {
    y = checkBreak(doc, y, 55, pageNum);
    y = drawSectionHeader(doc, 'Tax Breakdown (2025-26)', y);
    const tb = data.taxBreakdown;

    const taxRows = [
      { label: 'Gross Income', value: fmt(tb.grossIncome), color: NAVY },
      { label: 'Income Tax', value: `-${fmt(tb.taxPayable)}`, color: RED },
      { label: 'Medicare Levy (2%)', value: `-${fmt(tb.medicareLevy)}`, color: RED },
      { label: 'Total Tax', value: `-${fmt(tb.totalTax)}`, color: RED },
    ];

    for (const row of taxRows) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      setColor(doc, MDARK);
      doc.text(row.label, MARGIN, y);
      doc.setFont('helvetica', 'bold');
      setColor(doc, row.color);
      doc.text(row.value, MARGIN + CONTENT_W, y, { align: 'right' });
      y += 8;
    }

    // Separator
    setFill(doc, GOLD);
    doc.rect(MARGIN, y - 4, CONTENT_W, 0.5, 'F');
    y += 4;

    // After-tax
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    setColor(doc, NAVY);
    doc.text('After-Tax Income:', MARGIN, y);
    setColor(doc, GREEN);
    doc.text(`${fmt(tb.afterTaxIncome)}/yr`, MARGIN + CONTENT_W, y, { align: 'right' });
    y += 8;

    // Rates
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MDARK);
    doc.text(`Effective Rate: ${(tb.effectiveTaxRate * 100).toFixed(1)}%`, MARGIN, y);
    doc.text(`Marginal Rate: ${(tb.marginalTaxRate * 100).toFixed(0)}%`, MARGIN + 60, y);
    y += 6;
    doc.setFontSize(7);
    setColor(doc, GRAY);
    doc.text(`Tax Bracket: ${sanitize(tb.marginalBracket)}`, MARGIN, y);
    y += 6;

    // Monthly take-home
    setFill(doc, { r: 235, g: 245, b: 255 });
    doc.rect(MARGIN, y - 2, CONTENT_W, 12, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BLUE);
    doc.text('After-tax income is used for serviceability assessment', MARGIN + 5, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.text(`Monthly Take-Home: ${fmt(tb.monthlyTakeHome)}`, MARGIN + CONTENT_W - 5, y + 5, { align: 'right' });
    y += 18;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIVING EXPENSES — mirrors ExpensesSection.tsx
  // ──────────────────────────────────────────────────────────────────────────
  y = checkBreak(doc, y, 60, pageNum);
  y = drawSectionHeader(doc, 'Living Expenses', y);

  // Expense method
  const methodLabels: Record<string, string> = {
    hem: 'HEM Benchmark',
    declared: 'Declared Expenses',
    hybrid: 'Hybrid (Higher of HEM/Declared)',
  };
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setColor(doc, MDARK);
  doc.text(`Method: ${methodLabels[data.expenseMethod] || data.expenseMethod}`, MARGIN, y);
  y += 8;

  // HEM breakdown if available
  if (data.hemBreakdown) {
    const hb = data.hemBreakdown;
    setFill(doc, LGRAY);
    doc.rect(MARGIN, y - 2, CONTENT_W, 30, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MDARK);
    doc.text(`HEM Benchmark: ${fmt(hb.finalHem)}/month`, MARGIN + 4, y + 4);
    doc.setFontSize(7);
    setColor(doc, GRAY);
    doc.text(`Household: ${hb.householdType === 'couple' ? 'Couple' : 'Single'}`, MARGIN + 4, y + 11);
    doc.text(`Dependants: ${hb.dependentsCount}`, MARGIN + 55, y + 11);
    doc.text(`Base HEM: ${fmt(hb.baseHem)}`, MARGIN + 4, y + 17);
    doc.text(`Income Tier: ${hb.incomeTier}`, MARGIN + 55, y + 17);
    if (hb.multiplier > 1) {
      doc.setFont('helvetica', 'bold');
      setColor(doc, NAVY);
      doc.text(`${hb.multiplier}x multiplier applied`, MARGIN + 4, y + 24);
      doc.setFont('helvetica', 'normal');
      setColor(doc, GRAY);
      doc.text(`${fmt(hb.baseHem)} x ${hb.multiplier} = ${fmt(hb.finalHem)}`, MARGIN + 55, y + 24);
    }
    y += 34;
  }

  // Declared vs HEM comparison with visual bars
  if (data.hemBenchmark !== undefined && data.declaredExpensesMonthly !== undefined) {
    const maxExp = Math.max(data.hemBenchmark, data.declaredExpensesMonthly, 1);
    const barMaxW = CONTENT_W - 60;
    
    // Declared expenses row
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MDARK);
    doc.text('Declared Expenses:', MARGIN, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${fmt(data.declaredExpensesMonthly)}/mo`, MARGIN + 42, y);
    y += 4;
    // Bar for declared
    const declBarW = data.declaredExpensesMonthly > 0 
      ? Math.max(2, (data.declaredExpensesMonthly / maxExp) * barMaxW) 
      : 0;
    setFill(doc, { r: 230, g: 230, b: 230 });
    doc.roundedRect(MARGIN, y, barMaxW, 3, 1.5, 1.5, 'F');
    if (declBarW > 0) {
      setFill(doc, BLUE);
      doc.roundedRect(MARGIN, y, declBarW, 3, 1.5, 1.5, 'F');
    } else {
      // Show "No data" indicator for $0
      doc.setFontSize(6);
      setColor(doc, GRAY);
      doc.text('No declared expenses', MARGIN + 3, y + 2.5);
    }
    y += 7;
    
    // HEM benchmark row
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MDARK);
    doc.text('HEM Benchmark:', MARGIN, y);
    doc.setFont('helvetica', 'bold');
    doc.text(`${fmt(data.hemBenchmark)}/mo`, MARGIN + 42, y);
    y += 4;
    const hemBarW = Math.max(2, (data.hemBenchmark / maxExp) * barMaxW);
    setFill(doc, { r: 230, g: 230, b: 230 });
    doc.roundedRect(MARGIN, y, barMaxW, 3, 1.5, 1.5, 'F');
    setFill(doc, AMBER);
    doc.roundedRect(MARGIN, y, hemBarW, 3, 1.5, 1.5, 'F');
    y += 7;

    // "Used for assessment" note
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    setColor(doc, GRAY);
    doc.text(`Used for assessment: ${fmt(data.livingExpensesMonthly)}/mo (higher of the two)`, MARGIN, y);
    y += 8;
  }

  // Base living expenses
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  setColor(doc, NAVY);
  doc.text('Base Living Expenses:', MARGIN, y);
  setColor(doc, AMBER);
  doc.text(`${fmt(data.livingExpensesMonthly)}/month`, MARGIN + CONTENT_W, y, { align: 'right' });
  y += 10;

  // ──────────────────────────────────────────────────────────────────────────
  // NEGATIVE PROPERTY CASH FLOWS
  // ──────────────────────────────────────────────────────────────────────────
  if (data.negativePropertyCashFlows && data.negativePropertyCashFlows.length > 0) {
    y = checkBreak(doc, y, 30 + data.negativePropertyCashFlows.length * 8, pageNum);

    setFill(doc, { r: 254, g: 242, b: 242 });
    const ncfH = 10 + data.negativePropertyCashFlows.length * 8 + 12;
    doc.rect(MARGIN, y - 2, CONTENT_W, ncfH, 'F');
    doc.setDrawColor(RED.r, RED.g, RED.b);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, y - 2, CONTENT_W, ncfH);
    doc.setLineWidth(0.2);
    doc.setDrawColor(0, 0, 0);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, RED);
    doc.text('Negative Property Cash Flows', MARGIN + 5, y + 5);
    y += 10;

    for (const ncf of data.negativePropertyCashFlows) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      setColor(doc, MDARK);
      let addr = sanitize(ncf.address);
      while (doc.getTextWidth(addr) > 90 && addr.length > 10) {
        addr = addr.slice(0, -4) + '...';
      }
      doc.text(addr, MARGIN + 5, y);
      doc.setFont('helvetica', 'bold');
      setColor(doc, RED);
      doc.text(`-${fmt(ncf.monthlyCashflow)}/mo`, MARGIN + CONTENT_W - 5, y, { align: 'right' });
      y += 8;
    }

    // Total
    setFill(doc, { r: 252, g: 230, b: 230 });
    doc.rect(MARGIN + 3, y - 2, CONTENT_W - 6, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, RED);
    doc.text('Total Negative Cash Flow', MARGIN + 5, y + 4);
    doc.text(`-${fmt(data.totalNegativeCashFlows || 0)}/mo`, MARGIN + CONTENT_W - 5, y + 4, { align: 'right' });
    y += 14;
  }

  // Effective total expenses
  if (data.effectiveExpensesMonthly !== undefined) {
    y = checkBreak(doc, y, 15, pageNum);
    setFill(doc, LGRAY);
    doc.rect(MARGIN, y - 2, CONTENT_W, 14, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    setColor(doc, NAVY);
    doc.text('Total Monthly Expenses', MARGIN + 5, y + 6);
    doc.setFontSize(10);
    setColor(doc, AMBER);
    doc.text(`${fmt(data.effectiveExpensesMonthly)}/month`, MARGIN + CONTENT_W - 5, y + 6, { align: 'right' });
    y += 20;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LIABILITIES — mirrors LiabilitiesSection.tsx
  // ──────────────────────────────────────────────────────────────────────────
  y = checkBreak(doc, y, 50, pageNum);
  y = drawSectionHeader(doc, 'Existing Liabilities', y);

  if (data.liabilityBreakdown.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setColor(doc, GRAY);
    doc.text('No existing liabilities', MARGIN, y);
    y += 10;
  } else {
    // Table header — includes Method column for servicing calculation notes
    const libCols = [
      { text: 'Liability', x: MARGIN, bold: true, color: NAVY },
      { text: 'Balance', x: MARGIN + 65, align: 'right' as const, bold: true, color: NAVY },
      { text: 'Limit', x: MARGIN + 95, align: 'right' as const, bold: true, color: NAVY },
      { text: 'Servicing', x: MARGIN + 130, align: 'right' as const, bold: true, color: NAVY },
      { text: 'Method', x: MARGIN + CONTENT_W, align: 'right' as const, bold: true, color: NAVY },
    ];

    y = drawRow(doc, y, libCols);
    setFill(doc, GOLD);
    doc.rect(MARGIN, y - 9, CONTENT_W, 0.5, 'F');

    for (let i = 0; i < data.liabilityBreakdown.length; i++) {
      y = checkBreak(doc, y, 16, pageNum);
      const lib = data.liabilityBreakdown[i];
      const bg = i % 2 === 0 ? LGRAY : undefined;

      // Build a combined label: "Type - Provider"
      const typeLabel = formatLiabilityType(lib.type);
      const rawLabel = sanitize(lib.label);
      let combinedLabel = `${typeLabel} - ${rawLabel}`;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      while (doc.getTextWidth(combinedLabel) > 55 && combinedLabel.length > 10) {
        combinedLabel = combinedLabel.slice(0, -4) + '...';
      }

      // Determine servicing method description
      const methodNote = lib.calculationNote
        ? sanitize(lib.calculationNote)
        : getDefaultMethodNote(lib.type);

      y = drawRow(doc, y, [
        { text: combinedLabel, x: MARGIN },
        { text: lib.balance > 0 ? fmt(lib.balance) : '-', x: MARGIN + 65, align: 'right' },
        { text: lib.limit !== undefined ? fmt(lib.limit) : '-', x: MARGIN + 95, align: 'right' },
        { text: `${fmt(lib.monthlyServicing)}/mo`, x: MARGIN + 130, align: 'right', bold: true, color: RED },
        { text: methodNote, x: MARGIN + CONTENT_W, align: 'right', color: GRAY },
      ], bg);
    }

    // Total
    y += 2;
    setFill(doc, GOLD);
    doc.rect(MARGIN, y - 4, CONTENT_W, 0.5, 'F');
    y += 4;
    y = drawRow(doc, y, [
      { text: 'Total Monthly Commitments:', x: MARGIN, bold: true, color: NAVY },
      { text: '', x: MARGIN + 65 },
      { text: '', x: MARGIN + 95 },
      { text: `${fmt(data.existingCommitmentsMonthly)}/mo`, x: MARGIN + 130, align: 'right', bold: true, color: RED },
      { text: '', x: MARGIN + CONTENT_W },
    ]);

    // Assessment rules box
    y += 3;
    y = checkBreak(doc, y, 35, pageNum);
    setFill(doc, LGRAY);
    doc.rect(MARGIN, y - 2, CONTENT_W, 32, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(doc, MDARK);
    doc.text('Liability Assessment Rules:', MARGIN + 4, y + 4);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY);
    const rules = [
      'Credit cards: 3% of credit limit (not balance)',
      'BNPL (Afterpay etc.): 5% of limit/balance',
      'HECS/HELP: ATO repayment brackets based on income',
      'Car loans: Est. P&I @ 8% / 5yr if no repayment entered',
      'Personal loans: Est. P&I @ 10% / 7yr if no repayment entered',
      'Property loans: Stress-tested at P&I @ 9.5%',
    ];
    rules.forEach((rule, i) => {
      doc.text(`- ${rule}`, MARGIN + 4, y + 10 + i * 3.5);
    });
    y += 36;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAPACITY BREAKDOWN (Waterfall)
  // ──────────────────────────────────────────────────────────────────────────
  y = checkBreak(doc, y, 80, pageNum);
  y = drawSectionHeader(doc, 'Capacity Breakdown', y);

  const breakdownItems = [
    { label: 'Gross Annual Income', value: fmt(data.grossAnnualIncome), color: NAVY },
    { label: 'Shaded Annual Income', value: fmt(data.shadedAnnualIncome), color: NAVY },
    { label: 'Living Expenses (Monthly)', value: `-${fmt(data.livingExpensesMonthly)}`, color: RED },
    { label: 'Existing Commitments (Monthly)', value: `-${fmt(data.existingCommitmentsMonthly)}`, color: RED },
    { label: 'Monthly Surplus', value: fmt(data.monthlySurplus), color: data.monthlySurplus >= 0 ? GREEN : RED },
    { label: 'Assessment Rate Applied', value: `${data.assessmentRate.toFixed(2)}%`, color: NAVY },
    { label: 'Loan Term', value: `${data.loanTermYears || 30} years`, color: NAVY },
  ];

  const LIGHT_GRAY = { r: 245, g: 245, b: 245 };
  for (let i = 0; i < breakdownItems.length; i++) {
    const item = breakdownItems[i];
    y = checkBreak(doc, y, 12, pageNum);
    // Alternating row background
    if (i % 2 === 0) {
      setFill(doc, LIGHT_GRAY);
      doc.rect(MARGIN, y - 4, CONTENT_W, 10, 'F');
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(doc, MDARK);
    doc.text(sanitize(item.label), MARGIN + 3, y + 1);
    doc.setFont('helvetica', 'bold');
    setColor(doc, item.color);
    doc.text(item.value, MARGIN + CONTENT_W - 3, y + 1, { align: 'right' });
    y += 11;
  }

  // Gold "Maximum Borrowing Capacity" bar — ensure it doesn't overlap footer
  y = checkBreak(doc, y, 25, pageNum);
  y += 2;
  setFill(doc, GOLD);
  doc.roundedRect(MARGIN, y - 5, CONTENT_W, 14, 2, 2, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setColor(doc, { r: 255, g: 255, b: 255 });
  doc.text('Maximum Borrowing Capacity', MARGIN + 5, y + 4);
  doc.text(fmt(data.borrowingCapacity), MARGIN + CONTENT_W - 5, y + 4, { align: 'right' });
  y += 18;

  // ──────────────────────────────────────────────────────────────────────────
  // SERVICEABILITY VERDICT — large visual band
  // ──────────────────────────────────────────────────────────────────────────
  y = checkBreak(doc, y, 30, pageNum);
  const verdictBg = data.serviceabilityBand === 'green'
    ? { r: 240, g: 253, b: 244 }
    : data.serviceabilityBand === 'amber'
      ? { r: 255, g: 251, b: 235 }
      : { r: 254, g: 242, b: 242 };

  setFill(doc, verdictBg);
  doc.rect(MARGIN, y - 3, CONTENT_W, 24, 'F');
  doc.setDrawColor(bc.r, bc.g, bc.b);
  doc.setLineWidth(0.6);
  doc.rect(MARGIN, y - 3, CONTENT_W, 24);
  doc.setLineWidth(0.2);
  doc.setDrawColor(0, 0, 0);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  setColor(doc, GRAY);
  doc.text('SERVICEABILITY VERDICT', MARGIN + 5, y + 4);

  // Band badge
  drawBadge(doc, MARGIN + 5, y + 8, bandLabel(data.serviceabilityBand), bc);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  setColor(doc, MDARK);
  doc.text(sanitize(bandMessage(data.serviceabilityBand)), MARGIN + 55, y + 14);

  y += 30;

  // ──────────────────────────────────────────────────────────────────────────
  // RECOMMENDATIONS
  // ──────────────────────────────────────────────────────────────────────────
  if (data.recommendations.length > 0) {
    y = checkBreak(doc, y, 20 + data.recommendations.length * 10, pageNum);
    y = drawSectionHeader(doc, 'Recommendations', y);

    for (const rec of data.recommendations) {
      y = checkBreak(doc, y, 10, pageNum);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      setColor(doc, GREEN);
      doc.text('-', MARGIN, y);
      setColor(doc, DARK);
      const lines: string[] = doc.splitTextToSize(sanitize(rec), CONTENT_W - 8);
      doc.text(lines, MARGIN + 5, y);
      y += lines.length * 5 + 3;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WARNINGS
  // ──────────────────────────────────────────────────────────────────────────
  if (data.warnings.length > 0) {
    y = checkBreak(doc, y, 20 + data.warnings.length * 10, pageNum);
    y = drawSectionHeader(doc, 'Warnings', y);

    for (const w of data.warnings) {
      y = checkBreak(doc, y, 10, pageNum);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      setColor(doc, AMBER);
      doc.text('!', MARGIN, y);
      setColor(doc, { r: 80, g: 50, b: 20 });
      const lines: string[] = doc.splitTextToSize(sanitize(w), CONTENT_W - 8);
      doc.text(lines, MARGIN + 5, y);
      y += lines.length * 5 + 3;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ASSUMPTIONS
  // ──────────────────────────────────────────────────────────────────────────
  const assumptions = data.assumptions || [
    { key: 'Buffer Rate', value: `${(data.bufferRate ?? 3).toFixed(1)}%` },
    { key: 'Loan Term', value: `${data.loanTermYears || 30} years` },
    { key: 'Interest Rate', value: `${(data.interestRate ?? (data.assessmentRate - 3)).toFixed(2)}%` },
    { key: 'Assessment Rate', value: `${data.assessmentRate.toFixed(2)}%` },
  ];

  if (assumptions.length > 0) {
    y = checkBreak(doc, y, 30, pageNum);
    y += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GRAY);
    doc.text('Assumptions Used', MARGIN, y);
    y += 6;

    for (const a of assumptions) {
      y = checkBreak(doc, y, 8, pageNum);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      setColor(doc, GRAY);
      doc.text(sanitize(a.key) + ':', MARGIN, y);
      doc.setFont('helvetica', 'bold');
      setColor(doc, MDARK);
      doc.text(sanitize(a.value), MARGIN + 50, y);
      y += 5;
    }
    y += 5;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DISCLAIMER — must stay on the SAME page as the last BC content
  // ──────────────────────────────────────────────────────────────────────────
  const disclaimer = 'This is an estimate only and does not constitute a formal loan offer. Actual lending decisions are made by financial institutions. We recommend a formal broker assessment before making financial decisions. Actual borrowing capacity may vary depending on lender policies, credit history, and specific circumstances.';
  // Pre-calculate height so we can ensure it fits on the current page
  doc.setFontSize(7);
  const dLines: string[] = doc.splitTextToSize(disclaimer, CONTENT_W - 8);
  const disclaimerBoxH = dLines.length * 3.5 + 8;
  y = checkBreak(doc, y, disclaimerBoxH + 5, pageNum);
  y += 4;

  // Draw disclaimer header label
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  setColor(doc, AMBER);
  doc.text('DISCLAIMER', MARGIN, y);
  y += 5;

  setFill(doc, LGRAY);
  doc.rect(MARGIN, y - 2, CONTENT_W, disclaimerBoxH, 'F');
  doc.setDrawColor(AMBER.r, AMBER.g, AMBER.b);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN, y - 2, CONTENT_W, disclaimerBoxH);
  doc.setLineWidth(0.2);
  doc.setDrawColor(0, 0, 0);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text(dLines, MARGIN + 4, y + 4);
  y += disclaimerBoxH + 6;

  // Add footer to last page of this section
  addSectionFooter(doc, pageNum.value);

  return y;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TRANSFORMER: Convert raw assessment DB row into BorrowingCapacityPdfData
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transforms a raw `borrowing_capacity_assessments` DB row + supplementary data
 * into the structured `BorrowingCapacityPdfData` expected by the renderer.
 */
export function transformAssessmentToSectionData(
  assessment: any,
  options?: {
    incomeSources?: any[];
    liabilities?: any[];
    properties?: any[];
    client?: any;
    expenses?: any[];
  }
): BorrowingCapacityPdfData {
  const a = assessment;

  // Build income breakdown from assessment data or raw sources
  const incomeBreakdown: BCIncomeItem[] = [];
  const storedBreakdown = a.income_breakdown;
  
  if (storedBreakdown && Array.isArray(storedBreakdown) && storedBreakdown.length > 0) {
    for (const item of storedBreakdown) {
      incomeBreakdown.push({
        label: item.component || item.label || item.source_name || 'Income',
        grossAmount: item.grossAmount || item.gross_annual_amount || 0,
        shadingRate: item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1,
        shadedAmount: item.shadedAmount || (item.grossAmount || 0) * (item.shadingRate || 1),
      });
    }
  } else if (options?.incomeSources && options.incomeSources.length > 0) {
    for (const src of options.incomeSources) {
      const rate = src.custom_shading_rate ?? src.default_shading_rate ?? 1;
      const gross = Number(src.gross_annual_amount) || 0;
      if (gross > 0) {
        incomeBreakdown.push({
          label: src.source_name || src.source_type || 'Income',
          grossAmount: gross,
          shadingRate: rate,
          shadedAmount: gross * rate,
        });
      }
    }
  }

  // Build liability breakdown
  const liabilityBreakdown: BCLiabilityItem[] = [];
  const storedLiabilities = a.liability_breakdown;
  
  if (storedLiabilities && Array.isArray(storedLiabilities) && storedLiabilities.length > 0) {
    for (const lib of storedLiabilities) {
      liabilityBreakdown.push({
        type: lib.type || lib.liability_type || 'other',
        label: lib.label || lib.provider_name || lib.type || 'Liability',
        balance: lib.balance || lib.current_balance || 0,
        limit: lib.limit || lib.credit_limit,
        monthlyServicing: lib.monthlyServicing || lib.monthly_repayment || 0,
        calculationNote: lib.calculationNote,
      });
    }
  } else if (options?.liabilities && options.liabilities.length > 0) {
    // Use shared engine so credit-card 3% / BNPL 5% / HECS / P&I fallbacks
    // are applied consistently with FormaraPDFGenerator and BorrowingCapacityModal.
    const totalGrossAnnualIncome = Number(a.gross_annual_income) || 0;
    const servicing = buildLiabilityServicing(options.liabilities, { totalGrossAnnualIncome });
    for (const item of servicing.items) {
      liabilityBreakdown.push({
        type: item.type,
        label: item.label,
        balance: item.balance,
        limit: item.limit,
        monthlyServicing: item.monthlyServicing,
        calculationNote: item.calculationNote || undefined,
      });
    }
  }

  // Extract expense breakdown
  const expenseBreakdown = a.expense_breakdown;
  let hemBreakdown: BCHemBreakdown | undefined;
  let declaredExpenses: number | undefined;
  let negCashFlows: BCNegativeCashFlow[] | undefined;
  let totalNegCF = 0;
  let effectiveExpenses: number | undefined;

  if (expenseBreakdown && typeof expenseBreakdown === 'object') {
    if (expenseBreakdown.hemBreakdown) {
      hemBreakdown = expenseBreakdown.hemBreakdown;
    }
    if (expenseBreakdown.declaredExpenses !== undefined) {
      declaredExpenses = expenseBreakdown.declaredExpenses;
    }
    if (expenseBreakdown.negativePropertyCashFlows) {
      negCashFlows = expenseBreakdown.negativePropertyCashFlows;
      totalNegCF = expenseBreakdown.totalNegativeCashFlows || 0;
    }
    if (expenseBreakdown.effectiveExpenses !== undefined) {
      effectiveExpenses = expenseBreakdown.effectiveExpenses;
    }
  }

  // Tax breakdown
  let taxBreakdown: BCTaxBreakdown | undefined;
  if (a.gross_annual_income > 0) {
    // Import-free inline calculation (mirrors borrowingCapacityCalculations.ts)
    const gross = a.gross_annual_income;
    const brackets = [
      { min: 0, max: 18200, rate: 0, base: 0 },
      { min: 18201, max: 45000, rate: 0.16, base: 0 },
      { min: 45001, max: 135000, rate: 0.30, base: 4288 },
      { min: 135001, max: 190000, rate: 0.37, base: 31288 },
      { min: 190001, max: Infinity, rate: 0.45, base: 51638 },
    ];
    let tax = 0;
    let marginalRate = 0;
    let bracketLabel = '$0 - $18,200 (0%)';
    for (const b of brackets) {
      if (gross >= b.min) {
        if (gross <= b.max) {
          const prevMax = brackets[brackets.indexOf(b) - 1]?.max || 0;
          tax = b.base + (gross - prevMax) * b.rate;
          marginalRate = b.rate;
          break;
        }
      }
    }
    if (gross > 190000) bracketLabel = '$190,001+ (45% + 2% ML)';
    else if (gross > 135000) bracketLabel = '$135,001 - $190,000 (37% + 2% ML)';
    else if (gross > 45000) bracketLabel = '$45,001 - $135,000 (30% + 2% ML)';
    else if (gross > 18200) bracketLabel = '$18,201 - $45,000 (16% + 2% ML)';

    const medicare = Math.round(gross * 0.02);
    const totalTax = tax + medicare;
    const afterTax = gross - totalTax;

    taxBreakdown = {
      grossIncome: gross,
      taxPayable: Math.round(tax),
      medicareLevy: medicare,
      totalTax: Math.round(totalTax),
      afterTaxIncome: Math.round(afterTax),
      effectiveTaxRate: gross > 0 ? totalTax / gross : 0,
      marginalTaxRate: marginalRate + 0.02,
      marginalBracket: bracketLabel,
      monthlyTakeHome: Math.round(afterTax / 12),
    };
  }

  // Proposed loan check
  let proposedLoanCheck: BCProposedLoanCheck | undefined;
  if (a.proposed_loan_amount && a.proposed_loan_amount > 0) {
    const rate = (a.assessment_rate || a.interest_rate_used || 9.5) / 100 / 12;
    const periods = (a.loan_term_years || 30) * 12;
    const monthlyRep = a.proposed_loan_amount * (rate * Math.pow(1 + rate, periods)) / (Math.pow(1 + rate, periods) - 1);
    const cap = a.borrowing_capacity || 0;
    // Guard: when capacity is 0, utilization is meaningless — cap at 100%
    const utilPct = cap <= 0 ? 100 : Math.min(Math.round((a.proposed_loan_amount / cap) * 100), 99999);
    proposedLoanCheck = {
      proposedAmount: a.proposed_loan_amount,
      monthlyRepayment: Math.round(monthlyRep),
      isServiceable: cap >= a.proposed_loan_amount,
      headroom: cap - a.proposed_loan_amount,
      utilizationPercent: utilPct,
    };
  }

  // Build assumptions
  const assumptions: { key: string; value: string }[] = [];
  const storedAssumptions = a.assumptions;
  if (storedAssumptions && Array.isArray(storedAssumptions)) {
    for (const item of storedAssumptions) {
      assumptions.push({
        key: item.key || String(item),
        value: item.value || '',
      });
    }
  } else {
    const ir = a.interest_rate_used || (a.assessment_rate ? a.assessment_rate - (a.buffer_rate || 3) : 6.5);
    assumptions.push(
      { key: 'Buffer Rate', value: `${(a.buffer_rate || 3).toFixed(1)}%` },
      { key: 'Loan Term', value: `${a.loan_term_years || 30} years` },
      { key: 'Interest Rate', value: `${ir.toFixed(2)}%` },
      { key: 'Assessment Rate', value: `${(a.assessment_rate || a.interest_rate_used || 9.5).toFixed(2)}%` },
    );
  }

  const recommendations: string[] = Array.isArray(a.recommendations)
    ? a.recommendations.map((r: any) => typeof r === 'string' ? r : r.text || JSON.stringify(r))
    : [];

  const warnings: string[] = Array.isArray(a.warnings) ? a.warnings : [];

  return {
    borrowingCapacity: a.borrowing_capacity || 0,
    stressTestedCapacity: a.stress_tested_capacity || 0,
    monthlySurplus: a.monthly_surplus || 0,
    serviceabilityBand: (a.serviceability_band || 'red') as 'green' | 'amber' | 'red',
    dtiRatio: a.dti_ratio || 0,
    assessmentRate: a.assessment_rate || a.interest_rate_used || 9.5,
    grossAnnualIncome: a.gross_annual_income || 0,
    shadedAnnualIncome: a.shaded_annual_income || 0,
    incomeBreakdown,
    taxBreakdown,
    expenseMethod: (a.expense_method || 'hybrid') as 'hem' | 'declared' | 'hybrid',
    livingExpensesMonthly: a.living_expenses_monthly || 0,
    hemBenchmark: expenseBreakdown?.hemBenchmark || hemBreakdown?.finalHem,
    hemBreakdown,
    declaredExpensesMonthly: declaredExpenses,
    negativePropertyCashFlows: negCashFlows,
    totalNegativeCashFlows: totalNegCF,
    effectiveExpensesMonthly: effectiveExpenses,
    existingCommitmentsMonthly: a.existing_commitments_monthly || 0,
    liabilityBreakdown,
    proposedLoanCheck,
    recommendations,
    warnings,
    assumptions,
    interestRate: a.interest_rate_used || undefined,
    bufferRate: a.buffer_rate || undefined,
    loanTermYears: a.loan_term_years || 30,
    calculatedAt: a.created_at ? new Date(a.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
  };
}

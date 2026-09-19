/**
 * Borrowing Capacity PDF Sections — pdf-lib version
 * 
 * Comprehensive multi-page borrowing capacity renderer for pdf-lib documents.
 * Used by the Portfolio Performance Report (PPR) generator.
 * 
 * Renders the same sections as the jsPDF version but using pdf-lib's API:
 *   1. Executive KPIs (Capacity, Surplus, Band)
 *   2. Proposed Loan Serviceability Check
 *   3. Income Analysis with Shading Table
 *   4. Tax Breakdown (2025-26)
 *   5. Living Expenses with HEM Comparison
 *   6. Negative Property Cash Flows
 *   7. Liabilities Schedule with Assessment Rules
 *   8. Capacity Waterfall Breakdown
 *   9. Serviceability Verdict & Gauge
 *  10. Recommendations & Warnings
 *  11. Assumptions
 */

import { PDFDocument, PDFPage, PDFFont, rgb, type Color } from 'pdf-lib';

// ─── Brand Colors (matching PPR generator) ──────────────────────────────────
const NPC_GOLD = rgb(0.79, 0.64, 0.15);
const NPC_NAVY = rgb(0.05, 0.15, 0.30);
const NPC_WHITE = rgb(1, 1, 1);
const MUTED = rgb(0.5, 0.5, 0.5);
const SUCCESS = rgb(0.09, 0.64, 0.29);
const DANGER = rgb(0.94, 0.27, 0.27);
const WARNING = rgb(0.96, 0.62, 0.04);
const BLUE_ACCENT = rgb(0.23, 0.51, 0.96);
const DARK_TEXT = rgb(0.15, 0.15, 0.15);
const LIGHT_BG = rgb(0.97, 0.97, 0.97);
const BORDER_COLOR = rgb(0.9, 0.9, 0.9);
const GREEN_BG = rgb(0.94, 0.99, 0.95);
const RED_BG = rgb(0.99, 0.95, 0.95);

// ─── Layout ─────────────────────────────────────────────────────────────────
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// ─── Spacing constants (matching PPR generator) ─────────────────────────────
const SECTION_SPACING = 35;        // Space after major sections
const SUBSECTION_SPACING = 24;     // Space after subsections
const PARAGRAPH_SPACING = 18;      // Space between paragraphs
const TABLE_ROW_HEIGHT = 22;       // Consistent row height for tables

// ─── Types ──────────────────────────────────────────────────────────────────
export interface BCPdfLibIncomeItem {
  label: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
}

export interface BCPdfLibLiabilityItem {
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  calculationNote?: string;
}

export interface BCPdfLibNegativeCashFlow {
  address: string;
  monthlyCashflow: number;
}

export interface BCPdfLibHemBreakdown {
  householdType: string;
  dependentsCount: number;
  baseHem: number;
  incomeTier: string;
  multiplier: number;
  finalHem: number;
}

export interface BCPdfLibTaxBreakdown {
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

export interface BCPdfLibProposedLoanCheck {
  proposedAmount: number;
  monthlyRepayment: number;
  isServiceable: boolean;
  headroom: number;
  utilizationPercent: number;
}

export interface BorrowingCapacityPdfLibData {
  borrowingCapacity: number;
  stressTestedCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
  assessmentRate: number;
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  incomeBreakdown: BCPdfLibIncomeItem[];
  taxBreakdown?: BCPdfLibTaxBreakdown;
  expenseMethod: 'hem' | 'declared' | 'hybrid';
  livingExpensesMonthly: number;
  hemBenchmark?: number;
  hemBreakdown?: BCPdfLibHemBreakdown;
  declaredExpensesMonthly?: number;
  negativePropertyCashFlows?: BCPdfLibNegativeCashFlow[];
  totalNegativeCashFlows?: number;
  effectiveExpensesMonthly?: number;
  existingCommitmentsMonthly: number;
  liabilityBreakdown: BCPdfLibLiabilityItem[];
  proposedLoanCheck?: BCPdfLibProposedLoanCheck;
  recommendations: string[];
  warnings: string[];
  assumptions?: { key: string; value: string }[];
  interestRate?: number;
  bufferRate?: number;
  loanTermYears?: number;
  calculatedAt?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (v: number): string => {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `-$${s}` : `$${s}`;
};

const sanitize = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const bandColor = (band: string): Color => {
  if (band === 'green') return SUCCESS;
  if (band === 'amber') return WARNING;
  return DANGER;
};

const bandLabel = (band: string): string => {
  if (band === 'green') return 'STRONG';
  if (band === 'amber') return 'MODERATE';
  return 'LIMITED';
};

const bandMessage = (band: string): string => {
  if (band === 'green') return 'Strong borrowing position - well placed for growth';
  if (band === 'amber') return 'Moderate capacity - proceed with caution';
  return 'Limited capacity - focus on debt reduction';
};

const formatLiabilityType = (type: string): string => {
  const labels: Record<string, string> = {
    home_loan: 'Home Loan', investment_loan: 'Investment Loan', car_loan: 'Car Loan',
    personal_loan: 'Personal Loan', credit_card: 'Credit Card', hecs: 'HECS/HELP',
    afterpay_bnpl: 'BNPL', rent_expense: 'Rent Expense', other: 'Other',
  };
  return labels[type] || type.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// ─── Drawing helpers ────────────────────────────────────────────────────────
function drawSectionTitle(page: PDFPage, title: string, y: number, boldFont: PDFFont): number {
  // Gold accent bar
  page.drawRectangle({ x: MARGIN_LEFT, y: y - 5, width: 4, height: 18, color: NPC_GOLD });
  page.drawText(sanitize(title), { x: MARGIN_LEFT + 12, y, size: 13, font: boldFont, color: NPC_NAVY });
  return y - SECTION_SPACING;
}

function drawSubTitle(page: PDFPage, title: string, y: number, boldFont: PDFFont): number {
  page.drawText(sanitize(title), { x: MARGIN_LEFT, y, size: 10, font: boldFont, color: NPC_NAVY });
  return y - SUBSECTION_SPACING;
}

function drawKpiBox(
  page: PDFPage, x: number, y: number, width: number, height: number,
  label: string, value: string, sublabel: string,
  valueColor: Color, font: PDFFont, boldFont: PDFFont,
  borderColor?: Color,
) {
  page.drawRectangle({ x, y: y - height, width, height, color: LIGHT_BG, borderColor: borderColor || BORDER_COLOR, borderWidth: 1 });
  page.drawText(label, { x: x + 8, y: y - 16, size: 7, font, color: MUTED });
  page.drawText(sanitize(value), { x: x + 8, y: y - 38, size: 16, font: boldFont, color: valueColor });
  if (sublabel) {
    page.drawText(sanitize(sublabel), { x: x + 8, y: y - 52, size: 8, font, color: MUTED });
  }
}

function drawProgressBar(
  page: PDFPage, x: number, y: number, width: number, height: number,
  percent: number, fillColor: Color,
) {
  page.drawRectangle({ x, y, width, height, color: rgb(0.9, 0.9, 0.9) });
  const fillW = Math.max(0, Math.min(percent / 100, 1)) * width;
  if (fillW > 0) {
    page.drawRectangle({ x, y, width: fillW, height, color: fillColor });
  }
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

function drawTableRow(
  page: PDFPage, y: number, cols: { text: string; x: number; font: PDFFont; color?: Color; size?: number; maxWidth?: number }[],
  bg?: Color, rowH = TABLE_ROW_HEIGHT,
): number {
  // Calculate actual row height based on wrapped text in any column
  const LINE_HEIGHT = 11;
  let maxLines = 1;
  const wrappedCols: string[][] = [];

  for (const col of cols) {
    if (col.maxWidth) {
      const lines = wrapText(sanitize(col.text), col.font, col.size || 9, col.maxWidth);
      wrappedCols.push(lines);
      if (lines.length > maxLines) maxLines = lines.length;
    } else {
      wrappedCols.push([sanitize(col.text)]);
    }
  }

  const actualRowH = maxLines > 1 ? Math.max(rowH, maxLines * LINE_HEIGHT + 8) : rowH;

  if (bg) {
    page.drawRectangle({ x: MARGIN_LEFT, y: y - actualRowH + 4, width: CONTENT_WIDTH, height: actualRowH, color: bg });
  }
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const lines = wrappedCols[i];
    for (let li = 0; li < lines.length; li++) {
      page.drawText(lines[li], {
        x: col.x,
        y: y - li * LINE_HEIGHT,
        size: col.size || 9,
        font: col.font,
        color: col.color || DARK_TEXT,
      });
    }
  }
  return y - actualRowH;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

interface DrawContext {
  pdfDoc: PDFDocument;
  font: PDFFont;
  boldFont: PDFFont;
  addContentPage: () => PDFPage;
}

/**
 * Draws the full borrowing capacity deep-dive into a pdf-lib document.
 * Returns the current page and y position after all sections are rendered.
 */
export function drawBorrowingCapacityPdfLib(
  ctx: DrawContext,
  data: BorrowingCapacityPdfLibData,
  startPage: PDFPage,
  startY: number,
): { page: PDFPage; yPos: number } {
  const { font, boldFont, addContentPage } = ctx;
  let page = startPage;
  let y = startY;

  const needsNewPage = (currentY: number, needed: number): boolean => currentY - needed < MARGIN_BOTTOM;

  const ensureSpace = (needed: number): void => {
    if (needsNewPage(y, needed)) {
      page = addContentPage();
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
  };

  // ── SECTION COVER ─────────────────────────────────────────────────────────
  page = addContentPage();
  y = PAGE_HEIGHT - MARGIN_TOP;

  // Navy title bar
  page.drawRectangle({ x: MARGIN_LEFT, y: y - 8, width: CONTENT_WIDTH, height: 28, color: NPC_NAVY });
  page.drawText('BORROWING CAPACITY ASSESSMENT', { x: MARGIN_LEFT + 12, y: y - 1, size: 14, font: boldFont, color: NPC_GOLD });
  y -= 55;

  // Date stamp
  if (data.calculatedAt) {
    page.drawText(`Assessment Date: ${sanitize(data.calculatedAt)}`, { x: MARGIN_LEFT, y, size: 8, font, color: MUTED });
    y -= SUBSECTION_SPACING;
  }

  // ── EXECUTIVE KPI BOXES (3-column) ────────────────────────────────────────
  y = drawSectionTitle(page, 'Executive Summary', y, boldFont);

  const boxW = (CONTENT_WIDTH - 20) / 3;
  const boxH = 60;

  // Box 1: Borrowing Capacity
  drawKpiBox(page, MARGIN_LEFT, y, boxW, boxH, 'BORROWING CAPACITY', fmt(data.borrowingCapacity), 'Estimate', NPC_NAVY, font, boldFont);

  // Box 2: Monthly Surplus
  const surpColor = data.monthlySurplus >= 0 ? SUCCESS : DANGER;
  drawKpiBox(page, MARGIN_LEFT + boxW + 10, y, boxW, boxH, 'MONTHLY SURPLUS', fmt(data.monthlySurplus), '/month', surpColor, font, boldFont);

  // Box 3: Serviceability Band
  const bc = bandColor(data.serviceabilityBand);
  const bl = bandLabel(data.serviceabilityBand);
  page.drawRectangle({ x: MARGIN_LEFT + (boxW + 10) * 2, y: y - boxH, width: boxW, height: boxH, color: LIGHT_BG, borderColor: BORDER_COLOR, borderWidth: 1 });
  page.drawText('SERVICEABILITY', { x: MARGIN_LEFT + (boxW + 10) * 2 + 8, y: y - 16, size: 7, font, color: MUTED });
  // Colored badge
  const badgeW = boldFont.widthOfTextAtSize(bl, 10) + 16;
  page.drawRectangle({ x: MARGIN_LEFT + (boxW + 10) * 2 + 8, y: y - 45, width: badgeW, height: 20, color: bc });
  page.drawText(bl, { x: MARGIN_LEFT + (boxW + 10) * 2 + 16, y: y - 39, size: 10, font: boldFont, color: NPC_WHITE });

  y -= boxH + SUBSECTION_SPACING;

  // Secondary metrics row
  const metricW = CONTENT_WIDTH / 3;
  const dtiColor = data.dtiRatio < 6 ? SUCCESS : data.dtiRatio < 8 ? WARNING : DANGER;

  page.drawText('DTI Ratio:', { x: MARGIN_LEFT, y, size: 9, font, color: MUTED });
  page.drawText(`${data.dtiRatio.toFixed(1)}x`, { x: MARGIN_LEFT + 55, y, size: 9, font: boldFont, color: dtiColor });

  page.drawText('Stress Tested:', { x: MARGIN_LEFT + metricW, y, size: 9, font, color: MUTED });
  page.drawText(fmt(data.stressTestedCapacity), { x: MARGIN_LEFT + metricW + 70, y, size: 9, font: boldFont, color: NPC_NAVY });

  page.drawText('Assessment Rate:', { x: MARGIN_LEFT + metricW * 2, y, size: 9, font, color: MUTED });
  page.drawText(`${data.assessmentRate.toFixed(2)}%`, { x: MARGIN_LEFT + metricW * 2 + 85, y, size: 9, font: boldFont, color: NPC_NAVY });

  y -= SUBSECTION_SPACING;

  // Capacity gauge
  const gaugePercent = Math.min(100, (data.borrowingCapacity / 1500000) * 100);
  drawProgressBar(page, MARGIN_LEFT, y, CONTENT_WIDTH, 6, gaugePercent, bc);
  page.drawText('$0', { x: MARGIN_LEFT, y: y - 14, size: 7, font, color: MUTED });
  page.drawText('$1.5M', { x: MARGIN_LEFT + CONTENT_WIDTH - 25, y: y - 14, size: 7, font, color: MUTED });
  y -= 28;

  // Band message
  page.drawText(sanitize(bandMessage(data.serviceabilityBand)), { x: MARGIN_LEFT, y, size: 9, font, color: bc });
  y -= SECTION_SPACING;

  // ── PROPOSED LOAN CHECK ───────────────────────────────────────────────────
  if (data.proposedLoanCheck) {
    ensureSpace(100);
    const plc = data.proposedLoanCheck;
    const plcBg = plc.isServiceable ? GREEN_BG : RED_BG;
    const plcBorder = plc.isServiceable ? SUCCESS : DANGER;

    page.drawRectangle({ x: MARGIN_LEFT, y: y - 65, width: CONTENT_WIDTH, height: 65, color: plcBg, borderColor: plcBorder, borderWidth: 1.5 });

    page.drawText('PROPOSED LOAN CHECK', { x: MARGIN_LEFT + 10, y: y - 12, size: 7, font: boldFont, color: MUTED });

    // Serviceable badge
    const sLabel = plc.isServiceable ? 'SERVICEABLE' : 'NOT SERVICEABLE';
    const sBadgeW = boldFont.widthOfTextAtSize(sLabel, 8) + 12;
    page.drawRectangle({ x: MARGIN_LEFT + CONTENT_WIDTH - sBadgeW - 10, y: y - 18, width: sBadgeW, height: 16, color: plcBorder });
    page.drawText(sLabel, { x: MARGIN_LEFT + CONTENT_WIDTH - sBadgeW - 4, y: y - 12, size: 8, font: boldFont, color: NPC_WHITE });

    // Metrics
    const colW = (CONTENT_WIDTH - 20) / 4;
    const metricsY = y - 35;
    page.drawText('Proposed Loan', { x: MARGIN_LEFT + 10, y: metricsY, size: 7, font, color: MUTED });
    page.drawText(fmt(plc.proposedAmount), { x: MARGIN_LEFT + 10, y: metricsY - 12, size: 10, font: boldFont, color: NPC_NAVY });

    page.drawText('Est. Repayment', { x: MARGIN_LEFT + colW + 10, y: metricsY, size: 7, font, color: MUTED });
    page.drawText(`${fmt(plc.monthlyRepayment)}/mo`, { x: MARGIN_LEFT + colW + 10, y: metricsY - 12, size: 10, font: boldFont, color: NPC_NAVY });

    page.drawText('Headroom', { x: MARGIN_LEFT + colW * 2 + 10, y: metricsY, size: 7, font, color: MUTED });
    const headroomColor = plc.headroom >= 0 ? SUCCESS : DANGER;
    page.drawText(`${plc.headroom >= 0 ? '+' : ''}${fmt(plc.headroom)}`, { x: MARGIN_LEFT + colW * 2 + 10, y: metricsY - 12, size: 10, font: boldFont, color: headroomColor });

    page.drawText('Utilization', { x: MARGIN_LEFT + colW * 3 + 10, y: metricsY, size: 7, font, color: MUTED });
    const utilDisplayStr = plc.utilizationPercent > 9999 ? '>999%' : `${plc.utilizationPercent}%`;
    page.drawText(utilDisplayStr, { x: MARGIN_LEFT + colW * 3 + 10, y: metricsY - 12, size: 10, font: boldFont, color: NPC_NAVY });

    // Progress bar
    drawProgressBar(page, MARGIN_LEFT + 10, y - 58, CONTENT_WIDTH - 20, 4, plc.utilizationPercent, plcBorder);

    y -= 85 + PARAGRAPH_SPACING;
  }

  // ── INCOME ANALYSIS ───────────────────────────────────────────────────────
  ensureSpace(100);
  y = drawSectionTitle(page, 'Income Analysis', y, boldFont);

  // Summary line
  page.drawText(`Gross Annual Income: ${fmt(data.grossAnnualIncome)}`, { x: MARGIN_LEFT, y, size: 9, font, color: DARK_TEXT });
  page.drawText(`Shaded Annual Income: ${fmt(data.shadedAnnualIncome)}`, { x: MARGIN_LEFT + 170, y, size: 9, font, color: DARK_TEXT });
  y -= SUBSECTION_SPACING;

  if (data.incomeBreakdown.length > 0) {
    // Table header — wider first column for source labels
    const col1 = MARGIN_LEFT;
    const col2 = MARGIN_LEFT + 210;
    const col3 = MARGIN_LEFT + 310;
    const col4 = MARGIN_LEFT + CONTENT_WIDTH - 10;

    y = drawTableRow(page, y, [
      { text: 'Source', x: col1, font: boldFont, color: NPC_NAVY },
      { text: 'Gross Amount', x: col2, font: boldFont, color: NPC_NAVY },
      { text: 'Shading', x: col3, font: boldFont, color: NPC_NAVY },
      { text: 'Shaded Amount', x: col4 - 50, font: boldFont, color: NPC_NAVY },
    ]);
    // Gold separator
    page.drawRectangle({ x: MARGIN_LEFT, y: y + 2, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
    y -= 6;

    for (let i = 0; i < data.incomeBreakdown.length; i++) {
      ensureSpace(TABLE_ROW_HEIGHT + 10);
      const item = data.incomeBreakdown[i];
      const bg = i % 2 === 0 ? LIGHT_BG : undefined;
      const shadingColor = item.shadingRate >= 1 ? SUCCESS : item.shadingRate >= 0.8 ? WARNING : MUTED;
      const label = sanitize(item.label);
      const labelMaxWidth = col2 - col1 - 10;

      y = drawTableRow(page, y, [
        { text: label, x: col1, font, maxWidth: labelMaxWidth },
        { text: fmt(item.grossAmount), x: col2, font },
        { text: `${(item.shadingRate * 100).toFixed(0)}%`, x: col3, font: boldFont, color: shadingColor },
        { text: fmt(item.shadedAmount), x: col4 - 50, font: boldFont },
      ], bg);
    }

    // Total row
    page.drawRectangle({ x: MARGIN_LEFT, y: y + 2, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
    y -= 6;
    y = drawTableRow(page, y, [
      { text: 'Total', x: col1, font: boldFont, color: NPC_NAVY },
      { text: fmt(data.grossAnnualIncome), x: col2, font: boldFont, color: NPC_NAVY },
      { text: '', x: col3, font },
      { text: fmt(data.shadedAnnualIncome), x: col4 - 50, font: boldFont, color: SUCCESS },
    ]);

    // Shading info box
    y -= PARAGRAPH_SPACING;
    ensureSpace(40);
    page.drawRectangle({ x: MARGIN_LEFT, y: y - 32, width: CONTENT_WIDTH, height: 32, color: LIGHT_BG });
    page.drawText('Income Shading Applied:', { x: MARGIN_LEFT + 6, y: y - 10, size: 7, font: boldFont, color: DARK_TEXT });
    const rules = ['Base salary: 100%', 'Bonus/Commission: 80%', 'Positive property cash flow: 80%', 'Non-essential overtime: 50%'];
    rules.forEach((r, i) => {
      page.drawText(`- ${r}`, { x: MARGIN_LEFT + 6, y: y - 18 - i * 6, size: 6, font, color: MUTED });
    });
    y -= 48 + PARAGRAPH_SPACING;
  }

  // ── TAX BREAKDOWN ─────────────────────────────────────────────────────────
  if (data.taxBreakdown) {
    ensureSpace(120);
    y = drawSectionTitle(page, 'Tax Breakdown (2025-26)', y, boldFont);
    const tb = data.taxBreakdown;

    const taxItems = [
      { label: 'Gross Income', value: fmt(tb.grossIncome), color: NPC_NAVY },
      { label: 'Income Tax', value: `-${fmt(tb.taxPayable)}`, color: DANGER },
      { label: 'Medicare Levy (2%)', value: `-${fmt(tb.medicareLevy)}`, color: DANGER },
      { label: 'Total Tax', value: `-${fmt(tb.totalTax)}`, color: DANGER },
    ];

    for (const item of taxItems) {
      page.drawText(item.label, { x: MARGIN_LEFT, y, size: 9, font, color: DARK_TEXT });
      page.drawText(item.value, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(item.value, 9), y, size: 9, font: boldFont, color: item.color });
      y -= PARAGRAPH_SPACING;
    }

    // Gold separator
    page.drawRectangle({ x: MARGIN_LEFT, y: y + 4, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
    y -= 10;

    // After-tax
    const afterTaxStr = `${fmt(tb.afterTaxIncome)}/yr`;
    page.drawText('After-Tax Income:', { x: MARGIN_LEFT, y, size: 10, font: boldFont, color: NPC_NAVY });
    page.drawText(afterTaxStr, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(afterTaxStr, 10), y, size: 10, font: boldFont, color: SUCCESS });
    y -= PARAGRAPH_SPACING;

    // Rates
    page.drawText(`Effective Rate: ${(tb.effectiveTaxRate * 100).toFixed(1)}%`, { x: MARGIN_LEFT, y, size: 8, font, color: DARK_TEXT });
    page.drawText(`Marginal Rate: ${(tb.marginalTaxRate * 100).toFixed(0)}%`, { x: MARGIN_LEFT + 120, y, size: 8, font, color: DARK_TEXT });
    y -= 14;
    page.drawText(`Tax Bracket: ${sanitize(tb.marginalBracket)}`, { x: MARGIN_LEFT, y, size: 7, font, color: MUTED });
    y -= PARAGRAPH_SPACING;

    // Monthly take-home highlight
    page.drawRectangle({ x: MARGIN_LEFT, y: y - 12, width: CONTENT_WIDTH, height: 18, color: rgb(0.92, 0.96, 1) });
    page.drawText('After-tax income is used for serviceability assessment', { x: MARGIN_LEFT + 6, y: y - 5, size: 8, font, color: BLUE_ACCENT });
    const monthlyStr = `Monthly Take-Home: ${fmt(tb.monthlyTakeHome)}`;
    page.drawText(monthlyStr, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(monthlyStr, 8), y: y - 5, size: 8, font: boldFont, color: BLUE_ACCENT });
    y -= SECTION_SPACING;
  }

  // ── LIVING EXPENSES ───────────────────────────────────────────────────────
  ensureSpace(100);
  y = drawSectionTitle(page, 'Living Expenses', y, boldFont);

  const methodLabels: Record<string, string> = { hem: 'HEM Benchmark', declared: 'Declared Expenses', hybrid: 'Higher of HEM / Declared' };
  page.drawText(`Method: ${methodLabels[data.expenseMethod] || data.expenseMethod}`, { x: MARGIN_LEFT, y, size: 9, font, color: DARK_TEXT });
  y -= PARAGRAPH_SPACING;

  // HEM breakdown
  if (data.hemBreakdown) {
    const hb = data.hemBreakdown;
    page.drawRectangle({ x: MARGIN_LEFT, y: y - 42, width: CONTENT_WIDTH, height: 42, color: LIGHT_BG });
    page.drawText(`HEM Benchmark: ${fmt(hb.finalHem)}/month`, { x: MARGIN_LEFT + 6, y: y - 10, size: 8, font: boldFont, color: DARK_TEXT });
    page.drawText(`Household: ${hb.householdType === 'couple' ? 'Couple' : 'Single'}`, { x: MARGIN_LEFT + 6, y: y - 22, size: 7, font, color: MUTED });
    page.drawText(`Dependants: ${hb.dependentsCount}`, { x: MARGIN_LEFT + 90, y: y - 22, size: 7, font, color: MUTED });
    page.drawText(`Base HEM: ${fmt(hb.baseHem)}`, { x: MARGIN_LEFT + 6, y: y - 32, size: 7, font, color: MUTED });
    page.drawText(`Income Tier: ${sanitize(hb.incomeTier)}`, { x: MARGIN_LEFT + 90, y: y - 32, size: 7, font, color: MUTED });
    if (hb.multiplier !== 1) {
      page.drawText(`Multiplier: ${hb.multiplier.toFixed(2)}x`, { x: MARGIN_LEFT + 200, y: y - 32, size: 7, font, color: MUTED });
    }
    y -= 52 + PARAGRAPH_SPACING;
  }

  // Declared vs HEM comparison
  if (data.declaredExpensesMonthly !== undefined && data.hemBenchmark) {
    const higher = Math.max(data.declaredExpensesMonthly, data.hemBenchmark);
    const declPct = higher > 0 ? (data.declaredExpensesMonthly / higher) * 100 : 0;
    const hemPct = higher > 0 ? (data.hemBenchmark / higher) * 100 : 0;
    const isHemHigher = data.hemBenchmark >= data.declaredExpensesMonthly;

    page.drawText('Declared Expenses:', { x: MARGIN_LEFT, y, size: 8, font, color: DARK_TEXT });
    page.drawText(`${fmt(data.declaredExpensesMonthly)}/mo`, { x: MARGIN_LEFT + 100, y, size: 8, font: boldFont, color: isHemHigher ? MUTED : DANGER });
    drawProgressBar(page, MARGIN_LEFT + 180, y - 2, 150, 5, declPct, isHemHigher ? rgb(0.8, 0.8, 0.8) : DANGER);
    y -= PARAGRAPH_SPACING;

    page.drawText('HEM Benchmark:', { x: MARGIN_LEFT, y, size: 8, font, color: DARK_TEXT });
    page.drawText(`${fmt(data.hemBenchmark)}/mo`, { x: MARGIN_LEFT + 100, y, size: 8, font: boldFont, color: isHemHigher ? SUCCESS : MUTED });
    drawProgressBar(page, MARGIN_LEFT + 180, y - 2, 150, 5, hemPct, isHemHigher ? SUCCESS : rgb(0.8, 0.8, 0.8));
    y -= PARAGRAPH_SPACING;

    page.drawText(`Used for assessment: ${fmt(Math.max(data.declaredExpensesMonthly, data.hemBenchmark))}/mo (higher of the two)`, { x: MARGIN_LEFT, y, size: 7, font, color: MUTED });
    y -= SUBSECTION_SPACING;
  } else {
    page.drawText(`Monthly Living Expenses: ${fmt(data.livingExpensesMonthly)}`, { x: MARGIN_LEFT, y, size: 9, font: boldFont, color: DARK_TEXT });
    y -= SUBSECTION_SPACING;
  }

  // ── NEGATIVE PROPERTY CASH FLOWS ──────────────────────────────────────────
  if (data.negativePropertyCashFlows && data.negativePropertyCashFlows.length > 0) {
    ensureSpace(40 + data.negativePropertyCashFlows.length * TABLE_ROW_HEIGHT);
    y = drawSubTitle(page, 'Negative Property Cash Flows', y, boldFont);

    page.drawText('Properties with negative cash flow are added to your expense obligations:', { x: MARGIN_LEFT, y, size: 7, font, color: MUTED });
    y -= PARAGRAPH_SPACING;

    for (let i = 0; i < data.negativePropertyCashFlows.length; i++) {
      ensureSpace(TABLE_ROW_HEIGHT);
      const ncf = data.negativePropertyCashFlows[i];
      const bg = i % 2 === 0 ? LIGHT_BG : undefined;
      const addr = sanitize(ncf.address);
      const addrMaxWidth = CONTENT_WIDTH - 80;

      y = drawTableRow(page, y, [
        { text: addr, x: MARGIN_LEFT + 8, font, size: 8, maxWidth: addrMaxWidth },
        { text: fmt(ncf.monthlyCashflow) + '/mo', x: MARGIN_LEFT + CONTENT_WIDTH - 60, font: boldFont, color: DANGER, size: 8 },
      ], bg);
    }

    page.drawRectangle({ x: MARGIN_LEFT, y: y + 2, width: CONTENT_WIDTH, height: 1, color: BORDER_COLOR });
    y -= 6;
    page.drawText(`Total Negative Cash Flows: ${fmt(data.totalNegativeCashFlows || 0)}/mo`, { x: MARGIN_LEFT, y, size: 8, font: boldFont, color: DANGER });
    y -= PARAGRAPH_SPACING;

    if (data.effectiveExpensesMonthly) {
      page.drawText(`Effective Monthly Expenses (Living + Neg CF): ${fmt(data.effectiveExpensesMonthly)}/mo`, { x: MARGIN_LEFT, y, size: 8, font: boldFont, color: NPC_NAVY });
      y -= SUBSECTION_SPACING;
    }
  }

  // ── LIABILITIES SCHEDULE ──────────────────────────────────────────────────
  if (data.liabilityBreakdown.length > 0) {
    ensureSpace(80);
    // New page for liabilities if tight
    if (needsNewPage(y, 80 + data.liabilityBreakdown.length * TABLE_ROW_HEIGHT)) {
      page = addContentPage();
      y = PAGE_HEIGHT - MARGIN_TOP;
    }

    y = drawSectionTitle(page, 'Liabilities Schedule', y, boldFont);

    // Table header — wider first column for liability labels
    const lCol1 = MARGIN_LEFT;
    const lCol2 = MARGIN_LEFT + 200;
    const lCol3 = MARGIN_LEFT + 270;
    const lCol4 = MARGIN_LEFT + 340;
    const lCol5 = MARGIN_LEFT + CONTENT_WIDTH - 10;

    y = drawTableRow(page, y, [
      { text: 'Liability', x: lCol1, font: boldFont, color: NPC_NAVY },
      { text: 'Balance', x: lCol2, font: boldFont, color: NPC_NAVY },
      { text: 'Limit', x: lCol3, font: boldFont, color: NPC_NAVY },
      { text: 'Servicing', x: lCol4, font: boldFont, color: NPC_NAVY },
      { text: 'Method', x: lCol5 - 55, font: boldFont, color: NPC_NAVY, size: 8 },
    ]);
    page.drawRectangle({ x: MARGIN_LEFT, y: y + 2, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
    y -= 6;

    let totalServicing = 0;
    for (let i = 0; i < data.liabilityBreakdown.length; i++) {
      ensureSpace(TABLE_ROW_HEIGHT + 10);
      const lib = data.liabilityBreakdown[i];
      const bg = i % 2 === 0 ? LIGHT_BG : undefined;
      totalServicing += lib.monthlyServicing;

      // Build a clean label: use label if it's descriptive, avoid duplicating type info
      const typeLabel = formatLiabilityType(lib.type);
      const rawLabel = sanitize(lib.label);
      let label: string;
      if (!rawLabel || rawLabel === lib.type || rawLabel === typeLabel || rawLabel.toLowerCase() === lib.type.replace(/[_-]/g, ' ').toLowerCase()) {
        label = typeLabel;
      } else if (rawLabel.toLowerCase().startsWith(typeLabel.toLowerCase())) {
        label = rawLabel;
      } else {
        label = `${typeLabel} - ${rawLabel}`;
      }
      const labelMaxWidth = lCol2 - lCol1 - 10;

      const noteText = lib.calculationNote ? sanitize(lib.calculationNote) : '';
      let shortNote = noteText.length > 12 ? noteText.slice(0, 10) + '..' : noteText;

      y = drawTableRow(page, y, [
        { text: label, x: lCol1, font, size: 8, maxWidth: labelMaxWidth },
        { text: fmt(lib.balance), x: lCol2, font, size: 8 },
        { text: lib.limit ? fmt(lib.limit) : '-', x: lCol3, font, size: 8 },
        { text: `${fmt(lib.monthlyServicing)}/mo`, x: lCol4, font: boldFont, color: DANGER, size: 8 },
        { text: shortNote, x: lCol5 - 55, font, color: MUTED, size: 6 },
      ], bg);
    }

    // Total
    page.drawRectangle({ x: MARGIN_LEFT, y: y + 2, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
    y -= 6;
    page.drawText('Total Monthly Commitments:', { x: MARGIN_LEFT, y, size: 9, font: boldFont, color: NPC_NAVY });
    const totalStr = `${fmt(totalServicing)}/mo`;
    page.drawText(totalStr, { x: lCol4, y, size: 9, font: boldFont, color: DANGER });
    y -= SECTION_SPACING;
  }

  // ── CAPACITY WATERFALL ────────────────────────────────────────────────────
  ensureSpace(140);
  y = drawSectionTitle(page, 'Capacity Waterfall', y, boldFont);

  const afterTaxMonthly = data.taxBreakdown ? data.taxBreakdown.monthlyTakeHome : Math.round(data.shadedAnnualIncome / 12);
  const waterfallItems = [
    { label: 'After-Tax Monthly Income', value: afterTaxMonthly, color: SUCCESS },
    { label: 'Less: Living Expenses', value: -data.livingExpensesMonthly, color: DANGER },
    { label: 'Less: Existing Commitments', value: -data.existingCommitmentsMonthly, color: DANGER },
  ];

  if (data.totalNegativeCashFlows && data.totalNegativeCashFlows > 0) {
    waterfallItems.push({ label: 'Less: Negative Property Cash Flows', value: -(data.totalNegativeCashFlows), color: DANGER });
  }

  let runningTotal = 0;
  for (const item of waterfallItems) {
    runningTotal += item.value;
    const valStr = item.value >= 0 ? fmt(item.value) : `-${fmt(Math.abs(item.value))}`;
    page.drawText(sanitize(item.label), { x: MARGIN_LEFT, y, size: 9, font, color: DARK_TEXT });
    page.drawText(valStr, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(valStr, 9), y, size: 9, font: boldFont, color: item.color });
    y -= PARAGRAPH_SPACING;
  }

  // Separator
  page.drawRectangle({ x: MARGIN_LEFT, y: y + 4, width: CONTENT_WIDTH, height: 1, color: NPC_GOLD });
  y -= 10;

  // Monthly surplus
  const surplusStr = fmt(data.monthlySurplus);
  const surplusColor = data.monthlySurplus >= 0 ? SUCCESS : DANGER;
  page.drawText('= Monthly Surplus', { x: MARGIN_LEFT, y, size: 10, font: boldFont, color: NPC_NAVY });
  page.drawText(surplusStr, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(surplusStr, 12), y, size: 12, font: boldFont, color: surplusColor });
  y -= SUBSECTION_SPACING;

  // Explanation
  page.drawText('Maximum borrowing capacity is derived from this surplus at the assessment rate.', { x: MARGIN_LEFT, y, size: 7, font, color: MUTED });
  y -= PARAGRAPH_SPACING;

  // Capacity figure
  const capStr = fmt(data.borrowingCapacity);
  page.drawRectangle({ x: MARGIN_LEFT, y: y - 22, width: CONTENT_WIDTH, height: 28, color: LIGHT_BG, borderColor: NPC_GOLD, borderWidth: 1 });
  page.drawText('Estimated Borrowing Capacity:', { x: MARGIN_LEFT + 8, y: y - 5, size: 9, font, color: NPC_NAVY });
  page.drawText(capStr, { x: MARGIN_LEFT + CONTENT_WIDTH - 10 - boldFont.widthOfTextAtSize(capStr, 14), y: y - 8, size: 14, font: boldFont, color: NPC_NAVY });
  y -= SECTION_SPACING + PARAGRAPH_SPACING;

  // ── RECOMMENDATIONS & WARNINGS ────────────────────────────────────────────
  const recs = data.recommendations.filter(r => r && r.trim());
  const warns = data.warnings.filter(w => w && w.trim());

  if (recs.length > 0 || warns.length > 0) {
    ensureSpace(80);
    y = drawSectionTitle(page, 'Recommendations & Warnings', y, boldFont);

    if (recs.length > 0) {
      y = drawSubTitle(page, 'Recommendations', y, boldFont);
      for (const rec of recs.slice(0, 6)) {
        ensureSpace(20);
        page.drawText('\u2022', { x: MARGIN_LEFT, y, size: 9, font, color: SUCCESS });
        let text = sanitize(rec);
        if (text.length > 90) text = text.slice(0, 87) + '...';
        page.drawText(text, { x: MARGIN_LEFT + 12, y, size: 8, font, color: DARK_TEXT });
        y -= PARAGRAPH_SPACING;
      }
      y -= PARAGRAPH_SPACING;
    }

    if (warns.length > 0) {
      y = drawSubTitle(page, 'Warnings', y, boldFont);
      for (const warn of warns.slice(0, 5)) {
        ensureSpace(20);
        page.drawText('!', { x: MARGIN_LEFT + 2, y, size: 9, font: boldFont, color: WARNING });
        let text = sanitize(warn);
        if (text.length > 90) text = text.slice(0, 87) + '...';
        page.drawText(text, { x: MARGIN_LEFT + 14, y, size: 8, font, color: DARK_TEXT });
        y -= PARAGRAPH_SPACING;
      }
      y -= PARAGRAPH_SPACING;
    }
  }

  // ── ASSUMPTIONS ───────────────────────────────────────────────────────────
  if (data.assumptions && data.assumptions.length > 0) {
    ensureSpace(60);
    y = drawSubTitle(page, 'Assessment Assumptions', y, boldFont);
    page.drawRectangle({ x: MARGIN_LEFT, y: y - (data.assumptions.length * 14 + 10), width: CONTENT_WIDTH, height: data.assumptions.length * 14 + 10, color: LIGHT_BG });

    for (const a of data.assumptions) {
      page.drawText(sanitize(a.key) + ':', { x: MARGIN_LEFT + 6, y: y - 4, size: 8, font, color: DARK_TEXT });
      page.drawText(sanitize(a.value), { x: MARGIN_LEFT + 120, y: y - 4, size: 8, font: boldFont, color: NPC_NAVY });
      y -= 14;
    }
    y -= PARAGRAPH_SPACING;
  }

  // Disclaimer
  ensureSpace(40);
  page.drawRectangle({ x: MARGIN_LEFT, y: y - 30, width: CONTENT_WIDTH, height: 30, color: rgb(1, 0.98, 0.94), borderColor: WARNING, borderWidth: 0.5 });
  page.drawText('DISCLAIMER', { x: MARGIN_LEFT + 6, y: y - 10, size: 7, font: boldFont, color: WARNING });
  page.drawText('This is an estimate only and does not constitute a formal loan offer. Actual lending decisions are made by financial institutions.', { x: MARGIN_LEFT + 6, y: y - 22, size: 6, font, color: MUTED });
  y -= SECTION_SPACING + PARAGRAPH_SPACING;

  return { page, yPos: y };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TRANSFORMER: Convert edge function BC data to renderer format
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transforms the borrowing capacity data returned by the generate-portfolio-analysis
 * edge function into the structured format expected by drawBorrowingCapacityPdfLib.
 */
export function transformEdgeFunctionBCData(bcData: any): BorrowingCapacityPdfLibData {
  // Build income breakdown
  const incomeBreakdown: BCPdfLibIncomeItem[] = [];
  if (bcData.incomeBreakdown && Array.isArray(bcData.incomeBreakdown) && bcData.incomeBreakdown.length > 0) {
    for (const item of bcData.incomeBreakdown) {
      incomeBreakdown.push({
        label: item.component || item.label || item.source_name || 'Income',
        grossAmount: item.grossAmount || item.gross_annual_amount || 0,
        shadingRate: item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1,
        shadedAmount: item.shadedAmount || (item.grossAmount || 0) * (item.shadingRate || 1),
      });
    }
  }

  // Build liability breakdown
  const liabilityBreakdown: BCPdfLibLiabilityItem[] = [];
  if (bcData.liabilityBreakdown && Array.isArray(bcData.liabilityBreakdown) && bcData.liabilityBreakdown.length > 0) {
    for (const lib of bcData.liabilityBreakdown) {
      liabilityBreakdown.push({
        type: lib.type || lib.liability_type || 'other',
        label: lib.label || lib.provider_name || lib.type || 'Liability',
        balance: lib.balance || lib.current_balance || 0,
        limit: lib.limit || lib.credit_limit,
        monthlyServicing: lib.monthlyServicing || lib.monthly_repayment || 0,
        calculationNote: lib.calculationNote,
      });
    }
  }

  // Expense breakdown
  const expenseBreakdown = bcData.expenseBreakdown || {};
  let hemBreakdown: BCPdfLibHemBreakdown | undefined;
  let declaredExpenses: number | undefined;
  let negCashFlows: BCPdfLibNegativeCashFlow[] | undefined;
  let totalNegCF = 0;
  let effectiveExpenses: number | undefined;

  if (expenseBreakdown && typeof expenseBreakdown === 'object') {
    if (expenseBreakdown.hemBreakdown) hemBreakdown = expenseBreakdown.hemBreakdown;
    if (expenseBreakdown.declaredExpenses !== undefined) declaredExpenses = expenseBreakdown.declaredExpenses;
    if (expenseBreakdown.negativePropertyCashFlows) {
      negCashFlows = expenseBreakdown.negativePropertyCashFlows;
      totalNegCF = expenseBreakdown.totalNegativeCashFlows || 0;
    }
    if (expenseBreakdown.effectiveExpenses !== undefined) effectiveExpenses = expenseBreakdown.effectiveExpenses;
  }

  // Tax breakdown (inline calculation — 2025-26 brackets)
  let taxBreakdown: BCPdfLibTaxBreakdown | undefined;
  const gross = bcData.grossAnnualIncome || 0;
  if (gross > 0) {
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
      effectiveTaxRate: totalTax / gross,
      marginalTaxRate: marginalRate + 0.02,
      marginalBracket: bracketLabel,
      monthlyTakeHome: Math.round(afterTax / 12),
    };
  }

  // Proposed loan check
  let proposedLoanCheck: BCPdfLibProposedLoanCheck | undefined;
  if (bcData.proposedLoanAmount && bcData.proposedLoanAmount > 0) {
    const rate = (bcData.assessmentRate || 9.5) / 100 / 12;
    const periods = (bcData.loanTermYears || 30) * 12;
    const monthlyRep = bcData.proposedLoanAmount * (rate * Math.pow(1 + rate, periods)) / (Math.pow(1 + rate, periods) - 1);
    const cap = bcData.borrowingCapacity || 0;
    proposedLoanCheck = {
      proposedAmount: bcData.proposedLoanAmount,
      monthlyRepayment: Math.round(monthlyRep),
      isServiceable: cap >= bcData.proposedLoanAmount,
      headroom: cap - bcData.proposedLoanAmount,
      utilizationPercent: Math.round((bcData.proposedLoanAmount / Math.max(cap, 1)) * 100),
    };
  }

  // Assumptions
  const assumptions: { key: string; value: string }[] = [];
  if (bcData.assumptions && Array.isArray(bcData.assumptions) && bcData.assumptions.length > 0) {
    for (const item of bcData.assumptions) {
      assumptions.push({ key: item.key || String(item), value: item.value || '' });
    }
  } else {
    const ir = bcData.interestRateUsed || (bcData.assessmentRate ? bcData.assessmentRate - (bcData.bufferRate || 3) : 6.5);
    assumptions.push(
      { key: 'Buffer Rate', value: `${(bcData.bufferRate || 3).toFixed(1)}%` },
      { key: 'Loan Term', value: `${bcData.loanTermYears || 30} years` },
      { key: 'Interest Rate', value: `${ir.toFixed(2)}%` },
      { key: 'Assessment Rate', value: `${(bcData.assessmentRate || 9.5).toFixed(2)}%` },
    );
  }

  return {
    borrowingCapacity: bcData.borrowingCapacity || 0,
    stressTestedCapacity: bcData.stressTestedCapacity || 0,
    monthlySurplus: bcData.monthlySurplus || 0,
    serviceabilityBand: (bcData.serviceabilityBand || 'red') as 'green' | 'amber' | 'red',
    dtiRatio: bcData.dtiRatio || 0,
    assessmentRate: bcData.assessmentRate || 9.5,
    grossAnnualIncome: gross,
    shadedAnnualIncome: bcData.shadedAnnualIncome || 0,
    incomeBreakdown,
    taxBreakdown,
    expenseMethod: (bcData.expenseMethod || 'hybrid') as 'hem' | 'declared' | 'hybrid',
    livingExpensesMonthly: bcData.livingExpenses || 0,
    hemBenchmark: expenseBreakdown?.hemBenchmark || hemBreakdown?.finalHem,
    hemBreakdown,
    declaredExpensesMonthly: declaredExpenses,
    negativePropertyCashFlows: negCashFlows,
    totalNegativeCashFlows: totalNegCF,
    effectiveExpensesMonthly: effectiveExpenses,
    existingCommitmentsMonthly: bcData.existingCommitments || 0,
    liabilityBreakdown,
    proposedLoanCheck,
    recommendations: Array.isArray(bcData.recommendations) ? bcData.recommendations : [],
    warnings: Array.isArray(bcData.warnings) ? bcData.warnings : [],
    assumptions,
    interestRate: bcData.interestRateUsed || undefined,
    bufferRate: bcData.bufferRate || undefined,
    loanTermYears: bcData.loanTermYears || 30,
    calculatedAt: bcData.calculatedAt ? new Date(bcData.calculatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
  };
}

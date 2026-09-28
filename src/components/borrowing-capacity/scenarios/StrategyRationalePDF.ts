/**
 * Strategy Rationale PDF Generator — Phase F6
 * ─────────────────────────────────────────────
 * Produces a Dark & Gold-branded A4 PDF of the F5 RationaleReport so the
 * broker can hand it directly to the finance division.
 *
 * Sections (in order):
 *   1. Cover page — branded template image, falls back to dark/gold splash
 *   2. Header — client name + scenario timestamp + capacity headline
 *   3. Headline + sub-headline (target framing)
 *   3a. The Strategy Advisor's reasoning, where the scenario is its card
 *   4. What & Why bullets (per lever, sorted by material impact)
 *   5. Reconciliation paragraph
 *   6. Recommended execution sequence (numbered, owner-coded)
 *   7. Caveats & assumptions
 *   8. Disclaimer / contact page (uses the global report settings)
 *
 * The generator is intentionally self-contained — it only depends on the
 * RationaleReport (built by `strategyRationaleEngine`) plus a small
 * branding context, so it can be invoked from anywhere in the dashboard.
 */

import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawJsPDFDisclaimerPage } from '@/utils/pdfDisclaimerPage';
import {
  headingFaceFor,
  issuerClosingPage,
  loadLegacyDocumentBrand,
  rgbObject,
  type LegacyDocumentBrand,
} from '@/lib/reports/legacyDocumentBrand';
import { drawLegacyIssuerCover } from '@/lib/reports/legacyIssuerCover';
import { drawnDesignFor } from '@/lib/reports/drawnDocumentDesign';
import { smartCapitalize } from '@/utils/nameFormatting';
import type { RationaleReport, RationaleSeverity } from '@/utils/strategyRationaleEngine';
import { guardStandardFontText } from '@/lib/pdf/standardFontText';
import {
  ADVISOR_OPTIONS_NOTE,
  composeAdvisorSection,
  rationaleReadingNote,
  type RationaleAdvisorInput,
} from '@/lib/reports/borrowingCapacity/strategyRationale.pure';

// ─── Design tokens (matched to BorrowingCapacityPDFReport for brand parity) ──
const GOLD = { r: 191, g: 155, b: 80 };
const NAVY = { r: 13, g: 38, b: 77 };
const DARK_BG = { r: 20, g: 20, b: 20 };
const WHITE = { r: 255, g: 255, b: 255 };
const GRAY = { r: 128, g: 128, b: 128 };
const LIGHT_GRAY = { r: 248, g: 248, b: 248 };
const MUTED_BG = { r: 244, g: 244, b: 244 };
const BODY_TEXT = { r: 55, g: 55, b: 55 };
const GREEN = { r: 22, g: 163, b: 74 };
const RED = { r: 239, g: 68, b: 68 };
const AMBER = { r: 217, g: 119, b: 6 };

type RGB = { r: number; g: number; b: number };

/**
 * The colours that say whose document this is.
 *
 * On the prime these are NPC's, exactly as they have always been drawn. On a
 * clone the same roles take the issuer's brand family (`legacyDocumentBrand.ts`):
 * its brand for rules and accent bars, a fill dark enough to carry white type
 * where a pill holds words, its deep shade for headings and badges, and the ink
 * that reads on that deep shade. The semantic colours are shared.
 */
interface DocumentPalette {
  /** Rules and accent bars. */
  gold: RGB;
  /** A pill that carries white type. */
  goldFill: RGB;
  /** A figure set on a navy badge. */
  goldOnNavy: RGB;
  /** Headings, figures and badges. */
  navy: RGB;
  /** The face headings are set in: Helvetica, or Times where a chosen design sets a serif. */
  headingFace: 'helvetica' | 'times';
}

const HOUSE_PALETTE: DocumentPalette = { gold: GOLD, goldFill: GOLD, goldOnNavy: GOLD, navy: NAVY, headingFace: 'helvetica' };

function documentPalette(brand: LegacyDocumentBrand): DocumentPalette {
  if (brand.artwork === 'house') return HOUSE_PALETTE;
  const { family } = brand;
  return {
    gold: rgbObject(family.accent),
    goldFill: rgbObject(family.accentInk),
    goldOnNavy: rgbObject(family.onDeep),
    navy: rgbObject(family.deep),
    headingFace: headingFaceFor(brand),
  };
}

// ─── Page setup ─────────────────────────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 15;
const PAGE_BREAK_THRESHOLD = PAGE_H - 28;

// ─── Helpers ────────────────────────────────────────────────────────────────
function setColor(doc: jsPDF, c: RGB) {
  doc.setTextColor(c.r, c.g, c.b);
}
function setFill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c.r, c.g, c.b);
}
function setDraw(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c.r, c.g, c.b);
}

const fmtAud = (v: number) => {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `-$${s}` : `$${s}`;
};

const fmtSigned = (v: number) => (v >= 0 ? `+${fmtAud(v)}` : fmtAud(v));

function severityColor(sev: RationaleSeverity): RGB {
  switch (sev) {
    case 'positive': return GREEN;
    case 'caution': return AMBER;
    case 'critical': return RED;
    default: return GRAY;
  }
}

function severityLabel(sev: RationaleSeverity): string {
  switch (sev) {
    case 'positive': return 'POSITIVE';
    case 'caution': return 'CAUTION';
    case 'critical': return 'CRITICAL';
    default: return 'INFO';
  }
}

function ownerColor(owner: 'broker' | 'finance' | 'client', P: DocumentPalette): RGB {
  switch (owner) {
    case 'finance': return { r: 37, g: 99, b: 235 };
    case 'client': return { r: 147, g: 51, b: 234 };
    default: return P.goldFill;
  }
}

function addFooter(doc: jsPDF, pageNum: number, totalPages: number, footerLabel: string, P: DocumentPalette) {
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.setFont('helvetica', 'normal');
  doc.text(footerLabel, MARGIN, FOOTER_Y);
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
  setFill(doc, P.gold);
  doc.rect(MARGIN, FOOTER_Y - 4, CONTENT_W, 0.4, 'F');
}

function ensureSpace(doc: jsPDF, y: number, needed: number, pageNum: { value: number }): number {
  if (y + needed > PAGE_BREAK_THRESHOLD) {
    doc.addPage();
    pageNum.value++;
    return 25;
  }
  return y;
}

function drawSectionHeader(doc: jsPDF, title: string, y: number, P: DocumentPalette): number {
  setFill(doc, P.gold);
  doc.rect(MARGIN, y, CONTENT_W, 0.6, 'F');
  doc.setFontSize(11);
  doc.setFont(P.headingFace, 'bold');
  setColor(doc, P.navy);
  doc.text(title.toUpperCase(), MARGIN, y + 6);
  return y + 11;
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
): number {
  const lines: string[] = doc.splitTextToSize(text, width);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RationalePDFContext {
  /** Client display name (will be smart-capitalised). */
  clientName: string;
  /** Borrowing capacity at the BASE (no scenario applied). */
  baseCapacity: number;
  /** Borrowing capacity AFTER the scenario is applied (compounded). */
  scenarioCapacity: number;
  /** Optional effective purchase power (`acquisitionCapacity.maxPurchasePrice`) */
  effectivePurchasePower?: number | null;
  /** Optional target purchase price the client is solving for. */
  targetPurchasePrice?: number | null;
  /** Whether the target is achievable. */
  meetsTarget?: boolean | null;
  /** Optional scenario name (preset label). */
  scenarioName?: string;
  /** Phase G1 — Valuation assumptions to publish for finance audit. */
  valuationAssumptions?: Array<{
    address: string;
    originalValue: number;
    newValue: number;
    basis: 'manual' | 'desktop' | 'avm' | 'comparable_sales';
    source?: string;
  }>;
  /** Phase G2 — Cross-collateralised pool methodology disclosure. */
  crossCollatPool?: {
    enabled: boolean;
    propertyAddresses: string[];
    blendedTargetLVR: number;
    lenderMaxLVR: number;
    allocationStrategy: 'highest_equity_first' | 'pro_rata';
    totalPoolValue: number;
    totalPoolDebt: number;
    poolReleaseAmount: number;
  } | null;
  /**
   * The Strategy Advisor's reasoning for the card that was applied. Its words
   * are composed once (`composeAdvisorSection`), so this brief, the typeset
   * brief and the copied text say the same thing.
   */
  advisor?: RationaleAdvisorInput | null;
}

export async function generateStrategyRationalePDF(
  report: RationaleReport,
  context: RationalePDFContext,
): Promise<{ blob: Blob; fileName: string }> {
  // Every string passes through the built-in font's character set: an arrow
  // printed as `!’` on every lever label (`standardFontText.ts`).
  const doc = guardStandardFontText(new jsPDF({ unit: 'mm', format: 'a4' }));
  const pageNum = { value: 1 };
  const displayName = smartCapitalize(context.clientName) || 'Client';
  const generatedDate = format(new Date(report.generatedAt), 'dd MMMM yyyy, HH:mm');

  // Resolve white-label brand for cover fallback
  const __brand = (await fetchGlobalReportSettings())?.contactDetails;
  const __brandName = (__brand?.company_name || 'Property Consulting').trim();
  const __brandParts = __brandName.split(' ');
  const __brandLine1 = (__brandParts.length > 1 ? __brandParts.slice(0, -1).join(' ') : __brandName).toUpperCase();
  const __brandLine2 = __brandParts.length > 1 ? __brandParts[__brandParts.length - 1].toUpperCase() : '';

  // Whose template this brief is printed in: NPC's artwork on the prime,
  // exactly as it has always been drawn, and the issuer's own on every clone
  // (`legacyDocumentBrand.ts`) — or, where the person chose a template for
  // Borrowing Capacity, that template's design (`drawnDocumentDesign.ts`).
  // The content is the same whichever it is.
  const design = await drawnDesignFor('strategy_rationale');
  const legacyBrand = await loadLegacyDocumentBrand(__brand?.company_name, undefined, design);
  const P = documentPalette(legacyBrand);

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ════════════════════════════════════════════════════════════════════════
  if (legacyBrand.artwork === 'issuer') {
    drawLegacyIssuerCover(doc, {
      issuerName: legacyBrand.issuer.name,
      mark: legacyBrand.mark,
      documentTitle: 'Strategy Rationale Brief',
      subject: displayName,
      standfirst: 'Borrowing Capacity Scenario — Finance Hand-off',
      family: legacyBrand.family,
      design: legacyBrand.design,
      paperMark: legacyBrand.paperMark,
    });
  } else try {
    const coverImageUrl = '/templates/npc-cashflow-cover.jpg';
    const coverResponse = await fetch(coverImageUrl);
    if (coverResponse.ok) {
      const coverBlob = await coverResponse.blob();
      const coverDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(coverBlob);
      });
      doc.addImage(coverDataUrl, 'JPEG', 0, 0, PAGE_W, PAGE_H);
    } else {
      throw new Error('Cover image not found');
    }
  } catch {
    // Fallback dark/gold splash
    setFill(doc, DARK_BG);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    setFill(doc, GOLD);
    doc.rect(0, 0, PAGE_W, 8, 'F');
    doc.rect(0, PAGE_H - 8, PAGE_W, 8, 'F');
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    setColor(doc, GOLD);
    doc.text(__brandLine1, PAGE_W / 2, 100, { align: 'center' });
    if (__brandLine2) doc.text(__brandLine2, PAGE_W / 2, 115, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    setColor(doc, WHITE);
    doc.text('STRATEGY RATIONALE BRIEF', PAGE_W / 2, 140, { align: 'center' });
    doc.text('Borrowing Capacity Scenario — Finance Hand-off', PAGE_W / 2, 150, { align: 'center' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 2 — HEADER + HEADLINE + KPI BOXES
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage();
  pageNum.value++;
  let y = 25;

  // Client header
  doc.setFontSize(18);
  doc.setFont(P.headingFace, 'bold');
  setColor(doc, P.navy);
  doc.text(displayName, MARGIN, y + 5);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setColor(doc, GRAY);
  doc.text(`Generated: ${generatedDate}`, PAGE_W - MARGIN, y + 5, { align: 'right' });
  if (context.scenarioName) {
    doc.text(`Scenario: ${context.scenarioName}`, PAGE_W - MARGIN, y + 10, { align: 'right' });
  }

  y += 14;
  setFill(doc, P.gold);
  doc.rect(MARGIN, y, CONTENT_W, 0.8, 'F');
  y += 10;

  y = drawSectionHeader(doc, 'Strategy Rationale Brief', y, P);

  // ── Headline ───────────────────────────────────────────────────────────
  setFill(doc, MUTED_BG);
  const headlineHeight = 18 + (report.subHeadline ? 14 : 0);
  doc.roundedRect(MARGIN, y, CONTENT_W, headlineHeight, 2, 2, 'F');
  setFill(doc, P.gold);
  doc.rect(MARGIN, y + 2, 2.5, headlineHeight - 4, 'F');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  setColor(doc, P.navy);
  const headlineY = drawWrappedText(doc, report.headline, MARGIN + 8, y + 8, CONTENT_W - 14, 4.5);

  if (report.subHeadline) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BODY_TEXT);
    drawWrappedText(doc, report.subHeadline, MARGIN + 8, headlineY + 2, CONTENT_W - 14, 4);
  }
  y += headlineHeight + 8;

  // ── KPI Boxes ──────────────────────────────────────────────────────────
  const boxCount = context.effectivePurchasePower != null ? 3 : 2;
  const boxGap = 5;
  const boxW = (CONTENT_W - boxGap * (boxCount - 1)) / boxCount;
  const boxH = 32;

  const drawKPI = (
    x: number,
    label: string,
    value: string,
    sub: string,
    accent: RGB,
  ) => {
    setFill(doc, LIGHT_GRAY);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'F');
    setFill(doc, accent);
    doc.rect(x, y + 2, 2.5, boxH - 4, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY);
    doc.text(label, x + 8, y + 8);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    setColor(doc, P.navy);
    doc.text(value, x + 8, y + 19);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setColor(doc, GRAY);
    doc.text(sub, x + 8, y + 27);
  };

  const capacityChange = context.scenarioCapacity - context.baseCapacity;
  drawKPI(
    MARGIN,
    'BASE CAPACITY',
    fmtAud(context.baseCapacity),
    'Pre-scenario',
    GRAY,
  );
  drawKPI(
    MARGIN + (boxW + boxGap),
    'SCENARIO CAPACITY',
    fmtAud(context.scenarioCapacity),
    `${fmtSigned(capacityChange)} vs base`,
    capacityChange > 0 ? GREEN : capacityChange < 0 ? RED : P.gold,
  );
  if (context.effectivePurchasePower != null) {
    const target = context.targetPurchasePrice ?? 0;
    let sub = 'Loan + cash − costs';
    if (target > 0) {
      sub = context.meetsTarget
        ? `Target ${fmtAud(target)} ✓`
        : `Short of ${fmtAud(target)}`;
    }
    drawKPI(
      MARGIN + (boxW + boxGap) * 2,
      'PURCHASE POWER',
      fmtAud(context.effectivePurchasePower),
      sub,
      context.meetsTarget === false ? RED : P.gold,
    );
  }
  y += boxH + 12;

  // How to read capacity beside purchase power, where the scenario lowers one
  // and reports the other (`rationaleReadingNote`, shared with the typeset brief).
  const readingNote = rationaleReadingNote(context);
  if (readingNote) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    const lines: string[] = doc.splitTextToSize(readingNote, CONTENT_W - 8);
    const blockH = lines.length * 4 + 4;
    y = ensureSpace(doc, y, blockH + 4, pageNum);
    setFill(doc, P.gold);
    doc.rect(MARGIN, y - 1, 1.2, blockH, 'F');
    setColor(doc, BODY_TEXT);
    doc.text(lines, MARGIN + 5, y + 2.5);
    y += blockH + 6;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION: STRATEGY ADVISOR — the client-specific reasoning for its card
  // ════════════════════════════════════════════════════════════════════════
  const advisor = composeAdvisorSection(context.advisor);
  if (advisor) {
    y = ensureSpace(doc, y, 30, pageNum);
    y = drawSectionHeader(doc, advisor.title, y, P);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    setColor(doc, P.navy);
    y = drawWrappedText(doc, advisor.scenarioLine, MARGIN, y, CONTENT_W, 4.5) + 2;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BODY_TEXT);
    for (const para of advisor.paragraphs) {
      const lines: string[] = doc.splitTextToSize(para, CONTENT_W);
      for (const line of lines) {
        y = ensureSpace(doc, y, 5, pageNum);
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        setColor(doc, BODY_TEXT);
        doc.text(line, MARGIN, y);
        y += 4;
      }
      y += 2;
    }

    if (advisor.riskLine) {
      const riskColor = advisor.risk === 'high' ? RED : advisor.risk === 'medium' ? AMBER : GREEN;
      y = ensureSpace(doc, y, 8, pageNum);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      setColor(doc, riskColor);
      doc.text(advisor.riskLine, MARGIN, y + 1);
      y += 7;
    }

    const drawList = (title: string, items: string[], bar: RGB) => {
      if (items.length === 0) return;
      y = ensureSpace(doc, y, 14, pageNum);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.navy);
      doc.text(title, MARGIN, y);
      y += 5;
      for (const item of items) {
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        const lines: string[] = doc.splitTextToSize(item, CONTENT_W - 8);
        const blockH = lines.length * 4 + 3;
        y = ensureSpace(doc, y, blockH + 1, pageNum);
        setFill(doc, bar);
        doc.rect(MARGIN, y + 1, 1.2, blockH - 2, 'F');
        setColor(doc, BODY_TEXT);
        doc.text(lines, MARGIN + 5, y + 4);
        y += blockH;
      }
      y += 3;
    };
    drawList(advisor.evidenceTitle, advisor.evidence, P.gold);
    drawList(advisor.rejectedTitle, advisor.rejected, GRAY);
    drawList(advisor.cautionsTitle, advisor.cautions, AMBER);

    // The options the advisor put forward, the applied one marked: a decision
    // is between options, and the brief used to name only one.
    if (advisor.options.length > 0) {
      const cols = [
        { head: 'OPTION', w: CONTENT_W * 0.36, align: 'left' as const },
        { head: 'CAPACITY', w: CONTENT_W * 0.15, align: 'right' as const },
        { head: 'PURCHASE POWER', w: CONTENT_W * 0.17, align: 'right' as const },
        { head: 'TARGET', w: CONTENT_W * 0.2, align: 'right' as const },
        { head: 'RISK', w: CONTENT_W * 0.12, align: 'right' as const },
      ];
      y = ensureSpace(doc, y, 14 + advisor.options.length * 9, pageNum);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.navy);
      doc.text(advisor.optionsTitle, MARGIN, y);
      y += 5;
      const cellX = (i: number) => MARGIN + cols.slice(0, i).reduce((a, c) => a + c.w, 0);
      const drawCell = (i: number, value: string, rowY: number) => {
        const c = cols[i];
        doc.text(value, c.align === 'right' ? cellX(i) + c.w - 1 : cellX(i) + 1, rowY, { align: c.align });
      };
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, GRAY);
      cols.forEach((c, i) => drawCell(i, c.head, y));
      y += 2;
      setDraw(doc, GRAY);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 4;
      for (const o of advisor.options) {
        doc.setFontSize(8);
        doc.setFont('helvetica', o.applied ? 'bold' : 'normal');
        const nameLines: string[] = doc.splitTextToSize(o.applied ? `${o.name} (applied)` : o.name, cols[0].w - 2);
        const rowH = Math.max(1, nameLines.length) * 3.8 + 2;
        y = ensureSpace(doc, y, rowH + 1, pageNum);
        setColor(doc, o.applied ? P.navy : BODY_TEXT);
        doc.text(nameLines, cellX(0) + 1, y);
        drawCell(1, o.capacity, y);
        drawCell(2, o.purchasePower, y);
        drawCell(3, o.target, y);
        drawCell(4, o.risk, y);
        y += rowH;
        setDraw(doc, { r: 225, g: 225, b: 225 });
        doc.line(MARGIN, y - 1.5, MARGIN + CONTENT_W, y - 1.5);
        y += 1;
      }
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'italic');
      setColor(doc, GRAY);
      const noteLines: string[] = doc.splitTextToSize(ADVISOR_OPTIONS_NOTE, CONTENT_W);
      y = ensureSpace(doc, y, noteLines.length * 3.6 + 2, pageNum);
      doc.text(noteLines, MARGIN, y + 1);
      y += noteLines.length * 3.6 + 4;
    }

    for (const note of advisor.notes) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'italic');
      const lines: string[] = doc.splitTextToSize(note, CONTENT_W);
      y = ensureSpace(doc, y, lines.length * 3.6 + 2, pageNum);
      setColor(doc, GRAY);
      doc.text(lines, MARGIN, y);
      y += lines.length * 3.6 + 2;
    }
    y += 6;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION: WHAT & WHY (per-lever bullets)
  // ════════════════════════════════════════════════════════════════════════
  y = ensureSpace(doc, y, 18, pageNum);
  y = drawSectionHeader(doc, `What we propose & why  (${report.bullets.length} lever${report.bullets.length === 1 ? '' : 's'})`, y, P);

  if (report.bullets.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setColor(doc, GRAY);
    doc.text('Baseline scenario — no levers applied.', MARGIN + 2, y);
    y += 8;
  } else {
    for (const b of report.bullets) {
      const sevColor = severityColor(b.severity);

      // The pill and the severity word sit in the right-hand column, so the
      // text wraps short of it: wrapped to the full width, "properties" ran
      // into "CAUTION" on the delivered brief.
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      const pillReserve = b.capacityImpact !== 0
        ? doc.getTextWidth(`${fmtSigned(b.capacityImpact)} capacity`) + 6
        : 0;
      doc.setFontSize(6);
      const labelReserve = doc.getTextWidth(severityLabel(b.severity));
      const textW = CONTENT_W - 12 - Math.max(pillReserve, labelReserve) - 4;

      // Estimate height needed
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const whatLines: string[] = doc.splitTextToSize(b.what, textW);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      const whyLines: string[] = doc.splitTextToSize(b.why, textW);
      const cashLineHeight = b.cashflowNote ? 5 : 0;
      const blockHeight =
        whatLines.length * 4.5 + whyLines.length * 4 + cashLineHeight + 6;

      y = ensureSpace(doc, y, blockHeight + 4, pageNum);

      // Severity bar
      setFill(doc, sevColor);
      doc.rect(MARGIN, y, 1.5, blockHeight, 'F');

      // What (bold)
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.navy);
      doc.text(whatLines, MARGIN + 5, y + 4);
      let bulletY = y + 4 + whatLines.length * 4.5;

      // Capacity impact pill (right-aligned)
      if (b.capacityImpact !== 0) {
        const pillText = `${fmtSigned(b.capacityImpact)} capacity`;
        const pillW = pillReserve;
        const pillX = MARGIN + CONTENT_W - pillW;
        setFill(doc, sevColor);
        doc.roundedRect(pillX, y + 1, pillW, 5, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        setColor(doc, WHITE);
        doc.text(pillText, pillX + pillW / 2, y + 4.5, { align: 'center' });
      }

      // Severity label (small, top-right under pill)
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      setColor(doc, sevColor);
      doc.text(severityLabel(b.severity), MARGIN + CONTENT_W, y + 9.5, { align: 'right' });

      // Why
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      setColor(doc, BODY_TEXT);
      doc.text(whyLines, MARGIN + 5, bulletY + 1);
      bulletY += whyLines.length * 4 + 1;

      // Cash flow note
      if (b.cashflowNote) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        setColor(doc, sevColor);
        doc.text(`Cash-flow: ${b.cashflowNote}`, MARGIN + 5, bulletY + 3);
      }

      y += blockHeight + 3;
    }
  }
  y += 4;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION: RECONCILIATION
  // ════════════════════════════════════════════════════════════════════════
  y = ensureSpace(doc, y, 28, pageNum);
  y = drawSectionHeader(doc, 'How the math reconciles', y, P);

  setFill(doc, MUTED_BG);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  const reconLines: string[] = doc.splitTextToSize(report.reconciliation, CONTENT_W - 6);
  const reconBlockH = reconLines.length * 4 + 6;
  y = ensureSpace(doc, y, reconBlockH + 4, pageNum);
  doc.roundedRect(MARGIN, y, CONTENT_W, reconBlockH, 2, 2, 'F');
  setColor(doc, BODY_TEXT);
  doc.text(reconLines, MARGIN + 3, y + 5);
  y += reconBlockH + 8;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION: EXECUTION SEQUENCE
  // ════════════════════════════════════════════════════════════════════════
  y = ensureSpace(doc, y, 18, pageNum);
  y = drawSectionHeader(doc, `Recommended execution sequence  (${report.sequence.length} step${report.sequence.length === 1 ? '' : 's'})`, y, P);

  if (report.sequence.length === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    setColor(doc, GRAY);
    doc.text('No execution steps required — baseline scenario.', MARGIN + 2, y);
    y += 8;
  } else {
    for (const step of report.sequence) {
      const oColor = ownerColor(step.owner, P);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const actionLines: string[] = doc.splitTextToSize(step.action, CONTENT_W - 22);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      const detailLines: string[] = step.detail
        ? doc.splitTextToSize(step.detail, CONTENT_W - 22)
        : [];
      const blockH = 4 + actionLines.length * 4.5 + detailLines.length * 3.8 + 4;

      y = ensureSpace(doc, y, blockH + 3, pageNum);

      // Step number circle
      setFill(doc, P.navy);
      doc.circle(MARGIN + 4, y + 4, 3.2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.goldOnNavy);
      doc.text(String(step.step), MARGIN + 4, y + 5.2, { align: 'center' });

      // Action
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.navy);
      doc.text(actionLines, MARGIN + 11, y + 4);

      // Owner pill (top right)
      const ownerLabel = step.owner.toUpperCase();
      const ownerW = doc.getTextWidth(ownerLabel) + 6;
      setFill(doc, oColor);
      doc.roundedRect(MARGIN + CONTENT_W - ownerW, y + 1, ownerW, 5, 1, 1, 'F');
      doc.setFontSize(6);
      doc.setFont('helvetica', 'bold');
      setColor(doc, WHITE);
      doc.text(ownerLabel, MARGIN + CONTENT_W - ownerW / 2, y + 4.5, { align: 'center' });

      // Detail
      if (detailLines.length > 0) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        setColor(doc, BODY_TEXT);
        doc.text(detailLines, MARGIN + 11, y + 4 + actionLines.length * 4.5 + 1);
      }

      y += blockH + 2;
    }
  }
  y += 4;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION: CAVEATS
  // ════════════════════════════════════════════════════════════════════════
  y = ensureSpace(doc, y, 18, pageNum);
  y = drawSectionHeader(doc, 'Caveats & assumptions', y, P);

  for (const c of report.caveats) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    const lines: string[] = doc.splitTextToSize(c, CONTENT_W - 8);
    const lineH = lines.length * 4 + 3;
    y = ensureSpace(doc, y, lineH + 1, pageNum);
    setFill(doc, AMBER);
    doc.rect(MARGIN, y + 1, 1.2, lineH - 2, 'F');
    setColor(doc, BODY_TEXT);
    doc.text(lines, MARGIN + 5, y + 4);
    y += lineH;
  }
  y += 4;

  // ════════════════════════════════════════════════════════════════════════
  // PHASE K5 — CAPITAL FLOW (sources → sinks)
  // ════════════════════════════════════════════════════════════════════════
  if (report.capitalFlow && report.capitalFlow.legs.length > 0) {
    const cf = report.capitalFlow;
    y = ensureSpace(doc, y, 30, pageNum);
    y = drawSectionHeader(doc, `Capital allocation flow  (${cf.legs.length} leg${cf.legs.length === 1 ? '' : 's'})`, y, P);

    // Pool summary strip
    setFill(doc, MUTED_BG);
    doc.roundedRect(MARGIN, y, CONTENT_W, 14, 2, 2, 'F');
    doc.setFontSize(7);
    setColor(doc, GRAY);
    doc.setFont('helvetica', 'normal');
    doc.text('AVAILABLE', MARGIN + 4, y + 5);
    doc.text('ROUTED', MARGIN + CONTENT_W / 3 + 4, y + 5);
    doc.text('RESIDUAL', MARGIN + (CONTENT_W * 2) / 3 + 4, y + 5);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    setColor(doc, P.navy);
    doc.text(fmtAud(cf.totalAvailable), MARGIN + 4, y + 11);
    doc.text(fmtAud(cf.totalRouted), MARGIN + CONTENT_W / 3 + 4, y + 11);
    doc.text(fmtAud(cf.remainder), MARGIN + (CONTENT_W * 2) / 3 + 4, y + 11);
    y += 17;

    if (cf.overcommitted) {
      setFill(doc, RED);
      doc.roundedRect(MARGIN, y, CONTENT_W, 6, 1, 1, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      setColor(doc, WHITE);
      doc.text('POOL OVERCOMMITTED — sinks were clamped to available pool.', MARGIN + 3, y + 4);
      y += 9;
    }

    for (const leg of cf.legs) {
      const isUnallocated = leg.sinkType === 'unallocated';
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      const headerLine = `${leg.sourceLabel}  →  ${leg.sinkLabel}`;
      const headerLines: string[] = doc.splitTextToSize(headerLine, CONTENT_W - 50);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      const noteLines: string[] = leg.note ? doc.splitTextToSize(leg.note, CONTENT_W - 8) : [];
      const blockH = headerLines.length * 4 + noteLines.length * 3.5 + 7;

      y = ensureSpace(doc, y, blockH + 2, pageNum);

      // Severity bar
      setFill(doc, isUnallocated ? GRAY : P.gold);
      doc.rect(MARGIN, y, 1.2, blockH, 'F');

      // Header
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(doc, P.navy);
      doc.text(headerLines, MARGIN + 5, y + 4);

      // Right-side metrics: amount + servicing + debt pills
      const pillsY = y + 1;
      let pillX = MARGIN + CONTENT_W;
      const drawPill = (text: string, fillColor: RGB) => {
        const w = doc.getTextWidth(text) + 4;
        pillX -= w + 2;
        setFill(doc, fillColor);
        doc.roundedRect(pillX, pillsY, w, 5, 1, 1, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        setColor(doc, WHITE);
        doc.text(text, pillX + w / 2, pillsY + 3.6, { align: 'center' });
      };
      if (leg.debtBalanceDelta !== 0) {
        drawPill(`${leg.debtBalanceDelta < 0 ? '−' : '+'}${fmtAud(Math.abs(leg.debtBalanceDelta))} debt`, GRAY);
      }
      if (leg.monthlyServicingDelta !== 0) {
        drawPill(
          `${leg.monthlyServicingDelta < 0 ? '−' : '+'}${fmtAud(Math.abs(leg.monthlyServicingDelta))}/mo`,
          leg.monthlyServicingDelta < 0 ? GREEN : RED,
        );
      }
      drawPill(fmtAud(leg.amount), P.navy);

      // Note
      if (noteLines.length > 0) {
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        setColor(doc, BODY_TEXT);
        doc.text(noteLines, MARGIN + 5, y + 4 + headerLines.length * 4 + 1);
      }
      y += blockH + 1;
    }

    // Net impact summary
    y = ensureSpace(doc, y, 10, pageNum);
    setFill(doc, MUTED_BG);
    doc.roundedRect(MARGIN, y, CONTENT_W, 8, 1, 1, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(doc, P.navy);
    doc.text(
      `Net capital impact: ${cf.monthlyServicingDelta < 0 ? '−' : '+'}${fmtAud(Math.abs(cf.monthlyServicingDelta))}/mo servicing  ·  ${cf.debtBalanceDelta < 0 ? '−' : '+'}${fmtAud(Math.abs(cf.debtBalanceDelta))} debt balance`,
      MARGIN + 3, y + 5.2,
    );
    y += 12;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE G1 — VALUATION ASSUMPTIONS (audit watermark)
  // ════════════════════════════════════════════════════════════════════════
  if (context.valuationAssumptions && context.valuationAssumptions.length > 0) {
    y = ensureSpace(doc, y, 22, pageNum);
    y = drawSectionHeader(doc, `Valuation assumptions  (${context.valuationAssumptions.length} override${context.valuationAssumptions.length === 1 ? '' : 's'})`, y, P);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    setColor(doc, GRAY);
    doc.text('Finance must validate each basis before submission. AVM/desktop figures are advisory only.', MARGIN, y);
    y += 6;
    for (const v of context.valuationAssumptions) {
      const basisLabel = v.basis === 'avm' ? 'AVM' : v.basis === 'desktop' ? 'Desktop val' : v.basis === 'comparable_sales' ? 'Comp sales' : 'Manual';
      const delta = v.newValue - v.originalValue;
      const lines: string[] = doc.splitTextToSize(
        `${v.address}: ${fmtAud(v.originalValue)} → ${fmtAud(v.newValue)} (${fmtSigned(delta)}) — basis: ${basisLabel}${v.source ? ` · source: ${v.source}` : ''}`,
        CONTENT_W - 8,
      );
      const blockH = lines.length * 4 + 3;
      y = ensureSpace(doc, y, blockH + 1, pageNum);
      setFill(doc, P.gold);
      doc.rect(MARGIN, y + 1, 1.2, blockH - 2, 'F');
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      setColor(doc, BODY_TEXT);
      doc.text(lines, MARGIN + 5, y + 4);
      y += blockH;
    }
    y += 4;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE G2 — CROSS-COLLAT METHODOLOGY DISCLOSURE
  // ════════════════════════════════════════════════════════════════════════
  if (context.crossCollatPool && context.crossCollatPool.enabled) {
    const pool = context.crossCollatPool;
    y = ensureSpace(doc, y, 30, pageNum);
    y = drawSectionHeader(doc, 'Equity release methodology — cross-collateralised', y, P);
    const blendedActual = pool.totalPoolValue > 0
      ? ((pool.totalPoolDebt + pool.poolReleaseAmount) / pool.totalPoolValue) * 100
      : 0;
    const lines: string[] = doc.splitTextToSize(
      `Pool of ${pool.propertyAddresses.length} ${pool.propertyAddresses.length === 1 ? 'security' : 'securities'} (${pool.propertyAddresses.join('; ')}). ` +
      `Total pool value: ${fmtAud(pool.totalPoolValue)}. Existing pool debt: ${fmtAud(pool.totalPoolDebt)}. ` +
      `Target blended LVR: ${(pool.blendedTargetLVR * 100).toFixed(0)}% (achieved ${blendedActual.toFixed(1)}%). ` +
      `Per-security cap: ${(pool.lenderMaxLVR * 100).toFixed(0)}%. Allocation: ${pool.allocationStrategy.replace(/_/g, ' ')}. ` +
      `Pool release: ${fmtAud(pool.poolReleaseAmount)}.`,
      CONTENT_W - 8,
    );
    const blockH = lines.length * 4 + 5;
    y = ensureSpace(doc, y, blockH + 2, pageNum);
    setFill(doc, MUTED_BG);
    doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 2, 2, 'F');
    setFill(doc, P.navy);
    doc.rect(MARGIN, y + 2, 2.5, blockH - 4, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BODY_TEXT);
    doc.text(lines, MARGIN + 6, y + 5);
    y += blockH + 6;
  }

  // ════════════════════════════════════════════════════════════════════════
  // DISCLAIMER PAGE
  // ════════════════════════════════════════════════════════════════════════
  try {
    const globalSettings = await fetchGlobalReportSettings();
    if (legacyBrand.artwork === 'issuer') {
      const closing = issuerClosingPage(legacyBrand, globalSettings);
      drawJsPDFDisclaimerPage(doc, closing.contact, closing.disclaimer, closing.palette);
    } else {
      drawJsPDFDisclaimerPage(doc, globalSettings.contactDetails, globalSettings.disclaimer);
    }
    pageNum.value++;
  } catch (e) {
    console.warn('Could not fetch global settings for disclaimer page:', e);
  }

  // ════════════════════════════════════════════════════════════════════════
  // FOOTERS — applied AFTER total page count is known
  // ════════════════════════════════════════════════════════════════════════
  const totalPages = doc.getNumberOfPages();
  const footerLabel = `Strategy Rationale Brief  |  ${displayName}  |  Confidential`;
  // Skip cover page (1) and disclaimer page (last)
  for (let p = 2; p <= totalPages - 1; p++) {
    doc.setPage(p);
    addFooter(doc, p, totalPages, footerLabel, P);
  }

  // ════════════════════════════════════════════════════════════════════════
  const safeName = displayName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const fileName = `Strategy_Rationale_${safeName}_${dateStr}.pdf`;
  const blob = doc.output('blob');
  return { blob, fileName };
}

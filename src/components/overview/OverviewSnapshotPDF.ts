/**
 * Overview Snapshot PDF Generator
 * 
 * Generates a premium navy/gold branded PDF report for the
 * Overview dashboard snapshot — premium navy/gold branded report.
 */

import jsPDF from 'jspdf';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawJsPDFDisclaimerPage } from '@/utils/pdfDisclaimerPage';

// ─── Design tokens ───────────────────────────────────────────────────────────
const NAVY = { r: 13, g: 38, b: 77 };
const GOLD = { r: 191, g: 155, b: 80 };
const WHITE = { r: 255, g: 255, b: 255 };
const LIGHT_BG = { r: 245, g: 243, b: 238 };
const DARK_TEXT = { r: 30, g: 30, b: 30 };
const GRAY_TEXT = { r: 100, g: 100, b: 100 };
const GREEN = { r: 34, g: 139, b: 34 };
const RED = { r: 180, g: 40, b: 40 };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OverviewSnapshotData {
  kpis: {
    newThisWeek: number;
    withInspections: number;
    needsReview: number;
    averagePrice: number;
  };
  contentStats: {
    withPrices: number;
    withImages: number;
    withFloorplans: number;
    withKeyEntities: number;
    emailSources: number;
  };
  totalListings: number;
  filters: {
    state: string;
    postcode: string;
    suburb: string;
    propertyType: string;
  };
  suburbData: { suburb: string; count: number }[];
  propertyTypeData: { type: string; count: number }[];
  agencyData: { agency: string; count: number }[];
  recentListings: {
    address?: string;
    suburb?: string;
    postcode?: string;
    price?: number;
    propertyType?: string;
    beds?: number;
    baths?: number;
    source?: string;
  }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(v: number): string {
  if (!v || isNaN(v)) return '$0';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

// ─── PDF Builder ─────────────────────────────────────────────────────────────

export async function generateOverviewSnapshotPDF(data: OverviewSnapshotData): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 20;
  const cw = pw - margin * 2;
  let y = 0;
  let pageNum = 0;

  const now = new Date();

  // Fetch dynamic brand for footer/cover
  const brandSettings = await fetchGlobalReportSettings();
  const brandName = (brandSettings?.contactDetails?.company_name || 'Property Consulting').trim();

  // ── Utilities ──
  const addPage = () => {
    if (pageNum > 0) {
      drawFooter();
      doc.addPage();
    }
    pageNum++;
    y = 25;
  };

  const drawFooter = () => {
    const fy = ph - 12;
    doc.setDrawColor(GOLD.r, GOLD.g, GOLD.b);
    doc.setLineWidth(0.5);
    doc.line(margin, fy - 3, pw - margin, fy - 3);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
    doc.text(`${brandName} | Overview Snapshot Report`, margin, fy);
    doc.text(`Page ${pageNum}`, pw - margin, fy, { align: 'right' });
  };

  const checkBreak = (needed: number) => {
    if (y + needed > ph - 30) addPage();
  };

  const drawSectionHeader = (title: string) => {
    checkBreak(18);
    // Gold accent bar
    doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
    doc.rect(margin, y - 1, 3, 10, 'F');
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(NAVY.r, NAVY.g, NAVY.b);
    doc.text(title, margin + 7, y + 6);
    y += 16;
  };

  const drawKPIBox = (x: number, bw: number, label: string, value: string, highlight?: { r: number; g: number; b: number }) => {
    const bh = 28;
    // Background
    doc.setFillColor(LIGHT_BG.r, LIGHT_BG.g, LIGHT_BG.b);
    doc.roundedRect(x, y, bw, bh, 2, 2, 'F');
    // Gold top border
    doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
    doc.rect(x, y, bw, 1.5, 'F');
    // Label
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
    doc.text(label.toUpperCase(), x + 5, y + 10);
    // Value
    const vc = highlight || NAVY;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(vc.r, vc.g, vc.b);
    doc.text(value, x + 5, y + 22);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGE 1 — Cover
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();

  // Full navy background
  doc.setFillColor(NAVY.r, NAVY.g, NAVY.b);
  doc.rect(0, 0, pw, ph, 'F');

  // Gold accent line
  doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
  doc.rect(margin, 70, 50, 2, 'F');

  // Title
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text('OVERVIEW', margin, 95);
  doc.text('SNAPSHOT', margin, 110);

  // Subtitle
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
  doc.text('Property Intake Dashboard Report', margin, 130);

  // Date & time
  doc.setFontSize(10);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(`Generated: ${fmtDate(now)} at ${fmtTime(now)}`, margin, 150);

  // Filter context
  const activeFilters: string[] = [];
  if (data.filters.state !== 'all') activeFilters.push(`State: ${data.filters.state}`);
  if (data.filters.suburb !== 'all') activeFilters.push(`Suburb: ${data.filters.suburb}`);
  if (data.filters.postcode !== 'all') activeFilters.push(`Postcode: ${data.filters.postcode}`);
  if (data.filters.propertyType !== 'all') activeFilters.push(`Type: ${data.filters.propertyType}`);
  
  if (activeFilters.length > 0) {
    doc.setFontSize(9);
    doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
    doc.text('Active Filters:', margin, 165);
    doc.setTextColor(200, 200, 200);
    doc.text(activeFilters.join('  |  '), margin, 173);
  } else {
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text('All listings — no filters applied', margin, 165);
  }

  // Total listings badge at bottom
  doc.setFontSize(11);
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
  doc.text(`Total Properties: ${data.totalListings.toLocaleString('en-AU')}`, margin, ph - 50);

  // Brand
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(brandName, margin, ph - 25);

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGE 2 — Key Performance Indicators
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();

  drawSectionHeader('Key Performance Indicators');

  // KPI Row 1
  const kpiW = (cw - 10) / 2;
  drawKPIBox(margin, kpiW, 'New This Week', String(data.kpis.newThisWeek), GREEN);
  drawKPIBox(margin + kpiW + 10, kpiW, 'With Inspections', String(data.kpis.withInspections));
  y += 34;

  // KPI Row 2
  drawKPIBox(margin, kpiW, 'Needs Review', String(data.kpis.needsReview), data.kpis.needsReview > 0 ? RED : undefined);
  drawKPIBox(margin + kpiW + 10, kpiW, 'Average Price', fmtCurrency(data.kpis.averagePrice));
  y += 34;

  // ─── Content Quality Metrics ───
  y += 5;
  drawSectionHeader('Content Quality Metrics');

  const statItems = [
    { label: 'Properties With Prices', value: data.contentStats.withPrices, total: data.totalListings },
    { label: 'Properties With Images', value: data.contentStats.withImages, total: data.totalListings },
    { label: 'Properties With Floorplans', value: data.contentStats.withFloorplans, total: data.totalListings },
    { label: 'Properties With Key Entities', value: data.contentStats.withKeyEntities, total: data.totalListings },
    { label: 'Email Sources', value: data.contentStats.emailSources, total: data.totalListings },
  ];

  for (const stat of statItems) {
    checkBreak(12);
    const pct = stat.total > 0 ? ((stat.value / stat.total) * 100).toFixed(1) : '0.0';

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);
    doc.text(stat.label, margin, y + 4);

    doc.setFont('helvetica', 'bold');
    doc.text(`${stat.value} / ${stat.total}  (${pct}%)`, margin + 90, y + 4);

    // Progress bar
    const barX = margin + 135;
    const barW = cw - 135;
    const barH = 4;
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(barX, y + 1, barW, barH, 1, 1, 'F');
    const filled = Math.min((stat.value / Math.max(stat.total, 1)) * barW, barW);
    doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
    if (filled > 0) doc.roundedRect(barX, y + 1, filled, barH, 1, 1, 'F');

    y += 12;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Property Type Distribution
  // ═══════════════════════════════════════════════════════════════════════════
  y += 5;
  drawSectionHeader('Property Type Distribution');

  if (data.propertyTypeData.length > 0) {
    const totalPropCount = data.propertyTypeData.reduce((s, d) => s + d.count, 0);

    // Table header
    doc.setFillColor(NAVY.r, NAVY.g, NAVY.b);
    doc.rect(margin, y, cw, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
    doc.text('PROPERTY TYPE', margin + 4, y + 5.5);
    doc.text('COUNT', margin + cw * 0.5, y + 5.5);
    doc.text('SHARE', margin + cw * 0.72, y + 5.5);
    y += 10;

    for (let i = 0; i < Math.min(data.propertyTypeData.length, 12); i++) {
      checkBreak(9);
      const item = data.propertyTypeData[i];
      const pct = ((item.count / totalPropCount) * 100).toFixed(1);

      if (i % 2 === 0) {
        doc.setFillColor(LIGHT_BG.r, LIGHT_BG.g, LIGHT_BG.b);
        doc.rect(margin, y - 3, cw, 8, 'F');
      }

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);
      doc.text(item.type || 'Unknown', margin + 4, y + 2);
      doc.setFont('helvetica', 'bold');
      doc.text(String(item.count), margin + cw * 0.5, y + 2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
      doc.text(`${pct}%`, margin + cw * 0.72, y + 2);

      // Mini bar
      const miniBarW = cw * 0.18;
      const miniBarX = margin + cw * 0.8;
      doc.setFillColor(230, 230, 230);
      doc.roundedRect(miniBarX, y - 1, miniBarW, 3.5, 1, 1, 'F');
      const miniF = Math.min((item.count / totalPropCount) * miniBarW, miniBarW);
      doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
      if (miniF > 0) doc.roundedRect(miniBarX, y - 1, miniF, 3.5, 1, 1, 'F');

      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGE 3 — Top Suburbs & Agencies
  // ═══════════════════════════════════════════════════════════════════════════
  addPage();

  drawSectionHeader('Top Suburbs by Listing Volume');

  if (data.suburbData.length > 0) {
    const maxSuburbCount = data.suburbData[0]?.count || 1;

    // Table header
    doc.setFillColor(NAVY.r, NAVY.g, NAVY.b);
    doc.rect(margin, y, cw, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
    doc.text('#', margin + 4, y + 5.5);
    doc.text('SUBURB', margin + 14, y + 5.5);
    doc.text('LISTINGS', margin + cw * 0.55, y + 5.5);
    y += 10;

    for (let i = 0; i < Math.min(data.suburbData.length, 15); i++) {
      checkBreak(9);
      const item = data.suburbData[i];

      if (i % 2 === 0) {
        doc.setFillColor(LIGHT_BG.r, LIGHT_BG.g, LIGHT_BG.b);
        doc.rect(margin, y - 3, cw, 8, 'F');
      }

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
      doc.text(String(i + 1), margin + 4, y + 2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);
      doc.text(item.suburb || 'Unknown', margin + 14, y + 2);
      doc.setFont('helvetica', 'normal');
      doc.text(String(item.count), margin + cw * 0.55, y + 2);

      // Horizontal bar
      const barW = cw * 0.35;
      const barX = margin + cw * 0.63;
      doc.setFillColor(230, 230, 230);
      doc.roundedRect(barX, y - 1, barW, 3.5, 1, 1, 'F');
      const filled = Math.min((item.count / maxSuburbCount) * barW, barW);
      doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
      if (filled > 0) doc.roundedRect(barX, y - 1, filled, 3.5, 1, 1, 'F');

      y += 8;
    }
  }

  // ─── Top Agencies ───
  y += 10;
  drawSectionHeader('Top Agencies / Sources');

  if (data.agencyData.length > 0) {
    const maxAgencyCount = data.agencyData[0]?.count || 1;

    doc.setFillColor(NAVY.r, NAVY.g, NAVY.b);
    doc.rect(margin, y, cw, 8, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
    doc.text('#', margin + 4, y + 5.5);
    doc.text('AGENCY', margin + 14, y + 5.5);
    doc.text('LISTINGS', margin + cw * 0.55, y + 5.5);
    y += 10;

    for (let i = 0; i < Math.min(data.agencyData.length, 10); i++) {
      checkBreak(9);
      const item = data.agencyData[i];

      if (i % 2 === 0) {
        doc.setFillColor(LIGHT_BG.r, LIGHT_BG.g, LIGHT_BG.b);
        doc.rect(margin, y - 3, cw, 8, 'F');
      }

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
      doc.text(String(i + 1), margin + 4, y + 2);

      // Truncate long agency names
      const agencyName = (item.agency || 'Unknown').length > 45
        ? (item.agency || 'Unknown').slice(0, 42) + '...'
        : (item.agency || 'Unknown');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);
      doc.text(agencyName, margin + 14, y + 2);
      doc.setFont('helvetica', 'normal');
      doc.text(String(item.count), margin + cw * 0.55, y + 2);

      const barW = cw * 0.35;
      const barX = margin + cw * 0.63;
      doc.setFillColor(230, 230, 230);
      doc.roundedRect(barX, y - 1, barW, 3.5, 1, 1, 'F');
      const filled = Math.min((item.count / maxAgencyCount) * barW, barW);
      doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
      if (filled > 0) doc.roundedRect(barX, y - 1, filled, 3.5, 1, 1, 'F');

      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGE 4 — Recent Listings Table
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.recentListings.length > 0) {
    addPage();
    drawSectionHeader('Recent Listings');

    // Table header
    doc.setFillColor(NAVY.r, NAVY.g, NAVY.b);
    doc.rect(margin, y, cw, 8, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
    doc.text('ADDRESS', margin + 3, y + 5.5);
    doc.text('SUBURB', margin + cw * 0.4, y + 5.5);
    doc.text('TYPE', margin + cw * 0.6, y + 5.5);
    doc.text('PRICE', margin + cw * 0.76, y + 5.5);
    y += 10;

    for (let i = 0; i < Math.min(data.recentListings.length, 25); i++) {
      checkBreak(9);
      const l = data.recentListings[i];

      if (i % 2 === 0) {
        doc.setFillColor(LIGHT_BG.r, LIGHT_BG.g, LIGHT_BG.b);
        doc.rect(margin, y - 3, cw, 8, 'F');
      }

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);

      const addr = (l.address || 'Unknown').length > 35
        ? (l.address || 'Unknown').slice(0, 32) + '...'
        : (l.address || 'Unknown');
      doc.text(addr, margin + 3, y + 2);

      doc.setTextColor(GRAY_TEXT.r, GRAY_TEXT.g, GRAY_TEXT.b);
      doc.text((l.suburb || '-').slice(0, 18), margin + cw * 0.4, y + 2);
      doc.text((l.propertyType || '-').slice(0, 12), margin + cw * 0.6, y + 2);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(DARK_TEXT.r, DARK_TEXT.g, DARK_TEXT.b);
      doc.text(l.price ? fmtCurrency(l.price) : '-', margin + cw * 0.76, y + 2);

      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Final footer on last content page
  // ═══════════════════════════════════════════════════════════════════════════
  drawFooter();

  // ═══════════════════════════════════════════════════════════════════════════
  //  Disclaimer / Contact Page
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const settings = await fetchGlobalReportSettings();
    drawJsPDFDisclaimerPage(doc, settings.contactDetails, settings.disclaimer);
  } catch (e) {
    console.warn('Could not load report settings for disclaimer page:', e);
  }

  return doc.output('blob');
}

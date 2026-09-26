import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { Download, ArrowLeft, Building2, DollarSign, MapPin, Calendar, TrendingUp, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { LiveChart, canNormaliseChartConfig } from '@/components/charts/kernel';
import { ChartLightbox } from '@/components/charts/ChartLightbox';
import { Maximize2 } from 'lucide-react';
import { fetchPdfBlob, triggerPdfDownload } from '@/lib/pdf/downloadPdf';
import { drawnDesignFor, type DrawnDocumentDesign } from '@/lib/reports/drawnDocumentDesign';
import { loadLegacyDocumentBrand, rgbObject } from '@/lib/reports/legacyDocumentBrand';
import { PLATFORM_DISCLAIMER } from '@/lib/reports/issuerIdentity.pure';
import { mixHex } from '@/lib/reportDesign/color.pure';
import { drawableCharts } from '@/lib/reports/quantitativeCharts';
import { marketSnapshotSentences, readQuantitativeReportFacts } from '@/lib/reports/quantitativeReportFacts';

type ReportRgb = { r: number; g: number; b: number };

/** The quantitative report's colours, by the part each plays on its dark pages. */
interface DarkReportPalette {
  navy: ReportRgb; gold: ReportRgb; darkBg: ReportRgb; cardBg: ReportRgb; cardAlt: ReportRgb; panel: ReportRgb;
  white: ReportRgb; lightGold: ReportRgb; barGold: ReportRgb; mutedText: ReportRgb; softWhite: ReportRgb;
  dividerCol: ReportRgb; quiet: ReportRgb; faint: ReportRgb; fainter: ReportRgb; faintest: ReportRgb;
}

/** The report as it has always been drawn: navy, gold and a dark ground. */
const HOUSE_DARK_REPORT_PALETTE: DarkReportPalette = {
  navy: { r: 13, g: 38, b: 77 },
  gold: { r: 191, g: 155, b: 80 },
  darkBg: { r: 18, g: 25, b: 45 },
  cardBg: { r: 24, g: 34, b: 58 },
  cardAlt: { r: 20, g: 28, b: 48 },
  panel: { r: 20, g: 30, b: 52 },
  white: { r: 255, g: 255, b: 255 },
  lightGold: { r: 220, g: 195, b: 140 },
  barGold: { r: 220, g: 185, b: 100 },
  mutedText: { r: 140, g: 150, b: 175 },
  softWhite: { r: 210, g: 218, b: 230 },
  dividerCol: { r: 40, g: 50, b: 75 },
  quiet: { r: 130, g: 140, b: 165 },
  faint: { r: 100, g: 115, b: 140 },
  fainter: { r: 100, g: 110, b: 135 },
  faintest: { r: 80, g: 90, b: 115 },
};

/**
 * The same parts in a chosen design (`drawnDesign.pure.ts`): its field is the
 * page, its field inks the words, and every shade between is a mix of the two,
 * in the proportions the house palette's own shades sit at.
 */
function darkReportPalette(design: DrawnDocumentDesign): DarkReportPalette {
  const f = design.family;
  const towardInk = (t: number) => rgbObject(mixHex(f.field, f.onField, t));
  const towardGround = (t: number) => rgbObject(mixHex(f.onField, f.field, t));
  return {
    navy: towardInk(0.1),
    gold: rgbObject(f.accentOnField),
    darkBg: rgbObject(f.field),
    cardBg: towardInk(0.06),
    cardAlt: towardInk(0.02),
    panel: towardInk(0.035),
    white: rgbObject(f.onField),
    lightGold: rgbObject(mixHex(f.accentOnField, f.onField, 0.35)),
    barGold: rgbObject(f.accentOnField),
    mutedText: towardGround(0.4),
    softWhite: towardGround(0.12),
    dividerCol: towardGround(0.85),
    quiet: towardGround(0.44),
    faint: towardGround(0.52),
    fainter: towardGround(0.55),
    faintest: towardGround(0.62),
  };
}


interface GeneratedReport {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  listing_count: number;
  chart_images: any;
  kpis: any;
  analytics: any;
  insights: any;
  config: any;
  chart_urls: any;
  pdf_bucket?: string | null;
  pdf_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  /** The pipeline version that built the report (`quantitative-report-pipeline`'s REPORT_VERSION). */
  version?: number | null;
}

interface ChartData {
  id: string;
  chart_type: string;
  title: string;
  image_data: string;
  chart_config?: any;
  created_at: string;
}

export default function ReportViewer() {
  const { reportId } = useParams<{ reportId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);
  
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [charts, setCharts] = useState<ChartData[]>([]);
  const [chartAnalysis, setChartAnalysis] = useState<{[key: string]: string}>({});
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [expandedChart, setExpandedChart] = useState<ChartData | null>(null);

  const shouldAutoDownload = searchParams.get('download') === 'true';
  const isQuantitativeRoute = location.pathname.startsWith('/quantitative-reports');
  const reportLibraryPath = isQuantitativeRoute ? '/quantitative-reports' : '/generated-reports';

  const fetchReport = async () => {
    try {
      // Fetch report data via Edge Function
      const { data: reportResult, error: reportError } = await invokeSecureFunction('get-investment-reports', {
        table: 'generated_reports',
        reportId: reportId,
        listOptions: { select: '*' }
      });

      if (reportError) {
        console.error('Error fetching report:', reportError);
        toast({
          title: "Error fetching report",
          description: reportError.message,
          variant: "destructive",
        });
        return;
      }

      const reportData = reportResult?.report;
      setReport(reportData);

      // Fetch associated charts via Edge Function
      const { data: chartsResult, error: chartsError } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'charts',
        listOptions: {
          filters: { report_id: reportId },
          orderBy: 'created_at',
          orderAsc: true
        }
      });

      if (chartsError) {
        console.error('Error fetching charts:', chartsError);
      } else {
        const chartsData = chartsResult?.records || [];
        setCharts(chartsData);
        
        // Fetch chart analysis for each chart and generate missing analysis
        if (chartsData && chartsData.length > 0) {
          const analysisPromises = chartsData.map(async (chart: any) => {
            // The pipeline writes each chart's own finding onto the chart row
            // and into chart_analysis as it generates the report.
            if (typeof chart.analysis_text === 'string' && chart.analysis_text.trim()) {
              return { chartId: chart.id, analysis: chart.analysis_text };
            }
            const { data: analysisResult } = await invokeSecureFunction('manage-templates', {
              operation: 'list',
              table: 'chart_analysis',
              listOptions: {
                filters: { chart_id: chart.id },
                limit: 1
              }
            });

            const analysisData = analysisResult?.records?.[0];
            if (analysisData) return { chartId: chart.id, analysis: analysisData.analysis_text };

            // None stored: the function analyses the chart's STORED data, read
            // by its id — it takes nothing else from the page, so nothing else
            // is sent. (The page used to send a made-up series for each title.)
            try {
              const { data: generatedAnalysis, error: generateError } = await invokeSecureFunction('generate-chart-analysis', {
                chartId: chart.id,
              });
              if (!generateError && generatedAnalysis?.analysisText) {
                return { chartId: chart.id, analysis: generatedAnalysis.analysisText };
              }
            } catch (error) {
              console.error(`Failed to generate analysis for chart ${chart.id}:`, error);
            }
            return null;
          });

          const analysisResults = await Promise.all(analysisPromises);
          const analysisMap: {[key: string]: string} = {};
          
          analysisResults.forEach(result => {
            if (result) {
              analysisMap[result.chartId] = result.analysis;
            }
          });
          
          setChartAnalysis(analysisMap);
        }
      }

    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: "Failed to fetch report",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };


  // ========== SVG-to-PNG helper (reliable Image API, no html2canvas) ==========
  const svgToPng = (svgBase64: string, width = 800, height = 500): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;   // 2x for retina clarity
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png', 1.0));
      };
      img.onerror = () => reject(new Error('SVG render failed'));
      // Fix SVG dimensions for consistent rendering
      let svgContent = atob(svgBase64.replace('data:image/svg+xml;base64,', ''));
      svgContent = svgContent.replace(/<svg[^>]*>/, (match) => {
        const viewBoxMatch = match.match(/viewBox=["']([^"']*)["']/);
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : `0 0 ${width} ${height}`;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" style="background:white;">`;
      });
      const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      img.src = URL.createObjectURL(blob);
    });
  };

  const handleDownloadPDF = async (options?: { returnBlob?: boolean }): Promise<Blob | void> => {
    if (!report) return;

    logActivityDirect({
      actionType: 'report_pdf_downloaded',
      entityType: 'investment_report',
      entityId: reportId,
      entityName: report.title,
      metadata: { format: 'pdf', source: 'report_viewer' }
    });

    setDownloading(true);
    // Fallback closure: only used if the rich client-side composer throws.
    // The stored PDF (produced by the pipeline edge function) is intentionally
    // basic — we prefer the fully-composed IMR report with charts.
    const downloadStoredFallback = async (): Promise<Blob | void> => {
      if (!report.pdf_path) return;
      const bucket = report.pdf_bucket || 'quantitative-reports';
      const fileName = report.file_name || `${report.title.replace(/[^a-zA-Z0-9]/g, '_')}_${format(new Date(report.created_at), 'yyyy-MM-dd')}.pdf`;
      const { data: signedResult, error: signedError } = await invokeSecureFunction('secure-storage', {
        operation: 'signedUrl',
        bucket,
        path: report.pdf_path,
        expires_in: 300,
      });
      if (signedError || !signedResult?.success || !signedResult?.data?.signedUrl) {
        throw new Error(signedResult?.error || signedError?.message || 'Stored PDF could not be prepared for download.');
      }
      const blob = await fetchPdfBlob(signedResult.data.signedUrl);
      if (options?.returnBlob) return blob;
      triggerPdfDownload(blob, fileName);
      // Said, because it is a different document: the pipeline's own copy
      // carries no chosen design and draws every chart the pipeline built.
      toast({
        title: 'Downloaded the saved copy',
        description: `The full report could not be drawn, so the simpler copy saved when this report was built was downloaded instead (${fileName}). It does not use a chosen template design.`,
      });
      return blob;
    };

    try {


      if (!reportRef.current) return;
      const __brandSettings = await fetchGlobalReportSettings();
      // Whose report this is, and what it looks like: the settings' name in the
      // house palette on the prime, as it always was; the issuer's own name on
      // a clone, whose settings may still carry the house's; and, where the
      // person chose a template for Market Intelligence, that template's design
      // (`drawnDocumentDesign.ts`) — the report's words and figures either way.
      const design = await drawnDesignFor('quantitative_report');
      const legacyBrand = await loadLegacyDocumentBrand(__brandSettings?.contactDetails?.company_name, undefined, design);
      const brandName = legacyBrand.artwork === 'issuer'
        ? legacyBrand.issuer.name
        : (__brandSettings?.contactDetails?.company_name || 'Property Report').trim();
      const brandUpper = brandName.toUpperCase();
      // An unbranded clone's report is issued by the platform, which supplies
      // the software and prepared none of it (`PLATFORM_DISCLAIMER`). So it is
      // named as the issuer and never as the report's author, owner or
      // adviser: no "prepared by", no copyright line, no "advisory" tagline,
      // and the platform's own disclaimer in place of the author's.
      const platformIssued = legacyBrand.artwork === 'issuer' && legacyBrand.issuer.kind === 'platform';
      // Only a chart with a picture or the data it is drawn from is drawn, and
      // only a drawn chart is counted (`quantitativeCharts.ts`) — the stand-in
      // this replaced invented its figures.
      const pdfCharts = await drawableCharts(charts, (svg) => svgToPng(svg, 900, 500), report.version);
      // What the report holds, read once; a figure it does not hold is left
      // out, never printed as a zero or a default (`quantitativeReportFacts.ts`).
      const facts = readQuantitativeReportFacts(report, charts);
      const wholeNumber = (n: number) => Math.round(n).toLocaleString('en-AU');
      const dollars = (n: number) => `$${wholeNumber(n)}`;
      const counted = (n: number, one: string, many: string) => `${wholeNumber(n)} ${n === 1 ? one : many}`;
      /** The distance jsPDF sets between the lines of one text call, in mm, at a size in points. */
      const lineStep = (size: number) => (size * 1.15 * 25.4) / 72;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 16;
      const contentWidth = pageWidth - 2 * margin;

      // ── Premium Dark & Gold palette ──
      // Every colour the report paints, by the part it plays. The report is
      // drawn on a dark ground, so a design supplies it from its field: the
      // field is the page, its field inks are the words, and the shades between
      // are mixes of the two — the same composite an alpha would have produced.
      // The semantic greens, ambers, reds and chart series stay the report's.
      const Q = design ? darkReportPalette(design) : HOUSE_DARK_REPORT_PALETTE;
      const navy   = Q.navy;
      const gold   = Q.gold;
      const darkBg = Q.darkBg;
      const cardBg = Q.cardBg;
      const white  = Q.white;
      const lightGold  = Q.lightGold;
      const mutedText  = Q.mutedText;
      const softWhite  = Q.softWhite;
      const dividerCol = Q.dividerCol;

      let currentPage = 1;
      let yPos = 0;
      let currentSectionNum = 0;

      // Track page numbers for TOC
      const tocEntries: { title: string; section: string; page: number }[] = [];

      // ── Helpers ──
      const setColor = (c: { r: number; g: number; b: number }) => pdf.setTextColor(c.r, c.g, c.b);
      const setFill  = (c: { r: number; g: number; b: number }) => pdf.setFillColor(c.r, c.g, c.b);
      const setDraw  = (c: { r: number; g: number; b: number }) => pdf.setDrawColor(c.r, c.g, c.b);

      const drawPageBg = () => { setFill(darkBg); pdf.rect(0, 0, pageWidth, pageHeight, 'F'); };

      const drawHeader = (sectionTitle: string) => {
        // Top header band
        setFill(navy); pdf.rect(0, 0, pageWidth, 12, 'F');
        setFill(gold); pdf.rect(0, 11.5, pageWidth, 0.5, 'F');
        pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); setColor(lightGold);
        pdf.text(brandUpper, margin, 7);
        pdf.text(sectionTitle.toUpperCase(), pageWidth - margin, 7, { align: 'right' });
      };

      const drawFooter = (pn: number) => {
        setDraw(dividerCol); pdf.setLineWidth(0.2);
        pdf.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
        pdf.setFontSize(6); setColor(mutedText); pdf.setFont('helvetica', 'normal');
        pdf.text(`${brandName}  •  CONFIDENTIAL`, margin, pageHeight - 9);
        pdf.text(`Page ${pn}`, pageWidth - margin, pageHeight - 9, { align: 'right' });
      };

      const addPage = (sectionTitle = '') => {
        pdf.addPage(); currentPage++;
        drawPageBg();
        if (sectionTitle) drawHeader(sectionTitle);
        drawFooter(currentPage);
        yPos = sectionTitle ? 18 : margin + 4;
      };

      const checkPageBreak = (needed: number, sectionTitle = '') => {
        if (yPos + needed > pageHeight - 20) addPage(sectionTitle);
      };

      const drawSectionHeader = (title: string, subtitle?: string, numbered = true) => {
        checkPageBreak(subtitle ? 24 : 18);
        if (numbered) {
          currentSectionNum++;
          tocEntries.push({ title, section: `${currentSectionNum}.0`, page: currentPage });
        }
        // Gold accent bar
        setFill(gold); pdf.rect(margin, yPos, 3.5, subtitle ? 16 : 12, 'F');
        // Section number
        if (numbered) {
          pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(gold);
          pdf.text(`${currentSectionNum}.0`, margin + 8, yPos + 7);
          pdf.setFontSize(14); setColor(white);
          pdf.text(title, margin + 20, yPos + 7);
        } else {
          pdf.setFontSize(14); pdf.setFont('helvetica', 'bold'); setColor(white);
          pdf.text(title, margin + 8, yPos + 7);
        }
        if (subtitle) {
          pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
          pdf.text(subtitle, margin + (numbered ? 20 : 8), yPos + 14);
          yPos += 22;
        } else {
          yPos += 16;
        }
      };

      const drawKPIBox = (x: number, y: number, w: number, h: number, label: string, value: string, sublabel?: string) => {
        setFill(cardBg); pdf.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
        setFill(gold); pdf.rect(x, y, w, 2, 'F');
        pdf.setFontSize(17); pdf.setFont('helvetica', 'bold'); setColor(gold);
        pdf.text(value, x + w / 2, y + h / 2 - (sublabel ? 2 : 0), { align: 'center' });
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text(label, x + w / 2, y + h / 2 + 8, { align: 'center' });
        if (sublabel) {
          pdf.setFontSize(5.5); setColor(Q.faint);
          pdf.text(sublabel, x + w / 2, y + h / 2 + 13, { align: 'center' });
        }
      };

      const drawAnalyticsRow = (label: string, value: string, detail: string, y: number) => {
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text(label, margin + 8, y);
        pdf.setFont('helvetica', 'bold'); setColor(gold);
        pdf.text(value, margin + contentWidth / 2, y, { align: 'center' });
        pdf.setFont('helvetica', 'normal'); setColor(softWhite);
        pdf.text(detail, pageWidth - margin - 8, y, { align: 'right' });
      };

      // ── Programmatic Chart Drawing ──
      // One scale places the marks, the gridlines and their labels: a step of
      // 1, 2 or 5 × 10ⁿ, so every label names the value its line is drawn at.
      // The axes used to divide the maximum into rounded quarters, which put
      // "0 2 4 5 7" on evenly spaced lines.
      const niceAxis = (low: number, high: number, integers: boolean) => {
        const raw = Math.max(high - low, integers ? 1 : Number.EPSILON) / 4;
        const power = 10 ** Math.floor(Math.log10(raw));
        let step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
        if (integers) step = Math.max(1, Math.round(step));
        const min = Math.floor(low / step) * step;
        const max = Math.max(Math.ceil(high / step) * step, min + step);
        const ticks: number[] = [];
        for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
        return { min, max, ticks };
      };
      const tickLabel = (t: number) => t.toLocaleString('en-AU', { maximumFractionDigits: 2 });
      // A label that fits the room it has, cut with an ellipsis only where it must be.
      const fitText = (text: string, width: number) => {
        if (pdf.getTextWidth(text) <= width) return text;
        let cut = text;
        while (cut.length > 1 && pdf.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
        return `${cut.trimEnd()}…`;
      };
      // A day is printed as a day ("28 Aug"): cut to seven characters, every
      // point of the daily chart read "2026-08" or "2026-09".
      const axisLabel = (label: string) => {
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
        return iso ? format(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), 'd MMM') : label;
      };

      const drawBarChart = (x: number, y: number, w: number, h: number, data: { label: string; value: number }[], chartTitle: string) => {
        if (!data || data.length === 0) return;
        const values = data.map((d) => d.value);
        const axis = niceAxis(0, Math.max(...values, 0), values.every(Number.isInteger));
        const barAreaH = h - 20;
        const barW = Math.min((w - 20) / data.length - 4, 30);
        const startX = x + (w - (data.length * (barW + 4))) / 2;
        const heightOf = (v: number) => barAreaH * (Math.max(v, axis.min) - axis.min) / (axis.max - axis.min);
        setFill(cardBg); pdf.roundedRect(x, y, w, h, 2, 2, 'F');
        pdf.setFontSize(5.5); setColor(mutedText); pdf.setFont('helvetica', 'normal');
        axis.ticks.forEach((t) => {
          const labelY = y + 8 + barAreaH - heightOf(t);
          pdf.text(tickLabel(t), x + 4, labelY);
          setDraw(dividerCol); pdf.setLineWidth(0.1);
          pdf.line(x + 18, labelY - 1, x + w - 4, labelY - 1);
        });
        data.forEach((d, i) => {
          const barH = heightOf(d.value);
          const bx = startX + i * (barW + 4);
          const by = y + 8 + barAreaH - barH;
          setFill(gold); pdf.rect(bx, by, barW, barH, 'F');
          setFill(Q.barGold); pdf.rect(bx, by, barW, Math.min(barH, 3), 'F');
          pdf.setFontSize(5); pdf.setFont('helvetica', 'bold'); setColor(white);
          if (barH > 8) pdf.text(d.value.toLocaleString('en-AU'), bx + barW / 2, by - 2, { align: 'center' });
          // The category, over two lines where it needs them — it was cut at
          // nine characters whatever room the bar had.
          pdf.setFontSize(4.5); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
          const room = barW + 3;
          const lines: string[] = pdf.splitTextToSize(d.label, room);
          const shown = lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
          shown.forEach((line, n) => {
            pdf.text(fitText(line, room), bx + barW / 2, y + h - (shown.length > 1 ? 7 : 6) + n * 1.9, { align: 'center' });
          });
        });
      };

      const drawLineChart = (x: number, y: number, w: number, h: number, data: { label: string; value: number }[], chartTitle: string) => {
        if (!data || data.length < 2) return;
        const values = data.map((d) => d.value);
        const axis = niceAxis(Math.min(...values, 0), Math.max(...values, 0), values.every(Number.isInteger));
        const range = axis.max - axis.min;
        const chartH = h - 22; const chartW = w - 28;
        const startX = x + 22; const startY = y + 8;
        setFill(cardBg); pdf.roundedRect(x, y, w, h, 2, 2, 'F');
        pdf.setFontSize(5); setColor(mutedText);
        axis.ticks.forEach((t) => {
          const gridY = startY + chartH - chartH * (t - axis.min) / range;
          setDraw(dividerCol); pdf.setLineWidth(0.1); pdf.line(startX, gridY, startX + chartW, gridY);
          pdf.text(tickLabel(t), x + 4, gridY + 1);
        });
        const points = data.map((d, i) => ({
          x: startX + (i / (data.length - 1)) * chartW,
          y: startY + chartH - ((d.value - axis.min) / range) * chartH
        }));
        setDraw(gold); pdf.setLineWidth(0.8);
        for (let i = 0; i < points.length - 1; i++) {
          pdf.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
        }
        points.forEach((p) => {
          setFill(gold); pdf.circle(p.x, p.y, 1.2, 'F');
          setFill(darkBg); pdf.circle(p.x, p.y, 0.6, 'F');
        });
        const step = Math.max(1, Math.floor(data.length / 8));
        const last = data.length - 1;
        const labelled = data.map((_, i) => i)
          .filter((i) => i % step === 0 || (i === last && last % step >= Math.ceil(step / 2)));
        const room = chartW / labelled.length - 1;
        pdf.setFontSize(4.5); setColor(mutedText);
        labelled.forEach((i) => {
          pdf.text(fitText(axisLabel(data[i].label), room), points[i].x, startY + chartH + 6, { align: 'center' });
        });
      };

      const drawPieChart = (x: number, y: number, w: number, h: number, data: { label: string; value: number }[], chartTitle: string) => {
        if (!data || data.length === 0) return;
        const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
        const cx = x + w * 0.35; const cy = y + h / 2;
        const radius = Math.min(w * 0.25, h * 0.35);
        setFill(cardBg); pdf.roundedRect(x, y, w, h, 2, 2, 'F');
        // The lead slice in the report's accent; the rest a fixed series.
        const colors = [
          gold, { r: 16, g: 185, b: 129 }, { r: 59, g: 130, b: 246 },
          { r: 239, g: 68, b: 68 }, { r: 139, g: 92, b: 246 }, { r: 6, g: 182, b: 212 },
          { r: 245, g: 158, b: 11 }, { r: 236, g: 72, b: 153 },
        ];
        let startAngle = -Math.PI / 2;
        data.forEach((d, i) => {
          const sweepAngle = (d.value / total) * 2 * Math.PI;
          setFill(colors[i % colors.length]);
          const steps = Math.max(8, Math.ceil(sweepAngle * 20));
          for (let s = 0; s < steps; s++) {
            const a1 = startAngle + (s / steps) * sweepAngle;
            const a2 = startAngle + ((s + 1) / steps) * sweepAngle;
            pdf.triangle(cx, cy, cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cx + radius * Math.cos(a2), cy + radius * Math.sin(a2), 'F');
          }
          startAngle += sweepAngle;
        });
        setFill(cardBg); pdf.circle(cx, cy, radius * 0.5, 'F');
        const legendX = x + w * 0.62; let legendY = y + 10;
        const legendRoom = x + w - 4 - (legendX + 6);
        data.slice(0, 6).forEach((d, i) => {
          setFill(colors[i % colors.length]); pdf.rect(legendX, legendY - 2.5, 4, 4, 'F');
          pdf.setFontSize(6); setColor(softWhite);
          const share = ` (${((d.value / total) * 100).toFixed(1)}%)`;
          pdf.text(`${fitText(d.label, legendRoom - pdf.getTextWidth(share))}${share}`, legendX + 6, legendY);
          legendY += 8;
        });
      };

      // ══════════════════════════════════════
      // PAGE 1 — COVER PAGE
      // ══════════════════════════════════════
      drawPageBg();

      // Full-bleed navy header (larger, more dramatic)
      setFill(navy); pdf.rect(0, 0, pageWidth, 120, 'F');
      // Gold accent stripe
      setFill(gold); pdf.rect(0, 118, pageWidth, 2.5, 'F');

      // Decorative side accent
      try {
        setFill(Q.gold);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.15 }));
        pdf.rect(0, 0, 5, 120, 'F');
        pdf.rect(pageWidth - 5, 0, 5, 120, 'F');
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
      } catch { /* GState not supported */ }

      // Top label
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(lightGold);
      pdf.text('QUANTITATIVE MARKET ANALYSIS', pageWidth / 2, 22, { align: 'center' });

      // Decorative line under label
      setDraw(gold); pdf.setLineWidth(0.3);
      pdf.line(pageWidth / 2 - 30, 25, pageWidth / 2 + 30, 25);

      // Title
      pdf.setFontSize(26); pdf.setFont('helvetica', 'bold'); setColor(white);
      const titleLines = pdf.splitTextToSize(report.title, contentWidth - 20);
      pdf.text(titleLines, pageWidth / 2, 42, { align: 'center' });

      // Subtitle
      if (report.description) {
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); setColor(lightGold);
        const descLines = pdf.splitTextToSize(report.description, contentWidth - 40);
        pdf.text(descLines, pageWidth / 2, 62 + (titleLines.length > 1 ? 10 : 0), { align: 'center' });
      }

      // Brand name
      pdf.setFontSize(7); setColor(Q.quiet);
      pdf.text(brandUpper, pageWidth / 2, 100, { align: 'center' });
      if (!platformIssued) {
        pdf.setFontSize(6); setColor(Q.fainter);
        pdf.text('PROPERTY INTELLIGENCE  •  MARKET RESEARCH  •  ADVISORY', pageWidth / 2, 108, { align: 'center' });
      }

      // Metadata card below header
      yPos = 130;
      setFill(cardBg); pdf.roundedRect(margin, yPos, contentWidth, 28, 3, 3, 'F');
      setFill(gold); pdf.rect(margin, yPos, contentWidth, 2, 'F');

      const metaY = yPos + 12;
      pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); setColor(Q.faint);
      pdf.text('GENERATED', margin + 10, metaY - 2);
      if (facts.totalListings !== null) pdf.text('LISTINGS', margin + contentWidth * 0.3, metaY - 2);
      pdf.text('CHARTS', margin + contentWidth * 0.55, metaY - 2);
      if (!platformIssued) pdf.text('PREPARED BY', pageWidth - margin - 10, metaY - 2, { align: 'right' });

      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
      setColor(white);
      pdf.text(format(new Date(report.created_at), 'dd MMM yyyy'), margin + 10, metaY + 5);
      if (facts.totalListings !== null) pdf.text(wholeNumber(facts.totalListings), margin + contentWidth * 0.3, metaY + 5);
      pdf.text(pdfCharts.length.toString(), margin + contentWidth * 0.55, metaY + 5);
      if (!platformIssued) {
        setColor(gold);
        pdf.text(brandName, pageWidth - margin - 10, metaY + 5, { align: 'right' });
      }

      // Confidentiality notice
      yPos += 36;
      pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); setColor(Q.faintest);
      pdf.text('This document contains proprietary market intelligence. Unauthorized distribution is prohibited.', pageWidth / 2, yPos, { align: 'center' });

      // KPI cards on cover page
      yPos += 14;
      const kpiData = [
        facts.totalListings !== null ? { label: 'Total Listings', value: wholeNumber(facts.totalListings), sub: 'Properties analyzed' } : null,
        facts.averagePrice !== null ? { label: 'Average Price', value: dollars(facts.averagePrice), sub: 'Market average' } : null,
        facts.recent30d !== null ? { label: 'Recent (30 days)', value: wholeNumber(facts.recent30d), sub: 'New to market' } : null,
        facts.uniqueSuburbs !== null ? { label: 'Unique Suburbs', value: wholeNumber(facts.uniqueSuburbs), sub: 'Geographic spread' } : null,
      ].filter((kpi): kpi is { label: string; value: string; sub: string } => kpi !== null);
      if (kpiData.length > 0) {
        // The cards share the row between them: four as before, fewer wider.
        const kpiW = (contentWidth - 4 * (kpiData.length - 1)) / kpiData.length;
        const kpiH = 36;
        kpiData.forEach((kpi, i) => {
          drawKPIBox(margin + i * (kpiW + 4), yPos, kpiW, kpiH, kpi.label, kpi.value, kpi.sub);
        });
        yPos += kpiH + 10;
      }

      drawFooter(1);

      // ══════════════════════════════════════
      // PAGE 2 — TABLE OF CONTENTS
      // ══════════════════════════════════════
      addPage('TABLE OF CONTENTS');

      yPos = 22;
      setFill(gold); pdf.rect(margin, yPos, 3.5, 12, 'F');
      pdf.setFontSize(16); pdf.setFont('helvetica', 'bold'); setColor(white);
      pdf.text('Table of Contents', margin + 8, yPos + 8);
      yPos += 4;
      pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
      pdf.text('Report structure and navigation guide', margin + 8, yPos + 12);
      yPos += 20;

      // The measures the report holds, decided before the contents are drawn so
      // the contents list only the sections that follow.
      const green = { r: 16, g: 185, b: 129 };
      const red = { r: 239, g: 68, b: 68 };
      const analyticsRows: { label: string; value: string; detail: string }[] = [];
      if (facts.velocity) {
        const delta = facts.velocity.delta;
        analyticsRows.push({ label: 'Market Velocity', value: facts.velocity.label, detail: delta !== null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}% vs previous 30 days` : '' });
      }
      if (facts.medianPrice !== null) {
        analyticsRows.push({ label: 'Median Price', value: dollars(facts.medianPrice), detail: facts.quartiles?.iqr != null ? `IQR: ${dollars(facts.quartiles.iqr)}` : '' });
      }
      if (facts.averagePrice !== null) {
        analyticsRows.push({ label: 'Average Price', value: dollars(facts.averagePrice), detail: facts.pricedListings !== null ? `${wholeNumber(facts.pricedListings)} priced listings` : '' });
      }
      if (facts.quartiles?.q1 != null) analyticsRows.push({ label: 'Q1 (25th percentile)', value: dollars(facts.quartiles.q1), detail: 'Lower quartile boundary' });
      if (facts.quartiles?.q3 != null) analyticsRows.push({ label: 'Q3 (75th percentile)', value: dollars(facts.quartiles.q3), detail: 'Upper quartile boundary' });
      if (facts.confidence !== null) {
        analyticsRows.push({ label: 'Avg Confidence', value: `${facts.confidence.toFixed(1)}%`, detail: facts.completeness !== null ? `Completeness: ${wholeNumber(facts.completeness)}%` : '' });
      }
      if (facts.coverage?.suburbs != null) {
        analyticsRows.push({ label: 'Market Coverage', value: `${wholeNumber(facts.coverage.suburbs)} suburbs`, detail: facts.coverage.saturation ? `Saturation: ${facts.coverage.saturation}` : '' });
      }
      const dqKpis: { label: string; value: string; sub: string; accent: { r: number; g: number; b: number } }[] = [];
      if (facts.confidence !== null) {
        const c = facts.confidence;
        dqKpis.push({ label: 'Overall Confidence', value: `${c.toFixed(1)}%`, sub: c > 70 ? 'HIGH QUALITY' : c > 50 ? 'MODERATE' : 'NEEDS REVIEW', accent: c > 70 ? green : c > 50 ? gold : red });
      }
      if (facts.completeness !== null) {
        const c = facts.completeness;
        dqKpis.push({ label: 'Field Completeness', value: `${wholeNumber(c)}%`, sub: c > 80 ? 'EXCELLENT' : c > 60 ? 'GOOD' : 'INCOMPLETE', accent: c > 80 ? green : c > 60 ? gold : red });
      }
      if (facts.pricedListings !== null && facts.totalListings) {
        const share = (facts.pricedListings / facts.totalListings) * 100;
        dqKpis.push({ label: 'Listings With a Price', value: `${share.toFixed(0)}%`, sub: `${wholeNumber(facts.pricedListings)} OF ${wholeNumber(facts.totalListings)}`, accent: share > 80 ? green : share > 60 ? gold : red });
      }
      if (facts.totalListings !== null) {
        dqKpis.push({ label: 'Records Analyzed', value: wholeNumber(facts.totalListings), sub: counted(pdfCharts.length, 'visualization', 'visualizations'), accent: gold });
      }
      const hasInsights = Boolean(report.insights && Array.isArray(report.insights) && report.insights.length > 0);

      // The contents are drawn here and numbered once every section has been
      // drawn: each section records the page it starts on (`tocEntries`), which
      // is not known until then — a section shares a page with the one before
      // it, and the charts run two to a page.
      const tocPageRef = currentPage;
      const tocRows: { title: string; y: number }[] = [];

      // The sections that follow, in the order they are drawn and numbered.
      const tocItems = [
        { title: 'Executive Summary', sub: 'Market overview and key performance indicators' },
        ...(analyticsRows.length > 0 ? [{ title: 'Market Analytics', sub: 'Pricing and market measures the report holds' }] : []),
        ...(dqKpis.length > 0 ? [{ title: 'Data Quality Analysis', sub: 'What the listing data covers' }] : []),
        ...(hasInsights ? [{ title: 'Insights & Recommendations', sub: 'Findings recorded with the report' }] : []),
        ...(pdfCharts.length > 0 ? [{ title: 'Data Visualizations', sub: `${pdfCharts.length} ${pdfCharts.length === 1 ? 'chart' : 'charts'} of the report's listings` }] : []),
        ...(facts.topSuburbs.length > 0 ? [{ title: 'Suburb Deep-Dive', sub: 'Top suburbs by listing volume' }] : []),
        { title: 'Disclaimer & Methodology', sub: 'Data sources, limitations, and methodology' },
      ].map((entry, i) => ({ section: `${i + 1}.0`, ...entry }));

      let tocDrawY = yPos;
      tocItems.forEach((entry, i) => {
        // Row background
        setFill(i % 2 === 0 ? cardBg : Q.cardAlt);
        pdf.roundedRect(margin, tocDrawY, contentWidth, 16, 1.5, 1.5, 'F');

        // Section number badge
        setFill(gold);
        pdf.roundedRect(margin + 4, tocDrawY + 3, 12, 10, 1.5, 1.5, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(navy);
        pdf.text(entry.section, margin + 10, tocDrawY + 9.5, { align: 'center' });

        // Title
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); setColor(white);
        pdf.text(entry.title, margin + 22, tocDrawY + 7);

        // Subtitle
        pdf.setFontSize(6.5); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text(entry.sub, margin + 22, tocDrawY + 12.5);

        // Dotted leader + page number
        setDraw(dividerCol); pdf.setLineWidth(0.15);
        const textEndX = margin + 22 + pdf.getTextWidth(entry.title) + 6;
        const pageNumX = pageWidth - margin - 14;
        for (let dx = textEndX; dx < pageNumX; dx += 2.5) {
          pdf.line(dx, tocDrawY + 7, dx + 1, tocDrawY + 7);
        }

        tocRows.push({ title: entry.title, y: tocDrawY + 8 });

        tocDrawY += 18;
      });

      // ══════════════════════════════════════
      // PAGE 3 — EXECUTIVE SUMMARY (Enhanced)
      // ══════════════════════════════════════
      addPage('EXECUTIVE SUMMARY');
      currentSectionNum = 0;
      drawSectionHeader('Executive Summary', 'High-level market overview and key performance indicators');

      // Market snapshot: a sentence for each fact the report holds, and an
      // indicator for each measure it holds — nothing drawn from a default.
      const snapshotSentences = marketSnapshotSentences(facts);
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
      const snapLines: string[] = snapshotSentences.length ? pdf.splitTextToSize(snapshotSentences.join(' '), contentWidth - 22) : [];
      const statusItems: { label: string; value: string; color: { r: number; g: number; b: number } }[] = [];
      if (facts.velocity) {
        const v = facts.velocity.label;
        statusItems.push({ label: 'VELOCITY', value: v, color: v === 'Uptrend' ? green : v === 'Downtrend' ? red : gold });
      }
      if (facts.confidence !== null) {
        const c = facts.confidence;
        statusItems.push({ label: 'DATA QUALITY', value: `${c.toFixed(0)}%`, color: c > 70 ? green : c > 50 ? gold : red });
      }
      if (facts.coverage?.saturation) statusItems.push({ label: 'COVERAGE', value: facts.coverage.saturation, color: gold });
      if (snapLines.length || statusItems.length) {
        const snapLineH = (8 * 1.15 * 25.4) / 72;
        const statusBlock = statusItems.length ? 16 : 0;
        const panelH = 18 + snapLines.length * snapLineH + statusBlock + 4;
        checkPageBreak(panelH + 8);
        setFill(Q.panel); pdf.roundedRect(margin, yPos, contentWidth, panelH, 3, 3, 'F');
        setFill(gold); pdf.rect(margin, yPos, 3.5, panelH, 'F');

        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(gold);
        pdf.text('MARKET SNAPSHOT', margin + 10, yPos + 10);

        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(softWhite);
        if (snapLines.length) pdf.text(snapLines, margin + 10, yPos + 18);

        if (statusItems.length) {
          const statusY = yPos + 18 + snapLines.length * snapLineH + 6;
          const sW = (contentWidth - 22) / statusItems.length;
          statusItems.forEach((item, i) => {
            const sx = margin + 10 + i * sW;
            pdf.setFontSize(5.5); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
            pdf.text(item.label, sx, statusY);
            pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); setColor(item.color);
            pdf.text(item.value, sx, statusY + 6);
          });
        }
        yPos += panelH + 8;
      }

      // ── Highlight Cards — each line a fact the report holds ──
      const heldLines = (candidates: Array<string | null>) => candidates.filter((line): line is string => line !== null).slice(0, 3);
      const highlights = [
        {
          title: 'Price Insights', accent: gold,
          lines: heldLines([
            facts.medianPrice !== null ? `Median: ${dollars(facts.medianPrice)}` : null,
            facts.averagePrice !== null ? `Average: ${dollars(facts.averagePrice)}` : null,
            facts.quartiles?.iqr != null ? `IQR: ${dollars(facts.quartiles.iqr)}` : null,
            facts.pricedListings !== null && facts.totalListings ? `${wholeNumber(facts.pricedListings)} of ${wholeNumber(facts.totalListings)} priced` : null,
          ]),
        },
        {
          title: 'Market Activity', accent: green,
          lines: heldLines([
            facts.recent30d !== null ? `${wholeNumber(facts.recent30d)} new (30d)` : null,
            facts.totalListings !== null ? `${wholeNumber(facts.totalListings)} total` : null,
            facts.uniqueSuburbs !== null ? `${wholeNumber(facts.uniqueSuburbs)} suburbs` : null,
          ]),
        },
        {
          title: 'Data Integrity', accent: { r: 59, g: 130, b: 246 },
          lines: heldLines([
            facts.confidence !== null ? `${facts.confidence.toFixed(1)}% confidence` : null,
            facts.completeness !== null ? `${wholeNumber(facts.completeness)}% completeness` : null,
            pdfCharts.length > 0 ? `${counted(pdfCharts.length, 'chart', 'charts')} drawn` : null,
          ]),
        },
      ].filter((hl) => hl.lines.length > 0);

      if (highlights.length > 0) {
        checkPageBreak(44);
        const hlW = (contentWidth - 4 * (highlights.length - 1)) / highlights.length;
        const hlH = 38;
        highlights.forEach((hl, i) => {
          const hx = margin + i * (hlW + 4);
          setFill(cardBg); pdf.roundedRect(hx, yPos, hlW, hlH, 2.5, 2.5, 'F');
          setFill(hl.accent); pdf.rect(hx, yPos, hlW, 2, 'F');

          // The title alone: the glyph that led it is not in the standard
          // Helvetica encoding and printed as "%²", "%É" and "%Æ".
          pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(hl.accent);
          pdf.text(hl.title, hx + 6, yPos + 10);

          pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal');
          hl.lines.forEach((line, j) => {
            setColor(j < 2 ? softWhite : mutedText);
            pdf.text(line, hx + 6, yPos + 18 + j * 6);
          });
        });
        yPos += hlH + 10;
      }

      // ── Market Analytics — the measures the report holds, drawn only when it holds one ──
      if (analyticsRows.length > 0) {
        drawSectionHeader('Market Analytics', 'Pricing and market measures the report holds');
        const rowH = 11;
        checkPageBreak(analyticsRows.length * rowH + 14);

        setFill(navy); pdf.roundedRect(margin, yPos, contentWidth, 10, 2, 2, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(lightGold);
        pdf.text('METRIC', margin + 8, yPos + 6.5);
        pdf.text('VALUE', margin + contentWidth / 2, yPos + 6.5, { align: 'center' });
        pdf.text('DETAILS', pageWidth - margin - 8, yPos + 6.5, { align: 'right' });
        yPos += 10;

        analyticsRows.forEach((row, i) => {
          setFill(i % 2 === 0 ? cardBg : Q.cardAlt);
          pdf.rect(margin, yPos, contentWidth, rowH, 'F');
          drawAnalyticsRow(row.label, row.value, row.detail, yPos + 7);
          yPos += rowH;
        });
        yPos += 10;
      }

      // ══════════════════════════════════════
      // DATA QUALITY ANALYSIS PAGE
      // ══════════════════════════════════════
      // What the report measured about its own data, and nothing else: the
      // field-coverage table and the confidence distribution this page used to
      // draw were fixed shares of the listing count, not measurements.
      if (dqKpis.length > 0) {
        // Beneath the analytics where the page has room for it: two or three
        // cards used to take a page of their own.
        checkPageBreak(24 + 34 + 12, 'DATA QUALITY');
        drawSectionHeader('Data Quality Analysis', 'What the listing data covers');

        checkPageBreak(40);
        const dqCount = Math.min(dqKpis.length, 4);
        const dqW = (contentWidth - 4 * (dqCount - 1)) / dqCount;
        const dqH = 34;
        dqKpis.slice(0, dqCount).forEach((kpi, i) => {
          const kx = margin + i * (dqW + 4);
          setFill(cardBg); pdf.roundedRect(kx, yPos, dqW, dqH, 2.5, 2.5, 'F');
          setFill(kpi.accent); pdf.rect(kx, yPos, dqW, 2, 'F');
          pdf.setFontSize(16); pdf.setFont('helvetica', 'bold'); setColor(kpi.accent);
          pdf.text(kpi.value, kx + dqW / 2, yPos + 14, { align: 'center' });
          pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
          pdf.text(kpi.label, kx + dqW / 2, yPos + 22, { align: 'center' });
          pdf.setFontSize(5.5); pdf.setFont('helvetica', 'bold'); setColor(kpi.accent);
          pdf.text(kpi.sub, kx + dqW / 2, yPos + 28, { align: 'center' });
        });
        yPos += dqH + 12;
      }

      // ══════════════════════════════════════
      // INSIGHTS PAGE
      // ══════════════════════════════════════
      if (report.insights && Array.isArray(report.insights) && report.insights.length > 0) {
        addPage('INSIGHTS & RECOMMENDATIONS');
        drawSectionHeader('Insights & Recommendations', 'Findings recorded with the report');
        yPos += 2;

        const highPriority = report.insights.filter((i: any) => typeof i === 'object' ? i.priority === 'high' : false);
        const warnings = report.insights.filter((i: any) => typeof i === 'object' ? i.category === 'warning' : false);
        const positives = report.insights.filter((i: any) => typeof i === 'object' ? i.category === 'positive' : false);
        const allInsights = report.insights;

        // Summary stats bar
        checkPageBreak(14, 'INSIGHTS');
        setFill(cardBg); pdf.roundedRect(margin, yPos, contentWidth, 12, 2, 2, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text(counted(allInsights.length, 'Finding', 'Findings'), margin + 8, yPos + 7.5);
        if (highPriority.length > 0) { setColor({ r: 239, g: 68, b: 68 }); pdf.text(`${highPriority.length} High Priority`, margin + contentWidth * 0.3, yPos + 7.5); }
        if (positives.length > 0) { setColor({ r: 16, g: 185, b: 129 }); pdf.text(`${positives.length} Positive`, margin + contentWidth * 0.55, yPos + 7.5); }
        if (warnings.length > 0) { setColor({ r: 245, g: 158, b: 11 }); pdf.text(counted(warnings.length, 'Warning', 'Warnings'), margin + contentWidth * 0.75, yPos + 7.5); }
        yPos += 16;

        // Key Findings box
        const summaryH = Math.min(allInsights.length * 10 + 16, 100);
        checkPageBreak(summaryH, 'INSIGHTS');
        setFill(Q.panel); pdf.roundedRect(margin, yPos, contentWidth, summaryH, 2, 2, 'F');
        setFill(gold); pdf.rect(margin, yPos, 3.5, summaryH, 'F');

        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(gold);
        pdf.text('KEY FINDINGS', margin + 10, yPos + 9);
        yPos += 14;

        allInsights.slice(0, 8).forEach((insight: any) => {
          checkPageBreak(12, 'INSIGHTS');
          const text = typeof insight === 'string' ? insight : (insight.text || '');
          const category = typeof insight === 'object' ? insight.category : 'info';
          const priority = typeof insight === 'object' ? insight.priority : 'medium';

          const dotColor = priority === 'high' ? { r: 239, g: 68, b: 68 } :
                          category === 'positive' ? { r: 16, g: 185, b: 129 } :
                          { r: 245, g: 158, b: 11 };
          setFill(dotColor); pdf.circle(margin + 14, yPos - 1.5, 1.5, 'F');

          pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(softWhite);
          const lines = pdf.splitTextToSize(text, contentWidth - 28);
          pdf.text(lines, margin + 20, yPos);
          yPos += lines.length * 4.5 + 4;
        });
        yPos += 8;

        // The high-priority findings and the warnings, again, numbered. They
        // are the report's findings, so they are not headed as actions.
        if (highPriority.length > 0 || warnings.length > 0) {
          drawSectionHeader('Priority Findings', undefined, false);
          // A high-priority warning is one finding, and is listed once.
          const actionItems = [...highPriority, ...warnings]
            .filter((item, at, all) => all.indexOf(item) === at)
            .slice(0, 5);
          actionItems.forEach((item: any, idx) => {
            const text = typeof item === 'string' ? item : (item.text || '');
            // Every line of the finding, and a row as tall as they are: only
            // the first line used to be printed.
            pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
            const aLines: string[] = pdf.splitTextToSize(text, contentWidth - 24);
            const rowH = Math.max(14, 6 + aLines.length * lineStep(8) + 3);
            checkPageBreak(rowH + 4, 'INSIGHTS');
            setFill(cardBg); pdf.roundedRect(margin, yPos, contentWidth, rowH, 2, 2, 'F');
            setFill(gold); pdf.circle(margin + 8, yPos + 7, 4, 'F');
            pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(navy);
            pdf.text((idx + 1).toString(), margin + 8, yPos + 8.5, { align: 'center' });
            pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(softWhite);
            pdf.text(aLines, margin + 16, yPos + 8);
            yPos += rowH + 4;
          });
        }
      }

      // ══════════════════════════════════════
      // CHART PAGES — 2 charts per page
      // ══════════════════════════════════════
      if (pdfCharts.length > 0) {
        for (let i = 0; i < pdfCharts.length; i++) {
          const { chart, image, points } = pdfCharts[i];

          if (i % 2 === 0) {
            addPage('DATA VISUALIZATIONS');
            if (i === 0) {
              const chartCount = `${pdfCharts.length} ${pdfCharts.length === 1 ? 'chart' : 'charts'}`;
              drawSectionHeader('Data Visualizations', facts.totalListings !== null ? `${chartCount} drawn from ${wholeNumber(facts.totalListings)} listings` : chartCount);
            }
          }

          checkPageBreak(100, 'DATA VISUALIZATIONS');
          // Chart number badge + title
          setFill(gold); pdf.roundedRect(margin, yPos, 8, 8, 1.5, 1.5, 'F');
          pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); setColor(navy);
          pdf.text(`${i + 1}`, margin + 4, yPos + 5.5, { align: 'center' });

          pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); setColor(white);
          pdf.text(chart.title, margin + 12, yPos + 6);

          pdf.setFontSize(6); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
          const typeBadge = chart.chart_type === 'bar' ? 'BAR CHART' : chart.chart_type === 'line' ? 'LINE CHART' : chart.chart_type === 'pie' ? 'PIE / DONUT' : 'CHART';
          pdf.text(typeBadge, pageWidth - margin - 4, yPos + 6, { align: 'right' });
          yPos += 12;

          const chartH = 65;
          let chartRendered = false;

          if (image) {
            try {
              checkPageBreak(chartH + 8, 'DATA VISUALIZATIONS');
              setFill(white); pdf.roundedRect(margin, yPos - 1, contentWidth, chartH + 2, 2, 2, 'F');
              pdf.addImage(image, 'PNG', margin + 2, yPos, contentWidth - 4, chartH);
              yPos += chartH + 4;
              chartRendered = true;
            } catch (e) { console.warn(`Image render failed for ${chart.title}`, e); }
          }

          // Drawn from the data the report page draws the same chart from —
          // never from figures made up to fill the frame.
          if (!chartRendered && points) {
            checkPageBreak(chartH + 8, 'DATA VISUALIZATIONS');
            if (chart.chart_type === 'line') { drawLineChart(margin, yPos, contentWidth, chartH, points, chart.title); }
            else if (chart.chart_type === 'pie') { drawPieChart(margin, yPos, contentWidth, chartH, points, chart.title); }
            else { drawBarChart(margin, yPos, contentWidth, chartH, points, chart.title); }
            yPos += chartH + 4;
          }

          // Analysis panel — measured in the type it is set in, and as tall as
          // its text. The lines were split at the chart labels' 4.5pt and set
          // at 7.5pt, so a finding ran past the panel and off the page; and
          // an eighth line was dropped without a word.
          if (chartAnalysis[chart.id]) {
            pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal');
            const analysisLines: string[] = pdf.splitTextToSize(chartAnalysis[chart.id], contentWidth - 16);
            const panelH = 12 + analysisLines.length * lineStep(7.5) + 2;
            checkPageBreak(panelH + 8, 'DATA VISUALIZATIONS');
            setFill(Q.panel); pdf.roundedRect(margin, yPos, contentWidth, panelH, 2, 2, 'F');
            setFill(gold); pdf.rect(margin, yPos, 3, panelH, 'F');
            pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(gold);
            pdf.text('WHAT THIS MEANS', margin + 8, yPos + 7);
            pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal'); setColor(softWhite);
            pdf.text(analysisLines, margin + 8, yPos + 12);
            yPos += panelH + 8;
          } else {
            yPos += 6;
          }
        }
      }

      // ══════════════════════════════════════
      // SUBURB DEEP-DIVE TABLE
      // ══════════════════════════════════════
      // The suburbs the pipeline itself counted, most listings first. It holds
      // no price per suburb, so none is printed; this table used to be ten
      // fixed Perth suburbs at invented shares and prices, whatever the market.
      if (facts.topSuburbs.length > 0) {
        // Beneath the last chart where the page has room for the whole table.
        checkPageBreak(24 + 10 + facts.topSuburbs.length * 10 + 16, 'SUBURB ANALYSIS');
        drawSectionHeader('Suburb Deep-Dive', 'Top suburbs by listing volume');

        const allListings = facts.totalListings ?? facts.topSuburbs.reduce((sum, row) => sum + row.listings, 0);
        const colWidths = [contentWidth * 0.5, contentWidth * 0.25, contentWidth * 0.25];

        setFill(navy); pdf.roundedRect(margin, yPos, contentWidth, 10, 2, 2, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(lightGold);
        let cx = margin + 6;
        ['SUBURB', 'LISTINGS', 'SHARE OF LISTINGS'].forEach((h, i) => {
          pdf.text(h, cx, yPos + 6.5);
          cx += colWidths[i];
        });
        yPos += 10;

        facts.topSuburbs.forEach((row, i) => {
          checkPageBreak(11, 'SUBURB ANALYSIS');
          setFill(i % 2 === 0 ? cardBg : Q.cardAlt);
          pdf.rect(margin, yPos, contentWidth, 10, 'F');

          let rx = margin + 6;
          pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); setColor(white);
          pdf.text(row.suburb, rx, yPos + 6.5); rx += colWidths[0];

          setColor(gold); pdf.setFont('helvetica', 'bold');
          pdf.text(wholeNumber(row.listings), rx, yPos + 6.5); rx += colWidths[1];

          setColor(mutedText); pdf.setFont('helvetica', 'normal');
          pdf.text(allListings > 0 ? `${((row.listings / allListings) * 100).toFixed(1)}%` : '', rx, yPos + 6.5);

          yPos += 10;
        });

        // All listings, which the top suburbs are a share of
        yPos += 2;
        setFill(navy); pdf.roundedRect(margin, yPos, contentWidth, 10, 1.5, 1.5, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(gold);
        let sx = margin + 6;
        pdf.text('ALL LISTINGS', sx, yPos + 6.5); sx += colWidths[0];
        pdf.text(wholeNumber(allListings), sx, yPos + 6.5); sx += colWidths[1];
        pdf.text('100%', sx, yPos + 6.5);
        yPos += 16;
      }

      // ══════════════════════════════════════
      // FINAL PAGE — DISCLAIMER & METHODOLOGY
      // ══════════════════════════════════════
      addPage('DISCLAIMER & METHODOLOGY');
      drawSectionHeader('Disclaimer & Methodology');

      // What the report did, and nothing it did not: the listings are the ones
      // selling agents advertised, no listing is scored for confidence here,
      // each chart is drawn from its stored figures, and a quartile is named
      // only where the report holds one. The four items this replaced
      // described sources and methods the report never used.
      const methodItems = [
        { label: 'Listings', desc: 'Property listings as advertised by selling agents, as they stood when the report was generated. Listing details are not independently verified.' },
        { label: 'Analysis Period', desc: `Report covers listings available as of ${format(new Date(report.created_at), 'dd MMMM yyyy')}.` },
        ...(pdfCharts.length > 0
          ? [{ label: 'Charts', desc: `${pdfCharts.length === 1 ? 'The chart is' : `Each of the ${pdfCharts.length} charts is`} drawn from the figures the report stores for it.` }]
          : []),
        ...(facts.pricedListings !== null && (facts.medianPrice !== null || facts.averagePrice !== null)
          ? [{ label: 'Prices', desc: `Price figures are taken over the ${wholeNumber(facts.pricedListings)} listings that carry a price${facts.quartiles ? '; the quartiles are those stored with the report' : ''}.` }]
          : []),
      ];

      // Methodology first, in a panel as tall as what it says: the panel and
      // the disclaimer box below it were drawn at fixed heights before their
      // text was measured.
      pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal');
      const methodRows = methodItems.map((item) => ({ ...item, lines: pdf.splitTextToSize(item.desc, contentWidth - 60) as string[] }));
      const methodRowH = (lines: number) => lines * lineStep(7.5) + 3.5;
      const methodH = 12 + methodRows.reduce((sum, row) => sum + methodRowH(row.lines.length), 0) + 3;
      checkPageBreak(methodH + 8);
      setFill(Q.panel); pdf.roundedRect(margin, yPos, contentWidth, methodH, 2, 2, 'F');
      setFill(gold); pdf.rect(margin, yPos, 3.5, methodH, 'F');
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(gold);
      pdf.text('METHODOLOGY', margin + 10, yPos + 9);

      let mY = yPos + 16;
      methodRows.forEach((row) => {
        pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold'); setColor(lightGold);
        pdf.text(`${row.label}:`, margin + 10, mY);
        pdf.setFont('helvetica', 'normal'); setColor(softWhite);
        pdf.text(row.lines, margin + 48, mY);
        mY += methodRowH(row.lines.length);
      });
      yPos += methodH + 8;

      // Disclaimer
      const disclaimerScope = facts.totalListings !== null
        ? ` analyzing ${counted(facts.totalListings, 'property listing', 'property listings')}${facts.uniqueSuburbs !== null ? ` across ${counted(facts.uniqueSuburbs, 'suburb', 'suburbs')}` : ''}`
        : '';
      const dataSourceLine = 'Data source: property listings as advertised by selling agents. Listing details are not independently verified, are subject to change and may not reflect current market conditions.';
      const generatedLine = `Report generated on ${format(new Date(report.created_at), 'PPP')}${disclaimerScope}.`;
      const disclaimerText = platformIssued ? [
        ...PLATFORM_DISCLAIMER.split('\n\n').flatMap((paragraph) => [paragraph, '']),
        dataSourceLine,
        '',
        generatedLine,
      ] : [
        `This report has been prepared by ${brandName} for informational purposes only. The figures in it are drawn from property listings as advertised by selling agents.`,
        '',
        `While every effort has been made to ensure accuracy, ${brandName} makes no warranties or representations regarding the completeness, reliability, or suitability of the information for any particular purpose.`,
        '',
        'This report does not constitute financial, legal, or investment advice. Recipients should seek independent professional counsel before making any investment decisions based on the contents of this report.',
        '',
        dataSourceLine,
        '',
        generatedLine,
        '',
        `© ${brandName}. All rights reserved. Unauthorized distribution prohibited.`
      ];
      pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
      const disclaimerBlocks = disclaimerText.map((line) => (line === '' ? null : pdf.splitTextToSize(line, contentWidth - 16) as string[]));
      const disclaimerBody = disclaimerBlocks.reduce((sum, block) => sum + (block ? block.length * 3.5 + 2 : 3), 0);
      // The text, the rule and the closing lockup beneath it, and the box's padding.
      const disclaimerH = 10 + disclaimerBody + 6 + 6 + 5 + 7;
      checkPageBreak(disclaimerH + 4);

      setFill(cardBg);
      pdf.roundedRect(margin, yPos, contentWidth, disclaimerH, 2, 2, 'F');
      setFill(navy); pdf.rect(margin, yPos, contentWidth, 1.5, 'F');

      let dY = yPos + 10;
      disclaimerBlocks.forEach((block) => {
        if (!block) { dY += 3; return; }
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text(block, margin + 8, dY);
        dY += block.length * 3.5 + 2;
      });

      // Final branding watermark
      dY += 6;
      setDraw(gold); pdf.setLineWidth(0.3);
      pdf.line(margin + 20, dY, pageWidth - margin - 20, dY);
      dY += 6;
      pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); setColor(gold);
      pdf.text(brandUpper, pageWidth / 2, dY, { align: 'center' });
      if (!platformIssued) {
        pdf.setFontSize(5.5); pdf.setFont('helvetica', 'normal'); setColor(mutedText);
        pdf.text('Property Intelligence  •  Market Research  •  Strategic Advisory', pageWidth / 2, dY + 5, { align: 'center' });
      }

      // The contents' page numbers: the page each section was drawn on.
      pdf.setPage(tocPageRef);
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); setColor(gold);
      tocRows.forEach((row) => {
        const drawn = tocEntries.find((entry) => entry.title === row.title);
        if (drawn) pdf.text(`${drawn.page}`, pageWidth - margin - 6, row.y, { align: 'right' });
      });

      // ── Save ──
      const fileName = `${report.title.replace(/[^a-zA-Z0-9]/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      if (options?.returnBlob) {
        return pdf.output('blob');
      }
      pdf.save(fileName);

      toast({
        title: "PDF Downloaded",
        description: `Premium report saved as ${fileName}`,
      });
    } catch (error) {
      console.error('Error generating PDF, attempting stored fallback:', error);
      try {
        const fallback = await downloadStoredFallback();
        if (fallback && options?.returnBlob) return fallback;
        if (fallback) return;
      } catch (fallbackErr) {
        console.error('Stored PDF fallback also failed:', fallbackErr);
      }
      toast({
        title: "Download failed",
        description: "Could not generate PDF download",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }

  };

  // After the two functions they call, which are declared above.
  useEffect(() => {
    if (reportId) {
      fetchReport();
      // Log report viewed
      logActivityDirect({
        actionType: 'report_viewed',
        entityType: 'investment_report',
        entityId: reportId,
        metadata: { source: 'report_viewer' }
      });
    }
  }, [reportId]);

  useEffect(() => {
    if (shouldAutoDownload && report && (report.pdf_path || charts.length > 0)) {
      handleDownloadPDF();
    }
  }, [shouldAutoDownload, report, charts]);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/2"></div>
          <div className="h-4 bg-muted rounded w-1/4"></div>
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="text-center py-8">
          <h2 className="text-2xl font-bold">Report not found</h2>
          <p className="text-muted-foreground mt-2">The requested report could not be found.</p>
          <Button onClick={() => navigate(reportLibraryPath)} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Reports
          </Button>
        </div>
      </div>
    );
  }

  // What the report holds, read the way the PDF reads it: the pipeline writes
  // `average_price` and no `recent_30d`, so the cards that read `avg_price`
  // and `recent_30d` printed "$N/A" and "N/A" on every report it made. A
  // figure the report does not hold has no card.
  const held = readQuantitativeReportFacts(report, charts);
  const heldWhole = (n: number) => Math.round(n).toLocaleString('en-AU');
  const kpiCards = [
    held.totalListings !== null ? { icon: Building2, value: heldWhole(held.totalListings), label: 'Total Listings' } : null,
    held.averagePrice !== null ? { icon: DollarSign, value: `$${heldWhole(held.averagePrice)}`, label: 'Average Price' } : null,
    held.recent30d !== null ? { icon: TrendingUp, value: heldWhole(held.recent30d), label: 'Recent (30d)' } : null,
    held.uniqueSuburbs !== null ? { icon: MapPin, value: heldWhole(held.uniqueSuburbs), label: 'Unique Suburbs' } : null,
  ].filter((card): card is { icon: typeof Building2; value: string; label: string } => card !== null);
  // An insight is stored as a sentence or, by the generator before the
  // pipeline, as `{ category, priority, text }`; the page prints its words.
  const insightTexts: string[] = Array.isArray(report.insights)
    ? report.insights
      .map((insight: unknown) => (typeof insight === 'string' ? insight
        : insight && typeof insight === 'object' && typeof (insight as { text?: unknown }).text === 'string' ? (insight as { text: string }).text
          : ''))
      .map((text: string) => text.trim())
      .filter((text: string) => text.length > 0)
    : [];

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => navigate(reportLibraryPath)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{report.title}</h1>
            {report.description && (
              <p className="text-muted-foreground mt-1">{report.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => { void handleDownloadPDF(); }}
            disabled={downloading}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {downloading ? 'Generating...' : 'Download PDF'}
          </Button>
          <FlattenPdfIconButton
            getPdfBlob={async () => {
              const blob = await handleDownloadPDF({ returnBlob: true });
              if (!(blob instanceof Blob)) throw new Error('Failed to generate PDF');
              return blob;
            }}
            filename={report ? `${report.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf` : 'report.pdf'}
            disabled={downloading}
          />
        </div>
      </div>

      {/* Report Content */}
      <div ref={reportRef} className="space-y-6">
        {/* IMR helper: numbered section chip */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {(() => null)()}

        {/* ── 1.0 Executive Summary ── */}
        {insightTexts.length > 0 && (
          <Card className="border-brand-300/30">
            <CardHeader>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">1.0 · Executive Summary</div>
              <CardTitle>Key Findings at a Glance</CardTitle>
              <CardDescription>Top-line takeaways derived from the underlying dataset.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {insightTexts.slice(0, 3).map((insight, index) => (
                  <li key={`exec-${index}`} className="flex items-start gap-2">
                    <span className="text-brand-500 mt-1">◆</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ── 2.0 Portfolio Snapshot (KPIs) ── */}
        {kpiCards.length > 0 && (
          <Card>
            <CardHeader>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">2.0 · Portfolio Snapshot</div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Key Performance Indicators
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiCards.map(({ icon: Icon, value, label }) => (
                <div key={label} className="text-center p-4 bg-muted/50 rounded-lg">
                  <Icon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── 3.0 Market Context ── */}
        {/* The pipeline stores none of these three, so the card is drawn only
            for a report that holds one — it used to be drawn empty. */}
        {(held.velocity || held.confidence !== null || held.coverage?.saturation) && (
          <Card>
            <CardHeader>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">3.0 · Market Context</div>
              <CardTitle>Analytics Summary</CardTitle>
              <CardDescription>Contextual signals that frame the findings below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {held.velocity && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Market Velocity:</span>
                  <Badge variant={held.velocity.label === 'Uptrend' ? 'default' : 'secondary'}>
                    {held.velocity.label}
                  </Badge>
                </div>
              )}
              {held.confidence !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Average Data Confidence:</span>
                  <span className="font-medium">{held.confidence.toFixed(1)}%</span>
                </div>
              )}
              {held.coverage?.saturation && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Market Saturation:</span>
                  <Badge variant="outline">{held.coverage.saturation}</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 4.0 Findings — Interactive Data Visualisations ── */}
        {charts.length > 0 && (
          <Card>
            <CardHeader>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">4.0 · Findings</div>
              <CardTitle>Interactive Data Visualisations</CardTitle>
              <CardDescription>Hover for series values · click a chart to expand with zoom &amp; fullscreen controls.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                {charts.map((chart) => (
                  <div key={chart.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-medium">{chart.title}</h4>
                      {canNormaliseChartConfig(chart as any) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setExpandedChart(chart as any)}
                          aria-label={`Expand ${chart.title}`}
                        >
                          <Maximize2 className="h-3.5 w-3.5 mr-1" />
                          Expand
                        </Button>
                      )}
                    </div>
                    <div
                      className={`rounded-lg border ${canNormaliseChartConfig(chart as any) ? 'bg-card p-2' : 'bg-white p-4'}`}
                    >
                      <div className={`w-full ${canNormaliseChartConfig(chart as any) ? 'h-[22rem]' : 'h-64 overflow-hidden flex items-center justify-center'}`}>
                        {canNormaliseChartConfig(chart as any) ? (
                          <LiveChart chart={chart as any} variant="expanded" />
                        ) : chart.image_data?.startsWith('data:image/svg+xml;base64,') ? (
                          <img
                            src={chart.image_data}
                            alt={`${chart.title} chart`}
                            className="w-full h-full object-contain"
                          />
                        ) : chart.image_data ? (
                          <img
                            src={chart.image_data}
                            alt={`${chart.title} chart`}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground">No chart preview available</div>
                        )}
                      </div>
                      {chartAnalysis[chart.id] && (
                        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                          <p className="text-sm text-muted-foreground italic">
                            {chartAnalysis[chart.id]}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── 5.0 Risks, Watchlist & Recommendations ── */}
        {insightTexts.length > 3 && (
          <Card>
            <CardHeader>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">5.0 · Risks &amp; Recommendations</div>
              <CardTitle>Watchlist and Suggested Next Steps</CardTitle>
              <CardDescription>Additional insights split into cautionary signals and forward actions.</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const rest = insightTexts.slice(3);
                const riskKeywords = /(risk|decline|drop|caution|watch|volatil|slow|soften|warning|overheat|correction)/i;
                const risks = rest.filter(i => riskKeywords.test(i));
                const recs = rest.filter(i => !riskKeywords.test(i));
                return (
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-semibold text-warning mb-2">Risks &amp; Watchlist</h4>
                      {risks.length > 0 ? (
                        <ul className="space-y-2">
                          {risks.map((insight, idx) => (
                            <li key={`risk-${idx}`} className="flex items-start gap-2 text-sm">
                              <span className="text-warning mt-1">▲</span>
                              <span>{insight}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No risk signals detected in this dataset.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-success mb-2">Recommendations</h4>
                      {recs.length > 0 ? (
                        <ul className="space-y-2">
                          {recs.map((insight, idx) => (
                            <li key={`rec-${idx}`} className="flex items-start gap-2 text-sm">
                              <span className="text-success mt-1">→</span>
                              <span>{insight}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No additional recommendations.</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* ── 6.0 Appendix — Report Metadata ── */}
        <Card className="bg-muted/30">
          <CardHeader>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-500">6.0 · Appendix</div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Report Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Generated</p>
              <p className="font-medium">{format(new Date(report.created_at), 'PPp')}</p>
            </div>
            {held.totalListings !== null && (
              <div>
                <p className="text-sm text-muted-foreground">Listings Analyzed</p>
                <p className="font-medium">{heldWhole(held.totalListings)}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Charts Generated</p>
              <p className="font-medium">{charts.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant="default">Complete</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interactive chart lightbox (Recharts-based, matches Charts page parity) */}
      <ChartLightbox
        chart={expandedChart as any}
        onClose={() => setExpandedChart(null)}
        onExport={() => { /* export handled from Charts page; noop here to keep viewer read-only */ }}
      />
    </div>
  );
}

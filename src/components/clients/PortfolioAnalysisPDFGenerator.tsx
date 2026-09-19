import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, Download, TrendingUp, AlertTriangle, CheckCircle, Landmark, Shield, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { logReportRenderEvent } from '@/lib/reports/renderEvent';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useNotifications } from '@/contexts/NotificationsContext';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
import { getBrandPdfRgb } from '@/branding/brandPalette';
import { useBrand } from '@/branding/BrandProvider';
import fontkit from '@pdf-lib/fontkit';
import { fetchGlobalReportSettings, type GlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawPdfLibDisclaimerPage } from '@/utils/pdfDisclaimerPage';
import { drawBorrowingCapacityPdfLib, transformEdgeFunctionBCData } from '@/utils/borrowingCapacityPdfLibSections';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ReportGenerationStatus } from '@/components/billing/ReportGenerationStatus';
import { TokenCostEstimate } from '@/components/billing/TokenCostEstimate';
import { estimateTokens } from '@/lib/missionControl';
import { resolveReportDisclaimer, resolveReportIssuer } from '@/lib/reports/issuerIdentity.pure';

interface BorrowingCapacityAssessment {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: string;
  dtiRatio: number;
  stressTestedCapacity: number;
  assessmentRate: number;
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  livingExpenses: number;
  existingCommitments: number;
  recommendations: string[];
  warnings: string[];
  calculatedAt: string;
}

interface PortfolioAnalysisData {
  clientId: string;
  clientName: string;
  portfolioMetrics: {
    totalProperties: number;
    investmentCount: number;
    ownerOccupiedCount: number;
    smsfCount: number;
    totalValue: number;
    totalDebt: number;
    totalEquity: number;
    averageLVR: number;
    totalMonthlyRentalIncome: number;
    totalMonthlyExpenses: number;
    netMonthlyCashflow: number;
    averageYield: number;
    smsfTotalValue: number;
    smsfTotalEquity: number;
    smsfCompliantCount: number;
    smsfPendingAuditCount: number;
    smsfNonCompliantCount: number;
  };
  propertyAnalyses: Array<{
    propertyNumber: number;
    address: string;
    propertyType: string;
    value: number;
    equity: number;
    lvr: string;
    grossYield: string;
    netMonthlyCashflow: number;
    portfolioContribution: string;
  }>;
  analysis: {
    personalizedNarrative?: {
      openingStatement: string;
      portfolioJourney: string;
    };
    executiveSummary: {
      overallHealth: string;
      healthScore: number;
      keyStrengths: string[];
      keyConcerns: string[];
      primaryRecommendation: string;
    };
    compositionAnalysis: {
      assetAllocation: string;
      diversificationScore: number;
      propertyMixAssessment: string;
      recommendations: string[];
    };
    propertyStrategicContext?: Array<{
      address: string;
      strategicRole: string;
      capitalGrowthAnalysis: string;
      individualOutlook: string;
    }>;
    financialHealth: {
      cashflowStatus: string;
      equityPosition: string;
      debtServiceability: string;
      lvrRisk: string;
      analysis: string;
    };
    propertyRankings: Array<{
      rank: number;
      address: string;
      performanceRating: string;
      strengths: string[];
      concerns: string[];
      recommendation: string;
    }>;
    riskAssessment: {
      overallRiskLevel: string;
      concentrationRisk: string;
      interestRateSensitivity: string;
      vacancyRisk: string;
      marketRisks: string[];
      mitigationStrategies: string[];
    };
    // Every figure here is now produced by the deterministic facts helper on
    // the server, never by the model. `null` means the loan record could not
    // support the calculation — a historical row simply has no `available`
    // flag and its stored numbers render exactly as they did.
    interestRateSensitivity?: {
      investmentProperties?: {
        currentMonthlyCashflow: number | null;
        plusOnePercentImpact: number | null;
        plusTwoPercentImpact: number | null;
        available?: boolean;
        unavailableReason?: string | null;
        unavailableExplanation?: string | null;
        loansCovered?: number;
        balanceCovered?: number;
        commentary: string;
      };
      ownerOccupiedProperties?: {
        currentMonthlyRepayment: number | null;
        plusOnePercentImpact: number | null;
        plusTwoPercentImpact: number | null;
        available?: boolean;
        unavailableReason?: string | null;
        unavailableExplanation?: string | null;
        loansCovered?: number;
        balanceCovered?: number;
        commentary: string;
      };
      combinedCommentary: string;
    };
    marketConditions?: {
      marketCycleSummary: string;
      rbaOutlook: string;
      lendingEnvironment?: string;
      clientPositioning: string;
    };
    growthOpportunities: {
      equityReleaseOptions: string[];
      refinancingOpportunities: string[];
      nextPurchaseRecommendations: string[];
      optimizationStrategies: string[];
    };
    projections: {
      years: number;
      projectedPortfolioValue: number | null;
      projectedDebt?: number | null;
      projectedEquity: number | null;
      // Never projected: no rent or expense growth rate is recorded for a
      // portfolio, and capital growth is not rental growth.
      projectedMonthlyCashflow: number | null;
      assumptions: string[];
      plainEnglishSummary?: string;
    };
    actionPlan?: {
      twelveMonthActions: string[];
      optimisationScenarios: string[];
    };
    // Computed on the server from the borrowing-capacity assessment, never by
    // the model. The whole block is null when no assessment is on record, and
    // `utilisationPercentage` is null when the assessment records no positive
    // capacity — a ratio with a zero denominator is absent, not zero.
    borrowingCapacityUtilisation?: {
      totalDebtDeployed: number;
      estimatedCapacity: number;
      availableCapacity: number;
      utilisationPercentage: number | null;
      commentary: string;
    } | null;
    strategicRecommendations: {
      shortTerm: string[];
      mediumTerm: string[];
      longTerm: string[];
      priorityActions: string[];
    };
  };
  borrowingCapacity: BorrowingCapacityAssessment | null;
  generatedAt: string;
}

interface PortfolioAnalysisSettings {
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive' | null;
  investmentStrategy?: 'capital_growth' | 'cash_flow' | 'balanced' | 'wealth_accumulation' | null;
  timeHorizon?: 'short' | 'medium' | 'long' | 'multi_generational' | null;
  projectionPeriod?: 5 | 10 | 15 | 20 | null;
  growthRateAssumption?: 'conservative' | 'moderate' | 'optimistic' | null;
  interestRateScenario?: 'current' | 'plus_1' | 'plus_2' | null;
  equityStrategy?: 'aggressive' | 'conservative' | 'moderate' | null;
  debtReductionPriority?: 'aggressive' | 'interest_only' | 'balanced' | null;
  nextPropertyPreference?: 'growth' | 'yield' | 'regional' | 'metro' | 'none' | null;
  taxOptimizationPriority?: 'high' | 'medium' | 'low' | null;
  retirementTimeline?: number | null;
  marketOutlook?: 'bullish' | 'neutral' | 'bearish' | null;
}

interface PortfolioAnalysisPDFGeneratorProps {
  clientId: string;
  clientName: string;
  includeBorrowingCapacity?: boolean;
  includeOwnerOccupied?: boolean;
  analysisConfig?: PortfolioAnalysisSettings;
  customInstructions?: string;
  onComplete?: () => void;
}

// ============= PDF CONSTANTS =============
const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
// Standard A4 margins: 1 inch (72pt) on all sides for professional documents
const MARGIN_LEFT = 72;
const MARGIN_RIGHT = 72;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// Section spacing constants for consistent layout
const SECTION_SPACING = 35;        // Space after major sections
const SUBSECTION_SPACING = 24;     // Space after subsections
const PARAGRAPH_SPACING = 18;      // Space between paragraphs
const LIST_ITEM_SPACING = 8;       // Extra space between list items
const BOX_PADDING = 10;            // Padding inside boxes

// Brand colors — gold ramp centralised on the shared brand palette
// (src/branding/brandPalette.ts) as pdf-lib rgb triplets. Re-resolved from the
// active White-Label brand colour before each generation by applyBrandRgb().
// PDF generation is sequential (user-triggered), so mutating these module
// singletons is safe.
let NPC_RGB = getBrandPdfRgb();
let NPC_GOLD = rgb(...NPC_RGB.gold);            // Primary brand gold
let NPC_GOLD_LIGHT = rgb(...NPC_RGB.goldLight); // Light gold for accents
let NPC_GOLD_DARK = rgb(...NPC_RGB.goldDark);   // Dark gold
let NPC_GOLD_TINT = rgb(...NPC_RGB.goldTint);   // Very light gold tint

const NPC_NAVY = rgb(0.05, 0.15, 0.30);        // #0d264d - Dark navy
const NPC_DARK_BLUE = rgb(0.07, 0.20, 0.38);   // #113361 - Dark blue
const NPC_BLACK = rgb(0.04, 0.04, 0.04);       // #0a0a0a - Near black
const NPC_WHITE = rgb(1, 1, 1);                 // White

// Semantic Colors
let PRIMARY_COLOR = NPC_GOLD;
const SECONDARY_COLOR = NPC_NAVY;
const MUTED_COLOR = rgb(0.5, 0.5, 0.5);
const SUCCESS_COLOR = rgb(0.09, 0.64, 0.29);   // #16a34a
const DANGER_COLOR = rgb(0.94, 0.27, 0.27);    // #ef4444
const WARNING_COLOR = rgb(0.96, 0.62, 0.04);   // #f59e0b
const HEADER_BG_COLOR = NPC_NAVY;
const HEADER_TEXT_COLOR = NPC_WHITE;
let ACCENT_COLOR = NPC_GOLD_LIGHT;

function applyBrandRgb(brandColorHsl?: string | null) {
  NPC_RGB = getBrandPdfRgb(brandColorHsl);
  NPC_GOLD = rgb(...NPC_RGB.gold);
  NPC_GOLD_LIGHT = rgb(...NPC_RGB.goldLight);
  NPC_GOLD_DARK = rgb(...NPC_RGB.goldDark);
  NPC_GOLD_TINT = rgb(...NPC_RGB.goldTint);
  PRIMARY_COLOR = NPC_GOLD;
  ACCENT_COLOR = NPC_GOLD_LIGHT;
}

// ============= PHASE 6: SAFE FORMATTING UTILITIES =============
const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined || isNaN(value)) return '$0';
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  // Format negative values as -$X,XXX instead of $-X,XXX
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
};

const formatPercentage = (value: number | null | undefined, decimals: number = 1): string => {
  if (value === null || value === undefined || isNaN(value)) return '0%';
  return `${value.toFixed(decimals)}%`;
};

const safeString = (value: string | null | undefined, fallback: string = ''): string => {
  return value?.trim() || fallback;
};

const safeNumber = (value: number | null | undefined, fallback: number = 0): number => {
  if (value === null || value === undefined || isNaN(value)) return fallback;
  return value;
};

/**
 * A monthly figure, or the honest absence of one.
 *
 * `formatCurrency(null)` returns `'$0'`, which is right for a total that is
 * genuinely nil and wrong for a figure the record could not establish. A rate
 * shock of `$0/mo` reads as "rates rising costs you nothing" — the opposite of
 * what an absent figure means. Deterministic Portfolio facts now return null
 * where the loan data cannot support a calculation (see
 * `_shared/reports/portfolio/deterministicFacts.pure.ts`), so this is the
 * boundary that keeps that honest on the page.
 */
const monthlyFigureOrUnavailable = (value: number | null | undefined): string =>
  value === null || value === undefined || isNaN(value) ? 'Not available' : `${formatCurrency(value)}/mo`;

const safeArray = <T,>(arr: T[] | null | undefined): T[] => {
  return Array.isArray(arr) ? arr : [];
};

const getHealthColor = (health: string | null | undefined): string => {
  switch (safeString(health).toLowerCase()) {
    case 'excellent': return 'text-success';
    case 'good': return 'text-info';
    case 'fair': return 'text-warning';
    case 'poor': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
};

const getRiskBadgeVariant = (risk: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (safeString(risk).toLowerCase()) {
    case 'low': return 'default';
    case 'medium': return 'secondary';
    case 'high': return 'destructive';
    default: return 'outline';
  }
};

// Strip emojis, control characters, and non-WinAnsi characters
const stripEmojis = (text: string): string => {
  if (!text) return '';
  return text
    // Decode HTML entities first
    .replace(/&#x26;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Remove control characters (newlines, tabs, etc.) - replace with space
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[\u200D]/gu, '')
    // Remove any remaining non-WinAnsi characters
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
};

// Strip markdown bold markers and return clean text
const stripMarkdownBold = (text: string): string => {
  if (!text) return '';
  return text.replace(/\*\*/g, '');
};

// Parse text into segments with bold/normal styling
interface TextSegment {
  text: string;
  isBold: boolean;
}

const parseMarkdownBold = (text: string): TextSegment[] => {
  if (!text) return [];
  const segments: TextSegment[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before the bold part
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isBold: false });
    }
    // Add the bold part
    segments.push({ text: match[1], isBold: true });
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isBold: false });
  }
  
  return segments;
};

// Format property type for display (owner_occupied -> Owner Occupied)
const formatPropertyType = (type: string | null | undefined): string => {
  if (!type) return 'Property';
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
};

// Format name with proper title case (PETER RALEVSKI -> Peter Ralevski)
const formatProperName = (name: string | null | undefined): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Ensure percentage values include % symbol
const ensurePercentage = (value: string | null | undefined): string => {
  if (!value) return '0%';
  const cleaned = value.replace('%', '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return '0%';
  return `${num.toFixed(1)}%`;
};

export function PortfolioAnalysisPDFGenerator({ 
  clientId, 
  clientName,
  includeBorrowingCapacity = true,
  includeOwnerOccupied = true,
  analysisConfig = {},
  customInstructions = '',
  onComplete 
}: PortfolioAnalysisPDFGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [analysisData, setAnalysisData] = useState<PortfolioAnalysisData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { addNotification } = useNotifications();
  const { settings: brand } = useBrand();

  const generateAnalysis = async () => {
    setIsGenerating(true);

    try {
      const { runPreflight } = await import('@/lib/preflightTokens');
      const ok = await runPreflight({
        kind: 'report.portfolio-review',
        functionName: 'generate-portfolio-analysis',
        label: 'Portfolio analysis',
        estimate: { aiNarrative: true },
      });
      if (!ok) { setIsGenerating(false); return; }

      const { data, error } = await invokeSecureFunction('generate-portfolio-analysis', {
        clientId,
        investorProfile: 'general',
        analysisDepth: 'comprehensive',
        includeProjections: true,
        projectionYears: analysisConfig?.projectionPeriod || 10,
        includeOwnerOccupied,
        analysisConfig,
        customInstructions
      }, { timeoutMs: 240000 });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Analysis failed');

      setAnalysisData(data);
      setShowPreview(true);
      toast.success('Analysis ready. Click "Download & Save PDF" to store it in Reports.');
      
    } catch (error: any) {
      console.error('Portfolio analysis error:', error);
      toast.error('Failed to generate analysis: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // ============= PDF GENERATION ENGINE (Phase 1) =============
  const downloadPDF = async () => {
    if (!analysisData || isDownloading) return;
    setIsDownloading(true);
    
    
    try {
      console.log('📄 Starting Portfolio Analysis PDF generation with pdf-lib...');

      // Re-resolve the brand gold ramp from the active White-Label brand colour.
      applyBrandRgb(brand.brandColor);

      // Fetch global settings for branding
      const globalSettings = await fetchGlobalReportSettings();
      console.log('✓ Global settings fetched');
      
      // Create PDF document
      const pdfDoc = await PDFDocument.create();
      
      // Embed standard fonts
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
      
      // Register fontkit for custom TTF embedding (required by pdf-lib)
      pdfDoc.registerFontkit(fontkit);

      // Load and embed custom fonts from local TTF files (exact files provided)
      console.log('📥 Loading embedded fonts (local TTF files)...');

      let playfairFont = timesItalic; // Fallback
      let cinzelFont = helveticaBold; // Fallback

      try {
        const [playfairRes, cinzelRes] = await Promise.all([
          fetch('/fonts/PlayfairDisplay-Medium.ttf'),
          fetch('/fonts/Cinzel-Bold.ttf'),
        ]);

        if (!playfairRes.ok) throw new Error(`Playfair font fetch failed: ${playfairRes.status}`);
        if (!cinzelRes.ok) throw new Error(`Cinzel font fetch failed: ${cinzelRes.status}`);

        const [playfairBytes, cinzelBytes] = await Promise.all([
          playfairRes.arrayBuffer(),
          cinzelRes.arrayBuffer(),
        ]);

        playfairFont = await pdfDoc.embedFont(playfairBytes, { subset: true });
        cinzelFont = await pdfDoc.embedFont(cinzelBytes, { subset: true });

        console.log('✓ Custom fonts embedded (PlayfairDisplay-Medium.ttf, Cinzel-Bold.ttf)');
      } catch (fontError) {
        console.warn('Could not load embedded TTF fonts; using fallbacks:', fontError);
      }
      
      console.log('✓ PDF document created with fonts');
      
      // ============= PHASE 2: ENHANCED UTILITY FUNCTIONS =============
      
      // Parse markdown text for bold/italic formatting
      const parseMarkdownText = (text: string): Array<{text: string, bold: boolean, italic: boolean}> => {
        const cleanText = stripEmojis(text);
        const parts: Array<{text: string, bold: boolean, italic: boolean}> = [];
        let remaining = cleanText
          .replace(/^#{1,6}\s+/gm, '') // Remove markdown headers
          .replace(/^[\*\-\+]\s+/gm, '• ') // Convert markdown bullets
          .replace(/^\d+\.\s+/gm, '') // Remove numbered lists
          .replace(/^>\s+/gm, '') // Remove blockquotes
          .replace(/`{1,3}(.*?)`{1,3}/g, '$1') // Remove code formatting
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Remove links, keep text

        const boldItalicRegex = /\*\*\*(.*?)\*\*\*/g;
        const boldRegex = /\*\*(.*?)\*\*/g;
        const italicRegex = /\*(.*?)\*/g;

        let lastIndex = 0;
        const segments: Array<{text: string, start: number, end: number, bold: boolean, italic: boolean}> = [];

        // Find all bold+italic
        let match;
        while ((match = boldItalicRegex.exec(remaining)) !== null) {
          segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: true, italic: true});
        }

        // Find all bold
        while ((match = boldRegex.exec(remaining)) !== null) {
          if (!segments.some(s => match!.index >= s.start && match!.index < s.end)) {
            segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: true, italic: false});
          }
        }

        // Find all italic
        while ((match = italicRegex.exec(remaining)) !== null) {
          if (!segments.some(s => match!.index >= s.start && match!.index < s.end)) {
            segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: false, italic: true});
          }
        }

        segments.sort((a, b) => a.start - b.start);

        segments.forEach((seg) => {
          if (seg.start > lastIndex) {
            const normalText = remaining.substring(lastIndex, seg.start)
              .replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
            if (normalText) parts.push({text: normalText, bold: false, italic: false});
          }
          parts.push({text: seg.text, bold: seg.bold, italic: seg.italic});
          lastIndex = seg.end;
        });

        if (lastIndex < remaining.length) {
          const normalText = remaining.substring(lastIndex)
            .replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
          if (normalText) parts.push({text: normalText, bold: false, italic: false});
        }

        if (parts.length === 0) {
          parts.push({text: remaining.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, ''), bold: false, italic: false});
        }

        return parts;
      };
      
      // Calculate text height for page break detection
      const calculateTextHeight = (text: string, maxWidth: number, size: number, lineSpacing: number): number => {
        const parts = parseMarkdownText(text);
        let lines = 1;
        let currentLineWidth = 0;
        
        for (const part of parts) {
          const words = part.text.split(' ');
          const font = part.bold ? helveticaBold : helveticaFont;
          
          for (const word of words) {
            const wordWidth = font.widthOfTextAtSize(word + ' ', size);
            if (currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
              lines++;
              currentLineWidth = wordWidth;
            } else {
              currentLineWidth += wordWidth;
            }
          }
        }
        
        return lines * lineSpacing;
      };
      
      // Draw text with markdown formatting and word wrapping
      const drawFormattedText = (
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        size: number,
        lineSpacing: number,
        baseColor = SECONDARY_COLOR
      ): number => {
        const parts = parseMarkdownText(text);
        let currentY = y;
        let currentX = x;
        
        for (const part of parts) {
          const words = part.text.split(' ');
          const font = part.bold ? helveticaBold : helveticaFont;
          
          for (const word of words) {
            const wordWithSpace = word + ' ';
            const wordWidth = font.widthOfTextAtSize(wordWithSpace, size);
            
            if (currentX + wordWidth > x + maxWidth && currentX > x) {
              currentY -= lineSpacing;
              currentX = x;
            }
            
            page.drawText(wordWithSpace, {
              x: currentX,
              y: currentY,
              size,
              font,
              color: baseColor,
            });
            
            currentX += wordWidth;
          }
        }
        
        return currentY - lineSpacing;
      };
      
      // Simple wrapped text (no markdown)
      const drawWrappedText = (
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        font: PDFFont,
        size: number,
        color = SECONDARY_COLOR,
        lineHeight = 1.4
      ): number => {
        const cleanText = stripEmojis(stripMarkdownBold(text));
        const words = cleanText.split(' ');
        let line = '';
        let currentY = y;
        
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          const testWidth = font.widthOfTextAtSize(testLine, size);
          
          if (testWidth > maxWidth && line) {
            page.drawText(line, { x, y: currentY, size, font, color });
            currentY -= size * lineHeight;
            line = word;
          } else {
            line = testLine;
          }
        }
        
        if (line) {
          page.drawText(line, { x, y: currentY, size, font, color });
          currentY -= size * lineHeight;
        }
        
        return currentY;
      };
      
      // Draw wrapped text with markdown bold support
      const drawWrappedTextWithBold = (
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        maxWidth: number,
        regularFont: PDFFont,
        boldFont: PDFFont,
        size: number,
        color = SECONDARY_COLOR,
        lineHeight = 1.5
      ): number => {
        const segments = parseMarkdownBold(stripEmojis(text));
        let currentX = x;
        let currentY = y;
        let lineWords: { word: string; isBold: boolean }[] = [];
        
        // Flatten segments into individual words with their styles
        const allWords: { word: string; isBold: boolean }[] = [];
        for (const segment of segments) {
          const words = segment.text.split(' ').filter(w => w.length > 0);
          for (const word of words) {
            allWords.push({ word, isBold: segment.isBold });
          }
        }
        
        // Process words and wrap lines
        let currentLineWidth = 0;
        
        for (const { word, isBold } of allWords) {
          const font = isBold ? boldFont : regularFont;
          const wordWidth = font.widthOfTextAtSize(word + ' ', size);
          
          if (currentLineWidth + wordWidth > maxWidth && lineWords.length > 0) {
            // Draw current line
            let drawX = x;
            for (const { word: w, isBold: bold } of lineWords) {
              const f = bold ? boldFont : regularFont;
              page.drawText(w, { x: drawX, y: currentY, size, font: f, color });
              drawX += f.widthOfTextAtSize(w + ' ', size);
            }
            currentY -= size * lineHeight;
            lineWords = [];
            currentLineWidth = 0;
          }
          
          lineWords.push({ word, isBold });
          currentLineWidth += wordWidth;
        }
        
        // Draw remaining words
        if (lineWords.length > 0) {
          let drawX = x;
          for (const { word: w, isBold: bold } of lineWords) {
            const f = bold ? boldFont : regularFont;
            page.drawText(w, { x: drawX, y: currentY, size, font: f, color });
            drawX += f.widthOfTextAtSize(w + ' ', size);
          }
          currentY -= size * lineHeight;
        }
        
        return currentY;
      };
      
      // Calculate row height needed for text wrapping in a cell
      const calculateCellHeight = (
        text: string,
        columnWidth: number,
        fontSize: number,
        lineHeight: number,
        padding: number = 12
      ): number => {
        const cleanText = stripEmojis(text || '');
        const availableWidth = columnWidth - padding;
        const words = cleanText.split(' ');
        
        if (words.length === 0 || !cleanText) return lineHeight;
        
        let lines = 1;
        let currentLineWidth = 0;
        
        for (const word of words) {
          const wordWidth = helveticaFont.widthOfTextAtSize(word + ' ', fontSize);
          if (currentLineWidth + wordWidth > availableWidth && currentLineWidth > 0) {
            lines++;
            currentLineWidth = wordWidth;
          } else {
            currentLineWidth += wordWidth;
          }
        }
        
        return lines * lineHeight;
      };
      
      // Calculate the maximum row height needed for all cells in a row
      const calculateSmartRowHeight = (
        row: string[],
        columnWidths: number[],
        fontSize: number = 8,
        lineHeight: number = 12,
        minRowHeight: number = 22,
        padding: number = 12
      ): number => {
        let maxHeight = minRowHeight;
        
        for (let i = 0; i < row.length; i++) {
          const cellHeight = calculateCellHeight(row[i], columnWidths[i], fontSize, lineHeight, padding);
          const totalCellHeight = cellHeight + 10; // Add vertical padding
          if (totalCellHeight > maxHeight) {
            maxHeight = totalCellHeight;
          }
        }
        
        return maxHeight;
      };
      
      // Draw wrapped text within a table cell
      const drawCellText = (
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        columnWidth: number,
        fontSize: number = 8,
        lineHeight: number = 12,
        padding: number = 6,
        color = SECONDARY_COLOR
      ): void => {
        const cleanText = stripEmojis(text || '');
        const availableWidth = columnWidth - (padding * 2);
        const words = cleanText.split(' ');
        
        if (words.length === 0 || !cleanText) return;
        
        let currentLine = '';
        let currentY = y;
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = helveticaFont.widthOfTextAtSize(testLine, fontSize);
          
          if (testWidth > availableWidth && currentLine) {
            page.drawText(currentLine, {
              x: x + padding,
              y: currentY,
              size: fontSize,
              font: helveticaFont,
              color,
            });
            currentY -= lineHeight;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine) {
          page.drawText(currentLine, {
            x: x + padding,
            y: currentY,
            size: fontSize,
            font: helveticaFont,
            color,
          });
        }
      };
      
      // Draw a vector-based table with smart row heights
      const drawTable = (
        page: PDFPage,
        headers: string[],
        rows: string[][],
        x: number,
        y: number,
        columnWidths: number[],
        minRowHeight: number = 22,
        enableSmartHeight: boolean = true
      ): { lastY: number; needsNewPage: boolean } => {
        const tableWidth = columnWidths.reduce((sum, w) => sum + w, 0);
        let currentY = y;
        const headerRowHeight = 22; // Fixed header height
        const fontSize = 8;
        const lineHeight = 12;
        
        // Draw header row with brand navy background
        page.drawRectangle({
          x,
          y: currentY - headerRowHeight,
          width: tableWidth,
          height: headerRowHeight,
          color: NPC_NAVY,
        });
        
        // Header text (white on navy)
        let cellX = x;
        for (let i = 0; i < headers.length; i++) {
          page.drawText(stripEmojis(headers[i]), {
            x: cellX + 5,
            y: currentY - 15,
            size: 9,
            font: helveticaBold,
            color: NPC_WHITE,
          });
          cellX += columnWidths[i];
        }
        
        // Header borders (gold accent)
        page.drawLine({
          start: { x, y: currentY },
          end: { x: x + tableWidth, y: currentY },
          thickness: 1,
          color: NPC_GOLD,
        });
        page.drawLine({
          start: { x, y: currentY - headerRowHeight },
          end: { x: x + tableWidth, y: currentY - headerRowHeight },
          thickness: 1,
          color: NPC_GOLD,
        });
        
        currentY -= headerRowHeight;
        const tableStartY = y; // Remember where table started for vertical borders
        
        // Draw data rows
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          
          // Calculate smart row height based on content
          const rowHeight = enableSmartHeight 
            ? calculateSmartRowHeight(row, columnWidths, fontSize, lineHeight, minRowHeight)
            : minRowHeight;
          
          // Check page break
          if (currentY - rowHeight < MARGIN_BOTTOM) {
            // Draw vertical borders up to current point before returning
            cellX = x;
            for (let i = 0; i <= columnWidths.length; i++) {
              page.drawLine({
                start: { x: cellX, y: tableStartY },
                end: { x: cellX, y: currentY },
                thickness: 0.5,
                color: rgb(0.85, 0.85, 0.85),
              });
              if (i < columnWidths.length) cellX += columnWidths[i];
            }
            return { lastY: currentY, needsNewPage: true };
          }
          
          // Alternating row background (light gold tint)
          if (rowIndex % 2 === 0) {
            page.drawRectangle({
              x,
              y: currentY - rowHeight,
              width: tableWidth,
              height: rowHeight,
              color: NPC_GOLD_TINT, // Gold tint #fdf9ed
            });
          }
          
          // Cell text - use smart wrapping instead of truncation
          cellX = x;
          for (let i = 0; i < row.length; i++) {
            const cellText = stripEmojis(row[i] || '');
            const textStartY = currentY - 5 - (fontSize * 0.5); // Start near top of cell
            
            if (enableSmartHeight) {
              // Draw wrapped text
              drawCellText(page, cellText, cellX, textStartY, columnWidths[i], fontSize, lineHeight, 6, SECONDARY_COLOR);
            } else {
              // Legacy truncation behavior
              const availableWidth = columnWidths[i] - 12;
              let displayText = cellText;
              let textWidth = helveticaFont.widthOfTextAtSize(displayText, fontSize);
              
              if (textWidth > availableWidth) {
                let left = 0;
                let right = cellText.length;
                while (left < right) {
                  const mid = Math.ceil((left + right) / 2);
                  const testText = cellText.substring(0, mid) + '...';
                  if (helveticaFont.widthOfTextAtSize(testText, fontSize) <= availableWidth) {
                    left = mid;
                  } else {
                    right = mid - 1;
                  }
                }
                displayText = left > 0 ? cellText.substring(0, left) + '...' : '...';
              }
              
              page.drawText(displayText, {
                x: cellX + 6,
                y: currentY - 15,
                size: fontSize,
                font: helveticaFont,
                color: SECONDARY_COLOR,
              });
            }
            cellX += columnWidths[i];
          }
          
          // Row border
          page.drawLine({
            start: { x, y: currentY - rowHeight },
            end: { x: x + tableWidth, y: currentY - rowHeight },
            thickness: 0.5,
            color: rgb(0.85, 0.85, 0.85),
          });
          
          currentY -= rowHeight;
        }
        
        // Vertical borders
        cellX = x;
        for (let i = 0; i <= columnWidths.length; i++) {
          page.drawLine({
            start: { x: cellX, y: tableStartY },
            end: { x: cellX, y: currentY },
            thickness: 0.5,
            color: rgb(0.85, 0.85, 0.85),
          });
          if (i < columnWidths.length) cellX += columnWidths[i];
        }
        
        return { lastY: currentY - 15, needsNewPage: false };
      };
      
      // Draw section header with improved spacing
      const drawSectionHeader = (
        page: PDFPage,
        title: string,
        y: number
      ): number => {
        page.drawText(stripEmojis(title), {
          x: MARGIN_LEFT,
          y,
          size: 14,
          font: helveticaBold,
          color: PRIMARY_COLOR,
        });
        
        page.drawLine({
          start: { x: MARGIN_LEFT, y: y - 8 },
          end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: y - 8 },
          thickness: 1.5,
          color: NPC_GOLD_LIGHT,
        });
        
        return y - SECTION_SPACING;
      };
      
      // Draw subsection header (smaller) with improved spacing
      const drawSubsectionHeader = (
        page: PDFPage,
        title: string,
        y: number,
        color = SECONDARY_COLOR
      ): number => {
        page.drawText(stripEmojis(title), {
          x: MARGIN_LEFT,
          y,
          size: 11,
          font: helveticaBold,
          color,
        });
        return y - SUBSECTION_SPACING;
      };
      
      // Draw KPI box with improved padding
      const drawKPIBox = (
        page: PDFPage,
        label: string,
        value: string,
        x: number,
        y: number,
        width: number,
        valueColor = SECONDARY_COLOR
      ): void => {
        const boxHeight = 55;
        // KPI box with gold-tinted background and gold border
        page.drawRectangle({
          x,
          y: y - boxHeight,
          width,
          height: boxHeight,
          color: NPC_GOLD_TINT, // Gold tint #fdf9ed
          borderColor: NPC_GOLD_LIGHT,
          borderWidth: 1,
        });
        
        // Auto-size label to fit within box width
        const cleanLabel = stripEmojis(label);
        const maxLabelWidth = width - BOX_PADDING * 2;
        let labelSize = 8;
        let labelText = cleanLabel;
        const labelWidth = helveticaFont.widthOfTextAtSize(cleanLabel, labelSize);
        if (labelWidth > maxLabelWidth) {
          // Try smaller font first
          labelSize = 7;
          const smallerWidth = helveticaFont.widthOfTextAtSize(cleanLabel, labelSize);
          if (smallerWidth > maxLabelWidth) {
            // Truncate with ellipsis
            labelSize = 7;
            while (labelText.length > 3 && helveticaFont.widthOfTextAtSize(labelText + '...', labelSize) > maxLabelWidth) {
              labelText = labelText.slice(0, -1);
            }
            labelText = labelText.trim() + '...';
          }
        }
        
        page.drawText(labelText, {
          x: x + BOX_PADDING,
          y: y - 18,
          size: labelSize,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        page.drawText(stripEmojis(value), {
          x: x + BOX_PADDING,
          y: y - 40,
          size: 14,
          font: helveticaBold,
          color: valueColor,
        });
      };
      
      // Draw bullet list with markdown bold support and smart page breaks
      const drawBulletList = (
        startPage: PDFPage,
        items: string[],
        x: number,
        y: number,
        maxWidth: number,
        size: number = 9,
        bulletIndent: number = 15,
        continuationTitle?: string
      ): { page: PDFPage; yPos: number } => {
        let currentY = y;
        let activePage = startPage;
        const bulletChar = '•';
        
        for (const item of items) {
          // Estimate height needed for this bullet item
          const itemHeight = calculateTextHeight(item, maxWidth - bulletIndent, size, size * 1.6) + LIST_ITEM_SPACING + 4;
          
          // Check if we need a new page before drawing this item
          if (needsNewPage(currentY, itemHeight + 10)) {
            activePage = addContentPage();
            currentY = PAGE_HEIGHT - MARGIN_TOP;
            if (continuationTitle) {
              currentY = drawSectionHeader(activePage, continuationTitle, currentY);
            }
          }
          
          // Draw bullet point
          activePage.drawText(bulletChar, {
            x,
            y: currentY,
            size,
            font: helveticaBold,
            color: PRIMARY_COLOR,
          });
          
          // Draw wrapped text with bold support after bullet
          currentY = drawWrappedTextWithBold(
            activePage, 
            item, 
            x + bulletIndent, 
            currentY, 
            maxWidth - bulletIndent, 
            helveticaFont, 
            helveticaBold,
            size, 
            SECONDARY_COLOR,
            1.6
          );
          currentY -= LIST_ITEM_SPACING + 4;
        }
        return { page: activePage, yPos: currentY };
      };
      
      // Draw numbered list with improved formatting and smart page breaks
      const drawNumberedList = (
        startPage: PDFPage,
        items: string[],
        x: number,
        y: number,
        maxWidth: number,
        size: number = 9,
        numberIndent: number = 18,
        continuationTitle?: string
      ): { page: PDFPage; yPos: number } => {
        let currentY = y;
        let activePage = startPage;
        
        for (let i = 0; i < items.length; i++) {
          const numberText = `${i + 1}.`;
          
          // Estimate height for this item
          const itemHeight = calculateTextHeight(items[i], maxWidth - numberIndent, size, size * 1.4) + LIST_ITEM_SPACING;
          
          // Check page break
          if (needsNewPage(currentY, itemHeight + 10)) {
            activePage = addContentPage();
            currentY = PAGE_HEIGHT - MARGIN_TOP;
            if (continuationTitle) {
              currentY = drawSectionHeader(activePage, continuationTitle, currentY);
            }
          }
          
          // Draw number
          activePage.drawText(numberText, {
            x,
            y: currentY,
            size,
            font: helveticaBold,
            color: PRIMARY_COLOR,
          });
          
          // Draw wrapped text after number with proper indent
          currentY = drawWrappedText(
            activePage, 
            stripEmojis(items[i]), 
            x + numberIndent, 
            currentY, 
            maxWidth - numberIndent, 
            helveticaFont, 
            size, 
            SECONDARY_COLOR
          );
          currentY -= LIST_ITEM_SPACING;
        }
        return { page: activePage, yPos: currentY };
      };
      
      // Draw badge (colored rectangle with text)
      const drawBadge = (
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        bgColor = PRIMARY_COLOR,
        textColor = rgb(1, 1, 1)
      ): number => {
        const badgeText = stripEmojis(text.toUpperCase());
        const textWidth = helveticaBold.widthOfTextAtSize(badgeText, 8);
        const padding = 6;
        
        page.drawRectangle({
          x,
          y: y - 12,
          width: textWidth + padding * 2,
          height: 16,
          color: bgColor,
        });
        
        page.drawText(badgeText, {
          x: x + padding,
          y: y - 8,
          size: 8,
          font: helveticaBold,
          color: textColor,
        });
        
        return x + textWidth + padding * 2 + 8;
      };
      
      // Check if new page needed
      const needsNewPage = (currentY: number, requiredSpace: number): boolean => {
        return currentY - requiredSpace < MARGIN_BOTTOM;
      };
      
      // Add new content page with optional header
      const addContentPage = (pageTitle?: string): PDFPage => {
        const newPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        if (pageTitle) {
          newPage.drawText(stripEmojis(pageTitle), {
            x: MARGIN_LEFT,
            y: PAGE_HEIGHT - MARGIN_TOP,
            size: 12,
            font: helveticaBold,
            color: PRIMARY_COLOR,
          });
        }
        return newPage;
      };
      
      // ============= BRANDED COVER PAGE (Using PDF Template) =============
      console.log('📝 Creating branded cover page from PDF template...');

      let coverPage: PDFPage;
      let coverWidth = PAGE_WIDTH;
      let coverHeight = PAGE_HEIGHT;

      try {
        const coverTemplateResponse = await fetch('/templates/NPC_PDF_Template-6.pdf');
        if (!coverTemplateResponse.ok) {
          throw new Error(`Cover template fetch failed: ${coverTemplateResponse.status}`);
        }

        const coverTemplateBytes = await coverTemplateResponse.arrayBuffer();
        const coverTemplateDoc = await PDFDocument.load(coverTemplateBytes);
        const [templateCoverPage] = await pdfDoc.copyPages(coverTemplateDoc, [0]);
        coverPage = pdfDoc.addPage(templateCoverPage);

        const size = coverPage.getSize();
        coverWidth = size.width;
        coverHeight = size.height;

        console.log('✓ Cover page template imported successfully');
      } catch (templateError) {
        console.error('Failed to load cover PDF template, using fallback:', templateError);
        coverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        coverPage.drawRectangle({
          x: 0,
          y: 0,
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          color: NPC_BLACK,
        });
      }

      // ============= OVERLAY DYNAMIC TEXT ON COVER =============
      // Template already contains: logo/tagline/line/diamond.
      // We only add: Report Title, Client Name, Date.
      // Positioning moved LOWER to match the provided reference.

      // Report Title (PlayfairDisplay-Medium.ttf)
      const reportTitle = 'Portfolio Performance Report';
      const reportTitleSize = 32;
      const reportTitleY = coverHeight * 0.26; // moved lower (was 0.32)
      const reportTitleWidth = playfairFont.widthOfTextAtSize(reportTitle, reportTitleSize);
      coverPage.drawText(reportTitle, {
        x: (coverWidth - reportTitleWidth) / 2,
        y: reportTitleY,
        size: reportTitleSize,
        font: playfairFont,
        color: NPC_WHITE,
      });

      // Client Name (Cinzel-Bold.ttf)
      const clientText = stripEmojis(analysisData.clientName).toUpperCase();
      const clientNameSize = 18;
      const clientNameY = reportTitleY - 52;
      const clientNameWidth = cinzelFont.widthOfTextAtSize(clientText, clientNameSize);
      coverPage.drawText(clientText, {
        x: (coverWidth - clientNameWidth) / 2,
        y: clientNameY,
        size: clientNameSize,
        font: cinzelFont,
        color: NPC_GOLD,
      });

      // Date (Helvetica)
      const dateText = new Date(analysisData.generatedAt).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const dateSize = 14;
      const dateY = clientNameY - 40;
      const dateWidth = helveticaFont.widthOfTextAtSize(dateText, dateSize);
      coverPage.drawText(dateText, {
        x: (coverWidth - dateWidth) / 2,
        y: dateY,
        size: dateSize,
        font: helveticaFont,
        color: NPC_WHITE,
      });

      console.log('✓ branded cover page complete (PDF template)');
      
      // Define metrics and health score early for TOC page numbers and later use
      const metrics = analysisData.portfolioMetrics;
      const healthScore = safeNumber(analysisData.analysis?.executiveSummary?.healthScore, 0);
      
      // ============= PHASE 5: TABLE OF CONTENTS =============
      console.log('📝 Creating table of contents...');
      const tocPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let tocY = PAGE_HEIGHT - MARGIN_TOP;
      
      // Header bar for TOC with brand navy
      tocPage.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 40,
        width: PAGE_WIDTH,
        height: 40,
        color: NPC_NAVY,
      });
      
      tocPage.drawText('TABLE OF CONTENTS', {
        x: MARGIN_LEFT,
        y: PAGE_HEIGHT - 27,
        size: 12,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });
      
      tocY -= 30;
      
      // TOC entries with page numbers
      const hasPropertyStrategicCtx = safeArray(analysisData.analysis?.propertyStrategicContext).length > 0;
      const hasRateSensitivity = !!analysisData.analysis?.interestRateSensitivity;
      const hasMarketConditions = !!analysisData.analysis?.marketConditions;
      const hasActionPlan = !!analysisData.analysis?.actionPlan;
      const hasBcUtil = !!analysisData.analysis?.borrowingCapacityUtilisation;
      
      const tocEntries: { title: string; page: number }[] = [];
      let pageEstimate = 3;
      tocEntries.push({ title: 'Executive Summary & Portfolio Overview', page: pageEstimate });
      if (metrics.smsfCount > 0) { pageEstimate++; tocEntries.push({ title: 'SMSF Portfolio Summary', page: pageEstimate }); }
      pageEstimate++; tocEntries.push({ title: 'Portfolio Composition Analysis', page: pageEstimate });
      pageEstimate++; tocEntries.push({ title: 'Property Cashflow Analysis', page: pageEstimate });
      pageEstimate++; tocEntries.push({ title: 'Property Performance Rankings', page: pageEstimate });
      if (hasPropertyStrategicCtx) { pageEstimate++; tocEntries.push({ title: 'Property Strategic Context', page: pageEstimate }); }
      pageEstimate++; tocEntries.push({ title: 'Financial Health Analysis', page: pageEstimate });
      tocEntries.push({ title: 'Risk Assessment', page: pageEstimate });
      if (hasRateSensitivity) { pageEstimate++; tocEntries.push({ title: 'Interest Rate Sensitivity — Lender Rates', page: pageEstimate }); }
      if (hasMarketConditions) { tocEntries.push({ title: 'Market Conditions & Outlook', page: pageEstimate }); }
      pageEstimate++; tocEntries.push({ title: 'Growth Opportunities', page: pageEstimate });
      tocEntries.push({ title: 'Portfolio Projections', page: pageEstimate });
      if (hasActionPlan) { pageEstimate++; tocEntries.push({ title: '12-Month Action Plan', page: pageEstimate }); }
      if (hasBcUtil) { tocEntries.push({ title: 'Borrowing Capacity Utilisation', page: pageEstimate }); }
      pageEstimate++; tocEntries.push({ title: 'Strategic Recommendations', page: pageEstimate });
      pageEstimate++; tocEntries.push({ title: 'Property Portfolio Details', page: pageEstimate });
      pageEstimate++; tocEntries.push({ title: 'Disclaimer & Contact', page: pageEstimate });
      
      for (let i = 0; i < tocEntries.length; i++) {
        const entry = tocEntries[i];
        const entryY = tocY - (i * 28);
        
        // Section number
        tocPage.drawText(`${i + 1}.`, {
          x: MARGIN_LEFT,
          y: entryY,
          size: 11,
          font: helveticaBold,
          color: PRIMARY_COLOR,
        });
        
        // Section title
        tocPage.drawText(stripEmojis(entry.title), {
          x: MARGIN_LEFT + 25,
          y: entryY,
          size: 11,
          font: helveticaFont,
          color: SECONDARY_COLOR,
        });
        
        // Dotted line
        const titleWidth = helveticaFont.widthOfTextAtSize(entry.title, 11);
        const dotsStart = MARGIN_LEFT + 30 + titleWidth;
        const dotsEnd = PAGE_WIDTH - MARGIN_RIGHT - 30;
        const dotSpacing = 4;
        
        for (let dotX = dotsStart; dotX < dotsEnd; dotX += dotSpacing) {
          tocPage.drawCircle({
            x: dotX,
            y: entryY + 3,
            size: 0.5,
            color: rgb(0.7, 0.7, 0.7),
          });
        }
        
        // Page number
        tocPage.drawText(entry.page.toString(), {
          x: PAGE_WIDTH - MARGIN_RIGHT - 15,
          y: entryY,
          size: 11,
          font: helveticaBold,
          color: PRIMARY_COLOR,
        });
      }
      
      // Note about report contents
      const noteY = tocY - (tocEntries.length * 28) - 40;
      const aboutBoxPadding = 14;
      const aboutBoxHeight = 75;
      
      tocPage.drawRectangle({
        x: MARGIN_LEFT,
        y: noteY - aboutBoxHeight,
        width: CONTENT_WIDTH,
        height: aboutBoxHeight,
        color: NPC_GOLD_TINT, // Gold tint
        borderColor: NPC_GOLD_LIGHT,
        borderWidth: 1,
      });
      
      tocPage.drawText('About This Report', {
        x: MARGIN_LEFT + aboutBoxPadding,
        y: noteY - 20,
        size: 10,
        font: helveticaBold,
        color: PRIMARY_COLOR,
      });
      
      const aboutText = `This comprehensive portfolio analysis covers ${metrics.totalProperties} properties with a combined value of ${formatCurrency(metrics.totalValue)}. The analysis includes performance rankings, financial health assessment, risk evaluation, and strategic recommendations.`;
      drawWrappedText(tocPage, aboutText, MARGIN_LEFT + aboutBoxPadding, noteY - 38, CONTENT_WIDTH - (aboutBoxPadding * 2), helveticaFont, 9, MUTED_COLOR, 1.6);
      
      console.log('✓ Table of contents complete');
      
      // ============= PAGE 2: EXECUTIVE SUMMARY =============
      console.log('📝 Creating executive summary page...');
      let page = addContentPage();
      let yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      // Personalised Narrative (if available from enhanced prompt)
      const narrative = analysisData.analysis?.personalizedNarrative;
      if (narrative) {
        yPos = drawSectionHeader(page, 'Your Portfolio at a Glance', yPos);
        
        if (narrative.openingStatement) {
          yPos = drawFormattedText(page, narrative.openingStatement, MARGIN_LEFT, yPos, CONTENT_WIDTH, 10, 16, SECONDARY_COLOR);
          yPos -= PARAGRAPH_SPACING;
        }
        
        if (narrative.portfolioJourney) {
          const journeyHeight = calculateTextHeight(narrative.portfolioJourney, CONTENT_WIDTH, 9, 15) + SUBSECTION_SPACING + 10;
          if (needsNewPage(yPos, journeyHeight)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
          }
          yPos = drawSubsectionHeader(page, 'Portfolio Journey', yPos);
          yPos = drawFormattedText(page, narrative.portfolioJourney, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= PARAGRAPH_SPACING;
        }
      }
      
      // ============= PROPERTY PORTFOLIO DETAILS TABLE (between narrative and executive summary) =============
      {
        // Check if we need a new page for the table
        if (needsNewPage(yPos, 120)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
        }
        
        yPos = drawSubsectionHeader(page, 'Property Portfolio Details', yPos);
        
        const propHeaders = ['#', 'Address', 'Type', 'Value', 'Equity', 'LVR', 'Yield'];
        const propColumnWidths = [20, 160, 70, 60, 60, 40, 42];
        
        const propRows = analysisData.propertyAnalyses.map(prop => [
          prop.propertyNumber.toString(),
          prop.address,
          formatPropertyType(prop.propertyType),
          formatCurrency(prop.value),
          formatCurrency(prop.equity),
          ensurePercentage(prop.lvr),
          ensurePercentage(prop.grossYield),
        ]);
        
        let tableResult = drawTable(page, propHeaders, propRows, MARGIN_LEFT, yPos, propColumnWidths, 22);
        yPos = tableResult.lastY;
        
        if (tableResult.needsNewPage) {
          const remainingRows = propRows.slice(Math.floor((PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / 20) - 1);
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSubsectionHeader(page, 'Property Portfolio Details (continued)', yPos);
          tableResult = drawTable(page, propHeaders, remainingRows, MARGIN_LEFT, yPos, propColumnWidths, 20);
          yPos = tableResult.lastY;
        }
        
        yPos -= SECTION_SPACING;
      }
      
      // Page header
      yPos = drawSectionHeader(page, 'Executive Summary', yPos);
      
      // Health status row
      const healthStatus = analysisData.analysis.executiveSummary.overallHealth;
      page.drawText('Portfolio Health:', {
        x: MARGIN_LEFT,
        y: yPos,
        size: 11,
        font: helveticaFont,
        color: MUTED_COLOR,
      });
      
      const healthStatusColor = healthStatus.toLowerCase() === 'excellent' || healthStatus.toLowerCase() === 'good' 
        ? SUCCESS_COLOR 
        : healthStatus.toLowerCase() === 'poor' ? DANGER_COLOR : WARNING_COLOR;
      
      page.drawText(stripEmojis(healthStatus.toUpperCase()), {
        x: MARGIN_LEFT + 95,
        y: yPos,
        size: 11,
        font: helveticaBold,
        color: healthStatusColor,
      });
      
      page.drawText(`Score: ${healthScore}/100`, {
        x: PAGE_WIDTH - MARGIN_RIGHT - 80,
        y: yPos,
        size: 11,
        font: helveticaBold,
        color: PRIMARY_COLOR,
      });
      
      yPos -= 25;
      
      // Primary recommendation
      page.drawText('Primary Recommendation:', {
        x: MARGIN_LEFT,
        y: yPos,
        size: 10,
        font: helveticaBold,
        color: SECONDARY_COLOR,
      });
      yPos -= 15;
      
      yPos = drawWrappedText(
        page,
        analysisData.analysis.executiveSummary.primaryRecommendation,
        MARGIN_LEFT,
        yPos,
        CONTENT_WIDTH,
        helveticaFont,
        10,
        SECONDARY_COLOR
      );
      
      yPos -= SUBSECTION_SPACING;
      
      // Key Strengths - use improved bullet list
      const keyStrengths = safeArray(analysisData.analysis?.executiveSummary?.keyStrengths);
      if (keyStrengths.length > 0) {
        page.drawText('Key Strengths:', {
          x: MARGIN_LEFT,
          y: yPos,
          size: 10,
          font: helveticaBold,
          color: SUCCESS_COLOR,
        });
        yPos -= PARAGRAPH_SPACING;
        
        ({ page, yPos } = drawBulletList(page, keyStrengths, MARGIN_LEFT + 10, yPos, CONTENT_WIDTH - 20, 9, 15, 'Executive Summary (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      // Key Concerns - use improved bullet list
      const keyConcerns = safeArray(analysisData.analysis?.executiveSummary?.keyConcerns);
      if (keyConcerns.length > 0) {
        page.drawText('Key Concerns:', {
          x: MARGIN_LEFT,
          y: yPos,
          size: 10,
          font: helveticaBold,
          color: WARNING_COLOR,
        });
        yPos -= PARAGRAPH_SPACING;
        
        ({ page, yPos } = drawBulletList(page, keyConcerns, MARGIN_LEFT + 10, yPos, CONTENT_WIDTH - 20, 9, 15, 'Executive Summary (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      yPos -= SECTION_SPACING;
      
      // ============= PORTFOLIO OVERVIEW SECTION =============
      // Need ~165px: section header (30) + 2 KPI rows (65 each) + spacing
      if (needsNewPage(yPos, 165)) {
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
      }
      yPos = drawSectionHeader(page, 'Portfolio Overview', yPos);
      
      const kpiWidth = (CONTENT_WIDTH - 20) / 3;
      
      // Row 1: Total Value, Total Equity, Average LVR
      drawKPIBox(page, 'TOTAL VALUE', formatCurrency(metrics.totalValue), MARGIN_LEFT, yPos, kpiWidth);
      drawKPIBox(page, 'TOTAL EQUITY', formatCurrency(metrics.totalEquity), MARGIN_LEFT + kpiWidth + 10, yPos, kpiWidth, SUCCESS_COLOR);
      drawKPIBox(page, 'AVERAGE LVR', formatPercentage(metrics.averageLVR), MARGIN_LEFT + (kpiWidth + 10) * 2, yPos, kpiWidth);
      
      yPos -= 65;
      
      // Row 2: Properties, Monthly Cashflow, Avg Yield
      const cashflowColor = safeNumber(metrics.netMonthlyCashflow) >= 0 ? SUCCESS_COLOR : DANGER_COLOR;
      drawKPIBox(page, 'PROPERTIES', safeNumber(metrics.totalProperties).toString(), MARGIN_LEFT, yPos, kpiWidth);
      drawKPIBox(page, 'MONTHLY CASHFLOW', formatCurrency(metrics.netMonthlyCashflow), MARGIN_LEFT + kpiWidth + 10, yPos, kpiWidth, cashflowColor);
      drawKPIBox(page, 'AVG. YIELD', formatPercentage(metrics.averageYield, 2), MARGIN_LEFT + (kpiWidth + 10) * 2, yPos, kpiWidth);
      
      yPos -= 65;
      
      console.log('✓ Executive summary page complete');
      
      // ============= PAGE 3: SMSF SUMMARY (if applicable) =============
      if (safeNumber(metrics.smsfCount) > 0) {
        console.log('📝 Creating SMSF summary page...');
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
        
        yPos = drawSectionHeader(page, 'SMSF Portfolio Summary', yPos);
        
        // SMSF KPI boxes
        const smsfKpiWidth = (CONTENT_WIDTH - 10) / 2;
        drawKPIBox(page, 'SMSF PROPERTIES', safeNumber(metrics.smsfCount).toString(), MARGIN_LEFT, yPos, smsfKpiWidth);
        drawKPIBox(page, 'SMSF TOTAL VALUE', formatCurrency(metrics.smsfTotalValue), MARGIN_LEFT + smsfKpiWidth + 10, yPos, smsfKpiWidth, PRIMARY_COLOR);
        
        yPos -= 65;
        
        drawKPIBox(page, 'SMSF EQUITY', formatCurrency(metrics.smsfTotalEquity), MARGIN_LEFT, yPos, smsfKpiWidth, SUCCESS_COLOR);
        
        yPos -= 80;
        
        // Compliance status
        yPos = drawSubsectionHeader(page, 'Compliance Status', yPos);
        yPos -= 5;
        
        const complianceData = [
          ['Status', 'Count'],
          ['Compliant', safeNumber(metrics.smsfCompliantCount).toString()],
          ['Pending Audit', safeNumber(metrics.smsfPendingAuditCount).toString()],
          ['Non-Compliant', safeNumber(metrics.smsfNonCompliantCount).toString()],
        ];
        
        const { lastY: complianceLastY } = drawTable(page, complianceData[0], complianceData.slice(1), MARGIN_LEFT, yPos, [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2]);
        yPos = complianceLastY - 20;
        
        console.log('✓ SMSF summary page complete');
      }
      
      // ============= PHASE 4: COMPOSITION ANALYSIS PAGE =============
      console.log('📝 Creating composition analysis page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Portfolio Composition Analysis', yPos);
      
      const composition = analysisData.analysis.compositionAnalysis;
      
      // Diversification Score Visual (Progress Bar Style)
      const drawScoreBar = (
        page: PDFPage,
        label: string,
        score: number,
        maxScore: number,
        x: number,
        y: number,
        width: number
      ): number => {
        const barHeight = 20;
        const percentage = Math.min(score / maxScore, 1);
        const filledWidth = width * percentage;
        
        // Label
        page.drawText(stripEmojis(label), {
          x,
          y: y + 5,
          size: 9,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        // Background bar
        page.drawRectangle({
          x,
          y: y - barHeight,
          width,
          height: barHeight,
          color: rgb(0.93, 0.93, 0.93),
        });
        
        // Filled bar
        const barColor = percentage >= 0.7 ? SUCCESS_COLOR : percentage >= 0.4 ? WARNING_COLOR : DANGER_COLOR;
        page.drawRectangle({
          x,
          y: y - barHeight,
          width: filledWidth,
          height: barHeight,
          color: barColor,
        });
        
        // Score text
        const scoreText = `${score}/${maxScore}`;
        page.drawText(scoreText, {
          x: x + width + 10,
          y: y - 14,
          size: 11,
          font: helveticaBold,
          color: barColor,
        });
        
        return y - barHeight - 20;
      };
      
      // Diversification Score
      const diversificationScore = safeNumber(composition?.diversificationScore);
      yPos = drawScoreBar(page, 'Diversification Score', diversificationScore, 100, MARGIN_LEFT, yPos, CONTENT_WIDTH - 80);
      
      yPos -= PARAGRAPH_SPACING;
      
      // Asset Allocation
      yPos = drawSubsectionHeader(page, 'Asset Allocation', yPos);
      yPos = drawFormattedText(page, safeString(composition?.assetAllocation, 'No asset allocation data available.'), MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 14);
      yPos -= PARAGRAPH_SPACING;
      
      // Property Mix Assessment
      yPos = drawSubsectionHeader(page, 'Property Mix Assessment', yPos);
      yPos = drawFormattedText(page, safeString(composition?.propertyMixAssessment, 'No property mix data available.'), MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 14);
      yPos -= PARAGRAPH_SPACING;
      
      // Property Type Breakdown Visual
      yPos = drawSubsectionHeader(page, 'Portfolio Breakdown by Type', yPos);
      
      const totalProps = safeNumber(metrics.totalProperties);
      const investmentPercent = totalProps > 0 
        ? Math.round((safeNumber(metrics.investmentCount) / totalProps) * 100) 
        : 0;
      const ownerOccPercent = totalProps > 0 
        ? Math.round((safeNumber(metrics.ownerOccupiedCount) / totalProps) * 100) 
        : 0;
      const smsfPercent = totalProps > 0 
        ? Math.round((safeNumber(metrics.smsfCount) / totalProps) * 100) 
        : 0;
      
      // Investment properties bar
      const barWidth = CONTENT_WIDTH - 100;
      
      page.drawText('Investment', {
        x: MARGIN_LEFT,
        y: yPos,
        size: 8,
        font: helveticaFont,
        color: MUTED_COLOR,
      });
      page.drawRectangle({
        x: MARGIN_LEFT + 70,
        y: yPos - 8,
        width: barWidth,
        height: 14,
        color: rgb(0.93, 0.93, 0.93),
      });
      page.drawRectangle({
        x: MARGIN_LEFT + 70,
        y: yPos - 8,
        width: barWidth * (investmentPercent / 100),
        height: 14,
        color: PRIMARY_COLOR,
      });
      page.drawText(`${investmentPercent}% (${safeNumber(metrics.investmentCount)})`, {
        x: MARGIN_LEFT + 75 + barWidth,
        y: yPos - 5,
        size: 8,
        font: helveticaBold,
        color: PRIMARY_COLOR,
      });
      yPos -= 22;
      
      // Owner Occupied bar
      page.drawText('Owner Occ.', {
        x: MARGIN_LEFT,
        y: yPos,
        size: 8,
        font: helveticaFont,
        color: MUTED_COLOR,
      });
      page.drawRectangle({
        x: MARGIN_LEFT + 70,
        y: yPos - 8,
        width: barWidth,
        height: 14,
        color: rgb(0.93, 0.93, 0.93),
      });
      page.drawRectangle({
        x: MARGIN_LEFT + 70,
        y: yPos - 8,
        width: barWidth * (ownerOccPercent / 100),
        height: 14,
        color: SUCCESS_COLOR,
      });
      page.drawText(`${ownerOccPercent}% (${safeNumber(metrics.ownerOccupiedCount)})`, {
        x: MARGIN_LEFT + 75 + barWidth,
        y: yPos - 5,
        size: 8,
        font: helveticaBold,
        color: SUCCESS_COLOR,
      });
      yPos -= 22;
      
      // SMSF bar
      if (safeNumber(metrics.smsfCount) > 0) {
        page.drawText('SMSF', {
          x: MARGIN_LEFT,
          y: yPos,
          size: 8,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        page.drawRectangle({
          x: MARGIN_LEFT + 70,
          y: yPos - 8,
          width: barWidth,
          height: 14,
          color: rgb(0.93, 0.93, 0.93),
        });
        page.drawRectangle({
          x: MARGIN_LEFT + 70,
          y: yPos - 8,
          width: barWidth * (smsfPercent / 100),
          height: 14,
          color: WARNING_COLOR,
        });
        page.drawText(`${smsfPercent}% (${safeNumber(metrics.smsfCount)})`, {
          x: MARGIN_LEFT + 75 + barWidth,
          y: yPos - 5,
          size: 8,
          font: helveticaBold,
          color: WARNING_COLOR,
        });
        yPos -= 22;
      }
      
      yPos -= 15;
      
      // Composition Recommendations
      const compositionRecs = safeArray(composition?.recommendations);
      if (compositionRecs.length > 0) {
        yPos = drawSubsectionHeader(page, 'Composition Recommendations', yPos, PRIMARY_COLOR);
        ({ page, yPos } = drawBulletList(page, compositionRecs, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Portfolio Composition Analysis (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      console.log('✓ Composition analysis page complete');
      
      // ============= PHASE 4: ENHANCED PROPERTY CASHFLOW TABLE =============
      console.log('📝 Creating property cashflow details page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Property Cashflow Analysis', yPos);
      
      // Enhanced property cards with cashflow details
      const propertyAnalyses = safeArray(analysisData.propertyAnalyses);
      for (const prop of propertyAnalyses) {
        // Check for page break - each property card needs ~100px
        if (needsNewPage(yPos, 100)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Property Cashflow Analysis (continued)', yPos);
        }
        
        // Property card background
        page.drawRectangle({
          x: MARGIN_LEFT,
          y: yPos - 80,
          width: CONTENT_WIDTH,
          height: 85,
          color: rgb(0.98, 0.98, 0.98),
          borderColor: rgb(0.9, 0.9, 0.9),
          borderWidth: 1,
        });
        
        // Property number badge
        page.drawRectangle({
          x: MARGIN_LEFT + 5,
          y: yPos - 20,
          width: 22,
          height: 18,
          color: PRIMARY_COLOR,
        });
        page.drawText(`${prop.propertyNumber}`, {
          x: MARGIN_LEFT + 12,
          y: yPos - 16,
          size: 10,
          font: helveticaBold,
          color: rgb(1, 1, 1),
        });
        
        // Address
        const propAddress = safeString(prop.address, 'Unknown Address');
        const truncatedAddress = propAddress.length > 50 ? propAddress.substring(0, 47) + '...' : propAddress;
        page.drawText(stripEmojis(truncatedAddress), {
          x: MARGIN_LEFT + 35,
          y: yPos - 15,
          size: 10,
          font: helveticaBold,
          color: SECONDARY_COLOR,
        });
        
        // Property type badge - format properly (owner_occupied -> Owner Occupied)
        const formattedType = formatPropertyType(prop.propertyType);
        const typeWidth = helveticaFont.widthOfTextAtSize(formattedType, 8);
        page.drawText(stripEmojis(formattedType), {
          x: PAGE_WIDTH - MARGIN_RIGHT - typeWidth - 10,
          y: yPos - 15,
          size: 8,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        // Metrics row 1
        const metricsY = yPos - 40;
        const metricWidth = CONTENT_WIDTH / 5;
        
        // Value
        page.drawText('Value', {
          x: MARGIN_LEFT + 10,
          y: metricsY + 10,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        page.drawText(formatCurrency(prop.value), {
          x: MARGIN_LEFT + 10,
          y: metricsY - 3,
          size: 9,
          font: helveticaBold,
          color: SECONDARY_COLOR,
        });
        
        // Equity
        page.drawText('Equity', {
          x: MARGIN_LEFT + 10 + metricWidth,
          y: metricsY + 10,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        page.drawText(formatCurrency(prop.equity), {
          x: MARGIN_LEFT + 10 + metricWidth,
          y: metricsY - 3,
          size: 9,
          font: helveticaBold,
          color: SUCCESS_COLOR,
        });
        
        // LVR
        page.drawText('LVR', {
          x: MARGIN_LEFT + 10 + metricWidth * 2,
          y: metricsY + 10,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        const lvrValue = parseFloat(safeString(prop.lvr, '0').replace('%', '')) || 0;
        const lvrColor = lvrValue <= 60 ? SUCCESS_COLOR : lvrValue <= 80 ? WARNING_COLOR : DANGER_COLOR;
        page.drawText(ensurePercentage(prop.lvr), {
          x: MARGIN_LEFT + 10 + metricWidth * 2,
          y: metricsY - 3,
          size: 9,
          font: helveticaBold,
          color: lvrColor,
        });
        
        // Yield
        page.drawText('Gross Yield', {
          x: MARGIN_LEFT + 10 + metricWidth * 3,
          y: metricsY + 10,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        page.drawText(ensurePercentage(prop.grossYield), {
          x: MARGIN_LEFT + 10 + metricWidth * 3,
          y: metricsY - 3,
          size: 9,
          font: helveticaBold,
          color: PRIMARY_COLOR,
        });
        
        // Net Cashflow
        page.drawText('Net Cashflow/mo', {
          x: MARGIN_LEFT + 10 + metricWidth * 4,
          y: metricsY + 10,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        const netCashflow = safeNumber(prop.netMonthlyCashflow);
        const cfColor = netCashflow >= 0 ? SUCCESS_COLOR : DANGER_COLOR;
        const cfPrefix = netCashflow >= 0 ? '+' : '';
        page.drawText(`${cfPrefix}${formatCurrency(netCashflow)}`, {
          x: MARGIN_LEFT + 10 + metricWidth * 4,
          y: metricsY - 3,
          size: 9,
          font: helveticaBold,
          color: cfColor,
        });
        
        // Portfolio contribution bar
        const contributionY = metricsY - 25;
        page.drawText('Portfolio Contribution:', {
          x: MARGIN_LEFT + 10,
          y: contributionY,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        const contributionPercent = parseFloat(safeString(prop.portfolioContribution, '0')) || 0;
        const contribBarWidth = 150;
        page.drawRectangle({
          x: MARGIN_LEFT + 110,
          y: contributionY - 5,
          width: contribBarWidth,
          height: 10,
          color: rgb(0.9, 0.9, 0.9),
        });
        page.drawRectangle({
          x: MARGIN_LEFT + 110,
          y: contributionY - 5,
          width: contribBarWidth * (contributionPercent / 100),
          height: 10,
          color: PRIMARY_COLOR,
        });
        page.drawText(safeString(prop.portfolioContribution, '0%'), {
          x: MARGIN_LEFT + 115 + contribBarWidth,
          y: contributionY - 2,
          size: 8,
          font: helveticaBold,
          color: PRIMARY_COLOR,
        });
        
        yPos -= 95;
      }
      
      
      console.log('✓ Property cashflow details page complete');
      
      // ============= PAGE: PROPERTY RANKINGS =============
      console.log('📝 Creating property rankings page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Property Performance Rankings', yPos);
      
      const propertyRankings = safeArray(analysisData.analysis?.propertyRankings);
      for (const prop of propertyRankings) {
        // Check for page break
        if (needsNewPage(yPos, 120)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Property Performance Rankings (continued)', yPos);
        }
        
        // Rank badge
        const rankBadgeColor = prop.rank === 1 ? SUCCESS_COLOR : prop.rank === 2 ? PRIMARY_COLOR : MUTED_COLOR;
        page.drawRectangle({
          x: MARGIN_LEFT,
          y: yPos - 16,
          width: 25,
          height: 20,
          color: rankBadgeColor,
        });
        page.drawText(`#${prop.rank}`, {
          x: MARGIN_LEFT + 6,
          y: yPos - 12,
          size: 10,
          font: helveticaBold,
          color: rgb(1, 1, 1),
        });
        
        // Address
        page.drawText(stripEmojis(safeString(prop.address, 'Unknown Address')), {
          x: MARGIN_LEFT + 35,
          y: yPos - 10,
          size: 10,
          font: helveticaBold,
          color: SECONDARY_COLOR,
        });
        
        // Performance rating badge
        const perfRating = safeString(prop.performanceRating, 'Unknown');
        const ratingColor = perfRating.toLowerCase() === 'strong' ? SUCCESS_COLOR :
                           perfRating.toLowerCase() === 'moderate' ? WARNING_COLOR : DANGER_COLOR;
        const ratingText = stripEmojis(perfRating.toUpperCase());
        const ratingWidth = helveticaBold.widthOfTextAtSize(ratingText, 8);
        page.drawRectangle({
          x: PAGE_WIDTH - MARGIN_RIGHT - ratingWidth - 12,
          y: yPos - 14,
          width: ratingWidth + 12,
          height: 16,
          color: ratingColor,
        });
        page.drawText(ratingText, {
          x: PAGE_WIDTH - MARGIN_RIGHT - ratingWidth - 6,
          y: yPos - 10,
          size: 8,
          font: helveticaBold,
          color: rgb(1, 1, 1),
        });
        
        yPos -= 28;
        
        // Strengths (green)
        const propStrengths = safeArray(prop.strengths);
        if (propStrengths.length > 0) {
          page.drawText('Strengths:', {
            x: MARGIN_LEFT + 10,
            y: yPos,
            size: 8,
            font: helveticaBold,
            color: SUCCESS_COLOR,
          });
          yPos -= 12;
          for (const strength of propStrengths.slice(0, 2)) {
            yPos = drawWrappedText(page, `+ ${safeString(strength, 'N/A')}`, MARGIN_LEFT + 15, yPos, CONTENT_WIDTH - 25, helveticaFont, 8, SECONDARY_COLOR);
          }
        }
        
        // Concerns (amber)
        const propConcerns = safeArray(prop.concerns);
        if (propConcerns.length > 0) {
          page.drawText('Concerns:', {
            x: MARGIN_LEFT + 10,
            y: yPos,
            size: 8,
            font: helveticaBold,
            color: WARNING_COLOR,
          });
          yPos -= 12;
          for (const concern of propConcerns.slice(0, 2)) {
            yPos = drawWrappedText(page, `- ${safeString(concern, 'N/A')}`, MARGIN_LEFT + 15, yPos, CONTENT_WIDTH - 25, helveticaFont, 8, SECONDARY_COLOR);
          }
        }
        
        // Recommendation
        const propRec = safeString(prop.recommendation);
        if (propRec) {
          page.drawText('Recommendation:', {
            x: MARGIN_LEFT + 10,
            y: yPos,
            size: 8,
            font: helveticaBold,
            color: PRIMARY_COLOR,
          });
          yPos -= 12;
          yPos = drawWrappedText(page, propRec, MARGIN_LEFT + 15, yPos, CONTENT_WIDTH - 25, helveticaFont, 8, SECONDARY_COLOR);
        }
        
        // Separator line
        yPos -= 10;
        page.drawLine({
          start: { x: MARGIN_LEFT, y: yPos },
          end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: yPos },
          thickness: 0.5,
          color: rgb(0.9, 0.9, 0.9),
        });
        yPos -= 15;
      }
      
      console.log('✓ Property rankings page complete');
      
      // ============= PAGE: PROPERTY STRATEGIC CONTEXT =============
      const propertyStrategicContext = safeArray(analysisData.analysis?.propertyStrategicContext);
      if (propertyStrategicContext.length > 0) {
        console.log('📝 Creating property strategic context page...');
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
        
        yPos = drawSectionHeader(page, 'Property Strategic Context', yPos);
        
        for (const propCtx of propertyStrategicContext) {
          // Check for page break (each property card ~130px)
          if (needsNewPage(yPos, 140)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, 'Property Strategic Context (continued)', yPos);
          }
          
          // Strategic role badge (draw first to calculate available width for address)
          const roleText = stripEmojis(safeString(propCtx.strategicRole, 'Asset').toUpperCase());
          // Cap role badge width to max 55% of content width
          const maxRoleBadgeWidth = CONTENT_WIDTH * 0.55;
          let roleFontSize = 8;
          let displayRoleText = roleText;
          let roleTextWidth = helveticaBold.widthOfTextAtSize(displayRoleText, roleFontSize) + 14;
          // Shrink font or truncate if badge is too wide
          if (roleTextWidth > maxRoleBadgeWidth) {
            roleFontSize = 7;
            roleTextWidth = helveticaBold.widthOfTextAtSize(displayRoleText, roleFontSize) + 14;
            if (roleTextWidth > maxRoleBadgeWidth) {
              while (displayRoleText.length > 3 && helveticaBold.widthOfTextAtSize(displayRoleText + '...', roleFontSize) + 14 > maxRoleBadgeWidth) {
                displayRoleText = displayRoleText.slice(0, -1);
              }
              displayRoleText = displayRoleText.trim() + '...';
              roleTextWidth = helveticaBold.widthOfTextAtSize(displayRoleText, roleFontSize) + 14;
            }
          }
          page.drawRectangle({
            x: PAGE_WIDTH - MARGIN_RIGHT - roleTextWidth,
            y: yPos - 5,
            width: roleTextWidth,
            height: 18,
            color: PRIMARY_COLOR,
          });
          page.drawText(displayRoleText, {
            x: PAGE_WIDTH - MARGIN_RIGHT - roleTextWidth + 7,
            y: yPos,
            size: roleFontSize,
            font: helveticaBold,
            color: rgb(1, 1, 1),
          });
          
          // Property address (truncate to fit before the badge)
          const maxAddressWidth = CONTENT_WIDTH - roleTextWidth - 15;
          let addressText = stripEmojis(safeString(propCtx.address, 'Property'));
          let addressWidth = helveticaBold.widthOfTextAtSize(addressText, 11);
          if (addressWidth > maxAddressWidth) {
            while (addressText.length > 3 && helveticaBold.widthOfTextAtSize(addressText + '...', 11) > maxAddressWidth) {
              addressText = addressText.slice(0, -1);
            }
            addressText = addressText.trim() + '...';
          }
          page.drawText(addressText, {
            x: MARGIN_LEFT,
            y: yPos,
            size: 11,
            font: helveticaBold,
            color: SECONDARY_COLOR,
          });
          
          yPos -= 22;
          
          // Capital growth analysis
          if (propCtx.capitalGrowthAnalysis) {
            page.drawText('Capital Growth:', {
              x: MARGIN_LEFT + 5,
              y: yPos,
              size: 8,
              font: helveticaBold,
              color: SUCCESS_COLOR,
            });
            yPos -= 14;
            yPos = drawWrappedText(page, propCtx.capitalGrowthAnalysis, MARGIN_LEFT + 5, yPos, CONTENT_WIDTH - 10, helveticaFont, 8, SECONDARY_COLOR, 1.5);
            yPos -= 6;
          }
          
          // Individual outlook
          if (propCtx.individualOutlook) {
            page.drawText('Outlook:', {
              x: MARGIN_LEFT + 5,
              y: yPos,
              size: 8,
              font: helveticaBold,
              color: PRIMARY_COLOR,
            });
            yPos -= 14;
            yPos = drawWrappedText(page, propCtx.individualOutlook, MARGIN_LEFT + 5, yPos, CONTENT_WIDTH - 10, helveticaFont, 8, SECONDARY_COLOR, 1.5);
          }
          
          // Separator
          yPos -= 8;
          page.drawLine({
            start: { x: MARGIN_LEFT, y: yPos },
            end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: yPos },
            thickness: 0.5,
            color: rgb(0.9, 0.9, 0.9),
          });
          yPos -= 15;
        }
        
        console.log('✓ Property strategic context page complete');
      }
      
      // ============= PAGE 5: FINANCIAL HEALTH ANALYSIS =============
      console.log('📝 Creating financial health page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Financial Health Analysis', yPos);
      
      const financialHealth = analysisData.analysis?.financialHealth;
      
      // Status indicators
      const statusItems = [
        { label: 'Cashflow Status', value: safeString(financialHealth?.cashflowStatus, 'N/A') },
        { label: 'Equity Position', value: safeString(financialHealth?.equityPosition, 'N/A') },
        { label: 'Debt Serviceability', value: safeString(financialHealth?.debtServiceability, 'N/A') },
        { label: 'LVR Risk', value: safeString(financialHealth?.lvrRisk, 'N/A') },
      ];
      
      const statusBoxWidth = (CONTENT_WIDTH - 36) / 4;
      const statusBoxHeight = 58;
      let statusX = MARGIN_LEFT;
      
      for (const item of statusItems) {
        const itemVal = item.value.toLowerCase();
        const statusColor = itemVal.includes('strong') || itemVal.includes('healthy') || itemVal === 'low' || itemVal.includes('positive')
          ? SUCCESS_COLOR
          : itemVal.includes('moderate') || itemVal === 'medium' || itemVal.includes('comfortable')
          ? WARNING_COLOR
          : DANGER_COLOR;
        
        page.drawRectangle({
          x: statusX,
          y: yPos - statusBoxHeight,
          width: statusBoxWidth,
          height: statusBoxHeight,
          color: rgb(0.97, 0.97, 0.97),
          borderColor: statusColor,
          borderWidth: 2,
        });
        
        page.drawText(stripEmojis(item.label), {
          x: statusX + BOX_PADDING,
          y: yPos - 18,
          size: 7,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        // Allow longer values with better truncation
        const truncatedValue = item.value.length > 14 ? item.value.substring(0, 12) + '..' : item.value;
        page.drawText(stripEmojis(truncatedValue), {
          x: statusX + BOX_PADDING,
          y: yPos - 42,
          size: 10,
          font: helveticaBold,
          color: statusColor,
        });
        
        statusX += statusBoxWidth + 12;
      }
      
      yPos -= 80;
      
      // Detailed analysis - check page break before drawing
      const detailedAnalysisText = safeString(financialHealth?.analysis, 'No detailed analysis available.');
      const detailedAnalysisHeight = calculateTextHeight(detailedAnalysisText, CONTENT_WIDTH, 9, 16) + SUBSECTION_SPACING + 10;
      if (needsNewPage(yPos, detailedAnalysisHeight)) {
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
        yPos = drawSectionHeader(page, 'Financial Health Analysis (continued)', yPos);
      }
      yPos = drawSubsectionHeader(page, 'Detailed Analysis', yPos);
      yPos = drawFormattedText(page, detailedAnalysisText, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 16);
      yPos -= PARAGRAPH_SPACING;
      
      console.log('✓ Financial health page complete');
      
      // ============= PAGES: COMPREHENSIVE BORROWING CAPACITY ASSESSMENT =============
      // Only include if borrowing capacity data exists AND includeBorrowingCapacity is true
      if (analysisData.borrowingCapacity && includeBorrowingCapacity) {
        console.log('📝 Creating comprehensive borrowing capacity pages...');
        
        // Transform the edge function data into the structured format
        const bcPdfData = transformEdgeFunctionBCData(analysisData.borrowingCapacity);
        
        // Draw all borrowing capacity sections using the shared pdf-lib renderer
        const bcResult = drawBorrowingCapacityPdfLib(
          {
            pdfDoc,
            font: helveticaFont,
            boldFont: helveticaBold,
            addContentPage,
          },
          bcPdfData,
          page,
          yPos,
        );
        
        // Update page and yPos from the renderer
        page = bcResult.page;
        yPos = bcResult.yPos;
        
        console.log('✓ Comprehensive borrowing capacity pages complete');
      }
      
      // ============= PAGE: RISK ASSESSMENT =============
      console.log('📝 Creating risk assessment page...');
      
      // Calculate required space for Risk Assessment section
      const risk = analysisData.analysis?.riskAssessment;
      const marketRisks = safeArray(risk?.marketRisks);
      const mitigationStrategies = safeArray(risk?.mitigationStrategies);
      
      // Estimate space needed: header + badge + table + market risks + mitigation strategies
      const riskTableHeight = 100; // Fixed table size
      const marketRisksHeight = marketRisks.length * 20 + 35; // bullets + header
      const mitigationHeight = mitigationStrategies.length * 20 + 35;
      const totalRiskSectionHeight = 80 + riskTableHeight + marketRisksHeight + mitigationHeight;
      
      // Force new page if insufficient space
      if (needsNewPage(yPos, totalRiskSectionHeight)) {
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
      } else {
        yPos -= SUBSECTION_SPACING;
      }
      
      yPos = drawSectionHeader(page, 'Risk Assessment', yPos);
      
      // Overall risk level badge
      const overallRiskLevel = safeString(risk?.overallRiskLevel, 'Unknown');
      const overallRiskColor = overallRiskLevel.toLowerCase() === 'low' ? SUCCESS_COLOR :
                               overallRiskLevel.toLowerCase() === 'medium' ? WARNING_COLOR : DANGER_COLOR;
      
      page.drawText('Overall Risk Level:', {
        x: MARGIN_LEFT,
        y: yPos,
        size: 10,
        font: helveticaFont,
        color: MUTED_COLOR,
      });
      
      const riskLevelText = stripEmojis(overallRiskLevel.toUpperCase());
      page.drawRectangle({
        x: MARGIN_LEFT + 105,
        y: yPos - 5,
        width: helveticaBold.widthOfTextAtSize(riskLevelText, 12) + 16,
        height: 20,
        color: overallRiskColor,
      });
      page.drawText(riskLevelText, {
        x: MARGIN_LEFT + 113,
        y: yPos,
        size: 12,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });
      
      yPos -= 40;
      
      // Risk categories table - much wider Assessment column (75%) to prevent truncation of descriptive text
      const riskCategories = [
        ['Risk Category', 'Assessment'],
        ['Concentration Risk', safeString(risk?.concentrationRisk, 'N/A')],
        ['Interest Rate Sensitivity', safeString(risk?.interestRateSensitivity, 'N/A')],
        ['Vacancy Risk', safeString(risk?.vacancyRisk, 'N/A')],
      ];
      
      const { lastY: riskTableLastY } = drawTable(page, riskCategories[0], riskCategories.slice(1), MARGIN_LEFT, yPos, [CONTENT_WIDTH * 0.25, CONTENT_WIDTH * 0.75]);
      yPos = riskTableLastY - SUBSECTION_SPACING;
      
      // Market risks - check for page break
      if (marketRisks.length > 0) {
        if (needsNewPage(yPos, marketRisksHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Risk Assessment (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Market Risks', yPos, DANGER_COLOR);
        ({ page, yPos } = drawBulletList(page, marketRisks, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Risk Assessment (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      // Mitigation strategies - check for page break
      if (mitigationStrategies.length > 0) {
        if (needsNewPage(yPos, mitigationHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Risk Assessment (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Mitigation Strategies', yPos, SUCCESS_COLOR);
        ({ page, yPos } = drawBulletList(page, mitigationStrategies, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Risk Assessment (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      console.log('✓ Risk assessment page complete');
      
      // ============= PAGE: INTEREST RATE SENSITIVITY =============
      const rateSensitivity = analysisData.analysis?.interestRateSensitivity;
      if (rateSensitivity) {
        console.log('📝 Creating interest rate sensitivity section...');
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
        
        yPos = drawSectionHeader(page, 'Interest Rate Sensitivity Analysis — Lender Rates', yPos);
        
        // Investment Properties subsection
        const investRates = rateSensitivity.investmentProperties;
        if (investRates) {
          yPos = drawSubsectionHeader(page, 'Investment Properties — Impact on Rental Cashflow', yPos);
          
          const rateKpiWidth = (CONTENT_WIDTH - 20) / 3;
          drawKPIBox(page, 'CURRENT NET CASHFLOW', monthlyFigureOrUnavailable(investRates.currentMonthlyCashflow), MARGIN_LEFT, yPos, rateKpiWidth,
            investRates.currentMonthlyCashflow === null || investRates.currentMonthlyCashflow === undefined
              ? SECONDARY_COLOR
              : safeNumber(investRates.currentMonthlyCashflow) >= 0 ? SUCCESS_COLOR : DANGER_COLOR);
          // The label states the convention. Historical rows are ambiguous —
          // measured across the 14 stored reports, some encode the cashflow
          // AFTER the rise and some the change itself, and both were stored in
          // a field named `...Impact` and drawn under the same label. A row
          // produced deterministically says which it is; a legacy row keeps
          // the wording it was written under rather than being reinterpreted.
          const shockLabel = (delta: string) =>
            investRates.available === undefined ? `IF RATES RISE ${delta}` : `${delta}: MONTHLY CHANGE`;
          drawKPIBox(page, shockLabel('+1%'), monthlyFigureOrUnavailable(investRates.plusOnePercentImpact), MARGIN_LEFT + rateKpiWidth + 10, yPos, rateKpiWidth, WARNING_COLOR);
          drawKPIBox(page, shockLabel('+2%'), monthlyFigureOrUnavailable(investRates.plusTwoPercentImpact), MARGIN_LEFT + (rateKpiWidth + 10) * 2, yPos, rateKpiWidth, DANGER_COLOR);
          
          yPos -= 75;
          
          // Only an explicit `false` hides the figures: a historical row has no
          // `available` flag and its stored numbers still render as they did.
          if (investRates.available === false && investRates.unavailableExplanation) {
            yPos = drawFormattedText(page, investRates.unavailableExplanation, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
            yPos -= PARAGRAPH_SPACING;
          }
          
          if (investRates.commentary) {
            yPos = drawFormattedText(page, investRates.commentary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
            yPos -= PARAGRAPH_SPACING;
          }
        }
        
        // Owner-Occupied Properties subsection (tied to includeOwnerOccupied)
        const ooRates = rateSensitivity.ownerOccupiedProperties;
        if (ooRates && includeOwnerOccupied) {
          if (needsNewPage(yPos, 180)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
          }
          
          yPos = drawSubsectionHeader(page, 'Owner-Occupied Properties — Impact on Home Loan Repayments', yPos, PRIMARY_COLOR);
          
          const rateKpiWidth = (CONTENT_WIDTH - 20) / 3;
          drawKPIBox(page, 'CURRENT REPAYMENT', monthlyFigureOrUnavailable(ooRates.currentMonthlyRepayment), MARGIN_LEFT, yPos, rateKpiWidth, SECONDARY_COLOR);
          const ooShockLabel = (delta: string) =>
            ooRates.available === undefined ? `IF RATES RISE ${delta}` : `${delta}: MONTHLY CHANGE`;
          drawKPIBox(page, ooShockLabel('+1%'), monthlyFigureOrUnavailable(ooRates.plusOnePercentImpact), MARGIN_LEFT + rateKpiWidth + 10, yPos, rateKpiWidth, WARNING_COLOR);
          drawKPIBox(page, ooShockLabel('+2%'), monthlyFigureOrUnavailable(ooRates.plusTwoPercentImpact), MARGIN_LEFT + (rateKpiWidth + 10) * 2, yPos, rateKpiWidth, DANGER_COLOR);
          
          yPos -= 75;
          
          if (ooRates.available === false && ooRates.unavailableExplanation) {
            yPos = drawFormattedText(page, ooRates.unavailableExplanation, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
            yPos -= PARAGRAPH_SPACING;
          }
          
          if (ooRates.commentary) {
            yPos = drawFormattedText(page, ooRates.commentary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
            yPos -= PARAGRAPH_SPACING;
          }
        }
        
        // Combined commentary
        if (rateSensitivity.combinedCommentary) {
          if (needsNewPage(yPos, 80)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
          }
          yPos = drawSubsectionHeader(page, 'Overall Impact Summary', yPos);
          yPos = drawFormattedText(page, rateSensitivity.combinedCommentary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= SECTION_SPACING;
        }
        
        console.log('✓ Interest rate sensitivity section complete');
      }
      
      // ============= PAGE: MARKET CONDITIONS =============
      const marketConditions = analysisData.analysis?.marketConditions;
      if (marketConditions) {
        console.log('📝 Creating market conditions section...');
        
        if (needsNewPage(yPos, 250)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
        }
        yPos = drawSectionHeader(page, 'Market Conditions & Outlook', yPos);
        
        if (marketConditions.marketCycleSummary) {
          const mcHeight = calculateTextHeight(marketConditions.marketCycleSummary, CONTENT_WIDTH, 9, 15) + SUBSECTION_SPACING + 10;
          if (needsNewPage(yPos, mcHeight)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, 'Market Conditions & Outlook (continued)', yPos);
          }
          yPos = drawSubsectionHeader(page, 'Market Cycle', yPos);
          yPos = drawFormattedText(page, marketConditions.marketCycleSummary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= PARAGRAPH_SPACING;
        }
        
        if (marketConditions.rbaOutlook) {
          const rbaHeight = calculateTextHeight(marketConditions.rbaOutlook, CONTENT_WIDTH, 9, 15) + SUBSECTION_SPACING + 10;
          if (needsNewPage(yPos, rbaHeight)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, 'Market Conditions & Outlook (continued)', yPos);
          }
          yPos = drawSubsectionHeader(page, 'RBA Outlook', yPos);
          yPos = drawFormattedText(page, marketConditions.rbaOutlook, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= PARAGRAPH_SPACING;
        }
        
        if (marketConditions.lendingEnvironment) {
          const lendHeight = calculateTextHeight(marketConditions.lendingEnvironment, CONTENT_WIDTH, 9, 15) + SUBSECTION_SPACING + 10;
          if (needsNewPage(yPos, lendHeight)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, 'Market Conditions & Outlook (continued)', yPos);
          }
          yPos = drawSubsectionHeader(page, 'Lending & Credit Environment', yPos);
          yPos = drawFormattedText(page, marketConditions.lendingEnvironment, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= PARAGRAPH_SPACING;
        }
        
        if (marketConditions.clientPositioning) {
          const cpHeight = calculateTextHeight(marketConditions.clientPositioning, CONTENT_WIDTH, 9, 15) + SUBSECTION_SPACING + 10;
          if (needsNewPage(yPos, cpHeight)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, 'Market Conditions & Outlook (continued)', yPos);
          }
          yPos = drawSubsectionHeader(page, 'Your Positioning', yPos, PRIMARY_COLOR);
          yPos = drawFormattedText(page, marketConditions.clientPositioning, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= SECTION_SPACING;
        }
        
        console.log('✓ Market conditions section complete');
      }
      
      // ============= PAGE: GROWTH OPPORTUNITIES =============
      console.log('📝 Creating growth opportunities page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Growth Opportunities', yPos);
      
      const growth = analysisData.analysis?.growthOpportunities;
      
      // Equity Release Options
      const equityReleaseOptions = safeArray(growth?.equityReleaseOptions);
      if (equityReleaseOptions.length > 0) {
        const equityHeight = equityReleaseOptions.length * 22 + 35;
        if (needsNewPage(yPos, equityHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Growth Opportunities (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Equity Release Options', yPos);
        ({ page, yPos } = drawBulletList(page, equityReleaseOptions, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Growth Opportunities (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      // Refinancing Opportunities
      const refinancingOpportunities = safeArray(growth?.refinancingOpportunities);
      if (refinancingOpportunities.length > 0) {
        const refinanceHeight = refinancingOpportunities.length * 22 + 35;
        if (needsNewPage(yPos, refinanceHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Growth Opportunities (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Refinancing Opportunities', yPos);
        ({ page, yPos } = drawBulletList(page, refinancingOpportunities, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Growth Opportunities (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      // Next Purchase Recommendations
      const nextPurchaseRecs = safeArray(growth?.nextPurchaseRecommendations);
      if (nextPurchaseRecs.length > 0) {
        const nextPurchaseHeight = nextPurchaseRecs.length * 22 + 35;
        if (needsNewPage(yPos, nextPurchaseHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Growth Opportunities (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Next Purchase Recommendations', yPos, PRIMARY_COLOR);
        ({ page, yPos } = drawBulletList(page, nextPurchaseRecs, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Growth Opportunities (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      // Optimization Strategies
      const optimizationStrategies = safeArray(growth?.optimizationStrategies);
      if (optimizationStrategies.length > 0) {
        const optimizeHeight = optimizationStrategies.length * 22 + 35;
        if (needsNewPage(yPos, optimizeHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Growth Opportunities (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Portfolio Optimization Strategies', yPos);
        ({ page, yPos } = drawBulletList(page, optimizationStrategies, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Growth Opportunities (continued)'));
        yPos -= PARAGRAPH_SPACING;
      }
      
      console.log('✓ Growth opportunities page complete');
      
      // ============= PAGE 8: 10-YEAR PROJECTIONS =============
      console.log('📝 Creating projections page...');
      
      if (needsNewPage(yPos, 200)) {
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
      } else {
        yPos -= 25;
      }
      
      const projections = analysisData.analysis?.projections;
      const projYears = safeNumber(projections?.years, 10);
      yPos = drawSectionHeader(page, `${projYears}-Year Portfolio Projections`, yPos);
      
      // Projection KPI boxes with layperson-friendly labels
      const projKpiWidth = (CONTENT_WIDTH - 20) / 3;
      const projValue = projections?.projectedPortfolioValue;
      const projEquity = projections?.projectedEquity;
      drawKPIBox(page, 'ESTIMATED TOTAL VALUE', projValue === null || projValue === undefined ? 'Not available' : formatCurrency(projValue), MARGIN_LEFT, yPos, projKpiWidth, PRIMARY_COLOR);
      drawKPIBox(page, 'ESTIMATED EQUITY (WHAT YOU OWN)', projEquity === null || projEquity === undefined ? 'Not available' : formatCurrency(projEquity), MARGIN_LEFT + projKpiWidth + 10, yPos, projKpiWidth, SUCCESS_COLOR);
      // Cashflow is deliberately not projected — the assumptions list below
      // states why, so the box says what happened rather than showing $0/mo.
      drawKPIBox(page, 'ESTIMATED MONTHLY INCOME', projections?.projectedMonthlyCashflow === null || projections?.projectedMonthlyCashflow === undefined ? 'Not projected' : formatCurrency(projections.projectedMonthlyCashflow) + '/mo', MARGIN_LEFT + (projKpiWidth + 10) * 2, yPos, projKpiWidth);
      
      yPos -= 85;
      
      // Plain English summary
      if (projections?.plainEnglishSummary) {
        yPos = drawSubsectionHeader(page, 'What This Means For You', yPos, PRIMARY_COLOR);
        yPos = drawFormattedText(page, projections.plainEnglishSummary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
        yPos -= PARAGRAPH_SPACING;
      }
      
      // Assumptions
      const assumptions = safeArray(projections?.assumptions);
      if (assumptions.length > 0) {
        const assumptionsHeight = assumptions.length * 18 + 35;
        if (needsNewPage(yPos, assumptionsHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
        }
        yPos = drawSubsectionHeader(page, 'Key Assumptions', yPos);
        ({ page, yPos } = drawBulletList(page, assumptions, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Portfolio Projections (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      console.log('✓ Projections page complete');
      
      // ============= PAGE: 12-MONTH ACTION PLAN =============
      const actionPlan = analysisData.analysis?.actionPlan;
      if (actionPlan) {
        console.log('📝 Creating 12-month action plan...');
        page = addContentPage();
        yPos = PAGE_HEIGHT - MARGIN_TOP;
        
        yPos = drawSectionHeader(page, '12-Month Action Plan', yPos);
        
        const twelveMonthActions = safeArray(actionPlan.twelveMonthActions);
        if (twelveMonthActions.length > 0) {
          yPos = drawSubsectionHeader(page, 'Priority Actions', yPos, SUCCESS_COLOR);
          ({ page, yPos } = drawNumberedList(page, twelveMonthActions, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 18, '12-Month Action Plan (continued)'));
          yPos -= SUBSECTION_SPACING;
        }
        
        const optimisationScenarios = safeArray(actionPlan.optimisationScenarios);
        if (optimisationScenarios.length > 0) {
          if (needsNewPage(yPos, optimisationScenarios.length * 25 + 40)) {
            page = addContentPage();
            yPos = PAGE_HEIGHT - MARGIN_TOP;
            yPos = drawSectionHeader(page, '12-Month Action Plan (continued)', yPos);
          }
          yPos = drawSubsectionHeader(page, 'Optimisation Scenarios', yPos, PRIMARY_COLOR);
          ({ page, yPos } = drawBulletList(page, optimisationScenarios, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, '12-Month Action Plan (continued)'));
          yPos -= SUBSECTION_SPACING;
        }
        
        console.log('✓ 12-month action plan complete');
      }
      
      // ============= PAGE: BORROWING CAPACITY UTILISATION =============
      const bcUtil = analysisData.analysis?.borrowingCapacityUtilisation;
      if (bcUtil) {
        console.log('📝 Creating borrowing capacity utilisation section...');
        
        if (needsNewPage(yPos, 220)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
        }
        
        yPos = drawSectionHeader(page, 'Borrowing Capacity Utilisation', yPos);
        
        // KPI boxes for capacity utilisation
        const bcuKpiWidth = (CONTENT_WIDTH - 20) / 3;
        drawKPIBox(page, 'DEBT DEPLOYED', formatCurrency(bcUtil.totalDebtDeployed), MARGIN_LEFT, yPos, bcuKpiWidth, SECONDARY_COLOR);
        drawKPIBox(page, 'ESTIMATED CAPACITY', formatCurrency(bcUtil.estimatedCapacity), MARGIN_LEFT + bcuKpiWidth + 10, yPos, bcuKpiWidth, PRIMARY_COLOR);
        drawKPIBox(page, 'AVAILABLE CAPACITY', formatCurrency(bcUtil.availableCapacity), MARGIN_LEFT + (bcuKpiWidth + 10) * 2, yPos, bcuKpiWidth, SUCCESS_COLOR);
        
        yPos -= 75;
        
        // Utilisation percentage bar. `utilisationPercentage` is null when the
        // assessment records no positive capacity — safeNumber would make that
        // "0% utilised" on a green bar, which reads as plenty of headroom.
        const utilPercent = bcUtil.utilisationPercentage === null || bcUtil.utilisationPercentage === undefined
          ? null
          : safeNumber(bcUtil.utilisationPercentage, 0);
        const utilColor = utilPercent === null
          ? SECONDARY_COLOR
          : utilPercent < 60 ? SUCCESS_COLOR : utilPercent < 80 ? WARNING_COLOR : DANGER_COLOR;

        page.drawText('Capacity Utilisation:', {
          x: MARGIN_LEFT,
          y: yPos,
          size: 10,
          font: helveticaFont,
          color: MUTED_COLOR,
        });

        page.drawText(utilPercent === null ? 'Not available' : `${utilPercent.toFixed(0)}%`, {
          x: MARGIN_LEFT + 115,
          y: yPos,
          size: 12,
          font: helveticaBold,
          color: utilColor,
        });

        yPos -= 20;

        // Draw utilisation bar — only where there is a percentage to draw.
        if (utilPercent !== null) {
          const barWidth = CONTENT_WIDTH;
          page.drawRectangle({
            x: MARGIN_LEFT,
            y: yPos - 12,
            width: barWidth,
            height: 14,
            color: rgb(0.92, 0.92, 0.92),
          });
          page.drawRectangle({
            x: MARGIN_LEFT,
            y: yPos - 12,
            width: barWidth * Math.min(utilPercent / 100, 1),
            height: 14,
            color: utilColor,
          });
        }

        yPos -= 35;
        
        // Commentary
        if (bcUtil.commentary) {
          yPos = drawFormattedText(page, bcUtil.commentary, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, SECONDARY_COLOR);
          yPos -= SECTION_SPACING;
        }
        
        console.log('✓ Borrowing capacity utilisation complete');
      }
      
      // ============= PAGE: STRATEGIC RECOMMENDATIONS =============
      console.log('📝 Creating strategic recommendations page...');
      page = addContentPage();
      yPos = PAGE_HEIGHT - MARGIN_TOP;
      
      yPos = drawSectionHeader(page, 'Strategic Recommendations', yPos);
      
      const recommendations = analysisData.analysis?.strategicRecommendations;
      
      // Priority Actions (highlighted) - with page break detection
      const priorityActions = safeArray(recommendations?.priorityActions);
      if (priorityActions.length > 0) {
        const actionItemHeight = 28;
        const boxPadding = 18;
        const headerHeight = 32;
        const boxHeight = priorityActions.length * actionItemHeight + headerHeight + boxPadding * 2;
        
        // Check if box fits on current page
        if (needsNewPage(yPos, boxHeight + 20)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Strategic Recommendations', yPos);
        }
        
        page.drawRectangle({
          x: MARGIN_LEFT,
          y: yPos - boxHeight,
          width: CONTENT_WIDTH,
          height: boxHeight,
          color: rgb(0.95, 0.97, 0.95),
          borderColor: SUCCESS_COLOR,
          borderWidth: 1.5,
        });
        
        page.drawText('PRIORITY ACTIONS', {
          x: MARGIN_LEFT + boxPadding,
          y: yPos - headerHeight + 6,
          size: 11,
          font: helveticaBold,
          color: SUCCESS_COLOR,
        });
        
        let actionY = yPos - headerHeight - boxPadding + 2;
        for (let i = 0; i < priorityActions.length; i++) {
          page.drawText(`${i + 1}.`, {
            x: MARGIN_LEFT + boxPadding,
            y: actionY,
            size: 9,
            font: helveticaBold,
            color: PRIMARY_COLOR,
          });
          drawWrappedText(page, safeString(priorityActions[i], 'N/A'), MARGIN_LEFT + boxPadding + 18, actionY, CONTENT_WIDTH - boxPadding * 2 - 24, helveticaFont, 9, SECONDARY_COLOR, 1.5);
          actionY -= actionItemHeight;
        }
        yPos -= boxHeight + SUBSECTION_SPACING;
      }
      
      // Short-Term (0-12 months)
      const shortTerm = safeArray(recommendations?.shortTerm);
      if (shortTerm.length > 0) {
        const shortTermHeight = shortTerm.length * 25 + 35;
        if (needsNewPage(yPos, shortTermHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Strategic Recommendations (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Short-Term (0-12 months)', yPos);
        ({ page, yPos } = drawBulletList(page, shortTerm, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Strategic Recommendations (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      // Medium-Term (1-3 years)
      const mediumTerm = safeArray(recommendations?.mediumTerm);
      if (mediumTerm.length > 0) {
        const mediumTermHeight = mediumTerm.length * 25 + 35;
        if (needsNewPage(yPos, mediumTermHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Strategic Recommendations (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Medium-Term (1-3 years)', yPos);
        ({ page, yPos } = drawBulletList(page, mediumTerm, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Strategic Recommendations (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      // Long-Term (3+ years)
      const longTerm = safeArray(recommendations?.longTerm);
      if (longTerm.length > 0) {
        const longTermHeight = longTerm.length * 25 + 35;
        if (needsNewPage(yPos, longTermHeight)) {
          page = addContentPage();
          yPos = PAGE_HEIGHT - MARGIN_TOP;
          yPos = drawSectionHeader(page, 'Strategic Recommendations (continued)', yPos);
        }
        yPos = drawSubsectionHeader(page, 'Long-Term (3+ years)', yPos);
        ({ page, yPos } = drawBulletList(page, longTerm, MARGIN_LEFT, yPos, CONTENT_WIDTH, 9, 15, 'Strategic Recommendations (continued)'));
        yPos -= SUBSECTION_SPACING;
      }
      
      console.log('✓ Strategic recommendations page complete');
      
      // ============= BRANDED DISCLAIMER & CONTACT PAGE =============
      console.log('📝 Creating branded disclaimer page...');
      const __issuer = resolveReportIssuer({
        companyName: globalSettings?.contactDetails?.company_name,
      });
      const __disclaimer = resolveReportDisclaimer(__issuer, globalSettings?.disclaimer);
      drawPdfLibDisclaimerPage(
        pdfDoc,
        PAGE_WIDTH,
        PAGE_HEIGHT,
        helveticaFont,
        helveticaBold,
        // Who this is issued by — resolved by the one module that answers it,
        // never an invented trading name. See
        // `_shared/reports/issuerIdentity.pure.ts`.
        {
          ...(globalSettings?.contactDetails ?? {
            company_name: '', phone: '', email: '', website: '', address: '', abn: '',
          }),
          company_name: __issuer.name,
        },
        // The wording follows the issuer. This literal used to be the prime's
        // own — a licensed buyer's agent describing a service it performs —
        // printed by any deployment whose settings had not loaded.
        {
          text: __disclaimer.text,
          is_enabled: __disclaimer.text !== '',
          font_size: globalSettings?.disclaimer?.font_size ?? 'small',
        },
      );
      console.log('✓ branded disclaimer page complete');
      
      // ============= PHASE 5: ENHANCED PAGE FOOTERS =============
      const totalPages = pdfDoc.getPageCount();
      const footerCompanyName = globalSettings?.contactDetails?.company_name || '';
      
      for (let i = 0; i < totalPages; i++) {
        const currentPage = pdfDoc.getPage(i);
        const pageNum = i + 1;
        
        // Skip footer on cover page (page 1)
        if (i === 0) {
          continue;
        }
        
        // Header bar removed per user request
        
        // Footer
        currentPage.drawLine({
          start: { x: MARGIN_LEFT, y: 45 },
          end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: 45 },
          thickness: 0.5,
          color: rgb(0.85, 0.85, 0.85),
        });
        
        // Page number centered
        const pageText = `${pageNum} of ${totalPages}`;
        const pageNumWidth = helveticaFont.widthOfTextAtSize(pageText, 8);
        currentPage.drawText(pageText, {
          x: (PAGE_WIDTH - pageNumWidth) / 2,
          y: 28,
          size: 8,
          font: helveticaFont,
          color: MUTED_COLOR,
        });
        
        // Confidential notice on left
        currentPage.drawText('CONFIDENTIAL', {
          x: MARGIN_LEFT,
          y: 28,
          size: 7,
          font: helveticaFont,
          color: rgb(0.75, 0.75, 0.75),
        });
        
        // Client name on right - properly capitalized
        const clientFooter = formatProperName(stripEmojis(analysisData.clientName));
        const clientFooterWidth = helveticaFont.widthOfTextAtSize(clientFooter, 7);
        currentPage.drawText(clientFooter, {
          x: PAGE_WIDTH - MARGIN_RIGHT - clientFooterWidth,
          y: 28,
          size: 7,
          font: helveticaFont,
          color: rgb(0.75, 0.75, 0.75),
        });
      }
      
      console.log('✓ Disclaimer page complete');
      
      // ============= SAVE PDF =============
      console.log('💾 Saving PDF...');
      const pdfBytes = await pdfDoc.save();
      
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const generatedStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Portfolio_Analysis_${clientName.replace(/\s+/g, '_')}_${generatedStamp}.pdf`;
      const storagePath = `portfolio-reports/${clientId}/${fileName}`;
      
      // Upload PDF to Supabase Storage via the authenticated storage proxy.
      let uploadedFilePath: string | null = null;
      {
        console.log('📤 Uploading PDF to storage...');
        try {
          const uploadResult = await secureStorageUpload(
            'client-files',
            storagePath,
            blob,
            { contentType: 'application/pdf', upsert: true, resourceId: clientId }
          );
          
          if (!uploadResult.success) {
            console.error('Storage upload error:', uploadResult.error);
            toast.error('Failed to upload PDF to storage, but will still download locally');
          } else {
            uploadedFilePath = uploadResult.path || storagePath;
            console.log('✓ PDF uploaded to storage:', uploadedFilePath);
          }
        } catch (storageError) {
          console.error('Storage upload exception:', storageError);
        }
      }
      
      // Download the PDF locally and release the object URL after the click.
      {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      
      // Save report metadata to database via the canonical secure function.
      let reportPersisted = false;
      {
        console.log('📊 Saving report metadata to database...');
        try {
          const { error: insertError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'portfolio_analysis_reports',
            clientId: clientId,
            data: {
              client_id: clientId,
              client_name: analysisData.clientName,
              health_score: analysisData.analysis?.executiveSummary?.healthScore || null,
              overall_health: analysisData.analysis?.executiveSummary?.overallHealth || null,
              portfolio_value: analysisData.portfolioMetrics?.totalValue || null,
              total_equity: analysisData.portfolioMetrics?.totalEquity || null,
              net_monthly_cashflow: analysisData.portfolioMetrics?.netMonthlyCashflow || null,
              total_properties: analysisData.portfolioMetrics?.totalProperties || null,
              average_lvr: analysisData.portfolioMetrics?.averageLVR || null,
              average_yield: analysisData.portfolioMetrics?.averageYield || null,
              report_data: analysisData as any,
              pdf_file_path: uploadedFilePath,
              status: 'completed',
            }
          });

          if (insertError) {
            console.error('Failed to save portfolio_analysis_reports metadata:', insertError);
            toast.error('PDF downloaded, but failed to save report history.');
          } else {
            reportPersisted = true;
            console.log('✓ Report saved to portfolio_analysis_reports with PDF path:', uploadedFilePath);

            if (uploadedFilePath) {
              const { error: fileIndexError } = await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_files',
                clientId,
                data: {
                  category: 'report',
                  file_name: fileName,
                  file_path: uploadedFilePath,
                  file_type: 'application/pdf',
                  file_size: blob.size,
                  description: `Portfolio Performance Analysis - ${new Date().toLocaleDateString('en-AU')}`,
                  report_type: 'portfolio',
                },
              });

              if (fileIndexError) {
                console.error('Failed to index report in client_files:', fileIndexError);
                toast.error('Report saved, but file indexing failed.');
              } else {
                console.log('✓ Report indexed in client_files');
              }
            }
          }
        } catch (dbError) {
          console.error('Database save error:', dbError);
          toast.error('PDF downloaded, but report save failed.');
        }
      }

      console.log('✅ PDF generation complete!');
      toast.success(reportPersisted ? 'PDF downloaded and report saved' : 'PDF downloaded locally');
      logReportRenderEvent({ format: 'portfolio', engine: 'browser', source: 'portfolio_pdf_lib', reportId: clientId ?? undefined, entityName: clientName ?? undefined });
      logActivityDirect({
        actionType: 'portfolio_report_generated',
        entityType: 'portfolio_report',
        entityName: clientName,
        metadata: { client_id: clientId, persisted: reportPersisted, include_owner_occupied: includeOwnerOccupied }
      });
      
      addNotification({
        type: 'report_generation_completed',
        title: 'Portfolio Report Ready',
        message: `Portfolio Performance Analysis for ${clientName} is ready`,
        entityId: clientId
      });
      
      onComplete?.();
      
    } catch (error: any) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF: ' + error.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const portfolioEstimate = estimateTokens('report.portfolio-review', {
    aiNarrative: true,
    extraSections: includeBorrowingCapacity ? 1 : 0,
  });

  return (
    <>
      <div className="inline-flex flex-col items-stretch gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={generateAnalysis}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <TrendingUp className="h-4 w-4 mr-2" />
          )}
          {isGenerating ? 'Analyzing...' : 'Portfolio Analysis'}
        </Button>
        <TokenCostEstimate estimate={portfolioEstimate} compact />
      </div>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="w-[94vw] max-w-7xl h-[92vh] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 sm:w-[94vw]">
          <DialogHeader className="px-4 sm:px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center justify-between gap-4 flex-wrap">
              <span>Portfolio Performance Analysis</span>
              <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                <Button 
                  onClick={() => downloadPDF()} 
                  disabled={isDownloading}
                  size="sm"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download & Save PDF
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              Comprehensive analysis of {clientName}'s investment property portfolio
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0 overflow-x-hidden">

            {analysisData && (
              <div id="portfolio-analysis-content" className="min-w-0 max-w-full p-4 sm:p-6 bg-background space-y-6 break-words">
                {/* Header */}
                <div className="text-center border-b pb-4">
                  <h1 className="text-2xl font-bold text-primary">Portfolio Performance Analysis</h1>
                  <p className="text-lg text-muted-foreground">{analysisData.clientName}</p>
                  <p className="text-sm text-muted-foreground">
                    Generated: {new Date(analysisData.generatedAt).toLocaleDateString('en-AU', { 
                      day: 'numeric', month: 'long', year: 'numeric' 
                    })}
                  </p>
                </div>

                {/* Personalised Narrative */}
                {analysisData.analysis?.personalizedNarrative && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="pt-6 space-y-3">
                      {analysisData.analysis.personalizedNarrative.openingStatement && (
                        <p className="text-sm">{analysisData.analysis.personalizedNarrative.openingStatement}</p>
                      )}
                      {analysisData.analysis.personalizedNarrative.portfolioJourney && (
                        <div>
                          <p className="text-sm font-medium text-primary">Portfolio Journey</p>
                          <p className="text-sm text-muted-foreground">{analysisData.analysis.personalizedNarrative.portfolioJourney}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Executive Summary */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Portfolio Health</p>
                        <p className={`text-2xl font-bold ${getHealthColor(analysisData.analysis.executiveSummary.overallHealth)}`}>
                          {analysisData.analysis.executiveSummary.overallHealth}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Health Score</p>
                        <p className="text-3xl font-bold text-primary">
                          {analysisData.analysis.executiveSummary.healthScore}/100
                        </p>
                      </div>
                    </div>
                    
                    <p className="text-sm">{analysisData.analysis.executiveSummary.primaryRecommendation}</p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium text-success flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" /> Key Strengths
                        </p>
                        <ul className="text-sm space-y-1 mt-1">
                          {analysisData.analysis.executiveSummary.keyStrengths.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-warning flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" /> Key Concerns
                        </p>
                        <ul className="text-sm space-y-1 mt-1">
                          {analysisData.analysis.executiveSummary.keyConcerns.map((c, i) => (
                            <li key={i}>• {c}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Portfolio Metrics */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Portfolio Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Value</p>
                        <p className="text-xl font-bold">{formatCurrency(analysisData.portfolioMetrics.totalValue)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Equity</p>
                        <p className="text-xl font-bold text-success">{formatCurrency(analysisData.portfolioMetrics.totalEquity)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Average LVR</p>
                        <p className="text-xl font-bold">{analysisData.portfolioMetrics.averageLVR.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Properties</p>
                        <p className="text-xl font-bold">{analysisData.portfolioMetrics.totalProperties}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Monthly Cashflow</p>
                        <p className={`text-xl font-bold ${analysisData.portfolioMetrics.netMonthlyCashflow >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(analysisData.portfolioMetrics.netMonthlyCashflow)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Avg. Yield</p>
                        <p className="text-xl font-bold">{analysisData.portfolioMetrics.averageYield.toFixed(2)}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* SMSF Properties Summary - Only show if there are SMSF properties */}
                {(analysisData.portfolioMetrics.smsfCount > 0) && (
                  <Card className="border-warning/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Landmark className="h-5 w-5 text-warning" />
                        SMSF Properties Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center mb-4">
                        <div>
                          <p className="text-sm text-muted-foreground">SMSF Properties</p>
                          <p className="text-xl font-bold">{analysisData.portfolioMetrics.smsfCount}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">SMSF Total Value</p>
                          <p className="text-xl font-bold">{formatCurrency(analysisData.portfolioMetrics.smsfTotalValue || 0)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">SMSF Equity</p>
                          <p className="text-xl font-bold text-success">{formatCurrency(analysisData.portfolioMetrics.smsfTotalEquity || 0)}</p>
                        </div>
                      </div>
                      
                      <Separator className="my-3" />
                      
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Shield className="h-4 w-4 text-warning" />
                          Compliance Overview
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/30">
                            <CheckCircle className="h-4 w-4 text-success" />
                            <div>
                              <p className="text-xs text-muted-foreground">Compliant</p>
                              <p className="font-semibold text-success">{analysisData.portfolioMetrics.smsfCompliantCount || 0}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 border border-warning/30">
                            <AlertCircle className="h-4 w-4 text-warning" />
                            <div>
                              <p className="text-xs text-muted-foreground">Pending Audit</p>
                              <p className="font-semibold text-warning">{analysisData.portfolioMetrics.smsfPendingAuditCount || 0}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            <div>
                              <p className="text-xs text-muted-foreground">Non-Compliant</p>
                              <p className="font-semibold text-destructive">{analysisData.portfolioMetrics.smsfNonCompliantCount || 0}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Borrowing Capacity Assessment */}
                {analysisData.borrowingCapacity && (
                  <Card className="border-primary/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        Borrowing Capacity Assessment
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center mb-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Borrowing Capacity</p>
                          <p className="text-xl font-bold">{formatCurrency(analysisData.borrowingCapacity.borrowingCapacity)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Monthly Surplus</p>
                          <p className={`text-xl font-bold ${analysisData.borrowingCapacity.monthlySurplus >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {formatCurrency(analysisData.borrowingCapacity.monthlySurplus)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Serviceability</p>
                          <Badge 
                            variant={
                              analysisData.borrowingCapacity.serviceabilityBand === 'green' ? 'default' :
                              analysisData.borrowingCapacity.serviceabilityBand === 'amber' ? 'secondary' : 'destructive'
                            }
                            className="mt-1"
                          >
                            {analysisData.borrowingCapacity.serviceabilityBand === 'green' ? 'STRONG' :
                             analysisData.borrowingCapacity.serviceabilityBand === 'amber' ? 'MODERATE' : 'LIMITED'}
                          </Badge>
                        </div>
                      </div>
                      
                      <Separator className="my-3" />
                      
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">DTI Ratio</p>
                          <p className={`font-semibold ${
                            analysisData.borrowingCapacity.dtiRatio < 6 ? 'text-success' :
                            analysisData.borrowingCapacity.dtiRatio < 8 ? 'text-warning' : 'text-destructive'
                          }`}>
                            {analysisData.borrowingCapacity.dtiRatio.toFixed(1)}x
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Stress Tested</p>
                          <p className="font-semibold">{formatCurrency(analysisData.borrowingCapacity.stressTestedCapacity)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Assessment Rate</p>
                          <p className="font-semibold">{analysisData.borrowingCapacity.assessmentRate.toFixed(2)}%</p>
                        </div>
                      </div>
                      
                      {analysisData.borrowingCapacity.recommendations.length > 0 && (
                        <>
                          <Separator className="my-3" />
                          <div>
                            <p className="text-sm font-medium flex items-center gap-1 mb-2">
                              <CheckCircle className="h-4 w-4 text-success" /> Recommendations
                            </p>
                            <ul className="text-sm space-y-1">
                              {analysisData.borrowingCapacity.recommendations.slice(0, 3).map((rec, i) => (
                                <li key={i}>• {rec}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                      
                      {analysisData.borrowingCapacity.warnings.length > 0 && (
                        <>
                          <Separator className="my-3" />
                          <div>
                            <p className="text-sm font-medium flex items-center gap-1 mb-2">
                              <AlertTriangle className="h-4 w-4 text-warning" /> Warnings
                            </p>
                            <ul className="text-sm space-y-1">
                              {analysisData.borrowingCapacity.warnings.slice(0, 2).map((warning, i) => (
                                <li key={i}>• {warning}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Property Rankings */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Property Rankings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysisData.analysis.propertyRankings.map((prop) => (
                      <div key={prop.rank} className="border rounded-lg p-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">#{prop.rank}</Badge>
                              <span className="font-medium text-sm">{prop.address}</span>
                            </div>
                            <Badge 
                              variant={prop.performanceRating === 'Star' ? 'default' : 'secondary'}
                              className="mt-1"
                            >
                              {prop.performanceRating}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{prop.recommendation}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Property Strategic Context */}
                {safeArray(analysisData.analysis?.propertyStrategicContext).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Property Strategic Context</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {analysisData.analysis!.propertyStrategicContext!.map((ctx, i) => (
                        <div key={i} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-sm">{ctx.address}</span>
                            <Badge variant="outline">{ctx.strategicRole}</Badge>
                          </div>
                          {ctx.capitalGrowthAnalysis && (
                            <p className="text-xs text-muted-foreground mb-1"><span className="font-medium text-success">Growth:</span> {ctx.capitalGrowthAnalysis}</p>
                          )}
                          {ctx.individualOutlook && (
                            <p className="text-xs text-muted-foreground"><span className="font-medium text-primary">Outlook:</span> {ctx.individualOutlook}</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Risk Assessment */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Risk Assessment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm">Overall Risk Level:</span>
                      <Badge variant={getRiskBadgeVariant(analysisData.analysis.riskAssessment.overallRiskLevel)}>
                        {analysisData.analysis.riskAssessment.overallRiskLevel}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Market Risks</p>
                        <ul className="mt-1 space-y-1">
                          {analysisData.analysis.riskAssessment.marketRisks.map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Mitigation Strategies</p>
                        <ul className="mt-1 space-y-1">
                          {analysisData.analysis.riskAssessment.mitigationStrategies.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Interest Rate Sensitivity — Lender Rates */}
                {analysisData.analysis?.interestRateSensitivity && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Interest Rate Sensitivity — Lender Rates</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Investment Properties */}
                      {analysisData.analysis.interestRateSensitivity.investmentProperties && (
                        <div>
                          <p className="text-sm font-medium mb-2">Investment Properties — Impact on Rental Cashflow</p>
                          <div className="grid grid-cols-3 gap-4 text-center mb-2">
                            <div>
                              <p className="text-xs text-muted-foreground">Current Net Cashflow</p>
                              <p className={`text-lg font-bold ${analysisData.analysis.interestRateSensitivity.investmentProperties.currentMonthlyCashflow === null || analysisData.analysis.interestRateSensitivity.investmentProperties.currentMonthlyCashflow === undefined ? 'text-muted-foreground' : safeNumber(analysisData.analysis.interestRateSensitivity.investmentProperties.currentMonthlyCashflow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.investmentProperties.currentMonthlyCashflow)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {analysisData.analysis.interestRateSensitivity.investmentProperties.available === undefined ? 'If Rates Rise +1%' : '+1%: Monthly Change'}
                              </p>
                              <p className="text-lg font-bold text-warning">
                                {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.investmentProperties.plusOnePercentImpact)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">
                                {analysisData.analysis.interestRateSensitivity.investmentProperties.available === undefined ? 'If Rates Rise +2%' : '+2%: Monthly Change'}
                              </p>
                              <p className="text-lg font-bold text-destructive">
                                {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.investmentProperties.plusTwoPercentImpact)}
                              </p>
                            </div>
                          </div>
                          {analysisData.analysis.interestRateSensitivity.investmentProperties.available === false && analysisData.analysis.interestRateSensitivity.investmentProperties.unavailableExplanation && (
                            <p className="text-xs text-muted-foreground mb-2">{analysisData.analysis.interestRateSensitivity.investmentProperties.unavailableExplanation}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{analysisData.analysis.interestRateSensitivity.investmentProperties.commentary}</p>
                        </div>
                      )}
                      
                      {/* Owner-Occupied Properties */}
                      {includeOwnerOccupied && analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties && (
                        <>
                          <Separator />
                          <div>
                            <p className="text-sm font-medium mb-2">Owner-Occupied Properties — Impact on Home Loan Repayments</p>
                            <div className="grid grid-cols-3 gap-4 text-center mb-2">
                              <div>
                                <p className="text-xs text-muted-foreground">Current Repayment</p>
                                <p className="text-lg font-bold">
                                  {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.currentMonthlyRepayment)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.available === undefined ? 'If Rates Rise +1%' : '+1%: Monthly Change'}
                                </p>
                                <p className="text-lg font-bold text-warning">
                                  {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.plusOnePercentImpact)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">
                                  {analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.available === undefined ? 'If Rates Rise +2%' : '+2%: Monthly Change'}
                                </p>
                                <p className="text-lg font-bold text-destructive">
                                  {monthlyFigureOrUnavailable(analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.plusTwoPercentImpact)}
                                </p>
                              </div>
                            </div>
                            {analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.available === false && analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.unavailableExplanation && (
                              <p className="text-xs text-muted-foreground mb-2">{analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.unavailableExplanation}</p>
                            )}
                            <p className="text-xs text-muted-foreground">{analysisData.analysis.interestRateSensitivity.ownerOccupiedProperties.commentary}</p>
                          </div>
                        </>
                      )}
                      
                      {analysisData.analysis.interestRateSensitivity.combinedCommentary && (
                        <>
                          <Separator />
                          <p className="text-sm text-muted-foreground">{analysisData.analysis.interestRateSensitivity.combinedCommentary}</p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Market Conditions */}
                {analysisData.analysis?.marketConditions && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Market Conditions & Outlook</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {analysisData.analysis.marketConditions.marketCycleSummary && (
                        <div>
                          <p className="font-medium">Market Cycle</p>
                          <p className="text-muted-foreground">{analysisData.analysis.marketConditions.marketCycleSummary}</p>
                        </div>
                      )}
                      {analysisData.analysis.marketConditions.rbaOutlook && (
                        <div>
                          <p className="font-medium">RBA Outlook</p>
                          <p className="text-muted-foreground">{analysisData.analysis.marketConditions.rbaOutlook}</p>
                        </div>
                      )}
                      {analysisData.analysis.marketConditions.lendingEnvironment && (
                        <div>
                          <p className="font-medium">Lending & Credit Environment</p>
                          <p className="text-muted-foreground">{analysisData.analysis.marketConditions.lendingEnvironment}</p>
                        </div>
                      )}
                      {analysisData.analysis.marketConditions.clientPositioning && (
                        <div>
                          <p className="font-medium text-primary">Your Positioning</p>
                          <p className="text-muted-foreground">{analysisData.analysis.marketConditions.clientPositioning}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Projections */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{analysisData.analysis.projections.years}-Year Portfolio Projections</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">Estimated Total Value</p>
                        <p className="text-xl font-bold text-primary">
                          {analysisData.analysis.projections.projectedPortfolioValue === null || analysisData.analysis.projections.projectedPortfolioValue === undefined ? 'Not available' : formatCurrency(analysisData.analysis.projections.projectedPortfolioValue)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Estimated Equity (What You Own)</p>
                        <p className="text-xl font-bold text-success">
                          {analysisData.analysis.projections.projectedEquity === null || analysisData.analysis.projections.projectedEquity === undefined ? 'Not available' : formatCurrency(analysisData.analysis.projections.projectedEquity)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Estimated Monthly Income</p>
                        <p className="text-xl font-bold">
                          {analysisData.analysis.projections.projectedMonthlyCashflow === null || analysisData.analysis.projections.projectedMonthlyCashflow === undefined ? 'Not projected' : formatCurrency(analysisData.analysis.projections.projectedMonthlyCashflow)}
                        </p>
                      </div>
                    </div>
                    {analysisData.analysis.projections.plainEnglishSummary && (
                      <div className="p-3 bg-muted/50 rounded-lg border">
                        <p className="text-sm font-medium text-primary mb-1">What This Means For You</p>
                        <p className="text-sm text-muted-foreground">{analysisData.analysis.projections.plainEnglishSummary}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* 12-Month Action Plan */}
                {analysisData.analysis?.actionPlan && (
                  <Card className="border-primary/30">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">12-Month Action Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {safeArray(analysisData.analysis.actionPlan.twelveMonthActions).length > 0 && (
                        <div>
                          <p className="font-medium text-sm text-success">Priority Actions</p>
                          <ol className="text-sm mt-1 space-y-1 list-decimal list-inside">
                            {analysisData.analysis.actionPlan.twelveMonthActions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {safeArray(analysisData.analysis.actionPlan.optimisationScenarios).length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <p className="font-medium text-sm text-primary">Optimisation Scenarios</p>
                            <ul className="text-sm mt-1 space-y-1">
                              {analysisData.analysis.actionPlan.optimisationScenarios.map((s, i) => (
                                <li key={i}>• {s}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Borrowing Capacity Utilisation */}
                {analysisData.analysis?.borrowingCapacityUtilisation && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Borrowing Capacity Utilisation</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-center mb-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Debt Deployed</p>
                          <p className="text-xl font-bold">{formatCurrency(analysisData.analysis.borrowingCapacityUtilisation.totalDebtDeployed)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Estimated Capacity</p>
                          <p className="text-xl font-bold text-primary">{formatCurrency(analysisData.analysis.borrowingCapacityUtilisation.estimatedCapacity)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Available</p>
                          <p className="text-xl font-bold text-success">{formatCurrency(analysisData.analysis.borrowingCapacityUtilisation.availableCapacity)}</p>
                        </div>
                      </div>
                      {/* A null utilisation means the assessment records no positive
                          capacity. safeNumber would draw that as "0% utilised" on a
                          green bar — plenty of headroom, which is the opposite. */}
                      {analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage === null
                        || analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage === undefined ? (
                        <p className="text-xs text-muted-foreground text-center">Utilisation not available</p>
                      ) : (
                        <>
                          <div className="w-full bg-muted rounded-full h-3 mb-2">
                            <div
                              className={`h-3 rounded-full ${
                                safeNumber(analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage) < 60 ? 'bg-success' :
                                safeNumber(analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage) < 80 ? 'bg-warning' : 'bg-destructive'
                              }`}
                              style={{ width: `${Math.min(safeNumber(analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage), 100)}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground text-center">{safeNumber(analysisData.analysis.borrowingCapacityUtilisation.utilisationPercentage).toFixed(0)}% utilised</p>
                        </>
                      )}
                      {analysisData.analysis.borrowingCapacityUtilisation.commentary && (
                        <p className="text-sm text-muted-foreground mt-3">{analysisData.analysis.borrowingCapacityUtilisation.commentary}</p>
                      )}
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Strategic Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="font-medium text-sm text-primary">Priority Actions</p>
                      <ul className="text-sm mt-1 space-y-1">
                        {analysisData.analysis.strategicRecommendations.priorityActions.map((a, i) => (
                          <li key={i}>• {a}</li>
                        ))}
                      </ul>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="font-medium">Short-Term (0-12m)</p>
                        <ul className="mt-1 space-y-1">
                          {analysisData.analysis.strategicRecommendations.shortTerm.slice(0, 3).map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium">Medium-Term (1-3y)</p>
                        <ul className="mt-1 space-y-1">
                          {analysisData.analysis.strategicRecommendations.mediumTerm.slice(0, 3).map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium">Long-Term (3-10y)</p>
                        <ul className="mt-1 space-y-1">
                          {analysisData.analysis.strategicRecommendations.longTerm.slice(0, 3).map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Footer */}
                <div className="text-center text-xs text-muted-foreground pt-4 border-t">
                  <p>This analysis is for informational purposes only. Please consult with qualified financial advisors.</p>
                  <p>Generated by Property Analytics</p>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

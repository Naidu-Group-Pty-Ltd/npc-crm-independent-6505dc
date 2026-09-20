import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { MarkdownWithFigures } from '@/components/reports/report-view/InvestmentReportMarkdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OVERALL_GRADE_UNAVAILABLE } from '@/lib/reports/market/scoringInputPolicy.pure';
import { presentStoredMarkdown } from '@/lib/reports/investment/derivedHygiene.pure';
import { readEvidenceInventory } from '@/lib/reports/investment/chartEvidence.pure';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { format } from 'date-fns';
import { Download, Edit, MapPin, Calendar, FileText, TrendingUp, Link, AlertCircle, Settings, ChevronDown, Maximize, Minimize, PenLine, Calculator, X, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CASH_FLOW_ANALYSIS_PATH } from '@/lib/navigation/cashFlowOrigin';
import { useIsMobile } from '@/hooks/use-mobile';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { InvestmentReportEditor } from './InvestmentReportEditor';
import { PremiumPdfButton } from './PremiumPdfButton';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { INVESTMENT_REPORT_FORMAT } from '@/lib/reportTemplate/reportFormats';
import { RegenerateWithPerplexityButton } from './RegenerateWithPerplexityButton';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { TierBadge, type ReportTier } from './TierBadge';
import { TierSwitcher } from './TierSwitcher';

interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  report_content: string; // Required for the viewer (lazy-fetched before opening)
  sources_content?: string | null;
  created_at: string;
  current_version?: number;
  status?: string;
  report_tier?: ReportTier;
  parent_report_id?: string | null;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
}

interface InvestmentReportViewerProps {
  report: InvestmentReport | null;
  isOpen: boolean;
  onClose: () => void;
  onReportUpdate?: () => void;
  onOpenOverride?: () => void;
  onTierSwitch?: (newReportId: string, newTier: ReportTier) => void;
}

/**
 * Did this run publish an overall grade?
 *
 * New scores carry the answer (`policy.gradeIssued`) because whether a grade
 * was published is a fact about that run — re-deriving it is how two surfaces
 * come to disagree. Scores issued before the policy carry no stamp, so they
 * fall back to the reading this page has always used and render exactly as
 * they always did: historical reports are preserved, not reinterpreted.
 */
function gradeWasIssued(score: { policy?: { gradeIssued?: boolean }; coverage?: { dataInsufficient?: boolean }; totalScore?: number | null }): boolean {
  if (typeof score?.policy?.gradeIssued === 'boolean') return score.policy.gradeIssued;
  return !(score?.coverage?.dataInsufficient || score?.totalScore == null);
}

export function InvestmentReportViewer({ report, isOpen, onClose, onReportUpdate, onOpenOverride, onTierSwitch }: InvestmentReportViewerProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [editorOpen, setEditorOpen] = useState(false);
  const [includeSources, setIncludeSources] = useState(true);
  const [includeScoring, setIncludeScoring] = useState(true);
  const [showOverrides, setShowOverrides] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Auto-fullscreen on mobile
  useEffect(() => {
    if (isMobile && isOpen) {
      setIsFullscreen(true);
    }
  }, [isMobile, isOpen]);
  
  const currentTier = (report?.report_tier || 'compass') as ReportTier;
  
  // Early return after all hooks
  if (!report) return null;

  const hasOverrides = report.manual_overrides && Object.keys(report.manual_overrides).length > 0;
  const isRegenerating = report.status === 'processing';

  // Field name mapping for display and injection patterns
  const fieldMappings: Record<string, { displayName: string; patterns: RegExp[] }> = {
    'purchasePrice': {
      displayName: 'Purchase Price',
      patterns: [/Purchase Price.*?\$[\d,]+/gi, /Property Value.*?\$[\d,]+/gi]
    },
    'landPrice': {
      displayName: 'Land Price',
      patterns: [/Land Price.*?\$[\d,]+/gi]
    },
    'buildPrice': {
      displayName: 'Build Price',
      patterns: [/Build Price.*?\$[\d,]+/gi]
    },
    'depositValue': {
      displayName: 'Deposit Value',
      patterns: [/Deposit.*?\$[\d,]+(?=\s|$|\)|,)/gi]
    },
    'loanToValueRatio': {
      displayName: 'Loan to Value Ratio',
      patterns: [/LVR.*?[\d.]+%/gi, /Loan to Value.*?[\d.]+%/gi]
    },
    'interestRate': {
      displayName: 'Interest Rate',
      patterns: [/Interest Rate.*?[\d.]+%/gi]
    },
    'capitalGrowth': {
      displayName: 'Capital Growth',
      patterns: [/Capital Growth.*?[\d.]+%/gi]
    },
    'weeklyRent': {
      displayName: 'Weekly Rent',
      patterns: [/Weekly Rent.*?\$[\d,]+/gi]
    },
    'stampDuty': {
      displayName: 'Stamp Duty',
      patterns: [/Stamp Duty.*?\$[\d,]+/gi]
    },
    'bodyCorporateFees': {
      displayName: 'Body Corporate/Strata Fees',
      patterns: [/Body Corporate.*?\$[\d,]+/gi, /Strata Fees.*?\$[\d,]+/gi]
    },
    'councilRates': {
      displayName: 'Council Rates',
      patterns: [/Council Rate.*?\$[\d,]+/gi]
    },
    'waterRates': {
      displayName: 'Water Rate.*?\$[\d,]+',
      patterns: [/Water Rate.*?\$[\d,]+/gi]
    },
    'solicitorFees': {
      displayName: 'Solicitor Fees',
      patterns: [/Solicitor.*?\$[\d,]+/gi, /Legal Fees.*?\$[\d,]+/gi]
    },
    'buildingLandlordInsurance': {
      displayName: 'Building & Landlord Insurance',
      patterns: [
        /Building & Landlord Insurance.*?\$[\d,]+/gi,
        /Building and Landlord Insurance.*?\$[\d,]+/gi,
        /Landlord Insurance.*?\$[\d,]+/gi,
        /Building.*Insurance.*?\$[\d,]+/gi,
        /Insurance.*?\$[\d,]+/gi
      ]
    },
    'propertyManagementFees': {
      displayName: 'Property Management',
      patterns: [/Property Management.*?[\d.]+%/gi]
    },
    'repairsMaintenance': {
      displayName: 'Repairs & Maintenance',
      patterns: [/Repair.*?\$[\d,]+/gi, /Maintenance.*?\$[\d,]+/gi]
    },
    'lettingFees': {
      displayName: 'Letting Fees',
      patterns: [/Letting.*?\$[\d,]+/gi]
    },
  };

  const getOverriddenFields = () => {
    if (!hasOverrides) return [];
    return Object.keys(report.manual_overrides).map(key => ({
      key,
      displayName: fieldMappings[key]?.displayName || key.replace(/([A-Z])/g, ' $1').trim(),
      value: report.manual_overrides[key]
    }));
  };

  const overriddenFields = getOverriddenFields();

  // What the operator reviews on screen is what the client's document is
  // drawn from: the stored content through the same read-path placeholder
  // scrub every renderer applies (`presentStoredMarkdown`), so a "N/A" cell a
  // derived report stored before the write-path hygiene is neither shown here
  // nor printed anywhere.
  const presentedContent = useMemo(
    () => presentStoredMarkdown(
      report.report_content,
      readEvidenceInventory(report as unknown as Record<string, unknown>),
    ),
    [report.report_content],
  );

  // Inject override badges into report content
  const reportContentWithBadges = useMemo(() => {
    if (!showOverrides || !hasOverrides) {
      return presentedContent;
    }

    let contentWithBadges = presentedContent;
    
    // Add badge marker after each overridden field value
    for (const [key, value] of Object.entries(report.manual_overrides)) {
      const mapping = fieldMappings[key];
      if (!mapping) continue;

      for (const pattern of mapping.patterns) {
        contentWithBadges = contentWithBadges.replace(pattern, (match) => {
          // Add a special marker that we'll convert to a badge in the custom component
          return `${match} 🔧OVERRIDE🔧`;
        });
      }
    }

    return contentWithBadges;
  }, [presentedContent, report.manual_overrides, showOverrides, hasOverrides]);

  const handleDownload = () => {
    let content = presentedContent;
    
    // Include sources if toggle is enabled and sources exist
    if (includeSources && report.sources_content) {
      content += report.sources_content;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investment-report-${report.property_address.replace(/[^a-zA-Z0-9]/g, '-')}-${format(new Date(report.created_at), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Log activity
    logActivityDirect({
      actionType: 'report_pdf_downloaded',
      entityType: 'investment_report',
      entityId: report.id,
      entityName: report.property_address,
      metadata: { format: 'txt', source: 'investment_report_viewer' }
    });
  };

  const handleEdit = () => {
    setEditorOpen(true);
  };

  const handleEditorClose = () => {
    setEditorOpen(false);
    onReportUpdate?.();
  };

  // Custom component to render override badges
  const OverrideBadge = () => (
    <Badge 
      variant="secondary" 
      className="ml-2 text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-700"
    >
      <PenLine className="h-3 w-3 mr-1" />
      Edited
    </Badge>
  );

  // Helper to process text and inject override badges
  const processTextWithBadges = (text: string) => {
    if (!text || typeof text !== 'string') return text;
    
    const parts = text.split('🔧OVERRIDE🔧');
    if (parts.length === 1) return text;

    return parts.map((part, index) => (
      <span key={index}>
        {part}
        {index < parts.length - 1 && <OverrideBadge />}
      </span>
    ));
  };

  // Custom markdown components for better styling
  const markdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-bold mt-8 mb-4 text-foreground border-b pb-2">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold mt-6 mb-3 text-primary">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-medium mt-4 mb-2 text-foreground">
        {children}
      </h3>
    ),
    p: ({ children }: any) => (
      <p className="mb-4 leading-relaxed text-foreground">
        {processTextWithBadges(children)}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className="mb-4 space-y-2 list-disc list-inside">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="mb-4 space-y-2 list-decimal list-inside">
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="text-foreground leading-relaxed pl-2">
        {children}
      </li>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-6">
        <table className="min-w-full border-collapse border border-border">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-muted">
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody>
        {children}
      </tbody>
    ),
    tr: ({ children }: any) => (
      <tr className="border-b border-border">
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="border border-border px-4 py-2 text-left font-semibold text-foreground">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-border px-4 py-2 text-foreground">
        {processTextWithBadges(children)}
      </td>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-foreground">
        {children}
      </strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-muted-foreground">
        {children}
      </em>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children }: any) => (
      <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">
        {children}
      </code>
    ),
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className={`${isFullscreen ? 'max-w-[98vw] max-h-[98vh]' : 'max-w-[90vw] max-h-[90vh]'} overflow-hidden flex flex-col transition-all duration-300`}>
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Investment Analysis Report
            </DialogTitle>
          </DialogHeader>

          {/* `overflow-hidden` with no scroller inside it CLIPS — the report
              below the fold had no way to be reached, reported as "it is very
              narrow and no scroll bar in it". `min-h-0` is what lets a flex
              child shrink enough for its own overflow to engage. */}
          <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto">
            {/* Tier Switcher - Prominent Section */}
            <Card className="flex-shrink-0 border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-primary" />
                      <span className="font-medium text-sm">Report Version:</span>
                    </div>
                    <TierSwitcher
                      reportId={report.id}
                      currentTier={currentTier}
                      parentReportId={report.parent_report_id}
                      onTierSwitch={onTierSwitch}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Switch between Compass (full), Briefing (~20 pages), or Snapshot (~5 pages)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Report Header */}
            <Card className="flex-shrink-0">
              <CardHeader className="pb-3">
                {/* The address column declares a basis. `flex: 1 1 0%`
                    contributes zero to the line's hypothetical size, so the
                    button cluster beside it took the width it wanted and the
                    address was handed the leftovers — which is how "6 Acer
                    Court, Bowral NSW 2576" came to wrap one word per line. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-[18rem] space-y-1">
                    <CardTitle className="flex min-w-0 items-start gap-2 text-lg">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0 break-words">{report.property_address}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3 shrink-0" />
                      Generated on {format(new Date(report.created_at), 'PPpp')}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onClose();
                        navigate(`${CASH_FLOW_ANALYSIS_PATH}/${report.id}`);
                      }}
                      className="text-xs"
                    >
                      <Calculator className="h-3 w-3 mr-1" />
                      Cash Flow Analysis
                    </Button>
                    <TierBadge tier={currentTier} size="lg" />
                    {hasOverrides && (
                      <Badge variant="default" className="bg-primary">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Contains Manual Overrides
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Investment Score Display - all tiers */}
                {report.investment_score && !gradeWasIssued(report.investment_score) && (
                  <div className="mt-4 p-4 rounded-lg bg-muted/50 border">
                    <span className="text-sm font-semibold">{OVERALL_GRADE_UNAVAILABLE.heading}</span>
                    <p className="text-sm text-foreground mt-1">{OVERALL_GRADE_UNAVAILABLE.value}</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-prose">
                      {OVERALL_GRADE_UNAVAILABLE.explanation}
                    </p>
                  </div>
                )}
                {report.investment_score && gradeWasIssued(report.investment_score) && (
                  <div className="mt-4 flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-xl font-bold text-xl flex items-center justify-center shadow-sm ${
                        (() => {
                          const grade = report.investment_score.grade?.toUpperCase();
                          if (grade === 'A+' || grade === 'A') return 'bg-success text-foreground dark:text-white';
                          if (grade === 'B+' || grade === 'B') return 'bg-brand-500 text-black';
                          if (grade === 'C+' || grade === 'C') return 'bg-warning text-foreground dark:text-white';
                          return 'bg-destructive text-foreground dark:text-white';
                        })()
                      }`}>
                        {report.investment_score.grade || '—'}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold">Investment Grade</span>
                        <span className="text-xs text-muted-foreground">
                          {report.investment_score.recommendation || 'Score calculated from market, financial & location data'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">Overall Score</span>
                        {report.investment_score.coverage?.dataInsufficient || report.investment_score.totalScore == null ? (
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-semibold text-muted-foreground">Insufficient data</span>
                            <span className="text-[10px] text-muted-foreground">
                              {report.investment_score.coverage?.partialLabel || 'Qualitative review only'}
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <Star className="h-4 w-4 text-brand-500 fill-brand-500" />
                              <span className={`text-2xl font-bold ${
                                (report.investment_score.totalScore || 0) >= 75 ? 'text-success dark:text-success' :
                                (report.investment_score.totalScore || 0) >= 55 ? 'text-brand-600 dark:text-brand-400' :
                                'text-destructive dark:text-destructive'
                              }`}>
                                {report.investment_score.totalScore}
                              </span>
                              <span className="text-sm text-muted-foreground">/100</span>
                            </div>
                            {report.investment_score.coverage && report.investment_score.coverage.coverageRatio < 1 && (
                              <span className="text-[10px] text-muted-foreground mt-0.5">
                                {report.investment_score.coverage.partialLabel}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </CardHeader>
            </Card>

            {/* Manual Overrides Indicator */}
            {hasOverrides && (
              <Collapsible open={showOverrides} onOpenChange={setShowOverrides}>
                <Card className="flex-shrink-0 border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20">
                  <CardHeader className="pb-3">
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <PenLine className="h-4 w-4 text-brand-700 dark:text-brand-300" />
                          <span className="font-semibold text-brand-800 dark:text-brand-200">
                            {overriddenFields.length} Field{overriddenFields.length !== 1 ? 's' : ''} Manually Edited
                          </span>
                        </div>
                        <ChevronDown className={`h-4 w-4 text-brand-700 dark:text-brand-300 transition-transform ${showOverrides ? 'rotate-180' : ''}`} />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {overriddenFields.map(field => (
                          <Badge 
                            key={field.key} 
                            variant="secondary"
                            className="text-xs font-normal bg-brand-100 dark:bg-brand-900/30 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-700"
                          >
                            <PenLine className="h-3 w-3 mr-1" />
                            {field.displayName}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        These values appear with <Badge variant="secondary" className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-800 dark:text-brand-200 border-brand-300 dark:border-brand-700 inline-flex items-center"><PenLine className="h-3 w-3 mr-1" />Edited</Badge> badges in the report content below. Toggle this section to show/hide the badges.
                      </p>
                    </CollapsibleContent>
                  </CardHeader>
                </Card>
              </Collapsible>
            )}

            {/* Report Content */}
            <Card className="flex-1 overflow-hidden flex flex-col">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Analysis Report
                    {isRegenerating && (
                      <Badge variant="secondary" className="ml-2 animate-pulse">
                        Regenerating...
                      </Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-3 w-3" />
                      <span className="text-sm text-muted-foreground">Include scoring</span>
                      <Switch
                        checked={includeScoring}
                        onCheckedChange={setIncludeScoring}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Link className="h-3 w-3" />
                      <span className="text-sm text-muted-foreground">Include sources</span>
                      <Switch
                        checked={includeSources}
                        onCheckedChange={setIncludeSources}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="h-8 w-8"
                        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      >
                        {isFullscreen ? (
                          <Minimize className="h-4 w-4" />
                        ) : (
                          <Maximize className="h-4 w-4" />
                        )}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleEdit}>
                        <Edit className="h-3 w-3 mr-1" />
                        Edit Report
                      </Button>
                      <Button variant="secondary" size="sm" onClick={onOpenOverride}>
                        <Settings className="h-3 w-3 mr-1" />
                        Override Data
                      </Button>
                      <Button variant="default" size="sm" onClick={handleDownload}>
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <Separator className="flex-shrink-0" />
              <CardContent className="p-0 flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="p-4 border-b bg-muted/50 flex-shrink-0 flex flex-wrap items-center gap-2 sm:gap-4">
                  {/* Which template the document comes out in, before the
                      buttons that use it — the same line the report page's
                      export panel leads with. This viewer is the library's
                      main exit and offered no way to see or change it. */}
                  <div className="w-full">
                    <ReportTemplateSelector
                      reportType={INVESTMENT_REPORT_FORMAT.reportType}
                      formatLabel={INVESTMENT_REPORT_FORMAT.label}
                    />
                  </div>
                  {/* ONE client-PDF action. The "legacy layout" generator that
                      used to sit beside it took a different half of the five
                      controls, so the document a client received depended on
                      which button was pressed. This screen offers two of them
                      and passes exactly those two; the other three take the
                      documented defaults rather than a value invented here. */}
                  <ErrorBoundary
                    fallback={
                      <div className="text-sm text-muted-foreground">
                        PDF tools are unavailable for this report.
                      </div>
                    }
                  >
                    <PremiumPdfButton
                      reportId={report.id}
                      propertyAddress={report.property_address}
                      includeSources={includeSources}
                      includeScoring={includeScoring}
                    />
                  </ErrorBoundary>
                  <RegenerateWithPerplexityButton
                    reportId={report.id}
                    propertyAddress={report.property_address}
                    onRegenerated={onReportUpdate}
                    variant="default"
                    size="sm"
                  />
                </div>
                <ScrollArea className="flex-1 min-h-0 p-6">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ErrorBoundary
                      fallback={
                        <div className="rounded-md border border-border bg-muted/40 p-4">
                          <div className="text-sm font-medium text-foreground">Report content couldn’t be displayed.</div>
                          <div className="mt-1 text-sm text-muted-foreground">You can still download the raw report text.</div>
                          <div className="mt-3">
                            <Button variant="outline" size="sm" onClick={handleDownload}>
                              <Download className="h-3 w-3 mr-1" />
                              Download raw text
                            </Button>
                          </div>
                        </div>
                      }
                    >
                      {/* The chart directives drawn, not printed — the same
                          split the report page uses (`viewerFigures.ts`). */}
                      <MarkdownWithFigures content={reportContentWithBadges} components={markdownComponents} />

                      {/* Show sources if they exist */}
                      {report.sources_content && (
                        <div className="mt-8 border-t pt-6">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {report.sources_content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </ErrorBoundary>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      <InvestmentReportEditor
        report={report}
        isOpen={editorOpen}
        onClose={handleEditorClose}
      />
    </>
  );
}
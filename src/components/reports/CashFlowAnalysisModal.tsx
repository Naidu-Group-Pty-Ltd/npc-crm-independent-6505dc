import { useState, useEffect, useMemo, useCallback, useRef } from 'react'; // Enhanced PDF export
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { fetchGlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawJsPDFDisclaimerPage } from '@/utils/pdfDisclaimerPage';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCapability } from '@/hooks/useCapability';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { requestCashFlowPdf } from '@/lib/reports/cashFlow/requestCashFlowPdf';
import {
  assertProjectionComplete,
  describeAssumedInputs,
  evidenceBasisNotes,
  INPUT_FIELD_LABELS,
  landBuildSplit,
  readBaseFinancials,
} from '@/lib/reports/cashFlow/readBaseFinancials';
import { describeGrowth, describeYieldMovement } from '@/lib/cashFlow/yieldNarrative.pure';
import {
  exportBackgroundFor,
  propertySeriesStyle,
  useCashFlowChartTheme,
} from '@/lib/cashFlow/chartTheme';
import { PropertySeriesMarker } from '@/components/cash-flow/PropertySeriesMarker';
import {
  METRICS_UNAVAILABLE_REASON,
  deriveInvestmentMetrics,
  formatBreakEven,
  formatMetricMultiple,
  formatMetricPercent,
  type InvestmentMetrics,
  type MetricsUnavailable,
} from '@/lib/cashFlow/investmentMetrics.pure';
import { toWireComparison, type WireComparison } from '@/lib/reports/cashFlowComparison/toWireComparison';
import {
  CASH_FLOW_ANALYSIS_CLIENT_MS,
  classifyCashFlowAnalysis,
  describeMissingSections,
} from '@/lib/reports/cashFlowComparison/analysisRequest.pure';
import { CashFlowComparisonDownloadButton } from '@/components/cash-flow/modal/CashFlowComparisonDownloadButton';
import { toWireProjection } from '@/lib/reports/cashFlow/toWireProjection';
import { matchStoredScenario } from '@/lib/reports/cashFlow/storedSeriesMatch';
import {
  saveTemplateDocument,
  selectedTemplateFor,
  tryTemplateDocument,
} from '@/lib/reportTemplate/templateDocument';
import { cashFlowFinalKey } from '@/lib/reports/cashFlow/finalDocumentKey';
import { SendToClientModal } from '@/components/reports/SendToClientModal';
import { ArrowLeft, Calculator, Download, TrendingUp, DollarSign, Percent, Home, Save, RotateCcw, BarChart3, Image, GitCompare, X, FileText, Target, Zap, Building, Award, Printer, ChevronDown, ChevronRight, Send, Search, Check } from 'lucide-react';
import { ComposedChart, LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { CashFlowCommandHeader } from '@/components/cash-flow/modal/CashFlowCommandHeader';
import { CashFlowControlPanel } from '@/components/cash-flow/modal/CashFlowControlPanel';
import { CashFlowExportMenu } from '@/components/cash-flow/modal/CashFlowExportMenu';
import { CashFlowKpiStrip } from '@/components/cash-flow/modal/CashFlowKpiStrip';
import { CashFlowPresentationShell } from '@/components/cash-flow/modal/CashFlowPresentationShell';
import type { CashFlowPresentation } from '@/components/cash-flow/modal/types';
import { CashFlowChartsWorkspace } from '@/components/cash-flow/modal/CashFlowChartsWorkspace';
import { AI_PANEL_TITLE, CashFlowAiPanel } from '@/components/cash-flow/modal/CashFlowAiPanel';
import { CashFlowAnalysisFindings } from '@/components/cash-flow/modal/CashFlowAnalysisFindings';
import { CashFlowConstructionPanel } from '@/components/cash-flow/modal/CashFlowConstructionPanel';
import { CashFlowProjectionTable } from '@/components/cash-flow/modal/CashFlowProjectionTable';
import { CashFlowPropertySwitcher } from '@/components/cash-flow/modal/CashFlowPropertySwitcher';
import { CashFlowPeerDetail } from '@/components/cash-flow/modal/CashFlowPeerDetail';
import {
  PROJECTION_TABLE_CLASS,
  PROJECTION_LABEL_HEAD_CLASS,
  PROJECTION_YEAR_HEAD_CLASS,
  PROJECTION_YEAR_CELL_CLASS,
  PROJECTION_YEAR_EDIT_CELL_CLASS,
  PROJECTION_SECTION_LABEL_CELL_CLASS,
  PROJECTION_SECTION_LABEL_INNER_CLASS,
  PROJECTION_TOTAL_LABEL_CELL_CLASS,
  PROJECTION_TOTAL_LABEL_INNER_CLASS,
} from '@/lib/cashFlow/projectionTableGeometry.pure';
import {
  NEGATIVE_FIGURE_INK,
  POSITIVE_FIGURE_INK,
  signedFigureInk,
} from '@/lib/cashFlow/figureInk.pure';
import {
  buildLoanSchedule,
  buildProjection,
  fixedExpenseBase,
  type ProjectionYear,
} from '@/lib/cashFlow/projectionEngine.pure';
import {
  parseFinancialInput,
  hydrateYearlyOverrides,
} from '@/utils/cashFlowDepreciation';
import {
  COMPARISON_CANDIDATE_PAGE_LIMIT,
  COMPARISON_CANDIDATE_PAGE_SIZE,
  COMPARISON_TOTAL_REPORTS,
  MAX_COMPARISON_PEERS,
  comparisonCandidates,
} from '@/lib/cashFlow/comparisonCandidates.pure';

interface InvestmentReport {
  id: string;
  property_address: string;
  financial_calculations?: any;
  manual_overrides?: any;
}

interface CashFlowAnalysisModalProps {
  report: InvestmentReport | null;
  isOpen: boolean;
  onClose: () => void;
  onReportUpdated?: () => void;
  /**
   * Chrome this workspace is drawn inside. `modal` (the default) keeps the
   * original dialog for surfaces that open it over themselves; `page` renders
   * it as the routed drill-down reached from the Cash Flow Analysis list,
   * where `onClose` is the route back rather than a dismissal.
   */
  presentation?: CashFlowPresentation;
  /** Label for the return control shown in page presentation. */
  backLabel?: string;
}

/** The projection row type is the engine's — one shape, one producer. */
type YearlyProjection = ProjectionYear;

// Per-year override fields
interface YearOverrides {
  capitalGrowthRate?: number | null;
  cpiGrowthRate?: number | null;
  propertyMarketValue?: number | null;
  rentalIncome?: number | null;
  propertyExpenses?: number | null;
  interestRate?: number | null;
  interestPayment?: number | null;
  principalPayment?: number | null;
  depreciation?: number | null;
  landTax?: number | null;
}

// All year overrides (years 1-10)
type YearlyOverrides = {
  [year: number]: YearOverrides;
};

// Editable field configuration
// Phase 0 UI/UX non-regression lock: presentational refactors must not alter
// projection, override persistence, export, comparison, AI, send-to-client,
// chart-ref/data, print, or construction-schedule behavior. The imported
// rule list keeps those constraints discoverable for future modal component
// extraction while preserving all runtime logic below.


const EDITABLE_FIELDS = [
  { key: 'capitalGrowthRate', label: 'Capital Growth %', type: 'percent', step: 0.1 },
  { key: 'cpiGrowthRate', label: 'CPI Growth %', type: 'percent', step: 0.1 },
  { key: 'propertyMarketValue', label: 'Property Value $', type: 'currency', step: 1000 },
  { key: 'rentalIncome', label: 'Rental Income $', type: 'currency', step: 100 },
  { key: 'propertyExpenses', label: 'Property Expenses $', type: 'currency', step: 100 },
  { key: 'interestRate', label: 'Interest Rate %', type: 'percent', step: 0.1 },
  { key: 'interestPayment', label: 'Interest Payments $', type: 'currency', step: 100 },
  { key: 'principalPayment', label: 'Principal Payments $', type: 'currency', step: 100 },
  { key: 'depreciation', label: 'Depreciation $', type: 'currency', step: 100 },
  { key: 'landTax', label: 'Land Tax $', type: 'currency', step: 100 },
] as const;

type EditableFieldKey = typeof EDITABLE_FIELDS[number]['key'];

// Template configuration interface for Cash Flow PDF export
interface CashFlowTemplateConfig {
  id: string;
  name: string;
  companyName: string;
  companyNameLine2: string;
  tagline: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  disclaimer: string;
}

// Default Brand configuration for Cash Flow exports
const defaultCashFlowConfig: CashFlowTemplateConfig = {
  id: 'default',
  name: 'Default Template',
  companyName: 'PROPERTY',
  companyNameLine2: 'CONSULTING',
  tagline: 'YOUR DEDICATED PROPERTY PARTNER',
  contactPhone: '',
  contactEmail: '',
  website: '',
  disclaimer: 'This analysis is for informational purposes only and does not constitute financial advice. Projections are estimates based on assumed growth rates.',
};

// Function to load active Cash Flow export template
const loadActiveCashFlowTemplate = async (): Promise<CashFlowTemplateConfig> => {
  try {
    // Fetch active cashflow_export template
    const { data: template, error } = await supabase
      .from('report_structure_templates')
      .select('*')
      .eq('template_type', 'cashflow_export' as any)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching Cash Flow template:', error);
      return defaultCashFlowConfig;
    }

    if (!template) {
      console.log('No active Cash Flow template found, using default');
      return defaultCashFlowConfig;
    }

    // Parse metadata for custom configuration if available
    const metadata = template.metadata as Record<string, any> | null;
    
    if (metadata?.branding) {
      const branding = metadata.branding;
      return {
        id: template.id,
        name: template.name,
        companyName: branding.companyName || defaultCashFlowConfig.companyName,
        companyNameLine2: branding.companyNameLine2 || defaultCashFlowConfig.companyNameLine2,
        tagline: branding.tagline || defaultCashFlowConfig.tagline,
        contactPhone: branding.contactPhone || defaultCashFlowConfig.contactPhone,
        contactEmail: branding.contactEmail || defaultCashFlowConfig.contactEmail,
        website: branding.website || defaultCashFlowConfig.website,
        disclaimer: branding.disclaimer || defaultCashFlowConfig.disclaimer,
      };
    }

    // Template exists but no custom branding - use default with template name
    console.log(`Using template "${template.name}" with default styling`);
    return {
      ...defaultCashFlowConfig,
      id: template.id,
      name: template.name,
    };
  } catch (err) {
    console.error('Failed to load Cash Flow template:', err);
    return defaultCashFlowConfig;
  }
};

export function CashFlowAnalysisModal({ report, isOpen, onClose, onReportUpdated, presentation = 'modal', backLabel = 'Back to Cash Flow Analysis' }: CashFlowAnalysisModalProps) {
  const isPagePresentation = presentation === 'page';
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [isSaving, setIsSaving] = useState(false);
  /** The typeset PDF is a round trip to a render service; the menu says so. */
  const [isExportingServerPdf, setIsExportingServerPdf] = useState(false);
  /**
   * Whether this person has chosen a template for the 10 Year Cash Flow.
   *
   * Read only so the export can *explain itself*. This format is the one whose
   * template cannot always be used — the projection below is recomputed in the
   * browser from the adviser's overrides, and a template renders the stored
   * series — so somebody who chose one and received the standard layout is owed
   * the reason rather than left to think the choice did nothing. The query is
   * the picker's own and is already cached, so this costs no extra request.
   */
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingCell, setEditingCell] = useState<{ year: number; field: EditableFieldKey } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  
  // Chart metric visibility toggles
  const [chartMetrics, setChartMetrics] = useState({
    propertyValue: true,
    equity: true,
    rentalIncome: true,
    cashFlow: true,
    loanBalance: true,
  });
  
  // Per-year overrides state (years 2-10)
  const [yearlyOverrides, setYearlyOverrides] = useState<YearlyOverrides>({});

  // Chart refs for PNG export
  const cashFlowChartRef = useRef<HTMLDivElement>(null);
  const yieldChartRef = useRef<HTMLDivElement>(null);
  const comparisonChartRef = useRef<HTMLDivElement>(null);

  // Cash-Flow Comparisons are commercialised independently of the standard
  // 10-year analysis (Growth+ or the add-on). Without the capability the
  // toggle is removed, comparison mode cannot activate, and neither
  // comparison query effect runs (both are comparisonMode-gated).
  const cashflowComparisonsEnabled = useCapability('cashflow.comparisons').enabled;

  // Comparison mode state - support up to 5 properties (1 primary + 4 comparison)
  const [comparisonMode, setComparisonModeRaw] = useState(false);
  const setComparisonMode = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setComparisonModeRaw((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        return cashflowComparisonsEnabled ? value : false;
      });
    },
    [cashflowComparisonsEnabled],
  );
  useEffect(() => {
    if (!cashflowComparisonsEnabled) setComparisonModeRaw(false);
  }, [cashflowComparisonsEnabled]);
  const [availableReports, setAvailableReports] = useState<InvestmentReport[]>([]);
  const [selectedComparisonReportIds, setSelectedComparisonReportIds] = useState<string[]>([]);
  const [comparisonReports, setComparisonReports] = useState<InvestmentReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  /**
   * Which property's inputs and projection the detail section shows.
   *
   * `null` means the report the adviser opened — the only one with an editable
   * projection, because the per-year overrides are stored against it.
   */
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null);
  const [investorProfile, setInvestorProfile] = useState<'growth' | 'income' | 'balanced'>('balanced');
  
  // AI-powered comparison analysis state
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isGeneratingAiAnalysis, setIsGeneratingAiAnalysis] = useState(false);
  const [savedAnalysisId, setSavedAnalysisId] = useState<string | null>(null);
  const [isSavingAnalysis, setIsSavingAnalysis] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

  // Inputs Summary state
  const [inputsSummaryOpen, setInputsSummaryOpen] = useState(true);
  const [includeInputsSummaryInExport, setIncludeInputsSummaryInExport] = useState(true);
  
  // Land tax exclusion toggle
  const [excludeLandTaxFromCashFlow, setExcludeLandTaxFromCashFlow] = useState(false);

  // Send to Client state
  const [sendToClientOpen, setSendToClientOpen] = useState(false);
  /**
   * The FINAL Cash Flow document already produced in this sitting, filed under
   * the key of the projection it was drawn from — so "Send to Client" points
   * the portal at the same stored object rather than producing it again, and
   * never at a document an override has since made stale (RS-5c.2).
   */
  const [finalCashFlowDocument, setFinalCashFlowDocument] = useState<{
    key: string; storagePath: string; fileName: string;
  } | null>(null);

  // Construction Progress Schedule state
  const [constructionScheduleOpen, setConstructionScheduleOpen] = useState(false);
  const [includeConstructionScheduleInExport, setIncludeConstructionScheduleInExport] = useState(true);
  
  // Chart insight visibility toggles
  const [showCashFlowInsight, setShowCashFlowInsight] = useState(false);
  const [showYieldInsight, setShowYieldInsight] = useState(false);

  // Chart export toggles - individual and global
  const [includeAllChartsInExport, setIncludeAllChartsInExport] = useState(true);
  const [chartExportToggles, setChartExportToggles] = useState({
    cashFlowTrends: true,
    yieldChart: true,
    comparisonChart: true,
  });
  
  // Handler for global charts toggle
  const handleGlobalChartsToggle = (checked: boolean) => {
    setIncludeAllChartsInExport(checked);
    setChartExportToggles({
      cashFlowTrends: checked,
      yieldChart: checked,
      comparisonChart: checked,
    });
  };
  
  // Handler for individual chart toggle
  const handleChartToggle = (chartKey: keyof typeof chartExportToggles, checked: boolean) => {
    const newToggles = { ...chartExportToggles, [chartKey]: checked };
    setChartExportToggles(newToggles);
    // Update global toggle based on individual states
    const allChecked = Object.values(newToggles).every(v => v);
    const noneChecked = Object.values(newToggles).every(v => !v);
    if (allChecked) {
      setIncludeAllChartsInExport(true);
    } else if (noneChecked) {
      setIncludeAllChartsInExport(false);
    }
  };
  
  // Construction Schedule Preset Mode: 'rapid' | 'even' | 'custom'
  type SchedulePreset = 'rapid' | 'even' | 'custom';
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('rapid');
  
  // Custom stage month positions (for 'custom' mode) - stage index (0-5) to month number
  // Default: month 2-7 for stages 1-6
  const [customStageMonths, setCustomStageMonths] = useState<{ [stageIndex: number]: number }>({
    0: 2, // Deposit
    1: 3, // Slab/Base
    2: 4, // Frame
    3: 5, // Lock-up
    4: 6, // Fixing
    5: 7, // Practical Completion
  });

  // Get build type from report (defaults to 'existing_property')
  const buildType = report?.manual_overrides?.buildType || 'existing_property';
  const isNewBuild = buildType === 'new_build';

  // Comparison chart colors for up to 5 properties
  /**
   * The charts' palette, resolved from the design tokens for the theme the
   * reader is actually in. All three chart cards were `bg-white` with an inline
   * `backgroundColor: '#ffffff'` and light-theme greys for the grid and axes.
   */
  const chartTheme = useCashFlowChartTheme();

  // One entry per compared property. The old shape carried a second `cashFlow`
  // colour per property that nothing ever read.
  //
  // A comparison holds five properties and the chart drew them with one solid
  // line and four identical dashes, so four of the five were separated by hue
  // alone. `propertySeriesStyle` gives each slot its own pattern as well, and
  // every surface that names a property reads from this same array — so the
  // table's column head, the switcher and the chart cannot disagree about
  // which line is whose.
  const comparisonSeries = useMemo(
    () => chartTheme.property.map((_, index) => propertySeriesStyle(chartTheme, index)),
    [chartTheme],
  );
  const COMPARISON_COLORS = useMemo(
    () => comparisonSeries.map((style) => ({ value: style.colour })),
    [comparisonSeries],
  );
  /** The style for comparison slot `index`, never falling off the end. */
  const seriesStyleAt = useCallback(
    (index: number) => comparisonSeries[index] ?? propertySeriesStyle(chartTheme, index),
    [comparisonSeries, chartTheme],
  );

  // Initialize overrides from report when modal opens
  useEffect(() => {
    if (report && isOpen) {
      const cfOverrides = report.manual_overrides?.cashFlowYearlyOverrides || {};

      // Hydrate the editable per-year overrides from the persisted record.
      //
      // Saved manual overrides (including manual depreciation edits) are
      // authoritative. We intentionally DO NOT seed the generated
      // `depreciationSchedule` into the override map here: doing so was the
      // root cause of manual depreciation edits reverting after Save/refetch,
      // because the generated figure overwrote the saved value on every open.
      // Years the user has never edited carry no depreciation override and fall
      // back to the generated schedule in the projection calculation below, so
      // schedule changes still flow through for non-edited years.
      const hydratedOverrides = hydrateYearlyOverrides<YearOverrides>(
        cfOverrides as YearlyOverrides,
      );

      setYearlyOverrides(hydratedOverrides);
      setHasChanges(false);
      setEditingCell(null);
      setComparisonMode(false);
      setSelectedComparisonReportIds([]);
      setComparisonReports([]);
      setAiAnalysis(null);
      setSavedAnalysisId(null);
      
      // Load construction stage timing preset from manual_overrides
      setSchedulePreset(report.manual_overrides?.schedulePreset || 'rapid');
      setCustomStageMonths(report.manual_overrides?.customStageMonths || {
        0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7
      });
      
      // Load land tax exclusion setting
      setExcludeLandTaxFromCashFlow(report.manual_overrides?.excludeLandTaxFromCashFlow || false);
    }
  }, [report, isOpen]);

  // Load saved AI analysis when comparison reports are selected
  useEffect(() => {
    if (comparisonMode && report && selectedComparisonReportIds.length > 0) {
      const loadSavedAnalysis = async () => {
        setIsLoadingAnalysis(true);
        try {
          const sortedComparisonIds = [...selectedComparisonReportIds].sort();
          
          const { data, error } = await supabase
            .from('cash_flow_analyses')
            .select('*')
            .eq('primary_report_id', report.id)
            .contains('comparison_report_ids', sortedComparisonIds)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) throw error;
          
          if (data && data.comparison_report_ids.length === sortedComparisonIds.length) {
            setAiAnalysis(data.analysis_data);
            setSavedAnalysisId(data.id);
            setInvestorProfile((data.investor_profile as 'growth' | 'income' | 'balanced') || 'balanced');
            toast({
              title: "Analysis Loaded",
              description: "Previously saved analysis has been loaded.",
            });
          } else {
            setAiAnalysis(null);
            setSavedAnalysisId(null);
          }
        } catch (error) {
          console.error('Error loading saved analysis:', error);
        } finally {
          setIsLoadingAnalysis(false);
        }
      };
      loadSavedAnalysis();
    }
  }, [comparisonMode, report, selectedComparisonReportIds, toast]);

  // Fetch available reports for comparison when comparison mode is enabled.
  //
  // Two things this had wrong, and each on its own emptied the picker.
  //
  // `listOptions.select` is declared "deprecated and deliberately ignored" by
  // `get-investment-reports` — callers cannot define database projections — so
  // asking for `financial_calculations` got the DEFAULT `library` projection,
  // which does not select that column at all. `comparisonCandidates` then
  // rejected every row for having no figures, and the popover read "No
  // properties found." on a library of 1,169 completed reports. The projection
  // built for this page is `cashFlowLibrary`: it resolves the two headline
  // figures server-side into scalars, which is what the cards render and what
  // decides comparability.
  //
  // And the page size defaults to 50. One property has up to twenty completed
  // reports, so the newest fifty rows are a handful of addresses — the picker
  // could never have offered the library even with the right projection. It
  // walks the pages now, in parallel after the first tells it how many there
  // are, bounded so an unbounded library cannot hang the dialog.
  useEffect(() => {
    if (comparisonMode && isOpen && report) {
      let cancelled = false;
      const fetchPage = async (page: number) => {
        const { data, error } = await invokeSecureFunction('get-investment-reports', {
          listMode: true,
          projection: 'cashFlowLibrary',
          listOptions: {
            status: 'completed',
            isArchived: false,
            page,
            pageSize: COMPARISON_CANDIDATE_PAGE_SIZE,
          },
        });
        if (error) throw new Error(error.message);
        return data as { reports?: InvestmentReport[]; pagination?: { totalPages?: number } };
      };

      const fetchReports = async () => {
        setLoadingReports(true);
        try {
          const first = await fetchPage(1);
          const totalPages = Math.min(
            Math.max(1, Number(first?.pagination?.totalPages) || 1),
            COMPARISON_CANDIDATE_PAGE_LIMIT,
          );
          const rest = totalPages > 1
            ? await Promise.all(
                Array.from({ length: totalPages - 1 }, (_, index) => fetchPage(index + 2)),
              )
            : [];
          if (cancelled) return;
          const allReports = [first, ...rest].flatMap(
            (payload) => (payload?.reports || []) as InvestmentReport[],
          );
          // Audit item 16 — the picker listed REPORTS and calls itself a
          // property picker, so one address appeared once per report kind.
          // `comparisonCandidates` keeps only reports that carry figures a
          // comparison can draw, and one entry per property. Measured against
          // production: 1,169 entries become 98, and 984 of the ones removed
          // could not have been compared against at all.
          setAvailableReports(comparisonCandidates(allReports, report.id, report.property_address));
        } catch (error) {
          if (cancelled) return;
          console.error('Error fetching reports for comparison:', error);
          toast({
            title: "Failed to load reports",
            description: "Could not fetch available reports for comparison. Please try again.",
            variant: "destructive",
          });
        } finally {
          if (!cancelled) setLoadingReports(false);
        }
      };
      fetchReports();
      return () => { cancelled = true; };
    }
  }, [comparisonMode, isOpen, report, toast]);

  /**
   * Load the SOURCE figures for the reports the user picked.
   *
   * The candidate rows carry the two headline scalars and nothing else, and
   * `allComparisonProjections` replays a ten-year projection out of
   * `financial_calculations` and `manual_overrides` — council rates, the
   * interest rate, capital growth, the depreciation schedule, every per-year
   * override. Handed a collapsed row it does not fail: it falls back to
   * 0 / 5% / 5.5% and draws a plausible projection of nothing. So a selection
   * is never projected from a list row — it is either hydrated or it is not
   * compared.
   */
  useEffect(() => {
    if (!selectedComparisonReportIds.length) {
      setComparisonReports([]);
      return;
    }
    let cancelled = false;
    const hydrate = async () => {
      try {
        const request = (projection: 'cashFlowComparison' | 'detail') =>
          invokeSecureFunction('get-investment-reports', {
            reportIds: selectedComparisonReportIds,
            projection,
          });
        let { data, error } = await request('cashFlowComparison');
        // A deployment whose edge function predates this projection answers
        // INVALID_REPORT_QUERY. `detail` selects the same two blobs (with the
        // report prose alongside) and has always existed, so a comparison keeps
        // working through a partial rollout instead of silently emptying.
        if (error?.code === 'INVALID_REPORT_QUERY') {
          ({ data, error } = await request('detail'));
        }
        if (error) throw new Error(error.message);
        if (cancelled) return;
        const hydrated = new Map(
          ((data?.reports || []) as InvestmentReport[]).map((row) => [row.id, row]),
        );
        // Selection order, so the comparison columns stay where the user put
        // them; anything the server did not return is left out rather than
        // projected from a row without figures.
        setComparisonReports(
          selectedComparisonReportIds
            .map((id) => hydrated.get(id))
            .filter((row): row is InvestmentReport => Boolean(row)),
        );
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading comparison figures:', error);
        setComparisonReports([]);
        toast({
          title: "Comparison figures unavailable",
          description: "The selected reports could not be loaded. Please try again.",
          variant: "destructive",
        });
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [selectedComparisonReportIds, toast]);

  // Handle adding/removing comparison reports
  const handleToggleComparisonReport = useCallback((reportId: string) => {
    setSelectedComparisonReportIds(prev => {
      if (prev.includes(reportId)) {
        return prev.filter(id => id !== reportId);
      }
      if (prev.length >= MAX_COMPARISON_PEERS) {
        toast({
          title: "Maximum reached",
          description: `You can compare up to ${COMPARISON_TOTAL_REPORTS} properties in total, including this one.`,
          variant: "destructive"
        });
        return prev;
      }
      return [...prev, reportId];
    });
  }, [toast]);

  const handleClearComparisonReports = useCallback(() => {
    setSelectedComparisonReportIds([]);
  }, []);

  const exportChartAsPNG = useCallback(async (chartRef: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!chartRef.current) return;
    
    try {
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: exportBackgroundFor(chartRef.current, chartTheme),
        scale: 2,
      });
      
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      
      toast({
        title: "Chart Exported",
        description: `${filename}.png has been downloaded.`,
      });
    } catch (error) {
      console.error('Error exporting chart:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export chart as PNG.",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Calculate projections for all comparison reports.
  /**
   * Peers go through the SAME reader and the SAME engine as the property this
   * modal has open. They used to go through neither: this block re-read every
   * field with its own cascade, and its loan was flat for ten years under a
   * comment reading "simplified for comparison - no amortization engine" — so
   * a peer's equity, LVR, principal and cash flow were all measured on debt
   * that never reduced, while the subject's reduced. `readBaseFinancials` was
   * already extracted for exactly this reason and the metrics below already
   * call it; the projections did not.
   */
  const allComparisonProjections = useMemo(() => {
    return comparisonReports.map(compReport => {
      const compBase = readBaseFinancials(compReport, new Date().getFullYear());
      const mo = compReport.manual_overrides || {};

      // A generated depreciation schedule is authoritative for a peer too, so
      // it is folded in as a per-year override before the engine runs.
      const cfOverrides: Record<number, YearOverrides> = { ...(mo.cashFlowYearlyOverrides || {}) };
      const compDepSchedule = mo.depreciationSchedule as Record<string | number, number> | undefined;
      if (compDepSchedule) {
        for (let y = 1; y <= 10; y++) {
          const sv = compDepSchedule[y] ?? compDepSchedule[String(y)];
          if (sv != null) cfOverrides[y] = { ...(cfOverrides[y] ?? {}), depreciation: sv };
        }
      }

      const loanSchedule = buildLoanSchedule(compBase, cfOverrides);
      const projections = buildProjection(
        {
          marketValueNow: compBase.marketValueNow || compBase.purchasePrice,
          initialLoanAmount:
            compBase.loanAmount || compBase.purchasePrice * (compBase.loanToValueRatio / 100),
          baseAnnualRent: compBase.weeklyRent * compBase.occupancyRate,
          baseFixedExpenses: fixedExpenseBase(compBase),
          propertyManagementRate: compBase.propertyManagementFees / 100,
          capitalGrowthRate: compBase.capitalGrowth / 100,
          cpiRate: compBase.cpiGrowthRate / 100,
          interestRate: compBase.interestRate / 100,
          taxRate: compBase.taxRate / 100,
          baseDepreciation: compBase.depreciation,
          depreciationSchedule: compBase.depreciationSchedule,
          baseLandTax: compBase.landTax,
        },
        cfOverrides,
        (year) => loanSchedule?.[year - 1] ?? null,
      );

      return { report: compReport, projections };
    });
  }, [comparisonReports]);

  // Extract base financial data from report
  /**
   * The cascade that reads this position now lives in `readBaseFinancials`, and
   * this is a call to it rather than a copy of it.
   *
   * Moved so that the properties in a comparison can be read by the same code as
   * the one this modal has open. They were not: `compBaseData` below reads a
   * shorter, differently-ordered set of the same fields, which is how the
   * primary's return-on-capital came to be divided by a cost base including LMI
   * while every property it was ranked against had theirs divided by one without.
   *
   * The body is unchanged. The only difference is that the current year is
   * passed in.
   */
  const baseFinancialData = useMemo(
    () => (report ? readBaseFinancials(report, new Date().getFullYear()) : null),
    [report],
  );

  // Generate the 10-year loan schedule. `buildLoanSchedule` is shared with the
  // comparison path above, so peers and the subject amortise identically.
  const loanProjections = useMemo(
    () => (baseFinancialData ? buildLoanSchedule(baseFinancialData, yearlyOverrides) : null),
    [baseFinancialData, yearlyOverrides],
  );

  // Get override value for a specific year and field
  const getOverrideValue = useCallback((year: number, field: EditableFieldKey): number | null => {
    return yearlyOverrides[year]?.[field] ?? null;
  }, [yearlyOverrides]);

  // Set override value for a specific year and field
  const setOverrideValue = useCallback((year: number, field: EditableFieldKey, value: number | null) => {
    setYearlyOverrides(prev => {
      const newOverrides = { ...prev };
      if (!newOverrides[year]) {
        newOverrides[year] = {};
      }
      newOverrides[year] = { ...newOverrides[year], [field]: value };
      return newOverrides;
    });
    setHasChanges(true);
  }, []);

  // Handle cell edit start
  const handleCellEditStart = useCallback((year: number, field: EditableFieldKey, currentValue: number) => {
    const overrideValue = getOverrideValue(year, field);
    setEditingCell({ year, field });
    setEditValue(overrideValue !== null ? String(overrideValue) : String(currentValue));
  }, [getOverrideValue]);

  // Handle cell edit commit
  const handleCellEditCommit = useCallback(() => {
    if (!editingCell) return;

    // parseFinancialInput strips currency symbols/commas and returns null for a
    // temporarily-blank field. Zero parses to 0 (a valid override), never null.
    const numValue = parseFinancialInput(editValue);
    if (editValue.trim() !== '' && numValue === null) {
      // Non-empty but unparseable (invalid text) — discard the edit, keep the
      // previously committed value rather than corrupting the override.
      setEditingCell(null);
      return;
    }

    setOverrideValue(editingCell.year, editingCell.field, numValue);
    setEditingCell(null);
  }, [editingCell, editValue, setOverrideValue]);

  // Handle key press in edit mode
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellEditCommit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [handleCellEditCommit]);

  // Save overrides to database
  const handleSaveOverrides = async () => {
    if (!report) return;

    setIsSaving(true);
    try {
      const existingOverrides = report.manual_overrides || {};
      const updatedOverrides = {
        ...existingOverrides,
        cashFlowYearlyOverrides: yearlyOverrides,
        excludeLandTaxFromCashFlow: excludeLandTaxFromCashFlow,
      };

      const { data: updateResult, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId: report.id,
        data: { manual_overrides: updatedOverrides }
      });

      if (error || !updateResult?.success) {
        throw new Error(error?.message || updateResult?.error || 'Failed to save overrides');
      }

      toast({
        title: "Overrides Saved",
        description: "Cash flow analysis overrides have been saved successfully.",
      });

      // Log activity
      logActivityDirect({
        actionType: 'cash_flow_updated',
        entityType: 'cash_flow_analysis',
        entityId: report.id,
        entityName: report.property_address,
        metadata: { overrideKeys: Object.keys(yearlyOverrides), excludeLandTax: excludeLandTaxFromCashFlow }
      });

      setHasChanges(false);
      onReportUpdated?.();
    } catch (error) {
      console.error('Error saving overrides:', error);
      toast({
        title: "Save Failed",
        description: "Failed to save cash flow analysis overrides.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Reset all overrides
  const handleResetOverrides = useCallback(() => {
    setYearlyOverrides({});
    setHasChanges(true);
    setShowResetConfirm(false);
  }, []);

  // Calculate 10-year projections with per-year overrides and amortisation engine
  const projections = useMemo(() => {
    if (!baseFinancialData) return [];

    // One engine, shared with the comparison path below. It carries the audit
    // of the Moranbah report: a rental PROFIT is now taxed (it never was), and
    // letting fees now reach the expense base (they never did). See
    // `src/lib/cashFlow/projectionEngine.pure.ts`.
    return buildProjection(
      {
        marketValueNow: baseFinancialData.marketValueNow || baseFinancialData.purchasePrice,
        initialLoanAmount:
          baseFinancialData.loanAmount ||
          baseFinancialData.purchasePrice * (baseFinancialData.loanToValueRatio / 100),
        baseAnnualRent: baseFinancialData.weeklyRent * baseFinancialData.occupancyRate,
        baseFixedExpenses: fixedExpenseBase(baseFinancialData),
        propertyManagementRate: baseFinancialData.propertyManagementFees / 100,
        capitalGrowthRate: baseFinancialData.capitalGrowth / 100,
        cpiRate: baseFinancialData.cpiGrowthRate / 100,
        interestRate: baseFinancialData.interestRate / 100,
        taxRate: baseFinancialData.taxRate / 100,
        baseDepreciation: baseFinancialData.depreciation,
        depreciationSchedule: baseFinancialData.depreciationSchedule,
        baseLandTax: baseFinancialData.landTax,
        excludeLandTax: excludeLandTaxFromCashFlow,
      },
      yearlyOverrides,
      (year) => loanProjections?.[year - 1] ?? null,
    );
  }, [baseFinancialData, yearlyOverrides, loanProjections, excludeLandTaxFromCashFlow]);

  // Construction Progress Payment Schedule calculation
  interface ConstructionStage {
    stage: string;
    description: string;
    percentage: number;
    buildAmount: number;
    cumulativeDrawn: number;
    landInterest: number;
    buildInterest: number;
    totalMonthlyInterest: number;
    month: number;
  }

  const constructionProgressSchedule = useMemo(() => {
    if (!baseFinancialData) return null;

    // A build figure exists only where the record states one or a land price
    // lets it be derived; a purchase price is not construction expenditure
    // (QA-13), so a schedule cannot be staged over a figure nobody recorded.
    const split = landBuildSplit(baseFinancialData);
    if (split.buildPrice === null) return null;
    const landPrice = split.landPrice ?? 0;
    const buildPrice = split.buildPrice;
    const interestRate = baseFinancialData.interestRate / 100; // Annual rate
    const durationMonths = Math.min(baseFinancialData.constructionDurationMonths || 7, 24);

    // Land interest calculation: Land Cost × Interest Rate / 12
    // This calculates monthly interest on the full land value
    const monthlyLandInterest = landPrice * interestRate / 12;

    // Get custom stage percentages from manual overrides or use defaults
    const stagePercentages = {
      deposit: (report?.manual_overrides?.stageDepositPercent as number) ?? 5,
      slab: (report?.manual_overrides?.stageSlabPercent as number) ?? 15,
      frame: (report?.manual_overrides?.stageFramePercent as number) ?? 20,
      lockup: (report?.manual_overrides?.stageLockupPercent as number) ?? 25,
      fixing: (report?.manual_overrides?.stageFixingPercent as number) ?? 20,
      completion: (report?.manual_overrides?.stageCompletionPercent as number) ?? 15,
    };

    // Build stages - use custom percentages or defaults
    const baseStages = [
      { stage: 'Deposit', description: 'Paid from your funds (not from lender)', percentage: stagePercentages.deposit },
      { stage: 'Slab/Base Stage', description: 'Foundation, slab, ground works', percentage: stagePercentages.slab },
      { stage: 'Frame Stage', description: 'Wall frames, roof trusses, structural frame', percentage: stagePercentages.frame },
      { stage: 'Lock-up Stage', description: 'External walls, windows, doors (can "lock up")', percentage: stagePercentages.lockup },
      { stage: 'Fixing Stage', description: 'Internal linings, plaster, cabinets, fittings', percentage: stagePercentages.fixing },
      { stage: 'Practical Completion', description: 'Final works, painting, finishes', percentage: stagePercentages.completion },
    ];

    // Determine stage months based on preset
    const getStageMonths = (): number[] => {
      if (schedulePreset === 'rapid') {
        // Rapid: stages at months 2-7 (fixed)
        return [2, 3, 4, 5, 6, 7];
      } else if (schedulePreset === 'even') {
        // Even distribution: spread 6 stages across (durationMonths - 1) months
        // Month 1 is always land interest, so stages start at month 2
        const availableMonths = durationMonths - 1; // Exclude month 1
        const numStages = baseStages.length;
        const months: number[] = [];
        
        for (let i = 0; i < numStages; i++) {
          // Distribute evenly: first stage at month 2, last stage at durationMonths
          const month = Math.round(2 + (i * (availableMonths - 1)) / Math.max(1, numStages - 1));
          months.push(Math.min(month, durationMonths));
        }
        return months;
      } else {
        // Custom: use customStageMonths state
        return baseStages.map((_, index) => customStageMonths[index] || (index + 2));
      }
    };

    const stageMonths = getStageMonths();

    // Create a map of month -> array of stage data for that month (supports multiple stages per month)
    const monthToStages: { [month: number]: Array<{ stage: typeof baseStages[0]; index: number }> } = {};
    stageMonths.forEach((month, index) => {
      if (!monthToStages[month]) {
        monthToStages[month] = [];
      }
      monthToStages[month].push({ stage: baseStages[index], index });
    });

    let cumulativeDrawn = 0;
    let totalBuildInterest = 0;
    let totalCombinedRepayment = monthlyLandInterest; // Start with first month land interest

    // Land Interest Charge row (month 1)
    const landInterestRow: ConstructionStage = {
      stage: 'Land Interest Charge',
      description: '',
      percentage: 0,
      buildAmount: landPrice,
      cumulativeDrawn: 0,
      landInterest: Math.round(monthlyLandInterest * 100) / 100,
      buildInterest: 0,
      totalMonthlyInterest: Math.round(monthlyLandInterest * 100) / 100,
      month: 1,
    };

    const stageResults: ConstructionStage[] = [landInterestRow];

    // Build rows for months 2 through durationMonths
    for (let month = 2; month <= durationMonths; month++) {
      const stagesThisMonth = monthToStages[month] || [];
      
      if (stagesThisMonth.length > 0) {
        // This month has one or more stage payments - add a row for each stage
        stagesThisMonth.forEach((stageData) => {
          const s = stageData.stage;
          const buildAmount = (buildPrice * s.percentage) / 100;
          
          // For Deposit stage, no build interest is charged
          // For other stages: Build Interest = (Cumulative Stage Pricing up to and including this stage) × Interest Rate ÷ 12
          const isDeposit = s.stage === 'Deposit';
          
          // Add this stage to cumulative drawn
          cumulativeDrawn += buildAmount;
          
          // Calculate build interest based on the formula:
          // - Deposit: No interest (0)
          // - Slab/Base: (Slab pricing) × Interest Rate ÷ 12
          // - Frame: (Slab + Frame pricing) × Interest Rate ÷ 12
          // - Lock-up: (Slab + Frame + Lock-up pricing) × Interest Rate ÷ 12
          // - Fixing: (Slab + Frame + Lock-up + Fixing pricing) × Interest Rate ÷ 12
          // - Practical Completion: (All stage pricings) × Interest Rate ÷ 12
          // Note: "cumulativeDrawn" at this point includes all stages up to and including current
          // But for interest calc, we exclude the deposit amount
          const depositAmount = (buildPrice * stagePercentages.deposit) / 100;
          const cumulativeForInterest = isDeposit ? 0 : (cumulativeDrawn - depositAmount);
          const buildInterest = isDeposit ? 0 : (cumulativeForInterest * interestRate / 12);
          
          const combinedRepayment = monthlyLandInterest + buildInterest;
          
          totalBuildInterest += buildInterest;
          totalCombinedRepayment += combinedRepayment;

          stageResults.push({
            stage: s.stage,
            description: s.description,
            percentage: s.percentage,
            buildAmount: Math.round(buildAmount * 100) / 100,
            cumulativeDrawn: Math.round(cumulativeDrawn * 100) / 100,
            landInterest: Math.round(monthlyLandInterest * 100) / 100,
            buildInterest: Math.round(buildInterest * 100) / 100,
            totalMonthlyInterest: Math.round(combinedRepayment * 100) / 100,
            month: month,
          });
        });
      } else {
        // No stage this month - interest-only row
        // Use cumulative drawn excluding deposit for interest calculation
        const depositAmount = (buildPrice * stagePercentages.deposit) / 100;
        const cumulativeForInterest = Math.max(0, cumulativeDrawn - depositAmount);
        const buildInterest = cumulativeForInterest * interestRate / 12;
        const combinedRepayment = monthlyLandInterest + buildInterest;
        
        totalBuildInterest += buildInterest;
        totalCombinedRepayment += combinedRepayment;

        stageResults.push({
          stage: '',
          description: '',
          percentage: 0,
          buildAmount: 0,
          cumulativeDrawn: Math.round(cumulativeDrawn * 100) / 100,
          landInterest: Math.round(monthlyLandInterest * 100) / 100,
          buildInterest: Math.round(buildInterest * 100) / 100,
          totalMonthlyInterest: Math.round(combinedRepayment * 100) / 100,
          month: month,
        });
      }
    }

    // Upfront costs
    const tenPercentLand = landPrice * 0.10;
    const fivePercentBuild = buildPrice * 0.05;
    const stampDuty = baseFinancialData.stampDuty || 0;
    const solicitorFees = baseFinancialData.solicitorFees || 0;
    const agentFee = baseFinancialData.agentFee || 0;
    const lmiAmount = baseFinancialData.lmiAmount || 0;
    const totalUpfrontCost = tenPercentLand + fivePercentBuild + stampDuty + solicitorFees + agentFee + lmiAmount;

    // Total interest during construction
    // IMPORTANT: Sum the already-rounded per-row values so the footer total
    // matches what users see when adding the visible monthly column.
    const totalLandInterestRounded = stageResults.reduce((sum, r) => sum + (r.landInterest || 0), 0);
    const totalBuildInterestRounded = stageResults.reduce((sum, r) => sum + (r.buildInterest || 0), 0);
    const totalCombinedRepaymentRounded = stageResults.reduce((sum, r) => sum + (r.totalMonthlyInterest || 0), 0);
    const stagedProgressInterest = Math.round((totalLandInterestRounded + totalBuildInterestRounded) * 100) / 100;

    return {
      landPrice,
      buildPrice,
      totalProject: landPrice + buildPrice,
      interestRate: baseFinancialData.interestRate,
      durationMonths,
      stages: stageResults,
      monthlyLandInterest: Math.round(monthlyLandInterest * 100) / 100,
      totals: {
        landInterest: Math.round(totalLandInterestRounded * 100) / 100,
        buildInterest: Math.round(totalBuildInterestRounded * 100) / 100,
        totalInterest: stagedProgressInterest,
        totalCombinedRepayment: Math.round(totalCombinedRepaymentRounded * 100) / 100,
      },
      upfrontCosts: {
        tenPercentLand,
        fivePercentBuild,
        stampDuty,
        solicitorFees,
        agentFee,
        totalUpfrontCost,
      },
      grandTotal: Math.round((totalUpfrontCost + stagedProgressInterest) * 100) / 100,
    };
  }, [baseFinancialData, report?.manual_overrides, schedulePreset, customStageMonths]);


  // Calculate advanced comparison metrics
  /**
   * The headline metrics, for the property open and for each peer.
   *
   * Both readings go through `readBaseFinancials` and `deriveInvestmentMetrics`
   * — one implementation each. They used to be two: the peers were fed a
   * hand-rolled `compBaseData` that missed `initialCosts.propertyValue`,
   * `initialCosts.stampDuty` and LMI, so a peer's cost base collapsed to a
   * $2,000 solicitor-fee default and its ROI read 160,902%.
   */
  const primaryMetrics = useMemo(() => {
    const read = deriveInvestmentMetrics(projections, baseFinancialData);
    return read.ok ? read.metrics : null;
  }, [projections, baseFinancialData]);

  const allComparisonMetrics = useMemo(() => {
    return allComparisonProjections.map(({ report: compReport, projections: compProjs }) => {
      const compBase = readBaseFinancials(compReport, new Date().getFullYear());
      const read = deriveInvestmentMetrics(compProjs, compBase);
      let metrics: InvestmentMetrics | null = null;
      let unavailable: MetricsUnavailable | null = null;
      if (read.ok === true) {
        metrics = read.metrics;
      } else {
        unavailable = read.reason;
      }
      return {
        report: compReport,
        metrics,
        unavailable,
        projections: compProjs,
      };
    });
  }, [allComparisonProjections]);

  /** Every property whose details can be shown: the open report, then peers. */
  const detailProperties = useMemo(() => {
    if (!report) return [];
    return [
      {
        id: report.id,
        address: report.property_address,
        ...seriesStyleAt(0),
        isPrimary: true,
      },
      ...allComparisonMetrics.map(({ report: compReport }, index) => ({
        id: compReport.id,
        address: compReport.property_address,
        ...seriesStyleAt(index + 1),
        isPrimary: false,
      })),
    ];
  }, [report, allComparisonMetrics, seriesStyleAt]);

  /**
   * The selected peer, or null for the open report.
   *
   * Resolved rather than stored so removing a property from the comparison
   * cannot leave the section showing a property that is no longer in it.
   */
  const selectedPeer = useMemo(() => {
    if (!detailPropertyId || detailPropertyId === report?.id) return null;
    const entry = allComparisonMetrics.find(({ report: r }) => r.id === detailPropertyId);
    if (!entry) return null;
    const index = allComparisonMetrics.indexOf(entry);
    return {
      ...entry,
      ...seriesStyleAt(index + 1),
      inputs: readBaseFinancials(entry.report, new Date().getFullYear()),
    };
  }, [detailPropertyId, report, allComparisonMetrics, seriesStyleAt]);

  /**
   * Which of the eight sections this analysis actually holds.
   *
   * Derived from the analysis rather than read off the response, because a
   * saved analysis is loaded straight from `analysis_data` and never carries
   * the producer's `missingSections` — and a document that is incomplete on
   * generation is still incomplete when it is re-opened a week later. One
   * reading, from the module the producer classifies with.
   */
  const analysisReading = useMemo(
    () => (aiAnalysis ? classifyCashFlowAnalysis(aiAnalysis) : null),
    [aiAnalysis],
  );
  const analysisShortfall = analysisReading ? describeMissingSections(analysisReading.missing) : '';

  /**
   * The properties the analysis is about, for resolving the numbers it uses.
   *
   * The order is the producer's — the open report first, then each comparison
   * — but the resolution does not rely on it: `CashFlowAnalysisFindings` maps a
   * property number through the model's own `finalRankings` and uses this only
   * to turn the address it echoed back into the one on our record.
   */
  const analysisProperties = useMemo(
    () =>
      report
        ? [report, ...comparisonReports].map((r, index) => ({
            number: index + 1,
            address: r.property_address,
          }))
        : [],
    [report, comparisonReports],
  );

  // Generate AI-powered comparison analysis
  const generateAiAnalysis = useCallback(async () => {
    if (!report || comparisonReports.length === 0) return;
    
    setIsGeneratingAiAnalysis(true);
    setAiAnalysis(null);
    
    try {
      const allReportIds = [report.id, ...comparisonReports.map(r => r.id)];
      
      // Prepare projection data for each report
      const projectionData: Record<string, any> = {};
      
      // Add primary report projection summary
      if (projections.length > 0) {
        projectionData[report.id] = {
          year1: projections[1] || {},
          year5: projections[5] || {},
          year10: projections[10] || {},
          metrics: primaryMetrics,
        };
      }
      
      // Add comparison reports projection summaries
      allComparisonProjections.forEach(({ report: compReport, projections: compProjs }) => {
        const compMetrics = allComparisonMetrics.find(m => m.report.id === compReport.id);
        projectionData[compReport.id] = {
          year1: compProjs[1] || {},
          year5: compProjs[5] || {},
          year10: compProjs[10] || {},
          metrics: compMetrics?.metrics || {},
        };
      });
      
      // `invokeSecureFunction` defaults to 60 seconds and this call had no
      // override, so an eight-section analysis over five properties could be
      // abandoned by the browser while the model was still writing it — and
      // the adviser was told it had failed. The number is the producer's, so
      // the two ends cannot drift.
      const { data, error } = await invokeSecureFunction('compare-cash-flow-reports', {
        reportIds: allReportIds,
        projectionData,
        investorProfile,
        timeHorizon: '10 years',
      }, { timeoutMs: CASH_FLOW_ANALYSIS_CLIENT_MS });
      
      if (error) throw error;
      
      if (data?.success && data?.analysis) {
        setAiAnalysis(data.analysis);
        toast({
          title: "AI Analysis Complete",
          description: "Cash flow comparison analysis has been generated.",
        });
      } else {
        throw new Error(data?.error || 'Failed to generate analysis');
      }
    } catch (error: any) {
      console.error('Error generating AI analysis:', error);
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to generate AI comparison analysis.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingAiAnalysis(false);
    }
  }, [report, comparisonReports, projections, primaryMetrics, allComparisonProjections, allComparisonMetrics, investorProfile, toast]);

  // Save AI analysis to database
  const saveAiAnalysis = useCallback(async () => {
    if (!report || !aiAnalysis || comparisonReports.length === 0) return;
    
    setIsSavingAnalysis(true);
    try {
      const sortedComparisonIds = comparisonReports.map(r => r.id).sort();
      
      if (savedAnalysisId) {
        // Update existing
        const { error } = await supabase
          .from('cash_flow_analyses')
          .update({
            analysis_data: aiAnalysis,
            investor_profile: investorProfile,
            updated_at: new Date().toISOString(),
          })
          .eq('id', savedAnalysisId);
        
        if (error) throw error;
        
        logActivityDirect({
          actionType: 'cash_flow_updated',
          entityType: 'cash_flow_analysis',
          entityId: savedAnalysisId,
          entityName: report.property_address,
          metadata: { investor_profile: investorProfile, comparison_count: comparisonReports.length }
        });
        
        toast({
          title: "Analysis Updated",
          description: "Your cash flow analysis has been updated.",
        });
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('cash_flow_analyses')
          .insert({
            primary_report_id: report.id,
            comparison_report_ids: sortedComparisonIds,
            analysis_data: aiAnalysis,
            investor_profile: investorProfile,
          })
          .select('id')
          .single();
        
        if (error) throw error;
        
        setSavedAnalysisId(data.id);
        logActivityDirect({
          actionType: 'cash_flow_created',
          entityType: 'cash_flow_analysis',
          entityId: data.id,
          entityName: report.property_address,
          metadata: { investor_profile: investorProfile, comparison_count: comparisonReports.length }
        });
        
        toast({
          title: "Analysis Saved",
          description: "Your cash flow analysis has been saved and can be viewed later.",
        });
      }
    } catch (error: any) {
      console.error('Error saving AI analysis:', error);
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save the analysis.",
        variant: "destructive"
      });
    } finally {
      setIsSavingAnalysis(false);
    }
  }, [report, aiAnalysis, comparisonReports, savedAnalysisId, investorProfile, toast]);

  const propertyRecommendation = useMemo(() => {
    if (!primaryMetrics || comparisonReports.length === 0 || !report) return null;

    // Calculate profile-specific scores.
    //
    // The projections are the PROPERTY'S own. They used to be closed over from
    // the primary, so under the income profile every peer was scored on the
    // open report's Year-1 gross yield — the one input that distinguishes an
    // income property was identical for all of them.
    const getProfileScore = (
      metrics: InvestmentMetrics,
      projs: YearlyProjection[],
      profile: 'growth' | 'income' | 'balanced',
    ) => {
      
      switch (profile) {
        case 'growth':
          return (
            (metrics.capitalGain / 100000) * 30 +
            (metrics.roi) * 25 +
            (metrics.annualisedRoi ?? 0) * 20 +
            (metrics.equityMultiple) * 25
          );
        case 'income':
          return (
            (metrics.totalCashFlow > 0 ? metrics.totalCashFlow / 1000 : metrics.totalCashFlow / 500) * 35 +
            (metrics.cashOnCash * 10) * 30 +
            ((10 - (metrics.breakEvenYear || 10)) * 10) * 20 +
            (projs[1]?.grossYield || 0) * 15
          );
        case 'balanced':
          return (
            (metrics.capitalGain / 100000) * 20 +
            (metrics.roi) * 15 +
            (metrics.totalCashFlow > 0 ? metrics.totalCashFlow / 1000 : metrics.totalCashFlow / 500) * 25 +
            (metrics.cashOnCash * 10) * 15 +
            (metrics.equityMultiple) * 15 +
            ((10 - (metrics.breakEvenYear || 10)) * 5) * 10
          );
      }
    };

    // A property whose metrics could not be derived is EXCLUDED rather than
    // scored zero: zero is a score, and it would rank an unmeasurable property
    // above a measurable one that is genuinely negative.
    const excluded = allComparisonMetrics.filter(({ metrics }) => !metrics).length;
    const allScores = [
      {
        name: report.property_address.split(',')[0],
        score: getProfileScore(primaryMetrics, projections, investorProfile),
        isPrimary: true,
        metrics: primaryMetrics
      },
      ...allComparisonMetrics
        .filter((entry): entry is typeof entry & { metrics: InvestmentMetrics } => Boolean(entry.metrics))
        .map(({ report: compReport, metrics, projections: compProjs }) => ({
          name: compReport.property_address.split(',')[0],
          score: getProfileScore(metrics, compProjs, investorProfile),
          isPrimary: false,
          metrics
        }))
    ].sort((a, b) => b.score - a.score);

    const winner = allScores[0];
    const scoreDiff = allScores.length > 1 ? allScores[0].score - allScores[1].score : 0;
    const confidence = scoreDiff > 50 ? 'high' : scoreDiff > 20 ? 'moderate' : 'marginal';

    return {
      winner: winner.name,
      rankings: allScores.map((s, i) => ({ rank: i + 1, name: s.name, score: Math.round(s.score) })),
      confidence,
      excluded,
      insights: [
        `${winner.name} scores highest for ${investorProfile}-focused investors`,
        winner.metrics?.roi ? `10-Year ROI: ${winner.metrics.roi.toFixed(1)}%` : '',
        winner.metrics?.totalCashFlow ? `Total Cash Flow: $${winner.metrics.totalCashFlow.toLocaleString('en-AU')}` : '',
        excluded ? `${excluded} propert${excluded === 1 ? 'y is' : 'ies are'} not ranked — no cost base recorded` : ''
      ].filter(Boolean).slice(0, 4)
    };
  }, [primaryMetrics, allComparisonMetrics, report, comparisonReports, investorProfile, projections]);

  // PDF Export function for comparison (supports multiple properties)
  const exportComparisonPDF = useCallback(async (options?: { returnBlob?: boolean }): Promise<Blob | void> => {
    if (!report || comparisonReports.length === 0) return;

    try {
      toast({
        title: "Generating PDF",
        description: "Please wait while charts are being captured...",
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let yPos = margin;

      // Title
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Cash Flow Analysis Comparison', pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;

      // Properties being compared
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Property 1 (Primary): ${report.property_address}`, margin, yPos);
      yPos += 5;
      comparisonReports.forEach((compReport, idx) => {
        pdf.text(`Property ${idx + 2}: ${compReport.property_address}`, margin, yPos);
        yPos += 5;
      });
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-AU')}`, margin, yPos);
      yPos += 10;

      // Capture and add charts
      const chartRefs = [
        { ref: cashFlowChartRef, title: 'Cash Flow Trends' },
        { ref: yieldChartRef, title: 'Yield Percentages' },
        { ref: comparisonChartRef, title: 'Property Comparison' }
      ];

      for (const chart of chartRefs) {
        if (chart.ref.current) {
          const canvas = await html2canvas(chart.ref.current, {
            backgroundColor: exportBackgroundFor(chart.ref.current, chartTheme),
            scale: 2,
          });
          
          const imgData = canvas.toDataURL('image/png');
          const imgWidth = pageWidth - (margin * 2);
          const imgHeight = (canvas.height * imgWidth) / canvas.width;

          if (yPos + imgHeight > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }

          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text(chart.title, margin, yPos);
          yPos += 5;
          
          pdf.addImage(imgData, 'PNG', margin, yPos, imgWidth, imgHeight);
          yPos += imgHeight + 10;
        }
      }

      // Add comparison metrics table
      pdf.addPage();
      yPos = margin;

      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Investment Comparison Metrics', pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;

      const formatValue = (value: number | null | undefined, format: string) => {
        if (value === null || value === undefined) return 'N/A';
        switch (format) {
          case 'currency': return `$${Math.round(value).toLocaleString('en-AU')}`;
          case 'percent': return `${value.toFixed(2)}%`;
          case 'year': return value === null ? 'N/A' : `Year ${value}`;
          case 'multiple': return `${value.toFixed(2)}x`;
          default: return String(value);
        }
      };

      // Table header
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Metric', margin, yPos);
      pdf.text('Primary', margin + 55, yPos);
      allComparisonMetrics.slice(0, 4).forEach((_, idx) => {
        pdf.text(`Prop ${idx + 2}`, margin + 85 + (idx * 25), yPos);
      });
      yPos += 2;
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;

      const metrics = [
        { label: '10-Year ROI', key: 'roi', format: 'percent' },
        { label: 'Annualised ROI', key: 'annualisedRoi', format: 'percent' },
        { label: 'Total Return', key: 'totalReturn', format: 'currency' },
        { label: 'Break-Even Year', key: 'breakEvenYear', format: 'year' },
        { label: 'Cash-on-Cash (Y1)', key: 'cashOnCash', format: 'percent' },
        { label: 'Equity Multiple', key: 'equityMultiple', format: 'multiple' },
        { label: 'Total Cash Flow', key: 'totalCashFlow', format: 'currency' },
        { label: 'Capital Gain', key: 'capitalGain', format: 'currency' },
      ];

      // Table rows
      pdf.setFont('helvetica', 'normal');
      for (const metric of metrics) {
        pdf.text(metric.label, margin, yPos);
        pdf.text(formatValue((primaryMetrics as any)?.[metric.key], metric.format), margin + 55, yPos);
        allComparisonMetrics.slice(0, 4).forEach(({ metrics: compMetrics }, idx) => {
          pdf.text(formatValue((compMetrics as any)?.[metric.key], metric.format), margin + 85 + (idx * 25), yPos);
        });
        yPos += 6;
      }

      // Add AI Analysis section if available
      if (aiAnalysis) {
        pdf.addPage();
        yPos = margin;

        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.text('AI-Powered Cash Flow Analysis', pageWidth / 2, yPos, { align: 'center' });
        yPos += 12;

        // Helper function to add wrapped text
        const addWrappedText = (text: string, fontSize: number, maxWidth: number, lineHeight: number = 5) => {
          pdf.setFontSize(fontSize);
          const lines = pdf.splitTextToSize(text, maxWidth);
          for (const line of lines) {
            if (yPos + lineHeight > pageHeight - margin) {
              pdf.addPage();
              yPos = margin;
            }
            pdf.text(line, margin, yPos);
            yPos += lineHeight;
          }
        };

        // Executive Summary
        if (aiAnalysis.executiveSummary) {
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Executive Summary', margin, yPos);
          yPos += 7;
          pdf.setFont('helvetica', 'normal');
          addWrappedText(aiAnalysis.executiveSummary, 9, pageWidth - (margin * 2), 4.5);
          yPos += 8;
        }

        // Final Rankings
        if (aiAnalysis.finalRankings && aiAnalysis.finalRankings.length > 0) {
          if (yPos > pageHeight - 60) {
            pdf.addPage();
            yPos = margin;
          }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Final Rankings', margin, yPos);
          yPos += 7;

          pdf.setFontSize(9);
          for (const ranking of aiAnalysis.finalRankings) {
            if (yPos + 20 > pageHeight - margin) {
              pdf.addPage();
              yPos = margin;
            }
            
            pdf.setFont('helvetica', 'bold');
            // `address`, not `propertyAddress`: the producer's schema emits the
            // former (`compare-cash-flow-reports/index.ts:192`) and this line
            // read the latter, so every ranking in this PDF printed
            // "#1 - undefined". The old key is kept as a fallback in case a
            // future prompt emits it.
            pdf.text(`#${ranking.rank} - ${ranking.address ?? ranking.propertyAddress ?? ''}`, margin, yPos);
            yPos += 5;

            pdf.setFont('helvetica', 'normal');
            // Same story for `score`, and the `/100` is gone with it. The schema
            // states no scale, so printing a denominator asserts something the
            // record does not support — fixing the key while keeping `/100`
            // would turn "undefined" into a confidently wrong number.
            const rankingScore = ranking.score ?? ranking.overallScore;
            if (rankingScore !== undefined && rankingScore !== null) {
              pdf.text(`Score: ${rankingScore}`, margin + 5, yPos);
              yPos += 4;
            }
            
            if (ranking.strengths && ranking.strengths.length > 0) {
              pdf.text(`Strengths: ${ranking.strengths.join(', ')}`, margin + 5, yPos);
              yPos += 4;
            }
            if (ranking.weaknesses && ranking.weaknesses.length > 0) {
              pdf.text(`Weaknesses: ${ranking.weaknesses.join(', ')}`, margin + 5, yPos);
              yPos += 4;
            }
            yPos += 3;
          }
          yPos += 5;
        }

        // Investor Recommendations
        if (aiAnalysis.investorRecommendations) {
          if (yPos > pageHeight - 80) {
            pdf.addPage();
            yPos = margin;
          }
          
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Investor Profile Recommendations', margin, yPos);
          yPos += 7;

          pdf.setFontSize(9);
          // `balanced`, not `balancedApproach`. The producer's schema (`:185`)
          // emits the former and both generators asked for the latter, so the
          // Balanced recommendation has never appeared in a client's PDF. The
          // old key stays as a fallback.
          const recommendations = [
            { keys: ['growthFocused'], label: 'Growth Focused' },
            { keys: ['incomeFocused'], label: 'Income Focused' },
            { keys: ['balanced', 'balancedApproach'], label: 'Balanced Approach' },
            { keys: ['riskAverse'], label: 'Risk Averse' },
          ];

          for (const rec of recommendations) {
            const recData = rec.keys
              .map((key) => aiAnalysis.investorRecommendations[key])
              .find(Boolean);
            if (recData) {
              if (yPos + 15 > pageHeight - margin) {
                pdf.addPage();
                yPos = margin;
              }

              // The label alone. The schema gives `{propertyNumber, reason}` and
              // no `recommendation`, so this printed "N/A" for all four
              // profiles. `propertyNumber` is not substituted in its place: it
              // indexes `propertiesData`, which is built by mapping over the
              // result of an `IN` query whose row order Postgres does not
              // guarantee, so it names an ordering nobody recorded. The
              // on-screen panel prints the reason and no property for the same
              // reason.
              pdf.setFont('helvetica', 'bold');
              pdf.text(`${rec.label}`, margin, yPos);
              yPos += 4.5;

              if (recData.reason) {
                pdf.setFont('helvetica', 'normal');
                addWrappedText(recData.reason, 8, pageWidth - (margin * 2) - 5, 4);
              }
              yPos += 3;
            }
          }
          yPos += 5;
        }

        // Overall Recommendation
        //
        // `.bestProperty.reason`, not the object. The schema (`:199`) makes this
        // `{bestProperty, avoid, alternativeScenarios}` and this line handed the
        // whole object to `pdf.splitTextToSize`. The on-screen panel reads it
        // correctly, so the same object was being read three different ways in
        // one file.
        const bestOverall = aiAnalysis.overallRecommendation?.bestProperty?.reason;
        if (bestOverall) {
          if (yPos > pageHeight - 40) {
            pdf.addPage();
            yPos = margin;
          }

          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Overall Recommendation', margin, yPos);
          yPos += 7;

          pdf.setFont('helvetica', 'normal');
          addWrappedText(bestOverall, 9, pageWidth - (margin * 2), 4.5);
        }
      }

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      yPos += 10;
      if (yPos > pageHeight - 20) {
        pdf.addPage();
        yPos = margin;
      }
      pdf.text('This comparison is for informational purposes only.', margin, yPos);

      if (options?.returnBlob) {
        return pdf.output('blob');
      }

      pdf.save(`cash-flow-comparison-${comparisonReports.length + 1}-properties-${new Date().toISOString().split('T')[0]}.pdf`);

      logActivityDirect({
        actionType: 'comparison_pdf_downloaded',
        entityType: 'cash_flow_analysis',
        entityName: report.property_address,
        metadata: { comparison_count: comparisonReports.length + 1, has_ai_analysis: !!aiAnalysis }
      });

      toast({
        title: "PDF Exported",
        description: aiAnalysis ? "Comparison PDF with AI analysis has been downloaded." : "Comparison PDF has been downloaded successfully.",
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({
        title: "Export Failed",
        description: "Failed to generate comparison PDF.",
        variant: "destructive"
      });
    }
  }, [report, comparisonReports, allComparisonMetrics, primaryMetrics, aiAnalysis, toast]);

  // Export AI Analysis Only as PDF
  const exportAiAnalysisPDF = useCallback(async (options?: { returnBlob?: boolean }): Promise<Blob | void> => {
    if (!report || !aiAnalysis) return;

    try {
      toast({
        title: "Generating PDF",
        description: "Exporting AI analysis...",
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let yPos = margin;

      // Helper function to add wrapped text
      const addWrappedText = (text: string, fontSize: number, maxWidth: number, lineHeight: number = 5) => {
        pdf.setFontSize(fontSize);
        const lines = pdf.splitTextToSize(text, maxWidth);
        for (const line of lines) {
          if (yPos + lineHeight > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }
          pdf.text(line, margin, yPos);
          yPos += lineHeight;
        }
      };

      // Title
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('AI Cash Flow Comparison Analysis', pageWidth / 2, yPos, { align: 'center' });
      yPos += 12;

      // Properties analyzed
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Properties Analyzed:', margin, yPos);
      yPos += 5;
      pdf.text(`1. ${report.property_address} (Primary)`, margin + 5, yPos);
      yPos += 5;
      comparisonReports.forEach((compReport, idx) => {
        pdf.text(`${idx + 2}. ${compReport.property_address}`, margin + 5, yPos);
        yPos += 5;
      });
      yPos += 3;
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-AU')}`, margin, yPos);
      yPos += 12;

      // Executive Summary
      if (aiAnalysis.executiveSummary) {
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Executive Summary', margin, yPos);
        yPos += 8;
        pdf.setFont('helvetica', 'normal');
        addWrappedText(aiAnalysis.executiveSummary, 10, pageWidth - (margin * 2), 5);
        yPos += 10;
      }

      // Final Rankings
      if (aiAnalysis.finalRankings && aiAnalysis.finalRankings.length > 0) {
        if (yPos > pageHeight - 60) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Final Rankings', margin, yPos);
        yPos += 8;

        for (const ranking of aiAnalysis.finalRankings) {
          if (yPos + 25 > pageHeight - margin) {
            pdf.addPage();
            yPos = margin;
          }
          
          // Rank header with background
          pdf.setFillColor(ranking.rank === 1 ? 220 : 240, ranking.rank === 1 ? 252 : 240, ranking.rank === 1 ? 231 : 240);
          pdf.rect(margin, yPos - 4, pageWidth - (margin * 2), 20, 'F');
          
          pdf.setFontSize(11);
          pdf.setFont('helvetica', 'bold');
          // The schema's key first. This read `propertyAddress` first and fell
          // through, which happened to work; the order now matches the producer.
          pdf.text(`#${ranking.rank} - ${ranking.address ?? ranking.propertyAddress ?? ''}`, margin + 3, yPos);
          yPos += 6;

          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'normal');
          // No `/100`: the schema names no scale. `??` rather than `||`, so a
          // genuine score of 0 prints instead of being treated as absent.
          const overallScore = ranking.score ?? ranking.overallScore;
          if (overallScore !== undefined && overallScore !== null) {
            pdf.text(`Overall Score: ${overallScore}`, margin + 5, yPos);
            yPos += 4;
          }
          
          if (ranking.strengths && ranking.strengths.length > 0) {
            pdf.setTextColor(34, 139, 34);
            pdf.text(`Strengths: ${ranking.strengths.join(', ')}`, margin + 5, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 4;
          }
          if (ranking.weaknesses && ranking.weaknesses.length > 0) {
            pdf.setTextColor(178, 34, 34);
            pdf.text(`Weaknesses: ${ranking.weaknesses.join(', ')}`, margin + 5, yPos);
            pdf.setTextColor(0, 0, 0);
            yPos += 4;
          }
          yPos += 6;
        }
        yPos += 5;
      }

      // Investor Recommendations
      if (aiAnalysis.investorRecommendations) {
        if (yPos > pageHeight - 80) {
          pdf.addPage();
          yPos = margin;
        }
        
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Investor Profile Recommendations', margin, yPos);
        yPos += 8;

        // `balanced` first, `balancedApproach` as a fallback — see the same fix
        // in `exportComparisonPDF`.
        const recommendations = [
          { keys: ['growthFocused'], label: 'Growth Focused', color: [59, 130, 246] },
          { keys: ['incomeFocused'], label: 'Income Focused', color: [34, 197, 94] },
          { keys: ['balanced', 'balancedApproach'], label: 'Balanced Approach', color: [168, 85, 247] },
          { keys: ['riskAverse'], label: 'Risk Averse', color: [249, 115, 22] },
        ];

        for (const rec of recommendations) {
          const recData = rec.keys
            .map((key) => aiAnalysis.investorRecommendations[key])
            .find(Boolean);
          if (recData) {
            if (yPos + 20 > pageHeight - margin) {
              pdf.addPage();
              yPos = margin;
            }

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(rec.color[0], rec.color[1], rec.color[2]);
            // The label alone. `recData.recommendation` is not in the schema and
            // printed "N/A" for every profile; `propertyNumber` is not put in
            // its place because it indexes an ordering nobody recorded.
            pdf.text(`${rec.label}`, margin, yPos);
            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'normal');
            yPos += 5;

            if (recData.reason) {
              addWrappedText(recData.reason, 9, pageWidth - (margin * 2) - 5, 4.5);
            }
            yPos += 5;
          }
        }
        yPos += 5;
      }

      // Overall Recommendation — the object's `bestProperty.reason`, not the
      // object. See the same fix in `exportComparisonPDF`.
      const bestOverall = aiAnalysis.overallRecommendation?.bestProperty?.reason;
      if (bestOverall) {
        if (yPos > pageHeight - 50) {
          pdf.addPage();
          yPos = margin;
        }

        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Overall Recommendation', margin, yPos);
        yPos += 8;

        pdf.setFont('helvetica', 'normal');
        addWrappedText(bestOverall, 10, pageWidth - (margin * 2), 5);
      }

      // Disclaimer
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'italic');
      yPos += 15;
      if (yPos > pageHeight - 20) {
        pdf.addPage();
        yPos = margin;
      }
      pdf.text('This AI-powered analysis is for informational purposes only and should not be considered financial advice.', margin, yPos);

      if (options?.returnBlob) {
        return pdf.output('blob');
      }

      pdf.save(`ai-cash-flow-analysis-${new Date().toISOString().split('T')[0]}.pdf`);

      toast({
        title: "PDF Exported",
        description: "AI analysis PDF has been downloaded successfully.",
      });
    } catch (error) {
      console.error('Error exporting AI analysis PDF:', error);
      toast({
        title: "Export Failed",
        description: "Failed to generate AI analysis PDF.",
        variant: "destructive"
      });
    }
  }, [report, comparisonReports, aiAnalysis, toast]);

  const formatCurrency = (value: number) => {
    if (value === 0) return '-';
    const formatted = Math.abs(value).toLocaleString('en-AU', { maximumFractionDigits: 0 });
    return value < 0 ? `-$${formatted}` : `$${formatted}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  // Check if a cell has an override
  const hasOverride = useCallback((year: number, field: EditableFieldKey): boolean => {
    const value = yearlyOverrides[year]?.[field];
    return value !== undefined && value !== null;
  }, [yearlyOverrides]);

  // Render editable cell
  const renderEditableCell = useCallback((
    year: number, 
    field: EditableFieldKey, 
    displayValue: number,
    formatFn: (val: number) => string
  ) => {
    const isEditing = editingCell?.year === year && editingCell?.field === field;
    const isEditable = year >= 1; // Years 1-10 are editable
    const hasOverrideValue = hasOverride(year, field);
    const fieldConfig = EDITABLE_FIELDS.find(f => f.key === field);
    const fieldLabel = fieldConfig?.label ?? field;
    // Accessible label, e.g. "Year 1 Depreciation $". Keyboard/screen-reader
    // users get a per-cell label instead of an unlabelled control.
    const a11yLabel = `Year ${year} ${fieldLabel}`;

    // Shared geometry so the control never changes size between the read-only
    // button and the editing input (prevents hover/focus layout shift, flicker
    // and column jump). Fixed height + 1px border in every state. The md:*
    // variants pin the height/text-size across breakpoints so the shadcn Input
    // base classes (md:h-10 / md:text-sm) can't reintroduce a size mismatch.
    const cellBox = 'box-border h-9 md:h-9 w-full rounded-lg border px-2 text-center text-xs md:text-xs';

    if (isEditing) {
      return (
        <Input
          type="number"
          inputMode="decimal"
          step={fieldConfig?.step || 1}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleCellEditCommit}
          onKeyDown={handleEditKeyDown}
          autoFocus
          aria-label={a11yLabel}
          className={cn(
            cellBox,
            'border-primary/50 bg-primary/5 py-0 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0',
            // Hide native number spinners so the field width stays constant on focus.
            '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          )}
        />
      );
    }

    if (isEditable) {
      return (
        <button
          type="button"
          onClick={() => handleCellEditStart(year, field, displayValue)}
          aria-label={hasOverrideValue ? `${a11yLabel} (overridden)` : a11yLabel}
          title={hasOverrideValue ? 'Click to edit (overridden)' : 'Click to edit'}
          className={cn(
            cellBox,
            // Only colours transition on hover/focus — no transform, size or
            // border-width change — so adjacent columns never shift.
            'group relative inline-flex items-center justify-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            hasOverrideValue
              ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
              : 'border-transparent bg-transparent',
          )}
        >
          {hasOverrideValue && (
            <span
              className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-background"
              aria-hidden="true"
            />
          )}
          <span className="block truncate">{formatFn(displayValue)}</span>
        </button>
      );
    }

    return <span>{formatFn(displayValue)}</span>;
  }, [editingCell, editValue, hasOverride, handleCellEditStart, handleCellEditCommit, handleEditKeyDown]);

  const handleExportExcel = () => {
    if (!baseFinancialData || !report) return;

    // Create workbook
    const wb = XLSX.utils.book_new();

    // ==================== SHEET 1: Cash Flow Analysis ====================
    const analysisData: (string | number | null)[][] = [];
    
    // Title
    analysisData.push(['10 Year Cash Flow Analysis']);
    analysisData.push([report.property_address]);
    analysisData.push([]);
    
    // ---- INPUT PARAMETERS SECTION ----
    analysisData.push(['INPUT PARAMETERS']);
    analysisData.push([]);
    
    // Purchase & Loan Details
    analysisData.push(['PURCHASE & LOAN DETAILS']);
    analysisData.push(['Purchase Price', baseFinancialData.purchasePrice]);
    analysisData.push(['Land Price', baseFinancialData.landPrice]);
    analysisData.push(['Build Price', baseFinancialData.buildPrice]);
    analysisData.push(['Market Value Now', baseFinancialData.marketValueNow]);
    analysisData.push(['Deposit', baseFinancialData.depositValue]);
    analysisData.push(['Loan Amount', baseFinancialData.loanAmount || (baseFinancialData.purchasePrice * (baseFinancialData.loanToValueRatio / 100))]);
    analysisData.push(['LVR %', baseFinancialData.loanToValueRatio]);
    analysisData.push(['Interest Rate %', baseFinancialData.interestRate]);
    analysisData.push(['Loan Type', baseFinancialData.loanType === 'interest_only' ? 'Interest Only' : 'Principal & Interest']);
    analysisData.push(['Loan Term (Years)', baseFinancialData.loanTermYears]);
    analysisData.push([]);
    
    // Rental Income
    analysisData.push(['RENTAL INCOME']);
    analysisData.push(['Weekly Rent', baseFinancialData.weeklyRent]);
    analysisData.push(['Annual Rent', baseFinancialData.weeklyRent * baseFinancialData.occupancyRate]);
    analysisData.push(['Occupancy (Weeks/Year)', baseFinancialData.occupancyRate]);
    analysisData.push([]);
    
    // Expenses
    analysisData.push(['ANNUAL EXPENSES']);
    analysisData.push(['Stamp Duty (One-off)', baseFinancialData.stampDuty]);
    analysisData.push(['Council Rates', baseFinancialData.councilRates]);
    analysisData.push(['Water Rates', baseFinancialData.waterRates]);
    analysisData.push(['Body Corporate/Strata', baseFinancialData.bodyCorporateFees]);
    analysisData.push(['Building & Landlord Insurance', baseFinancialData.buildingLandlordInsurance]);
    analysisData.push(['Property Management %', baseFinancialData.propertyManagementFees]);
    analysisData.push(['Repairs & Maintenance', baseFinancialData.repairsMaintenance]);
    analysisData.push(['Letting Fees', baseFinancialData.lettingFees]);
    analysisData.push(['Land Tax', baseFinancialData.landTax]);
    if (baseFinancialData.lmiAmount > 0) {
      analysisData.push(['LMI (Lenders Mortgage Insurance)', baseFinancialData.lmiAmount]);
    }
    analysisData.push([]);
    
    // Tax & Growth
    analysisData.push(['TAX & GROWTH']);
    analysisData.push(['Capital Growth Rate %', baseFinancialData.capitalGrowth]);
    analysisData.push(['CPI Growth Rate %', baseFinancialData.cpiGrowthRate]);
    analysisData.push(['Depreciation p.a.', baseFinancialData.depreciation]);
    analysisData.push(['Tax Rate %', baseFinancialData.taxRate]);
    analysisData.push([]);

    // Create first worksheet
    const ws1 = XLSX.utils.aoa_to_sheet(analysisData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Input Parameters');

    // ==================== SHEET 2: 10 Year Projections ====================
    const projectionData: (string | number | null)[][] = [];
    
    // Header row
    projectionData.push(['10 YEAR CASH FLOW PROJECTIONS']);
    projectionData.push([report.property_address]);
    projectionData.push([]);
    
    // Column headers
    const headers = ['Metric', 'Today', ...Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`)];
    projectionData.push(headers);
    
    // Data rows with per-year overridden values
    projectionData.push(['Capital Growth %', ...projections.map(p => p.year === 0 ? '' : p.capitalGrowthRate)]);
    projectionData.push(['CPI Growth %', ...projections.map(p => p.year === 0 ? '' : p.cpiGrowthRate)]);
    projectionData.push(['Property Value $', ...projections.map(p => p.propertyMarketValue)]);
    projectionData.push(['Loan Amount $', ...projections.map(p => p.loanAmount)]);
    projectionData.push([]);
    projectionData.push(['STATISTICS']);
    projectionData.push(['Equity $', ...projections.map(p => p.equityInProperty)]);
    projectionData.push(['LVR %', ...projections.map(p => p.loanToValueRatio)]);
    projectionData.push(['Rental Income $', ...projections.map(p => p.year === 0 ? `${baseFinancialData.weeklyRent}pw` : p.rentalIncome)]);
    projectionData.push(['Gross Yield %', ...projections.map(p => p.year === 0 ? '' : p.grossYield)]);
    projectionData.push(['Net Yield %', ...projections.map(p => p.year === 0 ? '' : p.netYield)]);
    projectionData.push([]);
    projectionData.push(['CASH DEDUCTIONS']);
    projectionData.push(['Property Expenses $', ...projections.map(p => p.year === 0 ? 0 : p.propertyExpenses)]);
    projectionData.push(['Land Tax $', ...projections.map(p => p.year === 0 ? '' : p.landTax)]);
    projectionData.push(['Interest Rate %', ...projections.map(p => p.year === 0 ? '' : p.interestRate)]);
    projectionData.push(['Interest Payments $', ...projections.map(p => p.year === 0 ? 0 : p.interestPayments)]);
    projectionData.push(['Principal Payments $', ...projections.map(p => p.principalPayments)]);
    projectionData.push(['Pre-Tax Cash Flow p/a $', ...projections.map(p => p.year === 0 ? '' : p.preTaxCashFlowPA)]);
    projectionData.push(['Pre-Tax Cash Flow p/w $', ...projections.map(p => p.year === 0 ? '' : p.preTaxCashFlowPW)]);
    projectionData.push([]);
    projectionData.push(['NON-CASH DEDUCTIONS']);
    projectionData.push(['Depreciation $', ...projections.map(p => p.year === 0 ? '' : p.depreciation)]);
    projectionData.push([]);
    projectionData.push(['SUMMARY']);
    projectionData.push(['Total Deductions $', ...projections.map(p => p.year === 0 ? '' : p.totalDeductions)]);
    projectionData.push(['Net Profit/Loss $', ...projections.map(p => p.year === 0 ? '' : p.netProfitLoss)]);
    projectionData.push(['Tax Refund / (Payable) $', ...projections.map(p => p.year === 0 ? '' : p.taxEffect)]);
    projectionData.push(['After-Tax Cash Flow p/a $', ...projections.map(p => p.year === 0 ? '' : p.afterTaxCashFlowPA)]);
    projectionData.push(['After-Tax Cash Flow p/w $', ...projections.map(p => p.year === 0 ? '' : p.afterTaxCashFlowPW)]);

    // Create second worksheet
    const ws2 = XLSX.utils.aoa_to_sheet(projectionData);
    
    // Set column widths
    ws2['!cols'] = [
      { wch: 25 }, // Metric column
      ...Array(11).fill({ wch: 15 }) // Year columns
    ];
    
    XLSX.utils.book_append_sheet(wb, ws2, '10 Year Projections');

    // Download
    const fileName = `Cash_Flow_Analysis_${report.property_address.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Successful",
      description: "Cash flow analysis has been exported to Excel.",
    });
  };

  // Export single report 10-year cash flow as PDF with charts
  // When returnBlob is true, returns the PDF blob instead of triggering a download
  const exportSingleReportPDF = useCallback(async (options?: { returnBlob?: boolean }): Promise<Blob | void> => {
    if (!report || !baseFinancialData) return;

    try {
      assertProjectionComplete(baseFinancialData);
      // Load active template configuration
      const templateConfig = await loadActiveCashFlowTemplate();
      console.log(`📋 Using Cash Flow template: ${templateConfig.name}`);

      const pdf = new jsPDF('p', 'mm', 'a4'); // Portrait orientation for better fit
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const footerHeight = 32; // Reserved space for footer - increased to prevent overlap
      const contentMaxY = pageHeight - footerHeight; // Maximum Y position for content
      let yPos = 0;

      // ========== COVER PAGE ==========
      // Use the configured cover template image as background
      const goldColor = { r: 201, g: 165, b: 90 }; // #c9a55a
      
      try {
        // Add cover template image as full page background
        const coverImageUrl = '/templates/npc-cashflow-cover.jpg';
        pdf.addImage(coverImageUrl, 'JPEG', 0, 0, pageWidth, pageHeight);
      } catch (e) {
        // Fallback: draw simple dark background if image fails
        pdf.setFillColor(26, 26, 26);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        
        // Gold accent bar at top
        pdf.setFillColor(goldColor.r, goldColor.g, goldColor.b);
        pdf.rect(0, 0, pageWidth, 8, 'F');
        
        // Company name fallback (uses configured template branding)
        pdf.setFontSize(28);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(goldColor.r, goldColor.g, goldColor.b);
        pdf.text(templateConfig.companyName || 'PROPERTY', pageWidth / 2, 100, { align: 'center' });
        pdf.text(templateConfig.companyNameLine2 || 'CONSULTING', pageWidth / 2, 115, { align: 'center' });
        
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        pdf.text('YOUR DEDICATED PROPERTY PARTNER', pageWidth / 2, 135, { align: 'center' });
        
        // Bottom gold bar
        pdf.setFillColor(goldColor.r, goldColor.g, goldColor.b);
        pdf.rect(0, pageHeight - 8, pageWidth, 8, 'F');
      }

      // Add new page for content
      pdf.addPage();

      // Brand colors (gold primary)
      const primaryColor = { r: 202, g: 138, b: 4 }; // Gold #ca8a04
      const darkText = { r: 30, g: 30, b: 30 };
      const grayText = { r: 100, g: 100, b: 100 };
      const lightGray = { r: 248, g: 248, b: 248 };
      const mediumGray = { r: 220, g: 220, b: 220 }; // Slightly darker for better contrast
      const tableHeaderBg = { r: 45, g: 55, b: 72 }; // Slate gray
      const sectionBg = { r: 254, g: 249, b: 235 }; // Warmer cream #fef9eb
      const negativeRed = { r: 185, g: 28, b: 28 }; // Darker red for negatives #B91C1C

      // The export menu's own chart switches decide which charts the legacy
      // document draws. Send to Client no longer runs this generator — it ships
      // the FINAL document (see `produceFinalCashFlowDocument`).
      const activeChartToggles = chartExportToggles;
      
      // Capture charts first (only if toggles are enabled)
      let cashFlowChartImage: string | null = null;
      let yieldChartImage: string | null = null;
      let comparisonChartImage: string | null = null;
      
      if (activeChartToggles.cashFlowTrends && cashFlowChartRef.current) {
        try {
          const canvas = await html2canvas(cashFlowChartRef.current, {
            backgroundColor: exportBackgroundFor(cashFlowChartRef.current, chartTheme),
            scale: 2,
          });
          cashFlowChartImage = canvas.toDataURL('image/png');
        } catch (e) {
          console.warn('Failed to capture cash flow chart:', e);
        }
      }
      
      if (activeChartToggles.yieldChart && yieldChartRef.current) {
        try {
          const canvas = await html2canvas(yieldChartRef.current, {
            backgroundColor: exportBackgroundFor(yieldChartRef.current, chartTheme),
            scale: 2,
          });
          yieldChartImage = canvas.toDataURL('image/png');
        } catch (e) {
          console.warn('Failed to capture yield chart:', e);
        }
      }
      
      if (activeChartToggles.comparisonChart && comparisonChartRef.current) {
        try {
          const canvas = await html2canvas(comparisonChartRef.current, {
            backgroundColor: exportBackgroundFor(comparisonChartRef.current, chartTheme),
            scale: 2,
          });
          comparisonChartImage = canvas.toDataURL('image/png');
        } catch (e) {
          console.warn('Failed to capture comparison chart:', e);
        }
      }

      // ========== HEADER SECTION ==========
      // Start content directly without the top banner
      yPos = margin;

      // Document title section
      pdf.setTextColor(darkText.r, darkText.g, darkText.b);
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('10-Year Cash Flow Analysis', margin, yPos);
      yPos += 8;

      // Property address with subtle underline
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(grayText.r, grayText.g, grayText.b);
      // Clean the address - remove "Copy" suffix and trailing underscores/numbers
      const cleanedAddress = report.property_address.replace(/[_\s]?Copy[_\s]?\d*$/i, '').trim();
      pdf.text(cleanedAddress, margin, yPos);
      yPos += 5;

      // Decorative line under address
      pdf.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
      pdf.setLineWidth(0.5);
      pdf.line(margin, yPos, margin + 120, yPos);
      yPos += 6;

      // Generation date
      pdf.setFontSize(8);
      pdf.setTextColor(grayText.r, grayText.g, grayText.b);
      pdf.text(`Generated: ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, yPos);
      pdf.setTextColor(darkText.r, darkText.g, darkText.b);
      yPos += 10;

      // ========== KEY METRICS CARDS ==========
      const cardWidth = (pageWidth - margin * 2 - 15) / 4;
      const cardHeight = 14;
      const cardY = yPos;

      const keyMetricsData = [
        { label: 'Purchase Price', value: formatCurrency(baseFinancialData.purchasePrice) },
        { label: 'Weekly Rent', value: formatCurrency(baseFinancialData.weeklyRent) },
        { label: 'Interest Rate', value: `${baseFinancialData.interestRate}%` },
        { label: 'Capital Growth', value: `${baseFinancialData.capitalGrowth}%` },
      ];

      keyMetricsData.forEach((metric, idx) => {
        const cardX = margin + idx * (cardWidth + 5);
        
        // Card background
        pdf.setFillColor(lightGray.r, lightGray.g, lightGray.b);
        pdf.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2, 'F');
        
        // Card border
        pdf.setDrawColor(mediumGray.r, mediumGray.g, mediumGray.b);
        pdf.setLineWidth(0.3);
        pdf.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2, 'S');
        
        // Metric label
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(grayText.r, grayText.g, grayText.b);
        pdf.text(metric.label, cardX + 4, cardY + 5);
        
        // Metric value
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        pdf.text(metric.value, cardX + 4, cardY + 11);
      });

      yPos = cardY + cardHeight + 8;

      // ========== INPUTS SUMMARY SECTION ==========
      if (includeInputsSummaryInExport) {
        // Section header with accent line
        pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        pdf.rect(margin, yPos, 3, 5, 'F');
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        pdf.text('Input Summary', margin + 6, yPos + 4);
        yPos += 8;

        // Summary table with two columns
        const inputsColWidth = (pageWidth - margin * 2) / 2 - 5;
        const inputRowHeight = 4.2;
        let rowCount = 0;

        const drawInputRow = (label: string, value: string, label2?: string, value2?: string) => {
          if (yPos > pageHeight - 25) {
            pdf.addPage();
            yPos = margin;
          }
          
          // Alternating row background
          if (rowCount % 2 === 0) {
            pdf.setFillColor(lightGray.r, lightGray.g, lightGray.b);
            pdf.rect(margin, yPos - 3, pageWidth - margin * 2, inputRowHeight, 'F');
          }

          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(grayText.r, grayText.g, grayText.b);
          pdf.text(label, margin + 2, yPos);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(darkText.r, darkText.g, darkText.b);
          pdf.text(value, margin + 52, yPos);
          
          if (label2 && value2) {
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(grayText.r, grayText.g, grayText.b);
            pdf.text(label2, margin + inputsColWidth + 10, yPos);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(darkText.r, darkText.g, darkText.b);
            pdf.text(value2, margin + inputsColWidth + 62, yPos);
          }
          yPos += inputRowHeight;
          rowCount++;
        };

        // Draw inputs in two columns
        drawInputRow('Purchase Price:', formatCurrency(baseFinancialData.purchasePrice), 'Weekly Rent:', formatCurrency(baseFinancialData.weeklyRent));
        // Gross Rental Yield on the PURCHASE PRICE. It used to print
        // `projections[1].grossYield`, which is Year 1 rent over the Year 1
        // GROWN value — so in an Input Summary sitting beside "Purchase Price"
        // it answered a question nobody asked and understated the buying yield
        // (on the audited Moranbah report, 7.22% shown against 7.67% actual).
        const _annualRentNow = baseFinancialData.weeklyRent * baseFinancialData.occupancyRate;
        const _purchaseYield = baseFinancialData.purchasePrice > 0
          ? `${((_annualRentNow / baseFinancialData.purchasePrice) * 100).toFixed(2)}%`
          : '-';
        // A figure nobody recorded is printed as assumed (QA-02); a land or
        // build price the record does not hold is "not stated", never the
        // purchase price (QA-13).
        const _assumed = (field: string, text: string) =>
          baseFinancialData.provenance[field] === 'default' ? `${text} (assumed)` : text;
        const _split = landBuildSplit(baseFinancialData);
        const _landPriceText = _split.landPrice === null ? 'Not stated' : formatCurrency(_split.landPrice);
        const _buildPriceText = _split.buildPrice === null
          ? 'Not stated'
          : `${formatCurrency(_split.buildPrice)}${_split.derived ? ' (price less land)' : ''}`;
        drawInputRow('Land Price:', _landPriceText, 'Gross Rental Yield (on purchase):', _purchaseYield);
        drawInputRow('Build Price:', _buildPriceText, 'Council Rates (p.a.):', formatCurrency(baseFinancialData.councilRates));
        drawInputRow('Deposit Amount:', formatCurrency(baseFinancialData.depositValue), 'Water Rates (p.a.):', formatCurrency(baseFinancialData.waterRates));
        drawInputRow('Loan Amount:', formatCurrency(baseFinancialData.loanAmount || (baseFinancialData.purchasePrice * (baseFinancialData.loanToValueRatio / 100))), 'Property Management:', _assumed('propertyManagementFees', `${baseFinancialData.propertyManagementFees}%`));
        drawInputRow('Interest Rate:', _assumed('interestRate', `${baseFinancialData.interestRate.toFixed(2)}%`), 'Landlord Insurance:', formatCurrency(baseFinancialData.buildingLandlordInsurance));
        drawInputRow('Capital Growth Rate:', _assumed('capitalGrowth', `${baseFinancialData.capitalGrowth}%`), 'Letting Fees:', formatCurrency(baseFinancialData.lettingFees));
        drawInputRow('CPI Growth Rate:', _assumed('cpiGrowthRate', `${baseFinancialData.cpiGrowthRate}%`), 'Repairs & Maintenance:', formatCurrency(baseFinancialData.repairsMaintenance));
        drawInputRow('Tax Rate (MTR):', _assumed('taxRate', `${baseFinancialData.taxRate}%`), 'Body Corporate:', formatCurrency(baseFinancialData.bodyCorporateFees));
        drawInputRow('Depreciation (Yr 1):', _assumed('depreciation', formatCurrency(baseFinancialData.depreciation)), 'Stamp Duty:', formatCurrency(baseFinancialData.stampDuty));
        // The rent basis and the loan structure were both absent, and both
        // explain a figure in the table. Rent is charged for `occupancyRate`
        // weeks, not 52; and an interest-only period is why cash flow steps
        // down in the year principal starts — on the audited report that was a
        // ~$4,000 fall at Year 3 with nothing on the page to account for it.
        const _ioYears = baseFinancialData.loanType === 'interest_only'
          ? baseFinancialData.interestOnlyPeriodYears
          : 0;
        drawInputRow(
          'Loan Structure:',
          _ioYears > 0
            ? `Interest only ${_ioYears} yr${_ioYears === 1 ? '' : 's'}${baseFinancialData.provenance.interestOnlyPeriodYears === 'default' ? ' (assumed)' : ''}, then P&I (${baseFinancialData.loanTermYears} yr term)`
            : `Principal & interest (${baseFinancialData.loanTermYears} yr term)`,
          'Rent Basis:',
          _assumed('occupancyRate', `${baseFinancialData.occupancyRate} weeks p.a.`),
        );
        drawInputRow('', '', 'Conveyancing:', formatCurrency(baseFinancialData.solicitorFees));
        if (baseFinancialData.inspectionFees > 0) {
          drawInputRow('', '', 'Inspections:', formatCurrency(baseFinancialData.inspectionFees));
        }
        if (baseFinancialData.lmiAmount > 0) {
          drawInputRow('', '', 'LMI:', formatCurrency(baseFinancialData.lmiAmount));
        }
        // The case these inputs describe, so two documents can be told apart
        // (QA-02): the same eight characters on every document built from the
        // same recorded inputs, and different ones the moment an input moves.
        drawInputRow('Case inputs:', `fingerprint ${baseFinancialData.caseFingerprint}`, '', '');

        // ===== Total Upfront Costs + Total Overall Expenditure to Completion =====
        yPos += 4;

        // Build row data for both sections
        const _purchasePrice = baseFinancialData.purchasePrice;
        const _depositValue = baseFinancialData.depositValue || (_purchasePrice * (1 - (baseFinancialData.loanToValueRatio || 80) / 100));
        const _depositPct = _purchasePrice > 0 ? Math.round((_depositValue / _purchasePrice) * 100) : 0;
        const _stampDuty = baseFinancialData.stampDuty || 0;
        const _solicitorFees = baseFinancialData.solicitorFees || 0;
        // Inspections belong to the same settlement-cost object as duty and
        // legal fees; leaving them out is how the total came to $259,800
        // against the sibling report's $314,832 (QA-03).
        const _inspectionFees = baseFinancialData.inspectionFees || 0;
        const _agentFee = baseFinancialData.agentFee || 0;
        const _lmiAmount = baseFinancialData.lmiAmount || 0;

        let upfrontRows: { label: string; value: number }[] = [];
        let overallExtraRows: { label: string; value: number }[] = [];
        let totalUpfront = 0;
        let totalOverall = 0;

        if (isNewBuild && constructionProgressSchedule) {
          const landDeposit = constructionProgressSchedule.upfrontCosts.tenPercentLand;
          const buildDeposit = constructionProgressSchedule.upfrontCosts.fivePercentBuild;
          const constructionProgressTotal = constructionProgressSchedule.buildPrice;
          const stagedInterest = constructionProgressSchedule.totals.totalCombinedRepayment;
          upfrontRows = [
            { label: '10% Land Deposit', value: landDeposit },
            { label: '5% Build Contract Deposit', value: buildDeposit },
            { label: 'Stamp Duty', value: _stampDuty },
            { label: 'Solicitor / Conveyancer Cost', value: _solicitorFees },
            { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
            ...(_lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: _lmiAmount }] : []),
          ];
          totalUpfront = landDeposit + buildDeposit + _stampDuty + _solicitorFees + stagedInterest + _lmiAmount;
          overallExtraRows = [
            { label: 'Purchase Price (Land)', value: constructionProgressSchedule.landPrice },
            { label: 'Stamp Duty', value: _stampDuty },
            { label: 'Solicitor / Conveyancer Cost', value: _solicitorFees },
            { label: 'Build Price', value: constructionProgressTotal },
            { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
          ];
          totalOverall = constructionProgressSchedule.landPrice + _stampDuty + _solicitorFees + constructionProgressTotal + stagedInterest;
        } else {
          upfrontRows = [
            { label: `Deposit (${_depositPct}% — from your funds)`, value: _depositValue },
            { label: 'Stamp Duty', value: _stampDuty },
            { label: 'Solicitor / Conveyancer Cost', value: _solicitorFees },
            ...(_inspectionFees > 0 ? [{ label: 'Building & Pest Inspections', value: _inspectionFees }] : []),
            { label: 'Agent Fee', value: _agentFee },
            ...(_lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: _lmiAmount }] : []),
          ];
          totalUpfront = _depositValue + _stampDuty + _solicitorFees + _inspectionFees + _agentFee + _lmiAmount;
          overallExtraRows = [
            { label: 'Purchase Price', value: _purchasePrice },
            { label: 'Stamp Duty', value: _stampDuty },
            { label: 'Solicitor / Conveyancer Cost', value: _solicitorFees },
            { label: 'Agent Fee', value: _agentFee },
          ];
          totalOverall = _purchasePrice + _stampDuty + _solicitorFees + _agentFee;
        }

        const brkTableWidth = pageWidth - margin * 2;
        const brkColLabel = brkTableWidth * 0.65;

        const drawSectionTitle = (title: string) => {
          pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
          pdf.rect(margin, yPos, 3, 5, 'F');
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(darkText.r, darkText.g, darkText.b);
          pdf.text(title, margin + 6, yPos + 4);
          yPos += 8;
        };

        const drawTableHeader = () => {
          pdf.setFillColor(240, 240, 240);
          pdf.rect(margin, yPos, brkTableWidth, 5, 'F');
          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(grayText.r, grayText.g, grayText.b);
          pdf.text('Item', margin + 3, yPos + 3.5);
          pdf.text('Amount', margin + brkColLabel + 3, yPos + 3.5);
          yPos += 5.5;
        };

        const drawBrkRow = (label: string, amount: string, options?: { bold?: boolean; bg?: { r: number; g: number; b: number }; textColor?: { r: number; g: number; b: number } }) => {
          if (options?.bg) {
            pdf.setFillColor(options.bg.r, options.bg.g, options.bg.b);
            pdf.rect(margin, yPos - 0.5, brkTableWidth, 5, 'F');
          }
          pdf.setFontSize(7);
          pdf.setFont('helvetica', options?.bold ? 'bold' : 'normal');
          const tc = options?.textColor || darkText;
          pdf.setTextColor(tc.r, tc.g, tc.b);
          pdf.text(label, margin + 3, yPos + 3);
          pdf.text(amount, margin + brkColLabel + 3, yPos + 3);
          yPos += 5;
        };

        // Pagination check
        const totalRows = upfrontRows.length + overallExtraRows.length + 4; // section titles + headers + totals
        const breakdownEstHeight = totalRows * 5.5 + 30;
        if (yPos + breakdownEstHeight > pageHeight - margin) {
          pdf.addPage();
          yPos = margin + 10;
        }

        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.2);

        // ----- Total Upfront Costs section -----
        drawSectionTitle('Total Upfront Costs');
        drawTableHeader();
        upfrontRows.forEach(r => drawBrkRow(r.label, formatCurrency(r.value)));
        drawBrkRow('Total Upfront Costs', formatCurrency(totalUpfront), { bold: true, bg: { r: 235, g: 235, b: 235 } });

        yPos += 4;

        // ----- Total Overall Expenditure to Completion section -----
        drawSectionTitle('Total Overall Expenditure to Completion');
        drawTableHeader();
        overallExtraRows.forEach(r => drawBrkRow(r.label, formatCurrency(r.value)));

        // Highlight box for grand total
        yPos += 4;
        pdf.setFillColor(254, 243, 199);
        pdf.roundedRect(margin, yPos - 3, brkTableWidth, 7, 1, 1, 'F');
        pdf.setDrawColor(245, 158, 11);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(margin, yPos - 3, brkTableWidth, 7, 1, 1, 'S');
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(146, 64, 14);
        pdf.text('Total Overall Expenditure to Completion:', margin + 4, yPos + 1);
        pdf.text(formatCurrency(totalOverall), margin + 80, yPos + 1);
        yPos += 10;
      }

      // ========== CONSTRUCTION PROGRESS SCHEDULE ==========
      // Render inline directly after the expenditure breakdown on the same (first) page.
      // No page break here — the 10-Year Projections table immediately below will
      // force its own fresh page.
      if (isNewBuild && includeConstructionScheduleInExport && constructionProgressSchedule && constructionProgressSchedule.buildPrice > 0) {
        yPos += 4;

        // Section header with accent line
        pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        pdf.rect(margin, yPos, 3, 5, 'F');
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        pdf.text('Construction Progress Payment Schedule', margin + 6, yPos + 4);
        yPos += 8;

        // Project Summary cards
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(grayText.r, grayText.g, grayText.b);
        pdf.text(`Land Cost: ${formatCurrency(constructionProgressSchedule.landPrice)}   •   Build Contract: ${formatCurrency(constructionProgressSchedule.buildPrice)}   •   Total Project: ${formatCurrency(constructionProgressSchedule.totalProject)}`, margin, yPos);
        yPos += 6;

        // Table header
        pdf.setFontSize(6);
        pdf.setFillColor(tableHeaderBg.r, tableHeaderBg.g, tableHeaderBg.b);
        pdf.rect(margin, yPos - 3, pageWidth - margin * 2, 5, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        const scheduleHeaders = ['Stage', 'Description', '%', 'Stage Pricing', 'Land Int.', 'Build Int.', 'Combined', 'Mo'];
        const scheduleColWidths = [28, 55, 12, 22, 18, 18, 22, 10];
        let xPos = margin;
        scheduleHeaders.forEach((header, idx) => {
          pdf.text(header, xPos + 1, yPos);
          xPos += scheduleColWidths[idx];
        });
        yPos += 5;

        // Build stages rows with zebra striping
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        constructionProgressSchedule.stages.forEach((stage, idx) => {
          // Page break suppressed: construction schedule must remain on a single page.
          // Stage counts (typically <= 12 rows) comfortably fit on one A4 page.

          
          // Zebra striping
          if (idx % 2 === 0) {
            pdf.setFillColor(lightGray.r, lightGray.g, lightGray.b);
            pdf.rect(margin, yPos - 3, pageWidth - margin * 2, 4, 'F');
          }
          
          xPos = margin;
          const rowData = [
            stage.stage,
            stage.description.substring(0, 35) + (stage.description.length > 35 ? '...' : ''),
            stage.percentage > 0 ? `${stage.percentage}%` : '',
            formatCurrency(stage.buildAmount),
            formatCurrency(stage.landInterest),
            stage.buildInterest > 0 ? formatCurrency(stage.buildInterest) : '',
            formatCurrency(stage.totalMonthlyInterest),
            String(stage.month)
          ];
          rowData.forEach((cell, idx) => {
            pdf.text(cell, xPos + 1, yPos);
            xPos += scheduleColWidths[idx];
          });
          yPos += 4;
        });

        // Totals row — ensure it isn't cut off at the page bottom
        if (yPos + 8 > pageHeight - margin) {
          pdf.addPage();
          yPos = margin + 5;
        }
        pdf.setFillColor(sectionBg.r, sectionBg.g, sectionBg.b);
        pdf.rect(margin, yPos - 3, pageWidth - margin * 2, 5, 'F');
        pdf.setFont('helvetica', 'bold');
        xPos = margin;
        const totalsRow = [
          '',
          '',
          '100%',
          formatCurrency(constructionProgressSchedule.landPrice + constructionProgressSchedule.buildPrice),
          'Total',
          '',
          formatCurrency(constructionProgressSchedule.totals.totalCombinedRepayment),
          ''
        ];
        totalsRow.forEach((cell, idx) => {
          pdf.text(cell, xPos + 1, yPos);
          xPos += scheduleColWidths[idx];
        });
        yPos += 10;
      }

      // ========== 10-YEAR PROJECTIONS TABLE ==========
      // ALWAYS start the 10-year projections table on its own dedicated page
      // so the entire table is never split across page boundaries.
      pdf.addPage();
      yPos = margin + 5;

      // Section header with accent line
      pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
      pdf.rect(margin, yPos, 3, 5, 'F');
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(darkText.r, darkText.g, darkText.b);
      pdf.text('10-Year Projections', margin + 6, yPos + 4);
      yPos += 8;


      // Table configuration - compact for portrait orientation
      const colWidths = [34, ...Array(11).fill((pageWidth - margin * 2 - 34) / 11)]; // Slightly wider first column
      const rowHeight = 5; // Increased from 4.5 for better readability
      const sectionRowHeight = 6; // Taller section headers
      let tableRowCount = 0;
      
      // Helper to draw a row with enhanced styling and page boundary checking
      const drawRow = (cells: string[], isHeader = false, isSection = false, highlightValue = false) => {
        const currentRowHeight = isSection ? sectionRowHeight : rowHeight;
        
        // Page break suppressed: the 10-Year Projections table must always
        // render as a single contiguous block on its dedicated page.
        // (Row sizing is calibrated to fit all rows + sections on one A4 page.)

        
        if (isSection) {
          // Section header row - remove slash from section names
          const sectionName = cells[0].replace(/[\/\\|]/g, '').trim();
          yPos += 1; // Extra padding before section
          pdf.setFillColor(sectionBg.r, sectionBg.g, sectionBg.b);
          pdf.rect(margin, yPos - 3.5, pageWidth - margin * 2, sectionRowHeight, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(6.5);
          pdf.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
          pdf.text(sectionName, margin + 3, yPos + 0.5);
          tableRowCount = 0;
          yPos += sectionRowHeight;
          return; // Don't add more to yPos
        } else if (isHeader) {
          // Table header row - Remove "Metric" from first column
          pdf.setFillColor(tableHeaderBg.r, tableHeaderBg.g, tableHeaderBg.b);
          pdf.rect(margin, yPos - 3, pageWidth - margin * 2, rowHeight, 'F');
          pdf.setTextColor(255, 255, 255);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(6);
          
          let xPos = margin;
          cells.forEach((cell, idx) => {
            const cellWidth = colWidths[idx];
            // Skip "Metric" in first column header
            const displayCell = idx === 0 ? '' : cell;
            if (idx === 0) {
              pdf.text(displayCell, xPos + 2, yPos);
            } else {
              pdf.text(displayCell, xPos + cellWidth - 1, yPos, { align: 'right' });
            }
            xPos += cellWidth;
          });
          pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        } else {
          // Data row with zebra striping
          if (tableRowCount % 2 === 1) {
            pdf.setFillColor(lightGray.r, lightGray.g, lightGray.b);
            pdf.rect(margin, yPos - 3, pageWidth - margin * 2, rowHeight, 'F');
          }
          pdf.setTextColor(darkText.r, darkText.g, darkText.b);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          
          let xPos = margin;
          cells.forEach((cell, idx) => {
            const cellWidth = colWidths[idx];
            if (idx === 0) {
              pdf.text(cell, xPos + 2, yPos);
            } else {
              // Highlight negative values in bold red
              if (highlightValue && cell.startsWith('-')) {
                pdf.setTextColor(negativeRed.r, negativeRed.g, negativeRed.b);
                pdf.setFont('helvetica', 'bold');
              }
              pdf.text(cell, xPos + cellWidth - 1, yPos, { align: 'right' });
              pdf.setTextColor(darkText.r, darkText.g, darkText.b);
              pdf.setFont('helvetica', 'normal');
            }
            xPos += cellWidth;
          });
          tableRowCount++;
        }

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6);
        yPos += rowHeight;
      };

      // ========== SMART PAGE BREAK LOGIC ==========
      // Pre-calculate total height needed for projections table + summary box
      // This helps us decide if we need to start the table on a new page
      const summaryBoxHeight = 16;
      const summarySpacing = 4;
      
      // Calculate approximate table height:
      // - 1 header row + 5 data rows + 4 section rows + remaining data rows
      // Total rows: header(1) + data(5) + section(STATISTICS) + data(5) + section(CASH) + data(7) + section(NON-CASH) + data(1) + section(SUMMARY) + data(5) = ~24 rows + 4 sections
      const totalDataRows = 23; // Regular data rows
      const totalSectionRows = 4; // Section header rows
      const headerRowHeight = rowHeight;
      const estimatedTableHeight = headerRowHeight + (totalDataRows * rowHeight) + (totalSectionRows * (sectionRowHeight + 1));
      const estimatedTotalHeight = estimatedTableHeight + summarySpacing + summaryBoxHeight;
      
      // Calculate year 10 values early for summary
      const year10 = projections[10];
      const totalCashFlow = projections.slice(1).reduce((sum, p) => sum + p.afterTaxCashFlowPA, 0);
      const capitalGain = year10.propertyMarketValue - baseFinancialData.purchasePrice;
      
      // If everything won't fit on remaining space of page 1, check if it fits at all on a fresh page
      const remainingSpaceOnPage = contentMaxY - yPos;
      const freshPageSpace = contentMaxY - margin - 5;
      
      // If table + summary won't fit in remaining space but will fit on a fresh page, continue
      // The drawRow function will handle individual row page breaks
      // Key: We just need to ensure summary box can stay with at least some of the table
      
      // Draw table - headers without "Metric"
      const headers = ['', 'Today', 'Yr 1', 'Yr 2', 'Yr 3', 'Yr 4', 'Yr 5', 'Yr 6', 'Yr 7', 'Yr 8', 'Yr 9', 'Yr 10'];
      drawRow(headers, true);

      // Helper to safely get projection data - ensures all 10 years have values
      const getYearData = (yearIndex: number) => projections[yearIndex] || projections[projections.length - 1];
      const years1to10 = Array.from({ length: 10 }, (_, i) => getYearData(i + 1));

      drawRow(['Capital Growth %', '', ...years1to10.map(p => p.capitalGrowthRate.toFixed(1))]);
      drawRow(['CPI Growth %', '', ...years1to10.map(p => p.cpiGrowthRate.toFixed(1))]);
      drawRow(['Property Value $', formatCurrency(projections[0].propertyMarketValue), ...years1to10.map(p => formatCurrency(p.propertyMarketValue))]);
      drawRow(['Purchase Price $', formatCurrency(baseFinancialData.purchasePrice), ...Array(10).fill('')]);
      drawRow(['Loan Amount $', formatCurrency(projections[0].loanAmount), ...years1to10.map(p => formatCurrency(p.loanAmount))]);
      
      drawRow(['STATISTICS'], false, true);
      drawRow(['Equity $', formatCurrency(projections[0].equityInProperty), ...years1to10.map(p => formatCurrency(p.equityInProperty))]);
      drawRow(['LVR %', projections[0].loanToValueRatio.toFixed(1), ...years1to10.map(p => p.loanToValueRatio.toFixed(1))]);
      drawRow(['Rental Income $', `${formatCurrency(baseFinancialData.weeklyRent)}pw`, ...years1to10.map(p => formatCurrency(p.rentalIncome))]);
      drawRow(['Gross Yield %', '', ...years1to10.map(p => p.grossYield.toFixed(2))]);
      drawRow(['Net Yield %', '', ...years1to10.map(p => p.netYield.toFixed(2))]);
      
      drawRow(['CASH DEDUCTIONS'], false, true);
      drawRow(['Property Expenses $', '$0', ...years1to10.map(p => formatCurrency(p.propertyExpenses))]);
      drawRow(['Land Tax $', '', ...years1to10.map(p => formatCurrency(p.landTax))]);
      drawRow(['Interest Rate %', '', ...years1to10.map(p => p.interestRate.toFixed(2))]);
      drawRow(['Interest Payments $', '$0', ...years1to10.map(p => formatCurrency(p.interestPayments))]);
      drawRow(['Principal Payments $', formatCurrency(projections[0].principalPayments), ...years1to10.map(p => formatCurrency(p.principalPayments))]);
      drawRow(['Pre-Tax Cash Flow p/a $', '', ...years1to10.map(p => formatCurrency(p.preTaxCashFlowPA))], false, false, true);
      drawRow(['Pre-Tax Cash Flow p/w $', '', ...years1to10.map(p => formatCurrency(p.preTaxCashFlowPW))], false, false, true);
      
      drawRow(['NON-CASH DEDUCTIONS'], false, true);
      drawRow(['Depreciation $', '', ...years1to10.map(p => formatCurrency(p.depreciation))]);
      
      // Mid-table page break suppressed - table must stay on single page.

      
      drawRow(['SUMMARY'], false, true);
      drawRow(['Total Deductions $', '', ...years1to10.map(p => formatCurrency(p.totalDeductions))]);
      drawRow(['Net Profit/Loss $', '', ...years1to10.map(p => formatCurrency(p.netProfitLoss))], false, false, true);
      drawRow(['Tax Refund / (Payable) $', '', ...years1to10.map(p => formatCurrency(p.taxEffect))], false, false, true);
      drawRow(['After-Tax Cash Flow p/a $', '', ...years1to10.map(p => formatCurrency(p.afterTaxCashFlowPA))], false, false, true);
      drawRow(['After-Tax Cash Flow p/w $', '', ...years1to10.map(p => formatCurrency(p.afterTaxCashFlowPW))], false, false, true);

      // ========== 10-YEAR SUMMARY CARDS ==========
      yPos += summarySpacing + 4;
      
      // Increased height for card layout with label + value
      const summaryCardHeight = 22;
      
      // Final check - if summary cards would overflow, add page
      if (yPos + summaryCardHeight + 8 > contentMaxY) {
        pdf.addPage();
        yPos = margin + 10;
      }

      // Section title
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(45, 55, 72); // Dark slate text
      pdf.text('10-Year Investment Summary', margin, yPos);
      yPos += 6;

      // Card styling - dark blue background with white text
      const darkBlue = { r: 45, g: 55, b: 72 }; // #2d3748 - dark slate blue
      const summaryContentWidth = pageWidth - margin * 2;
      const summaryCardGap = 3;
      const summaryCardWidth = (summaryContentWidth - (summaryCardGap * 3)) / 4;

      // Summary data for 4 cards
      const summaryCards = [
        { label: 'Property Value', value: formatCurrency(year10.propertyMarketValue) },
        { label: 'Total Equity', value: formatCurrency(year10.equityInProperty) },
        { label: 'Capital Gain', value: formatCurrency(capitalGain) },
        { label: 'Total After-Tax Cash Flow', value: formatCurrency(totalCashFlow) }
      ];

      // Draw each card
      summaryCards.forEach((card, index) => {
        const cardX = margin + (index * (summaryCardWidth + summaryCardGap));
        
        // Card background - dark blue with rounded corners
        pdf.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
        pdf.roundedRect(cardX, yPos, summaryCardWidth, summaryCardHeight, 2, 2, 'F');
        
        // Label - small white text at top
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(200, 200, 210); // Light gray for label
        pdf.text(card.label, cardX + 4, yPos + 7);
        
        // Value - larger white bold text below
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(255, 255, 255); // White for value
        pdf.text(card.value, cardX + 4, yPos + 16);
      });
      
      yPos += summaryCardHeight;

      // ========== CHARTS & VISUAL ANALYSIS PAGE ==========

      // Helper: draw an annotation/insight box below a chart
      const drawInsightBox = (text: string, xPos: number, boxWidth: number) => {
        const insightPadding = 4;
        const lines = pdf.splitTextToSize(text, boxWidth - insightPadding * 2);
        const boxHeight = lines.length * 3.5 + insightPadding * 2;
        
        // Subtle background with left accent
        pdf.setFillColor(254, 249, 235); // warm cream
        pdf.roundedRect(xPos, yPos, boxWidth, boxHeight, 1.5, 1.5, 'F');
        pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        pdf.rect(xPos, yPos + 1, 2, boxHeight - 2, 'F');
        
        pdf.setFontSize(6.5);
        pdf.setFont('helvetica', 'italic');
        pdf.setTextColor(80, 70, 50);
        pdf.text(lines, xPos + insightPadding + 2, yPos + insightPadding + 2);
        
        yPos += boxHeight + 4;
      };

      // Helper: draw a chart section title with caption
      const drawChartTitle = (title: string, caption: string) => {
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        pdf.text(title, margin, yPos);
        yPos += 4;
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(grayText.r, grayText.g, grayText.b);
        pdf.text(caption, margin, yPos);
        yPos += 5;
      };

      // Helper: draw a programmatic line chart using jsPDF when html2canvas fails
      const drawProgrammaticTrendsChart = (
        chartX: number, chartY: number, chartW: number, chartH: number,
        data: YearlyProjection[]
      ) => {
        const years = data.filter(p => p.year >= 1);
        if (years.length === 0) return;

        const innerPadding = { top: 14, bottom: 20, left: 32, right: 10 };
        const plotX = chartX + innerPadding.left;
        const plotY = chartY + innerPadding.top;
        const plotW = chartW - innerPadding.left - innerPadding.right;
        const plotH = chartH - innerPadding.top - innerPadding.bottom;

        // Background with subtle shadow effect
        pdf.setFillColor(252, 252, 253);
        pdf.roundedRect(chartX, chartY, chartW, chartH, 3, 3, 'F');
        pdf.setDrawColor(220, 220, 225);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(chartX, chartY, chartW, chartH, 3, 3, 'S');

        // Series definitions with improved colors
        const series = [
          { label: 'Property Value', color: { r: 37, g: 99, b: 235 }, getData: (p: YearlyProjection) => p.propertyMarketValue },
          { label: 'Equity', color: { r: 16, g: 185, b: 129 }, getData: (p: YearlyProjection) => p.equityInProperty },
          { label: 'Loan Balance', color: { r: 239, g: 68, b: 68 }, getData: (p: YearlyProjection) => p.loanAmount },
          { label: 'Cash Flow (p.a.)', color: { r: 139, g: 92, b: 246 }, getData: (p: YearlyProjection) => p.afterTaxCashFlowPA },
        ];

        // Calculate global min/max across all series
        let globalMin = Infinity, globalMax = -Infinity;
        for (const s of series) {
          for (const p of years) {
            const v = s.getData(p);
            if (v < globalMin) globalMin = v;
            if (v > globalMax) globalMax = v;
          }
        }
        // Add 5% padding to range
        const rawRange = globalMax - globalMin || 1;
        globalMin -= rawRange * 0.05;
        globalMax += rawRange * 0.05;
        const range = globalMax - globalMin;

        // Draw horizontal grid lines with labels
        pdf.setDrawColor(235, 235, 240);
        pdf.setLineWidth(0.15);
        for (let i = 0; i <= 5; i++) {
          const gy = plotY + plotH - (i / 5) * plotH;
          pdf.line(plotX, gy, plotX + plotW, gy);
          const val = globalMin + (i / 5) * range;
          pdf.setFontSize(5.5);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(130, 130, 140);
          const label = Math.abs(val) >= 1000000 ? `$${(val / 1000000).toFixed(1)}M` : Math.abs(val) >= 1000 ? `$${(val / 1000).toFixed(0)}K` : `$${val.toFixed(0)}`;
          pdf.text(label, plotX - 3, gy + 1.5, { align: 'right' });
        }

        // Draw x-axis labels
        const stepX = plotW / (years.length - 1 || 1);
        years.forEach((p, i) => {
          pdf.setFontSize(5.5);
          pdf.setTextColor(130, 130, 140);
          pdf.text(`Yr ${p.year}`, plotX + i * stepX, plotY + plotH + 6, { align: 'center' });
        });

        // Draw each series as a line with thicker stroke
        for (const s of series) {
          pdf.setDrawColor(s.color.r, s.color.g, s.color.b);
          pdf.setLineWidth(0.9);
          for (let i = 1; i < years.length; i++) {
            const x1 = plotX + (i - 1) * stepX;
            const x2 = plotX + i * stepX;
            const y1 = plotY + plotH - ((s.getData(years[i - 1]) - globalMin) / range) * plotH;
            const y2 = plotY + plotH - ((s.getData(years[i]) - globalMin) / range) * plotH;
            pdf.line(x1, y1, x2, y2);
          }
          // Draw dots at each data point
          for (let i = 0; i < years.length; i++) {
            const cx = plotX + i * stepX;
            const cy = plotY + plotH - ((s.getData(years[i]) - globalMin) / range) * plotH;
            pdf.setFillColor(255, 255, 255);
            pdf.circle(cx, cy, 1.2, 'F');
            pdf.setFillColor(s.color.r, s.color.g, s.color.b);
            pdf.circle(cx, cy, 0.9, 'F');
          }
          // End-point data label (Yr 10 value)
          const lastYear = years[years.length - 1];
          const lastVal = s.getData(lastYear);
          const lastCx = plotX + (years.length - 1) * stepX;
          const lastCy = plotY + plotH - ((lastVal - globalMin) / range) * plotH;
          pdf.setFontSize(5);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(s.color.r, s.color.g, s.color.b);
          const endLabel = Math.abs(lastVal) >= 1000000 ? `$${(lastVal / 1000000).toFixed(1)}M` : Math.abs(lastVal) >= 1000 ? `$${(lastVal / 1000).toFixed(0)}K` : `$${lastVal.toFixed(0)}`;
          pdf.text(endLabel, lastCx + 2, lastCy - 2);
        }

        // Legend bar at bottom
        let legendX = plotX;
        const legendY = chartY + chartH - 5;
        pdf.setFontSize(5.5);
        for (const s of series) {
          // Color circle instead of rectangle
          pdf.setFillColor(s.color.r, s.color.g, s.color.b);
          pdf.circle(legendX + 1.5, legendY - 0.5, 1.5, 'F');
          pdf.setTextColor(60, 60, 70);
          pdf.setFont('helvetica', 'normal');
          pdf.text(s.label, legendX + 4.5, legendY, { align: 'left' });
          legendX += pdf.getTextWidth(s.label) + 12;
        }
      };

      // Helper: draw a programmatic yield chart
      const drawProgrammaticYieldChart = (
        chartX: number, chartY: number, chartW: number, chartH: number,
        data: YearlyProjection[]
      ) => {
        const years = data.filter(p => p.year >= 1);
        if (years.length === 0) return;

        const innerPadding = { top: 14, bottom: 20, left: 28, right: 10 };
        const plotX = chartX + innerPadding.left;
        const plotY = chartY + innerPadding.top;
        const plotW = chartW - innerPadding.left - innerPadding.right;
        const plotH = chartH - innerPadding.top - innerPadding.bottom;

        pdf.setFillColor(252, 252, 253);
        pdf.roundedRect(chartX, chartY, chartW, chartH, 3, 3, 'F');
        pdf.setDrawColor(220, 220, 225);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(chartX, chartY, chartW, chartH, 3, 3, 'S');

        const yieldSeries = [
          { label: 'Gross Yield %', color: { r: 16, g: 185, b: 129 }, getData: (p: YearlyProjection) => p.grossYield },
          { label: 'Net Yield %', color: { r: 239, g: 68, b: 68 }, getData: (p: YearlyProjection) => p.netYield },
        ];

        let yMin = Infinity, yMax = -Infinity;
        for (const s of yieldSeries) {
          for (const p of years) {
            const v = s.getData(p);
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
        }
        // Add padding
        const rawYRange = yMax - yMin || 1;
        yMin -= rawYRange * 0.1;
        yMax += rawYRange * 0.1;
        const yRange = yMax - yMin;
        const stepX = plotW / (years.length - 1 || 1);

        // Grid
        pdf.setDrawColor(235, 235, 240);
        pdf.setLineWidth(0.15);
        for (let i = 0; i <= 4; i++) {
          const gy = plotY + plotH - (i / 4) * plotH;
          pdf.line(plotX, gy, plotX + plotW, gy);
          const val = yMin + (i / 4) * yRange;
          pdf.setFontSize(5.5);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(130, 130, 140);
          pdf.text(`${val.toFixed(1)}%`, plotX - 3, gy + 1.5, { align: 'right' });
        }

        years.forEach((p, i) => {
          pdf.setFontSize(5.5);
          pdf.setTextColor(130, 130, 140);
          pdf.text(`Yr ${p.year}`, plotX + i * stepX, plotY + plotH + 6, { align: 'center' });
        });

        for (const s of yieldSeries) {
          pdf.setDrawColor(s.color.r, s.color.g, s.color.b);
          pdf.setLineWidth(0.9);
          for (let i = 1; i < years.length; i++) {
            const x1 = plotX + (i - 1) * stepX;
            const x2 = plotX + i * stepX;
            const y1 = plotY + plotH - ((s.getData(years[i - 1]) - yMin) / yRange) * plotH;
            const y2 = plotY + plotH - ((s.getData(years[i]) - yMin) / yRange) * plotH;
            pdf.line(x1, y1, x2, y2);
          }
          for (let i = 0; i < years.length; i++) {
            const cx = plotX + i * stepX;
            const cy = plotY + plotH - ((s.getData(years[i]) - yMin) / yRange) * plotH;
            pdf.setFillColor(255, 255, 255);
            pdf.circle(cx, cy, 1.2, 'F');
            pdf.setFillColor(s.color.r, s.color.g, s.color.b);
            pdf.circle(cx, cy, 0.9, 'F');
          }
          // End-point label
          const lastYear = years[years.length - 1];
          const lastVal = s.getData(lastYear);
          const lastCx = plotX + (years.length - 1) * stepX;
          const lastCy = plotY + plotH - ((lastVal - yMin) / yRange) * plotH;
          pdf.setFontSize(5);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(s.color.r, s.color.g, s.color.b);
          pdf.text(`${lastVal.toFixed(2)}%`, lastCx + 2, lastCy - 2);
        }

        let legendX = plotX;
        const legendY = chartY + chartH - 5;
        pdf.setFontSize(5.5);
        for (const s of yieldSeries) {
          pdf.setFillColor(s.color.r, s.color.g, s.color.b);
          pdf.circle(legendX + 1.5, legendY - 0.5, 1.5, 'F');
          pdf.setTextColor(60, 60, 70);
          pdf.setFont('helvetica', 'normal');
          pdf.text(s.label, legendX + 4.5, legendY, { align: 'left' });
          legendX += pdf.getTextWidth(s.label) + 12;
        }
      };

      // Determine if we should show charts (either captured or fallback)
      const shouldShowTrends = activeChartToggles.cashFlowTrends;
      const shouldShowYield = activeChartToggles.yieldChart;
      const shouldShowComparison = activeChartToggles.comparisonChart && comparisonChartImage;
      const hasAnyChart = shouldShowTrends || shouldShowYield || shouldShowComparison;
      
      if (hasAnyChart) {
        pdf.addPage();
        yPos = 0;
        
        // Professional header bar
        pdf.setFillColor(45, 55, 72); // Dark slate
        pdf.rect(0, 0, pageWidth, 14, 'F');
        pdf.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        pdf.rect(0, 14, pageWidth, 1.5, 'F'); // Gold accent line
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(255, 255, 255);
        pdf.text('Visual & Technical Analysis', margin, 9);
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(200, 200, 210);
        pdf.text('Projected trends and performance metrics over the 10-year investment horizon', margin, 13);
        
        yPos = 22;
        const chartWidth = pageWidth - margin * 2;
        
        // Pre-compute insight data for annotations
        const yr1 = projections[1];
        const yr10Data = projections[10] || projections[projections.length - 1];
        const propertyGrowthPct = ((yr10Data.propertyMarketValue - baseFinancialData.purchasePrice) / baseFinancialData.purchasePrice * 100).toFixed(1);
        // Ten-year growth is measured from SETTLEMENT (year 0). It was measured
        // from end-of-year-1 equity — a nine-year interval printed under a
        // ten-year heading (QA-39). The sentence names its own endpoints.
        const equityGrowth = describeGrowth({
          label: 'Equity',
          startValue: projections[0]?.equityInProperty,
          endValue: yr10Data.equityInProperty,
          startLabel: 'settlement',
          endLabel: `Year ${yr10Data.year ?? 10}`,
          formatValue: formatCurrency,
        });
        const loanReductionPct = projections[0]?.loanAmount > 0 ? ((1 - yr10Data.loanAmount / projections[0].loanAmount) * 100).toFixed(1) : '0';
        
        // Cash Flow Trends Chart
        if (shouldShowTrends) {
          const chartHeight = 75;
          drawChartTitle(
            '10-Year Cash Flow Trends',
            'Tracks property value appreciation, equity growth, loan reduction, and annual after-tax cash flow over the projection period.'
          );
          
          if (cashFlowChartImage) {
            pdf.setDrawColor(220, 220, 225);
            pdf.setLineWidth(0.4);
            pdf.roundedRect(margin, yPos, chartWidth, chartHeight, 3, 3, 'S');
            pdf.addImage(cashFlowChartImage, 'PNG', margin + 2, yPos + 2, chartWidth - 4, chartHeight - 4);
          } else {
            drawProgrammaticTrendsChart(margin, yPos, chartWidth, chartHeight, projections);
          }
          yPos += chartHeight + 3;
          
          // Insight annotation — detailed financial narrative
          const yr1CashFlow = yr1?.afterTaxCashFlowPA || 0;
          const yr10CashFlow = yr10Data.afterTaxCashFlowPA;
          const cashFlowImproved = yr10CashFlow > yr1CashFlow;
          const cashFlowDelta = formatCurrency(Math.abs(yr10CashFlow - yr1CashFlow));
          const breakEvenYr = projections.filter(p => p.year >= 1).find((p, i, arr) => i > 0 && arr[i - 1].afterTaxCashFlowPA < 0 && p.afterTaxCashFlowPA >= 0);
          const crossoverYr = projections.filter(p => p.year >= 1).find(p => p.equityInProperty >= p.loanAmount);
          
          let trendInsight = `Property Value Growth: The property is projected to appreciate by ${propertyGrowthPct}% over the 10-year horizon, growing from ${formatCurrency(baseFinancialData.purchasePrice)} to ${formatCurrency(yr10Data.propertyMarketValue)}. This represents an average annual compound growth aligned with the configured capital growth assumptions.\n\n`;
          trendInsight += `${equityGrowth.sentence} Equity here is the property's value less the loan balance — it includes the capital contributed at settlement and is not a cash return. The loan balance falls by ${loanReductionPct}% over the same period.\n\n`;
          // "to", not "→": the arrow is outside the standard fonts' encoding,
          // and jsPDF measured the line without it and drew it letter-spaced
          // past the page edge (QA-40).
          trendInsight += `Cash Flow Trajectory: After-tax cash flow ${cashFlowImproved ? 'improves' : 'declines'} by ${cashFlowDelta} over the period (Year 1: ${formatCurrency(yr1CashFlow)} to Year 10: ${formatCurrency(yr10CashFlow)} p.a.).`;
          if (breakEvenYr) trendInsight += ` The investment reaches cash-flow positive in Year ${breakEvenYr.year}, marking the transition from negatively-geared to self-sustaining.`;
          if (crossoverYr) trendInsight += ` Equity surpasses the remaining loan balance in Year ${crossoverYr.year}, a key wealth-building milestone indicating the investor holds majority ownership of the asset.`;
          
          drawInsightBox(trendInsight, margin, chartWidth);
        }
        
        // Yield Chart
        if (shouldShowYield) {
          if (yPos > contentMaxY - 85) {
            pdf.addPage();
            yPos = margin + 5;
          }
          
          const chartHeight = 65;
          const yr1Gross = yr1?.grossYield?.toFixed(2) || '-';
          const yr10Gross = yr10Data?.grossYield?.toFixed(2) || '-';
          const yr1Net = yr1?.netYield?.toFixed(2) || '-';
          const yr10Net = yr10Data?.netYield?.toFixed(2) || '-';
          
          drawChartTitle(
            'Yield Analysis',
            'Gross and net rental yield against each year\'s projected value — how the yields move as rent and value change.'
          );
          
          if (yieldChartImage) {
            pdf.setDrawColor(220, 220, 225);
            pdf.setLineWidth(0.4);
            pdf.roundedRect(margin, yPos, chartWidth, chartHeight, 3, 3, 'S');
            pdf.addImage(yieldChartImage, 'PNG', margin + 2, yPos + 2, chartWidth - 4, chartHeight - 4);
          } else {
            drawProgrammaticYieldChart(margin, yPos, chartWidth, chartHeight, projections);
          }
          yPos += chartHeight + 3;
          
          // Yield insight — detailed
          const grossDelta = (parseFloat(yr10Gross) - parseFloat(yr1Gross)).toFixed(2);
          const netDelta = (parseFloat(yr10Net) - parseFloat(yr1Net)).toFixed(2);
          const avgSpread = projections.filter(p => p.year >= 1).reduce((s, p) => s + (p.grossYield - p.netYield), 0) / 10;
          
          // Direction of change is computed from the endpoints, never asserted:
          // a flat or absent-rent series said "compression" here (QA-38).
          const rentEstablished = baseFinancialData.weeklyRent > 0 && !baseFinancialData.missingInputs.includes('weeklyRent');
          const grossMovement = describeYieldMovement({ label: 'Gross Yield', yearOne: yr1?.grossYield, yearTen: yr10Data?.grossYield, rentEstablished });
          const netMovement = describeYieldMovement({ label: 'Net Yield', yearOne: yr1?.netYield, yearTen: yr10Data?.netYield, rentEstablished });
          let yieldInsight = `${grossMovement.sentence}\n\n`;
          yieldInsight += `${netMovement.sentence} Net yield accounts for property expenses including council rates, insurance, maintenance, and management fees, before finance and tax.\n\n`;
          // The spread between the two yields is (rent - (rent - expenses)) / value,
          // which is simply expenses over value: rent cancels out entirely. So the
          // old sentence here — "a narrowing spread indicates improving operational
          // efficiency as rental growth outpaces expense inflation" — asserted a
          // cause the arithmetic makes impossible, and in this model rent and
          // expenses are both indexed to the same CPI anyway. It narrows because
          // the value it is divided by compounds faster than the costs do.
          yieldInsight += `Expense Drag: The average spread between gross and net yield is ${avgSpread.toFixed(2)} percentage points. This spread is the year's holding costs measured against the property's value, so it narrows as the value compounds faster than the costs — it is a statement about the growing asset base, not about costs falling.`;
          
          drawInsightBox(yieldInsight, margin, chartWidth);
        }
        
        // Comparison Chart
        if (shouldShowComparison && comparisonChartImage) {
          if (yPos > contentMaxY - 80) {
            pdf.addPage();
            yPos = margin + 5;
          }
          
          const chartHeight = 65;
          drawChartTitle(
            'Multi-Property Comparison',
            'Side-by-side performance analysis of selected properties across key financial indicators for comparative assessment.'
          );
          
          pdf.setDrawColor(220, 220, 225);
          pdf.setLineWidth(0.4);
          pdf.roundedRect(margin, yPos, chartWidth, chartHeight, 3, 3, 'S');
          pdf.addImage(comparisonChartImage, 'PNG', margin + 2, yPos + 2, chartWidth - 4, chartHeight - 4);
          yPos += chartHeight + 3;
          
          drawInsightBox('Multi-Property Comparison: This chart presents a side-by-side analysis of property value trajectories across selected investment properties. By overlaying growth curves, investors can visually identify which assets offer superior capital appreciation potential, assess relative risk profiles, and make data-driven portfolio allocation decisions. Properties with steeper upward curves indicate stronger projected growth, while convergence or divergence patterns reveal market segment dynamics.', margin, chartWidth);
        }
      }

      // ========== CONTACT / DISCLAIMER PAGE (Last Page) ==========
      const globalSettings = await fetchGlobalReportSettings();
      drawJsPDFDisclaimerPage(pdf, globalSettings.contactDetails, globalSettings.disclaimer);

      // ========== FOOTER (on content pages only, skip cover and contact pages) ==========
      const totalPages = pdf.getNumberOfPages();
      const coverPageIndex = 1;
      const contactPageIndex = totalPages;
      
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        
        // Skip cover page (first) and contact page (last)
        if (i === coverPageIndex || i === contactPageIndex) {
          continue;
        }
        
        // Footer separator line and disclaimer — skip on first content page
        // so the construction schedule table renders without overlap
        if (i !== coverPageIndex + 1) {
          pdf.setDrawColor(mediumGray.r, mediumGray.g, mediumGray.b);
          pdf.setLineWidth(0.5);
          pdf.line(margin, contentMaxY + 2, pageWidth - margin, contentMaxY + 2);

          pdf.setFontSize(6.5);
          pdf.setFont('helvetica', 'italic');
          pdf.setTextColor(grayText.r, grayText.g, grayText.b);
          const disclaimerLinesFooter = pdf.splitTextToSize(templateConfig.disclaimer, pageWidth - margin * 2.5);
          pdf.text(disclaimerLinesFooter, pageWidth / 2, contentMaxY + 8, { align: 'center' });
        }

        
        // Contact info and page number at very bottom
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(darkText.r, darkText.g, darkText.b);
        pdf.text(`${templateConfig.contactEmail}  •  ${templateConfig.website}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
        
        // Page number (content pages start from 1, excluding cover)
        const contentPageNum = i - 1; // Exclude cover page from count
        const totalContentPages = totalPages - 2; // Exclude cover and contact pages
        pdf.setFontSize(7);
        pdf.setTextColor(grayText.r, grayText.g, grayText.b);
        pdf.text(`Page ${contentPageNum} of ${totalContentPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
      }

      // If returnBlob requested, return the blob without saving to disk
      if (options?.returnBlob) {
        return pdf.output('blob');
      }

      // Save PDF - use cleaned address for filename
      const cleanedAddressForFile = report.property_address.replace(/[_\s]?Copy[_\s]?\d*$/i, '').trim();
      const fileName = `Cash_Flow_10Year_${cleanedAddressForFile.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      pdf.save(fileName);

      toast({
        title: "PDF Exported",
        description: "10-year cash flow analysis PDF has been downloaded.",
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export PDF. Please try again.",
        variant: "destructive"
      });
    }
  }, [report, baseFinancialData, projections, includeInputsSummaryInExport, includeConstructionScheduleInExport, constructionProgressSchedule, isNewBuild, chartExportToggles, excludeLandTaxFromCashFlow, toast]);

  // ── The FINAL Cash Flow document — one producer for every exit (RS-5c.2) ──
  /**
   * Three exits used to make three documents. "Generate PDF" asked the chosen
   * template and then the format's own WeasyPrint route; "Send to Client" ran
   * the in-browser jsPDF generator with its own chart switches and uploaded
   * THAT; the legacy menu item ran jsPDF a third way. So the file a client
   * opened in their portal was never the document the adviser had generated
   * and reviewed. Everything below is the one description and the one
   * producer the download and the send now share.
   *
   * `describeReviewedProjection` names what the document is drawn from — the
   * ten years on screen (overrides included), the stored scenario those years
   * prove, and the template choice at this moment — and folds them into a
   * `key`. A send reuses a document already produced only while its key still
   * matches: one finalisation, one PDF, and never a stale one, because a moved
   * override is a different document.
   *
   * `produceFinalCashFlowDocument` answers where the bytes ALREADY are. A
   * templated final is stored by `render-template-pdf` (`investment-reports`),
   * a route render by `render-cash-flow-pdf` (`client-files`), and the client
   * portal signs either bucket — so sending is pointing the portal at a stored
   * object, never uploading a second copy. Only the deployment-gap fallback
   * (the route absent, jsPDF drawing the document) has nothing stored, and
   * says so with `storagePath: null`.
   */
  type ReviewedProjection = {
    wire: ReturnType<typeof toWireProjection>;
    storedScenario: ReturnType<typeof matchStoredScenario>;
    selectedTemplateId: string | null;
    key: string;
  };
  type ProducedCashFlowDocument = {
    key: string;
    /**
     * `template` and `route` are the pinned engine; `legacy` is the browser's
     * jsPDF, reached only when the route is not deployed.
     */
    source: 'template' | 'route' | 'legacy';
    blob: Blob;
    fileName: string;
    storagePath: string | null;
    brandGaps: string[];
    pageCount: number | null;
  };

  const describeReviewedProjection = useCallback(async (): Promise<ReviewedProjection> => {
    if (!report) throw new Error('This report could not be resolved. Close the analysis and reopen it.');
    if (!baseFinancialData || !projections.length) throw new Error('This report has no financial figures to render.');
    assertProjectionComplete(baseFinancialData);

    // The projection that crosses the wire is the one on screen, unsaved
    // overrides included, because that is the ten years the adviser just
    // reviewed. See `requestCashFlowPdf` for why the server does not recompute it.
    const wire = toWireProjection({
      projections,
      base: baseFinancialData,
      firstCalendarYear: new Date().getFullYear() + 1,
      // What the tax, land-tax and cost lines rest on is said on the page
      // (QA-12, QA-14, QA-15) — `evidenceBasisNotes` is the one wording.
      notes: [
        ...(baseFinancialData.includeDepreciationInCashFlow
          ? []
          : ['Depreciation is excluded from this projection at the adviser\'s direction.']),
        ...evidenceBasisNotes(baseFinancialData),
      ],
    });
    // When the series on screen IS a stored scenario the document may honestly
    // say "Moderate"; otherwise it says "Adviser-reviewed" — never a scenario
    // label the series does not satisfy.
    const storedScenario = matchStoredScenario(wire, report);
    // Read ONCE, here, so the key this document is filed under and the template
    // the route renders are the same reading (`selectedTemplateId` below).
    const selectedTemplateId = await selectedTemplateFor('cashflow');
    return {
      wire,
      storedScenario,
      selectedTemplateId,
      key: cashFlowFinalKey({ wire, scenario: storedScenario, selectedTemplateId }),
    };
  }, [report, baseFinancialData, projections]);

  const produceFinalCashFlowDocument = useCallback(async (
    reviewed: ReviewedProjection,
  ): Promise<ProducedCashFlowDocument> => {
    if (!report) throw new Error('This report could not be resolved. Close the analysis and reopen it.');
    const { wire, storedScenario, selectedTemplateId, key } = reviewed;

    // ALWAYS the series on screen, never a re-read. The payload used to be
    // sent only when the screen and the store disagreed, which left the
    // matched case depending on the adapter re-reading `investment_reports` —
    // a read that can be refused, and whose refusal is indistinguishable from
    // "this record cannot be templated", so the document silently came out of
    // the standard composer. Everything the template needs is already here.
    const templated = await tryTemplateDocument('cashflow', report.id, {
      variant: storedScenario,
      payload: {
        wire,
        propertyAddress: report.property_address ?? null,
        scenario: storedScenario,
      },
      // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
      renderer: 'weasyprint',
      selectedTemplateId,
    });
    if (templated) {
      return {
        key, source: 'template', blob: templated.blob, fileName: templated.fileName,
        storagePath: templated.storagePath, brandGaps: [], pageCount: null,
      };
    }

    // The format's own WeasyPrint route. `exportSingleReportPDF` is its
    // fallback and is reached ONLY when the route is not deployed; the bytes
    // are kept rather than saved, because the caller decides what happens to
    // them — a download saves them, a send points the portal at them.
    let legacyBlob: Blob | null = null;
    const result = await requestCashFlowPdf(
      { reportId: report.id, projection: wire },
      async () => {
        const blob = await exportSingleReportPDF({ returnBlob: true });
        if (!blob || !(blob instanceof Blob)) return null;
        legacyBlob = blob;
        return {
          url: '',
          fileName: `Cash_Flow_Analysis_${(report.property_address || 'report').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
          bytes: blob.size,
        };
      },
    );

    if (result.source === 'legacy') {
      if (!legacyBlob) throw new Error('The PDF renderer produced no document.');
      return {
        key, source: 'legacy', blob: legacyBlob, fileName: result.fileName,
        storagePath: null, brandGaps: [], pageCount: null,
      };
    }

    // A signed link, fetched rather than followed, so the caller holds the bytes.
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return {
      key, source: 'route', blob: await res.blob(), fileName: result.fileName,
      storagePath: result.storagePath, brandGaps: result.brandGaps, pageCount: result.pageCount,
    };
  }, [report, exportSingleReportPDF]);

  /**
   * Audit item 14 — "Export → Send to Client" reported `PDF generation failed.
   * Please try again.` That message is `SendToClientModal`'s reading of a
   * falsy return, and this function had FIVE ways to produce one; two logged
   * nothing, and a refused upload discarded its reason. Each fault still
   * throws its own sentence, which the modal renders as `Failed to send: …`.
   *
   * What it answers is the storage path the portal row is written with. Since
   * RS-5c.2 that is the FINAL document's own stored object — the same file
   * "Generate PDF" downloads — reused when one was already produced for this
   * exact projection. The upload below survives only for the deployment-gap
   * fallback, whose document nothing has stored.
   */
  const generateAndUploadCashFlowPDF = useCallback(async (): Promise<string | null> => {
    if (!report) throw new Error('This report could not be resolved. Close the analysis and reopen it.');
    if (!baseFinancialData) throw new Error('This report has no financial figures to render.');

    try {
      const reviewed = await describeReviewedProjection();
      if (finalCashFlowDocument && finalCashFlowDocument.key === reviewed.key) {
        return finalCashFlowDocument.storagePath;
      }

      const doc = await produceFinalCashFlowDocument(reviewed);
      if (doc.storagePath) {
        setFinalCashFlowDocument({ key: doc.key, storagePath: doc.storagePath, fileName: doc.fileName });
        return doc.storagePath;
      }

      // Only the deployment-gap fallback reaches here: the route is absent, the
      // in-browser generator drew the document, and nothing has stored it. It
      // is uploaded exactly as the send always was, bound to its report.
      const cleanedAddress = report.property_address.replace(/[_\s]?Copy[_\s]?\d*$/i, '').trim();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `cashflow-analysis/${report.id}/${timestamp}_Cash_Flow_${cleanedAddress.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const file = new File([doc.blob], fileName.split('/').pop() || 'cashflow.pdf', { type: 'application/pdf' });

      const uploadResult = await secureStorageUpload('investment-reports', fileName, file, {
        contentType: 'application/pdf',
        // The `investment-reports` bucket binds to the report row itself.
        resourceId: report.id,
      });

      if (uploadResult?.success && uploadResult.path) {
        setFinalCashFlowDocument({ key: doc.key, storagePath: uploadResult.path, fileName: doc.fileName });
        return uploadResult.path;
      }
      // The refusal, said rather than swallowed. `secure-storage` answers with
      // a reason and this threw it away, which is how "Invalid upload resource"
      // reached an operator as "PDF generation failed".
      throw new Error(uploadResult?.error || 'The document could not be stored.');
    } catch (error) {
      console.error('Error producing the cash flow PDF for sending:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }, [report, baseFinancialData, finalCashFlowDocument, describeReviewedProjection, produceFinalCashFlowDocument]);

  /**
   * The typeset PDF — built here, rendered by WeasyPrint, stored and signed.
   *
   * The projection that crosses the wire is the one on screen, unsaved
   * overrides included, because that is the ten years the adviser just
   * reviewed. See `requestCashFlowPdf` for why the server does not recompute
   * it.
   *
   * `exportSingleReportPDF` is passed as the fallback and is *only* reached
   * when the route is not deployed. It stays in the menu in its own right.
   */
  /**
   * The comparison as the render route wants it, or null when there is not one.
   *
   * Built at press time rather than held in state, for the reason
   * `requestCashFlowPdf` gives about the single-property document: the
   * projections on screen include overrides the adviser has not saved, and those
   * are the ten years they just reviewed.
   *
   * The written analysis rides along if there is one and is simply absent if
   * there is not. Unlike `exportAiAnalysisPDF`, this path does not require it.
   */
  const buildWireComparison = useCallback((): WireComparison | null => {
    if (!report || projections.length < 2) return null;
    const peers = allComparisonProjections
      .filter(({ projections: peerYears }) => peerYears.length > 1)
      .map(({ report: peerReport, projections: peerYears }) => ({
        report: peerReport,
        projections: peerYears,
      }));
    if (!peers.length) return null;

    const currentYear = new Date().getFullYear();
    return toWireComparison({
      primary: { report, projections },
      peers,
      investorProfile,
      analysis: aiAnalysis,
      firstCalendarYear: currentYear + 1,
      currentYear,
    });
  }, [report, projections, allComparisonProjections, investorProfile, aiAnalysis]);

  const comparisonUnavailableReason = comparisonReports.length === 0
    ? 'Add at least one comparison property first.'
    : undefined;

  const exportServerCashFlowPDF = useCallback(async () => {
    if (!report || !baseFinancialData || !projections.length) return;
    if (isExportingServerPdf) return;

    setIsExportingServerPdf(true);
    try {
      const reviewed = await describeReviewedProjection();
      const doc = await produceFinalCashFlowDocument(reviewed);

      saveTemplateDocument({ blob: doc.blob, fileName: doc.fileName });
      // Remembered for "Send to Client", which then points the portal at the
      // same stored object instead of producing the document a second time.
      if (doc.storagePath) {
        setFinalCashFlowDocument({ key: doc.key, storagePath: doc.storagePath, fileName: doc.fileName });
      }

      logActivityDirect({
        actionType: 'report_pdf_downloaded',
        entityType: 'investment_report',
        entityId: report.id,
        entityName: report.property_address,
        metadata: {
          format: 'pdf',
          source: doc.source === 'template'
            ? 'cash_flow_template'
            : `cash_flow_${doc.source === 'route' ? 'server' : 'legacy'}`,
          scenario: reviewed.storedScenario,
          pages: doc.pageCount,
        },
      });

      // A chosen template that was not honoured is said by `tryTemplateDocument`
      // itself, naming the gate that closed. The note this used to add here —
      // "a template prints the saved projection instead" — described the world
      // before the payload channel and had become untrue.
      toast({
        title: doc.source === 'legacy' ? 'Generated with the legacy layout' : 'Cash Flow Analysis ready',
        description: doc.source === 'legacy'
          ? 'The server renderer is not deployed yet, so the in-browser generator was used.'
          : doc.brandGaps.length
            ? `Your download should begin shortly. Note: ${doc.brandGaps.join('; ')}.`
            : 'Your download should begin shortly.',
      });
    } catch (error) {
      console.error('[CashFlowAnalysisModal] server PDF failed', error);
      toast({
        title: 'Could not generate the PDF',
        description: error instanceof Error ? error.message : 'Try the legacy layout, or retry shortly.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingServerPdf(false);
    }
  }, [
    report, baseFinancialData, projections, isExportingServerPdf, toast,
    describeReviewedProjection, produceFinalCashFlowDocument,
  ]);

  // Print-friendly view in new window
  const openPrintView = useCallback(() => {
    if (!report || !baseFinancialData) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: "Popup Blocked",
        description: "Please allow popups to open the print view.",
        variant: "destructive"
      });
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>10-Year Cash Flow Analysis - ${report.property_address}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; }
          h1 { font-size: 24px; margin-bottom: 8px; }
          h2 { font-size: 18px; color: #666; margin-bottom: 16px; }
          .meta { color: #888; font-size: 12px; margin-bottom: 24px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
          .metric { background: #f5f5f5; padding: 16px; border-radius: 8px; }
          .metric-label { font-size: 12px; color: #666; margin-bottom: 4px; }
          .metric-value { font-size: 24px; font-weight: bold; }
          .metric-sub { font-size: 11px; color: #888; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 24px; }
          th, td { padding: 6px 8px; text-align: right; border-bottom: 1px solid #eee; }
          th { background: #3b82f6; color: white; font-weight: 600; }
          td:first-child, th:first-child { text-align: left; font-weight: 500; }
          .section-header { background: #f0f0f0; font-weight: bold; }
          .text-green { color: #16a34a; }
          .text-red { color: #dc2626; }
          .equity-row td:not(:first-child) { color: #16a34a; }
          .summary { background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
          .summary h3 { font-size: 14px; margin-bottom: 8px; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
          .summary-item { text-align: center; }
          .summary-label { font-size: 11px; color: #666; }
          .summary-value { font-size: 18px; font-weight: bold; color: #3b82f6; }
          .disclaimer { font-size: 10px; color: #888; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; }
          @media print { 
            body { padding: 0; }
            .no-print { display: none; }
            table { page-break-inside: avoid; }
          }
          .print-btn { position: fixed; top: 20px; right: 20px; background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 500; }
          .print-btn:hover { background: #2563eb; }
        </style>
      </head>
      <body>
        <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>
        
        <h1>10-Year Cash Flow Analysis</h1>
        <h2>${report.property_address}</h2>
        <p class="meta">Generated: ${new Date().toLocaleDateString('en-AU')}</p>
        
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Property Value</div>
            <div class="metric-value">${formatCurrency(baseFinancialData.marketValueNow)}</div>
            <div class="metric-sub">Current market value</div>
          </div>
          <div class="metric">
            <div class="metric-label">Purchase Price</div>
            <div class="metric-value">${formatCurrency(baseFinancialData.purchasePrice)}</div>
            <div class="metric-sub">Original purchase price</div>
          </div>
          <div class="metric">
            <div class="metric-label">Loan Amount</div>
            <div class="metric-value">${formatCurrency(baseFinancialData.loanAmount)}</div>
            <div class="metric-sub">${baseFinancialData.loanToValueRatio}% LVR</div>
          </div>
          <div class="metric">
            <div class="metric-label">Weekly Rent</div>
            <div class="metric-value">${formatCurrency(baseFinancialData.weeklyRent)}</div>
            <div class="metric-sub">${formatCurrency(baseFinancialData.weeklyRent * 52)} p.a.</div>
          </div>
          <div class="metric">
            <div class="metric-label">Year 10 Value</div>
            <div class="metric-value">${formatCurrency(projections[10]?.propertyMarketValue || 0)}</div>
            <div class="metric-sub">Projected @ ${baseFinancialData.capitalGrowth}% growth</div>
          </div>
        </div>
        
        ${includeInputsSummaryInExport ? `
        <!-- Summary -->
        <div class="summary" style="margin-bottom: 24px;">
          <h3 style="margin-bottom: 4px; text-align: center; font-size: 16px; font-weight: bold; border-bottom: 2px solid #ccc; padding-bottom: 6px;">${isNewBuild ? 'New Build' : 'Existing Property'}</h3>
          <h4 style="margin-bottom: 12px; text-align: center; font-size: 14px; font-weight: bold; letter-spacing: 1px;">SUMMARY</h4>
          <table style="margin-bottom: 0; font-size: 11px;">
            <tbody>
              <tr><td style="font-weight: 500; width: 50%;">Purchase Price</td><td style="text-align: right;">${formatCurrency(baseFinancialData.purchasePrice)}</td></tr>
              ${isNewBuild ? `
              <tr><td style="font-weight: 500;">Land Price</td><td style="text-align: right;">${landBuildSplit(baseFinancialData).landPrice === null ? 'Not stated' : formatCurrency(landBuildSplit(baseFinancialData).landPrice!)}</td></tr>
              <tr><td style="font-weight: 500;">Build Price</td><td style="text-align: right;">${landBuildSplit(baseFinancialData).buildPrice === null ? 'Not stated' : formatCurrency(landBuildSplit(baseFinancialData).buildPrice!)}</td></tr>
              ` : `
              <tr><td style="font-weight: 500;">Deposit Value</td><td style="text-align: right;">${formatCurrency(baseFinancialData.depositValue || (baseFinancialData.purchasePrice * (1 - baseFinancialData.loanToValueRatio / 100)))}</td></tr>
              `}
              <tr><td style="font-weight: 500;">Loan to Value ratio</td><td style="text-align: right;">${baseFinancialData.loanToValueRatio}%</td></tr>
              <tr><td style="font-weight: 500;">Interest Rate</td><td style="text-align: right;">${baseFinancialData.interestRate.toFixed(2)}%</td></tr>
              <tr><td style="font-weight: 500;">Capital Growth</td><td style="text-align: right;">${baseFinancialData.capitalGrowth}%</td></tr>
              <tr><td style="font-weight: 500;">Weekly Rent</td><td style="text-align: right;">${formatCurrency(baseFinancialData.weeklyRent)}</td></tr>
              <tr><td style="font-weight: 500;">Stamp Duty</td><td style="text-align: right;">${formatCurrency(baseFinancialData.stampDuty)}</td></tr>
              <tr><td style="font-weight: 500;">Body Corporate / Strata Fees</td><td style="text-align: right;">${formatCurrency(baseFinancialData.bodyCorporateFees)}</td></tr>
              <tr><td style="font-weight: 500;">Council Rate Charges</td><td style="text-align: right;">${formatCurrency(baseFinancialData.councilRates)}</td></tr>
              <tr><td style="font-weight: 500;">Water Rate Charges (Other)</td><td style="text-align: right;">${formatCurrency(baseFinancialData.waterRates)}</td></tr>
              <tr><td style="font-weight: 500;">Solicitor Fees</td><td style="text-align: right;">${formatCurrency(baseFinancialData.solicitorFees)}</td></tr>
              <tr><td style="font-weight: 500;">Building & Landlord Insurance</td><td style="text-align: right;">${formatCurrency(baseFinancialData.buildingLandlordInsurance)}</td></tr>
              <tr><td style="font-weight: 500;">Property Management Fees</td><td style="text-align: right;">${baseFinancialData.propertyManagementFees}%</td></tr>
              <tr><td style="font-weight: 500;">Repairs & Maintenance</td><td style="text-align: right;">${formatCurrency(baseFinancialData.repairsMaintenance)}</td></tr>
              <tr><td style="font-weight: 500;">Letting Fees (1 Week Rent)</td><td style="text-align: right;">${formatCurrency(baseFinancialData.lettingFees || baseFinancialData.weeklyRent)}</td></tr>
              ${baseFinancialData.lmiAmount > 0 ? `<tr><td style="font-weight: 500;">LMI (Lenders Mortgage Insurance)</td><td style="text-align: right;">${formatCurrency(baseFinancialData.lmiAmount)}</td></tr>` : ''}
            </tbody>
          </table>
          ${(() => {
            const depositValue = baseFinancialData.depositValue || (baseFinancialData.purchasePrice * (1 - (baseFinancialData.loanToValueRatio || 80) / 100));
            const depositPct = baseFinancialData.purchasePrice > 0 ? Math.round((depositValue / baseFinancialData.purchasePrice) * 100) : 0;
            const stampDuty = baseFinancialData.stampDuty || 0;
            const solicitorFees = baseFinancialData.solicitorFees || 0;
            const inspectionFees = baseFinancialData.inspectionFees || 0;
            const agentFee = baseFinancialData.agentFee || 0;
            const lmiAmount = baseFinancialData.lmiAmount || 0;
            let upfrontRows: { label: string; value: number }[] = [];
            let overallExtraRows: { label: string; value: number }[] = [];
            let totalUpfront = 0;
            let totalOverall = 0;
            if (isNewBuild && constructionProgressSchedule) {
              const landDeposit = constructionProgressSchedule.upfrontCosts.tenPercentLand;
              const buildDeposit = constructionProgressSchedule.upfrontCosts.fivePercentBuild;
              const constructionProgressTotal = constructionProgressSchedule.buildPrice;
              const stagedInterest = constructionProgressSchedule.totals.totalCombinedRepayment;
              upfrontRows = [
                { label: '10% Land Deposit', value: landDeposit },
                { label: '5% Build Contract Deposit', value: buildDeposit },
                { label: 'Stamp Duty', value: stampDuty },
                { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
                ...(lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: lmiAmount }] : []),
              ];
              totalUpfront = landDeposit + buildDeposit + stampDuty + solicitorFees + stagedInterest + lmiAmount;
              overallExtraRows = [
                { label: 'Purchase Price (Land)', value: constructionProgressSchedule.landPrice },
                { label: 'Stamp Duty', value: stampDuty },
                { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                { label: 'Build Price', value: constructionProgressTotal },
                { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
              ];
              totalOverall = constructionProgressSchedule.landPrice + stampDuty + solicitorFees + constructionProgressTotal + stagedInterest;
            } else {
              upfrontRows = [
                { label: `Deposit (${depositPct}% — from your funds)`, value: depositValue },
                { label: 'Stamp Duty', value: stampDuty },
                { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                ...(inspectionFees > 0 ? [{ label: 'Building & Pest Inspections', value: inspectionFees }] : []),
                { label: 'Agent Fee', value: agentFee },
                ...(lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: lmiAmount }] : []),
              ];
              totalUpfront = depositValue + stampDuty + solicitorFees + inspectionFees + agentFee + lmiAmount;
              overallExtraRows = [
                { label: 'Purchase Price', value: baseFinancialData.purchasePrice },
                { label: 'Stamp Duty', value: stampDuty },
                { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                { label: 'Agent Fee', value: agentFee },
              ];
              totalOverall = baseFinancialData.purchasePrice + stampDuty + solicitorFees + agentFee;
            }
            const rowsHtml = (rows: { label: string; value: number }[]) => rows.map(r =>
              `<tr><td style="font-weight: 500;">${r.label}</td><td style="text-align: right;">${formatCurrency(r.value)}</td></tr>`
            ).join('');
            return `
              <div style="margin-top: 16px; padding-top: 12px; border-top: 2px solid #ccc;">
                <h4 style="font-size: 12px; font-weight: bold; margin-bottom: 8px;">Total Upfront Costs</h4>
                <table style="margin-bottom: 0; font-size: 11px;">
                  <tbody>
                    ${rowsHtml(upfrontRows)}
                    <tr style="background: #e5e7eb;"><td style="font-weight: 600;">Total Upfront Costs</td><td style="text-align: right; font-weight: 600;">${formatCurrency(totalUpfront)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div style="margin-top: 16px; padding-top: 12px; border-top: 2px solid #ccc;">
                <h4 style="font-size: 12px; font-weight: bold; margin-bottom: 8px;">Total Overall Expenditure to Completion</h4>
                <table style="margin-bottom: 0; font-size: 11px;">
                  <tbody>
                    ${rowsHtml(overallExtraRows)}
                    <tr style="background: #dbeafe;"><td style="font-weight: bold; color: #2563eb;">Total Overall Expenditure to Completion</td><td style="text-align: right; font-weight: bold; color: #2563eb;">${formatCurrency(totalOverall)}</td></tr>
                  </tbody>
                </table>
              </div>
            `;
          })()}
        </div>
        ` : ''}
        
        ${isNewBuild && includeConstructionScheduleInExport && constructionProgressSchedule && constructionProgressSchedule.buildPrice > 0 ? `
        <!-- Construction Progress Payment Schedule (New Builds Only) -->
        <div class="summary" style="margin-bottom: 24px;">
          <h3 style="margin-bottom: 12px;">Construction Progress Payment Schedule</h3>
          <div style="display: flex; gap: 24px; margin-bottom: 16px; padding: 12px; background: #f0f4f8; border-radius: 6px;">
            <div><span style="font-size: 11px; color: #666;">Land Cost</span><br><strong>${formatCurrency(constructionProgressSchedule.landPrice)}</strong></div>
            <div><span style="font-size: 11px; color: #666;">Build Contract</span><br><strong>${formatCurrency(constructionProgressSchedule.buildPrice)}</strong></div>
            <div><span style="font-size: 11px; color: #666;">Total Project</span><br><strong>${formatCurrency(constructionProgressSchedule.totalProject)}</strong></div>
          </div>
          <p style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Build Contract Breakdown (${constructionProgressSchedule.durationMonths} Month Construction)</p>
          <table style="margin-bottom: 0; font-size: 11px;">
            <thead>
              <tr>
                <th style="text-align: left;">Stage</th>
                <th style="text-align: left;">Description</th>
                <th style="text-align: center;">Total Build Contract</th>
                <th style="text-align: right;">Stage Pricing</th>
                <th style="text-align: right;">Land Interest (Monthly)</th>
                <th style="text-align: right;">Build Interest (Monthly)</th>
                <th style="text-align: right;">Combined Repayment</th>
                <th style="text-align: center;">Month</th>
              </tr>
            </thead>
            <tbody>
              ${constructionProgressSchedule.stages.map((stage, idx) => `
              <tr style="${idx === 0 ? 'background: #f5f5f5;' : ''}">
                <td style="text-align: left; font-weight: 500;">${stage.stage}</td>
                <td style="text-align: left; color: #666; font-size: 10px;">${stage.description}</td>
                <td style="text-align: center;">${stage.percentage > 0 ? `${stage.percentage}%` : ''}</td>
                <td style="text-align: right;">${formatCurrency(stage.buildAmount)}</td>
                <td style="text-align: right;">${formatCurrency(stage.landInterest)}</td>
                <td style="text-align: right;">${stage.buildInterest > 0 ? formatCurrency(stage.buildInterest) : ''}</td>
                <td style="text-align: right; font-weight: 500;">${formatCurrency(stage.totalMonthlyInterest)}</td>
                <td style="text-align: center;">${stage.month}</td>
              </tr>
              `).join('')}
              <tr style="background: #f0f0f0; font-weight: bold; border-top: 2px solid #ccc;">
                <td></td>
                <td></td>
                <td style="text-align: center;">100%</td>
                <td style="text-align: right;">${formatCurrency(constructionProgressSchedule.landPrice + constructionProgressSchedule.buildPrice)}</td>
                <td style="text-align: right;">Total</td>
                <td></td>
                <td style="text-align: right;">${formatCurrency(constructionProgressSchedule.totals.totalCombinedRepayment)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <p style="font-size: 10px; color: #888; margin-top: 8px;">* Interest calculated at ${constructionProgressSchedule.interestRate}% p.a. Land interest is constant; build interest increases as stages are drawn.</p>
        </div>
        ` : ''}
        
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Today</th>
              ${Array.from({ length: 10 }, (_, i) => `<th>Yr ${i + 1}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Capital Growth %</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${p.capitalGrowthRate.toFixed(1)}%</td>`).join('')}
            </tr>
            <tr>
              <td>CPI Growth %</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${p.cpiGrowthRate.toFixed(1)}%</td>`).join('')}
            </tr>
            <tr>
              <td>Property Value $</td>
              <td>${formatCurrency(projections[0].propertyMarketValue)}</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.propertyMarketValue)}</td>`).join('')}
            </tr>
            <tr>
              <td>Purchase Price $</td>
              <td>${formatCurrency(baseFinancialData.purchasePrice)}</td>
              ${Array(10).fill('<td></td>').join('')}
            </tr>
            <tr>
              <td>Loan Amount $</td>
              <td>${formatCurrency(projections[0].loanAmount)}</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.loanAmount)}</td>`).join('')}
            </tr>
            <tr class="section-header"><td colspan="12">STATISTICS</td></tr>
            <tr class="equity-row">
              <td>Equity $</td>
              <td class="text-green">${formatCurrency(projections[0].equityInProperty)}</td>
              ${projections.slice(1).map(p => `<td class="text-green">${formatCurrency(p.equityInProperty)}</td>`).join('')}
            </tr>
            <tr>
              <td>LVR %</td>
              <td>${projections[0].loanToValueRatio.toFixed(1)}%</td>
              ${projections.slice(1).map(p => `<td>${p.loanToValueRatio.toFixed(1)}%</td>`).join('')}
            </tr>
            <tr>
              <td>Rental Income $</td>
              <td>${formatCurrency(baseFinancialData.weeklyRent)}pw</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.rentalIncome)}</td>`).join('')}
            </tr>
            <tr>
              <td>Gross Yield %</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${p.grossYield.toFixed(2)}%</td>`).join('')}
            </tr>
            <tr>
              <td>Net Yield %</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${p.netYield.toFixed(2)}%</td>`).join('')}
            </tr>
            <tr class="section-header"><td colspan="12">CASH DEDUCTIONS</td></tr>
            <tr>
              <td>Property Expenses $</td>
              <td>$0</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.propertyExpenses)}</td>`).join('')}
            </tr>
            <tr>
              <td>Land Tax $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.landTax)}</td>`).join('')}
            </tr>
            <tr>
              <td>Interest Rate %</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${p.interestRate.toFixed(2)}%</td>`).join('')}
            </tr>
            <tr>
              <td>Interest Payments $</td>
              <td>$0</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.interestPayments)}</td>`).join('')}
            </tr>
            <tr>
              <td>Principal Payments $</td>
              <td>$0</td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.principalPayments)}</td>`).join('')}
            </tr>
            <tr>
              <td>Pre-Tax Cash Flow p/a $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.preTaxCashFlowPA < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.preTaxCashFlowPA)}</td>`).join('')}
            </tr>
            <tr>
              <td>Pre-Tax Cash Flow p/w $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.preTaxCashFlowPW < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.preTaxCashFlowPW)}</td>`).join('')}
            </tr>
            <tr class="section-header"><td colspan="12">NON-CASH DEDUCTIONS</td></tr>
            <tr>
              <td>Depreciation $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.depreciation)}</td>`).join('')}
            </tr>
            <tr class="section-header"><td colspan="12">SUMMARY</td></tr>
            <tr>
              <td>Total Deductions $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td>${formatCurrency(p.totalDeductions)}</td>`).join('')}
            </tr>
            <tr>
              <td>Net Profit/Loss $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.netProfitLoss < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.netProfitLoss)}</td>`).join('')}
            </tr>
            <tr>
              <td>Tax Refund / (Payable) $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.taxEffect < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.taxEffect)}</td>`).join('')}
            </tr>
            <tr style="background: #eff6ff; font-weight: bold;">
              <td>After-Tax Cash Flow p/a $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.afterTaxCashFlowPA < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.afterTaxCashFlowPA)}</td>`).join('')}
            </tr>
            <tr style="background: #eff6ff; font-weight: bold;">
              <td>After-Tax Cash Flow p/w $</td>
              <td></td>
              ${projections.slice(1).map(p => `<td class="${p.afterTaxCashFlowPW < 0 ? 'text-red' : 'text-green'}">${formatCurrency(p.afterTaxCashFlowPW)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
        
        <div class="summary">
          <h3>10-Year Investment Summary</h3>
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-label">Year 10 Property Value</div>
              <div class="summary-value text-green">${formatCurrency(projections[10]?.propertyMarketValue || 0)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Year 10 Equity</div>
              <div class="summary-value text-green">${formatCurrency(projections[10]?.equityInProperty || 0)}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Total After-Tax Cash Flow</div>
              <div class="summary-value ${projections.slice(1).reduce((sum, p) => sum + p.afterTaxCashFlowPA, 0) < 0 ? 'text-red' : 'text-green'}">${formatCurrency(projections.slice(1).reduce((sum, p) => sum + p.afterTaxCashFlowPA, 0))}</div>
            </div>
            <div class="summary-item">
              <div class="summary-label">Capital Gain</div>
              <div class="summary-value text-green">${formatCurrency((projections[10]?.propertyMarketValue || 0) - baseFinancialData.purchasePrice)}</div>
            </div>
          </div>
        </div>
        
        <p class="disclaimer">
          This analysis is for informational purposes only and does not constitute financial advice. 
          Projections are estimates based on assumed growth rates and may not reflect actual future performance.
          Please consult with a qualified financial advisor before making investment decisions.
        </p>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  }, [report, baseFinancialData, projections, includeInputsSummaryInExport, includeConstructionScheduleInExport, constructionProgressSchedule, isNewBuild, toast]);

  if (!report || !baseFinancialData) return null;

  return (
    <>
    <CashFlowPresentationShell
      presentation={presentation}
      isOpen={isOpen}
      onClose={onClose}
      header={(
          <CashFlowCommandHeader
            presentation={presentation}
            onBack={isPagePresentation ? onClose : undefined}
            backLabel={backLabel}
            propertyAddress={report.property_address}
            isNewBuild={isNewBuild}
            hasChanges={hasChanges}
            hasOverrides={Object.keys(yearlyOverrides).length > 0}
            isSaving={isSaving}
            comparisonMode={comparisonMode}
            comparisonCount={comparisonReports.length + 1}
            onResetAll={() => setShowResetConfirm(true)}
            onSaveChanges={handleSaveOverrides}
            exportMenu={(
              <CashFlowExportMenu
                includeAllChartsInExport={includeAllChartsInExport}
                chartExportToggles={chartExportToggles}
                onGlobalChartsToggle={handleGlobalChartsToggle}
                onChartToggle={handleChartToggle}
                onExportExcel={handleExportExcel}
                onExportServerPdf={exportServerCashFlowPDF}
                isExportingServerPdf={isExportingServerPdf}
                onExportPdf={exportSingleReportPDF}
                onPrintView={openPrintView}
                onSendToClient={() => setSendToClientOpen(true)}
                filename={`Cash_Flow_10Year_${(report?.property_address || 'report').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`}
              />
            )}
          />
        )}
      footer={(
          isPagePresentation ? (
            <div className="flex justify-end gap-2 py-4">
              <Button variant="outline" onClick={onClose} className="min-h-10 rounded-xl">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {backLabel}
              </Button>
            </div>
          ) : (
            <div className="px-6 py-4 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          )
        )}
      >
        <div className="space-y-6">
          {baseFinancialData && baseFinancialData.missingInputs.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
              <p className="font-medium">This projection is incomplete.</p>
              <p className="text-muted-foreground">
                Not recorded for this report: {baseFinancialData.missingInputs.map((f) => INPUT_FIELD_LABELS[f] ?? f).join(', ')}.
                {' '}The figures below are arithmetic on missing inputs, and the cash flow cannot be generated until they are recorded.
              </p>
            </div>
          )}
          {baseFinancialData && baseFinancialData.missingInputs.length === 0 && describeAssumedInputs(baseFinancialData).length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
              <p className="font-medium">Assumed, because the report does not record them</p>
              <p className="text-muted-foreground">
                {describeAssumedInputs(baseFinancialData).join(' · ')}. Case inputs fingerprint {baseFinancialData.caseFingerprint}.
              </p>
            </div>
          )}
          <CashFlowKpiStrip
            baseFinancialData={baseFinancialData}
            projections={projections}
            formatCurrency={formatCurrency}
          />

            <CashFlowControlPanel
              comparisonMode={comparisonMode}
              comparisonsAvailable={cashflowComparisonsEnabled}
              onComparisonModeChange={setComparisonMode}
              selectedComparisonReportIds={selectedComparisonReportIds}
              availableReports={availableReports}
              onToggleComparisonReport={handleToggleComparisonReport}
              onClearComparisonReports={handleClearComparisonReports}
              primaryAddress={report?.property_address || ''}
              loadingReports={loadingReports}
              investorProfile={investorProfile}
              onInvestorProfileChange={setInvestorProfile}
              excludeLandTaxFromCashFlow={excludeLandTaxFromCashFlow}
              onExcludeLandTaxChange={(checked) => {
                setExcludeLandTaxFromCashFlow(checked);
                setHasChanges(true);
              }}
              hasChanges={hasChanges}
            />

            <CashFlowChartsWorkspace>
            {/* Cash Flow Trends Chart */}
            <Card className="overflow-hidden border-border/80 bg-background/95 shadow-lg ring-1 ring-border/5">
              <CardHeader className="border-b bg-gradient-to-r from-muted via-background to-muted/70 pb-4 dark:from-background/40 dark:via-background dark:to-background/30">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="rounded-xl bg-primary/10 p-2 text-primary">
                        <BarChart3 className="h-4 w-4" />
                      </span>
                      10-Year Cash Flow Trends
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Toggle metrics, inspect break-even points, and export the active trend chart.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 xl:items-end">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {[
                        { key: 'propertyValue' as const, label: 'Property Value', color: 'hsl(var(--primary))' },
                        { key: 'equity' as const, label: 'Equity', color: chartTheme.series.equity },
                        { key: 'loanBalance' as const, label: 'Loan Balance', color: chartTheme.series.loanBalance },
                        { key: 'rentalIncome' as const, label: 'Rental Income', color: chartTheme.series.rentalIncome },
                        { key: 'cashFlow' as const, label: 'Cash Flow', color: chartTheme.series.cashFlow },
                      ].map(({ key, label, color }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setChartMetrics(prev => ({ ...prev, [key]: !prev[key] }))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 shadow-sm transition-all hover:-translate-y-0.5 ${chartMetrics[key] ? 'border-primary/30 bg-primary/10 text-foreground ring-1 ring-primary/10' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                          {label}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportChartAsPNG(cashFlowChartRef, 'cash-flow-trends')}
                      className="h-8 w-full justify-center gap-2 rounded-xl sm:w-auto"
                    >
                      <Image className="h-4 w-4" />
                      Export PNG
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                {(() => {
                  const chartData = projections.filter(p => p.year >= 1).map((p, i, arr) => {
                    const prev = i > 0 ? arr[i - 1] : null;
                    return {
                      year: `Yr ${p.year}`,
                      'Property Value': p.propertyMarketValue,
                      'Rental Income': p.rentalIncome,
                      'Cash Flow (After Tax)': p.afterTaxCashFlowPA,
                      'Equity': p.equityInProperty,
                      'Loan Balance': p.loanAmount,
                      _yoy_propertyValue: prev ? ((p.propertyMarketValue - prev.propertyMarketValue) / prev.propertyMarketValue * 100) : 0,
                      _yoy_equity: prev ? ((p.equityInProperty - prev.equityInProperty) / (prev.equityInProperty || 1) * 100) : 0,
                      _yoy_rental: prev ? ((p.rentalIncome - prev.rentalIncome) / (prev.rentalIncome || 1) * 100) : 0,
                      _yoy_cashFlow: prev ? (p.afterTaxCashFlowPA - prev.afterTaxCashFlowPA) : 0,
                    };
                  });

                  // Find break-even year (cash flow turns positive)
                  const breakEvenYear = projections.filter(p => p.year >= 1).find((p, i, arr) => {
                    if (i === 0) return p.afterTaxCashFlowPA >= 0;
                    return arr[i - 1].afterTaxCashFlowPA < 0 && p.afterTaxCashFlowPA >= 0;
                  });

                  // Find equity-debt crossover
                  const crossoverYear = projections.filter(p => p.year >= 1).find(p => p.equityInProperty >= p.loanAmount);

                  return (
                    <>
                      <div ref={cashFlowChartRef} className="h-[320px] w-full rounded-3xl border border-border/60 p-3 shadow-inner shadow-black/5 sm:h-[380px] xl:h-[420px]" style={{ backgroundColor: chartTheme.surface }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={chartData}
                            margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
                          >
                            <defs>
                              <linearGradient id="fillPropertyValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chartTheme.series.propertyValue} stopOpacity={0.15}/>
                                <stop offset="95%" stopColor={chartTheme.series.propertyValue} stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="fillEquity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chartTheme.series.equity} stopOpacity={0.15}/>
                                <stop offset="95%" stopColor={chartTheme.series.equity} stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} stroke={chartTheme.grid} />
                            <XAxis 
                              dataKey="year" 
                              tick={{ fontSize: 11, fill: chartTheme.tick }}
                              axisLine={{ stroke: chartTheme.axisLine }}
                              tickLine={false}
                            />
                            <YAxis 
                              tick={{ fontSize: 11, fill: chartTheme.tick }} 
                              tickFormatter={(value) => {
                                if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                                if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
                                return `$${value}`;
                              }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                return (
                                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-1.5">
                                    <p className="font-semibold text-sm mb-2">{label}</p>
                                    {payload.map((entry: any, idx: number) => {
                                      const yoyKey = entry.dataKey === 'Property Value' ? '_yoy_propertyValue' :
                                        entry.dataKey === 'Equity' ? '_yoy_equity' :
                                        entry.dataKey === 'Rental Income' ? '_yoy_rental' : null;
                                      const yoyVal = yoyKey ? entry.payload?.[yoyKey] : null;
                                      return (
                                        <div key={idx} className="flex items-center justify-between gap-4">
                                          <span className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                            {entry.name}
                                          </span>
                                          <span className="font-medium">
                                            ${Number(entry.value).toLocaleString('en-AU')}
                                            {yoyVal !== null && yoyVal !== 0 && (
                                              <span className={`ml-1.5 ${signedFigureInk(yoyVal)}`}>
                                                {yoyVal > 0 ? '↑' : '↓'}{Math.abs(yoyVal).toFixed(1)}%
                                              </span>
                                            )}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }}
                            />
                            <Legend 
                              wrapperStyle={{ fontSize: '11px', paddingTop: '18px' }}
                              iconType="circle"
                              iconSize={8}
                            />
                            {/* Break-even vertical line */}
                            {chartMetrics.cashFlow && breakEvenYear && (
                              <ReferenceLine 
                                x={`Yr ${breakEvenYear.year}`} 
                                stroke={chartTheme.series.equity} 
                                strokeDasharray="4 4" 
                                strokeWidth={1.5}
                                label={{ 
                                  value: `Break-even: Yr ${breakEvenYear.year}`, 
                                  position: 'top', 
                                  fontSize: 10, 
                                  fill: chartTheme.series.equity,
                                  fontWeight: 600
                                }}
                              />
                            )}
                            {/* Crossover annotation */}
                            {chartMetrics.equity && chartMetrics.loanBalance && crossoverYear && (
                              <ReferenceLine 
                                x={`Yr ${crossoverYear.year}`} 
                                stroke={chartTheme.series.crossover} 
                                strokeDasharray="4 4" 
                                strokeWidth={1.5}
                                label={{ 
                                  value: `Equity > Debt: Yr ${crossoverYear.year}`, 
                                  position: 'insideTopRight', 
                                  fontSize: 10, 
                                  fill: chartTheme.series.crossover,
                                  fontWeight: 600
                                }}
                              />
                            )}
                            {/* Area fills */}
                            {/* The fills share a dataKey with the lines below; without
                                `legendType="none"` each series appeared twice in the
                                legend (QA-40). */}
                            {chartMetrics.propertyValue && (
                              <Area type="monotone" dataKey="Property Value" fill="url(#fillPropertyValue)" stroke="none" legendType="none" tooltipType="none" />
                            )}
                            {chartMetrics.equity && (
                              <Area type="monotone" dataKey="Equity" fill="url(#fillEquity)" stroke="none" legendType="none" tooltipType="none" />
                            )}
                            {/* Lines */}
                            {chartMetrics.propertyValue && (
                              <Line 
                                type="monotone" 
                                dataKey="Property Value" 
                                stroke={chartTheme.series.propertyValue} 
                                strokeWidth={2.5}
                                dot={{ r: 4, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                                activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                              />
                            )}
                            {chartMetrics.equity && (
                              <Line 
                                type="monotone" 
                                dataKey="Equity" 
                                stroke={chartTheme.series.equity} 
                                strokeWidth={2.5}
                                dot={{ r: 4, fill: chartTheme.series.equity, strokeWidth: 0 }}
                                activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                              />
                            )}
                            {chartMetrics.loanBalance && (
                              <Line 
                                type="monotone" 
                                dataKey="Loan Balance" 
                                stroke={chartTheme.series.loanBalance} 
                                strokeWidth={2}
                                strokeDasharray="8 4"
                                dot={{ r: 3, fill: chartTheme.series.loanBalance, strokeWidth: 0 }}
                                activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                              />
                            )}
                            {chartMetrics.rentalIncome && (
                              <Line 
                                type="monotone" 
                                dataKey="Rental Income" 
                                stroke={chartTheme.series.rentalIncome} 
                                strokeWidth={2}
                                strokeDasharray="6 3"
                                dot={{ r: 3, fill: chartTheme.series.rentalIncome, strokeWidth: 0 }}
                                activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                              />
                            )}
                            {chartMetrics.cashFlow && (
                              <Line 
                                type="monotone" 
                                dataKey="Cash Flow (After Tax)" 
                                stroke={chartTheme.series.cashFlow} 
                                strokeWidth={2}
                                strokeDasharray="6 3"
                                dot={{ r: 3, fill: chartTheme.series.cashFlow, strokeWidth: 0 }}
                                activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                              />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Sparkline KPI Cards */}
                      {projections.length > 1 && (() => {
                        const yr1 = projections.find(p => p.year === 1);
                        const yr10 = projections.find(p => p.year === 10);
                        if (!yr1 || !yr10) return null;
                        const totalGrowth = yr1.propertyMarketValue > 0 
                          ? (((yr10.propertyMarketValue - yr1.propertyMarketValue) / yr1.propertyMarketValue) * 100).toFixed(1) 
                          : '0';
                        const values = projections.filter(p => p.year >= 1);
                        
                        const kpis = [
                          { 
                            label: 'Property Value', 
                            yr1: `$${yr1.propertyMarketValue.toLocaleString('en-AU')}`, 
                            yr10: `$${yr10.propertyMarketValue.toLocaleString('en-AU')}`,
                            change: `+${totalGrowth}%`,
                            positive: true,
                            sparkData: values.map(v => v.propertyMarketValue),
                            color: 'hsl(var(--primary))'
                          },
                          { 
                            label: 'Equity', 
                            yr1: `$${yr1.equityInProperty.toLocaleString('en-AU')}`, 
                            yr10: `$${yr10.equityInProperty.toLocaleString('en-AU')}`,
                            change: `+$${(yr10.equityInProperty - yr1.equityInProperty).toLocaleString('en-AU')}`,
                            positive: true,
                            sparkData: values.map(v => v.equityInProperty),
                            color: chartTheme.series.equity
                          },
                          { 
                            label: 'Loan Balance', 
                            yr1: `$${yr1.loanAmount.toLocaleString('en-AU')}`, 
                            yr10: `$${yr10.loanAmount.toLocaleString('en-AU')}`,
                            change: `-$${(yr1.loanAmount - yr10.loanAmount).toLocaleString('en-AU')}`,
                            positive: yr10.loanAmount < yr1.loanAmount,
                            sparkData: values.map(v => v.loanAmount),
                            color: chartTheme.series.loanBalance
                          },
                          { 
                            label: 'Cash Flow', 
                            yr1: `$${yr1.afterTaxCashFlowPA.toLocaleString('en-AU')}`, 
                            yr10: `$${yr10.afterTaxCashFlowPA.toLocaleString('en-AU')}`,
                            change: yr10.afterTaxCashFlowPA >= 0 ? 'Positive' : 'Negative',
                            positive: yr10.afterTaxCashFlowPA >= 0,
                            sparkData: values.map(v => v.afterTaxCashFlowPA),
                            color: chartTheme.series.cashFlow
                          },
                        ];

                        return (
                          <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4">
                            {kpis.map(kpi => {
                              const min = Math.min(...kpi.sparkData);
                              const max = Math.max(...kpi.sparkData);
                              const range = max - min || 1;
                              const points = kpi.sparkData.map((v, i) => 
                                `${(i / (kpi.sparkData.length - 1)) * 60},${24 - ((v - min) / range) * 20}`
                              ).join(' ');
                              return (
                                <div key={kpi.label} className="space-y-1 rounded-xl border bg-muted/30 p-3">
                                  <p className="text-[10px] text-muted-foreground font-medium">{kpi.label}</p>
                                  <div className="flex items-end justify-between">
                                    <div>
                                      <p className="text-xs font-bold">{kpi.yr10}</p>
                                      <p className={`text-[10px] font-semibold ${kpi.positive ? POSITIVE_FIGURE_INK : NEGATIVE_FIGURE_INK}`}>
                                        {kpi.change}
                                      </p>
                                    </div>
                                    <svg width="60" height="24" className="opacity-60">
                                      <polyline
                                        fill="none"
                                        stroke={kpi.color}
                                        strokeWidth="1.5"
                                        points={points}
                                      />
                                    </svg>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {/* Chart Insight — collapsible in dashboard modal */}
                      {projections.length > 1 && (() => {
                        const yr1d = projections.find(p => p.year === 1);
                        const yr10d = projections.find(p => p.year === 10);
                        if (!yr1d || !yr10d || !baseFinancialData) return null;
                        const propGrowth = ((yr10d.propertyMarketValue - baseFinancialData.purchasePrice) / baseFinancialData.purchasePrice * 100).toFixed(1);
                        const eqGrowth = yr1d.equityInProperty > 0 ? ((yr10d.equityInProperty - yr1d.equityInProperty) / yr1d.equityInProperty * 100).toFixed(1) : 'N/A';
                        const loanRed = projections[0]?.loanAmount > 0 ? ((1 - yr10d.loanAmount / projections[0].loanAmount) * 100).toFixed(1) : '0';
                        const bey = projections.filter(p => p.year >= 1).find((p, i, arr) => i > 0 && arr[i - 1].afterTaxCashFlowPA < 0 && p.afterTaxCashFlowPA >= 0);
                        const coy = projections.filter(p => p.year >= 1).find(p => p.equityInProperty >= p.loanAmount);
                        return (
                          <Collapsible open={showCashFlowInsight} onOpenChange={setShowCashFlowInsight}>
                            <CollapsibleTrigger asChild>
                              <button className="w-full flex items-center justify-between p-3 bg-brand-50 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800/40 rounded-xl hover:bg-brand-100 dark:hover:bg-brand-950/50 transition-colors text-xs font-semibold text-brand-800 dark:text-brand-300">
                                <span className="flex items-center gap-1.5">
                                  <TrendingUp className="h-3.5 w-3.5" />
                                  Cash Flow Trend Analysis
                                </span>
                                <span className="flex items-center gap-1 text-[10px] font-normal text-brand-600 dark:text-brand-400">
                                  {showCashFlowInsight ? 'Hide' : 'View'} Analysis
                                  {showCashFlowInsight ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </span>
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="p-3 bg-brand-50 dark:bg-brand-950/30 border border-t-0 border-brand-200 dark:border-brand-800/40 rounded-b-lg -mt-[1px]">
                                <div className="text-xs text-brand-900/80 dark:text-brand-200/70 space-y-2 leading-relaxed">
                                  <p><strong>Property Value Growth:</strong> Projected to appreciate by {propGrowth}% over 10 years (from ${baseFinancialData.purchasePrice.toLocaleString('en-AU')} to ${yr10d.propertyMarketValue.toLocaleString('en-AU')}), reflecting configured capital growth assumptions.</p>
                                  <p><strong>Equity Accumulation:</strong> Equity increases by {eqGrowth}% (${yr1d.equityInProperty.toLocaleString('en-AU')} → ${yr10d.equityInProperty.toLocaleString('en-AU')}), driven by capital appreciation and principal repayments reducing the loan by {loanRed}%.</p>
                                  <p><strong>Cash Flow:</strong> After-tax cash flow moves from ${yr1d.afterTaxCashFlowPA.toLocaleString('en-AU')}/yr (Year 1) to ${yr10d.afterTaxCashFlowPA.toLocaleString('en-AU')}/yr (Year 10).
                                    {bey && ` The investment becomes cash-flow positive in Year ${bey.year}.`}
                                    {coy && ` Equity exceeds remaining debt in Year ${coy.year} — a key wealth milestone.`}
                                  </p>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })()}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Yield Percentages Chart */}
            <Card className="overflow-hidden border-border/80 bg-background/95 shadow-lg ring-1 ring-border/5">
              <CardHeader className="border-b bg-gradient-to-r from-muted via-background to-muted/70 pb-4 dark:from-background/40 dark:via-background dark:to-background/30">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Percent className="h-4 w-4" />
                      </span>
                      Yield Percentages Over 10 Years
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Gross yield, net yield, and expense spread over the projection horizon.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportChartAsPNG(yieldChartRef, 'yield-percentages')}
                    className="h-8 w-full justify-center gap-2 rounded-xl sm:w-auto"
                  >
                    <Image className="h-4 w-4" />
                    Export PNG
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                {(() => {
                  const yieldData = projections.filter(p => p.year >= 1).map((p, i, arr) => {
                    const prev = i > 0 ? arr[i - 1] : null;
                    return {
                      year: `Yr ${p.year}`,
                      'Gross Yield %': p.grossYield,
                      'Net Yield %': p.netYield,
                      'Expense Spread': p.grossYield - p.netYield,
                      _yoy_gross: prev ? (p.grossYield - prev.grossYield) : 0,
                      _yoy_net: prev ? (p.netYield - prev.netYield) : 0,
                    };
                  });

                  return (
                    <>
                      <div ref={yieldChartRef} className="h-[280px] w-full rounded-3xl border border-border/60 p-3 shadow-inner shadow-black/5 sm:h-[320px]" style={{ backgroundColor: chartTheme.surface }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={yieldData}
                            margin={{ top: 10, right: 30, left: 20, bottom: 10 }}
                          >
                            <defs>
                              <linearGradient id="yieldSpread" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.12}/>
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.03}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.15} stroke={chartTheme.grid} />
                            <XAxis 
                              dataKey="year" 
                              tick={{ fontSize: 11, fill: chartTheme.tick }}
                              axisLine={{ stroke: chartTheme.axisLine }}
                              tickLine={false}
                            />
                            <YAxis 
                              tick={{ fontSize: 11, fill: chartTheme.tick }} 
                              tickFormatter={(value) => `${value}%`}
                              domain={['auto', 'auto']}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip 
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                const gross = payload.find((p: any) => p.dataKey === 'Gross Yield %');
                                const net = payload.find((p: any) => p.dataKey === 'Net Yield %');
                                const yoyGross = gross?.payload?._yoy_gross;
                                const yoyNet = net?.payload?._yoy_net;
                                const spread = gross && net ? (Number(gross.value) - Number(net.value)).toFixed(2) : '0';
                                return (
                                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs space-y-1.5">
                                    <p className="font-semibold text-sm mb-2">{label}</p>
                                    {gross && (
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: chartTheme.series.grossYield }} />
                                          Gross Yield
                                        </span>
                                        <span className="font-medium">
                                          {Number(gross.value).toFixed(2)}%
                                          {yoyGross !== 0 && (
                                            <span className={`ml-1.5 ${signedFigureInk(yoyGross)}`}>
                                              {yoyGross > 0 ? '↑' : '↓'}{Math.abs(yoyGross).toFixed(2)}pp
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                    {net && (
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: chartTheme.series.netYield }} />
                                          Net Yield
                                        </span>
                                        <span className="font-medium">
                                          {Number(net.value).toFixed(2)}%
                                          {yoyNet !== 0 && (
                                            <span className={`ml-1.5 ${signedFigureInk(yoyNet)}`}>
                                              {yoyNet > 0 ? '↑' : '↓'}{Math.abs(yoyNet).toFixed(2)}pp
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/50">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: chartTheme.series.rentalIncome }} />
                                        Expense Drag
                                      </span>
                                      <span className="font-medium text-brand-500">{spread}pp</span>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Legend 
                              wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                              iconType="circle"
                              iconSize={8}
                            />
                            {/* Shaded spread band between gross and net */}
                            <Area 
                              type="monotone" 
                              dataKey="Gross Yield %" 
                              fill="url(#yieldSpread)" 
                              stroke="none"
                              legendType="none"
                            />
                            <Line 
                              type="monotone" 
                              dataKey="Gross Yield %" 
                              stroke={chartTheme.series.crossover} 
                              strokeWidth={2.5}
                              dot={{ r: 4, fill: chartTheme.series.grossYield, strokeWidth: 0 }}
                              activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="Net Yield %" 
                              stroke={chartTheme.series.netYield} 
                              strokeWidth={2.5}
                              dot={{ r: 4, fill: chartTheme.series.netYield, strokeWidth: 0 }}
                              activeDot={{ r: 6, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Yield summary with sparklines */}
                      {projections.length > 1 && (() => {
                        const yr1 = projections.find(p => p.year === 1);
                        const yr10 = projections.find(p => p.year === 10);
                        if (!yr1 || !yr10) return null;
                        const values = projections.filter(p => p.year >= 1);
                        const avgSpread = values.reduce((s, v) => s + (v.grossYield - v.netYield), 0) / values.length;
                        
                        const yieldKpis = [
                          { label: 'Gross Yield', value: `${yr10.grossYield.toFixed(2)}%`, sub: `from ${yr1.grossYield.toFixed(2)}%`, sparkData: values.map(v => v.grossYield), color: chartTheme.series.grossYield },
                          { label: 'Net Yield', value: `${yr10.netYield.toFixed(2)}%`, sub: `from ${yr1.netYield.toFixed(2)}%`, sparkData: values.map(v => v.netYield), color: chartTheme.series.netYield },
                          { label: 'Avg Expense Drag', value: `${avgSpread.toFixed(2)}pp`, sub: 'Gross − Net spread', sparkData: values.map(v => v.grossYield - v.netYield), color: chartTheme.series.rentalIncome },
                        ];

                        return (
                          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
                            {yieldKpis.map(kpi => {
                              const min = Math.min(...kpi.sparkData);
                              const max = Math.max(...kpi.sparkData);
                              const range = max - min || 1;
                              const points = kpi.sparkData.map((v, i) => 
                                `${(i / (kpi.sparkData.length - 1)) * 60},${24 - ((v - min) / range) * 20}`
                              ).join(' ');
                              return (
                                <div key={kpi.label} className="bg-muted/40 rounded-lg p-2.5 space-y-1">
                                  <p className="text-[10px] text-muted-foreground font-medium">{kpi.label}</p>
                                  <div className="flex items-end justify-between">
                                    <div>
                                      <p className="text-xs font-bold">{kpi.value}</p>
                                      <p className="text-[10px] text-muted-foreground">{kpi.sub}</p>
                                    </div>
                                    <svg width="60" height="24" className="opacity-60">
                                      <polyline fill="none" stroke={kpi.color} strokeWidth="1.5" points={points} />
                                    </svg>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {/* Yield Insight — collapsible in dashboard modal */}
                      {projections.length > 1 && (() => {
                        const yr1y = projections.find(p => p.year === 1);
                        const yr10y = projections.find(p => p.year === 10);
                        if (!yr1y || !yr10y) return null;
                        const grossDelta = (yr10y.grossYield - yr1y.grossYield).toFixed(2);
                        const netDelta = (yr10y.netYield - yr1y.netYield).toFixed(2);
                        const vals = projections.filter(p => p.year >= 1);
                        const avgSprd = (vals.reduce((s, p) => s + (p.grossYield - p.netYield), 0) / vals.length).toFixed(2);
                        return (
                          <Collapsible open={showYieldInsight} onOpenChange={setShowYieldInsight}>
                            <CollapsibleTrigger asChild>
                              <button className="mt-3 w-full flex items-center justify-between p-2.5 bg-info/10 dark:bg-info/30 border border-info/30 dark:border-info/40 rounded-lg hover:bg-info/15 dark:hover:bg-info/50 transition-colors text-xs font-semibold text-info dark:text-info">
                                <span className="flex items-center gap-1.5">
                                  <Percent className="h-3.5 w-3.5" />
                                  Yield Analysis Insight
                                </span>
                                <span className="flex items-center gap-1 text-[10px] font-normal text-info dark:text-info">
                                  {showYieldInsight ? 'Hide' : 'View'} Analysis
                                  {showYieldInsight ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </span>
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="p-3 bg-info/10 dark:bg-info/30 border border-t-0 border-info/30 dark:border-info/40 rounded-b-lg -mt-[1px]">
                                <div className="text-xs text-info/80 dark:text-info/70 space-y-2 leading-relaxed">
                                  <p>{describeYieldMovement({
                                    label: 'Gross yield', yearOne: yr1y.grossYield, yearTen: yr10y.grossYield,
                                    rentEstablished: !!baseFinancialData && baseFinancialData.weeklyRent > 0 && !baseFinancialData.missingInputs.includes('weeklyRent'),
                                  }).sentence}</p>
                                  <p>{describeYieldMovement({
                                    label: 'Net yield', yearOne: yr1y.netYield, yearTen: yr10y.netYield,
                                    rentEstablished: !!baseFinancialData && baseFinancialData.weeklyRent > 0 && !baseFinancialData.missingInputs.includes('weeklyRent'),
                                  }).sentence} Net yield accounts for holding costs including council rates, insurance, maintenance, and management fees, before finance and tax.</p>
                                  <p><strong>Expense Drag:</strong> Average spread between gross and net yield is {avgSprd}pp. The spread is the year's holding costs measured against the property's value; it narrows as the value compounds faster than the costs, which says nothing about costs falling.</p>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })()}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Comparison Chart - Side by Side (Up to 5 Properties) */}
            {comparisonMode && comparisonReports.length > 0 && allComparisonProjections.length > 0 && (
              <Card className="overflow-hidden border-primary/30 bg-background/95 shadow-lg ring-1 ring-primary/10">
                <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-background to-muted/70 pb-4 dark:to-background/30">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="rounded-xl bg-primary/10 p-2 text-primary">
                          <GitCompare className="h-4 w-4" />
                        </span>
                        Property Comparison: Cash Flow ({comparisonReports.length + 1} Properties)
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">Side-by-side projected value and after-tax cash-flow performance.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:items-end">
                      <Badge variant="outline" className="w-fit text-xs">
                        Comparing {comparisonReports.length + 1} properties
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportChartAsPNG(comparisonChartRef, 'property-comparison')}
                        className="h-8 w-full justify-center gap-2 rounded-xl sm:w-auto"
                      >
                        <Image className="h-4 w-4" />
                        Export PNG
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div ref={comparisonChartRef} className="h-[320px] w-full rounded-3xl border border-border/60 p-3 shadow-inner shadow-black/5 sm:h-[380px] xl:h-[420px]" style={{ backgroundColor: chartTheme.surface }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={projections.filter(p => p.year >= 1).map((p, i) => {
                          const dataPoint: any = {
                            year: `Year ${p.year}`,
                            [`${report?.property_address.split(',')[0]} Value`]: p.propertyMarketValue,
                          };
                          allComparisonProjections.forEach(({ report: compReport, projections: compProjs }, idx) => {
                            dataPoint[`${compReport.property_address.split(',')[0]} Value`] = compProjs[i + 1]?.propertyMarketValue || 0;
                          });
                          return dataPoint;
                        })}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="year" className="text-xs" tick={{ fontSize: 11 }} />
                        <YAxis 
                          className="text-xs" 
                          tick={{ fontSize: 11 }} 
                          tickFormatter={(value) => {
                            if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
                            if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
                            return `$${value}`;
                          }}
                        />
                        <Tooltip 
                          formatter={(value: number) => [`$${value.toLocaleString('en-AU')}`, undefined]}
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--background))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px',
                            fontSize: '11px'
                          }}
                        />
                        {/* `plainline` at 22px: the default legend icon is a
                            hook that ignores the dash array, so the key would
                            have drawn five identical swatches for five
                            different lines. */}
                        <Legend wrapperStyle={{ fontSize: '9px' }} iconType="plainline" iconSize={22} />
                        <Line 
                          type="monotone" 
                          dataKey={`${report?.property_address.split(',')[0]} Value`}
                          stroke={seriesStyleAt(0).colour} 
                          strokeWidth={2}
                          strokeDasharray={seriesStyleAt(0).dash}
                          strokeLinecap={seriesStyleAt(0).linecap ?? 'butt'}
                          dot={{ r: 2 }}
                        />
                        {allComparisonProjections.map(({ report: compReport }, idx) => {
                          const style = seriesStyleAt(idx + 1);
                          return (
                            <Line 
                              key={compReport.id}
                              type="monotone" 
                              dataKey={`${compReport.property_address.split(',')[0]} Value`}
                              stroke={style.colour}
                              strokeWidth={2}
                              strokeDasharray={style.dash}
                              strokeLinecap={style.linecap ?? 'butt'}
                              dot={{ r: 2 }}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Winner Indicator Cards */}
                  {(() => {
                    const primaryAddr = report?.property_address.split(',')[0] || 'Primary';
                    const allProps = [
                      { name: primaryAddr, yr10Value: projections[10]?.propertyMarketValue || 0, yr10Equity: projections[10]?.equityInProperty || 0, yr10Yield: projections[10]?.grossYield || 0, totalCashFlow: projections.filter(p => p.year >= 1).reduce((s, p) => s + p.afterTaxCashFlowPA, 0), color: COMPARISON_COLORS[0].value },
                      ...allComparisonProjections.map(({ report: cr, projections: cp }, idx) => ({
                        name: cr.property_address.split(',')[0],
                        yr10Value: cp[10]?.propertyMarketValue || 0,
                        yr10Equity: cp[10]?.equityInProperty || 0,
                        yr10Yield: cp[10]?.grossYield || 0,
                        totalCashFlow: cp.filter((_: any, i: number) => i >= 1).reduce((s: number, p: any) => s + (p.afterTaxCashFlowPA || 0), 0),
                        color: COMPARISON_COLORS[idx + 1]?.value || chartTheme.tick,
                      }))
                    ];
                    
                    const categories = [
                      { label: 'Highest Growth', icon: '📈', getValue: (p: any) => p.yr10Value, format: (v: number) => `$${v.toLocaleString('en-AU')}` },
                      { label: 'Most Equity', icon: '🏠', getValue: (p: any) => p.yr10Equity, format: (v: number) => `$${v.toLocaleString('en-AU')}` },
                      { label: 'Best Yield', icon: '💰', getValue: (p: any) => p.yr10Yield, format: (v: number) => `${v.toFixed(2)}%` },
                      { label: 'Best Cash Flow', icon: '💵', getValue: (p: any) => p.totalCashFlow, format: (v: number) => `$${v.toLocaleString('en-AU')}` },
                    ];

                    return (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-3 border-t">
                        {categories.map(cat => {
                          const winner = [...allProps].sort((a, b) => cat.getValue(b) - cat.getValue(a))[0];
                          return (
                            <div key={cat.label} className="bg-muted/40 rounded-lg p-2.5 text-center space-y-1">
                              <p className="text-[10px] text-muted-foreground font-medium">{cat.icon} {cat.label}</p>
                              <p className="text-xs font-bold truncate" style={{ color: winner.color }}>{winner.name}</p>
                              <p className="text-[10px] font-semibold text-success">{cat.format(cat.getValue(winner))}</p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  
                  {/* Advanced Investment Metrics Comparison */}
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Investment Metrics Comparison ({comparisonReports.length + 1} Properties)</h4>
                      <div className="flex items-center gap-2">
                        {/*
                          Beside the existing export, not instead of it. This one
                          typesets every property's full projection server-side;
                          the one next to it rasterises the charts on this screen
                          and prints eight metric rows. They are different
                          documents and both are worth having.
                        */}
                        <CashFlowComparisonDownloadButton
                          build={buildWireComparison}
                          unavailableReason={comparisonUnavailableReason}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => exportComparisonPDF()}
                          className="gap-2 text-muted-foreground"
                        >
                          <FileText className="h-4 w-4" />
                          Export PDF (legacy layout)
                        </Button>
                        <FlattenPdfIconButton
                          getPdfBlob={async () => {
                            const b = await exportComparisonPDF({ returnBlob: true });
                            if (!b) throw new Error('Failed to generate comparison PDF');
                            return b;
                          }}
                          filename={`cash-flow-comparison-${comparisonReports.length + 1}-properties-${new Date().toISOString().split('T')[0]}.pdf`}
                        />
                      </div>
                    </div>
                    
                    {/* Metrics Table */}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="min-w-[140px] sticky left-0 bg-background">Metric</TableHead>
                            <TableHead className="text-center min-w-[120px]">
                              <span className="inline-flex items-center justify-center gap-1.5">
                                <PropertySeriesMarker {...seriesStyleAt(0)} />
                                {report?.property_address.split(',')[0].substring(0, 15)}
                              </span>
                            </TableHead>
                            {allComparisonMetrics.map(({ report: compReport }, idx) => (
                              <TableHead key={compReport.id} className="text-center min-w-[120px]">
                                <span className="inline-flex items-center justify-center gap-1.5">
                                  <PropertySeriesMarker {...seriesStyleAt(idx + 1)} />
                                  {compReport.property_address.split(',')[0].substring(0, 15)}
                                </span>
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {([
                            { label: '10-Year ROI', key: 'roi', render: (m: InvestmentMetrics) => formatMetricPercent(m.roi), higherBetter: true },
                            { label: 'Annualised ROI', key: 'annualisedRoi', render: (m: InvestmentMetrics) => formatMetricPercent(m.annualisedRoi, 2), higherBetter: true },
                            { label: 'Total Return', key: 'totalReturn', render: (m: InvestmentMetrics) => formatCurrency(m.totalReturn), higherBetter: true },
                            { label: 'Capital committed', key: 'capitalCommitted', render: (m: InvestmentMetrics) => formatCurrency(m.capitalCommitted), higherBetter: false, neutral: true },
                            { label: 'Break-even', key: 'breakEvenYear', render: (m: InvestmentMetrics) => formatBreakEven(m.breakEvenYear), higherBetter: false },
                            { label: 'Cash-on-Cash (Y1)', key: 'cashOnCash', render: (m: InvestmentMetrics) => formatMetricPercent(m.cashOnCash, 2), higherBetter: true },
                            { label: 'Equity Multiple', key: 'equityMultiple', render: (m: InvestmentMetrics) => formatMetricMultiple(m.equityMultiple), higherBetter: true },
                            { label: 'Capital Gain (10 yrs)', key: 'capitalGain', render: (m: InvestmentMetrics) => formatCurrency(m.capitalGain), higherBetter: true },
                            { label: 'Total Cash Flow', key: 'totalCashFlow', render: (m: InvestmentMetrics) => formatCurrency(m.totalCashFlow), higherBetter: true },
                          ] as const).map(({ label, key, render, higherBetter, ...row }) => {
                            // Only properties that HAVE the metric compete for
                            // the highlight. A column with no cost base used to
                            // score 0 and, when every column was 0, every one
                            // of them was marked best.
                            const neutral = 'neutral' in row && row.neutral;
                            const columns: (InvestmentMetrics | null)[] = [
                              primaryMetrics,
                              ...allComparisonMetrics.map(({ metrics }) => metrics),
                            ];
                            const numeric = columns
                              .map((m) => (m ? (m as any)[key] : null))
                              .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
                            const bestValue = neutral || !numeric.length
                              ? null
                              : higherBetter ? Math.max(...numeric) : Math.min(...numeric);
                            const isBest = (m: InvestmentMetrics | null) =>
                              bestValue !== null && m != null && (m as any)[key] === bestValue;

                            return (
                              <TableRow key={key}>
                                <TableCell className="font-medium sticky left-0 bg-background">{label}</TableCell>
                                <TableCell className={`text-center tabular-nums ${isBest(primaryMetrics) ? 'text-success font-semibold' : ''}`}>
                                  {primaryMetrics ? render(primaryMetrics) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                {allComparisonMetrics.map(({ report: compReport, metrics }) => (
                                  <TableCell key={compReport.id} className={`text-center tabular-nums ${isBest(metrics) ? 'text-success font-semibold' : ''}`}>
                                    {metrics ? render(metrics) : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                ))}
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-muted/30">
                            <TableCell className="font-medium sticky left-0 bg-muted/30">Year 10 Property Value</TableCell>
                            <TableCell className="text-center">
                              ${(projections[10]?.propertyMarketValue || 0).toLocaleString('en-AU')}
                            </TableCell>
                            {allComparisonProjections.map(({ report: compReport, projections: compProjs }) => (
                              <TableCell key={compReport.id} className="text-center">
                                ${(compProjs[10]?.propertyMarketValue || 0).toLocaleString('en-AU')}
                              </TableCell>
                            ))}
                          </TableRow>
                          <TableRow className="bg-muted/30">
                            <TableCell className="font-medium sticky left-0 bg-muted/30">Year 10 Equity</TableCell>
                            <TableCell className="text-center">
                              ${(projections[10]?.equityInProperty || 0).toLocaleString('en-AU')}
                            </TableCell>
                            {allComparisonProjections.map(({ report: compReport, projections: compProjs }) => (
                              <TableCell key={compReport.id} className="text-center">
                                ${(compProjs[10]?.equityInProperty || 0).toLocaleString('en-AU')}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    {/* The basis, stated. Every percentage on this table is a
                        ratio, and a ratio is only readable if the reader knows
                        what it is over. */}
                    <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">How these are measured.</span>{' '}
                        Returns are over the ten years projected above — capital gain is the movement from
                        today's value to Year 10, not from the original purchase price. <span className="font-medium text-foreground">Capital
                        committed</span> is what the investor has in the property at Year 0: the cash to
                        acquire it (deposit, stamp duty, legal and LMI), or the equity held today where that
                        is greater.
                      </p>
                      {(!primaryMetrics || allComparisonMetrics.some(({ metrics }) => !metrics)) && (
                        <p className="text-[11px] leading-relaxed text-warning">
                          A dash means the figure could not be measured, not that it is zero.{' '}
                          {METRICS_UNAVAILABLE_REASON[
                            allComparisonMetrics.find(({ unavailable }) => unavailable)?.unavailable
                              ?? 'capital_unknown'
                          ]}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Property Recommendation Engine */}
            {comparisonMode && comparisonReports.length > 0 && propertyRecommendation && (
              <Card className="border-brand-500/30 bg-brand-500/5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Target className="h-4 w-4 text-brand-600" />
                      Investment Recommendation Engine
                    </CardTitle>
                    <Select value={investorProfile} onValueChange={(v) => setInvestorProfile(v as any)}>
                      <SelectTrigger className="w-[180px] h-8">
                        <SelectValue placeholder="Select Profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="growth">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-3 w-3 text-info" />
                            Growth Focused
                          </div>
                        </SelectItem>
                        <SelectItem value="income">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-3 w-3 text-success" />
                            Income Focused
                          </div>
                        </SelectItem>
                        <SelectItem value="balanced">
                          <div className="flex items-center gap-2">
                            <Zap className="h-3 w-3 text-accent" />
                            Balanced
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Profile Description */}
                  <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                    {investorProfile === 'growth' && (
                      <span><strong>Growth Focused:</strong> Prioritizes capital appreciation, ROI, and equity growth over immediate cash flow.</span>
                    )}
                    {investorProfile === 'income' && (
                      <span><strong>Income Focused:</strong> Prioritizes positive cash flow, high rental yields, and early break-even.</span>
                    )}
                    {investorProfile === 'balanced' && (
                      <span><strong>Balanced:</strong> Seeks optimal mix of capital growth and income generation.</span>
                    )}
                  </div>

                  {/* Winner Announcement */}
                  <div className="flex items-start gap-4 p-4 rounded-lg border-2 border-brand-500/40 bg-gradient-to-r from-brand-500/10 to-transparent">
                    <Award className={`h-10 w-10 ${propertyRecommendation.confidence === 'high' ? 'text-brand-500' : propertyRecommendation.confidence === 'moderate' ? 'text-brand-400' : 'text-brand-300'}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-lg">
                          {propertyRecommendation.winner}
                        </h4>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            propertyRecommendation.confidence === 'high' 
                              ? 'border-success/30 text-success' 
                              : propertyRecommendation.confidence === 'moderate'
                              ? 'border-brand-500 text-brand-600'
                              : 'border-border text-muted-foreground'
                          }`}
                        >
                          {propertyRecommendation.confidence} confidence
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        Best suited for {investorProfile === 'growth' ? 'growth-focused' : investorProfile === 'income' ? 'income-focused' : 'balanced'} investors
                      </p>
                      
                      {/* Rankings */}
                      <div className="space-y-2 mb-3">
                        <div className="text-xs font-semibold">Property Rankings:</div>
                        <div className="flex flex-wrap gap-2">
                          {propertyRecommendation.rankings.map((r, idx) => (
                            <div 
                              key={r.name}
                              className={`text-center px-3 py-1 rounded ${idx === 0 ? 'bg-success/20 border border-success/40' : 'bg-muted/50'}`}
                            >
                              <div className="text-[10px] text-muted-foreground">#{r.rank}</div>
                              <div className="text-xs font-medium">{r.name}</div>
                              <div className="text-xs font-semibold">{r.score} pts</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Key Insights */}
                      {propertyRecommendation.insights.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-success mb-1">Key Insights:</div>
                          <ul className="text-xs space-y-1">
                            {propertyRecommendation.insights.map((insight, i) => (
                              <li key={i} className="flex items-start gap-1">
                                <span className="text-success mt-0.5">✓</span>
                                <span>{insight}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <p className="text-[10px] text-muted-foreground italic">
                    This recommendation is based on projected data and the selected investor profile. Actual results may vary. 
                    Always conduct thorough due diligence before making investment decisions.
                  </p>
                </CardContent>
              </Card>
            )}

            </CashFlowChartsWorkspace>

            <CashFlowAiPanel active={comparisonMode && comparisonReports.length > 0}>
            {/* AI-Powered Comparison Analysis */}
            {comparisonMode && comparisonReports.length > 0 && (
              <Card className="overflow-hidden border-info/30 bg-gradient-to-br from-info/5 via-background to-background shadow-sm">
                <CardHeader className="border-b bg-info/5 pb-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="rounded-xl bg-info/10 p-2 text-info">
                          <Zap className="h-4 w-4" />
                        </span>
                        {AI_PANEL_TITLE}
                      </CardTitle>
                      <p className="max-w-2xl text-xs text-muted-foreground">
                        Generate a profile-aware comparison analysis across selected properties, rankings, and recommendations.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-xs">{comparisonReports.length + 1} properties selected</Badge>
                        {isLoadingAnalysis && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <RotateCcw className="h-3 w-3 animate-spin" />
                            Loading analysis
                          </Badge>
                        )}
                        {savedAnalysisId ? (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Save className="h-3 w-3" />
                            Saved analysis
                          </Badge>
                        ) : aiAnalysis ? (
                          <Badge variant="outline" className="border-warning/30 text-warning text-xs">Unsaved analysis</Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 xl:items-end">
                      <Select value={investorProfile} onValueChange={(v) => setInvestorProfile(v as any)}>
                        <SelectTrigger className="h-9 w-full sm:w-[190px]">
                          <SelectValue placeholder="Investor profile" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="growth">Growth focused</SelectItem>
                          <SelectItem value="income">Income focused</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                        {aiAnalysis && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={saveAiAnalysis}
                              disabled={isSavingAnalysis}
                              className="gap-1"
                            >
                              {isSavingAnalysis ? (
                                <RotateCcw className="h-3 w-3 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3" />
                              )}
                              {savedAnalysisId ? 'Update' : 'Save'}
                            </Button>
                            {/*
                              The analysis panel gets it too, because this is
                              where an adviser is when they have just generated
                              one — and the typeset document is the only one of
                              the three that carries both the prose and the
                              figures it was written from.
                            */}
                            <CashFlowComparisonDownloadButton
                              build={buildWireComparison}
                              unavailableReason={comparisonUnavailableReason}
                              label="Typeset"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => exportAiAnalysisPDF()}
                              className="gap-1 text-muted-foreground"
                            >
                              <Download className="h-3 w-3" />
                              Export PDF (legacy layout)
                            </Button>
                            <FlattenPdfIconButton
                              getPdfBlob={async () => {
                                const b = await exportAiAnalysisPDF({ returnBlob: true });
                                if (!b) throw new Error('Failed to generate AI analysis PDF');
                                return b;
                              }}
                              filename={`ai-cash-flow-analysis-${new Date().toISOString().split('T')[0]}.pdf`}
                            />
                          </>
                        )}
                        <Button
                          size="sm"
                          onClick={generateAiAnalysis}
                          disabled={isGeneratingAiAnalysis || isLoadingAnalysis}
                          className="bg-info hover:bg-info"
                        >
                          {isGeneratingAiAnalysis ? (
                            <>
                              <RotateCcw className="h-3 w-3 mr-1 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Zap className="h-3 w-3 mr-1" />
                              {aiAnalysis ? 'Regenerate' : 'Generate AI Analysis'}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  <div className="grid gap-2 rounded-2xl border bg-background/80 p-3 text-xs text-muted-foreground md:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">Primary:</span> {report.property_address}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Comparing:</span> {comparisonReports.map(r => r.property_address.split(',')[0]).join(' • ')}
                    </div>
                  </div>

                  {!aiAnalysis && !isGeneratingAiAnalysis && (
                    <p className="text-sm text-muted-foreground">
                      Click "Generate AI Analysis" to get an in-depth AI-powered comparison of cash flow projections, 
                      investment potential, and personalized recommendations based on your investor profile.
                    </p>
                  )}
                  
                  {isGeneratingAiAnalysis && (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-center">
                        <RotateCcw className="h-8 w-8 animate-spin mx-auto mb-2 text-info" />
                        <p className="text-sm text-muted-foreground">Analyzing cash flow projections...</p>
                      </div>
                    </div>
                  )}
                  
                  {aiAnalysis && (
                    <div className="max-h-[min(70vh,900px)] space-y-4 overflow-y-auto overscroll-contain rounded-3xl border border-brand-300/25 bg-background/95 dark:bg-background/95 p-3 shadow-2xl shadow-foreground/20 ring-1 ring-brand-400/15 sm:p-4 [scrollbar-gutter:stable]">
                      {/* What did not arrive is said, rather than left to be
                          noticed. A partial answer is a normal arrival and is
                          worth keeping — six sections of real work — but it may
                          never be presented as a whole one. */}
                      {analysisShortfall && (
                        <div className="min-w-0 rounded-2xl border border-warning/30 bg-warning/5 p-3 text-xs leading-6 text-warning sm:p-4">
                          <span className="font-semibold">This analysis is incomplete. </span>
                          <span className="text-muted-foreground dark:text-foreground">{analysisShortfall}</span>
                        </div>
                      )}

                      {/* Executive Summary */}
                      {aiAnalysis.executiveSummary && (
                        <div className="min-w-0 rounded-2xl border border-brand-300/30 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-card dark:to-background p-4 shadow-lg shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/10 sm:p-5">
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-100"><Zap className="h-4 w-4 shrink-0 text-brand-300" /><span>Executive Summary</span></h4>
                          <p className="whitespace-normal text-sm leading-7 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.executiveSummary}</p>
                        </div>
                      )}
                      
                      {/* Final Rankings */}
                      {aiAnalysis.finalRankings && aiAnalysis.finalRankings.length > 0 && (
                        <div className="min-w-0 rounded-2xl border border-brand-300/25 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-info/40 p-4 shadow-lg shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/10 sm:p-5">
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-100"><Zap className="h-4 w-4 shrink-0 text-brand-300" /><span>Property Rankings</span></h4>
                          <div className="space-y-2">
                            {aiAnalysis.finalRankings.map((ranking: any, idx: number) => (
                              <div key={idx} className={`min-w-0 rounded-xl p-3 ${idx === 0 ? 'bg-success/10 border border-success/30' : 'bg-background/60 border border-border/80'}`}>
                                <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                                  <Badge variant={idx === 0 ? 'default' : 'outline'} className="text-xs">
                                    #{ranking.rank}
                                  </Badge>
                                  <span className="min-w-0 text-sm font-medium text-foreground dark:text-foreground [overflow-wrap:anywhere]">{ranking.address}</span>
                                  {ranking.score && (
                                    <Badge variant="secondary" className="text-xs ml-auto">
                                      Score: {typeof ranking.score === 'number' ? ranking.score.toFixed(1) : ranking.score}
                                    </Badge>
                                  )}
                                </div>
                                {ranking.verdict && (
                                  <p className="mt-1 whitespace-normal text-xs leading-6 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]">{ranking.verdict}</p>
                                )}
                                {ranking.strengths && ranking.strengths.length > 0 && (
                                  <div className="mt-2">
                                    <span className="text-[10px] text-success font-medium">Strengths: </span>
                                    <span className="whitespace-normal text-[10px] leading-5 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]">{ranking.strengths.join(', ')}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* The four sections the model has always been asked for
                          and this panel never drew. The typeset PDF has drawn
                          all eight since the format was migrated, so the
                          document said more than the screen it came from. */}
                      <CashFlowAnalysisFindings analysis={aiAnalysis} properties={analysisProperties} />

                      {/* Investor Recommendations */}
                      {aiAnalysis.investorRecommendations && (
                        <div className="min-w-0 rounded-2xl border border-brand-300/25 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-card dark:to-background p-4 shadow-lg shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/10 sm:p-5">
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-100"><Zap className="h-4 w-4 shrink-0 text-brand-300" /><span>Investor Profile Recommendations</span></h4>
                          <div className="grid min-w-0 gap-3 text-xs md:grid-cols-2">
                            {aiAnalysis.investorRecommendations.growthFocused && (
                              <div className="min-w-0 rounded-xl border border-info/20 bg-info/10 p-3">
                                <span className="font-medium text-info">Growth Focused:</span>
                                <p className="mt-2 whitespace-normal leading-6 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.investorRecommendations.growthFocused.reason}</p>
                              </div>
                            )}
                            {aiAnalysis.investorRecommendations.incomeFocused && (
                              <div className="min-w-0 rounded-xl border border-success/20 bg-success/10 p-3">
                                <span className="font-medium text-success">Income Focused:</span>
                                <p className="mt-2 whitespace-normal leading-6 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.investorRecommendations.incomeFocused.reason}</p>
                              </div>
                            )}
                            {aiAnalysis.investorRecommendations.balanced && (
                              <div className="min-w-0 rounded-xl border border-accent/20 bg-accent/10 p-3">
                                <span className="font-medium text-accent">Balanced:</span>
                                <p className="mt-2 whitespace-normal leading-6 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.investorRecommendations.balanced.reason}</p>
                              </div>
                            )}
                            {aiAnalysis.investorRecommendations.riskAverse && (
                              <div className="min-w-0 rounded-xl border border-brand-400/20 bg-brand-500/10 p-3">
                                <span className="font-medium text-brand-600">Risk Averse:</span>
                                <p className="mt-2 whitespace-normal leading-6 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.investorRecommendations.riskAverse.reason}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Overall Recommendation */}
                      {aiAnalysis.overallRecommendation?.bestProperty && (
                        <div className="min-w-0 rounded-2xl border border-brand-300/35 bg-gradient-to-br from-success/50 via-card dark:via-background to-card dark:to-background p-4 shadow-lg shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/10 sm:p-5">
                          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-100"><Zap className="h-4 w-4 shrink-0 text-brand-300" /><span>Best Overall Property</span></h4>
                          <p className="whitespace-normal text-sm leading-7 text-foreground dark:text-foreground [overflow-wrap:anywhere]">{aiAnalysis.overallRecommendation.bestProperty.reason}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-3">
                <p className="text-sm text-muted-foreground">
                  <strong>Tip:</strong> Click on any cell in Years 1-10 to edit values directly. Year 0 (Today) is the reference point and cannot be edited. 
                  Cells with <span className="text-primary font-semibold">blue highlighting</span> have been overridden.
                </p>
              </CardContent>
            </Card>

            </CashFlowAiPanel>

            {/* Which property the details below belong to. Drawn only when
                there is more than one, and always above them: the section used
                to be the open report's alone, at the very bottom, with a peer's
                own assumptions unreachable from anywhere on the page. */}
            <CashFlowPropertySwitcher
              properties={detailProperties}
              selectedId={detailPropertyId ?? report.id}
              onSelect={(id) => setDetailPropertyId(id === report.id ? null : id)}
            />

            {selectedPeer && (
              <CashFlowPeerDetail
                address={selectedPeer.report.property_address}
                colour={selectedPeer.colour}
                inputs={selectedPeer.inputs}
                projections={selectedPeer.projections as never}
                metrics={selectedPeer.metrics}
                unavailable={selectedPeer.unavailable}
              />
            )}

            {/* Inputs Summary Table - Collapsible */}
            {!selectedPeer && (
            <Collapsible open={inputsSummaryOpen} onOpenChange={setInputsSummaryOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        {inputsSummaryOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {isNewBuild ? 'New Build' : 'Existing Property'} - SUMMARY
                      </span>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground cursor-pointer">
                          <Checkbox
                            checked={includeInputsSummaryInExport}
                            onCheckedChange={(checked) => setIncludeInputsSummaryInExport(checked === true)}
                          />
                          Include in PDF/Print
                        </label>
                      </div>
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    {/* INPUTS Section */}
                    <div className="border-b-2 border-muted pb-2 mb-3">
                      <h4 className="text-sm font-bold text-center tracking-wide">INPUTS</h4>
                    </div>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium w-1/2">Purchase Price</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.purchasePrice)}</TableCell>
                        </TableRow>
                        {isNewBuild && (
                          <>
                            <TableRow>
                              <TableCell className="font-medium">Land Price</TableCell>
                              <TableCell className="text-right">{formatCurrency(baseFinancialData.landPrice)}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell className="font-medium">Build Price</TableCell>
                              <TableCell className="text-right">{formatCurrency(baseFinancialData.buildPrice || (baseFinancialData.purchasePrice - baseFinancialData.landPrice))}</TableCell>
                            </TableRow>
                          </>
                        )}
                        {/* Only show Deposit Value for existing properties */}
                        {!isNewBuild && (
                          <TableRow>
                            <TableCell className="font-medium">Deposit Value</TableCell>
                            <TableCell className="text-right">{formatCurrency(baseFinancialData.depositValue || (baseFinancialData.purchasePrice * (1 - baseFinancialData.loanToValueRatio / 100)))}</TableCell>
                          </TableRow>
                        )}
                        <TableRow>
                          <TableCell className="font-medium">Loan to Value ratio</TableCell>
                          <TableCell className="text-right">{baseFinancialData.loanToValueRatio}%</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Interest Rate</TableCell>
                          <TableCell className="text-right">{baseFinancialData.interestRate.toFixed(2)}%</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Capital Growth</TableCell>
                          <TableCell className="text-right">{baseFinancialData.capitalGrowth}%</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Weekly Rent</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.weeklyRent)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Stamp Duty</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.stampDuty)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Body Corporate / Strata Fees</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.bodyCorporateFees)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Council Rate Charges</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.councilRates)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Water Rate Charges (Other)</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.waterRates)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Solicitor Fees</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.solicitorFees)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Building & Landlord Insurance</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.buildingLandlordInsurance)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Property Management Fees</TableCell>
                          <TableCell className="text-right">{baseFinancialData.propertyManagementFees}%</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Repairs & Maintenance</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.repairsMaintenance)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Letting Fees (1 Week Rent)</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.lettingFees || baseFinancialData.weeklyRent)}</TableCell>
                        </TableRow>
                         <TableRow>
                          <TableCell className="font-medium">Land Tax (p.a.)</TableCell>
                          <TableCell className="text-right">{formatCurrency(baseFinancialData.landTax)}</TableCell>
                        </TableRow>
                        {baseFinancialData.lmiAmount > 0 && (
                          <TableRow className="bg-brand-50 dark:bg-brand-950/30">
                            <TableCell className="font-medium">LMI (Lenders Mortgage Insurance)</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(baseFinancialData.lmiAmount)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    
                    {/* Cash Flow Analysis Inputs Section */}
                    <div className="mt-6 pt-4 border-t-2 border-muted">
                      <div className="border-b border-muted pb-2 mb-3">
                        <h4 className="text-sm font-bold">Cash Flow Analysis Inputs</h4>
                      </div>
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium w-1/2">Loan Amount</TableCell>
                            <TableCell className="text-right">{formatCurrency(baseFinancialData.loanAmount)}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Loan Type</TableCell>
                            <TableCell className="text-right">{baseFinancialData.loanType === 'interest_only' ? 'Interest Only' : 'Principal & Interest'}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Loan Term</TableCell>
                            <TableCell className="text-right">{baseFinancialData.loanTermYears} years</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Occupancy Rate</TableCell>
                            <TableCell className="text-right">{baseFinancialData.occupancyRate} weeks/year</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">CPI / Expense Growth Rate</TableCell>
                            <TableCell className="text-right">{baseFinancialData.cpiGrowthRate}%</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">Tax Rate (Marginal)</TableCell>
                            <TableCell className="text-right">{baseFinancialData.taxRate}%</TableCell>
                          </TableRow>
                          <TableRow className={baseFinancialData.depreciation > 0 ? 'bg-brand-50 dark:bg-brand-950/30' : ''}>
                            <TableCell className="font-medium">
                              Annual Depreciation (Year 1)
                              {baseFinancialData.includeDepreciationInCashFlow ? '' : ' (Excluded)'}
                              {baseFinancialData.depreciationSchedule ? (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  10-Year Schedule ({baseFinancialData.depreciationMethod?.toUpperCase() || 'DV'})
                                </Badge>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(baseFinancialData.depreciation)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    
                    {/* Total Upfront Costs + Total Overall Expenditure to Completion */}
                    {(() => {
                      const depositValue = baseFinancialData.depositValue || (baseFinancialData.purchasePrice * (1 - (baseFinancialData.loanToValueRatio || 80) / 100));
                      const depositPct = baseFinancialData.purchasePrice > 0 ? Math.round((depositValue / baseFinancialData.purchasePrice) * 100) : 0;
                      const stampDuty = baseFinancialData.stampDuty || 0;
                      const solicitorFees = baseFinancialData.solicitorFees || 0;
                      const agentFee = baseFinancialData.agentFee || 0;
                      const lmiAmount = baseFinancialData.lmiAmount || 0;

                      let upfrontRows: { label: string; value: number }[] = [];
                      let overallExtraRows: { label: string; value: number }[] = [];
                      let totalUpfront = 0;
                      let totalOverall = 0;

                      if (isNewBuild && constructionProgressSchedule) {
                        const landDeposit = constructionProgressSchedule.upfrontCosts.tenPercentLand;
                        const buildDeposit = constructionProgressSchedule.upfrontCosts.fivePercentBuild;
                        const constructionProgressTotal = constructionProgressSchedule.buildPrice;
                        const stagedInterest = constructionProgressSchedule.totals.totalCombinedRepayment;
                        upfrontRows = [
                          { label: '10% Land Deposit', value: landDeposit },
                          { label: '5% Build Contract Deposit', value: buildDeposit },
                          { label: 'Stamp Duty', value: stampDuty },
                          { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                          { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
                          ...(lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: lmiAmount }] : []),
                        ];
                        totalUpfront = landDeposit + buildDeposit + stampDuty + solicitorFees + stagedInterest + lmiAmount;
                        overallExtraRows = [
                          { label: 'Purchase Price (Land)', value: constructionProgressSchedule.landPrice },
                          { label: 'Stamp Duty', value: stampDuty },
                          { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                          { label: 'Build Price', value: constructionProgressTotal },
                          { label: `Construction Progress Payment Interest (${constructionProgressSchedule.durationMonths} months)`, value: stagedInterest },
                        ];
                        totalOverall = constructionProgressSchedule.landPrice + stampDuty + solicitorFees + constructionProgressTotal + stagedInterest;
                      } else {
                        upfrontRows = [
                          { label: `Deposit (${depositPct}% — from your funds)`, value: depositValue },
                          { label: 'Stamp Duty', value: stampDuty },
                          { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                          { label: 'Agent Fee', value: agentFee },
                          ...(lmiAmount > 0 ? [{ label: 'LMI (Lenders Mortgage Insurance)', value: lmiAmount }] : []),
                        ];
                        totalUpfront = depositValue + stampDuty + solicitorFees + agentFee + lmiAmount;
                        overallExtraRows = [
                          { label: 'Purchase Price', value: baseFinancialData.purchasePrice },
                          { label: 'Stamp Duty', value: stampDuty },
                          { label: 'Solicitor / Conveyancer Cost', value: solicitorFees },
                          { label: 'Agent Fee', value: agentFee },
                        ];
                        totalOverall = baseFinancialData.purchasePrice + stampDuty + solicitorFees + agentFee;
                      }

                      return (
                        <>
                          <div className="mt-6 pt-4 border-t-2 border-muted">
                            <div className="border-b border-muted pb-2 mb-3">
                              <h4 className="text-sm font-bold">Total Upfront Costs</h4>
                            </div>
                            <Table>
                              <TableBody>
                                {upfrontRows.map((r, i) => (
                                  <TableRow key={`up-${i}`}>
                                    <TableCell className="font-medium w-1/2">{r.label}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(r.value)}</TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="bg-muted/30">
                                  <TableCell className="font-semibold">Total Upfront Costs</TableCell>
                                  <TableCell className="text-right font-semibold">{formatCurrency(totalUpfront)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>

                          <div className="mt-6 pt-4 border-t-2 border-muted">
                            <div className="border-b border-muted pb-2 mb-3">
                              <h4 className="text-sm font-bold">Total Overall Expenditure to Completion</h4>
                            </div>
                            <Table>
                              <TableBody>
                                {overallExtraRows.map((r, i) => (
                                  <TableRow key={`ov-${i}`}>
                                    <TableCell className="font-medium w-1/2">{r.label}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(r.value)}</TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="bg-primary/10">
                                  <TableCell className="font-bold text-primary">Total Overall Expenditure to Completion</TableCell>
                                  <TableCell className="text-right font-bold text-primary">{formatCurrency(totalOverall)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </>
                      );
                    })()}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
            )}

            <CashFlowConstructionPanel active={isNewBuild && !!constructionProgressSchedule && constructionProgressSchedule.buildPrice > 0}>
            {/* Construction Progress Payment Schedule - Collapsible (New Builds Only) */}
            {isNewBuild && constructionProgressSchedule && constructionProgressSchedule.buildPrice > 0 && (
              <Collapsible open={constructionScheduleOpen} onOpenChange={setConstructionScheduleOpen}>
                <Card className="overflow-hidden border-brand-200/70 bg-gradient-to-br from-brand-50/40 via-background to-background shadow-sm dark:border-brand-900/40 dark:from-brand-950/20">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer border-b bg-brand-50/50 transition-colors hover:bg-brand-50 dark:bg-brand-950/20 dark:hover:bg-brand-950/30">
                      <CardTitle className="flex flex-col gap-3 text-base lg:flex-row lg:items-center lg:justify-between">
                        <span className="flex items-center gap-2">
                          <span className="rounded-xl bg-brand-500/10 p-2 text-brand-600">
                            {constructionScheduleOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </span>
                          <span>
                            Construction Progress Payment Schedule
                            <span className="block text-xs font-normal text-muted-foreground">New build staged drawdown and interest workflow</span>
                          </span>
                        </span>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <label className="flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs font-normal text-muted-foreground cursor-pointer">
                            <Checkbox
                              checked={includeConstructionScheduleInExport}
                              onCheckedChange={(checked) => setIncludeConstructionScheduleInExport(checked === true)}
                            />
                            Include in PDF/Print
                          </label>
                        </div>
                      </CardTitle>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-4 p-4">
                      {/* Preset Selection */}
                      <div className="flex flex-col gap-3 rounded-2xl border bg-background/80 p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="text-sm font-medium">Schedule Mode:</span>
                          <Select value={schedulePreset} onValueChange={(value: 'rapid' | 'even' | 'custom') => setSchedulePreset(value)}>
                            <SelectTrigger className="w-full sm:w-[220px]">
                              <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rapid">Rapid Build (Months 2-7)</SelectItem>
                              <SelectItem value="even">Even Distribution</SelectItem>
                              <SelectItem value="custom">Custom Positioning</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <span className="max-w-2xl text-xs text-muted-foreground">
                          {schedulePreset === 'rapid' && 'Stages are fixed at months 2-7. Additional months show interest-only rows.'}
                          {schedulePreset === 'even' && `Stages are evenly distributed across ${constructionProgressSchedule.durationMonths} months.`}
                          {schedulePreset === 'custom' && 'Customize which month each stage occurs. Click on the month column to edit.'}
                        </span>
                      </div>

                      {/* Custom Stage Month Selection (only in custom mode) */}
                      {schedulePreset === 'custom' && (
                        <div className="rounded-2xl border border-info/30 bg-info/10 p-4 dark:border-info/30 dark:bg-info/30">
                          <h5 className="text-sm font-medium mb-3 text-info">Custom Stage Positioning</h5>
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                            {[
                              { index: 0, label: 'Deposit' },
                              { index: 1, label: 'Slab/Base' },
                              { index: 2, label: 'Frame' },
                              { index: 3, label: 'Lock-up' },
                              { index: 4, label: 'Fixing' },
                              { index: 5, label: 'Completion' },
                            ].map(({ index, label }) => (
                              <div key={index} className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">{label}</label>
                                <Select 
                                  value={String(customStageMonths[index] || (index + 2))}
                                  onValueChange={(value) => {
                                    setCustomStageMonths(prev => ({
                                      ...prev,
                                      [index]: parseInt(value, 10)
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue placeholder="Month" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from({ length: constructionProgressSchedule.durationMonths - 1 }, (_, i) => i + 2).map(month => (
                                      <SelectItem key={month} value={String(month)}>
                                        Month {month}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Note: Multiple stages can occur in the same month. Interest calculations update automatically.
                          </p>
                        </div>
                      )}

                      {/* Project Summary */}
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border bg-background/80 p-4">
                          <span className="text-xs text-muted-foreground">Land Cost</span>
                          <p className="mt-1 text-lg font-semibold">{formatCurrency(constructionProgressSchedule.landPrice)}</p>
                        </div>
                        <div className="rounded-2xl border bg-background/80 p-4">
                          <span className="text-xs text-muted-foreground">Build Contract</span>
                          <p className="mt-1 text-lg font-semibold">{formatCurrency(constructionProgressSchedule.buildPrice)}</p>
                        </div>
                        <div className="rounded-2xl border bg-primary/5 p-4">
                          <span className="text-xs text-muted-foreground">Total Project</span>
                          <p className="mt-1 text-lg font-semibold text-primary">{formatCurrency(constructionProgressSchedule.totalProject)}</p>
                        </div>
                      </div>

                      {/* Build Contract Breakdown */}
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <h4 className="text-sm font-semibold">Build Progress Table</h4>
                        <p className="text-xs text-muted-foreground">{constructionProgressSchedule.durationMonths} month construction schedule</p>
                      </div>
                      <div className="max-w-full overflow-x-auto rounded-2xl border bg-background [-webkit-overflow-scrolling:touch]">
                      <Table className="min-w-[980px]">
                        <TableHeader>
                          <TableRow className="bg-card dark:bg-background hover:bg-background">
                            <TableHead className="font-semibold text-foreground dark:text-white">Stage</TableHead>
                            <TableHead className="font-semibold text-foreground dark:text-white">Description</TableHead>
                            <TableHead className="text-center font-semibold text-foreground dark:text-white">Total Build Contract</TableHead>
                            <TableHead className="text-right font-semibold text-foreground dark:text-white">Stage Pricing</TableHead>
                            <TableHead className="text-right font-semibold text-foreground dark:text-white">Land Interest Charge (Monthly)</TableHead>
                            <TableHead className="text-right font-semibold text-foreground dark:text-white">Build Interest Charge (Monthly)</TableHead>
                            <TableHead className="text-right font-semibold text-foreground dark:text-white">Combined Repayment Breakdown</TableHead>
                            <TableHead className="text-center font-semibold text-foreground dark:text-white">Month</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {constructionProgressSchedule.stages.map((stage, idx) => (
                            <TableRow key={idx} className={idx === 0 ? 'bg-muted/20 hover:bg-muted/30' : 'hover:bg-muted/30'}>
                              <TableCell className="font-medium">{stage.stage || ''}</TableCell>
                              <TableCell className="text-muted-foreground text-sm">{stage.description || ''}</TableCell>
                              <TableCell className="text-center">{stage.percentage > 0 ? `${stage.percentage}%` : ''}</TableCell>
                              <TableCell className="text-right">{stage.buildAmount > 0 ? formatCurrency(stage.buildAmount) : ''}</TableCell>
                              <TableCell className="text-right">{formatCurrency(stage.landInterest)}</TableCell>
                              <TableCell className="text-right">{stage.buildInterest > 0 ? formatCurrency(stage.buildInterest) : ''}</TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(stage.totalMonthlyInterest)}</TableCell>
                              <TableCell className="text-center">{stage.month}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-semibold border-t-2">
                            <TableCell></TableCell>
                            <TableCell></TableCell>
                            <TableCell className="text-center font-bold">100%</TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(constructionProgressSchedule.landPrice + constructionProgressSchedule.buildPrice)}</TableCell>
                            <TableCell className="text-right font-semibold">Total</TableCell>
                            <TableCell className="text-right"></TableCell>
                            <TableCell className="text-right font-bold">{formatCurrency(constructionProgressSchedule.totals.totalCombinedRepayment)}</TableCell>
                            <TableCell className="text-center"></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        * Interest calculated at {constructionProgressSchedule.interestRate}% p.a. Land interest is constant; build interest increases as stages are drawn.
                      </p>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            </CashFlowConstructionPanel>

            {/* The editable projection belongs to the open report: the
                per-year overrides are stored against it, so a peer's table
                is drawn read-only by `CashFlowPeerDetail` instead. */}
            {!selectedPeer && (
            <CashFlowProjectionTable>
            {/* 10-Year Projection Table with Inline Editing */}
            <Card className="overflow-hidden border-border/80 bg-background/95 shadow-lg ring-1 ring-border/5">
              <CardHeader className="border-b bg-gradient-to-r from-muted via-background to-muted/70 pb-4 dark:from-background/40 dark:via-background dark:to-background/30">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <CardTitle className="text-base">10-Year Projection Overview</CardTitle>
                    <p className="text-xs text-muted-foreground">Click editable year cells to override assumptions. Edited cells are highlighted.</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
                    Edited override
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-w-full overflow-x-auto rounded-b-2xl overscroll-x-contain border-t bg-background [-webkit-overflow-scrolling:touch]">
                  <Table className={PROJECTION_TABLE_CLASS}>
                    <TableHeader className="sticky top-0 z-30 shadow-sm">
                      <TableRow className="bg-card dark:bg-background hover:bg-background">
                        <TableHead className={PROJECTION_LABEL_HEAD_CLASS}>Overview</TableHead>
                        {projections.map(p => (
                          <TableHead key={p.year} className={PROJECTION_YEAR_HEAD_CLASS}>
                            {p.year === 0 ? 'Today' : `Year ${p.year}`}
                            {p.year >= 1 && <span className="block text-[10px] font-normal text-muted-foreground dark:text-foreground">editable</span>}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Capital Growth Rate - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Capital Growth %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '' : renderEditableCell(
                              p.year,
                              'capitalGrowthRate',
                              p.capitalGrowthRate,
                              (v) => formatPercent(v)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* CPI Growth Rate - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">CPI Growth %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '' : renderEditableCell(
                              p.year,
                              'cpiGrowthRate',
                              p.cpiGrowthRate,
                              (v) => formatPercent(v)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* Property Value - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Property Value $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {renderEditableCell(
                              p.year,
                              'propertyMarketValue',
                              p.propertyMarketValue,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Loan Amount $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_CELL_CLASS}>{p.loanAmount.toLocaleString('en-AU')}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/5 hover:bg-primary/5">
                        {/* Audit item 2, second pass. The sticky inline-block held the
                            TEXT still but left this row with no frozen CELL, so the
                            rail every other row draws — an opaque 220px column with
                            its shadow — broke at each section band. The heading now
                            lives in the same kind of frozen cell as every data row:
                            opaque base, band colour as an inner layer, and the other
                            eleven columns as one spanned band beside it. */}
                        <TableCell className={PROJECTION_SECTION_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_SECTION_LABEL_INNER_CLASS}>Statistics</div>
                        </TableCell>
                        <TableCell className="bg-primary/5 p-0 sm:p-0" colSpan={11} />
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Equity $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} text-success`}>{p.equityInProperty.toLocaleString('en-AU')}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">LVR %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_CELL_CLASS}>{p.loanToValueRatio}</TableCell>
                        ))}
                      </TableRow>
                      
                      {/* Rental Income - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Rental Income $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? `${baseFinancialData.weeklyRent}pw` : renderEditableCell(
                              p.year,
                              'rentalIncome',
                              p.rentalIncome,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Gross Yield %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_CELL_CLASS}>{p.year === 0 ? '' : p.grossYield}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Net Yield %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_CELL_CLASS}>{p.year === 0 ? '' : p.netYield}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/5 hover:bg-primary/5">
                        {/* Audit item 2, second pass. The sticky inline-block held the
                            TEXT still but left this row with no frozen CELL, so the
                            rail every other row draws — an opaque 220px column with
                            its shadow — broke at each section band. The heading now
                            lives in the same kind of frozen cell as every data row:
                            opaque base, band colour as an inner layer, and the other
                            eleven columns as one spanned band beside it. */}
                        <TableCell className={PROJECTION_SECTION_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_SECTION_LABEL_INNER_CLASS}>Cash Deductions</div>
                        </TableCell>
                        <TableCell className="bg-primary/5 p-0 sm:p-0" colSpan={11} />
                      </TableRow>
                      
                      {/* Property Expenses - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Property Expenses $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '0' : renderEditableCell(
                              p.year,
                              'propertyExpenses',
                              p.propertyExpenses,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* Land Tax - Editable (moved from Summary to Cash Deductions) */}
                      {!excludeLandTaxFromCashFlow && (
                        <TableRow className="transition-colors hover:bg-primary/5">
                          <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Land Tax $</TableCell>
                          {projections.map(p => (
                            <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                              {p.year === 0 ? '' : renderEditableCell(
                                p.year,
                                'landTax',
                                p.landTax,
                                (v) => v.toLocaleString('en-AU')
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      )}
                      
                      {/* Interest Rate - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Interest Rate %</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '' : renderEditableCell(
                              p.year,
                              'interestRate',
                              p.interestRate,
                              (v) => formatPercent(v)
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* Interest Payments - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Interest Payments $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '0' : renderEditableCell(
                              p.year,
                              'interestPayment',
                              p.interestPayments,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* Principal Payments - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Principal Payments $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '0' : renderEditableCell(
                              p.year,
                              'principalPayment',
                              p.principalPayments,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      {/* `signedFigureInk`, never `text-destructive-foreground`.
                          These five rows are the only ones in the table whose
                          colour carries meaning, and all five spelled the loss
                          colour as the ink for text on a SOLID destructive fill
                          — which is `0 0% 100%` in both themes, so every
                          negative figure on this screen was painted white while
                          the PDF and the HTML export printed the same rows in
                          red. See `src/lib/cashFlow/figureInk.pure.ts`. */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Pre-Tax Cash Flow p/a $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} ${signedFigureInk(p.preTaxCashFlowPA)}`}>
                            {p.year === 0 ? '' : p.preTaxCashFlowPA.toLocaleString('en-AU')}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Pre-Tax Cash Flow p/w $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} ${signedFigureInk(p.preTaxCashFlowPW)}`}>
                            {p.year === 0 ? '' : p.preTaxCashFlowPW.toLocaleString('en-AU')}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/5 hover:bg-primary/5">
                        {/* Audit item 2, second pass. The sticky inline-block held the
                            TEXT still but left this row with no frozen CELL, so the
                            rail every other row draws — an opaque 220px column with
                            its shadow — broke at each section band. The heading now
                            lives in the same kind of frozen cell as every data row:
                            opaque base, band colour as an inner layer, and the other
                            eleven columns as one spanned band beside it. */}
                        <TableCell className={PROJECTION_SECTION_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_SECTION_LABEL_INNER_CLASS}>Non-Cash Deductions</div>
                        </TableCell>
                        <TableCell className="bg-primary/5 p-0 sm:p-0" colSpan={11} />
                      </TableRow>
                      
                      {/* Depreciation - Editable */}
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Depreciation $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_EDIT_CELL_CLASS}>
                            {p.year === 0 ? '' : renderEditableCell(
                              p.year,
                              'depreciation',
                              p.depreciation,
                              (v) => v.toLocaleString('en-AU')
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/5 hover:bg-primary/5">
                        {/* Audit item 2, second pass. The sticky inline-block held the
                            TEXT still but left this row with no frozen CELL, so the
                            rail every other row draws — an opaque 220px column with
                            its shadow — broke at each section band. The heading now
                            lives in the same kind of frozen cell as every data row:
                            opaque base, band colour as an inner layer, and the other
                            eleven columns as one spanned band beside it. */}
                        <TableCell className={PROJECTION_SECTION_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_SECTION_LABEL_INNER_CLASS}>Summary</div>
                        </TableCell>
                        <TableCell className="bg-primary/5 p-0 sm:p-0" colSpan={11} />
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Total Deductions $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={PROJECTION_YEAR_CELL_CLASS}>{p.year === 0 ? '' : p.totalDeductions.toLocaleString('en-AU')}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Net Profit/Loss $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} ${signedFigureInk(p.netProfitLoss)}`}>
                            {p.year === 0 ? '' : p.netProfitLoss.toLocaleString('en-AU')}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="transition-colors hover:bg-primary/5">
                        <TableCell className="sticky left-0 z-10 bg-background font-medium shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]">Tax Refund / (Payable) $</TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} ${signedFigureInk(p.taxEffect)}`}>{p.year === 0 ? '' : p.taxEffect.toLocaleString('en-AU')}</TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/10">
                        {/* Audit item 2: a TRANSLUCENT sticky cell does not occlude
                            what scrolls beneath it — the year figures slid under this
                            label and showed through the tint, which on the dark theme
                            reads as the highlighted row moving while the rows beside
                            it stay frozen. Opaque base, tint inside. */}
                        <TableCell className={PROJECTION_TOTAL_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_TOTAL_LABEL_INNER_CLASS}>After-Tax Cash Flow p/a $</div>
                        </TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} font-bold ${signedFigureInk(p.afterTaxCashFlowPA)}`}>
                            {p.year === 0 ? '' : p.afterTaxCashFlowPA.toLocaleString('en-AU')}
                          </TableCell>
                        ))}
                      </TableRow>
                      
                      <TableRow className="bg-primary/10">
                        <TableCell className={PROJECTION_TOTAL_LABEL_CELL_CLASS}>
                          <div className={PROJECTION_TOTAL_LABEL_INNER_CLASS}>After-Tax Cash Flow p/w $</div>
                        </TableCell>
                        {projections.map(p => (
                          <TableCell key={p.year} className={`${PROJECTION_YEAR_CELL_CLASS} font-bold ${signedFigureInk(p.afterTaxCashFlowPW)}`}>
                            {p.year === 0 ? '' : p.afterTaxCashFlowPW.toLocaleString('en-AU')}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            </CashFlowProjectionTable>
            )}
        </div>
    </CashFlowPresentationShell>

    {/* Reset Confirmation Dialog */}
    <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset All Overrides?</AlertDialogTitle>
          <AlertDialogDescription>
            This will clear all custom override values across all years and revert to calculated defaults. 
            You'll still need to click "Save Changes" to persist the reset.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleResetOverrides}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Reset All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Send to Client Modal */}
    {report && (
      <SendToClientModal
        isOpen={sendToClientOpen}
        onClose={() => setSendToClientOpen(false)}
        reportId={report.id}
        reportTitle={`Cash Flow Analysis - ${report.property_address}`}
        reportTier="cashflow"
        storagePath={null}
        onGeneratePDF={generateAndUploadCashFlowPDF}
      />
    )}
  </>
  );
}

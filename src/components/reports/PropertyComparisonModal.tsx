import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Loader2, Download, Copy, Check, TrendingUp, TrendingDown, 
  DollarSign, MapPin, AlertTriangle, Trophy, Target, Home,
  CheckCircle2, XCircle, AlertCircle, ChevronRight, PlayCircle, Settings, ChevronDown, RefreshCw, History, Clock,
  Save, BookmarkPlus, FolderOpen, Trash2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { addBackgroundJob } from '@/components/BackgroundJobTracker';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { ComparisonPDFGenerator } from './ComparisonPDFGenerator';
import { ComparisonDownloadButton } from './ComparisonDownloadButton';
import { ComparisonWeights, DEFAULT_COMPARISON_SETTINGS, DEFAULT_COMPARISON_WEIGHTS, cloneComparisonWeights, comparisonWeightsEqual, parseComparisonTemplateSettings, validateComparisonWeights } from './comparisonConfiguration';
import { analysisFromComparisonRow, isDisplayableComparisonRow, matchesSelectedReportIds, normaliseComparisonAnalysis, shouldAttemptRecovery } from './comparisonRecovery.pure';
import { ComparisonResultsPanel } from './ComparisonResultsPanel';

interface PropertyComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportIds: string[];
  propertyAddresses: string[];
}

interface ComparisonAnalysis {
  executiveSummary: string;
  rankings: Array<{
    propertyNumber: number;
    address: string;
    rank: number;
    finalScore: number;
    primaryStrengths: string[];
    primaryConcerns: string[];
    bestSuitedFor: string;
  }>;
  financialComparison: {
    bestYield: { propertyNumber: number; value: string; reason: string };
    bestCashFlow: { propertyNumber: number; value: string; reason: string };
    bestROI: { propertyNumber: number; value: string; reason: string };
    bestValue: { propertyNumber: number; reason: string };
  };
  locationComparison: {
    bestInfrastructure: { propertyNumber: number; reason: string };
    bestGrowthCorridor: { propertyNumber: number; reason: string };
    bestSchools: { propertyNumber: number; reason: string };
    bestLifestyle: { propertyNumber: number; reason: string };
  };
  riskComparison: {
    lowestRisk: { propertyNumber: number; reason: string };
    highestRisk: { propertyNumber: number; reason: string };
    bestRiskReward: { propertyNumber: number; reason: string };
    riskLevels: Array<{
      propertyNumber: number;
      riskLevel: string;
      specificRisks: string[];
    }>;
  };
  investorMatches: Array<{
    propertyNumber: number;
    investorTypes: string[];
    reasoning: string;
  }>;
  competitiveAdvantages: Array<{
    propertyNumber: number;
    advantages: string[];
  }>;
  redFlags: Array<{
    propertyNumber: number;
    concerns: string[];
    severity: string;
  }>;
  finalRecommendation: {
    bestOverall: { propertyNumber: number; reason: string };
    runners: Array<{ propertyNumber: number; reason: string }>;
    avoid: Array<{ propertyNumber: number; reason: string }>;
    alternativeScenarios: Array<{
      scenario: string;
      recommendation: number;
      reason: string;
    }>;
  };
}

/**
 * How long the browser waits for a comparison.
 *
 * Audit 3 item 13 — "the comparison analysis doesn't work". The client
 * aborted at 150s while `supabase/config.toml` grants this function 180s, so
 * an analysis running its PERMITTED budget was reported as a failure at the
 * 83% mark while it carried on and finished. That is also why the recovery
 * path below then found nothing: it went looking for a completed row while
 * the analysis was still running, and honestly reported that it "may still be
 * finishing in the background".
 *
 * The same drift was fixed once already on the CRM conversation sync, and the
 * lesson taken there applies here: the caller waits as long as the function is
 * allowed. `propertyComparisonTimeout.spec.ts` reads the declared value out of
 * `config.toml` and fails if the two separate again.
 */
const COMPARISON_TIMEOUT_MS = 180_000;

export function PropertyComparisonModal({
  isOpen,
  onClose,
  reportIds,
  propertyAddresses
}: PropertyComparisonModalProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<ComparisonAnalysis | null>(null);
  const [comparisonId, setComparisonId] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [runInBackground, setRunInBackground] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [comparisonHistory, setComparisonHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Template management
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
  
  // Analysis parameters (all optional with sensible defaults)
  const [investorProfile, setInvestorProfile] = useState<string>(DEFAULT_COMPARISON_SETTINGS.investorProfile);
  const [analysisDepth, setAnalysisDepth] = useState<string>(DEFAULT_COMPARISON_SETTINGS.analysisDepth);
  const [timeHorizon, setTimeHorizon] = useState<string>(DEFAULT_COMPARISON_SETTINGS.timeHorizon);
  const [riskTolerance, setRiskTolerance] = useState<string>(DEFAULT_COMPARISON_SETTINGS.riskTolerance);
  const [draftWeights, setDraftWeights] = useState<ComparisonWeights>(cloneComparisonWeights());
  const [appliedWeights, setAppliedWeights] = useState<ComparisonWeights>(cloneComparisonWeights());
  const [weightMessage, setWeightMessage] = useState('');
  
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;

    document.body.classList.add('comparison-analysis-dialog-open');
    return () => document.body.classList.remove('comparison-analysis-dialog-open');
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setDraftWeights(cloneComparisonWeights(appliedWeights));
      setWeightMessage('');
    }
  // Modal open is the reset boundary; applied weights intentionally persist through an active session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const draftValidation = useMemo(() => validateComparisonWeights(draftWeights), [draftWeights]);
  const appliedValidation = useMemo(() => validateComparisonWeights(appliedWeights), [appliedWeights]);
  const hasUnappliedWeightChanges = !comparisonWeightsEqual(draftWeights, appliedWeights);
  const isUsingDefaults = comparisonWeightsEqual(appliedWeights, DEFAULT_COMPARISON_WEIGHTS);
  // The completed-analysis settings panel remains a re-run editor. It renders the
  // same draft controls while submission continues to use appliedWeights.
  const customWeights = draftWeights;
  const setCustomWeights = setDraftWeights;
  const useCustomWeights = true;
  const setUseCustomWeights = () => setDraftWeights(cloneComparisonWeights());
  const availableTemplates = useMemo(() => savedTemplates.filter((template) => !!parseComparisonTemplateSettings(template.settings)), [savedTemplates]);

  // Fetch once per modal session and refresh after a successful save.
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'comparison_analysis_templates',
        listOptions: { orderBy: 'created_at', orderAsc: false },
      });

      if (error) throw new Error(error.message);
      setSavedTemplates(data?.records || []);
    } catch (error) {
      console.error('Error loading templates:', error);
      toast({
        title: "Failed to Load Templates",
        description: "Could not load saved templates",
        variant: "destructive",
      });
    } finally { setTemplatesLoading(false); }
  };
  useEffect(() => {
    if (analysis && comparisonHistory.length === 0 && !loadingHistory) {
      loadComparisonHistory();
    }
  }, [analysis]);

  /**
   * The most recent stored comparison of exactly these reports, written since
   * `sinceIso`, or null. The same sorted-ids match the History panel uses.
   */
  const findStoredComparison = async (sinceIso: string): Promise<any | null> => {
    const { data, error } = await supabase
      .from('property_comparisons')
      .select('*')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error || !data) return null;
    return data.find((comp) => matchesSelectedReportIds(comp.report_ids, reportIds)) ?? null;
  };

  /**
   * After the request times out, the server run usually FINISHES anyway — the
   * browser abort does not reach the edge function, which keeps generating,
   * stores the row and charges for it. (Observed in production: the row landed
   * 19 seconds after the client gave up.) So a timeout is not yet a failure:
   * poll for the stored row for a while before reporting one.
   */
  const recoverStoredComparison = async (sinceIso: string): Promise<any | null> => {
    const RECOVERY_POLL_MS = 8_000;
    const RECOVERY_ATTEMPTS = 10;
    for (let i = 0; i < RECOVERY_ATTEMPTS; i++) {
      const row = await findStoredComparison(sinceIso);
      if (row) return row;
      await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS));
    }
    return null;
  };

  const startAnalysis = async (background = false) => {
    if (!appliedValidation.isValid || hasUnappliedWeightChanges) {
      setSettingsOpen(true);
      setWeightMessage(hasUnappliedWeightChanges ? 'Apply the custom scoring weights before starting the analysis.' : appliedValidation.message);
      return;
    }
    setRunInBackground(background);
    setIsAnalyzing(true);
    setIsRecovering(false);
    setHasStarted(true);
    setProgress(10);

    // A minute of slack absorbs client/server clock skew; an identical-report
    // comparison stored in that window is this comparison for every purpose.
    const attemptStartedIso = new Date(Date.now() - 60_000).toISOString();

    // Add notification for analysis start
    addNotification({
      type: 'info',
      title: 'Comparison Analysis Started',
      message: `Comparing ${reportIds.length} properties with ${analysisDepth} analysis depth...`
    });

    // The analysis runs 50–90s server-side; a bar frozen at 30% for a minute
    // reads as a hang. Creep towards 85% and let the real milestones finish it.
    const progressTimer = setInterval(() => {
      setProgress((p) => (p >= 30 && p < 85 ? p + 1 : p));
    }, 1500);

    try {
      setProgress(30);

      const requestBody: any = {
        reportIds,
        analysisDepth,
        investorProfile,
        timeHorizon,
        riskTolerance
      };

      requestBody.customWeights = cloneComparisonWeights(appliedWeights);
      requestBody.scoring_weights = cloneComparisonWeights(appliedWeights);
      requestBody.templateId = activeTemplateId;

      let { data, error } = await invokeSecureFunction('compare-investment-reports', requestBody, { timeoutMs: COMPARISON_TIMEOUT_MS });

      // ── No response arrived; the analysis may well have completed ──
      // The rule lives in the pure module beside the shapes it recovers, and
      // records why requiring `provider_timeout` here excluded the very case
      // it most needed to catch.
      if (shouldAttemptRecovery(error)) {
        setIsRecovering(true);
        try {
          const row = await recoverStoredComparison(attemptStartedIso);
          if (row && isDisplayableComparisonRow(row)) {
            data = { analysis: analysisFromComparisonRow(row), comparisonId: row.id };
            error = null;
          } else if (row) {
            // Stored, but as the raw-response shape only the viewer can read.
            error = {
              ...error!,
              message: 'The analysis finished in the background but was only partially saved. '
                + 'Open it from the comparison library to see what was recovered.',
            };
          } else {
            error = {
              ...error!,
              // Deliberately says nothing about the cause. The transport's own
              // message here is "Network/CORS error … check the function
              // deployment and auth/CORS configuration", which is advice about
              // the one thing measured to be correct; the real cause has been a
              // request cut short. The underlying message is still logged for
              // whoever is reading a console.
              message: 'The analysis did not return a result, and no completed analysis was '
                + 'found. It may still be finishing in the background — check History in a '
                + 'minute, or try again.',
            };
          }
        } finally {
          setIsRecovering(false);
        }
      }

      if (error) {
        // Extract more detailed error information
        let errorMessage = error.message || 'Failed to compare properties';

        // Check for specific error types in the error message
        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          errorMessage = 'Rate limit exceeded. Too many comparison requests. Please wait a moment and try again.';
        } else if (errorMessage.includes('payment') || errorMessage.includes('credits') || errorMessage.includes('402')) {
          errorMessage = 'AI credits exhausted. Please add credits to your Lovable workspace.';
        }

        throw new Error(errorMessage);
      }

      setProgress(90);

      if (!data?.analysis) {
        throw new Error('No analysis data received');
      }

      // Shape before storing in state: the response may name the verdict
      // section `recommendations` (the schema's word) and may omit any section
      // it had nothing to say about. The view renders one shape only.
      const shapedAnalysis = normaliseComparisonAnalysis(data.analysis) as unknown as ComparisonAnalysis;
      setAnalysis(shapedAnalysis);
      setComparisonId(data.comparisonId);
      setProgress(100);

      // Log activity
      logActivityDirect({
        actionType: 'comparison_created',
        entityType: 'property_comparison',
        entityId: data.comparisonId,
        entityName: `${reportIds.length} Property Comparison`,
        metadata: { propertyCount: reportIds.length, analysisDepth, investorProfile, propertyAddresses }
      });

      // Add notification for completion
      addNotification({
        type: 'report_generated',
        title: 'Comparison Analysis Complete',
        message: `Successfully compared ${reportIds.length} properties. View results now.`,
        reportId: data.comparisonId
      });

      // Trigger refresh of comparisons list
      window.dispatchEvent(new CustomEvent('refreshComparisons'));

      if (background) {
        addBackgroundJob({
          id: data.comparisonId,
          type: 'comparison_analysis'
        });
        
        onClose();
      } else {
        toast({
          title: "Comparison Complete",
          description: `Successfully analyzed ${reportIds.length} properties`,
        });
      }

    } catch (error) {
      console.error('Comparison error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to compare properties';
      
      // Add error notification
      addNotification({
        type: 'report_failed',
        title: 'Comparison Analysis Failed',
        message: errorMessage
      });
      
      toast({
        title: "Analysis Failed",
        description: errorMessage,
        variant: "destructive",
      });
      
      // Reset states on error to prevent blank page
      setAnalysis(null);
      setComparisonId('');
      setHasStarted(false);
    } finally {
      clearInterval(progressTimer);
      setIsAnalyzing(false);
      setIsRecovering(false);
      setProgress(0);
    }
  };

  const loadComparisonHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('property_comparisons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      // Filter for comparisons with the exact same report IDs
      const matchingComparisons = data?.filter(comp => matchesSelectedReportIds(comp.report_ids, reportIds)) || [];

      setComparisonHistory(matchingComparisons);
    } catch (error) {
      console.error('Error loading comparison history:', error);
      toast({
        title: "Failed to Load History",
        description: "Could not load previous comparisons",
        variant: "destructive",
      });
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadHistoricalComparison = async (comparisonId: string) => {
    try {
      const { data, error } = await supabase
        .from('property_comparisons')
        .select('*')
        .eq('id', comparisonId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Comparison not found');

      // Reconstruct the analysis object from database fields
      const historicalAnalysis = analysisFromComparisonRow(data) as unknown as ComparisonAnalysis;

      setAnalysis(historicalAnalysis);
      setComparisonId(comparisonId);

      // Load settings from analysis_summary if available
      if (data.analysis_summary) {
        try {
          const summary = typeof data.analysis_summary === 'string' 
            ? JSON.parse(data.analysis_summary) 
            : data.analysis_summary;
          
          if (summary.timeHorizon) setTimeHorizon(summary.timeHorizon);
          if (summary.riskTolerance) setRiskTolerance(summary.riskTolerance);
          if (summary.customWeights && validateComparisonWeights(summary.customWeights).isValid) {
            const weights = cloneComparisonWeights(summary.customWeights);
            setDraftWeights(weights); setAppliedWeights(cloneComparisonWeights(weights));
          }
        } catch (e) {
          console.error('Error parsing analysis summary:', e);
        }
      }

      // Load other parameters
      if (data.investor_profile) setInvestorProfile(data.investor_profile);
      if (data.analysis_depth) setAnalysisDepth(data.analysis_depth);

      setHistoryOpen(false);
      toast({
        title: "Historical Analysis Loaded",
        description: `Loaded analysis from ${new Date(data.created_at).toLocaleString('en-AU')}`,
      });
    } catch (error) {
      console.error('Error loading historical comparison:', error);
      toast({
        title: "Failed to Load Analysis",
        description: error instanceof Error ? error.message : "Could not load comparison",
        variant: "destructive",
      });
    }
  };

  // Save current settings as a template
  const saveTemplate = async () => {
    if (!templateName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name for your template",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Required",
        description: "You must be logged in to save templates",
        variant: "destructive",
      });
      return;
    }

    if (hasUnappliedWeightChanges || !appliedValidation.isValid) {
      setTemplateError('Apply the scoring changes before saving this template.');
      return;
    }
    if (templateName.trim().length > 120) { setTemplateError('Template names must be 120 characters or fewer.'); return; }
    setTemplateSaving(true); setTemplateError('');
    try {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'comparison_analysis_templates',
        data: {
          name: templateName.trim(),
          description: templateDescription.trim() || null,
          settings: {
            investorProfile,
            analysisDepth,
            timeHorizon,
            riskTolerance,
            reportFamily: 'investment_comparison',
            appliedWeights: cloneComparisonWeights(appliedWeights)
          },
          created_by: user.id
        },
      });

      if (error) throw new Error(error.message);
      const inserted = data?.record;

      setSavedTemplates(prev => [inserted, ...prev]);
      setActiveTemplateId(inserted?.id ?? null); setActiveTemplateName(inserted?.name ?? templateName.trim());
      setSaveTemplateOpen(false);
      setTemplateName('');
      setTemplateDescription('');

      toast({
        title: "Template Saved",
        description: `Template "${inserted?.name}" has been saved successfully`,
      });
    } catch (error) {
      const traceId = crypto.randomUUID();
      console.error('comparison-template-save', { traceId, userId: user?.id, templateName, error });
      setTemplateError(`Could not save this template. Reference: ${traceId}`);
      toast({
        title: "Failed to Save Template",
        description: error instanceof Error ? error.message : "Could not save template",
        variant: "destructive",
      });
    } finally { setTemplateSaving(false); }
  };

  // Load a template
  const loadTemplate = (template: any) => {
    const settings = parseComparisonTemplateSettings(template.settings);
    if (!settings) { setTemplateError('This template has invalid or incompatible settings and cannot be loaded.'); return; }
    setInvestorProfile(settings.investorProfile); setAnalysisDepth(settings.analysisDepth);
    setTimeHorizon(settings.timeHorizon); setRiskTolerance(settings.riskTolerance);
    setDraftWeights(cloneComparisonWeights(settings.appliedWeights)); setAppliedWeights(cloneComparisonWeights(settings.appliedWeights));
    setActiveTemplateId(template.id); setActiveTemplateName(template.name);

    setTemplatesOpen(false);
    toast({
      title: "Template Loaded",
      description: `Settings from "${template.name}" have been applied`,
    });
  };

  // Delete a template
  const deleteTemplate = async (templateId: string) => {
    try {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'delete',
        table: 'comparison_analysis_templates',
        recordId: templateId,
      });

      if (error) throw new Error(error.message);

      setSavedTemplates(prev => prev.filter(t => t.id !== templateId));

      toast({
        title: "Template Deleted",
        description: "Template has been removed",
      });
    } catch (error) {
      console.error('Error deleting template:', error);
      toast({
        title: "Failed to Delete Template",
        description: error instanceof Error ? error.message : "Could not delete template",
        variant: "destructive",
      });
    }
  };

  // Reset settings to defaults
  const resetToDefaults = () => {
    setInvestorProfile(DEFAULT_COMPARISON_SETTINGS.investorProfile); setAnalysisDepth(DEFAULT_COMPARISON_SETTINGS.analysisDepth);
    setTimeHorizon(DEFAULT_COMPARISON_SETTINGS.timeHorizon); setRiskTolerance(DEFAULT_COMPARISON_SETTINGS.riskTolerance);
    const weights = cloneComparisonWeights(); setDraftWeights(weights); setAppliedWeights(cloneComparisonWeights(weights));
    setActiveTemplateId(null); setActiveTemplateName(null); setWeightMessage('All settings restored to defaults.');

    toast({
      title: "Settings Reset",
      description: "All settings have been reset to defaults",
    });
  };


  const copyAnalysis = () => {
    if (!analysis) return;
    
    const textContent = `
PROPERTY COMPARISON ANALYSIS
${(propertyAddresses || []).map((addr, i) => `Property ${i + 1}: ${addr}`).join('\n')}

EXECUTIVE SUMMARY
${analysis.executiveSummary || 'N/A'}

RANKINGS
${(analysis.rankings || []).map(r => `
${r.rank}. ${r.address} (Score: ${r.finalScore})
   Strengths: ${(r.primaryStrengths || []).join(', ')}
   Concerns: ${(r.primaryConcerns || []).join(', ')}
   Best for: ${r.bestSuitedFor}
`).join('\n')}

FINAL RECOMMENDATION
Best Overall: Property ${analysis.finalRecommendation?.bestOverall?.propertyNumber || 'N/A'}
Reason: ${analysis.finalRecommendation?.bestOverall?.reason || 'N/A'}
    `.trim();

    navigator.clipboard.writeText(textContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    
    toast({
      title: "Copied to Clipboard",
      description: "Comparison analysis has been copied",
    });
  };

  // Build comparison data for PDF generator.
  //
  // Memoised on the analysis identity, not rebuilt per render:
  // `ComparisonPDFGenerator` re-runs its formatting effect whenever this object
  // changes identity, and that effect is a METERED model call — a fresh object
  // every render turned every hover and toggle on this screen into another
  // billed `format-comparison-report` invocation.
  const comparisonDataForPDF = useMemo(() => {
    if (!analysis || !comparisonId) return null;
    return {
      id: comparisonId,
      property_count: reportIds.length,
      property_addresses: propertyAddresses,
      property_states: [],
      report_title: `Property Comparison Analysis - ${reportIds.length} Properties`,
      executive_summary: analysis.executiveSummary,
      rankings: analysis.rankings,
      financial_comparison: analysis.financialComparison,
      location_comparison: analysis.locationComparison,
      risk_comparison: analysis.riskComparison,
      recommendations: analysis.finalRecommendation,
      red_flags: analysis.redFlags,
      report_ids: reportIds,
      created_at: new Date().toISOString(),
    };
  }, [analysis, comparisonId, reportIds, propertyAddresses]);

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && !isAnalyzing) {
        onClose();
      }
    }}>
      <DialogContent
        overlayClassName="comparison-analysis-dialog-overlay"
        className="comparison-analysis-dialog flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 !p-0 sm:h-auto sm:max-h-[90vh] sm:w-[96vw] sm:max-w-[1440px] sm:rounded-xl sm:border lg:w-[90vw] xl:w-[80vw] 2xl:w-[min(75vw,1440px)]"
      >
        <DialogHeader className="comparison-analysis-dialog-header shrink-0 border-b bg-background px-4 py-4 pr-14 text-left sm:px-6 sm:py-5 sm:pr-16">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <TrendingUp className="h-5 w-5" />
            Multi-Property Comparison Analysis
            <Badge variant="secondary" className="font-normal">{reportIds.length} selected</Badge>
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-4xl">
            Comprehensive AI-powered qualitative comparison of {reportIds.length} compatible investment properties.
          </DialogDescription>
        </DialogHeader>

        <div className="comparison-analysis-dialog-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="flex min-h-full flex-col">{!hasStarted && !analysis && (
            <div className="flex-1 p-4 sm:p-6">
              <div className="mx-auto w-full max-w-[1320px] space-y-5">
                <section className="rounded-xl border bg-card/50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">Ready to Compare Properties</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Generate a detailed AI analysis across financial performance, location quality, risk factors, and investment potential.</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">Compatible investment reports</Badge>
                  </div>
                  <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {propertyAddresses.map((address, index) => (
                      <div key={index} className="min-w-0 rounded-lg border bg-background/60 p-3">
                        <div className="flex items-start gap-3">
                          <Badge variant="outline" className="shrink-0 rounded-full">{index + 1}</Badge>
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium leading-5">{address}</p>
                            <p className="mt-1 text-xs text-muted-foreground">Investment report · Included in this comparison</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                  {/* Analysis Settings */}
                  <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="rounded-xl border bg-card/50">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="h-auto w-full justify-between rounded-b-none px-4 py-4 sm:px-5">
                        <div className="flex items-center gap-2">
                          <Settings className="h-4 w-4" />
                          <span>Analysis Settings</span>
                          <Badge variant="secondary" className="text-xs">Optional</Badge>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 border-t px-4 py-4 sm:px-5">
                      <p className="text-xs text-muted-foreground">
                        Customize the analysis or use defaults. All settings are optional with sensible defaults applied automatically.
                      </p>
                      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(420px,1.2fr)]">
                      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="investor-profile">Investor Profile</Label>
                        <Select value={investorProfile} onValueChange={setInvestorProfile}>
                          <SelectTrigger id="investor-profile" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="general">General Investor</SelectItem>
                            <SelectItem value="first-time">First-Time Investor</SelectItem>
                            <SelectItem value="cash-flow">Cash Flow Focused</SelectItem>
                            <SelectItem value="growth">Capital Growth Focused</SelectItem>
                            <SelectItem value="balanced">Balanced Portfolio</SelectItem>
                            <SelectItem value="experienced">Experienced Investor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="analysis-depth">Analysis Depth</Label>
                        <Select value={analysisDepth} onValueChange={setAnalysisDepth}>
                          <SelectTrigger id="analysis-depth" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="quick">Quick Overview (Faster)</SelectItem>
                            <SelectItem value="standard">Standard Analysis</SelectItem>
                            <SelectItem value="comprehensive">Comprehensive (Recommended)</SelectItem>
                            <SelectItem value="deep">Deep Dive (Most Detailed)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="time-horizon">Investment Time Horizon</Label>
                        <Select value={timeHorizon} onValueChange={setTimeHorizon}>
                          <SelectTrigger id="time-horizon" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2-3 years">2-3 Years (Short-term)</SelectItem>
                            <SelectItem value="5-7 years">5-7 Years (Medium-term)</SelectItem>
                            <SelectItem value="10+ years">10+ Years (Long-term)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <Label htmlFor="risk-tolerance">Risk Tolerance</Label>
                        <Select value={riskTolerance} onValueChange={setRiskTolerance}>
                          <SelectTrigger id="risk-tolerance" className="w-full min-w-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="conservative">Conservative</SelectItem>
                            <SelectItem value="moderate">Moderate</SelectItem>
                            <SelectItem value="aggressive">Aggressive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      </div>
                      <div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-4">
                        <div className="flex items-center justify-between">
                          <Label>Custom Scoring Weights</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            aria-label="Restore default scoring weights"
                            onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDraftWeights(cloneComparisonWeights()); setWeightMessage('Default weights restored. Apply the changes to use them in this comparison.'); }}
                          >
                            Use Default
                          </Button>
                        </div>
                        <div className="space-y-4 rounded-lg border bg-background/70 p-4" aria-live="polite">
                          {(Object.entries(draftWeights) as Array<[keyof ComparisonWeights, number]>).map(([key, value]) => (
                            <div className="space-y-2" key={key}>
                              <div className="flex justify-between items-center"><Label className="text-xs" htmlFor={`weight-${key}`}>{key[0].toUpperCase() + key.slice(1)} Score</Label><span className="text-xs font-medium">{value}%</span></div>
                              <Slider id={`weight-${key}`} aria-label={`${key} score`} value={[value]} onValueChange={([next]) => setDraftWeights(prev => ({ ...prev, [key]: next }))} min={0} max={100} step={1} />
                            </div>
                          ))}
                          <div className={`pt-2 text-xs ${draftValidation.isValid ? 'text-muted-foreground' : 'text-destructive'}`}>{draftValidation.isValid ? `Total: ${draftValidation.total}%` : draftValidation.message}</div>
                          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{hasUnappliedWeightChanges ? 'Unapplied changes' : isUsingDefaults ? 'Using default weights' : 'Custom weights applied'}</span><Button type="button" size="sm" onClick={() => { if (draftValidation.isValid) { setAppliedWeights(cloneComparisonWeights(draftWeights)); setWeightMessage('Custom scoring weights applied.'); } else setWeightMessage(draftValidation.message); }} disabled={!draftValidation.isValid || !hasUnappliedWeightChanges}>Apply Weights</Button></div>
                          {weightMessage && <p className="text-xs text-muted-foreground" role="status">{weightMessage}</p>}
                        </div>
                      </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  
                  {/* Template Management */}
                  <section className="rounded-xl border bg-card/50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h4 className="font-medium">Analysis templates</h4><p className="text-xs text-muted-foreground">Save the current configuration or load a previous template.</p></div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Button
                      variant="outline"
                      onClick={() => { setTemplateError(hasUnappliedWeightChanges ? 'Apply the scoring changes before saving this template.' : ''); setSaveTemplateOpen(true); }}
                      className="w-full sm:w-auto"
                      disabled={hasUnappliedWeightChanges || !appliedValidation.isValid}
                    >
                      <Save className="h-3.5 w-3.5 mr-2" />
                      Save Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => { setTemplateError(''); setTemplatesOpen(true); }}
                      className="w-full sm:w-auto"
                    >
                      <FolderOpen className="h-3.5 w-3.5 mr-2" />
                      Load Template
                      {savedTemplates.length > 0 && (
                        <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                          {availableTemplates.length}
                        </Badge>
                      )}
                    </Button>
                  </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    {activeTemplateName && <span>Active template: {activeTemplateName}</span>}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetToDefaults}
                      className="h-7"
                    >
                      Reset All Settings
                    </Button>
                  </div>
                  </section>
              </div>
            </div>
          )}

          {isAnalyzing && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-4 w-full max-w-md">
                <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
                <h3 className="text-lg font-medium">
                  {isRecovering ? 'Still working…' : 'Analyzing Properties...'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isRecovering
                    ? 'The request is taking longer than usual. Checking whether the analysis completed in the background…'
                    : 'AI is performing comprehensive comparison across financial metrics, location quality, risk factors, and investment potential.'}
                </p>
                <div className="space-y-2">
                  <Progress value={progress} className="w-full" />
                  <p className="text-xs text-muted-foreground">{progress}% complete</p>
                </div>
              </div>
            </div>
          )}

          {analysis && !isAnalyzing && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyAnalysis} disabled={isCopied}>
                    {isCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                    {isCopied ? 'Copied' : 'Copy'}
                  </Button>
                  {comparisonDataForPDF && (
                    <>
                      {/*
                        The row is already persisted at this point — the gate above
                        requires `comparisonId` — so the server route has something
                        to read. That is a real difference from the Portfolio
                        generator, whose row is not inserted until download.
                      */}
                      <ComparisonDownloadButton comparisonId={comparisonDataForPDF.id} />
                      <ComparisonPDFGenerator comparison={comparisonDataForPDF} />
                    </>
                  )}
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => startAnalysis(false)}
                    className="bg-primary"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Re-run Analysis
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      if (comparisonHistory.length === 0) {
                        loadComparisonHistory();
                      }
                      setHistoryOpen(!historyOpen);
                    }}
                  >
                    <History className="h-4 w-4 mr-2" />
                    History ({comparisonHistory.length})
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>

              {/* Current Settings Display */}
              <Card className="mb-4">
                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Settings className="h-4 w-4" />
                          <CardTitle className="text-sm">Analysis Settings</CardTitle>
                          <Badge variant="outline" className="text-xs">Optional</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <Badge variant="secondary" className="text-xs">{investorProfile}</Badge>
                            <Badge variant="secondary" className="text-xs">{timeHorizon}</Badge>
                            <Badge variant="secondary" className="text-xs">{riskTolerance}</Badge>
                          </div>
                          <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-4 pt-0">
                      <p className="text-xs text-muted-foreground">
                        Adjust settings and re-run to see how different parameters affect the analysis. Changes are optional.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="investor-profile-result">Investor Profile</Label>
                          <Select value={investorProfile} onValueChange={setInvestorProfile}>
                            <SelectTrigger id="investor-profile-result">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">General Investor</SelectItem>
                              <SelectItem value="first-time">First-Time Investor</SelectItem>
                              <SelectItem value="cash-flow">Cash Flow Focused</SelectItem>
                              <SelectItem value="growth">Capital Growth Focused</SelectItem>
                              <SelectItem value="balanced">Balanced Portfolio</SelectItem>
                              <SelectItem value="experienced">Experienced Investor</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="analysis-depth-result">Analysis Depth</Label>
                          <Select value={analysisDepth} onValueChange={setAnalysisDepth}>
                            <SelectTrigger id="analysis-depth-result">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="quick">Quick Overview</SelectItem>
                              <SelectItem value="standard">Standard Analysis</SelectItem>
                              <SelectItem value="comprehensive">Comprehensive</SelectItem>
                              <SelectItem value="deep">Deep Dive</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="time-horizon-result">Time Horizon</Label>
                          <Select value={timeHorizon} onValueChange={setTimeHorizon}>
                            <SelectTrigger id="time-horizon-result">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2-3 years">2-3 Years</SelectItem>
                              <SelectItem value="5-7 years">5-7 Years</SelectItem>
                              <SelectItem value="10+ years">10+ Years</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="risk-tolerance-result">Risk Tolerance</Label>
                          <Select value={riskTolerance} onValueChange={setRiskTolerance}>
                            <SelectTrigger id="risk-tolerance-result">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="conservative">Conservative</SelectItem>
                              <SelectItem value="moderate">Moderate</SelectItem>
                              <SelectItem value="aggressive">Aggressive</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Custom Scoring Weights</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setUseCustomWeights()}
                          >
                            {useCustomWeights ? 'Use Default' : 'Customize'}
                          </Button>
                        </div>
                        
                        {useCustomWeights && (
                          <div className="space-y-3 p-3 border rounded-lg bg-muted/50">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Growth</Label>
                                  <span className="text-xs font-medium">{customWeights.growth}%</span>
                                </div>
                                <Slider
                                  value={[customWeights.growth]}
                                  onValueChange={([value]) => setCustomWeights(prev => ({ ...prev, growth: value }))}
                                  min={0}
                                  max={50}
                                  step={5}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Location</Label>
                                  <span className="text-xs font-medium">{customWeights.location}%</span>
                                </div>
                                <Slider
                                  value={[customWeights.location]}
                                  onValueChange={([value]) => setCustomWeights(prev => ({ ...prev, location: value }))}
                                  min={0}
                                  max={50}
                                  step={5}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Yield</Label>
                                  <span className="text-xs font-medium">{customWeights.yield}%</span>
                                </div>
                                <Slider
                                  value={[customWeights.yield]}
                                  onValueChange={([value]) => setCustomWeights(prev => ({ ...prev, yield: value }))}
                                  min={0}
                                  max={50}
                                  step={5}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Demand</Label>
                                  <span className="text-xs font-medium">{customWeights.demand}%</span>
                                </div>
                                <Slider
                                  value={[customWeights.demand]}
                                  onValueChange={([value]) => setCustomWeights(prev => ({ ...prev, demand: value }))}
                                  min={0}
                                  max={30}
                                  step={5}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <Label className="text-xs">Risk</Label>
                                  <span className="text-xs font-medium">{customWeights.risk}%</span>
                                </div>
                                <Slider
                                  value={[customWeights.risk]}
                                  onValueChange={([value]) => setCustomWeights(prev => ({ ...prev, risk: value }))}
                                  min={0}
                                  max={30}
                                  step={5}
                                />
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Total: {customWeights.growth + customWeights.location + customWeights.yield + customWeights.demand + customWeights.risk}%
                              {(customWeights.growth + customWeights.location + customWeights.yield + customWeights.demand + customWeights.risk) !== 100 && (
                                <span className="text-destructive ml-1">(Must equal 100%)</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>

              {/* Comparison History Panel */}
              {historyOpen && (
                <Card className="mb-4">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <History className="h-4 w-4" />
                        <CardTitle className="text-sm">Comparison History</CardTitle>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>
                        Close
                      </Button>
                    </div>
                    <CardDescription>
                      Previous analyses for these properties with different parameters
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingHistory ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : comparisonHistory.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p className="text-sm">No previous comparisons found for these properties.</p>
                        <p className="text-xs mt-1">Run analysis with different settings to build history.</p>
                      </div>
                    ) : (
                      <ScrollArea className="h-[300px]">
                        <div className="space-y-2 pr-4">
                          {comparisonHistory.map((comp) => {
                            const isCurrentAnalysis = comp.id === comparisonId;
                            const createdDate = new Date(comp.created_at);
                            let summaryData = null;
                            try {
                              summaryData = comp.analysis_summary 
                                ? (typeof comp.analysis_summary === 'string' 
                                    ? JSON.parse(comp.analysis_summary) 
                                    : comp.analysis_summary)
                                : null;
                            } catch (e) {
                              // Ignore parsing errors
                            }

                            return (
                              <Card 
                                key={comp.id} 
                                className={`cursor-pointer transition-colors ${
                                  isCurrentAnalysis 
                                    ? 'border-primary bg-primary/5' 
                                    : 'hover:bg-muted/50'
                                }`}
                                onClick={() => !isCurrentAnalysis && loadHistoricalComparison(comp.id)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Clock className="h-3 w-3 text-muted-foreground" />
                                        <span className="text-xs font-medium">
                                          {createdDate.toLocaleDateString('en-AU')} at {createdDate.toLocaleTimeString('en-AU')}
                                        </span>
                                        {isCurrentAnalysis && (
                                          <Badge variant="default" className="text-xs">Current</Badge>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {comp.investor_profile && (
                                          <Badge variant="outline" className="text-xs">
                                            {comp.investor_profile}
                                          </Badge>
                                        )}
                                        {comp.analysis_depth && (
                                          <Badge variant="outline" className="text-xs">
                                            {comp.analysis_depth}
                                          </Badge>
                                        )}
                                        {summaryData?.timeHorizon && (
                                          <Badge variant="outline" className="text-xs">
                                            {summaryData.timeHorizon}
                                          </Badge>
                                        )}
                                        {summaryData?.riskTolerance && (
                                          <Badge variant="outline" className="text-xs">
                                            {summaryData.riskTolerance} risk
                                          </Badge>
                                        )}
                                        {summaryData?.customWeights && (
                                          <Badge variant="secondary" className="text-xs">
                                            Custom weights
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    {!isCurrentAnalysis && (
                                      <Button variant="ghost" size="sm">
                                        Load
                                      </Button>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              )}

              {/*
                The SAME results content the library viewer shows — one panel,
                two surfaces, so the person who watches an analysis finish and
                the person who opens it later from Generated Reports read the
                identical document. Only the chrome around it differs.
              */}
              <ComparisonResultsPanel analysis={analysis} />
            </div>
          )}
          </div>
        </div>
        {!hasStarted && !analysis && (
          <div className="comparison-analysis-dialog-footer shrink-0 border-t bg-background px-4 py-3 sm:px-6">
            <div className="mx-auto flex w-full max-w-[1320px] flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose} className="sm:w-auto">Cancel</Button>
              <Button
                onClick={() => startAnalysis(true)}
                variant="outline"
                className="sm:w-auto"
                disabled={isAnalyzing || hasUnappliedWeightChanges || !appliedValidation.isValid}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                Run in Background
              </Button>
              <Button
                onClick={() => startAnalysis(false)}
                className="sm:w-auto"
                disabled={isAnalyzing || hasUnappliedWeightChanges || !appliedValidation.isValid}
              >
                Start Analysis
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Save Template Dialog */}
    <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
      <DialogContent className="!z-[60]" overlayClassName="!z-[55]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-5 w-5" />
            Save Analysis Template
          </DialogTitle>
          <DialogDescription>
            Save your current analysis settings as a reusable template
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template Name *</Label>
            <Input
              id="template-name"
              placeholder="e.g., Growth Focused Analysis"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-description">Description (Optional)</Label>
            <Textarea
              id="template-description"
              placeholder="Describe when to use this template..."
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              rows={3}
            />
          </div>
          
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <p className="text-sm font-medium">Current Settings:</p>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>• Investor Profile: <span className="text-foreground font-medium">{investorProfile}</span></div>
              <div>• Analysis Depth: <span className="text-foreground font-medium">{analysisDepth}</span></div>
              <div>• Time Horizon: <span className="text-foreground font-medium">{timeHorizon}</span></div>
              <div>• Risk Tolerance: <span className="text-foreground font-medium">{riskTolerance}</span></div>
              <div>• Weights: <span className="text-foreground font-medium">Growth {appliedWeights.growth}% · Location {appliedWeights.location}% · Yield {appliedWeights.yield}% · Demand {appliedWeights.demand}% · Risk {appliedWeights.risk}% (Total {appliedValidation.total}%)</span></div>
            </div>
          </div>
          {templateError && <p className="text-sm text-destructive" role="alert">{templateError}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setSaveTemplateOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveTemplate} className="flex-1" disabled={templateSaving || !templateName.trim() || hasUnappliedWeightChanges || !appliedValidation.isValid}>
              <Save className="h-4 w-4 mr-2" />
              {templateSaving ? 'Saving…' : 'Save Template'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Load Templates Dialog */}
    <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
      <DialogContent className="!z-[60] max-w-2xl" overlayClassName="!z-[55]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Load Analysis Template
          </DialogTitle>
          <DialogDescription>
            {templatesLoading ? 'Fetching compatible templates…' : `${availableTemplates.length} saved template${availableTemplates.length === 1 ? '' : 's'} available for this comparison.`}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {templatesLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : availableTemplates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookmarkPlus className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No saved templates yet</p>
              <p className="text-xs mt-1">Create your first template from the analysis settings</p>
            </div>
          ) : (
            <div className="space-y-3 pr-4">
              {availableTemplates.map((template) => (
                <Card key={template.id} className="hover:bg-muted/50 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base">{template.name}</CardTitle>
                        {template.description && (
                          <CardDescription className="mt-1 text-xs">
                            {template.description}
                          </CardDescription>
                        )}
                        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>Created {new Date(template.created_at).toLocaleDateString('en-AU')}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTemplate(template.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {template.settings.investorProfile}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {template.settings.analysisDepth}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {template.settings.timeHorizon}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          Risk: {template.settings.riskTolerance}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{parseComparisonTemplateSettings(template.settings) ? 'Compatible' : 'Invalid template'}</Badge>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => loadTemplate(template)}
                        disabled={!parseComparisonTemplateSettings(template.settings)}
                        className="w-full"
                      >
                        Load Template
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
    </>
  );
}

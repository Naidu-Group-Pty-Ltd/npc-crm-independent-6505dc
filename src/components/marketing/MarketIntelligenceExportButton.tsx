import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { FileText, Loader2, History, Settings2, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { logReportRenderEvent } from '@/lib/reports/renderEvent';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { generateMarketIntelligencePDF, type MarketIntelligenceReportData } from './MarketIntelligencePDFGenerator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MarketIntelligenceHistoryModal } from './MarketIntelligenceHistoryModal';
import { MarketIntelligenceDownloadButton } from './MarketIntelligenceDownloadButton';
import { ReportGenerationStatus } from '@/components/billing/ReportGenerationStatus';
import { TokenCostEstimate } from '@/components/billing/TokenCostEstimate';
import { estimateTokens } from '@/lib/missionControl';

interface MarketIntelligenceExportButtonProps {
  reportType?: 'full' | 'market_pulse' | 'hotspot_deep_dive' | 'strategy_insight' | 'finance_update' | 'deal_breakdown' | 'myth_busting' | 'development_spotlight';
  reportContext?: 'default' | 'market_correlation';
  correlationData?: {
    aiAnalysis?: string;
    perplexityResearch?: string;
    citations?: string[];
  };
}

type GenerationState =
  | { status: 'idle' }
  | {
    status: 'success';
    fileName: string;
    /**
     * The generated payload, kept so the legacy layout can be drawn on
     * demand. Generating no longer draws it automatically: the typeset
     * document is the primary road and the jsPDF layout is a named choice
     * behind it, per the legacy-consolidation phase.
     */
    reportData: MarketIntelligenceReportData;
    /**
     * The row the generator wrote, so the typeset render can be offered here.
     *
     * The legacy path never needed it — it typesets the payload it already has
     * in memory — which is why it was thrown away, and why the correlation
     * block could never survive to the History modal.
     */
    reportId: string | null;
    audienceSegment: string;
  }
  | { status: 'error'; message: string };

export function MarketIntelligenceExportButton({ reportType = 'full', reportContext = 'default', correlationData }: MarketIntelligenceExportButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [includeAdvisoryStrategy, setIncludeAdvisoryStrategy] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [generationState, setGenerationState] = useState<GenerationState>({ status: 'idle' });
  const [isDrawingLegacy, setIsDrawingLegacy] = useState(false);

  const handleGenerate = async () => {
    setGenerationState({ status: 'idle' });
    setIsGenerating(true);
    setProgress('Fetching live market data...');
    const toastId = toast.loading('Generating Market Intelligence Report...', {
      description: 'Pulling live data from 6 sources — this can take up to 2-3 minutes.',
    });

    try {
      setProgress('Analysing RBA, housing, sentiment & economic data...');

      const { runPreflight } = await import('@/lib/preflightTokens');
      const ok = await runPreflight({
        kind: 'report.market-intelligence',
        functionName: 'generate-market-intelligence-report',
        label: 'Market intelligence report',
        estimate: { aiNarrative: true, extraSections: reportType === 'full' ? 2 : 0 },
      });
      if (!ok) {
        toast.dismiss(toastId);
        setIsGenerating(false);
        setGenerationState({ status: 'idle' });
        return;
      }

      const { data, error } = await invokeSecureFunction('generate-market-intelligence-report', {
        report_type: reportType,
        audience_segment: 'general',
        include_advisory_strategy: includeAdvisoryStrategy,
        // Persisted from here on. This panel has always had the correlation
        // block and only ever handed it to the in-browser generator, so it
        // never reached the row — which is why re-downloading a correlation
        // report from the History modal has always silently dropped that whole
        // section. Zero of the six stored reports carry one.
        correlation_data: correlationData,
      }, {
        // Six live sources plus an AI narrative regularly outlive the 60s
        // default; the client aborting at 60s is what "Request timed out"
        // reported while the function was still working.
        timeoutMs: 180_000,
      });

      if (error) throw new Error(error.message || 'Failed to generate report data');
      if (!data?.reportData) throw new Error('No report data returned');

      const reportData: MarketIntelligenceReportData = data.reportData;

      // Generation stops here. The typeset document is the primary download
      // and the legacy jsPDF layout is drawn only when chosen — generating
      // used to build and auto-save the legacy PDF, which made the browser
      // engine the default road nobody picked.
      const fileName = `Market_Intelligence_Report_${reportData.reportPeriod.replace(/\s+/g, '_')}.pdf`;
      setGenerationState({
        status: 'success',
        fileName,
        reportData,
        reportId: typeof data.reportId === 'string' ? data.reportId : null,
        audienceSegment: 'general',
      });

      toast.success('Market Intelligence Report generated!', {
        id: toastId,
        description: `${reportData.reportPeriod} — choose a download below.`,
      });
    } catch (err) {
      console.error('Market Intelligence Report generation failed:', err);
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setGenerationState({ status: 'error', message });
      toast.error('Report generation failed', {
        id: toastId,
        description: message,
      });
    } finally {
      setIsGenerating(false);
      setProgress('');
    }
  };

  /** The legacy jsPDF document, drawn from the payload kept at generation. */
  const buildLegacyBlob = (state: Extract<GenerationState, { status: 'success' }>) =>
    generateMarketIntelligencePDF({
      ...state.reportData,
      reportContext,
      correlationData,
    });

  const downloadLegacyLayout = async (state: Extract<GenerationState, { status: 'success' }>) => {
    setIsDrawingLegacy(true);
    try {
      const pdfBlob = await buildLegacyBlob(state);
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = state.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logReportRenderEvent({ format: 'market_intelligence', engine: 'browser', source: 'market_intelligence_jspdf', reportId: state.reportId ?? undefined });
    } catch (err) {
      toast.error('Legacy layout failed', {
        description: err instanceof Error ? err.message : 'Could not draw the legacy PDF.',
      });
    } finally {
      setIsDrawingLegacy(false);
    }
  };

  const miEstimate = estimateTokens('report.market-intelligence', {
    aiNarrative: true,
    extraSections: reportType === 'full' ? 2 : 0,
  });

  return (
    <div className="space-y-2">
      <ReportGenerationStatus estimate={miEstimate} />
      <div className="flex items-center gap-1.5">
        <Button
          onClick={handleGenerate}
          disabled={isGenerating}
          variant="outline"
          size="sm"
          className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">{progress || 'Generating...'}</span>
            </>
          ) : (
            <>
              <FileText className="h-3.5 w-3.5" />
              <span className="text-xs">Generate Report</span>
            </>
          )}
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isGenerating}>
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="space-y-3">
              <p className="text-sm font-medium">Report Options</p>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="npc-strategy-toggle" className="text-xs leading-tight cursor-pointer">
                  Include Strategic Advisory Approach
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    Proprietary methodology section
                  </span>
                </Label>
                <Switch
                  id="advisory-strategy-toggle"
                  checked={includeAdvisoryStrategy}
                  onCheckedChange={setIncludeAdvisoryStrategy}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Icon-only, so the name is declared: an unnamed button is one a
            screen reader announces as "button" and an automated journey
            cannot find at all (found by the RS-5c.5 format journey). */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setHistoryOpen(true)}
          aria-label="Market intelligence report history"
          title="Report history"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <TokenCostEstimate estimate={miEstimate} compact className="ml-1" />
      </div>

      {generationState.status === 'success' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Report generated successfully</p>
              <p className="truncate text-[11px] text-muted-foreground">{generationState.fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* The typeset document leads; the jsPDF layout is a named choice
                behind it, never a silent substitute — the two produce
                different documents, so which one somebody gets stays chosen. */}
            {generationState.reportId && (
              <MarketIntelligenceDownloadButton
                reportId={generationState.reportId}
                audienceSegment={generationState.audienceSegment}
                variant="default"
                label="Download PDF"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              disabled={isDrawingLegacy}
              onClick={() => downloadLegacyLayout(generationState)}
            >
              {isDrawingLegacy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              Download (legacy layout)
            </Button>
            <FlattenPdfIconButton
              getPdfBlob={() => buildLegacyBlob(generationState)}
              filename={generationState.fileName}
              size="sm"
            />
          </div>
        </div>
      )}

      {generationState.status === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-xs font-medium text-foreground">Report generation failed</p>
            <p className="text-[11px] text-muted-foreground">{generationState.message}</p>
          </div>
        </div>
      )}

      <MarketIntelligenceHistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

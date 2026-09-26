import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { reportGeneratedAt } from '@/lib/reports/investment/reportGeneratedAt.pure';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PixelPerfectPDFGeneratorHandle } from '@/components/reports/PixelPerfectPDFGenerator';
import { InvestmentReportEditor } from '@/components/reports/InvestmentReportEditor';
import { ManualDataOverrideModal } from '@/components/reports/ManualDataOverrideModal';
import { SendToClientModal } from '@/components/reports/SendToClientModal';
import { HeroImageStudio } from '@/components/reports/HeroImageStudio';
import { ReportVersionHistory } from '@/components/reports/ReportVersionHistory';
import { DEFAULT_PDF_DESIGN_OPTIONS, type PdfDesignOptions } from '@/components/reports/premiumPdfDesign';
import { InvestmentReportCommandHeader } from '@/components/reports/report-view/InvestmentReportCommandHeader';
import { InvestmentReportCoverageNote } from '@/components/reports/report-view/InvestmentReportCoverageNote';
import { InvestmentReportDocument } from '@/components/reports/report-view/InvestmentReportDocument';
import { InvestmentReportErrorState } from '@/components/reports/report-view/InvestmentReportErrorState';
import { InvestmentReportExportPanel } from '@/components/reports/report-view/InvestmentReportExportPanel';
import { InvestmentReportHero } from '@/components/reports/report-view/InvestmentReportHero';
import { InvestmentReportLoadingState } from '@/components/reports/report-view/InvestmentReportLoadingState';
import { InvestmentReportMobileActionBar } from '@/components/reports/report-view/InvestmentReportMobileActionBar';
import { InvestmentReportOverridePanel } from '@/components/reports/report-view/InvestmentReportOverridePanel';
import type { ClientInfo, InvestmentReport } from '@/components/reports/report-view/types';
import { getHasOverrides, getOverriddenFields, getReportStatusLabel, getReportTierLabel, getReportVariantLabel } from '@/components/reports/report-view/utils';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { deliverInvestmentPdf, publishInvestmentPdf } from '@/lib/reports/investment/deliverInvestmentPdf';
import { readReportAudience, type ReportAudience } from '@/lib/reports/investment/audienceContent.pure';
import { InvestmentReportFamilyNotice } from '@/components/reports/report-view/InvestmentReportFamilyNotice';
import { fetchReportFamily, type ReportFamily } from '@/lib/reports/subReports';
import { toast } from 'sonner';
import {
  CASH_FLOW_ANALYSIS_BACK_LABEL,
  CASH_FLOW_ANALYSIS_PATH,
  cameFromCashFlowAnalysis,
  navigateBackToCashFlowAnalysis,
} from '@/lib/navigation/cashFlowOrigin';

/** Where this browser remembers who a report's client document is written for. */
const audienceStorageKey = (reportId: string) => `investment-report-audience:${reportId}`;

/** What this browser remembered for a report, or the investor where it cannot say. */
function rememberedAudience(reportId: string | undefined): ReportAudience {
  if (!reportId) return 'investor';
  try {
    return readReportAudience(window.localStorage.getItem(audienceStorageKey(reportId)));
  } catch {
    return 'investor';
  }
}

export default function InvestmentReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Set when this report was opened by drilling in from the Cash Flow
  // Analysis property list. The way back is then a named route rather than a
  // browser step, so it is right after a refresh or a middle-click too.
  const fromCashFlowAnalysis = cameFromCashFlowAnalysis(location);
  const [report, setReport] = useState<InvestmentReport | null>(null);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [family, setFamily] = useState<ReportFamily | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [sendToClientOpen, setSendToClientOpen] = useState(false);
  const [heroDialogOpen, setHeroDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [includeSources, setIncludeSources] = useState(true);
  const [includeScoring, setIncludeScoring] = useState(true);
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeHeroImages, setIncludeHeroImages] = useState(false);
  const [includeSparklines, setIncludeSparklines] = useState(true);
  const [pdfDesignOptions, setPdfDesignOptions] = useState<PdfDesignOptions>(DEFAULT_PDF_DESIGN_OPTIONS);
  const [showOverrides, setShowOverrides] = useState(true);
  /*
   * Who the client document is written for — investor, owner-occupier or
   * both. Remembered per report in this browser, because it describes the
   * CLIENT the report is for rather than a passing view preference: an
   * adviser who chose owner-occupier for this report should not have to
   * choose it again before the next send. Storage that cannot be read or
   * written falls back to the investor document, which is what every report
   * was before the choice existed.
   */
  // Read during render rather than copied into state by an effect: the choice
  // made on this visit wins, then what this browser remembered for the report.
  const [chosenAudience, setChosenAudience] = useState<Record<string, ReportAudience>>({});
  const audience: ReportAudience = (id && chosenAudience[id]) || rememberedAudience(id);
  const handleAudienceChange = (next: ReportAudience) => {
    if (!id) return;
    setChosenAudience((prev) => ({ ...prev, [id]: next }));
    try {
      window.localStorage.setItem(audienceStorageKey(id), next);
    } catch {
      // A private window or blocked storage: the choice holds for this visit.
    }
  };

  const isClientReport = report?.is_client_report === true;

  useEffect(() => {
    if (!id) {
      setError('No report ID provided');
      setLoading(false);
      return;
    }

    const fetchReport = async () => {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await invokeSecureFunction('get-investment-reports', {
        reportId: id,
        listOptions: {
        select: 'id, property_address, property_listing_id, report_content, sources_content, created_at, status, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence, is_client_report, client_property_id, current_version, report_tier, report_variant, derived_from_report_id, parent_report_id, pdf_url, data_sources, validation_flags'
        }
      });

      if (fetchError) {
        console.error('Error fetching report:', fetchError);
        setError('Failed to load the report. Please try again.');
        setLoading(false);
        return;
      }

      if (!data?.report) {
        setError('Report not found.');
        setLoading(false);
        return;
      }

      const reportData = data.report;
      setReport(reportData as InvestmentReport);

      // The Compass family, with per-child staleness derived server-side —
      // feeds the "parent has changed" notice and never blocks the page.
      fetchReportFamily(id).then(setFamily).catch(() => setFamily(null));

      // If it's a client report, fetch the client info for back navigation
      if (reportData.is_client_report && reportData.client_property_id) {
        const { data: clientData } = await invokeSecureFunction('manage-client-data', {
          operation: 'getClientProperty',
          clientPropertyId: reportData.client_property_id
        });

        if (clientData?.property?.clients) {
          const client = clientData.property.clients as unknown as ClientInfo;
          setClientInfo(client);
        }
      }

      setLoading(false);
      
      // Log report viewed
      logActivityDirect({
        actionType: 'report_viewed',
        entityType: 'investment_report',
        entityId: id,
        entityName: reportData.property_address,
        metadata: { source: 'investment_report_view', isClientReport: reportData.is_client_report }
      });
    };

    fetchReport();
  }, [id]);

  const handleReportUpdate = async () => {
    if (!id) return;

    const { data } = await invokeSecureFunction('get-investment-reports', {
      reportId: id,
      listOptions: {
        select: 'id, property_address, property_listing_id, report_content, sources_content, created_at, status, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence, is_client_report, client_property_id, current_version, report_tier, report_variant, derived_from_report_id, parent_report_id, pdf_url, data_sources, validation_flags'
      }
    });

    if (data?.report) {
      setReport(data.report as InvestmentReport);
    }
  };

  /**
   * The page's PRIMARY action delivers the DOCUMENT — the person's chosen
   * template first, the legacy server render as the fallback — the same
   * chain every other surface (send, premium button) now uses. It saved the
   * markdown as a `.txt` for the life of this page (audit F11) while the
   * real PDF sat lower in a collapsible panel.
   */
  const [downloadBusy, setDownloadBusy] = useState(false);
  const handleDownload = async () => {
    if (!report || downloadBusy) return;
    setDownloadBusy(true);
    try {
      // Every control, every time. This passed three of them and left
      // Sources and Scoring to their defaults, so the page's primary button
      // ignored two of the switches drawn beside it while the panel's
      // "Generate Client PDF" honoured all five — two documents from one
      // screen, depending on which button was pressed. The audience rides
      // with them for the same reason.
      await deliverInvestmentPdf(report.id, {
        variant: report.report_variant ?? null,
        includeSources,
        includeScoring,
        includeCharts,
        includeHeroImages,
        includeSparklines,
        audience,
        designOptions: pdfDesignOptions,
      });
    } catch (err) {
      toast.error('The report PDF could not be produced', {
        description: err instanceof Error ? err.message : 'Try the export panel, or retry shortly.',
      });
    } finally {
      setDownloadBusy(false);
    }
  };

  /** The raw markdown, for the panel's explicitly-labelled text export. */
  const handleExportText = () => {
    if (!report) return;
    let content = report.report_content;
    if (includeSources && report.sources_content) {
      content += report.sources_content;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `investment-report-${report.property_address.replace(/[^a-zA-Z0-9]/g, '-')}-${format(new Date(reportGeneratedAt(report)?.at ?? report.created_at), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasOverrides = useMemo(() => getHasOverrides(report), [report]);
  const reportTierLabel = useMemo(() => getReportTierLabel(report), [report]);
  const reportVariantLabel = useMemo(() => getReportVariantLabel(report), [report]);
  const reportStatusLabel = useMemo(() => getReportStatusLabel(report), [report]);
  const overriddenFields = useMemo(() => getOverriddenFields(report), [report]);

  if (loading) {
    return <InvestmentReportLoadingState />;
  }

  if (error || !report) {
    return (
      <InvestmentReportErrorState
        error={error}
        onBack={() => (fromCashFlowAnalysis ? navigateBackToCashFlowAnalysis(navigate, location) : navigate(-1))}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <InvestmentReportCommandHeader
        report={report}
        clientInfo={clientInfo}
        isClientReport={isClientReport}
        onBack={() => (fromCashFlowAnalysis ? navigateBackToCashFlowAnalysis(navigate, location) : navigate(-1))}
        backLabel={fromCashFlowAnalysis ? CASH_FLOW_ANALYSIS_BACK_LABEL : undefined}
        onReportsHome={() => navigate('/generated-reports')}
        onBackToClient={() => navigate('/clients')}
        onNavigateToReport={(rid) => navigate(`/investment-report/${rid}`)}
        onSendToClient={() => setSendToClientOpen(true)}
        onCashFlow={() => navigate(`${CASH_FLOW_ANALYSIS_PATH}/${report.id}`)}
        onEdit={() => setEditorOpen(true)}
        onOverride={() => setOverrideModalOpen(true)}
        onManageHeroImages={() => setHeroDialogOpen(true)}
        onOpenVersionHistory={() => setVersionHistoryOpen(true)}
        onDownload={handleDownload}
        downloadBusy={downloadBusy}
        onExportText={handleExportText}
      />

      {/* Main content */}
      <div className="flex-1 overflow-auto overflow-x-hidden bg-muted/20">
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 pb-24 lg:p-6">
          <InvestmentReportHero
            report={report}
            isClientReport={isClientReport}
            hasOverrides={hasOverrides}
            reportTierLabel={reportTierLabel}
            reportVariantLabel={reportVariantLabel}
            reportStatusLabel={reportStatusLabel}
          />

          <InvestmentReportFamilyNotice
            family={family}
            currentReportId={report.id}
            onRefreshed={async () => {
              await handleReportUpdate();
              const refreshed = await fetchReportFamily(report.id);
              setFamily(refreshed);
            }}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <main className="min-w-0 order-1">
              {/* The document card's own button says "Raw text" and means it. */}
              <InvestmentReportDocument
                report={report}
                includeSources={includeSources}
                onDownload={handleExportText}
              />
            </main>

            <aside className="order-2 min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
              <InvestmentReportExportPanel
                report={report}
                includeSources={includeSources}
                includeScoring={includeScoring}
                includeCharts={includeCharts}
                includeHeroImages={includeHeroImages}
                includeSparklines={includeSparklines}
                audience={audience}
                pdfDesignOptions={pdfDesignOptions}
                onIncludeSourcesChange={setIncludeSources}
                onIncludeScoringChange={setIncludeScoring}
                onIncludeChartsChange={setIncludeCharts}
                onIncludeHeroImagesChange={setIncludeHeroImages}
                onIncludeSparklinesChange={setIncludeSparklines}
                onAudienceChange={handleAudienceChange}
                onPdfDesignOptionsChange={setPdfDesignOptions}
                onHeroImagesManage={() => setHeroDialogOpen(true)}
                onRegenerated={handleReportUpdate}
                onDownload={handleExportText}
              />

              <InvestmentReportCoverageNote
                dataSources={report.data_sources}
                validationFlags={report.validation_flags}
              />

              {hasOverrides && (
                <InvestmentReportOverridePanel
                  overriddenFields={overriddenFields}
                  showOverrides={showOverrides}
                  onShowOverridesChange={setShowOverrides}
                />
              )}
            </aside>
          </div>
        </div>
      </div>

      <InvestmentReportMobileActionBar
        onDownload={handleDownload}
        downloadBusy={downloadBusy}
        onSendToClient={() => setSendToClientOpen(true)}
        onCashFlow={() => navigate(`${CASH_FLOW_ANALYSIS_PATH}/${report.id}`)}
        onEdit={() => setEditorOpen(true)}
        onOverride={() => setOverrideModalOpen(true)}
        onManageHeroImages={() => setHeroDialogOpen(true)}
      />

      {/* Editor Modal */}
      <InvestmentReportEditor
        report={report}
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={(updatedReport) => {
          // Immutably update state so PDF generator receives fresh data
          setReport(updatedReport);
        }}
      />

      {/* Override Modal */}
      <ManualDataOverrideModal
        report={report}
        isOpen={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        onSave={handleReportUpdate}
      />

      {/* Send to Client Modal */}
      {/*
        A send PRODUCES the document rather than shipping whatever pdf_url
        held (audit F12: the stored path was written by the legacy route or
        the browser raster, whichever ran last — so a client could receive a
        document the operator never saw). The same template-first chain as
        the primary download; the browser generator survives only as the
        last resort when both engines fail.
      */}
      <SendToClientModal
        isOpen={sendToClientOpen}
        onClose={() => setSendToClientOpen(false)}
        reportId={report.id}
        reportTitle={report.property_address}
        reportTier={report.report_tier || undefined}
        storagePath={null}
        /*
         * The same contract the download button asks, with the same
         * controls, the audience among them. There used to be a second generator behind this on
         * failure — a different document, drawn from a different projection
         * and honouring a different half of the switches — so a send that
         * fell back delivered something the operator had never seen. The one
         * contract already falls back from a chosen template to the standard
         * presentation; a failure past that is a failure worth surfacing.
         */
        onGeneratePDF={async () => {
          const published = await publishInvestmentPdf(report.id, {
            variant: report.report_variant ?? null,
            includeSources,
            includeScoring,
            includeCharts,
            includeHeroImages,
            includeSparklines,
            audience,
            designOptions: pdfDesignOptions,
          });
          setReport((prev) => prev ? { ...prev, pdf_url: published.path } : prev);
          return published.path;
        }}
      />

      <ReportVersionHistory
        reportId={report.id}
        currentVersion={report.current_version || 1}
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        onVersionRestored={handleReportUpdate}
      />

      {/* Hero Image Studio */}
      <HeroImageStudio
        reportId={report.id}
        open={heroDialogOpen}
        onOpenChange={setHeroDialogOpen}
      />
    </div>
  );
}

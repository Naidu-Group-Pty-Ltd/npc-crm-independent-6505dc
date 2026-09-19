import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Download, Copy, Check, Eye, X, PanelTopClose } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';
import jsPDF from 'jspdf';
import { deliverInvestmentPdf, produceInvestmentDocument } from '@/lib/reports/investment/deliverInvestmentPdf';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { INVESTMENT_REPORT_FORMAT } from '@/lib/reportTemplate/reportFormats';
import { ReportGenerationStatus } from '@/components/billing/ReportGenerationStatus';
import { TokenCostEstimate } from '@/components/billing/TokenCostEstimate';
import { estimateTokens } from '@/lib/missionControl';

interface InvestmentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyAddress: string;
  propertyDetails?: any;
}

export function InvestmentReportModal({ 
  isOpen, 
  onClose, 
  propertyAddress, 
  propertyDetails 
}: InvestmentReportModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportContent, setReportContent] = useState<string>('');
  const [sourcesContent, setSourcesContent] = useState<string>('');
  const [reportId, setReportId] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [hasStartedGeneration, setHasStartedGeneration] = useState(false);
  const [enhancedData, setEnhancedData] = useState<any>(null);
  const [isBackgroundGeneration, setIsBackgroundGeneration] = useState(false);
  const generationLockRef = useRef(false);
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();

  const generateReport = async (runInBackground = false) => {
    // Guard against double-clicks and concurrent generation using both state and ref lock
    if (isGenerating || generationLockRef.current) return;
    generationLockRef.current = true;
    setIsGenerating(true);
    setHasStartedGeneration(true);
    
    // Save a preliminary 'processing' record so the floating progress tracker can see it
    let preliminaryReportId: string | null = null;
    if (user) {
      try {
        const { data: insertResult, error: insertError } = await invokeSecureFunction('manage-investment-reports', {
          action: 'insert',
          data: {
            property_address: propertyAddress,
            property_listing_id: propertyDetails?.id || null,
            report_content: '',
            sources_content: '',
            generated_by: user.id,
            status: 'processing',
          },
        });
        if (!insertError && insertResult?.success && insertResult.report) {
          preliminaryReportId = insertResult.report.id;
          setReportId(insertResult.report.id);
          console.log('Created preliminary report record:', insertResult.report.id);
        }
      } catch (e) {
        console.error('Failed to create preliminary report record:', e);
      }
    }

    if (runInBackground) {
      setIsBackgroundGeneration(true);
      toast({
        title: "Generating in Background",
        description: "Report generation started. You'll be notified when complete.",
      });
      // Close modal if running in background
      handleClose();
    }
    
    try {
      console.log('Calling generate-investment-report with:', { propertyAddress, propertyDetails });

      const { runPreflight } = await import('@/lib/preflightTokens');
      const ok = await runPreflight({
        kind: 'report.investment.compass',
        functionName: 'generate-investment-report',
        label: 'Investment report',
        estimate: { aiNarrative: true },
      });
      if (!ok) { setIsGenerating(false); setIsBackgroundGeneration(false); return; }

      const safePropertyDetails = {
        ...(propertyDetails || {}),
        reportTier: propertyDetails?.reportTier || 'compass',
        generationEngine: propertyDetails?.generationEngine || 'compass-40',
      };

      const { data, error } = await invokeSecureFunction('generate-investment-report', {
        propertyAddress,
        propertyDetails: safePropertyDetails
      });

      console.log('Edge function response:', { data, error });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Failed to generate investment report');
      }

      if (!data) {
        console.error('No data returned from edge function');
        throw new Error('No data returned from edge function');
      }

      // Check if the response indicates an error
      if (data.success === false) {
        console.error('Report generation failed:', data.error);
        throw new Error(data.error || 'Report generation failed');
      }

      // Check if we have the required report content
      if (!data.reportContent) {
        console.error('No report content in response');
        throw new Error('No report content received');
      }

      setReportContent(data.reportContent);
      setSourcesContent(data.sourcesContent || '');
      setEnhancedData(data.enhancedData || null);
      
      // Save/update report in database with enhanced data
      let savedReportId: string | null = preliminaryReportId;
      try {
        if (user) {
          if (preliminaryReportId) {
            // Update the preliminary record we created earlier
            const { data: updateResult, error: updateError } = await invokeSecureFunction('manage-investment-reports', {
              action: 'update',
              reportId: preliminaryReportId,
              data: {
                report_content: data.reportContent,
                sources_content: data.sourcesContent || '',
                location_intelligence: data.enhancedData?.locationIntelligence || null,
                investment_score: data.enhancedData?.investmentScore || null,
                financial_calculations: data.enhancedData?.financials || null,
                demographics_data: data.enhancedData?.demographics || null,
                economic_data: data.enhancedData?.economics || null,
                status: 'completed',
              },
            });

            if (!updateError && updateResult?.success) {
              console.log('Report updated with ID:', preliminaryReportId);
            } else {
              console.error('Error updating report:', updateError || updateResult?.error);
              throw new Error(`Failed to update report: ${updateError?.message || updateResult?.error || 'Unknown error'}`);
            }
          } else {
            // Fallback: insert new record if no preliminary was created
            const { data: insertResult, error: insertError } = await invokeSecureFunction('manage-investment-reports', {
              action: 'insert',
              data: {
                property_address: propertyAddress,
                property_listing_id: propertyDetails?.id || null,
                report_content: data.reportContent,
                sources_content: data.sourcesContent || '',
                generated_by: user.id,
                location_intelligence: data.enhancedData?.locationIntelligence || null,
                investment_score: data.enhancedData?.investmentScore || null,
                financial_calculations: data.enhancedData?.financials || null,
                demographics_data: data.enhancedData?.demographics || null,
                economic_data: data.enhancedData?.economics || null,
                status: 'completed',
              },
            });

            if (!insertError && insertResult?.success && insertResult.report) {
              savedReportId = insertResult.report.id;
              setReportId(insertResult.report.id);
              console.log('Report saved with ID:', insertResult.report.id);
            } else {
              throw new Error(`Failed to save report: ${insertError?.message || insertResult?.error || 'Unknown error'}`);
            }
          }

            // Notification is now handled server-side by the Edge Function to prevent duplicates
            if (runInBackground) {
              console.log('📬 Skipping frontend notification - server-side notification will be created');
            }
        } else {
          console.warn('No user found, report not saved to database');
        }
      } catch (error) {
        console.error('Could not save report to database:', error);
        if (runInBackground) {
          addNotification({
            type: 'report_failed',
            title: 'Report Save Failed',
            message: `Report generated but could not be saved for ${propertyAddress}`,
          });
        }
        throw error;
      }
      
      if (!runInBackground) {
        toast({
          title: "Investment Report Generated",
          description: "Your comprehensive property analysis is ready.",
        });
      }
    } catch (error) {
      console.error('Report generation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Error details:', errorMessage);
      
      if (runInBackground) {
        addNotification({
          type: 'report_failed',
          title: 'Report Generation Failed',
          message: `Failed to generate report for ${propertyAddress}: ${errorMessage}`
        });
      } else {
        toast({
          title: "Generation Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
      // Reset states on error so user can try again
      setHasStartedGeneration(false);
      setIsBackgroundGeneration(false);
    } finally {
      setIsGenerating(false);
      generationLockRef.current = false;
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(reportContent);
      setIsCopied(true);
      toast({
        title: "Copied to Clipboard",
        description: "Investment report copied successfully.",
      });
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy report to clipboard.",
        variant: "destructive",
      });
    }
  };

  const buildPdfDoc = () => {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);
    pdf.setFontSize(16);
    pdf.setFont(undefined, 'bold');
    pdf.text('Property Investment Analysis', margin, 30);
    pdf.setFontSize(12);
    pdf.setFont(undefined, 'normal');
    pdf.text(`Property: ${propertyAddress}`, margin, 45);
    pdf.text(`Generated: ${new Date().toLocaleDateString('en-AU')}`, margin, 55);
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(reportContent, maxWidth);
    let yPosition = 70;
    const lineHeight = 6;
    lines.forEach((line: string) => {
      if (yPosition > pdf.internal.pageSize.getHeight() - 20) {
        pdf.addPage();
        yPosition = 20;
      }
      pdf.text(line, margin, yPosition);
      yPosition += lineHeight;
    });
    return pdf;
  };

  const pdfFilename = `investment-report-${propertyAddress.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;

  /**
   * A saved report downloads through the unified delivery — the same
   * template-first road as the report page, with the legacy server route
   * behind it. The raw-text jsPDF dump this modal used to draw survives only
   * for the one state with no saved row to deliver, because a text dump of
   * the markdown is then the only artifact that exists.
   */
  const downloadPDF = async () => {
    if (isDownloading) return;
    if (reportId) {
      setIsDownloading(true);
      try {
        await deliverInvestmentPdf(reportId);
      } catch (error) {
        toast({
          title: "Download Failed",
          description: error instanceof Error ? error.message : "The report PDF could not be produced.",
          variant: "destructive",
        });
      } finally {
        setIsDownloading(false);
      }
      return;
    }
    try {
      const pdf = buildPdfDoc();
      pdf.save(pdfFilename);
      toast({
        title: "PDF Downloaded",
        description: "Unsaved report exported as plain text PDF.",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to generate PDF. Please try again.",
        variant: "destructive",
      });
    }
  };

  const viewInGeneratedReports = () => {
    // Close this modal and navigate to Generated Reports
    handleClose();
    navigate('/generated-reports');
    
    // Use a small delay to ensure navigation completes
    setTimeout(() => {
      // Trigger opening the report viewer (this would need to be implemented in the Generated Reports page)
      if (reportId) {
        // You could use URL params or localStorage to communicate which report to open
        localStorage.setItem('openReportId', reportId);
        window.dispatchEvent(new CustomEvent('openReport', { detail: { reportId } }));
      }
    }, 100);
  };

  // Custom markdown components for consistent styling
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
        {children}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className="mb-4 space-y-2 list-disc list-inside ml-4">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="mb-4 space-y-2 list-decimal list-inside ml-4">
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="text-foreground leading-relaxed">
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
        {children}
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
    pre: ({ children }: any) => (
      <pre className="bg-muted p-4 rounded-lg my-4 overflow-x-auto">
        {children}
      </pre>
    ),
  };

  const handleClose = () => {
    // Allow closing if not generating, or if generating in background
    if (!isGenerating || isBackgroundGeneration) {
      setReportContent('');
      setSourcesContent('');
      setIsGenerating(false);
      setHasStartedGeneration(false);
      setReportId('');
      setIsCopied(false);
      setEnhancedData(null);
      setIsBackgroundGeneration(false);
      onClose();
    }
  };

  const continueInBackground = () => {
    // The preliminary processing record and in-flight request are intentionally
    // left intact. Closing this view must never restart or cancel a queued job.
    setIsBackgroundGeneration(true);
    setReportContent('');
    setSourcesContent('');
    setHasStartedGeneration(false);
    setIsCopied(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col" onPointerDownOutside={(e) => {
        // Allow closing during background generation
        if (isGenerating && !isBackgroundGeneration) {
          e.preventDefault();
        }
      }}>
        <DialogHeader>
          <DialogTitle>Property Investment Analysis</DialogTitle>
          <DialogDescription>
            Comprehensive investment report for {propertyAddress}
          </DialogDescription>
          {isGenerating && !isBackgroundGeneration && (
            <Button
              variant="outline"
              size="sm"
              className="absolute right-12 top-3 gap-2 border-primary/40 bg-primary/5 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={continueInBackground}
              aria-label="Continue generating this investment report in the background"
            >
              <PanelTopClose className="h-4 w-4" />
              Continue in Background
            </Button>
          )}
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          {!hasStartedGeneration && !reportContent && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-md text-center space-y-4">
                <h3 className="text-lg font-medium">Generate Investment Report</h3>
                <p className="text-muted-foreground">
                  Click below to generate a comprehensive property investment analysis 
                  including financial projections, market analysis, and growth potential.
                </p>
                <ReportGenerationStatus
                  estimate={estimateTokens('report.investment.snapshot', { aiNarrative: true })}
                  className="text-left"
                />
                <div className="flex items-center justify-center">
                  <TokenCostEstimate kind="report.investment.snapshot" options={{ aiNarrative: true }} />
                </div>
                <Button onClick={() => generateReport()} size="lg" disabled={isGenerating}>
                  Generate Analysis
                </Button>
              </div>
            </div>
          )}

          {(hasStartedGeneration && !reportContent) && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-4">
                {isGenerating ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <h3 className="text-lg font-medium">Generating Investment Report</h3>
                    <p className="text-muted-foreground mb-2">
                      Analyzing property data and market conditions...
                    </p>
                    <p className="text-sm text-muted-foreground">
                      This may take 2-3 minutes. You can continue in background.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-medium text-destructive">Generation Failed</h3>
                    <p className="text-muted-foreground">
                      There was an error generating your report. Please try again.
                    </p>
                    <Button onClick={() => generateReport()} variant="outline" size="lg">
                      Try Again
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {reportContent && (
            <>
              <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyToClipboard}
                    disabled={isCopied}
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadPDF}
                    disabled={isDownloading}
                  >
                    {isDownloading
                      ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      : <Download className="h-4 w-4 mr-2" />}
                    {isDownloading ? 'Preparing…' : 'Download PDF'}
                  </Button>
                  <FlattenPdfIconButton
                    getPdfBlob={async () => reportId
                      ? (await produceInvestmentDocument(reportId)).blob
                      : buildPdfDoc().output('blob')}
                    filename={pdfFilename}
                  />
                  {reportId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={viewInGeneratedReports}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Report
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                >
                  Close Report
                </Button>
              </div>

              {reportId ? (
                <div className="mb-4">
                  {/* Which template a saved report comes out in — the unified
                      delivery below resolves it, and this modal offered no way
                      to see or change it. Unsaved reports export as the plain
                      text dump and take no template. */}
                  <ReportTemplateSelector
                    reportType={INVESTMENT_REPORT_FORMAT.reportType}
                    formatLabel={INVESTMENT_REPORT_FORMAT.label}
                  />
                </div>
              ) : null}
              <ScrollArea className="flex-1 border rounded-lg p-6">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {reportContent}
                  </ReactMarkdown>
                  
                  {sourcesContent && (
                    <div className="mt-8 border-t pt-6">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {sourcesContent}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

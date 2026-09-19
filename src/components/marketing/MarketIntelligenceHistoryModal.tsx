import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { CheckCircle, XCircle, Clock, FileText, Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { generateMarketIntelligencePDF, type MarketIntelligenceReportData } from './MarketIntelligencePDFGenerator';
import { MarketIntelligenceDownloadButton } from './MarketIntelligenceDownloadButton';

interface ReportEntry {
  id: string;
  generated_at: string;
  report_period: string | null;
  report_type: string;
  audience_segment: string;
  status: string;
  include_advisory_strategy: boolean;
  error_message: string | null;
  report_data: any;
}

interface MarketIntelligenceHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Report',
  market_pulse: 'Market Pulse',
  hotspot_deep_dive: 'Hotspot Deep Dive',
  strategy_insight: 'Strategy Insight',
  finance_update: 'Finance Update',
  deal_breakdown: 'Deal Breakdown',
  myth_busting: 'Myth Busting',
  development_spotlight: 'Dev Spotlight',
};

export const MarketIntelligenceHistoryModal = ({ open, onOpenChange }: MarketIntelligenceHistoryModalProps) => {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchReports();
  }, [open]);

  const fetchReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketing_intelligence_reports')
      .select('id, generated_at, report_period, report_type, audience_segment, status, include_advisory_strategy, error_message, report_data')
      .order('generated_at', { ascending: false })
      .limit(50);

    if (!error) setReports((data as ReportEntry[]) || []);
    setLoading(false);
  };

  const handleRedownload = async (report: ReportEntry) => {
    if (!report.report_data) {
      toast.error('No report data available for re-download');
      return;
    }

    setDownloadingId(report.id);
    try {
      const reportData: MarketIntelligenceReportData = report.report_data;
      const pdfBlob = await generateMarketIntelligencePDF(reportData);

      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Market_Intelligence_Report_${(report.report_period || 'Report').replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('PDF downloaded successfully');
    } catch (err) {
      console.error('Re-download failed:', err);
      toast.error('Failed to generate PDF from stored data');
    } finally {
      setDownloadingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
            <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="text-[10px]">
            <XCircle className="h-2.5 w-2.5 mr-0.5" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-brand-500 border-brand-500/30 text-[10px]">
            <Clock className="h-2.5 w-2.5 mr-0.5" />
            {status === 'generating' ? 'Generating' : status}
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] w-[95vw] sm:w-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Report History
              </DialogTitle>
              <DialogDescription>
                Previously generated market intelligence reports
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchReports} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading reports...</div>
          ) : reports.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="font-medium">No reports generated yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Generate your first market intelligence report to see it here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {report.report_period || 'Unknown Period'}
                      </span>
                      {getStatusBadge(report.status)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {REPORT_TYPE_LABELS[report.report_type] || report.report_type}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {report.audience_segment === 'investor' ? '📊 Investor' :
                         report.audience_segment === 'owner_occupier' ? '🏠 Homebuyer' : '🌐 General'}
                      </Badge>
                      {!report.include_advisory_strategy && (
                        <Badge variant="outline" className="text-[10px] text-brand-600 border-brand-500/30">
                          Strategy excluded
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(report.generated_at), 'dd MMM yyyy, HH:mm')}
                    </p>
                    {report.error_message && (
                      <p className="text-[10px] text-destructive truncate max-w-[300px]">
                        {report.error_message}
                      </p>
                    )}
                  </div>

                  {report.status === 'completed' && report.report_data && (
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {/* The typeset document leads — it reads the row
                          server-side, which is why it can print the
                          correlation block the browser path cannot reach from
                          here. The jsPDF layout stays as the named legacy
                          choice beside it, never a silent substitute. */}
                      <MarketIntelligenceDownloadButton
                        reportId={report.id}
                        audienceSegment={report.audience_segment}
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        disabled={downloadingId === report.id}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        title="Download (legacy layout)"
                        aria-label="Download (legacy layout)"
                        onClick={() => handleRedownload(report)}
                        disabled={downloadingId === report.id}
                      >
                        {downloadingId === report.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <FlattenPdfIconButton
                        getPdfBlob={async () => await generateMarketIntelligencePDF(report.report_data as MarketIntelligenceReportData)}
                        filename={`Market_Intelligence_Report_${(report.report_period || 'Report').replace(/\s+/g, '_')}.pdf`}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={downloadingId === report.id}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertCircle, CheckCircle2, FileText, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { eligiblePortfolioReports } from './sendPortfolioEligibility';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface PortfolioReport { id: string; created_at: string; status: string; pdf_file_path: string | null; }
interface PortalReport { id: string; source_report_id: string | null; }

interface Props {
  client: { id: string; primary_first_name: string; primary_surname: string; primary_email: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGeneratePortfolioAnalysis: () => void;
}

const reportTitle = (report: PortfolioReport) => `Portfolio Analysis - ${format(new Date(report.created_at), 'dd MMM yyyy')}`;

/** Publishes an already-generated portfolio report; it never creates a substitute report or file. */
export function SendPortfolioToClientDialog({ client, open, onOpenChange, onGeneratePortfolioAnalysis }: Props) {
  const queryClient = useQueryClient();
  const [selectedPortfolioReportId, setSelectedPortfolioReportId] = useState<string>('');
  const [sendEmailNotification, setSendEmailNotification] = useState(false);
  const [optionalMessage, setOptionalMessage] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publicationResult, setPublicationResult] = useState<'success' | 'duplicate' | null>(null);
  const [publicationError, setPublicationError] = useState<string | null>(null);

  const { data: availablePortfolioReports = [], isLoading: isLoadingReports } = useQuery({
    queryKey: ['portfolio-analysis-reports', client.id],
    enabled: open && Boolean(client.id),
    queryFn: async (): Promise<PortfolioReport[]> => {
      const { data, error } = await invokeSecureFunction('get-client-data', { listMode: true, listOptions: { table: 'portfolio_analysis_reports', select: 'id, client_id, created_at, status, pdf_file_path', filters: { client_id: client.id }, orderBy: 'created_at', order_asc: false } });
      if (error) throw error;
      return eligiblePortfolioReports(data?.records || [], client.id) as PortfolioReport[];
    },
  });
  const { data: portalReports = [] } = useQuery({
    queryKey: ['client-portal-reports', client.id], enabled: open && Boolean(client.id),
    queryFn: async (): Promise<PortalReport[]> => {
      const { data, error } = await invokeSecureFunction('get-client-data', { listMode: true, listOptions: { table: 'client_portal_reports', select: 'id, source_report_id', filters: { client_id: client.id } } });
      if (error) throw error;
      return data?.records || [];
    },
  });

  useEffect(() => {
    if (!open) return;
    setSelectedPortfolioReportId(availablePortfolioReports[0]?.id || '');
    setSendEmailNotification(false);
    setOptionalMessage('');
    setPublicationResult(null);
    setPublicationError(null);
  }, [client.id, open, availablePortfolioReports]);

  const selectedReport = useMemo(() => availablePortfolioReports.find(report => report.id === selectedPortfolioReportId) || null, [availablePortfolioReports, selectedPortfolioReportId]);
  const alreadyPublished = selectedReport ? portalReports.some(report => report.source_report_id === selectedReport.id) : false;
  const canEmail = Boolean(client.primary_email?.trim());

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['portfolio-analysis-reports', client.id] }),
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', client.id] }),
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports-unified', client.id] }),
    ]);
  };

  const publish = async () => {
    if (isPublishing || !client.id || !selectedReport) return;
    setPublicationError(null);
    setIsPublishing(true);
    try {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'publish_portfolio_report', table: 'client_portal_reports', clientId: client.id,
        reportId: selectedReport.id, data: { notify_email: sendEmailNotification, client_visible_notes: optionalMessage.trim() || null },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'The portfolio report could not be published.');
      setPublicationResult(data.alreadyPublished ? 'duplicate' : 'success');
      await refresh();
      if (!data.alreadyPublished) toast.success('Portfolio sent successfully');
    } catch (error) {
      console.error('[SendPortfolioToClientDialog] publication failed', error);
      setPublicationError('The portfolio report could not be published. Please retry.');
    } finally { setIsPublishing(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Send Portfolio to Client</DialogTitle><DialogDescription>Publish a completed Portfolio Analysis report without leaving this client workspace.</DialogDescription></DialogHeader>
      {publicationResult ? <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" /><div><p className="font-medium">{publicationResult === 'success' ? 'Portfolio sent successfully' : 'This report is already available in the client portal.'}</p><p className="text-sm text-muted-foreground">{publicationResult === 'success' ? 'The selected Portfolio Analysis report is now available in the client portal.' : 'No duplicate portal entry was created.'}</p></div></div>
        <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
      </div> : <div className="space-y-5">
        <section className="space-y-1"><Label>Client</Label><p className="text-sm font-medium">{client.primary_first_name} {client.primary_surname}</p><p className="text-sm text-muted-foreground">{client.primary_email || 'No primary email on file'} · {portalReports.length} published report{portalReports.length === 1 ? '' : 's'}</p></section>
        {isLoadingReports ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio reports…</div> : availablePortfolioReports.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4"><p className="font-medium">No portfolio analysis report is currently available for this client.</p><p className="mt-1 text-sm text-muted-foreground">Generate and save a Portfolio Analysis report before publishing it to the portal.</p><Button type="button" className="mt-3" onClick={onGeneratePortfolioAnalysis}>Generate Portfolio Analysis</Button></div> : <>
          <section className="space-y-2"><Label htmlFor="portfolio-report">Portfolio report</Label><Select value={selectedPortfolioReportId} onValueChange={setSelectedPortfolioReportId}><SelectTrigger id="portfolio-report"><SelectValue placeholder="Select a report" /></SelectTrigger><SelectContent>{availablePortfolioReports.map(report => <SelectItem key={report.id} value={report.id}>{reportTitle(report)}</SelectItem>)}</SelectContent></Select></section>
          {selectedReport && <div className="rounded-lg border border-border p-3 text-sm"><div className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4" />{reportTitle(selectedReport)}</div><p className="mt-1 text-muted-foreground">Generated {format(new Date(selectedReport.created_at), 'dd MMM yyyy, HH:mm')} · {selectedReport.pdf_file_path ? 'File ready for validation' : 'File unavailable'}{alreadyPublished ? ' · Already published' : ''}</p></div>}
          <section className="space-y-3"><Label>Delivery options</Label><p className="text-sm text-muted-foreground">Publish to Client Portal is enabled for this action. Email notification is optional and never blocks portal publication.</p><div className="flex items-center gap-2"><Checkbox id="notify-email" checked={sendEmailNotification} disabled={!canEmail} onCheckedChange={checked => setSendEmailNotification(checked === true)} /><Label htmlFor="notify-email" className="font-normal">Send Email Notification{!canEmail ? ' (no client email available)' : ''}</Label></div><div className="space-y-2"><Label htmlFor="portfolio-message">Add a short message (optional)</Label><Textarea id="portfolio-message" value={optionalMessage} onChange={event => setOptionalMessage(event.target.value)} maxLength={500} /></div></section>
          {publicationError && <p role="alert" className="flex gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{publicationError}</p>}
        </>}
      </div>}
      {!publicationResult && availablePortfolioReports.length > 0 && <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPublishing}>Cancel</Button><Button type="button" onClick={publish} disabled={isPublishing || !selectedReport || !selectedReport.pdf_file_path}>{isPublishing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending Portfolio…</> : <><Send className="mr-2 h-4 w-4" />Send Portfolio to Client</>}</Button></DialogFooter>}
    </DialogContent>
  </Dialog>;
}

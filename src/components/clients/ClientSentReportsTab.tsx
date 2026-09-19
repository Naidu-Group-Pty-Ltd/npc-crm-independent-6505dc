import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  FileText, Loader2, EyeOff, Clock, Send, Plus, Trash2, Download,
  BarChart3, PiggyBank, TrendingUp, FileBarChart, Upload, X, File, CheckCircle2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { secureStorageUpload, secureStorageDownload } from '@/hooks/useSecureStorage';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PublishFromReportsPicker } from './PublishFromReportsPicker';
import { useClientReportInventory } from '@/hooks/useClientReportInventory';
import { publishReportToPortal } from '@/lib/reports/publishReportToPortal';
import {
  PORTAL_REPORT_TYPE,
  publishableReports,
  type PublishVerdict,
  type UnifiedReport,
} from '@/lib/reports/clientReportInventory.pure';
import { parseStorageRef, bucketCandidates } from '@/lib/reports/storageRef';

interface ClientSentReportsTabProps {
  clientId: string;
  clientName: string;
  /**
   * The client's properties, so the picker can offer their investment
   * reports — those are found by property id rather than by client. Optional
   * because everything else in this tab works without them.
   */
  properties?: Array<{ id: string }>;
}

const reportTypeConfig: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  investment: { label: 'Investment Report', icon: FileBarChart, color: 'bg-info/10 text-info' },
  portfolio: { label: PORTFOLIO_REPORT_LABEL, icon: BarChart3, color: 'bg-success/10 text-success' },
  borrowing_capacity: { label: 'Borrowing Capacity', icon: PiggyBank, color: 'bg-brand-500/10 text-brand-600' },
  cash_flow: { label: 'Cash Flow Analysis', icon: TrendingUp, color: 'bg-accent/10 text-accent' },
  general: { label: 'General', icon: FileText, color: 'bg-muted text-muted-foreground' },
};

function getReportConfig(type: string) {
  return reportTypeConfig[type] || reportTypeConfig.general;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientSentReportsTab({ clientId, clientName, properties = [] }: ClientSentReportsTabProps) {
  const queryClient = useQueryClient();
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /**
   * Which of the two sources the dialog is publishing from.
   *
   * The upload path is unchanged and is still the right answer for a document
   * written somewhere else. What it was NOT the right answer for is the five
   * formats this product generates itself: those had to be downloaded and
   * re-uploaded to reach the same portal, which produced a second copy of a
   * file the workspace already held and could silently go stale against it.
   */
  const [publishSource, setPublishSource] = useState<'generated' | 'upload'>('generated');
  const [selectedReport, setSelectedReport] = useState<UnifiedReport | null>(null);
  const [selectedVerdict, setSelectedVerdict] = useState<PublishVerdict | null>(null);
  const [publishStep, setPublishStep] = useState<string | null>(null);

  const propertyIds = useMemo(() => properties.map((p) => p.id), [properties]);
  const inventory = useClientReportInventory(clientId, propertyIds);

  /**
   * Fetch a published report's file.
   *
   * This asked `client-files` for the raw column, which is right only when
   * the column holds a bare key in that one bucket. `storageRef.ts` records
   * four shapes these columns carry — a key, a public URL, a signed URL and a
   * stringified upload result — and two of them are absolute. Publishing a
   * report the workspace generated makes the other shapes common here rather
   * than rare, so the reference is resolved and the bucket it named is tried
   * first. `investment-reports` stays as the fallback for a bare key from
   * that era, which is what the portal's own download already does.
   */
  const fetchReportBlob = useCallback(async (storagePath: string) => {
    const ref = parseStorageRef(storagePath);
    if (/^https?:\/\//i.test(ref.path)) {
      throw new Error('This report is stored somewhere this workspace cannot serve from.');
    }
    let lastError = 'Download failed';
    // `bucketCandidates` is generic over bucket names because a reference can
    // name one this list does not; the storage client's own union is the
    // authority on what it will accept.
    const candidates = bucketCandidates(ref, 'client-files', 'investment-reports') as Array<
      Parameters<typeof secureStorageDownload>[0]
    >;
    for (const bucket of candidates) {
      const attempt = await secureStorageDownload(bucket, ref.path);
      if (attempt.success && attempt.blob) return attempt.blob;
      lastError = attempt.error || lastError;
    }
    throw new Error(lastError);
  }, []);

  const handleDownload = async (report: any) => {
    if (!report.storage_path) {
      toast.error('No file available for this report');
      return;
    }
    setDownloadingId(report.id);
    try {
      const blob = await fetchReportBlob(report.storage_path);
      const result = { blob };
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = report.storage_path.split('.').pop() || 'pdf';
      a.download = `${(report.report_title || 'Report').replace(/\s+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (err: any) {
      toast.error('Failed to download: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloadingId(null);
    }
  };
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newReport, setNewReport] = useState({
    report_title: '',
    report_type: '',
    report_tier: '',
    notes: '',
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['client-portal-reports', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_reports',
          select: '*',
          filters: { client_id: clientId },
          orderBy: 'published_at',
          orderAsc: false,
        },
      });
      if (error) throw error;
      return data?.records || [];
    },
  });

  const reports = data || [];

  const handleFileSelect = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large (max 25MB)');
      return;
    }
    setUploadedFile(file);
    // Auto-fill title from filename if empty
    if (!newReport.report_title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setNewReport(p => ({ ...p, report_title: nameWithoutExt }));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handlePublish = async () => {
    if (!newReport.report_title.trim()) {
      toast.error('Report title is required');
      return;
    }
    if (!uploadedFile) {
      toast.error('Please upload a file');
      return;
    }

    setPublishing(true);
    try {
      // Upload file to storage
      const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = format(new Date(), 'yyyy-MM-dd_HHmmss');
      const ext = uploadedFile.name.split('.').pop() || 'pdf';
      const storagePath = `portal-reports/${clientId}/${safeName}_${dateStr}.${ext}`;

      const uploadResult = await secureStorageUpload('client-files', storagePath, uploadedFile, {
        contentType: uploadedFile.type || 'application/octet-stream',
        upsert: true,
        // The client this file belongs to. `secure-storage` derives the
        // destination and the owner from it and refuses the upload without it.
        resourceId: clientId,
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'File upload failed');
      }

      // Create portal report record
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_portal_reports',
        clientId,
        data: {
          report_title: newReport.report_title,
          report_type: newReport.report_type || 'general',
          report_tier: newReport.report_tier || null,
          storage_path: storagePath,
          notes: newReport.notes || null,
          published_at: new Date().toISOString(),
        },
      });
      if (error) throw error;

      toast.success('Report published to portal');
      setShowPublishDialog(false);
      setNewReport({ report_title: '', report_type: '', report_tier: '', notes: '' });
      setUploadedFile(null);
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
    } catch (err: any) {
      toast.error('Failed to publish: ' + (err.message || 'Unknown error'));
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Choosing a report the workspace already produced.
   *
   * Selecting one fills the title and the category from the report itself, so
   * the common case is two clicks and nothing typed — but both fields stay
   * editable, because what the CLIENT should see this document called is not
   * always what the workspace named it.
   */
  const handleSelectGenerated = useCallback((report: UnifiedReport, verdict: PublishVerdict) => {
    setSelectedReport(report);
    setSelectedVerdict(verdict);
    setNewReport((p) => ({
      ...p,
      report_title: report.name,
      report_type: PORTAL_REPORT_TYPE[report.type] || p.report_type,
    }));
  }, []);

  const handlePublishGenerated = async () => {
    if (!selectedReport) {
      toast.error('Choose a report to publish');
      return;
    }
    if (!newReport.report_title.trim()) {
      toast.error('Report title is required');
      return;
    }

    setPublishing(true);
    setPublishStep(null);
    try {
      const outcome = await publishReportToPortal({
        report: selectedReport,
        clientId,
        clientName,
        title: newReport.report_title,
        reportType: newReport.report_type || undefined,
        notes: newReport.notes || null,
        onProgress: setPublishStep,
      });

      if (!outcome.ok) {
        toast.error('Failed to publish: ' + outcome.error);
        return;
      }

      toast.success(
        outcome.generated
          ? 'Report generated and published to portal'
          : 'Report published to portal',
      );
      handleClosePublish(false);
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports-unified', clientId] });
    } finally {
      setPublishing(false);
      setPublishStep(null);
    }
  };

  const handleDelete = async () => {
    if (!reportToDelete) return;
    setDeleting(true);
    try {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_portal_reports',
        clientId,
        recordId: reportToDelete.id,
      });
      if (error) throw error;
      toast.success('Report removed from client portal');
      setReportToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  const handleClosePublish = (open: boolean) => {
    if (!open) {
      setShowPublishDialog(false);
      setUploadedFile(null);
      setSelectedReport(null);
      setSelectedVerdict(null);
      setPublishStep(null);
      setNewReport({ report_title: '', report_type: '', report_tier: '', notes: '' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Sent Reports</h3>
          <p className="text-xs text-muted-foreground">Reports published to {clientName}'s portal</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            /* Open on the source that has something in it. A client with
               nothing generated should not land on an empty list, and one
               with reports waiting should not have to find the tab. */
            setPublishSource(
              publishableReports(inventory.reports, inventory.publishedFiles).length > 0
                ? 'generated'
                : 'upload',
            );
            setShowPublishDialog(true);
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Publish Report
        </Button>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Send className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No reports have been sent to this client's portal yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((report: any) => {
            const config = getReportConfig(report.report_type);
            const Icon = config.icon;
            return (
              <Card key={report.id}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${config.color} shrink-0`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{report.report_title}</p>
                        {report.is_read ? (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                            Read
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <EyeOff className="h-2.5 w-2.5" />
                            Unread
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{config.label}</Badge>
                        <span>•</span>
                        <Clock className="h-3 w-3" />
                        <span>{report.published_at ? formatDistanceToNow(new Date(report.published_at), { addSuffix: true }) : '—'}</span>
                      </div>
                      {report.notes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{report.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {report.published_at && format(new Date(report.published_at), 'dd MMM yyyy')}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleDownload(report)}
                        disabled={downloadingId === report.id || !report.storage_path}
                        title="Download report"
                      >
                        {downloadingId === report.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {report.storage_path && /\.pdf$/i.test(report.storage_path) && (
                        <FlattenPdfIconButton
                          getPdfBlob={() => fetchReportBlob(report.storage_path)}
                          filename={`${(report.report_title || 'Report').replace(/\s+/g, '_')}.pdf`}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={downloadingId === report.id}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setReportToDelete(report)}
                        title="Remove from portal"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!reportToDelete} onOpenChange={() => !deleting && setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Report from Portal</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "<strong>{reportToDelete?.report_title}</strong>" from {clientName}'s portal. They will no longer be able to view or download it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={handleClosePublish}>
        {/* A column with a scrolling body and a pinned action, rather than one
            scrolling box. The form is taller than the dialog on a laptop, and
            the act the dialog exists for was the last thing in the scroll —
            so it was both the thing that spilled out of the bottom border and
            the thing you had to go looking for. */}
        <DialogContent className="flex max-h-[90dvh] w-[92vw] max-w-[680px] flex-col gap-0 overflow-hidden p-0 sm:p-0">
          <DialogHeader className="shrink-0 space-y-1.5 border-b border-border/60 px-4 py-4 pr-12 sm:px-6">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Publish Report to Portal
            </DialogTitle>
            <DialogDescription>
              Publish a report to {clientName}'s client portal — one this workspace has already
              produced, or a file of your own.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 w-full max-w-full min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
            <Tabs
              value={publishSource}
              onValueChange={(v) => setPublishSource(v as 'generated' | 'upload')}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="generated">This client's reports</TabsTrigger>
                <TabsTrigger value="upload">Upload a file</TabsTrigger>
              </TabsList>

              <TabsContent value="generated" className="mt-3">
                <PublishFromReportsPicker
                  reports={inventory.reports}
                  publishedFiles={inventory.publishedFiles}
                  selectedId={selectedReport?.id ?? null}
                  onSelect={handleSelectGenerated}
                />
                {selectedVerdict?.alreadyPublished && (
                  <p className="mt-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    {clientName} already has this document
                    {selectedVerdict.publishedAt
                      ? ` (shared ${format(new Date(selectedVerdict.publishedAt), 'dd MMM yyyy')})`
                      : ''}
                    . Publishing again adds a second entry to their portal rather than replacing
                    the first.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="upload" className="mt-3 space-y-4">
            {/* Drag & Drop Upload Zone */}
            <div className="w-full max-w-full min-w-0">
              <Label>Upload File *</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg"
              />
              {uploadedFile ? (
                <div className="mt-1.5 w-full flex items-center gap-3 rounded-lg border bg-muted/50 p-3 min-w-0">
                  <File className="h-8 w-8 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(uploadedFile.size)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setUploadedFile(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'mt-1.5 w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors',
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
                  )}
                >
                  <Upload className={cn('h-8 w-8', isDragging ? 'text-primary' : 'text-muted-foreground/50')} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      {isDragging ? 'Drop file here' : 'Drag & drop or click to upload'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">PDF, Word, Excel, images – max 25MB</p>
                  </div>
                </div>
              )}
            </div>
              </TabsContent>
            </Tabs>

            {/* Report Title */}
            <div className="w-full max-w-full min-w-0">
              <Label>Report Title *</Label>
              <Input
                className="w-full max-w-full box-border"
                value={newReport.report_title}
                onChange={(e) => setNewReport(p => ({ ...p, report_title: e.target.value }))}
                placeholder="e.g., Investment Analysis - 123 Main St"
              />
            </div>

            {/* Report Type - Optional */}
            <div className="w-full max-w-full min-w-0">
              <Label>Report Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={newReport.report_type} onValueChange={(v) => setNewReport(p => ({ ...p, report_type: v }))}>
              <SelectTrigger className="w-full max-w-full box-border">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investment">Investment Report</SelectItem>
                  <SelectItem value="portfolio">{PORTFOLIO_REPORT_LABEL}</SelectItem>
                  <SelectItem value="borrowing_capacity">Borrowing Capacity</SelectItem>
                  <SelectItem value="cash_flow">Cash Flow Analysis</SelectItem>
                  <SelectItem value="general">General Document</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="w-full max-w-full min-w-0">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                className="w-full max-w-full box-border resize-y"
                value={newReport.notes}
                onChange={(e) => setNewReport(p => ({ ...p, notes: e.target.value }))}
                placeholder="Brief note for internal tracking..."
                rows={2}
              />
            </div>

          </div>

          <div className="shrink-0 border-t border-border/60 px-4 py-3 sm:px-6">
            <Button
              onClick={publishSource === 'generated' ? handlePublishGenerated : handlePublish}
              disabled={
                publishing ||
                !newReport.report_title.trim() ||
                (publishSource === 'upload' ? !uploadedFile : !selectedReport)
              }
              className="w-full"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {publishStep ?? (publishSource === 'upload' ? 'Uploading & Publishing...' : 'Publishing...')}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {/* The one path that makes a document says so before it is clicked. */}
                  {publishSource === 'generated' && selectedVerdict?.readiness === 'on_publish'
                    ? 'Generate & Publish to Portal'
                    : 'Publish to Portal'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

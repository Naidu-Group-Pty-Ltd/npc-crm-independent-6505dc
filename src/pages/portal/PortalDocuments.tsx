import { useState, useCallback, useEffect, useMemo } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { usePortalDocumentsData, invokePortalEdge } from '@/hooks/usePortalData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import {
  FileText, Loader2, FolderOpen, Download, Upload,
  File, Image, FileSpreadsheet, FileIcon, X, CheckCircle, RotateCcw, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { stageUploadFiles } from '@/lib/uploads/stageUploadFiles.pure';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalPanel, PortalPanelContent } from '@/components/portal/PortalSurface';
import { SyncConflictDetailsPopover } from '@/components/sync/SyncConflictDetailsPopover';
import { SyncStatusBadge } from '@/components/sync/SyncStatusBadge';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  MAX_DOCUMENT_BATCH_BYTES,
  MAX_DOCUMENT_UPLOAD_FILES,
  calculateTotalUploadSize,
  createUploadQueueItems,
  formatUploadBytes,
  getOverallUploadProgress,
  getPersistedUploadMode,
  getRejectedFilesMessage,
  persistUploadMode,
  runTasksByMode,
  type UploadProcessingMode,
  type UploadQueueItem,
  uploadFormDataWithProgress,
} from '@/lib/documentUpload';
import { getActorLabel, getConflictReason, getSurfaceLabel, getVersionNumber } from '@/lib/syncDisplay';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface FailedUploadItem {
  id: string;
  file: File;
  fileName: string;
  error: string;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType?: string | null) {
  if (!fileType) return <File className="h-5 w-5" />;
  if (fileType.includes('pdf')) return <FileText className="h-5 w-5 text-destructive" />;
  if (fileType.includes('image')) return <Image className="h-5 w-5 text-primary" />;
  if (fileType.includes('sheet') || fileType.includes('excel') || fileType.includes('csv')) return <FileSpreadsheet className="h-5 w-5 text-success" />;
  return <FileIcon className="h-5 w-5 text-muted-foreground" />;
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    identification: 'border border-primary/20 bg-primary/10 text-primary',
    financial: 'border border-success/20 bg-success/10 text-success',
    property: 'border border-warning/20 bg-warning/10 text-warning',
    legal: 'border border-border/70 bg-muted text-foreground',
    report: 'border border-primary/20 bg-primary/10 text-primary',
    general: 'border border-border/70 bg-muted text-muted-foreground',
  };
  return colors[category?.toLowerCase()] || colors.general;
}

const UPLOAD_CATEGORIES = [
  { value: 'identification', label: 'Identification' },
  { value: 'financial', label: 'Financial' },
  { value: 'property', label: 'Property' },
  { value: 'legal', label: 'Legal' },
  { value: 'general', label: 'General' },
];

const PORTAL_UPLOAD_MODE_SCOPE = 'portal-documents';

function getSessionToken(): string | null {
  // In-memory only: `client-portal-verify` repopulates it from the HttpOnly
  // cookie on load. It used to come from localStorage, where the storage access
  // could throw — hence the nested try/catch that used to live here.
  return getPortalSessionToken();
}

export default function PortalDocuments() {
  const { user } = usePortalAuth();
  const { data, isLoading } = usePortalDocumentsData();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('general');
  const [uploadMode, setUploadMode] = useState<UploadProcessingMode>('parallel');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadFailures, setUploadFailures] = useState<FailedUploadItem[]>([]);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const files = data?.files || [];
  const categories = [...new Set(files.map((f: any) => f.category))].sort();
  const totalUploadBytes = useMemo(() => calculateTotalUploadSize(uploadFiles), [uploadFiles]);
  const overallUploadProgress = useMemo(() => getOverallUploadProgress(uploadQueue), [uploadQueue]);

  useEffect(() => {
    const savedMode = getPersistedUploadMode(PORTAL_UPLOAD_MODE_SCOPE, user?.id);
    if (savedMode) setUploadMode(savedMode);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) persistUploadMode(PORTAL_UPLOAD_MODE_SCOPE, user.id, uploadMode);
  }, [uploadMode, user?.id]);

  const filtered = files.filter((f: any) => {
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return f.file_name?.toLowerCase().includes(s) || f.description?.toLowerCase().includes(s) || f.category?.toLowerCase().includes(s);
    }
    return true;
  });

  const updateQueueItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    if (rejectedFiles.length > 0) {
      const rejection = getRejectedFilesMessage(rejectedFiles);
      toast.error(rejection.title, { description: rejection.description });
    }

    if (!acceptedFiles.length) return;

    // The same staging rule the client Files tray and the finance vault use:
    // add rather than replace, refuse a file already staged, and name what a
    // cap excluded instead of dropping it with a `slice`.
    const staged = stageUploadFiles(uploadFiles, acceptedFiles, {
      maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
      maxTotalBytes: MAX_DOCUMENT_BATCH_BYTES,
      formatBytes: formatUploadBytes,
    });
    setUploadFiles(staged.files);
    for (const notice of staged.notices) toast.warning(notice);

    if (staged.added.length) {
      setUploadFailures([]);
      setUploadSuccess(false);
    }
  }, [uploadFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
    maxSize: 10 * 1024 * 1024,
    accept: DOCUMENT_UPLOAD_ACCEPT,
    disabled: uploading,
  });

  const removeUploadFile = (idx: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const executeUploadBatch = useCallback(async (filesToUpload: File[]) => {
    if (!filesToUpload.length || !user?.client_id) return;
    if (calculateTotalUploadSize(filesToUpload) > MAX_DOCUMENT_BATCH_BYTES) {
      toast.error('Upload batch is too large.', {
        description: `Keep the total under ${formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)}.`,
      });
      return;
    }

    const queueItems = createUploadQueueItems(filesToUpload);
    setUploadQueue(queueItems);
    setUploadFailures([]);
    setUploading(true);

    try {
      const sessionToken = getSessionToken();
      const results = await runTasksByMode(queueItems, uploadMode, async (queueItem, index) => {
        updateQueueItem(queueItem.id, { status: 'uploading', progress: 1, error: undefined });

        const filePath = `${user.client_id}/portal-uploads/${Date.now()}-${index}-${queueItem.file.name}`;
        const formData = new FormData();
        formData.append('file', queueItem.file);
        formData.append('file_path', filePath);
        formData.append('category', uploadCategory);
        formData.append('portal_session_token', sessionToken || '');

        const result = await uploadFormDataWithProgress<any>({
          url: `${SUPABASE_URL}/functions/v1/portal-upload-file`,
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            ...(sessionToken ? { 'x-portal-session-token': sessionToken } : {}),
          },
          formData,
          onProgress: (progress) => updateQueueItem(queueItem.id, { progress }),
        });

        if (!result?.success) throw new Error(result?.error || 'Upload failed');
        updateQueueItem(queueItem.id, { status: 'success', progress: 100 });
        return { id: queueItem.id, file: queueItem.file, result };
      });

      const failures = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        const queueItem = queueItems[index];
        const error = result.reason?.message || 'Upload failed';
        updateQueueItem(queueItem.id, { status: 'failed', progress: 100, error });
        return [{ id: queueItem.id, file: queueItem.file, fileName: queueItem.file.name, error }];
      });

      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      setUploadFailures(failures);

      if (successCount > 0) {
        setUploadSuccess(true);
        setUploadFiles((prev) => prev.filter((file) => failures.some((failure) => failure.file === file)));
        queryClient.invalidateQueries({ queryKey: ['portal-client-data'] });
      }

      if (successCount > 0 && failures.length === 0) {
        toast.success(`${successCount} file(s) uploaded successfully`);
        setTimeout(() => {
          setUploadOpen(false);
          setUploadSuccess(false);
          setUploadQueue([]);
        }, 1500);
      } else if (successCount > 0) {
        toast.warning(`${successCount} uploaded, ${failures.length} failed`);
      } else if (failures.length > 0) {
        toast.error('Upload failed', { description: failures[0].error });
      }
    } finally {
      setUploading(false);
    }
  }, [queryClient, updateQueueItem, uploadCategory, uploadMode, user?.client_id]);

  const handleUpload = async () => {
    await executeUploadBatch(uploadFiles);
  };

  const retryFailedUploads = async () => {
    await executeUploadBatch(uploadFailures.map((item) => item.file));
  };

  const handleDownload = async (file: any) => {
    try {
      setDownloadingId(file.id);
      // STOR-004: fetch a short-lived signed URL via the portal edge function
      // (service role, ownership-checked) instead of an anonymous storage
      // download — the client-files bucket is private.
      const res = await invokePortalEdge('get-portal-client-data', {
        action: 'downloadFile',
        fileId: file.id,
      });
      if (!res?.success || !res?.signedUrl) throw new Error(res?.error || 'Download failed');
      const a = document.createElement('a');
      a.href = res.signedUrl;
      a.download = file.file_name;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Download error:', err);
      toast.error('Unable to download file. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Documents</h1>
          <p className="text-muted-foreground mt-1">Your uploaded documents and files</p>
        </div>
        <Dialog
          open={uploadOpen}
          onOpenChange={(open) => {
            setUploadOpen(open);
            if (!open) {
              setUploadQueue([]);
              setUploadFailures([]);
              setUploadSuccess(false);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-md">
              <Upload className="h-4 w-4" />
              Upload Files
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg client-portal-soft-panel border-border/70">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Upload Documents
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</Label>
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPLOAD_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Processing</Label>
                <Select value={uploadMode} onValueChange={(value) => setUploadMode(value as UploadProcessingMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parallel">Parallel upload</SelectItem>
                    <SelectItem value="sequential">Sequential upload</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">Batch size</span>
                  <span className={totalUploadBytes > MAX_DOCUMENT_BATCH_BYTES ? 'text-destructive' : 'text-muted-foreground'}>
                    {formatUploadBytes(totalUploadBytes)} / {formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)}
                  </span>
                </div>
                <Progress value={Math.min(100, (totalUploadBytes / MAX_DOCUMENT_BATCH_BYTES) * 100)} className="mt-2 h-2" />
              </div>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30'
                } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <input {...getInputProps()} />
                <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {isDragActive ? 'Drop files here' : 'Drag & drop files, or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, images, Word, Excel (max 10MB each, up to {MAX_DOCUMENT_UPLOAD_FILES} files)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {uploadMode === 'parallel' ? 'Files upload together for faster batches.' : 'Files upload one-by-one for steadier progress.'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Batch total must stay under {formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)}.
                </p>
              </div>

              {uploadFiles.length > 0 && (
                <div className="space-y-2">
                  {uploadFiles.map((file, idx) => (
                    <div key={`${file.name}-${file.lastModified}-${idx}`} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 border border-border/50">
                      {getFileIcon(file.type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeUploadFile(idx)} disabled={uploading}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {uploadQueue.length > 0 && (
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Upload progress</p>
                      <p className="text-xs text-muted-foreground">Overall progress across the current batch.</p>
                    </div>
                    <span className="text-sm font-medium text-foreground">{overallUploadProgress}%</span>
                  </div>
                  <Progress value={overallUploadProgress} className="h-2" />
                  <div className="space-y-2">
                    {uploadQueue.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border/60 bg-background/80 p-2.5">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-medium text-foreground">{item.file.name}</span>
                          <span className="text-xs text-muted-foreground">{item.status}</span>
                        </div>
                        <Progress value={item.progress} className="mt-2 h-1.5" />
                        {item.error ? <p className="mt-2 text-xs text-destructive">{item.error}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadFailures.length > 0 && (
                <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Failed uploads</p>
                        <p className="text-xs text-muted-foreground">Review errors and retry only the failed files.</p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={retryFailedUploads} disabled={uploading}>
                      <RotateCcw className="h-3.5 w-3.5" /> Retry failed
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {uploadFailures.map((failure) => (
                      <div key={failure.id} className="rounded-lg border border-destructive/20 bg-background/90 p-2.5">
                        <p className="text-sm font-medium text-foreground">{failure.fileName}</p>
                        <p className="mt-1 text-xs text-destructive">{failure.error}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadSuccess ? (
                <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 p-3">
                  <CheckCircle className="h-5 w-5 text-success" />
                  <p className="text-sm font-medium text-success">Files uploaded successfully!</p>
                </div>
              ) : (
                <Button
                  onClick={handleUpload}
                  disabled={uploadFiles.length === 0 || uploading || totalUploadBytes > MAX_DOCUMENT_BATCH_BYTES}
                  className="w-full gap-2"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Uploading...' : `Upload ${uploadFiles.length} file(s)`}
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {files.length > 0 && (
        <div className="client-portal-soft-panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search documents..."
            containerClassName="flex-1"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c: string) => (
                <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {filtered.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<FolderOpen className="h-8 w-8" />}
          title={search || categoryFilter !== 'all' ? 'No documents match your filters' : 'No documents uploaded yet'}
          description={search || categoryFilter !== 'all' ? 'Try broadening your search or changing the selected category.' : 'Upload your first document to keep key files in one secure place.'}
          actionLabel="Upload your first document"
          onAction={() => setUploadOpen(true)}
        />
      ) : (
        <PortalPanel className="overflow-hidden">
          <PortalPanelContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((file: any) => (
                <div key={file.id} className="px-5 py-4 hover:bg-muted/30 transition-colors flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-muted shrink-0">
                    {getFileIcon(file.file_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge className={`text-xs ${getCategoryColor(file.category)}`}>{file.category}</Badge>
                      <SyncStatusBadge status={file.sync_status} />
                      <Badge variant="outline" className="text-xs">{getSurfaceLabel(file.source_surface)}</Badge>
                      {file.document_type && <span className="text-xs text-muted-foreground capitalize">{file.document_type.replace(/_/g, ' ')}</span>}
                      <span className="text-xs text-muted-foreground">{formatFileSize(file.file_size)}</span>
                    </div>
                    {file.description && <p className="text-xs text-muted-foreground mt-1 truncate">{file.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {getActorLabel(file) && <span>By {getActorLabel(file)}</span>}
                      {getVersionNumber(file) ? <span>v{getVersionNumber(file)}</span> : null}
                      {getConflictReason(file) ? <span className="text-warning">{getConflictReason(file)}</span> : null}
                      <SyncConflictDetailsPopover record={file} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-xs text-muted-foreground hidden sm:block">
                      {file.uploaded_at ? format(new Date(file.uploaded_at), 'dd MMM yyyy') : '—'}
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(file)} disabled={downloadingId === file.id} className="gap-1.5">
                      {downloadingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      <span className="hidden sm:inline">Download</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </PortalPanelContent>
        </PortalPanel>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {filtered.length} document{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

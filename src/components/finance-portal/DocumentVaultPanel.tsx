import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { fetchPdfBlob } from '@/lib/pdf/downloadPdf';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Upload, Download, Trash2, FileText, Eye, EyeOff, AlertCircle, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { stageUploadFiles } from '@/lib/uploads/stageUploadFiles.pure';
import { format } from 'date-fns';
import { useDropzone } from 'react-dropzone';
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
} from '@/lib/documentUpload';
import { getActorLabel, getConflictReason, getSurfaceLabel, getVersionNumber } from '@/lib/syncDisplay';

interface DocumentRecord {
  id: string;
  client_id: string;
  category: string;
  original_filename: string;
  storage_path: string;
  file_size: number;
  mime_type: string;
  description: string | null;
  visible_to_client: boolean;
  uploader_type: string;
  created_at: string;
  sync_status?: string | null;
  source_surface?: string | null;
  source_actor_name?: string | null;
  version_number?: number | null;
  version_group_id?: string | null;
  supersedes_entity_id?: string | null;
  conflict_reason?: string | null;
  source_details?: Record<string, unknown> | null;
  last_sync_error?: string | null;
}

interface Permission {
  view?: boolean;
  edit?: boolean;
  delete?: boolean;
}

interface FailedUploadItem {
  id: string;
  file: File;
  fileName: string;
  error: string;
}

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'payslip', label: 'Payslip' },
  { value: 'tax_return', label: 'Tax Return' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'identification', label: 'ID / Verification' },
  { value: 'rates_notice', label: 'Rates Notice' },
  { value: 'contract', label: 'Contract' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'super_statement', label: 'Super Statement' },
  { value: 'loan_statement', label: 'Loan Statement' },
  { value: 'other', label: 'Other' },
];

const FINANCE_UPLOAD_MODE_SCOPE = 'finance-portal-documents';
const MAX_FINANCE_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_FILE_EXTENSIONS = Object.values(DOCUMENT_UPLOAD_ACCEPT).flat();

function categoryLabel(c: string) {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label || c;
}

function matchesAcceptedType(file: File) {
  const fileType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  return Object.entries(DOCUMENT_UPLOAD_ACCEPT).some(([mimeType, extensions]) => {
    const normalizedMime = mimeType.toLowerCase();
    const mimeMatches = normalizedMime.endsWith('/*')
      ? fileType.startsWith(normalizedMime.replace('/*', '/'))
      : fileType === normalizedMime;
    const extensionMatches = extensions.some((extension) => fileName.endsWith(extension));
    return mimeMatches || extensionMatches;
  });
}

function uploadSignedFileWithProgress(input: {
  url: string;
  file: File;
  contentType: string;
  onProgress?: (progress: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.url);
    xhr.setRequestHeader('Content-Type', input.contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onProgress) return;
      input.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(input.file);
  });
}

interface DocumentVaultPanelProps {
  clientId: string;
}

export function DocumentVaultPanel({ clientId }: DocumentVaultPanelProps) {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [permission, setPermission] = useState<Permission>({ view: true, edit: true, delete: false });
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRecord | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadFailures, setUploadFailures] = useState<FailedUploadItem[]>([]);
  const [uploadCategory, setUploadCategory] = useState<string>('other');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadVisibleToClient, setUploadVisibleToClient] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadProcessingMode>('parallel');

  const totalUploadBytes = useMemo(() => calculateTotalUploadSize(uploadFiles), [uploadFiles]);
  const overallUploadProgress = useMemo(() => getOverallUploadProgress(uploadQueue), [uploadQueue]);

  const loadDocuments = async () => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
      operation: 'list_documents',
      client_id: clientId,
    });
    if (error) {
      toast.error(error.message || 'Failed to load documents');
    } else if (data?.success) {
      setDocuments(data.records || []);
      if (data.permission) setPermission(data.permission);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (clientId) void loadDocuments();
  }, [clientId]);

  useEffect(() => {
    const savedMode = getPersistedUploadMode(FINANCE_UPLOAD_MODE_SCOPE, user?.id);
    if (savedMode) setUploadMode(savedMode);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) persistUploadMode(FINANCE_UPLOAD_MODE_SCOPE, user.id, uploadMode);
  }, [uploadMode, user?.id]);

  const resetUploadForm = useCallback(() => {
    setUploadFiles([]);
    setUploadQueue([]);
    setUploadFailures([]);
    setUploadCategory('other');
    setUploadDescription('');
    setUploadVisibleToClient(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const updateQueueItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setUploadQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const handleManualSelection = useCallback((files: File[]) => {
    const rejectedMessages: string[] = [];
    const acceptedFiles: File[] = [];

    files.forEach((file) => {
      if (!matchesAcceptedType(file)) {
        rejectedMessages.push(`${file.name}: Unsupported file type`);
        return;
      }
      if (file.size > MAX_FINANCE_UPLOAD_FILE_BYTES) {
        rejectedMessages.push(`${file.name}: File is larger than ${formatUploadBytes(MAX_FINANCE_UPLOAD_FILE_BYTES)}`);
        return;
      }
      acceptedFiles.push(file);
    });

    if (rejectedMessages.length > 0) {
      toast.error('Some files were rejected', {
        description: rejectedMessages.slice(0, 6).join(' • '),
      });
    }

    if (!acceptedFiles.length) return;

    // One decision, shared with the client Files tray: add rather than
    // replace, never stage the same file twice, and name whatever a cap
    // excluded. This used to raise its notices from inside the updater —
    // which React may run more than once — and `mergeFilesWithLimit` dropped
    // the excess with a `slice`, so the eleventh file simply was not there.
    const staged = stageUploadFiles(uploadFiles, acceptedFiles, {
      maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
      maxTotalBytes: MAX_DOCUMENT_BATCH_BYTES,
      formatBytes: formatUploadBytes,
    });
    setUploadFiles(staged.files);
    for (const notice of staged.notices) toast.warning(notice);

    if (staged.added.length) setUploadFailures([]);
  }, [uploadFiles]);

  const executeUploadBatch = useCallback(async (filesToUpload: File[]) => {
    if (!filesToUpload.length) {
      toast.error('Please select at least one file');
      return;
    }

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
      const results = await runTasksByMode(queueItems, uploadMode, async (queueItem) => {
        updateQueueItem(queueItem.id, { status: 'uploading', progress: 1, error: undefined });

        const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
          operation: 'request_upload',
          client_id: clientId,
          filename: queueItem.file.name,
          mime_type: queueItem.file.type || 'application/octet-stream',
          file_size: queueItem.file.size,
          category: uploadCategory,
          description: uploadDescription || null,
          visible_to_client: uploadVisibleToClient,
        });

        if (error || !data?.success) {
          throw new Error(data?.error || error?.message || 'Failed to start upload');
        }

        await uploadSignedFileWithProgress({
          url: data.upload.signedUrl,
          file: queueItem.file,
          contentType: queueItem.file.type || 'application/octet-stream',
          onProgress: (progress) => updateQueueItem(queueItem.id, { progress }),
        });

        try {
          await invokeFinanceFunction('finance-portal-documents', {
            operation: 'confirm_upload',
            client_id: clientId,
            document_id: data.document.id,
          });
        } catch {
          // Non-fatal: the uploaded document is available even if downstream notifications need a retry.
        }

        updateQueueItem(queueItem.id, { status: 'success', progress: 100 });
        return { id: queueItem.id, file: queueItem.file };
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
        await loadDocuments();
        setUploadFiles((prev) => prev.filter((file) => failures.some((failure) => failure.file === file)));
      }

      if (successCount > 0 && failures.length === 0) {
        toast.success(`${successCount} file(s) uploaded successfully`);
        setUploadOpen(false);
        resetUploadForm();
      } else if (successCount > 0) {
        toast.warning(`${successCount} uploaded, ${failures.length} failed`);
      } else if (failures.length > 0) {
        toast.error('Upload failed', { description: failures[0].error });
      }
    } finally {
      setUploading(false);
    }
  }, [clientId, invokeFinanceFunction, loadDocuments, resetUploadForm, updateQueueItem, uploadCategory, uploadDescription, uploadMode, uploadVisibleToClient]);

  const handleUpload = async () => {
    await executeUploadBatch(uploadFiles);
  };

  const retryFailedUploads = async () => {
    await executeUploadBatch(uploadFailures.map((item) => item.file));
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    handleManualSelection(acceptedFiles);
    setUploadOpen(true);
  }, [handleManualSelection]);

  const onDropRejected = useCallback((rejections: Parameters<NonNullable<ReturnType<typeof useDropzone>['getInputProps']>>[0][]) => {
    if (!Array.isArray(rejections) || rejections.length === 0) return;
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected: (rejections) => {
      if (!rejections.length) return;
      const rejection = getRejectedFilesMessage(rejections);
      toast.error(rejection.title, { description: rejection.description });
    },
    maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
    maxSize: MAX_FINANCE_UPLOAD_FILE_BYTES,
    accept: DOCUMENT_UPLOAD_ACCEPT,
    disabled: !permission.edit || uploading,
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || []);
    handleManualSelection(nextFiles);
    event.target.value = '';
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleDownload = async (doc: DocumentRecord) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
      operation: 'get_download_url',
      client_id: clientId,
      document_id: doc.id,
    });
    if (error || !data?.success) {
      toast.error(data?.error || error?.message || 'Failed to get download link');
      return;
    }
    window.open(data.url, '_blank');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
      operation: 'delete_document',
      client_id: clientId,
      document_id: deleteTarget.id,
    });
    if (error || !data?.success) {
      toast.error(data?.error || error?.message || 'Failed to delete');
    } else {
      toast.success('Document deleted');
      void loadDocuments();
    }
    setDeleteTarget(null);
  };

  const handleToggleVisibility = async (doc: DocumentRecord) => {
    const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
      operation: 'update_document',
      client_id: clientId,
      document_id: doc.id,
      payload: { visible_to_client: !doc.visible_to_client },
    });
    if (error || !data?.success) {
      toast.error(data?.error || error?.message || 'Failed to update');
    } else {
      void loadDocuments();
    }
  };

  const filtered = filterCategory === 'all'
    ? documents
    : documents.filter((d) => d.category === filterCategory);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Document Vault
          </CardTitle>
          <CardDescription>
            Securely share payslips, IDs, statements and other documents.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORY_OPTIONS.map((category) => (
                <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {permission.edit && (
            <Button onClick={() => setUploadOpen(true)} size="sm">
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {permission.edit && (
          <div
            {...getRootProps()}
            className={[
              'rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors cursor-pointer',
              isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30',
              uploading ? 'pointer-events-none opacity-60' : '',
            ].join(' ')}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-2">
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {isDragActive ? 'Drop documents to upload' : 'Drag and drop documents here'}
                </p>
                <p className="text-xs text-muted-foreground">
                  or click to choose files. Max {formatUploadBytes(MAX_FINANCE_UPLOAD_FILE_BYTES)} each, up to {MAX_DOCUMENT_UPLOAD_FILES} files.
                </p>
                <p className="text-xs text-muted-foreground">
                  Total batch size must stay under {formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)}.
                </p>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No documents{filterCategory !== 'all' ? ' in this category' : ''} yet.</p>
            {permission.edit && filterCategory === 'all' && (
              <Button variant="link" onClick={() => setUploadOpen(true)} className="mt-2">
                Upload the first document
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate">{doc.original_filename}</p>
                    <Badge variant="secondary" className="text-xs">
                      {categoryLabel(doc.category)}
                    </Badge>
                    <SyncStatusBadge status={doc.sync_status} />
                    {doc.source_surface && <Badge variant="outline" className="text-xs">{getSurfaceLabel(doc.source_surface)}</Badge>}
                    {doc.visible_to_client && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Eye className="h-3 w-3" /> Visible to client
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatUploadBytes(doc.file_size)} • {format(new Date(doc.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {getActorLabel(doc) && <span>By {getActorLabel(doc)}</span>}
                    {getVersionNumber(doc) ? <span>v{getVersionNumber(doc)}</span> : null}
                    {getConflictReason(doc) ? <span className="text-warning">{getConflictReason(doc)}</span> : null}
                    <SyncConflictDetailsPopover record={doc} />
                  </div>
                  {doc.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{doc.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {permission.edit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggleVisibility(doc)}
                      title={doc.visible_to_client ? 'Hide from client' : 'Show to client'}
                    >
                      {doc.visible_to_client
                        ? <EyeOff className="h-4 w-4" />
                        : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => handleDownload(doc)} title="Download">
                    <Download className="h-4 w-4" />
                  </Button>
                  {(doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.original_filename)) && (
                    <FlattenPdfIconButton
                      getPdfBlob={async () => {
                        const { data, error } = await invokeFinanceFunction('finance-portal-documents', {
                          operation: 'get_download_url',
                          client_id: clientId,
                          document_id: doc.id,
                        });
                        if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to get URL');
                        return fetchPdfBlob(data.url);
                      }}
                      filename={doc.original_filename}
                      variant="ghost"
                      size="icon"
                    />
                  )}
                  {permission.delete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(doc)}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open && !uploading) resetUploadForm();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Documents</DialogTitle>
            <DialogDescription>
              Accepted types: PDF, images, Word, Excel, and CSV. Use parallel or sequential processing for this batch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="file">Files</Label>
                <Input
                  id="file"
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept={ACCEPTED_FILE_EXTENSIONS.join(',')}
                  onChange={handleInputChange}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_DOCUMENT_UPLOAD_FILES} files, {formatUploadBytes(MAX_FINANCE_UPLOAD_FILE_BYTES)} each, {formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)} per batch.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="processing">Processing</Label>
                <Select value={uploadMode} onValueChange={(value) => setUploadMode(value as UploadProcessingMode)} disabled={uploading}>
                  <SelectTrigger id="processing"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parallel">Parallel upload</SelectItem>
                    <SelectItem value="sequential">Sequential upload</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {uploadMode === 'parallel'
                    ? 'Uploads multiple files at once for faster batches.'
                    : 'Uploads one file at a time for more predictable progress.'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={uploadCategory} onValueChange={setUploadCategory} disabled={uploading}>
                  <SelectTrigger id="category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((category) => (
                      <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label htmlFor="vis" className="text-sm">Visible to client</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow the client to see uploaded files in their portal.
                  </p>
                </div>
                <Switch
                  id="vis"
                  checked={uploadVisibleToClient}
                  onCheckedChange={setUploadVisibleToClient}
                  disabled={uploading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                rows={2}
                value={uploadDescription}
                onChange={(event) => setUploadDescription(event.target.value)}
                disabled={uploading}
              />
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

            {uploadFiles.length > 0 && (
              <div className="space-y-2">
                {uploadFiles.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatUploadBytes(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeUploadFile(index)} disabled={uploading}>
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
                        <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
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
                      <p className="text-xs text-muted-foreground">Review the errors and retry only the failed files.</p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void retryFailedUploads()} disabled={uploading}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={() => void handleUpload()} disabled={uploading || uploadFiles.length === 0}>
              {uploading
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</>
                : <><Upload className="h-4 w-4 mr-2" /> Upload {uploadFiles.length || ''}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{deleteTarget?.original_filename}</span> will be removed permanently. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

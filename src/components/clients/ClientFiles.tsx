import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { 
  FileUp, 
  File, 
  FileText, 
  Image, 
  FileSpreadsheet,
  Download,
  Trash2,
  Loader2,
  Upload,
  Send,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { stageUploadFiles } from '@/lib/uploads/stageUploadFiles.pure';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useNotifications } from '@/contexts/NotificationsContext';
import { secureStorageDownload, secureStorageDelete } from '@/hooks/useSecureStorage';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useAuth } from '@/hooks/useAuth';
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
  uploadSecureStorageFileWithProgress,
} from '@/lib/documentUpload';
import { getActorLabel, getConflictReason, getSurfaceLabel, getVersionNumber } from '@/lib/syncDisplay';

const DASHBOARD_UPLOAD_MODE_SCOPE = 'dashboard-client-files';

interface ClientFilesProps {
  clientId: string;
  onSendEmail?: (file: { id: string; file_name: string; file_path: string }) => void;
}

interface FailedUploadItem {
  id: string;
  file: File;
  fileName: string;
  error: string;
}

const fileCategories = [
  { value: 'general', label: 'General' },
  { value: 'contract', label: 'Contract' },
  { value: 'id', label: 'ID Document' },
  { value: 'financial', label: 'Financial' },
  { value: 'property', label: 'Property' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other', label: 'Other' },
];

const categoryColors: Record<string, string> = {
  general: 'bg-muted/10 text-muted-foreground',
  contract: 'bg-info/10 text-info',
  id: 'bg-accent/10 text-accent',
  financial: 'bg-success/10 text-success',
  property: 'bg-warning/10 text-warning',
  correspondence: 'bg-info/10 text-info',
  other: 'bg-muted/10 text-muted-foreground',
};

/**
 * Secure fetch for files data using HttpOnly cookies
 */
async function fetchFilesSecure(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: { files: true },
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error('Failed to fetch files');
  return data.files || [];
}

export function ClientFiles({ clientId, onSendEmail }: ClientFilesProps) {
  const [uploading, setUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [uploadMode, setUploadMode] = useState<UploadProcessingMode>('parallel');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadFailures, setUploadFailures] = useState<FailedUploadItem[]>([]);
  const queryClient = useQueryClient();
  const { addNotification } = useNotifications();
  const { user } = useAuth();
  const totalUploadBytes = useMemo(() => calculateTotalUploadSize(selectedFiles), [selectedFiles]);
  const overallUploadProgress = useMemo(() => getOverallUploadProgress(uploadQueue), [uploadQueue]);

  useEffect(() => {
    const savedMode = getPersistedUploadMode(DASHBOARD_UPLOAD_MODE_SCOPE, user?.id);
    if (savedMode) setUploadMode(savedMode);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) persistUploadMode(DASHBOARD_UPLOAD_MODE_SCOPE, user.id, uploadMode);
  }, [uploadMode, user?.id]);

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['client-files', clientId],
    queryFn: () => fetchFilesSecure(clientId),
  });

  const uploadFileMutation = useMutation<{ successes: any[]; failures: FailedUploadItem[] }, Error, { files: File[]; category: string; description: string }>({
    mutationFn: async ({ files, category, description }: { files: File[]; category: string; description: string }) => {
      setUploading(true);

      const queueItems = createUploadQueueItems(files);
      setUploadQueue(queueItems);
      setUploadFailures([]);

      const results = await runTasksByMode(queueItems, uploadMode, async (queueItem, index) => {
        setUploadQueue((prev) => prev.map((item) => item.id === queueItem.id ? { ...item, status: 'uploading', progress: 1, error: undefined } : item));
        const fileName = `${clientId}/${Date.now()}_${index}_${queueItem.file.name}`;

        const uploadResult = await uploadSecureStorageFileWithProgress({
          bucket: 'client-files',
          path: fileName,
          file: queueItem.file,
          contentType: queueItem.file.type,
          // `secure-storage` derives the destination path, the owner and the
          // client binding from a server-side authoritative row, so
          // `resolveHumanUploadBinding` requires the row's id on every bucket
          // but `branding-assets` and `report-templates`. This call never sent
          // one, so every file an adviser dropped here was refused 403 with
          // "This upload did not say which record it belongs to" — the 19 Sep
          // audit's Files-tab defect, on both the prime and the clone.
          //
          // The contract was already pinned once, for `secureStorageUpload`.
          // This is a second helper posting the same operation, so the guard
          // could not see it; it scans both now.
          resourceType: 'client',
          resourceId: clientId,
          clientId,
          onProgress: (progress) => {
            setUploadQueue((prev) => prev.map((item) => item.id === queueItem.id ? { ...item, progress } : item));
          },
        });

        const payload = {
          file_name: queueItem.file.name,
          file_path: uploadResult.path || fileName,
          file_type: queueItem.file.type,
          file_size: queueItem.file.size,
          category,
          description: description || null,
        };

        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'create',
          table: 'client_files',
          clientId,
          data: payload,
        });

        if (error) throw new Error(error.message);
        if (!data?.success) throw new Error(data?.error || 'Failed to save file record');

        setUploadQueue((prev) => prev.map((item) => item.id === queueItem.id ? { ...item, status: 'success', progress: 100 } : item));
        return { id: queueItem.id, file: queueItem.file, result: data.result };
      });

      const successes = results.filter((result): result is PromiseFulfilledResult<{ id: string; file: File; result: any }> => result.status === 'fulfilled');
      const failures = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        const queueItem = queueItems[index];
        const error = result.reason?.message || 'Upload failed';
        setUploadQueue((prev) => prev.map((item) => item.id === queueItem.id ? { ...item, status: 'failed', progress: 100, error } : item));
        return [{ id: queueItem.id, file: queueItem.file, fileName: queueItem.file.name, error }];
      });

      if (successes.length === 0) throw new Error(failures[0]?.error || 'Upload failed');
      return { successes: successes.map((item) => item.value.result), failures };
    },
    onSuccess: (result: { successes: any[]; failures: FailedUploadItem[] }) => {
      queryClient.invalidateQueries({ queryKey: ['client-files', clientId] });
      logActivityDirect({
        actionType: 'client_file_uploaded',
        entityType: 'client_file',
        entityId: clientId,
        metadata: { category: selectedCategory }
      });
      if (result.failures.length === 0) {
        toast.success(`${result.successes.length} file(s) uploaded successfully`);
      } else {
        toast.warning(`${result.successes.length} uploaded, ${result.failures.length} failed`);
      }
      setUploadFailures(result.failures);
      setSelectedFiles((prev) => prev.filter((file) => result.failures.some((failure) => failure.file === file)));
      setDescription('');
    },
    onError: (error) => {
      toast.error('Failed to upload file: ' + error.message);
    },
    onSettled: () => {
      setUploading(false);
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (file: { id: string; file_path: string }) => {
      // Delete from storage via secure Edge Function
      const deleteResult = await secureStorageDelete('client-files', file.file_path);

      if (!deleteResult.success) console.warn('Storage delete failed:', deleteResult.error);

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_files',
        clientId,
        recordId: file.id,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete file');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-files', clientId] });
      logActivityDirect({
        actionType: 'client_file_deleted',
        entityType: 'client_file',
        entityId: clientId,
      });
      toast.success('File deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete file: ' + error.message);
    }
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    // A pick ADDS. This used to be `setSelectedFiles(acceptedFiles)`, so
    // choosing documents one at a time — which is what you do when they are
    // in different folders — discarded everything already staged, silently.
    // `stageUploadFiles` also refuses a file already in the tray and NAMES
    // anything a cap excluded, which `slice` never did.
    const staged = stageUploadFiles(selectedFiles, acceptedFiles, {
      maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
      maxTotalBytes: MAX_DOCUMENT_BATCH_BYTES,
      formatBytes: formatUploadBytes,
    });
    setSelectedFiles(staged.files);
    if (staged.added.length) setUploadFailures([]);
    // Raised here rather than inside the updater: React may run an updater
    // more than once, and a message that appears twice reads as two problems.
    for (const notice of staged.notices) toast.warning(notice);
  }, [selectedFiles]);

  const onDropRejected = useCallback((rejections: any[]) => {
    if (!rejections.length) return;
    const rejection = getRejectedFilesMessage(rejections);
    toast.error(rejection.title, { description: rejection.description });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    maxFiles: MAX_DOCUMENT_UPLOAD_FILES,
    maxSize: 10 * 1024 * 1024, // 10MB
    accept: DOCUMENT_UPLOAD_ACCEPT,
  });

  const handleUpload = () => {
    if (!selectedFiles.length) return;
    uploadFileMutation.mutate({ files: selectedFiles, category: selectedCategory, description });
  };

  const retryFailedUploads = () => {
    if (!uploadFailures.length) return;
    uploadFileMutation.mutate({
      files: uploadFailures.map((item) => item.file),
      category: selectedCategory,
      description,
    });
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const downloadFile = async (file: { file_path: string; file_name: string }) => {
    const result = await secureStorageDownload('client-files', file.file_path);

    if (!result.success || !result.blob) {
      toast.error('Failed to download file: ' + (result.error || 'Unknown error'));
      return;
    }

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getFileIcon = (fileType: string | null) => {
    if (!fileType) return File;
    if (fileType.startsWith('image/')) return Image;
    if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) return FileSpreadsheet;
    if (fileType.includes('pdf') || fileType.includes('document')) return FileText;
    return File;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Upload Files
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {fileCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Select value={uploadMode} onValueChange={(value) => setUploadMode(value as UploadProcessingMode)}>
              <SelectTrigger>
                <SelectValue placeholder="Processing mode" />
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
            className={`
              border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
              transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
              ${uploading ? 'pointer-events-none opacity-50' : ''}
            `}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Uploading...</p>
              </div>
            ) : isDragActive ? (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-primary" />
                 <p className="text-sm text-primary">Drop files here</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                   Drag & drop or click to upload multiple files
                </p>
                 <p className="text-xs text-muted-foreground">Max 10MB each • up to {MAX_DOCUMENT_UPLOAD_FILES} files</p>
                 <p className="text-xs text-muted-foreground">
                   {uploadMode === 'parallel' ? 'Files upload together for faster batches.' : 'Files upload one-by-one for steadier progress.'}
                 </p>
                 <p className="text-xs text-muted-foreground">Batch total must stay under {formatUploadBytes(MAX_DOCUMENT_BATCH_BYTES)}.</p>
              </div>
            )}
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSelectedFile(index)} disabled={uploading}>
                    <Trash2 className="h-3.5 w-3.5" />
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
                    <p className="text-sm font-medium text-foreground">{failure.file.name}</p>
                    <p className="mt-1 text-xs text-destructive">{failure.error}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleUpload} disabled={uploading || selectedFiles.length === 0} className="w-full gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Uploading...' : `Upload ${selectedFiles.length} file(s)`}
          </Button>
        </CardContent>
      </Card>

      {/* Files List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : files.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <File className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No files uploaded</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            Files ({files.length})
          </h4>
          {files.map((file: any) => {
            const Icon = getFileIcon(file.file_type);
            
            return (
              <Card key={file.id} className="group">
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-secondary">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{file.file_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge className={categoryColors[file.category]}>
                        {file.category}
                      </Badge>
                      <SyncStatusBadge status={file.sync_status} />
                      {file.source_surface && (
                        <Badge variant="outline" className="text-xs">{getSurfaceLabel(file.source_surface)}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.file_size)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(file.uploaded_at), 'MMM d, yyyy')}
                      </span>
                    </div>
                    {file.description && (
                      <p className="text-xs text-muted-foreground mt-1">{file.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {getActorLabel(file) && <span>By {getActorLabel(file)}</span>}
                      {getVersionNumber(file) ? <span>v{getVersionNumber(file)}</span> : null}
                      {getConflictReason(file) ? <span className="text-warning">{getConflictReason(file)}</span> : null}
                      <SyncConflictDetailsPopover record={file} />
                    </div>
                  </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onSendEmail && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => {
                            onSendEmail(file);
                            addNotification({
                              type: 'client_file_shared',
                              title: 'File Shared',
                              message: `${file.file_name} shared via email`,
                              entityId: clientId
                            });
                          }}
                          title="Send via Email"
                        >
                          <Send className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => downloadFile(file)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => deleteFileMutation.mutate(file)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

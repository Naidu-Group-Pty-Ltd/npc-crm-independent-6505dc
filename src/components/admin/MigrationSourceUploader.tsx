import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Loader2, Upload, FileSpreadsheet, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

type UploadDomain = 'contacts' | 'opportunities' | 'conversations' | 'conversations_replay';

interface StagedUpload {
  id: string;
  domain: UploadDomain;
  file_name: string | null;
  row_count: number;
  notes: string | null;
  created_at: string;
  status?: string;
  progress_percent?: number;
  expected_rows?: number | null;
}

interface MigrationSourceUploaderProps {
  domain: UploadDomain;
  selectedUploadId: string | null;
  onSelect: (id: string | null, summary?: { rowCount: number; fileName: string | null }) => void;
}

const ACCEPT = {
  'text/csv': ['.csv'],
  'application/vnd.ms-excel': ['.csv', '.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
} as const;

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB raw
const MAX_ROWS = 200_000;

// Smaller chunks (250 rows) keep request bodies well under the edge
// function's ~6 MB cap even when GHL exports carry wide rows with verbose
// custom fields. Combined with concurrency=3 this is still fast (~3 chunks/s
// for typical exports) and the small unit means a single failure surfaces
// quickly with most of the upload already persisted.
const CHUNK_SIZE = 250;
const APPEND_CONCURRENCY = 3;

async function parseFile(file: File): Promise<Record<string, any>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('No worksheets found in file');
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: false });
  return rows.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
}

export function MigrationSourceUploader({
  domain,
  selectedUploadId,
  onSelect,
}: MigrationSourceUploaderProps) {
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [recents, setRecents] = useState<StagedUpload[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(false);
  const [progress, setProgress] = useState<{ uploaded: number; total: number; percent: number; phase: string } | null>(null);

  const refreshRecents = useCallback(async () => {
    setLoadingRecents(true);
    try {
      const res = await invokeSecureFunction<{ uploads: StagedUpload[] }>('migration-upload-source', {
        action: 'list',
        domain,
      });
      if (res.data?.uploads) setRecents(res.data.uploads);
    } finally {
      setLoadingRecents(false);
    }
  }, [domain]);

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

  const handleUpload = useCallback(
    async (file: File) => {
      setParseError(null);
      setProgress(null);
      if (file.size > MAX_FILE_BYTES) {
        setParseError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
        return;
      }
      setParsing(true);
      let records: Record<string, any>[] = [];
      try {
        records = await parseFile(file);
      } catch (err: any) {
        setParseError(err?.message || 'Failed to parse file');
        setParsing(false);
        return;
      }
      setParsing(false);
      if (records.length === 0) {
        setParseError('File contains no data rows.');
        return;
      }
      if (records.length > MAX_ROWS) {
        setParseError(`Too many rows: ${records.length}. Cap is ${MAX_ROWS}. Split and upload in batches.`);
        return;
      }

      setUploading(true);
      setProgress({ uploaded: 0, total: records.length, percent: 0, phase: 'Creating upload…' });

      try {
        // 1) Create empty parent row with expected_rows so progress % is exact.
        const createRes = await invokeSecureFunction<{ upload: StagedUpload }>(
          'migration-upload-source',
          {
            action: 'create',
            domain,
            file_name: file.name,
            expected_rows: records.length,
          },
        );
        if (createRes.error || !createRes.data?.upload) {
          toast.error(createRes.error?.message || 'Upload failed (create)');
          return;
        }
        const uploadId = createRes.data.upload.id;

        // 2) Build chunk list, then upload with bounded concurrency.
        const chunks: { index: number; rows: Record<string, any>[] }[] = [];
        for (let offset = 0, idx = 0; offset < records.length; offset += CHUNK_SIZE, idx++) {
          chunks.push({ index: idx, rows: records.slice(offset, offset + CHUNK_SIZE) });
        }

        let uploadedRows = 0;
        let failed: { index: number; message: string } | null = null;

        const worker = async (queue: typeof chunks) => {
          while (queue.length > 0 && !failed) {
            const next = queue.shift();
            if (!next) return;
            const res = await invokeSecureFunction<{ progress: { row_count: number; progress_percent: number } }>(
              'migration-upload-source',
              {
                action: 'append_chunk',
                upload_id: uploadId,
                chunk_index: next.index,
                records: next.rows,
                expected_rows: records.length,
              },
            );
            if (res.error) {
              const msg = res.error.message || 'unknown error';
              failed = { index: next.index, message: msg };
              // Surface IMMEDIATELY so the user sees what happened instead
              // of a stuck-looking spinner. The aggregate toast still fires
              // below for the user-visible "delete + retry" guidance.
              toast.error(`Upload chunk ${next.index} failed: ${msg.substring(0, 200)}`, {
                duration: 10_000,
              });
              console.error(
                `[MigrationSourceUploader] append_chunk failed`,
                { uploadId, chunkIndex: next.index, rows: next.rows.length, error: res.error },
              );
              return;
            }
            uploadedRows += next.rows.length;
            const serverTotal = res.data?.progress?.row_count ?? uploadedRows;
            const serverPct = res.data?.progress?.progress_percent ?? Math.round((uploadedRows / records.length) * 100);
            setProgress({
              uploaded: serverTotal,
              total: records.length,
              percent: Math.min(99, serverPct),
              phase: 'Uploading rows…',
            });
          }
        };

        const queue = [...chunks];
        await Promise.all(
          Array.from({ length: Math.min(APPEND_CONCURRENCY, queue.length) }, () => worker(queue)),
        );

        if (failed) {
          toast.error(
            `Stopped at chunk ${failed.index} (${(failed.index * CHUNK_SIZE).toLocaleString('en-AU')} of ${records.length.toLocaleString('en-AU')} rows). Delete the partial upload below and retry.`,
            { duration: 12_000 },
          );
          // Refresh the list so the user can see and delete the partial row.
          await refreshRecents();
          return;
        }

        // 3) Finalize → consolidate chunks into records JSONB so workers read unchanged.
        setProgress({ uploaded: records.length, total: records.length, percent: 99, phase: 'Finalizing…' });
        const finRes = await invokeSecureFunction<{ upload: StagedUpload }>(
          'migration-upload-source',
          { action: 'finalize', upload_id: uploadId },
        );
        if (finRes.error || !finRes.data?.upload) {
          toast.error(finRes.error?.message || 'Finalize failed');
          return;
        }

        setProgress({ uploaded: records.length, total: records.length, percent: 100, phase: 'Done' });
        toast.success(`Staged ${finRes.data.upload.row_count.toLocaleString('en-AU')} ${domain} rows from ${file.name}`);
        onSelect(uploadId, {
          rowCount: finRes.data.upload.row_count,
          fileName: finRes.data.upload.file_name,
        });
        await refreshRecents();
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        setUploading(false);
        // Keep the final progress visible briefly for user feedback
        setTimeout(() => setProgress(null), 2500);
      }
    },
    [domain, onSelect, refreshRecents],
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (!accepted.length) return;
      handleUpload(accepted[0]);
    },
    [handleUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open: openFilePicker } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxFiles: 1,
    multiple: false,
    disabled: parsing || uploading,
    noClick: false,
    noKeyboard: false,
  });

  const selected = useMemo(
    () => recents.find((r) => r.id === selectedUploadId) || null,
    [recents, selectedUploadId],
  );

  const removeUpload = async (id: string) => {
    const ok = window.confirm('Delete this staged upload? Any in-flight job using it will fail.');
    if (!ok) return;
    const res = await invokeSecureFunction('migration-upload-source', { action: 'delete', upload_id: id });
    if (res.error) {
      toast.error(res.error.message || 'Delete failed');
      return;
    }
    if (id === selectedUploadId) onSelect(null);
    toast.success('Upload deleted');
    refreshRecents();
  };

  return (
    <Card className="border-primary/30 bg-muted/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          Upload {domain} from CSV / XLSX
          <Badge variant="outline" className="text-[10px]">Bypass live legacy fetch</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          When a staged upload is selected, the worker iterates these rows instead of paginating the
          legacy GHL account. Recommended when live data and snapshots are out of sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors ${
            isDragActive ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/60'
          } ${parsing || uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input {...getInputProps()} />
          {parsing || uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
          <div className="text-xs">
            {parsing
              ? 'Parsing file…'
              : uploading
                ? progress?.phase || 'Staging records…'
                : isDragActive
                  ? 'Drop the file here'
                  : 'Drag & drop a CSV or XLSX file, or click to browse'}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Accepts .csv, .xlsx · Max 50 MB · Max {MAX_ROWS.toLocaleString('en-AU')} rows
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 h-8"
            disabled={parsing || uploading}
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
          >
            <Upload className="mr-1 h-3 w-3" />
            Browse files
          </Button>
        </div>

        {progress && (
          <div className="space-y-1">
            <Progress value={progress.percent} className="h-2" />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{progress.phase}</span>
              <span>
                {progress.uploaded.toLocaleString('en-AU')} / {progress.total.toLocaleString('en-AU')} rows ·{' '}
                {progress.percent}%
              </span>
            </div>
          </div>
        )}

        {parseError && (
          <Alert className="border-destructive/40 bg-destructive/5 py-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            <AlertDescription className="text-[11px] text-destructive">{parseError}</AlertDescription>
          </Alert>
        )}

        {selected && (
          <Alert className="border-primary/40 bg-primary/5 py-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            <AlertDescription className="flex items-center justify-between gap-2 text-[11px]">
              <span>
                Active source: <strong>{selected.file_name || selected.id.substring(0, 8)}</strong> ·{' '}
                {selected.row_count.toLocaleString('en-AU')} rows
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onSelect(null)}>
                Use live GHL instead
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {recents.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">
              Recent {domain} uploads
            </div>
            <div className="overflow-x-auto rounded border border-border/40">
              <table className="w-full text-[11px] min-w-[520px]">
                <thead className="bg-muted/30 uppercase text-muted-foreground">
                  <tr>
                    <th className="p-1.5 text-left">File</th>
                    <th className="p-1.5 text-right">Rows</th>
                    <th className="p-1.5 text-left">Status</th>
                    <th className="p-1.5 text-left">When</th>
                    <th className="p-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {recents.map((u) => (
                    <tr
                      key={u.id}
                      className={`border-t border-border/30 ${u.id === selectedUploadId ? 'bg-primary/10' : ''}`}
                    >
                      <td className="p-1.5 font-mono text-[10px]">
                        {u.file_name || u.id.substring(0, 8)}
                      </td>
                      <td className="p-1.5 text-right">{u.row_count.toLocaleString('en-AU')}</td>
                      <td className="p-1.5">
                        {u.status === 'ready' ? (
                          <Badge variant="outline" className="text-[9px] text-success">ready</Badge>
                        ) : u.status === 'failed' ? (
                          <Badge variant="outline" className="text-[9px] text-destructive">failed</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px]">{u.status || 'ready'}{u.progress_percent != null && u.status === 'uploading' ? ` ${u.progress_percent}%` : ''}</Badge>
                        )}
                      </td>
                      <td className="p-1.5 text-muted-foreground">
                        {new Date(u.created_at).toLocaleString('en-AU')}
                      </td>
                      <td className="flex items-center justify-end gap-1 p-1.5">
                        {u.id === selectedUploadId ? (
                          <Badge variant="default" className="text-[9px]">SELECTED</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            disabled={u.status !== 'ready'}
                            onClick={() =>
                              onSelect(u.id, { rowCount: u.row_count, fileName: u.file_name })
                            }
                          >
                            Use
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => removeUpload(u.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={refreshRecents}
              disabled={loadingRecents}
            >
              {loadingRecents ? 'Refreshing…' : 'Refresh list'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

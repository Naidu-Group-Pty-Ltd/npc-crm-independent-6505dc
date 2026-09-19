/**
 * Batch 9 — Scan to Upload.
 * Mobile-first capture: opens device camera (capture="environment") for one
 * or more pages then runs the standard finance-portal-documents flow:
 *   request_upload → PUT(signedUrl) → confirm_upload [→ link_document].
 */
import { useRef, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Upload, X, FileImage } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  purchaseFileId: string;
  clientId: string;
  instanceId?: string | null;
  category?: string;
  label?: string;
  onUploaded?: () => void;
}

export function ScanToUploadButton({
  purchaseFileId,
  clientId,
  instanceId = null,
  category = 'other',
  label = 'Scan / upload',
  onUploaded,
}: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (list.length) setFiles((prev) => [...prev, ...list]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const uploadOne = async (file: File) => {
    const { data: reqData, error: reqErr } = await invokeFinanceFunction(
      'finance-portal-documents',
      {
        operation: 'request_upload',
        client_id: clientId,
        filename: file.name,
        mime_type: file.type || 'image/jpeg',
        file_size: file.size,
        category,
        visible_to_client: false,
      },
    );
    if (reqErr || !reqData?.upload?.signedUrl) throw new Error(reqErr?.message || 'request_upload failed');

    const putRes = await fetch(reqData.upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    });
    if (!putRes.ok) throw new Error(`Storage PUT failed (${putRes.status})`);

    const docId = reqData.document?.id;
    await invokeFinanceFunction('finance-portal-documents', {
      operation: 'confirm_upload',
      client_id: clientId,
      document_id: docId,
    });

    if (instanceId && docId) {
      await invokeFinanceFunction('finance-portal-document-requirements', {
        operation: 'link_document',
        requirement_id: instanceId,
        document_id: docId,
      });
    }
  };

  const upload = async () => {
    if (!files.length) {
      inputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      for (const f of files) await uploadOne(f);
      toast.success(`Uploaded ${files.length} page${files.length > 1 ? 's' : ''}`);
      setFiles([]);
      onUploaded?.();
    } catch (e: any) {
      toast.error(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        capture="environment"
        onChange={onPick}
        className="hidden"
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="flex-1">
          <Camera className="h-4 w-4 mr-1.5" /> {label}
        </Button>
        {files.length > 0 && (
          <Button size="sm" onClick={upload} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            Send {files.length}
          </Button>
        )}
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
              <span className="flex items-center gap-1 truncate">
                <FileImage className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </span>
              <button
                onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

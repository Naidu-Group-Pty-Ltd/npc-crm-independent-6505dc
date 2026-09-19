import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Download, FileText, Loader2, Pencil, Plus, Trash2, Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatMatterDate } from '@/lib/legalMatters';
import {
  DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_OPTIONS, DOCUMENT_OWNER_LABELS,
  DOCUMENT_OWNER_OPTIONS, DOCUMENT_STATUS_CLASSES, DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_OPTIONS, formatFileSize, isDocumentOverdue,
  type LegalDocumentCategory, type LegalDocumentOwner, type LegalDocumentStatus,
  type LegalMatterDocument,
} from '@/lib/legalDocuments';

export interface DocumentDraft {
  id: string | null;
  category: LegalDocumentCategory;
  label: string;
  description: string;
  owner: LegalDocumentOwner;
  due_date: string;
  visible_to_client: boolean;
  visible_to_npc: boolean;
}

const EMPTY_DOCUMENT: DocumentDraft = {
  id: null,
  category: 'other',
  label: '',
  description: '',
  owner: 'solicitor',
  due_date: '',
  visible_to_client: false,
  visible_to_npc: true,
};

export interface MatterDocumentsPanelProps {
  documents: LegalMatterDocument[];
  canEdit: boolean;
  canDelete: boolean;
  saving?: boolean;
  onSave: (draft: DocumentDraft) => Promise<void> | void;
  onSetStatus: (documentId: string, status: LegalDocumentStatus) => Promise<void> | void;
  onUpload: (documentId: string, file: File) => Promise<void> | void;
  onDownload: (documentId: string) => Promise<void> | void;
  onDelete: (documentId: string) => Promise<void> | void;
  onSetAiPermission?: (documentId:string, allow:boolean) => Promise<void> | void;
}

export function MatterDocumentsPanel({
  documents, canEdit, canDelete, saving, onSave, onSetStatus, onUpload, onDownload, onDelete, onSetAiPermission,
}: MatterDocumentsPanelProps) {
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadId = useRef<string | null>(null);

  const outstanding = useMemo(
    () => documents.filter((d) => ['requested', 'uploaded', 'under_review', 'rejected'].includes(d.status)).length,
    [documents],
  );

  const openEdit = (doc?: LegalMatterDocument) => {
    setDraft(doc
      ? {
          id: doc.id,
          category: doc.category,
          label: doc.label,
          description: doc.description ?? '',
          owner: doc.owner,
          due_date: (doc.due_date ?? '').slice(0, 10),
          visible_to_client: doc.visible_to_client,
          visible_to_npc: doc.visible_to_npc,
        }
      : { ...EMPTY_DOCUMENT });
  };

  const triggerUpload = (documentId: string) => {
    pendingUploadId.current = documentId;
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    const documentId = pendingUploadId.current;
    pendingUploadId.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !documentId) return;
    setUploadingId(documentId);
    try {
      await onUpload(documentId, file);
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Document register</CardTitle>
          <CardDescription>
            Matter-scoped documents. {outstanding} outstanding of {documents.length}.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => openEdit()}>
            <Plus className="mr-2 h-4 w-4" /> Request document
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-label="Upload document file"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        {documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No documents yet. Request one from the client or upload the contract to start the register.
          </p>
        ) : null}

        {documents.map((doc) => {
          const overdue = isDocumentOverdue(doc);
          return (
            <div
              key={doc.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{doc.label}</span>
                  <Badge variant="outline" className={cn('text-xs', DOCUMENT_STATUS_CLASSES[doc.status])}>
                    {DOCUMENT_STATUS_LABELS[doc.status]}
                  </Badge>
                  {overdue ? (
                    <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Overdue
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_CATEGORY_LABELS[doc.category]} · {DOCUMENT_OWNER_LABELS[doc.owner]}
                  {doc.due_date ? ` · due ${formatMatterDate(doc.due_date)}` : ''}
                  {doc.file_name ? ` · ${doc.file_name} (${formatFileSize(doc.file_size)})` : ''}
                </p>
                {doc.review_notes ? (
                  <p className="text-xs text-muted-foreground">Review: {doc.review_notes}</p>
                ) : null}
                {doc.malware_scan_status && doc.malware_scan_status !== 'clean' ? (
                  <Badge variant="outline" className="w-fit text-xs">
                    {doc.malware_scan_status === 'infected' ? 'Security scan rejected' : doc.malware_scan_status === 'error' ? 'Security scan requires retry' : 'Security scan pending'}
                  </Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEdit && onSetAiPermission && doc.current_version_id ? <label className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"><Switch checked={doc.allow_external_ai===true} onCheckedChange={(checked)=>void onSetAiPermission(doc.id,checked)} aria-label={`Allow external AI processing for ${doc.label}`}/>AI processing</label> : null}
                {canEdit && doc.current_version_id !== undefined ? (
                  doc.malware_scan_status === 'clean' && doc.status !== 'accepted' ? (
                    <Button size="sm" variant="outline" onClick={() => void onSetStatus(doc.id, 'accepted')}>Review and accept</Button>
                  ) : <Badge variant="outline">{DOCUMENT_STATUS_LABELS[doc.status] || doc.status}</Badge>
                ) : canEdit ? (
                  <Select
                    value={doc.status}
                    onValueChange={(v) => void onSetStatus(doc.id, v as LegalDocumentStatus)}
                  >
                    <SelectTrigger className="h-9 w-[150px]" aria-label={`Status for ${doc.label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                {canEdit ? (
                  <Button
                    size="sm" variant="outline" disabled={uploadingId === doc.id}
                    onClick={() => triggerUpload(doc.id)}
                  >
                    {uploadingId === doc.id
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Upload className="mr-2 h-4 w-4" />}
                    {doc.storage_path ? 'Upload new version' : 'Upload'}
                  </Button>
                ) : null}

                {doc.storage_path && (!doc.malware_scan_status || doc.malware_scan_status === 'clean') ? (
                  <Button size="sm" variant="outline" onClick={() => void onDownload(doc.id)}>
                    <Download className="mr-2 h-4 w-4" /> Open
                  </Button>
                ) : null}

                {canEdit ? (
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(doc)}>
                    <Pencil className="h-4 w-4" aria-label={`Edit ${doc.label}`} />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => void onDelete(doc.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${doc.label}`} />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit document' : 'Request document'}</DialogTitle>
            <DialogDescription>
              Requested documents appear on the client's action list when shared.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="doc-label">Label</Label>
                <Input
                  id="doc-label" value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as LegalDocumentCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Responsible</Label>
                  <Select
                    value={draft.owner}
                    onValueChange={(v) => setDraft({ ...draft, owner: v as LegalDocumentOwner })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_OWNER_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>{DOCUMENT_OWNER_LABELS[o]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="doc-due">Due date</Label>
                <Input
                  id="doc-due" type="date" value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="doc-desc">Description</Label>
                <Textarea
                  id="doc-desc" rows={3} value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="doc-client">Share with client</Label>
                  <p className="text-xs text-muted-foreground">Visible in the Client Portal.</p>
                </div>
                <Switch
                  id="doc-client" checked={draft.visible_to_client}
                  onCheckedChange={(v) => setDraft({ ...draft, visible_to_client: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="doc-npc">Share with NPC</Label>
                  <p className="text-xs text-muted-foreground">Visible to the Command Centre team.</p>
                </div>
                <Switch
                  id="doc-npc" checked={draft.visible_to_npc}
                  onCheckedChange={(v) => setDraft({ ...draft, visible_to_npc: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={saving || !draft?.label.trim()}
              onClick={async () => {
                if (!draft) return;
                await onSave(draft);
                setDraft(null);
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default MatterDocumentsPanel;

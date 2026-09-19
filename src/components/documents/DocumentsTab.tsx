import { useState } from 'react';
import { format } from 'date-fns';
import { FileText, Send, Plus, FileCheck2, Clock, FileSignature, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useGeneratedDocuments, TEMPLATE_TYPE_LABEL,
  type GeneratedDocStatus, type TemplateDocType, type GeneratedDocument,
} from '@/hooks/useGeneratedDocuments';
import { PrepareForSigningModal, type SigningRecipient } from '@/components/agreements/PrepareForSigningModal';
import { EnvelopeStatusDialog, DocuSignStatusBadge } from '@/components/agreements/EnvelopeStatusDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const DOC_BUCKET = 'client-documents';

interface Props {
  clientId?: string;
  dealId?: string | null;
  submissionId?: string | null;
}

const STATUS_TONE: Record<GeneratedDocStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  generated: 'bg-info/10 text-info border-info/30',
  sent: 'bg-brand-500/10 text-brand-700 border-brand-500/30',
  viewed: 'bg-accent/10 text-accent border-accent/30',
  signed: 'bg-success/10 text-success border-success/30',
  voided: 'bg-destructive/10 text-destructive border-destructive/30',
  expired: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function DocumentsTab({ clientId, dealId, submissionId }: Props) {
  const { documents, isLoading, create, updateStatus, remove } = useGeneratedDocuments({ clientId, dealId: dealId || undefined, submissionId: submissionId || undefined });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ template_type: TemplateDocType; title: string; sent_to: string; shared_with_client: boolean }>({
    template_type: 'loan_application', title: '', sent_to: '', shared_with_client: false,
  });
  const [signingDoc, setSigningDoc] = useState<GeneratedDocument | null>(null);
  const [signingPdfUrl, setSigningPdfUrl] = useState('');
  const [statusDoc, setStatusDoc] = useState<GeneratedDocument | null>(null);

  const openPrepareForSigning = async (d: GeneratedDocument) => {
    if (!d.pdf_storage_path) { toast.error('PDF not ready yet'); return; }
    const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(d.pdf_storage_path, 600);
    if (error || !data?.signedUrl) { toast.error(`Failed to load PDF: ${error?.message}`); return; }
    setSigningPdfUrl(data.signedUrl);
    setSigningDoc(d);
  };

  const handleCreate = () => {
    if (!form.title) return;
    const sent_to = form.sent_to ? form.sent_to.split(',').map(s => s.trim()).filter(Boolean) : null;
    create({
      client_id: clientId || null,
      deal_id: dealId || null,
      submission_id: submissionId || null,
      template_type: form.template_type,
      title: form.title,
      status: 'draft',
      sent_to,
      shared_with_client: form.shared_with_client,
    });
    setOpen(false);
    setForm({ template_type: 'loan_application', title: '', sent_to: '', shared_with_client: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Generated Documents
          </h3>
          <p className="text-xs text-muted-foreground">Loan applications, cover letters, and other documents</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="gap-1">
          <Plus className="h-4 w-4" /> New Document
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-32 w-full" /> : documents.length === 0 ? (
        <Card><CardContent className="text-center py-8 text-sm text-muted-foreground">No documents generated yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {documents.map(d => (
            <Card key={d.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{d.title}</CardTitle>
                    <p className="text-xs text-muted-foreground">{TEMPLATE_TYPE_LABEL[d.template_type]}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={`text-[10px] border ${STATUS_TONE[d.status]} capitalize`}>{d.status}</Badge>
                    {d.docusign_envelope_id && d.docusign_status && (
                      <DocuSignStatusBadge status={d.docusign_status} />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-xs space-y-1 pt-0">
                <div className="flex justify-between text-muted-foreground">
                  <span><Clock className="inline h-3 w-3 mr-1" />{format(new Date(d.created_at), 'dd MMM yy HH:mm')}</span>
                  {d.shared_with_client && <Badge variant="outline" className="text-[10px]">Client visible</Badge>}
                </div>
                {d.sent_to && d.sent_to.length > 0 && (
                  <p className="text-muted-foreground truncate">→ {d.sent_to.join(', ')}</p>
                )}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {d.status === 'draft' && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => updateStatus({ id: d.id, status: 'generated' })}>
                      <FileCheck2 className="h-3 w-3" /> Generate
                    </Button>
                  )}
                  {(d.status === 'generated' || d.status === 'draft') && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => updateStatus({ id: d.id, status: 'sent' })}>
                      <Send className="h-3 w-3" /> Mark Sent
                    </Button>
                  )}
                  {d.pdf_storage_path && d.status !== 'signed' && d.status !== 'voided' && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => openPrepareForSigning(d)}>
                      <FileSignature className="h-3 w-3" /> Prepare for Signing
                    </Button>
                  )}
                  {d.docusign_envelope_id && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setStatusDoc(d)}>
                      <Activity className="h-3 w-3" /> Envelope Status
                    </Button>
                  )}
                  {(d.status === 'sent' || d.status === 'viewed') && (
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => updateStatus({ id: d.id, status: 'signed' })}>
                      Mark Signed
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive ml-auto"
                    onClick={() => { if (confirm('Delete this document?')) remove(d.id); }}>×</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Template Type</Label>
              <Select value={form.template_type} onValueChange={(v) => setForm({ ...form, template_type: v as TemplateDocType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TEMPLATE_TYPE_LABEL) as TemplateDocType[]).map(t => (
                    <SelectItem key={t} value={t}>{TEMPLATE_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Loan Application — CBA" />
            </div>
            <div>
              <Label>Recipients (comma separated emails)</Label>
              <Input value={form.sent_to} onChange={e => setForm({ ...form, sent_to: e.target.value })} placeholder="lender@example.com, borrower@example.com" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.shared_with_client} onCheckedChange={(c) => setForm({ ...form, shared_with_client: !!c })} />
              Share with client portal
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {signingDoc && (
        <PrepareForSigningModal
          open={!!signingDoc}
          onOpenChange={(v) => { if (!v) setSigningDoc(null); }}
          scope="document"
          recordId={signingDoc.id}
          title={signingDoc.title}
          pdfUrl={signingPdfUrl}
          bucket={DOC_BUCKET}
          initialRecipients={((signingDoc as any).signing_recipients as SigningRecipient[]) || (signingDoc.sent_to || []).map((email, i) => ({ id: `r${i}`, name: email.split('@')[0], email, roleLabel: 'Signer', routingOrder: 1 }))}
          initialLayout={((signingDoc as any).signing_layout) || []}
          onSent={() => setSigningDoc(null)}
        />
      )}

      {statusDoc && (
        <EnvelopeStatusDialog
          open={!!statusDoc}
          onOpenChange={(v) => { if (!v) setStatusDoc(null); }}
          scope="document"
          recordId={statusDoc.id}
          title={`${statusDoc.title} — Envelope`}
        />
      )}
    </div>
  );
}

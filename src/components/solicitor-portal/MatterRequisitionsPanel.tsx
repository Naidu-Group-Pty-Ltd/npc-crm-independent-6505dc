import { useState } from 'react';
import { AlertTriangle, Gavel, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { countdownLabel, formatMatterDate } from '@/lib/legalMatters';
import {
  REQUISITION_DIRECTION_LABELS, REQUISITION_STATUS_CLASSES, REQUISITION_STATUS_LABELS,
  REQUISITION_STATUS_OPTIONS,
  type LegalMatterRequisition, type LegalRequisitionDirection, type LegalRequisitionStatus,
} from '@/lib/legalDocuments';

export interface RequisitionDraft {
  id: string | null;
  direction: LegalRequisitionDirection;
  reference: string;
  subject: string;
  detail: string;
  response: string;
  status: LegalRequisitionStatus;
  raised_on: string;
  response_due: string;
  is_blocking: boolean;
  visible_to_client: boolean;
  notes: string;
}

const EMPTY_REQUISITION: RequisitionDraft = {
  id: null,
  direction: 'sent',
  reference: '',
  subject: '',
  detail: '',
  response: '',
  status: 'draft',
  raised_on: '',
  response_due: '',
  is_blocking: false,
  visible_to_client: false,
  notes: '',
};

export interface MatterRequisitionsPanelProps {
  requisitions: LegalMatterRequisition[];
  canEdit: boolean;
  canDelete: boolean;
  saving?: boolean;
  onSave: (draft: RequisitionDraft) => Promise<void> | void;
  onSetStatus: (requisitionId: string, status: LegalRequisitionStatus) => Promise<void> | void;
  onDelete: (requisitionId: string) => Promise<void> | void;
}

export function MatterRequisitionsPanel({
  requisitions, canEdit, canDelete, saving, onSave, onSetStatus, onDelete,
}: MatterRequisitionsPanelProps) {
  const [draft, setDraft] = useState<RequisitionDraft | null>(null);

  const openEdit = (r?: LegalMatterRequisition) => {
    setDraft(r
      ? {
          id: r.id,
          direction: r.direction,
          reference: r.reference ?? '',
          subject: r.subject,
          detail: r.detail ?? '',
          response: r.response ?? '',
          status: r.status,
          raised_on: (r.raised_on ?? '').slice(0, 10),
          response_due: (r.response_due ?? '').slice(0, 10),
          is_blocking: r.is_blocking,
          visible_to_client: r.visible_to_client,
          notes: r.notes ?? '',
        }
      : { ...EMPTY_REQUISITION });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Requisitions</CardTitle>
          <CardDescription>
            Requisitions on title raised by this practice or received from the other side.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => openEdit()}>
            <Plus className="mr-2 h-4 w-4" /> Add requisition
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {requisitions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No requisitions recorded for this matter.
          </p>
        ) : null}

        {requisitions.map((r) => {
          const countdown = countdownLabel(r.response_due);
          return (
            <div
              key={r.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Gavel className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{r.subject}</span>
                  <Badge variant="outline" className={cn('text-xs', REQUISITION_STATUS_CLASSES[r.status])}>
                    {REQUISITION_STATUS_LABELS[r.status]}
                  </Badge>
                  {r.is_blocking ? (
                    <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" /> Blocking
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {REQUISITION_DIRECTION_LABELS[r.direction]}
                  {r.reference ? ` · ref ${r.reference}` : ''}
                  {r.raised_on ? ` · raised ${formatMatterDate(r.raised_on)}` : ''}
                  {r.response_due ? ` · response due ${formatMatterDate(r.response_due)}` : ''}
                  {countdown ? ` (${countdown})` : ''}
                </p>
                {r.detail ? <p className="text-xs text-muted-foreground">{r.detail}</p> : null}
                {r.response ? (
                  <p className="text-xs text-muted-foreground"><strong>Response:</strong> {r.response}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEdit ? (
                  <Select
                    value={r.status}
                    onValueChange={(v) => void onSetStatus(r.id, v as LegalRequisitionStatus)}
                  >
                    <SelectTrigger className="h-9 w-[150px]" aria-label={`Status for ${r.subject}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUISITION_STATUS_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>{REQUISITION_STATUS_LABELS[v]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {canEdit ? (
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" aria-label={`Edit ${r.subject}`} />
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => void onDelete(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${r.subject}`} />
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
            <DialogTitle>{draft?.id ? 'Edit requisition' : 'Add requisition'}</DialogTitle>
            <DialogDescription>Keep the requisition trail auditable end to end.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Direction</Label>
                  <Select
                    value={draft.direction}
                    onValueChange={(v) => setDraft({ ...draft, direction: v as LegalRequisitionDirection })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sent">{REQUISITION_DIRECTION_LABELS.sent}</SelectItem>
                      <SelectItem value="received">{REQUISITION_DIRECTION_LABELS.received}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(v) => setDraft({ ...draft, status: v as LegalRequisitionStatus })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REQUISITION_STATUS_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>{REQUISITION_STATUS_LABELS[v]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="req-subject">Subject</Label>
                <Input
                  id="req-subject" value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="req-ref">Reference</Label>
                  <Input
                    id="req-ref" value={draft.reference}
                    onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="req-raised">Raised on</Label>
                  <Input
                    id="req-raised" type="date" value={draft.raised_on}
                    onChange={(e) => setDraft({ ...draft, raised_on: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="req-due">Response due</Label>
                  <Input
                    id="req-due" type="date" value={draft.response_due}
                    onChange={(e) => setDraft({ ...draft, response_due: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="req-detail">Detail</Label>
                <Textarea
                  id="req-detail" rows={3} value={draft.detail}
                  onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="req-response">Response</Label>
                <Textarea
                  id="req-response" rows={3} value={draft.response}
                  onChange={(e) => setDraft({ ...draft, response: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="req-blocking">Blocks settlement</Label>
                  <p className="text-xs text-muted-foreground">Highlights this requisition as critical.</p>
                </div>
                <Switch
                  id="req-blocking" checked={draft.is_blocking}
                  onCheckedChange={(v) => setDraft({ ...draft, is_blocking: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="req-client">Share with client</Label>
                  <p className="text-xs text-muted-foreground">Visible in the Client Portal.</p>
                </div>
                <Switch
                  id="req-client" checked={draft.visible_to_client}
                  onCheckedChange={(v) => setDraft({ ...draft, visible_to_client: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={saving || !draft?.subject.trim()}
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

export default MatterRequisitionsPanel;

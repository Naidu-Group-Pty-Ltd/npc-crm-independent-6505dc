import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { countdownLabel, formatMatterDate } from '@/lib/legalMatters';
import {
  CRITICAL_DATE_STATUS_CLASSES, CRITICAL_DATE_STATUS_LABELS, CRITICAL_DATE_TYPE_LABELS,
  DATE_OWNER_LABELS, REMINDER_PRESETS, isDateOverdue,
  type LegalCriticalDate, type LegalCriticalDateStatus, type LegalCriticalDateType,
  type LegalDateOwner,
} from '@/lib/legalCriticalDates';

interface DateDraft {
  id: string | null;
  date_type: LegalCriticalDateType;
  label: string;
  due_date: string;
  owner: LegalDateOwner;
  status: LegalCriticalDateStatus;
  is_key: boolean;
  visible_to_client: boolean;
  reminder_days: number[];
  notes: string;
  source: string;
}

const EMPTY_DATE: DateDraft = {
  id: null,
  date_type: 'other',
  label: '',
  due_date: '',
  owner: 'solicitor',
  status: 'pending',
  is_key: false,
  visible_to_client: false,
  reminder_days: [7, 3, 1],
  notes: '',
  source: 'manual',
};

export interface CriticalDatesPanelProps {
  dates: LegalCriticalDate[];
  canEdit: boolean;
  canDelete: boolean;
  saving?: boolean;
  onSave: (draft: DateDraft) => Promise<void> | void;
  onSetStatus: (dateId: string, status: LegalCriticalDateStatus) => Promise<void> | void;
  onDelete: (dateId: string) => Promise<void> | void;
}

/**
 * Typed critical date register for a legal matter (Solicitor Portal — Phase 4).
 * Derived rows (source `matter_field`) mirror the contract dates on the matter
 * and cannot have their due date edited here.
 */
export function CriticalDatesPanel({
  dates, canEdit, canDelete, saving, onSave, onSetStatus, onDelete,
}: CriticalDatesPanelProps) {
  const [dialog, setDialog] = useState<DateDraft | null>(null);

  const sorted = useMemo(() => {
    const rank = (d: LegalCriticalDate) => (isDateOverdue(d) ? 0 : d.due_date ? 1 : 2);
    return [...dates].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return (a.due_date || '9999').localeCompare(b.due_date || '9999');
    });
  }, [dates]);

  const overdue = sorted.filter(isDateOverdue).length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Critical dates
          </CardTitle>
          <CardDescription>
            Every dated obligation on this matter. Contract dates sync automatically from the file.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {overdue > 0 ? (
            <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
              {overdue} overdue
            </Badge>
          ) : null}
          {canEdit ? (
            <Button size="sm" onClick={() => setDialog({ ...EMPTY_DATE })}>
              <Plus className="mr-2 h-4 w-4" /> Add date
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
            No critical dates yet. Set the contract dates on the matter, or add a bespoke obligation.
          </div>
        ) : sorted.map((d) => {
          const countdown = countdownLabel(d.due_date);
          const late = isDateOverdue(d);
          return (
            <div
              key={d.id}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between',
                late ? 'border-destructive/40 bg-destructive/5' : 'border-border/70',
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{d.label}</span>
                  {d.is_key ? <Badge variant="secondary">Key</Badge> : null}
                  <Badge variant="outline" className={CRITICAL_DATE_STATUS_CLASSES[d.status]}>
                    {CRITICAL_DATE_STATUS_LABELS[d.status]}
                  </Badge>
                  {d.source === 'matter_field' ? (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="h-3 w-3" aria-hidden /> Synced
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {CRITICAL_DATE_TYPE_LABELS[d.date_type]} · {formatMatterDate(d.due_date)}
                  {countdown ? ` · ${countdown}` : ''} · {DATE_OWNER_LABELS[d.owner] ?? d.owner}
                  {d.visible_to_client ? ' · shared with client' : ''}
                </p>
                {d.notes ? <p className="text-xs text-muted-foreground">{d.notes}</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEdit ? (
                  <Select
                    value={d.status}
                    onValueChange={(v) => void onSetStatus(d.id, v as LegalCriticalDateStatus)}
                  >
                    <SelectTrigger className="h-9 w-[150px]" aria-label={`Status for ${d.label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CRITICAL_DATE_STATUS_LABELS) as LegalCriticalDateStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{CRITICAL_DATE_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setDialog({
                      id: d.id,
                      date_type: d.date_type,
                      label: d.label,
                      due_date: (d.due_date || '').slice(0, 10),
                      owner: d.owner,
                      status: d.status,
                      is_key: d.is_key,
                      visible_to_client: d.visible_to_client,
                      reminder_days: d.reminder_days || [],
                      notes: d.notes ?? '',
                      source: d.source,
                    })}
                  >
                    <Pencil className="h-4 w-4" aria-label={`Edit ${d.label}`} />
                  </Button>
                ) : null}
                {canDelete && d.source !== 'matter_field' ? (
                  <Button variant="ghost" size="sm" onClick={() => void onDelete(d.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${d.label}`} />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{dialog?.id ? 'Edit critical date' : 'Add critical date'}</DialogTitle>
            <DialogDescription>
              Reminders fire on the selected lead times while the date is still open.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="cd_type">Type</Label>
                <Select
                  value={dialog?.date_type ?? 'other'}
                  onValueChange={(v) => setDialog((p) => p && {
                    ...p,
                    date_type: v as LegalCriticalDateType,
                    label: p.label || CRITICAL_DATE_TYPE_LABELS[v as LegalCriticalDateType],
                  })}
                  disabled={dialog?.source === 'matter_field'}
                >
                  <SelectTrigger id="cd_type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CRITICAL_DATE_TYPE_LABELS) as LegalCriticalDateType[]).map((t) => (
                      <SelectItem key={t} value={t}>{CRITICAL_DATE_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cd_label">Label</Label>
                <Input
                  id="cd_label"
                  value={dialog?.label ?? ''}
                  onChange={(e) => setDialog((p) => p && { ...p, label: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cd_due">Due date</Label>
                <Input
                  id="cd_due" type="date"
                  value={dialog?.due_date ?? ''}
                  onChange={(e) => setDialog((p) => p && { ...p, due_date: e.target.value })}
                  disabled={dialog?.source === 'matter_field'}
                />
                {dialog?.source === 'matter_field' ? (
                  <p className="text-xs text-muted-foreground">
                    This date follows the matter field — change it on the Dates tab of the matter.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cd_owner">Owner</Label>
                <Select
                  value={dialog?.owner ?? 'solicitor'}
                  onValueChange={(v) => setDialog((p) => p && { ...p, owner: v as LegalDateOwner })}
                >
                  <SelectTrigger id="cd_owner"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DATE_OWNER_LABELS) as LegalDateOwner[]).map((o) => (
                      <SelectItem key={o} value={o}>{DATE_OWNER_LABELS[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cd_reminders">Reminders</Label>
                <Select
                  value={JSON.stringify(dialog?.reminder_days ?? [])}
                  onValueChange={(v) => setDialog((p) => p && { ...p, reminder_days: JSON.parse(v) })}
                >
                  <SelectTrigger id="cd_reminders"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REMINDER_PRESETS.map((r) => (
                      <SelectItem key={r.label} value={JSON.stringify(r.days)}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Key date</p>
                  <p className="text-xs text-muted-foreground">Pin this to dashboards and countdowns.</p>
                </div>
                <Switch
                  checked={!!dialog?.is_key}
                  onCheckedChange={(c) => setDialog((p) => p && { ...p, is_key: c })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Share with client</p>
                  <p className="text-xs text-muted-foreground">Shows in the client portal timeline.</p>
                </div>
                <Switch
                  checked={!!dialog?.visible_to_client}
                  onCheckedChange={(c) => setDialog((p) => p && { ...p, visible_to_client: c })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cd_notes">Notes</Label>
                <Textarea
                  id="cd_notes" rows={3}
                  value={dialog?.notes ?? ''}
                  onChange={(e) => setDialog((p) => p && { ...p, notes: e.target.value })}
                />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!dialog) return;
                await onSave(dialog);
                setDialog(null);
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export type { DateDraft };

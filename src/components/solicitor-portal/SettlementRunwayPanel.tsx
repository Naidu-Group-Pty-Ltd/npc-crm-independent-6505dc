import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Route, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { countdownLabel, formatMatterDate } from '@/lib/legalMatters';
import {
  SETTLEMENT_TASK_STATUS_CLASSES, SETTLEMENT_TASK_STATUS_LABELS,
  type LegalSettlementTask, type LegalSettlementTaskStatus, type RunwaySummary,
} from '@/lib/legalCriticalDates';

export interface TaskDraft {
  id: string;
  status: LegalSettlementTaskStatus;
  due_date: string;
  blocked_reason: string;
  notes: string;
}

export interface SettlementRunwayPanelProps {
  tasks: LegalSettlementTask[];
  runway?: RunwaySummary | null;
  canEdit: boolean;
  saving?: boolean;
  seeding?: boolean;
  onUpdateTask: (draft: TaskDraft) => Promise<void> | void;
  onQuickStatus: (taskId: string, status: LegalSettlementTaskStatus) => Promise<void> | void;
  onSeed?: () => Promise<void> | void;
}

/**
 * 14-step settlement runway checklist for a legal matter (Solicitor Portal — Phase 4).
 */
export function SettlementRunwayPanel({
  tasks, runway, canEdit, saving, seeding, onUpdateTask, onQuickStatus, onSeed,
}: SettlementRunwayPanelProps) {
  const [dialog, setDialog] = useState<TaskDraft | null>(null);

  const ordered = useMemo(
    () => [...tasks].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)),
    [tasks],
  );

  const complete = runway?.tasks_complete ?? ordered.filter((t) => t.status === 'complete').length;
  const total = runway?.tasks_total ?? ordered.length;
  const pct = runway?.percent_complete ?? (total ? Math.round((complete / total) * 100) : 0);
  const blocked = ordered.filter((t) => t.status === 'blocked').length;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4 text-primary" aria-hidden /> Settlement runway
          </CardTitle>
          <CardDescription>
            The standard conveyancing checklist, dated back from settlement.
          </CardDescription>
        </div>
        {canEdit && onSeed && ordered.length === 0 ? (
          <Button size="sm" onClick={() => void onSeed()} disabled={seeding}>
            {seeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate runway
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {ordered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
            The runway is generated once the matter goes unconditional, or you can start it now.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{complete} of {total} steps complete</span>
                <div className="flex items-center gap-2">
                  {blocked > 0 ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      {blocked} blocked
                    </Badge>
                  ) : null}
                  <span className="font-semibold text-foreground">{pct}%</span>
                </div>
              </div>
              <Progress value={pct} aria-label="Settlement runway progress" />
            </div>

            <ol className="space-y-2">
              {ordered.map((t) => {
                const late = t.status !== 'complete' && t.due_date && new Date(t.due_date) < new Date();
                return (
                  <li
                    key={t.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between',
                      t.status === 'complete'
                        ? 'border-success/30 bg-success/5'
                        : late || t.status === 'blocked'
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-border/70',
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">
                          {String(t.sequence ?? 0).padStart(2, '0')}
                        </span>
                        <span className="font-medium text-foreground">{t.label}</span>
                        <Badge variant="outline" className={SETTLEMENT_TASK_STATUS_CLASSES[t.status]}>
                          {SETTLEMENT_TASK_STATUS_LABELS[t.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Due {formatMatterDate(t.due_date)}
                        {countdownLabel(t.due_date) ? ` · ${countdownLabel(t.due_date)}` : ''}
                        {t.status === 'complete' && t.completed_at
                          ? ` · completed ${formatMatterDate(t.completed_at)}`
                          : ''}
                      </p>
                      {t.blocked_reason ? (
                        <p className="text-xs text-destructive">Blocked: {t.blocked_reason}</p>
                      ) : null}
                      {t.notes ? <p className="text-xs text-muted-foreground">{t.notes}</p> : null}
                    </div>

                    {canEdit ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={t.status}
                          onValueChange={(v) => void onQuickStatus(t.id, v as LegalSettlementTaskStatus)}
                        >
                          <SelectTrigger className="h-9 w-[150px]" aria-label={`Status for ${t.label}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(SETTLEMENT_TASK_STATUS_LABELS) as LegalSettlementTaskStatus[]).map((s) => (
                              <SelectItem key={s} value={s}>{SETTLEMENT_TASK_STATUS_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline" size="sm"
                          onClick={() => setDialog({
                            id: t.id,
                            status: t.status,
                            due_date: (t.due_date || '').slice(0, 10),
                            blocked_reason: t.blocked_reason ?? '',
                            notes: t.notes ?? '',
                          })}
                        >
                          Details
                        </Button>
                      </div>
                    ) : (
                      t.status === 'complete'
                        ? <CheckCircle2 className="h-5 w-5 text-success" aria-label="Complete" />
                        : null
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </CardContent>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Update runway step</DialogTitle>
            <DialogDescription>Adjust the due date, record a blocker, or leave a note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="rw_status">Status</Label>
              <Select
                value={dialog?.status ?? 'not_started'}
                onValueChange={(v) => setDialog((p) => p && { ...p, status: v as LegalSettlementTaskStatus })}
              >
                <SelectTrigger id="rw_status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SETTLEMENT_TASK_STATUS_LABELS) as LegalSettlementTaskStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{SETTLEMENT_TASK_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rw_due">Due date</Label>
              <Input
                id="rw_due" type="date"
                value={dialog?.due_date ?? ''}
                onChange={(e) => setDialog((p) => p && { ...p, due_date: e.target.value })}
              />
            </div>
            {dialog?.status === 'blocked' ? (
              <div className="grid gap-2">
                <Label htmlFor="rw_blocked">Blocker</Label>
                <Input
                  id="rw_blocked"
                  value={dialog?.blocked_reason ?? ''}
                  onChange={(e) => setDialog((p) => p && { ...p, blocked_reason: e.target.value })}
                  placeholder="What is holding this up?"
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="rw_notes">Notes</Label>
              <Textarea
                id="rw_notes" rows={3}
                value={dialog?.notes ?? ''}
                onChange={(e) => setDialog((p) => p && { ...p, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!dialog) return;
                await onUpdateTask(dialog);
                setDialog(null);
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus, Trash2, Loader2, CheckCircle2, Clock, XCircle, FileText,
  ShieldCheck, PenSquare, HelpCircle, AlertCircle, Coins, Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const FN = 'finance-portal-client-tasks';

const TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  document_upload:         { label: 'Document upload',         icon: FileText,    tone: 'bg-info/15 text-info border-info/30' },
  lender_condition_action: { label: 'Lender condition action', icon: ShieldCheck, tone: 'bg-brand-500/15 text-brand-500 border-brand-500/30' },
  signature_request:       { label: 'Signature request',       icon: PenSquare,   tone: 'bg-accent/15 text-accent border-accent/30' },
  information_request:     { label: 'Information request',     icon: HelpCircle,  tone: 'bg-muted text-muted-foreground border-border' },
  decision_required:       { label: 'Decision required',       icon: AlertCircle, tone: 'bg-destructive/15 text-destructive border-destructive/30' },
  payment_required:        { label: 'Payment required',        icon: Coins,       tone: 'bg-success/15 text-success border-success/30' },
  other:                   { label: 'Other',                   icon: Inbox,       tone: 'bg-muted text-muted-foreground border-border' },
};

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending:     { label: 'Pending',     tone: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In progress', tone: 'bg-info/15 text-info' },
  completed:   { label: 'Completed',   tone: 'bg-success/15 text-success' },
  dismissed:   { label: 'Dismissed',   tone: 'bg-muted text-muted-foreground line-through' },
  expired:     { label: 'Expired',     tone: 'bg-destructive/15 text-destructive' },
};

type Task = {
  id: string;
  task_type: string;
  status: string;
  title: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  client_response_text: string | null;
  client_response_at: string | null;
};

export function ClientTasksTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['pf-client-tasks', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'list_for_file', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.tasks || []) as Task[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['pf-client-tasks', fileId] });

  const setStatus = async (id: string, status: string) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'set_status', task_id: id, status });
    if (error) return toast.error(error.message);
    toast.success('Updated');
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this action item?')) return;
    const { error } = await invokeFinanceFunction(FN, { operation: 'delete', task_id: id });
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    refresh();
  };

  const open = (existing?: Task) => {
    setEditing(existing || null);
    setDialogOpen(true);
  };

  const openCount = (tasks || []).filter(t => t.status === 'pending' || t.status === 'in_progress').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Client action items</h3>
          <p className="text-sm text-muted-foreground">
            Structured, typed tasks the client sees in their portal. {openCount} open
          </p>
        </div>
        <Button onClick={() => open()} size="sm"><Plus className="h-4 w-4 mr-2" />New action item</Button>
      </div>

      {isLoading && <Card><CardContent className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></CardContent></Card>}

      {!isLoading && (tasks?.length || 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No client action items yet. Create one so the client knows exactly what to do next.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {(tasks || []).map((t) => {
          const meta = TYPE_META[t.task_type] || TYPE_META.other;
          const status = STATUS_META[t.status] || STATUS_META.pending;
          const Icon = meta.icon;
          const overdue = t.due_date && new Date(t.due_date) < new Date() && (t.status === 'pending' || t.status === 'in_progress');
          return (
            <Card key={t.id}>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className={cn('rounded-md p-2', meta.tone)}><Icon className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{t.title}</p>
                      <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                      <span className="text-xs text-muted-foreground">{meta.label}</span>
                      {t.due_date && (
                        <span className={cn('text-xs', overdue ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                          · Due {new Date(t.due_date).toLocaleDateString('en-AU')}
                        </span>
                      )}
                    </div>
                    {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                    {t.client_response_text && (
                      <div className="mt-2 rounded-md bg-muted/40 border border-border px-3 py-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Client response</p>
                        <p className="text-sm">{t.client_response_text}</p>
                        {t.client_response_at && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(t.client_response_at).toLocaleString('en-AU')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    {t.status !== 'completed' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, 'completed')}>
                        <CheckCircle2 className="h-4 w-4 mr-1" />Complete
                      </Button>
                    )}
                    {t.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(t.id, 'dismissed')}>
                        <XCircle className="h-4 w-4 mr-1" />Dismiss
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => open(t)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(t.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fileId={fileId}
        existing={editing}
        onSaved={refresh}
      />
    </div>
  );
}

function TaskDialog({
  open, onOpenChange, fileId, existing, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fileId: string;
  existing: Task | null;
  onSaved: () => void;
}) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [saving, setSaving] = useState(false);
  const [taskType, setTaskType] = useState(existing?.task_type || 'document_upload');
  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [dueDate, setDueDate] = useState(existing?.due_date || '');

  // Reset when dialog (re)opens with a different record
  if (open && existing && existing.id !== (window as any).__pfctEditingId) {
    (window as any).__pfctEditingId = existing.id;
    setTaskType(existing.task_type);
    setTitle(existing.title);
    setDescription(existing.description || '');
    setDueDate(existing.due_date || '');
  }
  if (open && !existing && (window as any).__pfctEditingId !== null) {
    (window as any).__pfctEditingId = null;
    setTaskType('document_upload');
    setTitle('');
    setDescription('');
    setDueDate('');
  }

  const save = async () => {
    if (!title.trim()) return toast.error('Title is required');
    setSaving(true);
    const payload = {
      task_type: taskType,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
    };
    const { error } = existing
      ? await invokeFinanceFunction(FN, { operation: 'update', task_id: existing.id, payload })
      : await invokeFinanceFunction(FN, { operation: 'create', purchase_file_id: fileId, payload });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? 'Updated' : 'Action item created');
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit action item' : 'New client action item'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={taskType} onValueChange={setTaskType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_META).map(([k, m]) => (
                  <SelectItem key={k} value={k}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Upload latest payslip" />
          </div>
          <div>
            <Label>Description (shown to client)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Give the client exactly what they need to do — no internal jargon."
            />
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? 'Save changes' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

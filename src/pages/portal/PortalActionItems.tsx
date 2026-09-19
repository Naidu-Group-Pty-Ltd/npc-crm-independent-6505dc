import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText, ShieldCheck, PenSquare, HelpCircle, AlertCircle, Coins, Inbox,
  CheckCircle2, Loader2, ListChecks, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


const TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  document_upload:         { label: 'Document upload',         icon: FileText,    tone: 'bg-info/15 text-info' },
  lender_condition_action: { label: 'Lender condition',        icon: ShieldCheck, tone: 'bg-brand-500/15 text-brand-500' },
  signature_request:       { label: 'Signature request',       icon: PenSquare,   tone: 'bg-accent/15 text-accent' },
  information_request:     { label: 'Information request',     icon: HelpCircle,  tone: 'bg-muted text-muted-foreground' },
  decision_required:       { label: 'Decision required',       icon: AlertCircle, tone: 'bg-destructive/15 text-destructive' },
  payment_required:        { label: 'Payment required',        icon: Coins,       tone: 'bg-success/15 text-success' },
  other:                   { label: 'Other',                   icon: Inbox,       tone: 'bg-muted text-muted-foreground' },
};

type Task = {
  id: string;
  purchase_file_id: string;
  task_type: string;
  status: string;
  title: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  client_response_text: string | null;
  client_response_at: string | null;
  purchase_files: { title: string | null } | null;
};

function getSessionToken(): string | null {
  try {
    return getPortalSessionToken();
  } catch {
    return getPortalSessionToken();
  }
}

async function callClientTasks(operation: string, payload: Record<string, unknown> = {}) {
  const token = getSessionToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/finance-portal-client-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(token ? { 'x-portal-session-token': token } : {}),
    },
    body: JSON.stringify({ operation, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export default function PortalActionItems() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondTask, setRespondTask] = useState<Task | null>(null);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await callClientTasks('client_list');
      setTasks((json.tasks || []) as Task[]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load action items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitResponse = async (complete: boolean) => {
    if (!respondTask) return;
    setSubmitting(true);
    try {
      await callClientTasks('client_respond', {
        task_id: respondTask.id,
        response_text: responseText.trim() || undefined,
        complete,
      });
      toast.success(complete ? 'Marked complete' : 'Response sent');
      setRespondTask(null);
      setResponseText('');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const open = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const done = tasks.filter(t => t.status === 'completed');

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-md p-2 bg-primary/15 text-primary"><ListChecks className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-semibold">Your action items</h1>
          <p className="text-sm text-muted-foreground">
            Tasks from your finance team. Knock these out to keep your application moving.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Open ({open.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {open.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">You're all caught up 🎉</p>
              )}
              {open.map(t => (
                <TaskRow key={t.id} task={t} onAction={() => { setRespondTask(t); setResponseText(t.client_response_text || ''); }} />
              ))}
            </CardContent>
          </Card>

          {done.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recently completed</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {done.slice(0, 20).map(t => <TaskRow key={t.id} task={t} muted />)}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!respondTask} onOpenChange={(v) => { if (!v) setRespondTask(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{respondTask?.title}</DialogTitle>
          </DialogHeader>
          {respondTask?.description && (
            <p className="text-sm text-muted-foreground">{respondTask.description}</p>
          )}
          <div>
            <label className="text-sm font-medium">Reply to your finance team (optional)</label>
            <Textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={4}
              placeholder="Add any notes, questions, or context."
              className="mt-1"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setRespondTask(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => submitResponse(false)} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Send reply
            </Button>
            <Button onClick={() => submitResponse(true)} disabled={submitting}>
              <CheckCircle2 className="h-4 w-4 mr-2" />Mark complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({ task, onAction, muted }: { task: Task; onAction?: () => void; muted?: boolean }) {
  const meta = TYPE_META[task.task_type] || TYPE_META.other;
  const Icon = meta.icon;
  const overdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border border-border p-3',
      muted && 'opacity-70',
    )}>
      <div className={cn('rounded-md p-2 shrink-0', meta.tone)}><Icon className="h-4 w-4" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{task.title}</p>
          <Badge variant="outline" className="text-xs">{meta.label}</Badge>
          {task.purchase_files?.title && (
            <span className="text-xs text-muted-foreground">· {task.purchase_files.title}</span>
          )}
        </div>
        {task.description && <p className="text-sm text-muted-foreground mt-1">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
          {task.due_date && (
            <span className={cn(overdue && 'text-destructive font-medium')}>
              <Clock className="h-3 w-3 inline mr-1" />Due {new Date(task.due_date).toLocaleDateString('en-AU')}
            </span>
          )}
          {task.status === 'completed' && (
            <span className="text-success"><CheckCircle2 className="h-3 w-3 inline mr-1" />Completed</span>
          )}
        </div>
      </div>
      {onAction && (
        <Button size="sm" onClick={onAction}>Open</Button>
      )}
    </div>
  );
}

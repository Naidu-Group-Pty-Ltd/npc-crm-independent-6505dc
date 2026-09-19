import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  Ship, Loader2, CheckCircle2, Circle, PauseCircle, MinusCircle, User2, Briefcase,
  Scale, Building2, Calendar as CalendarIcon, Sparkles,
} from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface Task {
  id: string;
  task_key: string;
  label: string;
  description: string | null;
  owner: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'not_applicable';
  due_offset_days: number | null;
  due_date: string | null;
  is_required: boolean;
  is_auto_seeded: boolean;
  notes: string | null;
  blocked_reason: string | null;
  completed_at: string | null;
  sort_order: number;
}

const OWNER_ICON: Record<string, any> = {
  finance: Briefcase, client: User2, solicitor: Scale, npc: Building2,
};
const OWNER_LABEL: Record<string, string> = {
  finance: 'Finance Partner', client: 'Client', solicitor: 'Solicitor', npc: 'NPC Team',
};
const STATUS_TONE: Record<string, string> = {
  pending: 'text-muted-foreground border-muted',
  in_progress: 'text-primary border-primary/40',
  completed: 'text-success border-success/40',
  blocked: 'text-destructive border-destructive/40',
  not_applicable: 'text-muted-foreground/70 border-muted/40 line-through',
};
const STATUS_ICON: Record<string, any> = {
  pending: Circle, in_progress: Loader2, completed: CheckCircle2, blocked: PauseCircle, not_applicable: MinusCircle,
};

export function SettlementRunwayTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [progress, setProgress] = useState<{ total: number; completed: number; percent: number }>({ total: 0, completed: 0, percent: 0 });
  const [settlementDate, setSettlementDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-settlement-runway', {
        operation: 'list_tasks', purchase_file_id: fileId,
      });
      if (error) throw new Error(error.message);
      setTasks((data as any)?.tasks || []);
      setProgress((data as any)?.progress || { total: 0, completed: 0, percent: 0 });
      setSettlementDate((data as any)?.settlement_date || null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load settlement runway');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fileId]);

  const seed = async () => {
    try {
      const { error } = await invokeFinanceFunction('finance-portal-settlement-runway', {
        operation: 'seed_default', purchase_file_id: fileId,
      });
      if (error) throw new Error(error.message);
      toast.success('Default settlement checklist seeded');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const update = async (taskId: string, patch: Partial<Task>) => {
    try {
      const { error } = await invokeFinanceFunction('finance-portal-settlement-runway', {
        operation: 'upsert_task', purchase_file_id: fileId, task_id: taskId, ...patch,
      });
      if (error) throw new Error(error.message);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading runway…</div>;
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <Ship className="h-10 w-10 mx-auto text-muted-foreground/60" />
          <div>
            <p className="font-medium">No settlement runway yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              The 9-step checklist auto-seeds on unconditional approval. You can also seed it now manually.
            </p>
          </div>
          <Button onClick={seed} className="gap-1.5"><Sparkles className="h-4 w-4" /> Seed default checklist</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Ship className="h-4 w-4" /> Settlement Runway
            </CardTitle>
            {settlementDate && (
              <Badge variant="outline" className="gap-1">
                <CalendarIcon className="h-3 w-3" /> Settles {format(parseISO(settlementDate), 'd MMM yyyy')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{progress.completed} of {progress.total} required complete</span>
            <span className="font-medium">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {tasks.map(t => {
          const Icon = OWNER_ICON[t.owner] || User2;
          const StatusIcon = STATUS_ICON[t.status];
          const isEditing = editingId === t.id;
          return (
            <Card key={t.id} className={cn('transition-colors', t.status === 'completed' && 'bg-success/5')}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => update(t.id, { status: t.status === 'completed' ? 'pending' : 'completed' })}
                    className="mt-0.5 flex-shrink-0"
                    aria-label="Toggle complete"
                  >
                    <StatusIcon className={cn(
                      'h-5 w-5',
                      t.status === 'completed' && 'text-success',
                      t.status === 'in_progress' && 'text-primary animate-spin',
                      t.status === 'blocked' && 'text-destructive',
                      t.status === 'pending' && 'text-muted-foreground',
                      t.status === 'not_applicable' && 'text-muted-foreground/50',
                    )} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className={cn('text-sm font-medium', t.status === 'not_applicable' && 'line-through text-muted-foreground')}>
                        {t.label}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Icon className="h-3 w-3" /> {OWNER_LABEL[t.owner] || t.owner}
                        </Badge>
                        {t.due_date && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <CalendarIcon className="h-3 w-3" /> {format(parseISO(t.due_date), 'd MMM')}
                          </Badge>
                        )}
                        <Badge variant="outline" className={cn('text-xs capitalize', STATUS_TONE[t.status])}>
                          {t.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>
                    {t.notes && !isEditing && (
                      <p className="text-xs text-muted-foreground mt-1.5">{t.notes}</p>
                    )}
                    {t.blocked_reason && t.status === 'blocked' && (
                      <p className="text-xs text-destructive mt-1">Blocked: {t.blocked_reason}</p>
                    )}
                    {t.completed_at && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Completed {format(parseISO(t.completed_at), "d MMM yyyy 'at' h:mm a")}
                      </p>
                    )}

                    {isEditing && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={t.status} onValueChange={v => update(t.id, { status: v as any })}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {['pending','in_progress','completed','blocked','not_applicable'].map(s => (
                                <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={t.owner} onValueChange={v => update(t.id, { owner: v })}>
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(OWNER_LABEL).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Input
                          type="date"
                          defaultValue={t.due_date || ''}
                          onBlur={e => e.target.value !== (t.due_date || '') && update(t.id, { due_date: e.target.value || null as any })}
                          className="h-9 text-xs"
                        />
                        <Textarea
                          placeholder="Internal notes…"
                          defaultValue={t.notes || ''}
                          onBlur={e => e.target.value !== (t.notes || '') && update(t.id, { notes: e.target.value || null as any })}
                          rows={2}
                          className="text-xs"
                        />
                        {t.status === 'blocked' && (
                          <Input
                            placeholder="Blocked reason…"
                            defaultValue={t.blocked_reason || ''}
                            onBlur={e => update(t.id, { blocked_reason: e.target.value || null as any })}
                            className="h-9 text-xs"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="text-xs h-7 px-2"
                    onClick={() => setEditingId(isEditing ? null : t.id)}
                  >{isEditing ? 'Done' : 'Edit'}</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

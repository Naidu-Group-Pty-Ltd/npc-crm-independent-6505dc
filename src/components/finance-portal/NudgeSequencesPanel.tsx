import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Zap, Play, Pause, X, RotateCw, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  purchaseFileId: string;
  clientId: string;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success/15 text-success border-success/30',
  paused: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  completed: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function NudgeSequencesPanel({ purchaseFileId, clientId }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [sequences, setSequences] = useState<any[]>([]);
  const [startOpen, setStartOpen] = useState(false);
  const [selectedTpl, setSelectedTpl] = useState<string>('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tplRes, seqRes] = await Promise.all([
      invokeFinanceFunction('finance-portal-nudges', { operation: 'list_templates' }),
      invokeFinanceFunction('finance-portal-nudges', { operation: 'list_sequences', purchase_file_id: purchaseFileId }),
    ]);
    if (tplRes.error) toast.error(tplRes.error.message);
    else setTemplates(tplRes.data?.templates || []);
    if (seqRes.error) toast.error(seqRes.error.message);
    else setSequences(seqRes.data?.sequences || []);
    setLoading(false);
  }, [purchaseFileId, invokeFinanceFunction]);

  useEffect(() => { void load(); }, [load]);

  const startSequence = useCallback(async () => {
    if (!selectedTpl) return;
    setStarting(true);
    const { error } = await invokeFinanceFunction('finance-portal-nudges', {
      operation: 'start_sequence',
      purchase_file_id: purchaseFileId,
      client_id: clientId,
      template_id: selectedTpl,
    });
    setStarting(false);
    if (error) toast.error(error.message);
    else {
      toast.success('Nudge sequence started');
      setStartOpen(false);
      setSelectedTpl('');
      await load();
    }
  }, [selectedTpl, purchaseFileId, clientId, invokeFinanceFunction, load]);

  const mutate = useCallback(async (operation: string, id: string) => {
    const { error } = await invokeFinanceFunction('finance-portal-nudges', { operation, id });
    if (error) toast.error(error.message);
    else { toast.success('Updated'); await load(); }
  }, [invokeFinanceFunction, load]);

  const activeOrPaused = useMemo(
    () => sequences.filter(s => s.status === 'active' || s.status === 'paused'),
    [sequences],
  );
  const past = useMemo(
    () => sequences.filter(s => s.status === 'completed' || s.status === 'cancelled'),
    [sequences],
  );

  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Nudge sequences</p>
              <p className="text-xs text-muted-foreground">
                Auto-pause when the client replies via portal
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setStartOpen(true)} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Start sequence
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {activeOrPaused.length === 0 && past.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No nudge sequences yet. Start one to drip-feed reminders to the client.
              </p>
            )}

            {activeOrPaused.map(seq => {
              const tpl = (seq as any).finance_portal_nudge_templates;
              const steps = tpl?.steps || [];
              return (
                <div key={seq.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{tpl?.name || 'Sequence'}</p>
                      <p className="text-xs text-muted-foreground">
                        Step {Math.min(seq.current_step + 1, steps.length)} of {steps.length}
                        {seq.next_run_at && seq.status === 'active' && (
                          <> · next {formatDistanceToNow(new Date(seq.next_run_at), { addSuffix: true })}</>
                        )}
                        {seq.status === 'paused' && seq.pause_reason && (
                          <> · paused ({seq.pause_reason.replace(/_/g, ' ')})</>
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLE[seq.status]}>{seq.status}</Badge>
                  </div>
                  <div className="flex gap-1.5">
                    {seq.status === 'active' && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => mutate('pause_sequence', seq.id)}>
                        <Pause className="h-3 w-3 mr-1" /> Pause
                      </Button>
                    )}
                    {seq.status === 'paused' && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => mutate('resume_sequence', seq.id)}>
                        <Play className="h-3 w-3 mr-1" /> Resume
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => mutate('cancel_sequence', seq.id)}>
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              );
            })}

            {past.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <RotateCw className="h-3 w-3" /> Past sequences ({past.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {past.map(seq => {
                    const tpl = (seq as any).finance_portal_nudge_templates;
                    return (
                      <li key={seq.id} className="flex items-center justify-between rounded border border-border/40 px-2.5 py-1.5">
                        <span className="truncate">{tpl?.name || 'Sequence'}</span>
                        <Badge variant="outline" className={STATUS_STYLE[seq.status]}>{seq.status}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </>
        )}

        <Dialog open={startOpen} onOpenChange={setStartOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start nudge sequence</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pick a template. The first message lands today; follow-ups drip per the template
                schedule and pause automatically if the client replies.
              </p>
              <Select value={selectedTpl} onValueChange={setSelectedTpl}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({Array.isArray(t.steps) ? t.steps.length : 0} steps)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTpl && (() => {
                const tpl = templates.find(t => t.id === selectedTpl);
                if (!tpl) return null;
                return (
                  <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-1.5 max-h-48 overflow-y-auto">
                    {(tpl.steps || []).map((s: any, i: number) => (
                      <div key={i}>
                        <span className="font-medium text-foreground">Day {s.day_offset}</span>
                        {s.subject && <> · {s.subject}</>}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button>
                <Button onClick={startSequence} disabled={!selectedTpl || starting}>
                  {starting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Start sequence
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

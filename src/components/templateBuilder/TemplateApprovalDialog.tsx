/**
 * TemplateApprovalDialog — request review, approve / request changes, and
 * lock/unlock a template for review. Backed by `template_approvals` plus
 * `locked_for_review` columns on `report_templates`.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Lock, Unlock, MessageCircle, Loader2, ClipboardCheck, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { logTemplateAudit } from '@/lib/reportTemplate/templateAuditLog';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface TemplateApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  approvalStatus?: string | null;
  locked?: boolean;
  onChanged?: () => void;
}

interface ApprovalRow {
  id: string;
  status: string;
  note: string | null;
  decision_note: string | null;
  requested_by_name: string | null;
  reviewer_name: string | null;
  decided_at: string | null;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'outline',
  pending: 'default',
  in_review: 'default',
  approved: 'default',
  active: 'default',
  archived: 'secondary',
  changes_requested: 'destructive',
};

export function TemplateApprovalDialog({
  open, onOpenChange, templateId, templateName, approvalStatus, locked, onChanged,
}: TemplateApprovalDialogProps) {
  const [history, setHistory] = useState<ApprovalRow[]>([]);
  const [note, setNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
    setNote(''); setDecisionNote('');
  }, [open, templateId]);

  const loadHistory = async () => {
    const { data } = await supabase
      .from('template_approvals' as any)
      .select('id,status,note,decision_note,requested_by_name,reviewer_name,decided_at,created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory((data ?? []) as unknown as ApprovalRow[]);
  };

  const currentUser = async () => {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    return { id: u?.id ?? null, name: (u?.user_metadata as any)?.full_name || u?.email || 'Unknown' };
  };

  const updateTemplateGovernance = async (data: Record<string, unknown>) => {
    const { error } = await invokeSecureFunction('manage-templates', {
      operation: 'update',
      table: 'report_templates',
      recordId: templateId,
      data,
    });
    if (error) throw new Error(error.message);
  };

  const requestReview = async () => {
    setBusy(true);
    try {
      const me = await currentUser();
      const { error } = await supabase.from('template_approvals' as any).insert({
        template_id: templateId,
        requested_by: me.id, requested_by_name: me.name,
        status: 'pending', note: note || null,
      });
      if (error) throw error;
      await updateTemplateGovernance({
        approval_status: 'in_review',
        locked_for_review: true,
        locked_at: new Date().toISOString(),
        locked_by: me.id,
      });
      await logTemplateAudit(templateId, 'approval_requested', 'Review requested', { note });
      toast.success('Review requested · template locked');
      onChanged?.(); await loadHistory();
    } catch (e: any) { toast.error(`Request failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const decide = async (decision: 'approved' | 'changes_requested') => {
    const pending = history.find((h) => h.status === 'pending');
    if (!pending) { toast.error('No pending request'); return; }
    setBusy(true);
    try {
      const me = await currentUser();
      const { error } = await supabase.from('template_approvals' as any).update({
        status: decision,
        decision_note: decisionNote || null,
        reviewer_id: me.id, reviewer_name: me.name,
        decided_at: new Date().toISOString(),
      }).eq('id', pending.id);
      if (error) throw error;
      await updateTemplateGovernance({
        approval_status: decision,
        locked_for_review: decision === 'approved', // keep locked when approved, unlock on changes_requested
      });
      await logTemplateAudit(
        templateId,
        decision === 'approved' ? 'approval_approved' : 'approval_changes_requested',
        decision === 'approved' ? 'Approved' : 'Changes requested',
        { note: decisionNote },
      );
      toast.success(decision === 'approved' ? 'Template approved' : 'Changes requested');
      onChanged?.(); await loadHistory();
    } catch (e: any) { toast.error(`Decision failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const toggleLock = async () => {
    setBusy(true);
    try {
      const me = await currentUser();
      const next = !locked;
      await updateTemplateGovernance({
        locked_for_review: next,
        locked_at: next ? new Date().toISOString() : null,
        locked_by: next ? me.id : null,
      });
      await logTemplateAudit(templateId, next ? 'locked' : 'unlocked');
      toast.success(next ? 'Template locked' : 'Template unlocked');
      onChanged?.();
    } catch (e: any) { toast.error(`Lock toggle failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const pending = history.find((h) => h.status === 'pending');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" /> Review & Approval
          </DialogTitle>
          <DialogDescription>
            Lock <span className="font-medium">{templateName}</span> for review and capture an audit-friendly decision trail.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            <section className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div className="flex items-center gap-3">
                <Badge variant={(STATUS_COLOR[approvalStatus ?? 'draft'] as any) || 'outline'}>
                  {approvalStatus ?? 'draft'}
                </Badge>
                {locked ? (
                  <Badge variant="destructive" className="gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1"><Unlock className="h-3 w-3" /> Unlocked</Badge>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={toggleLock} disabled={busy}>
                {locked ? <Unlock className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                {locked ? 'Unlock' : 'Lock'}
              </Button>
            </section>

            <section className="rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">Review workflow rules</h3>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                {[
                  ['Draft', 'Editable until review is requested.'],
                  ['In review', 'Locked while reviewers inspect the template.'],
                  ['Approved', 'Read-only; branch before making changes.'],
                  ['Active', 'Production template; deactivate before replacing.'],
                  ['Archived', 'Retained for audit and restore only.'],
                ].map(([label, copy]) => (
                  <div key={label} className="rounded border bg-background p-2">
                    <div className="font-medium">{label}</div>
                    <div className="text-muted-foreground">{copy}</div>
                  </div>
                ))}
              </div>
            </section>

            {!pending ? (
              <section className="space-y-3 rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold">Request review</h3>
                <Textarea
                  value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Context for reviewers (optional)"
                  className="min-h-[80px]"
                />
                <Button onClick={requestReview} disabled={busy} size="sm">
                  {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                  Request review
                </Button>
              </section>
            ) : (
              <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Pending review
                </h3>
                <p className="text-xs text-muted-foreground">
                  Requested by {pending.requested_by_name} · {formatDistanceToNow(new Date(pending.created_at), { addSuffix: true })}
                </p>
                {pending.note && <p className="text-sm italic">"{pending.note}"</p>}
                <Textarea
                  value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="Reviewer notes (optional)"
                  className="min-h-[80px]"
                />
                <div className="flex gap-2">
                  <Button onClick={() => decide('approved')} disabled={busy} size="sm">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
                  </Button>
                  <Button onClick={() => decide('changes_requested')} disabled={busy} size="sm" variant="outline">
                    Request changes
                  </Button>
                </div>
              </section>
            )}

            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">Decision history</h3>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reviews yet.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="rounded border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <Badge variant={(STATUS_COLOR[h.status] as any) || 'outline'} className="text-[10px]">{h.status}</Badge>
                        <span className="text-muted-foreground">{formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Requested by {h.requested_by_name || 'Unknown'}
                        {h.reviewer_name ? ` · reviewed by ${h.reviewer_name}` : ''}
                      </div>
                      {h.note && <div className="mt-1 italic">"{h.note}"</div>}
                      {h.decision_note && <div className="mt-1">→ {h.decision_note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

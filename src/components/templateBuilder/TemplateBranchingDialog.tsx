/**
 * TemplateBranchingDialog — duplicate the current template as a draft branch,
 * and (later) merge a draft back into its parent.
 *
 * Branches are simply rows in `report_templates` with `parent_template_id` set
 * and `is_draft=true`. Merging copies the draft's `schema` (+ custom_css) back
 * onto the parent and snapshots a new version.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { GitBranch, GitMerge, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { logTemplateAudit } from '@/lib/reportTemplate/templateAuditLog';

interface TemplateBranchingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  parentTemplateId?: string | null;
  isDraft?: boolean;
  onMerged?: () => void;
}

interface BranchRow {
  id: string;
  name: string;
  branch_label: string | null;
  approval_status: string;
  is_draft: boolean;
  updated_at: string;
}

export function TemplateBranchingDialog({
  open, onOpenChange, templateId, templateName, parentTemplateId, isDraft, onMerged,
}: TemplateBranchingDialogProps) {
  const navigate = useNavigate();
  const [branchLabel, setBranchLabel] = useState('');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadBranches();
    setBranchLabel(`Draft ${new Date().toLocaleDateString('en-AU')}`);
  }, [open, templateId]);

  const loadBranches = async () => {
    const { data } = await supabase
      .from('report_templates' as any)
      .select('id,name,branch_label,approval_status,is_draft,updated_at')
      .eq('parent_template_id', templateId)
      .order('updated_at', { ascending: false });
    setBranches((data ?? []) as unknown as BranchRow[]);
  };

  const handleCreateBranch = async () => {
    setCreating(true);
    try {
      const { data: src, error: srcErr } = await supabase
        .from('report_templates')
        .select('*')
        .eq('id', templateId)
        .single();
      if (srcErr || !src) throw srcErr ?? new Error('Source template not found');

      const insert: any = {
        ...src,
        id: undefined,
        name: `${src.name} — ${branchLabel || 'draft'}`,
        parent_template_id: templateId,
        branch_label: branchLabel || 'draft',
        is_draft: true,
        approval_status: 'draft',
        is_active: false,
        is_default: false,
        locked_for_review: false,
        locked_at: null,
        locked_by: null,
        version: 1,
        // Leave the owner unset (like seeded templates). The service-role
        // manage-templates write bypasses RLS, so created_by no longer needs to
        // equal the current user — and stamping a custom-auth user id here
        // violates the created_by → auth.users foreign key.
        created_by: null,
        created_at: undefined,
        updated_at: undefined,
      };
      // Route through the service-role manage-templates function (the app's
      // canonical, permission-checked template write path) instead of a direct
      // RLS-gated insert.
      const { data: resp, error } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'report_templates',
        data: insert,
      });
      if (error) throw new Error(error.message || 'Branch insert failed');
      const created = (resp as any)?.record;
      if (!created?.id) throw new Error('Branch insert returned no record');

      await logTemplateAudit(templateId, 'branch_created', `Branched as "${insert.name}"`, { branch_id: created.id });
      toast.success('Draft branch created');
      onOpenChange(false);
      navigate(`/admin/template-builder/${created.id}`);
    } catch (e: any) {
      toast.error(`Branch failed: ${e?.message ?? e}`);
    } finally {
      setCreating(false);
    }
  };

  const handleMergeIntoParent = async () => {
    if (!parentTemplateId) return;
    if (!confirm('Merge this draft back into the parent template? The parent schema will be overwritten and snapshotted.')) return;
    setMerging(true);
    try {
      const { data: draft, error: dErr } = await supabase
        .from('report_templates').select('schema,custom_css,name').eq('id', templateId).single();
      if (dErr || !draft) throw dErr ?? new Error('Draft missing');

      const { data: parent, error: pErr } = await supabase
        .from('report_templates').select('schema,version,locked_for_review,approval_status,is_active,updated_at').eq('id', parentTemplateId).single();
      if (pErr || !parent) throw pErr ?? new Error('Parent missing');
      if ((parent as any).locked_for_review) {
        throw new Error('Parent template is locked for review. Unlock or branch again before merging.');
      }
      if ((parent as any).is_active || (parent as any).approval_status === 'approved') {
        const ok = confirm('The parent is approved or active. Merge will return it to draft status for review before activation. Continue?');
        if (!ok) return;
      }

      // snapshot old parent version (service-role write path — RLS-safe)
      const nextVersion = (parent.version ?? 1) + 1;
      try {
        await invokeSecureFunction('manage-templates', {
          operation: 'insert',
          table: 'report_template_versions',
          data: {
            template_id: parentTemplateId,
            version: parent.version ?? 1,
            schema: parent.schema,
            note: 'Pre-merge snapshot',
          },
        });
      } catch { /* ignore */ }

      const { error: upErr } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_templates',
        recordId: parentTemplateId,
        data: {
          schema: draft.schema,
          custom_css: draft.custom_css,
          version: nextVersion,
          approval_status: 'draft',
          locked_for_review: false,
          is_active: false,
          updated_at: new Date().toISOString(),
        },
      });
      if (upErr) throw new Error(upErr.message || 'Merge update failed');

      try {
        await invokeSecureFunction('manage-templates', {
          operation: 'insert',
          table: 'report_template_versions',
          data: {
            template_id: parentTemplateId,
            version: nextVersion,
            schema: draft.schema,
            note: `Merged from draft "${draft.name}"`,
          },
        });
      } catch { /* ignore */ }

      await logTemplateAudit(parentTemplateId, 'branch_merged', `Merged draft "${draft.name}"`, { draft_id: templateId, version: nextVersion });
      toast.success('Merged into parent (v' + nextVersion + ')');
      onMerged?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Merge failed: ${e?.message ?? e}`);
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" /> Branches
          </DialogTitle>
          <DialogDescription>
            Work on changes in isolation, then merge them back into <span className="font-medium">{templateName}</span>.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            {isDraft && parentTemplateId && (
              <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <GitMerge className="h-4 w-4" /> Merge this draft into its parent
                </h3>
                <p className="text-xs text-muted-foreground">
                  Overwrites the parent's schema and creates a versioned snapshot. The draft itself is preserved.
                </p>
                <Button onClick={handleMergeIntoParent} disabled={merging} size="sm">
                  {merging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <GitMerge className="h-4 w-4 mr-2" />}
                  Merge into parent
                </Button>
              </section>
            )}

            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">Create new draft branch</h3>
              <div className="space-y-2">
                <Label className="text-xs">Branch label</Label>
                <Input value={branchLabel} onChange={(e) => setBranchLabel(e.target.value)} placeholder="e.g. Q3 rebrand" />
              </div>
              <Button onClick={handleCreateBranch} disabled={creating || !branchLabel.trim()} size="sm">
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <GitBranch className="h-4 w-4 mr-2" />}
                Duplicate as draft
              </Button>
            </section>

            <section className="space-y-3 rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold">Existing branches</h3>
              {branches.length === 0 ? (
                <p className="text-xs text-muted-foreground">No draft branches yet.</p>
              ) : (
                <ul className="space-y-2">
                  {branches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 rounded border p-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{b.name}</div>
                        <div className="text-muted-foreground">
                          {b.branch_label || 'draft'} · updated {formatDistanceToNow(new Date(b.updated_at), { addSuffix: true })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{b.approval_status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => { onOpenChange(false); navigate(`/admin/template-builder/${b.id}`); }}>
                          Open
                        </Button>
                      </div>
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

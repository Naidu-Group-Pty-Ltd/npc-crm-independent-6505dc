/**
 * TemplateAuditLogDialog — reads `template_audit_log` for the current template
 * and surfaces a chronological change log with actor, action, and metadata.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, History, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';

interface TemplateAuditLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
}

interface AuditRow {
  id: string;
  action: string;
  summary: string | null;
  actor_name: string | null;
  metadata: any;
  created_at: string;
}

const ACTION_LABEL: Record<string, { label: string; tone: 'default' | 'outline' | 'destructive' | 'secondary' }> = {
  schema_saved:               { label: 'Schema saved',          tone: 'outline' },
  version_created:            { label: 'Version snapshot',      tone: 'secondary' },
  version_restored:           { label: 'Version restored',      tone: 'secondary' },
  branch_created:             { label: 'Branch created',        tone: 'default' },
  branch_merged:              { label: 'Branch merged',         tone: 'default' },
  approval_requested:         { label: 'Review requested',      tone: 'default' },
  approval_approved:          { label: 'Approved',              tone: 'default' },
  approval_changes_requested: { label: 'Changes requested',     tone: 'destructive' },
  approval_cancelled:         { label: 'Review cancelled',      tone: 'outline' },
  locked:                     { label: 'Locked',                tone: 'destructive' },
  unlocked:                   { label: 'Unlocked',              tone: 'outline' },
  exported_pdf:               { label: 'Exported PDF',          tone: 'secondary' },
  exported_docx:              { label: 'Exported DOCX',         tone: 'secondary' },
  exported_pptx:              { label: 'Exported PPTX',         tone: 'secondary' },
  exported_html:              { label: 'Exported HTML',         tone: 'secondary' },
};

export function TemplateAuditLogDialog({ open, onOpenChange, templateId, templateName }: TemplateAuditLogDialogProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('template_audit_log' as any)
      .select('id,action,summary,actor_name,metadata,created_at')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .limit(200);
    setRows((data ?? []) as unknown as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => { if (open) void load(); }, [open, templateId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Audit Trail
          </DialogTitle>
          <DialogDescription>
            Full change log for <span className="font-medium">{templateName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end px-6 pb-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        <ScrollArea className="flex-1 px-6">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No audit entries yet.</p>
          ) : (
            <ol className="space-y-2 pb-6">
              {rows.map((r) => {
                const meta = ACTION_LABEL[r.action] ?? { label: r.action, tone: 'outline' as const };
                return (
                  <li key={r.id} className="rounded-lg border bg-card p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={meta.tone as any} className="text-[10px]">{meta.label}</Badge>
                        <span className="font-medium">{r.actor_name || 'System'}</span>
                      </div>
                      <span className="text-muted-foreground" title={format(new Date(r.created_at), 'PPpp')}>
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {r.summary && <div className="mt-1 text-muted-foreground">{r.summary}</div>}
                    {r.metadata && Object.keys(r.metadata).length > 0 && (
                      <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-snug">
                        {JSON.stringify(r.metadata, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-3 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

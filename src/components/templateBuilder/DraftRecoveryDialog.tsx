import { useMemo, useState } from 'react';
import { History, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { diffTemplates, summariseDiff } from '@/lib/reportTemplate/diffSchema';
import { type ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { type TemplateDraft } from '@/lib/reportTemplate/templateDraftStore';

export interface DraftRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: TemplateDraft | null;
  /** The currently loaded server schema, for the compare view. */
  serverSchema: ReportTemplate | null;
  currentServerVersion: number;
  /** The draft was based on an older server version than the one now loaded. */
  staleBase?: boolean;
  onRestore: () => void;
  onDiscard: () => void;
  onSaveAsBranch: () => void;
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return 'recently';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString('en-AU');
}

/**
 * Offered on editor load when a locally autosaved draft differs from the saved
 * server copy (Phase 3B). Lets the user restore their work, discard it, inspect
 * the difference, or fork it into a branch — without silently losing anything.
 */
export function DraftRecoveryDialog({
  open,
  onOpenChange,
  draft,
  serverSchema,
  currentServerVersion,
  staleBase = false,
  onRestore,
  onDiscard,
  onSaveAsBranch,
}: DraftRecoveryDialogProps) {
  const [showCompare, setShowCompare] = useState(false);

  const summary = useMemo(() => {
    if (!serverSchema || !draft) return '';
    try {
      return summariseDiff(diffTemplates(serverSchema, draft.schema));
    } catch {
      return '';
    }
  }, [serverSchema, draft]);

  if (!draft) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-brand-500" />
            Recover unsaved draft?
          </DialogTitle>
          <DialogDescription>
            We found locally autosaved changes for this template from {formatWhen(draft.savedAt)} that differ from the
            saved server version. Your edits were never lost — choose how to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-sm">
          {summary && (
            <div className="rounded border bg-muted/30 px-3 py-2">
              <span className="text-muted-foreground">Differences from server: </span>
              <span className="font-medium">{summary}</span>
            </div>
          )}

          {staleBase && (
            <div className="flex items-start gap-2 rounded border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-brand-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This draft was based on server <strong>v{draft.baseServerVersion}</strong>, but the template is now at{' '}
                <strong>v{currentServerVersion}</strong>. Someone else saved in the meantime — review the differences
                before restoring, or keep your draft as a branch.
              </span>
            </div>
          )}

          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setShowCompare((v) => !v)}
          >
            {showCompare ? 'Hide JSON comparison' : 'Compare JSON'}
          </button>

          {showCompare && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Server (v{currentServerVersion})</div>
                <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2 text-[10px] leading-snug">
                  {serverSchema ? JSON.stringify(serverSchema, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Local draft</div>
                <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-2 text-[10px] leading-snug">
                  {JSON.stringify(draft.schema, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={onDiscard} className="text-destructive hover:text-destructive">
            Discard draft
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSaveAsBranch}>
              Save as branch
            </Button>
            <Button onClick={onRestore}>Restore draft</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

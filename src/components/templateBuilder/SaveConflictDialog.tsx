import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface SaveConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The newer version number currently on the server, if known. */
  serverVersion?: number | null;
  /** Whether the current user may force-overwrite the server copy. */
  canOverwrite?: boolean;
  /** True while a follow-up save/reload is in flight. */
  pending?: boolean;
  onReviewLatest: () => void;
  onSaveAsBranch: () => void;
  onOverwrite: () => void;
  onKeepDraft: () => void;
}

/**
 * Surfaced when a save is rejected with a `version_conflict` (someone else saved
 * a newer version). The user's local edits are preserved; this dialog offers the
 * safe ways forward instead of silently overwriting another editor's work.
 */
export function SaveConflictDialog({
  open,
  onOpenChange,
  serverVersion,
  canOverwrite = false,
  pending = false,
  onReviewLatest,
  onSaveAsBranch,
  onOverwrite,
  onKeepDraft,
}: SaveConflictDialogProps) {
  const hasServerVersion = typeof serverVersion === 'number' && Number.isFinite(serverVersion);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-brand-500" />
            This template changed on the server
          </DialogTitle>
          <DialogDescription>
            Someone else saved a newer version{hasServerVersion ? ` (v${serverVersion})` : ''} while you were editing.
            To avoid overwriting their work, your save was stopped. Your local edits are still here — choose how to continue.
          </DialogDescription>
        </DialogHeader>

        <ul className="text-sm text-muted-foreground space-y-2 py-1">
          <li>
            <strong className="text-foreground">Review latest</strong> — discard your local edits and load the server version.
          </li>
          <li>
            <strong className="text-foreground">Save as branch</strong> — keep your edits as a separate branch/version.
          </li>
          <li>
            <strong className="text-foreground">Keep editing</strong> — stay on your draft and resolve it manually.
          </li>
          {canOverwrite && (
            <li>
              <strong className="text-foreground">Overwrite</strong> — replace the server version with your draft (cannot be undone).
            </li>
          )}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onReviewLatest} disabled={pending}>
              Review latest
            </Button>
            <Button variant="outline" onClick={onSaveAsBranch} disabled={pending}>
              Save as branch
            </Button>
          </div>
          <div className="flex gap-2">
            {canOverwrite && (
              <Button
                variant="destructive"
                onClick={onOverwrite}
                disabled={pending || !hasServerVersion}
                title={hasServerVersion ? undefined : 'Server version unknown — review the latest first'}
              >
                Overwrite server
              </Button>
            )}
            <Button onClick={onKeepDraft} disabled={pending}>
              Keep editing
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

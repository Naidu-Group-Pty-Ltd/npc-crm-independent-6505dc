/**
 * Deleting an assessment — or being told plainly why it is kept.
 *
 * The dialog asks the server before it offers anything. Deletion is permanent
 * and narrow (see `deletion.pure.ts`): an assessment that reached a client or a
 * report is kept, and the dialog says which of those it was and offers
 * archiving instead, rather than presenting a button the server will refuse.
 *
 * Two confirmations, sized to what is at stake. A draft — usually a stray click
 * — is deleted from one explicit, destructive button. A completed assessment is
 * a finished position somebody worked for, so its reference is typed first.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, Loader2, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import {
  archiveAssessment, deleteAssessment, previewDeletion, type DeletionPreview,
} from '@/lib/ciAssessment/assessmentManagement';

export interface DeletableAssessment {
  id: string;
  title: string;
  reference: string;
}

interface Props {
  assessment: DeletableAssessment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the record is gone. The caller refreshes or navigates away. */
  onDeleted: (assessment: DeletableAssessment) => void;
  /** Called after "Archive instead" succeeded. */
  onArchived?: (assessment: DeletableAssessment) => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; preview: DeletionPreview };

type Working = 'delete' | 'archive' | null;

export function DeleteAssessmentDialog({ assessment, open, onOpenChange, onDeleted, onArchived }: Props) {
  // Held here, not in the body, because it is what stops the dialog closing
  // while a request is in flight.
  const [working, setWorking] = useState<Working>(null);
  if (!assessment) return null;

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!working) onOpenChange(next); }}>
      <AlertDialogContent>
        {/* The content mounts with each opening, so every opening asks the
            server afresh and starts with nothing typed. */}
        <DeleteAssessmentBody
          key={assessment.id}
          assessment={assessment}
          working={working}
          setWorking={setWorking}
          onOpenChange={onOpenChange}
          onDeleted={onDeleted}
          onArchived={onArchived}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface BodyProps extends Omit<Props, 'assessment' | 'open'> {
  assessment: DeletableAssessment;
  working: Working;
  setWorking: (working: Working) => void;
}

function DeleteAssessmentBody({ assessment, working, setWorking, onOpenChange, onDeleted, onArchived }: BodyProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [typed, setTyped] = useState('');

  // Keyed on the id, not the object: callers build `assessment` inline, and a
  // new object each render must not mean a new request each render.
  const assessmentId = assessment.id;
  useEffect(() => {
    let cancelled = false;
    void previewDeletion(assessmentId).then((result) => {
      if (cancelled) return;
      setLoad(result.error || !result.data
        ? { state: 'error', message: result.error ?? 'The assessment could not be checked.' }
        : { state: 'ready', preview: result.data });
    });
    return () => { cancelled = true; };
  }, [assessmentId, attempt]);

  const retry = () => {
    setLoad({ state: 'loading' });
    setAttempt((current) => current + 1);
  };

  const preview = load.state === 'ready' ? load.preview : null;
  const refused = preview ? !preview.allowed || !preview.permitted : false;
  const referenceMatches = typed.trim().toUpperCase() === assessment.reference.toUpperCase();
  const canDelete = Boolean(preview && preview.allowed && preview.permitted
    && (!preview.typedConfirmation || referenceMatches));
  const offerArchive = Boolean(preview && refused && preview.status !== 'archived'
    && (preview.archiveOffered || !preview.permitted));

  const doDelete = async () => {
    setWorking('delete');
    const result = await deleteAssessment(assessment.id, preview?.typedConfirmation ? typed.trim() : undefined);
    setWorking(null);
    if (result.error) {
      if (result.code === 'DELETION_REFUSED' && preview) {
        // Something changed between the check and the click — a report was
        // requested, say. Show the server's reason in place of the button.
        setLoad({
          state: 'ready',
          preview: {
            ...preview,
            allowed: false,
            message: result.error,
            archiveOffered: Boolean(result.body?.archiveOffered ?? true),
          },
        });
        return;
      }
      toast({ title: 'Could not delete the assessment', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Assessment deleted', description: `${assessment.reference} and its working history were removed.` });
    onOpenChange(false);
    onDeleted(assessment);
  };

  const doArchive = async () => {
    setWorking('archive');
    const result = await archiveAssessment(assessment.id);
    setWorking(null);
    if (result.error) {
      toast({ title: 'Could not archive the assessment', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Assessment archived', description: 'It is out of your working lists. Restore it any time from Archived.' });
    onOpenChange(false);
    onArchived?.(assessment);
  };

  const title = !preview
    ? 'Delete assessment'
    : refused
      ? 'This assessment is kept'
      : `Delete “${assessment.title}”?`;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {load.state === 'loading' ? (
          <div className="space-y-2" aria-live="polite">
            <span className="sr-only">Checking whether this assessment can be deleted…</span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : load.state === 'error' ? (
          <AlertDialogDescription asChild>
            <div className="ci-warning-row ci-warning-critical" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{load.message}</span>
            </div>
          </AlertDialogDescription>
        ) : preview && !preview.permitted ? (
          <AlertDialogDescription>
            You do not have permission to delete Commercial &amp; Industrial assessments.
            {preview.status !== 'archived' ? ' You can archive it instead, or ask an administrator to delete it.' : ' Ask an administrator to delete it.'}
          </AlertDialogDescription>
        ) : preview && !preview.allowed ? (
          <AlertDialogDescription>{preview.message}</AlertDialogDescription>
        ) : preview ? (
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">{assessment.reference}</span> will be removed
                permanently. This cannot be undone.
              </p>
              <p>{preview.message}</p>
              {preview.counts.calculationRuns || preview.counts.scenarios ? (
                <p>
                  Removed with it:{' '}
                  {[
                    preview.counts.calculationRuns
                      ? `${preview.counts.calculationRuns} saved calculation run${preview.counts.calculationRuns === 1 ? '' : 's'}`
                      : null,
                    preview.counts.scenarios
                      ? `${preview.counts.scenarios} scenario${preview.counts.scenarios === 1 ? '' : 's'}`
                      : null,
                  ].filter(Boolean).join(' and ')}.
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        ) : null}
      </AlertDialogHeader>

      {preview && !refused && preview.typedConfirmation ? (
        <div className="space-y-1.5">
          <Label htmlFor="delete-assessment-reference" className="ci-field-label">
            Type {assessment.reference} to confirm
          </Label>
          <Input
            id="delete-assessment-reference"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={assessment.reference}
            disabled={working !== null}
          />
          <p className="text-xs text-muted-foreground">
            This assessment is complete, so its reference is typed back before it is deleted.
          </p>
        </div>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={working !== null}>{refused ? 'Close' : 'Cancel'}</AlertDialogCancel>
        {load.state === 'error' ? (
          <Button variant="outline" onClick={retry}>Try again</Button>
        ) : null}
        {offerArchive ? (
          <Button variant="outline" onClick={() => void doArchive()} disabled={working !== null}>
            {working === 'archive'
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              : <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Archive instead
          </Button>
        ) : null}
        {preview && !refused ? (
          <Button variant="destructive" onClick={() => void doDelete()} disabled={!canDelete || working !== null}>
            {working === 'delete'
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              : <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {working === 'delete' ? 'Deleting…' : 'Delete permanently'}
          </Button>
        ) : null}
      </AlertDialogFooter>
    </>
  );
}

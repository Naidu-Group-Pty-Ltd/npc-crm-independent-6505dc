/**
 * "Use template" — name the working copy and create it.
 *
 * The copy is assembled server-side in `manage-template-library` from the
 * verified session. This dialog supplies a name and a description and nothing
 * else; it cannot influence scope, ownership or activation state.
 *
 * ## Why it no longer jumps into the Builder
 *
 * It used to `navigate()` into `/admin/template-builder/:id` on success, with
 * no other outcome available. That made the editor the destination of every
 * template interaction in the product — including the one people actually
 * wanted, which was to pick the template their reports come out in. Choosing is
 * not editing, and it now has its own surface (`ReportTemplatePicker`), so
 * opening the Builder is an option here rather than the only way out.
 *
 * The default is to stay put. A working copy is inactive until it is approved
 * and activated, so there is nothing about creating one that requires the
 * editor to be open.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useCreateWorkingCopy } from '@/hooks/useTemplateLibrary';
import { findColourway, resolveColourway } from '@/lib/templateLibrary/colourways';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry | null;
  /**
   * The colourway the user was looking at. Null means the entry's default.
   *
   * Sent to the server as a request, not an instruction:
   * `resolveRequestedColourway` validates it against the entry's own curated
   * list and rejects anything else rather than falling back silently.
   */
  colourwayId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_NAME = 200;

export function UseTemplateDialog({ entry, colourwayId = null, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const createCopy = useCreateWorkingCopy();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  // Re-prefill whenever a different template is chosen, and reset the error
  // state so a previous validation message does not carry over.
  useEffect(() => {
    if (open && entry) {
      setName(`${entry.name} copy`.slice(0, MAX_NAME));
      setDescription('');
      setTouched(false);
    }
  }, [open, entry]);

  if (!entry) return null;

  // Named on the confirmation, because the copy is baked in this palette and a
  // colour is not something a user should have to open the Builder to verify.
  const selectedColourway = entry.designMeta?.familyKey
    ? findColourway(entry.designMeta.familyKey, colourwayId ?? entry.designMeta.defaultColourway)
    : null;

  const trimmed = name.trim();
  const nameError = !trimmed
    ? 'Give the working copy a name.'
    : trimmed.length > MAX_NAME
      ? `Names must be ${MAX_NAME} characters or fewer.`
      : null;

  const submit = (thenEdit: boolean) => {
    setTouched(true);
    if (nameError) return;
    createCopy.mutate(
      {
        entryId: entry.id,
        name: trimmed,
        description: description.trim() || undefined,
        ...(colourwayId ? { colourwayId } : {}),
      },
      {
        onSuccess: ({ templateId }) => {
          toast.success(
            selectedColourway
              ? `Working copy created in ${selectedColourway.name}`
              : 'Working copy created',
          );
          onOpenChange(false);
          // Only when they asked for it. The copy exists either way, and it is
          // inactive until approved — there is nothing here that has to be
          // finished in an editor.
          if (thenEdit) navigate(`/admin/template-builder/${templateId}`);
        },
        // Errors surface as a toast from the hook; the dialog stays open with
        // the user's input intact so a retry costs nothing.
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!createCopy.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use this template</DialogTitle>
          <DialogDescription>
            Creates your own editable copy of <span className="font-medium text-foreground">{entry.name}</span>.
            The library template is not modified, and your copy is private to you until it is approved
            and activated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="working-copy-name">Template name</Label>
            <Input
              id="working-copy-name"
              value={name}
              maxLength={MAX_NAME + 1}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={createCopy.isPending}
              aria-invalid={touched && !!nameError}
              aria-describedby={touched && nameError ? 'working-copy-name-error' : undefined}
              autoFocus
            />
            {touched && nameError && (
              <p id="working-copy-name-error" className="text-xs text-destructive">{nameError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="working-copy-description">Description (optional)</Label>
            <Textarea
              id="working-copy-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={createCopy.isPending}
              rows={3}
              placeholder="What this version is for, or who it is for."
            />
          </div>

          {selectedColourway && (
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              {/* The document's own colours, so they arrive as custom
                  properties rather than inline paint — see the note on
                  `Swatch` in TemplateColourwayPicker. */}
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-[var(--sw-paper)] ring-1 ring-black/15"
                style={{
                  ['--sw-paper' as string]: resolveColourway(selectedColourway).surface,
                  ['--sw-accent' as string]: resolveColourway(selectedColourway).primary,
                }}
              >
                <span className="h-3 w-3 rounded-[1px] bg-[var(--sw-accent)]" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{selectedColourway.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedColourway.ground === 'dark' ? 'Dark ground' : 'Light ground'} · baked into
                  your copy. Change it any time in the Template Builder.
                </p>
              </div>
            </div>
          )}

          {!entry.compatibility.productionReady && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                This template is preview only. You can design and save your copy, but it cannot be
                activated for live report generation until this report type has a production adapter.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createCopy.isPending}
          >
            Cancel
          </Button>
          {/* Opening the editor is now a choice, and the quieter of the two. */}
          <Button
            variant="outline"
            onClick={() => submit(true)}
            disabled={createCopy.isPending || (touched && !!nameError)}
          >
            Create and edit
          </Button>
          <Button onClick={() => submit(false)} disabled={createCopy.isPending || (touched && !!nameError)}>
            {createCopy.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {createCopy.isPending ? 'Creating…' : 'Create working copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

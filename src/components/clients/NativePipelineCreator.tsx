import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Creates a pipeline in this deployment's own CRM.
 *
 * On the CRM-independent line nothing syncs pipelines in, so an empty Client
 * Tracker had no way to acquire stages. This is that way: a name and the
 * stages, one per line, written by `manage-automation-settings`
 * (`createPipeline`) into the tables the tracker already reads.
 */
const DEFAULT_STAGES = ['New lead', 'Discovery call booked', 'Proposal sent', 'Engaged', 'Settled'];

/** One stage per line; blanks dropped, repeats kept once. */
export function parseStageLines(text: string): string[] {
  return Array.from(new Set(text.split('\n').map((line) => line.trim()).filter(Boolean)));
}

export function NativePipelineCreator() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Sales pipeline');
  const [stageText, setStageText] = useState(DEFAULT_STAGES.join('\n'));
  const [saving, setSaving] = useState(false);

  const stages = parseStageLines(stageText);
  const canSave = name.trim().length > 0 && stages.length > 0 && stages.length <= 30 && !saving;

  const handleCreate = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction<{ success: boolean; error?: string }>(
        'manage-automation-settings',
        { operation: 'createPipeline', data: { name: name.trim(), stages } },
      );
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Could not create the pipeline.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ghl-pipelines'] }),
        queryClient.invalidateQueries({ queryKey: ['ghl-pipeline-stages'] }),
      ]);
      toast.success(`Pipeline "${name.trim()}" created with ${stages.length} stages`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the pipeline.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="rounded-xl font-semibold shadow-md shadow-primary/20">
        <Plus className="h-4 w-4 mr-2" />
        Create a pipeline
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a pipeline</DialogTitle>
            <DialogDescription>
              Name the pipeline and list its stages in order, one per line.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="native-pipeline-name">Pipeline name</Label>
              <Input
                id="native-pipeline-name"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="native-pipeline-stages">Stages</Label>
              <Textarea
                id="native-pipeline-stages"
                rows={7}
                value={stageText}
                onChange={(e) => setStageText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {stages.length} {stages.length === 1 ? 'stage' : 'stages'}
                {stages.length > 30 ? ' — a pipeline may have at most 30.' : ''}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!canSave}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

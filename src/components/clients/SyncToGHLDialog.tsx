import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

interface GHLPipeline {
  id: string;
  ghl_id: string;
  name: string;
  position?: number | null;
}

interface GHLPipelineStage {
  id: string;
  ghl_id: string;
  name: string;
  position?: number | null;
  pipeline_id: string;
}

interface SyncToGHLDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  onSyncComplete?: () => void;
}

export function SyncToGHLDialog({ open, onOpenChange, clientId, clientName, onSyncComplete }: SyncToGHLDialogProps) {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);

  const { data: pipelines = [], isLoading: pipelinesLoading } = useQuery({
    queryKey: ['ghl-pipelines'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getPipelines',
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to load pipelines');
      return (data.pipelines || []) as GHLPipeline[];
    },
    enabled: open,
  });

  const { data: allPipelineStages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['ghl-pipeline-stages'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getStages',
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to load stages');
      return (data.stages || []) as GHLPipelineStage[];
    },
    enabled: open,
  });

  const pipelineStages = useMemo(() => {
    if (!selectedPipelineId) return [];
    return allPipelineStages
      .filter((stage) => stage.pipeline_id === selectedPipelineId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [allPipelineStages, selectedPipelineId]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const syncPayload: any = { clientId };

      if (selectedStageId) {
        const stage = pipelineStages.find((s) => s.id === selectedStageId);
        const pipeline = pipelines.find((p) => p.id === stage?.pipeline_id);
        if (stage) syncPayload.pipelineStageGhlId = stage.ghl_id;
        if (pipeline?.ghl_id) syncPayload.pipelineGhlId = pipeline.ghl_id;
      }

      const { data, error } = await invokeSecureFunction('sync-client-to-ghl', syncPayload);
      if (error) throw error;

      if (data?.success) {
        const parts: string[] = [];
        if (data.isNewContact) parts.push('Contact created in GHL');
        else parts.push('Contact synced to GHL');
        if (data.opportunityCreated) parts.push('opportunity created');
        toast.success(parts.join(' & '));
        onSyncComplete?.();
        onOpenChange(false);
      } else {
        throw new Error(data?.error || 'Sync failed');
      }
    } catch (error: any) {
      console.error('GHL sync error:', error);
      toast.error(`Sync failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!isSyncing) {
      onOpenChange(open);
      if (!open) {
        setSelectedPipelineId('');
        setSelectedStageId('');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sync to GoHighLevel</DialogTitle>
          <DialogDescription>
            Sync <strong>{clientName}</strong> to GHL. Optionally select a pipeline stage to create an opportunity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Pipeline (Optional)</Label>
            <Select
              value={selectedPipelineId}
              onValueChange={(value) => {
                setSelectedPipelineId(value);
                setSelectedStageId('');
              }}
              disabled={pipelinesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={pipelinesLoading ? 'Loading pipelines...' : 'Select a pipeline...'} />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Pipeline Stage</Label>
            <Select
              value={selectedStageId}
              onValueChange={setSelectedStageId}
              disabled={!selectedPipelineId || stagesLoading || pipelineStages.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !selectedPipelineId
                      ? 'Select a pipeline first...'
                      : stagesLoading
                        ? 'Loading stages...'
                        : pipelineStages.length === 0
                          ? 'No stages available'
                          : 'Select a stage...'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {pipelineStages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isSyncing}>
            Cancel
          </Button>
          <Button onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Syncing...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Sync to GHL</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

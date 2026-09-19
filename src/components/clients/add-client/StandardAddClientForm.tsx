import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import {
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, UserPlus } from 'lucide-react';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

interface StandardAddClientFormProps {
  active: boolean;
  onCancel: () => void;
  onCreated: () => void;
}

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

export function StandardAddClientForm({ active, onCancel, onCreated }: StandardAddClientFormProps) {
  const queryClient = useQueryClient();
  const [syncToGHL, setSyncToGHL] = useState(true);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [selectedStageId, setSelectedStageId] = useState<string>('');
  const [formData, setFormData] = useState({
    primary_first_name: '',
    primary_surname: '',
    primary_email: '',
    primary_mobile: '',
    secondary_first_name: '',
    secondary_surname: '',
    secondary_email: '',
    secondary_mobile: '',
    current_address: '',
  });

  const {
    data: pipelines = [],
    isLoading: pipelinesLoading,
  } = useQuery({
    queryKey: ['ghl-pipelines'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getPipelines',
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Failed to load pipelines');
      }

      return (data.pipelines || []) as GHLPipeline[];
    },
    enabled: active && syncToGHL,
  });

  const {
    data: allPipelineStages = [],
    isLoading: stagesLoading,
  } = useQuery({
    queryKey: ['ghl-pipeline-stages'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getStages',
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Failed to load pipeline stages');
      }

      return (data.stages || []) as GHLPipelineStage[];
    },
    enabled: active && syncToGHL,
  });

  const pipelineStages = useMemo(() => {
    if (!selectedPipelineId) return [];

    return allPipelineStages
      .filter((stage) => stage.pipeline_id === selectedPipelineId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }, [allPipelineStages, selectedPipelineId]);

  const createClientMutation = useMutation({
    mutationFn: async () => {
      const clientData = {
        primary_first_name: formData.primary_first_name.trim(),
        primary_surname: formData.primary_surname.trim(),
        primary_email: formData.primary_email.trim() || null,
        primary_mobile: formData.primary_mobile.trim() || null,
        secondary_first_name: formData.secondary_first_name.trim() || null,
        secondary_surname: formData.secondary_surname.trim() || null,
        secondary_email: formData.secondary_email.trim() || null,
        secondary_mobile: formData.secondary_mobile.trim() || null,
        current_address: formData.current_address.trim() || null,
        ghl_sync_status: syncToGHL ? 'pending' : null,
        total_portfolio_value: 0,
        total_debt: 0,
        net_monthly_cash_flow: 0,
      };

      let newClient: any = null;

      // Use secure Edge Function with HttpOnly cookie auth
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'create',
          table: 'clients',
          clientId: '',
          data: clientData,
        });
        
        if (!error && data?.success) {
          newClient = data.result;
        }
      } catch (err) {
        console.warn('Secure client creation failed:', err);
      }
      
      if (!newClient) {
        throw new Error('Unable to create the client securely. Please try again.');
      }

      // Sync to GHL if enabled
      if (syncToGHL && newClient) {
        const syncPayload: any = { clientId: newClient.id };
        
        // If a pipeline stage was selected, include it for opportunity creation
        if (selectedStageId) {
          const stage = pipelineStages.find((s) => s.id === selectedStageId);
          const pipeline = pipelines.find((p) => p.id === stage?.pipeline_id);

          if (stage) {
            syncPayload.pipelineStageGhlId = stage.ghl_id;
          }

          if (pipeline?.ghl_id) {
            syncPayload.pipelineGhlId = pipeline.ghl_id;
          }
        }
        
        const { data: syncResult, error: syncError } = await invokeSecureFunction('sync-client-to-ghl', syncPayload);

        if (syncError) {
          console.error('GHL sync error:', syncError);
          toast.warning('Client created but failed to sync to GHL');
        } else if (syncResult?.success) {
          toast.success('Client created and synced to GoHighLevel');
          return newClient;
        }
      }

      return newClient;
    },
    onSuccess: (newClient: any) => {
      // Log activity
      logActivityDirect({
        actionType: 'client_created',
        entityType: 'client',
        entityId: newClient?.id,
        entityName: `${formData.primary_first_name} ${formData.primary_surname}`.trim(),
        metadata: { synced_to_ghl: syncToGHL }
      });
      invalidateClientQueries(queryClient, newClient?.id);
      if (!syncToGHL) {
        toast.success('Client created successfully');
      }
      resetForm();
      onCreated();
    },
    onError: (error: any) => {
      toast.error('Failed to create client: ' + error.message);
    }
  });

  const resetForm = () => {
    setFormData({
      primary_first_name: '',
      primary_surname: '',
      primary_email: '',
      primary_mobile: '',
      secondary_first_name: '',
      secondary_surname: '',
      secondary_email: '',
      secondary_mobile: '',
      current_address: '',
    });
    setSyncToGHL(true);
    setSelectedPipelineId('');
    setSelectedStageId('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.primary_first_name.trim() || !formData.primary_surname.trim()) {
      toast.error('First name and surname are required');
      return;
    }
    const secondaryHasDetails = [
      formData.secondary_first_name,
      formData.secondary_surname,
      formData.secondary_email,
      formData.secondary_mobile,
    ].some((value) => value.trim());
    if (secondaryHasDetails && (!formData.secondary_first_name.trim() || !formData.secondary_surname.trim())) {
      toast.error("Enter the Secondary Contact's name before saving their contact details.");
      return;
    }
    createClientMutation.mutate();
  };

  return (
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="space-y-5 px-5 py-5 sm:px-6">
          {/* Primary Contact */}
          <div className="space-y-3 rounded-2xl border border-border dark:border-white/10 bg-white/[0.035] p-4">
            <h4 className="text-sm font-semibold text-brand-100">Primary Contact</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="primary_first_name">First Name *</Label>
                <Input
                  id="primary_first_name"
                  value={formData.primary_first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, primary_first_name: e.target.value }))}
                  placeholder="John"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="primary_surname">Surname *</Label>
                <Input
                  id="primary_surname"
                  value={formData.primary_surname}
                  onChange={(e) => setFormData(prev => ({ ...prev, primary_surname: e.target.value }))}
                  placeholder="Smith"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="primary_email">Email</Label>
                <Input
                  id="primary_email"
                  type="email"
                  value={formData.primary_email}
                  onChange={(e) => setFormData(prev => ({ ...prev, primary_email: e.target.value }))}
                  placeholder="john@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="primary_mobile">Mobile</Label>
                <Input
                  id="primary_mobile"
                  value={formData.primary_mobile}
                  onChange={(e) => setFormData(prev => ({ ...prev, primary_mobile: e.target.value }))}
                  placeholder="0400 000 000"
                />
              </div>
            </div>
          </div>

          {/* Secondary Contact */}
          <div className="space-y-3 rounded-2xl border border-border dark:border-white/10 bg-white/[0.025] p-4">
            <h4 className="text-sm font-semibold text-muted-foreground dark:text-foreground">Secondary Contact (Optional)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="secondary_first_name">First Name</Label>
                <Input
                  id="secondary_first_name"
                  value={formData.secondary_first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, secondary_first_name: e.target.value }))}
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="secondary_surname">Surname</Label>
                <Input
                  id="secondary_surname"
                  value={formData.secondary_surname}
                  onChange={(e) => setFormData(prev => ({ ...prev, secondary_surname: e.target.value }))}
                  placeholder="Smith"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="secondary_email">Email</Label>
                <Input
                  id="secondary_email"
                  type="email"
                  value={formData.secondary_email}
                  onChange={(e) => setFormData(prev => ({ ...prev, secondary_email: e.target.value }))}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="secondary_mobile">Mobile</Label>
                <Input
                  id="secondary_mobile"
                  type="tel"
                  value={formData.secondary_mobile}
                  onChange={(e) => setFormData(prev => ({ ...prev, secondary_mobile: e.target.value }))}
                  placeholder="0400 000 000"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1.5 rounded-2xl border border-border dark:border-white/10 bg-white/[0.025] p-4">
            <Label htmlFor="current_address">Current Address</Label>
            <Input
              id="current_address"
              value={formData.current_address}
              onChange={(e) => setFormData(prev => ({ ...prev, current_address: e.target.value }))}
              placeholder="123 Main St, Sydney NSW 2000"
            />
          </div>

          {/* Sync Option */}
          <div className="flex items-center space-x-2 rounded-2xl border border-brand-300/20 bg-brand-300/10 p-4">
            <Checkbox
              id="syncToGHL"
              checked={syncToGHL}
              onCheckedChange={(checked) => setSyncToGHL(checked as boolean)}
            />
            <Label htmlFor="syncToGHL" className="text-sm font-normal cursor-pointer">
              Sync to GoHighLevel after creating
            </Label>
          </div>

          {/* Pipeline + Stage (shown when GHL sync enabled) */}
          {syncToGHL && (
            <div className="space-y-3 rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/20 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="pipeline">Pipeline (Optional)</Label>
                <Select
                  value={selectedPipelineId}
                  onValueChange={(value) => {
                    setSelectedPipelineId(value);
                    setSelectedStageId('');
                  }}
                  disabled={pipelinesLoading || pipelines.length === 0}
                >
                  <SelectTrigger id="pipeline">
                    <SelectValue
                      placeholder={
                        pipelinesLoading
                          ? 'Loading pipelines...'
                          : pipelines.length === 0
                            ? 'No pipelines available'
                            : 'Select a pipeline...'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!pipelinesLoading && pipelines.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No active GoHighLevel pipelines were returned for this account.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pipeline_stage">Pipeline Stage (Optional)</Label>
                <Select
                  value={selectedStageId}
                  onValueChange={setSelectedStageId}
                  disabled={!selectedPipelineId || stagesLoading || pipelineStages.length === 0}
                >
                  <SelectTrigger id="pipeline_stage">
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
                    {pipelineStages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          </div>
          <DialogFooter className="sticky bottom-0 mt-auto shrink-0 gap-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur dark:border-white/10 sm:gap-2 sm:px-6">
            <Button type="button" variant="outline" onClick={onCancel} className="rounded-2xl border-border dark:border-white/15 bg-white/[0.03] hover:bg-white/[0.07]">
              Cancel
            </Button>
            <Button type="submit" disabled={createClientMutation.isPending} className="rounded-2xl bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 font-bold text-black shadow-lg shadow-brand-500/25 hover:from-brand-200 hover:via-brand-300 hover:to-brand-400 disabled:opacity-60">
              {createClientMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create Client
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
  );
}

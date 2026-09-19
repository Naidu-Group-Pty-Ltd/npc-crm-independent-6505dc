import { useState, useEffect } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings2, Trash2, Play, Pause, AlertTriangle, Zap, History, RefreshCw, Eye, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { SwitchConfigModal } from '@/components/automation/SwitchConfigModal';
import { GenerationLogModal } from '@/components/automation/GenerationLogModal';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { isClientFacingDeployment } from '@/lib/clientFacing';

interface AutoReportSwitch {
  id: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  priority: number;
  criteria: SwitchCriteria;
  created_at: string;
  updated_at: string;
}

// Helper to cast Json to SwitchCriteria
const parseCriteria = (criteria: unknown): SwitchCriteria => {
  if (typeof criteria === 'object' && criteria !== null) {
    return criteria as SwitchCriteria;
  }
  return {};
};

export interface SwitchCriteria {
  propertyTypes?: string[];
  priceMin?: number | null;
  priceMax?: number | null;
  bedsMin?: number | null;
  bedsMax?: number | null;
  bathsMin?: number | null;
  bathsMax?: number | null;
  states?: string[];
  categories?: string[];
  confidenceMin?: number | null;
  hasPrice?: boolean | null;
  sourceHosts?: string[];
}

const Automation = () => {
  const { canEdit, canDelete } = useModulePermissions('automation');
  // The sync card pokes the Airtable intake pipeline directly (dry run, sync
  // now, a destructive queue clear). Client-facing deployments keep the
  // report-generation switches and drop the pipeline controls — the pipeline
  // itself runs server-side and is untouched by hiding them.
  const showPipelineControls = !isClientFacingDeployment();
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [switches, setSwitches] = useState<AutoReportSwitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [masterLoading, setMasterLoading] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [editingSwitch, setEditingSwitch] = useState<AutoReportSwitch | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncStats, setSyncStats] = useState<{ total: number; generated: number; lastSync?: string } | null>(null);

  useEffect(() => {
    fetchMasterSettings();
    fetchSwitches();
    fetchSyncStats();
  }, []);

  const fetchSyncStats = async () => {
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'getSyncStats'
    });
    
    if (!error && data?.success) {
      setSyncStats(data.stats);
    }
  };

  const runSync = async (dryRun: boolean = false) => {
    setSyncing(true);
    try {
      const response = await invokeSecureFunction('auto-report-sync', {
        maxRecords: 50, dryRun
      });
      
      if (response.error) throw response.error;
      
      const result = response.data;
      
      if (dryRun) {
        const matches = result.results?.filter((r: any) => r.status === 'generated').length || 0;
        toast.success(`Dry run complete: ${matches} listing(s) would be processed`);
      } else {
        toast.success(`Sync complete: ${result.summary?.generated || 0} report(s) generated`);
        fetchSyncStats();
      }
    } catch (error) {
      toast.error(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const clearQueue = async () => {
    setClearing(true);
    try {
      // Delete reports that are stuck in processing, pending, or failed status via edge function
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'clearStuckReports'
      });

      if (error || !data?.success) throw new Error(data?.error || error?.message);

      const count = data?.length || 0;
      toast.success(`Cleared ${count} report(s) from queue`);
      fetchSyncStats();
      
      logActivityDirect({
        actionType: 'report_deleted',
        entityType: 'investment_report',
        entityName: `Cleared ${count} stuck reports`,
        metadata: { statuses: ['processing', 'pending', 'failed'], count }
      });
    } catch (error) {
      toast.error(`Failed to clear queue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  };

  const fetchMasterSettings = async () => {
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'getMasterSettings'
    });
    
    if (!error && data?.success) {
      setMasterEnabled(data.settings?.is_enabled || false);
    }
  };

  const fetchSwitches = async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'getSwitches'
    });
    
    if (error || !data?.success) {
      toast.error('Failed to load switches');
    } else {
      setSwitches((data.switches || []).map((d: any) => ({
        ...d,
        criteria: parseCriteria(d.criteria)
      })));
    }
    setLoading(false);
  };

  const toggleMaster = async () => {
    setMasterLoading(true);
    const newValue = !masterEnabled;
    
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'updateMasterSettings',
      data: { is_enabled: newValue }
    });
    
    if (error || !data?.success) {
      toast.error('Failed to update master switch');
    } else {
      setMasterEnabled(newValue);
      toast.success(newValue ? 'Auto-generation enabled' : 'Auto-generation disabled');
      logActivityDirect({
        actionType: 'automation_master_toggle_changed',
        entityType: 'automation_switch',
        entityName: 'Master Switch',
        metadata: { enabled: newValue }
      });
    }
    setMasterLoading(false);
  };

  const toggleSwitch = async (switchItem: AutoReportSwitch) => {
    const newValue = !switchItem.is_enabled;
    
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'updateSwitch',
      switchId: switchItem.id,
      data: { is_enabled: newValue }
    });
    
    if (error || !data?.success) {
      toast.error('Failed to update switch');
    } else {
      setSwitches(prev => prev.map(s => 
        s.id === switchItem.id ? { ...s, is_enabled: newValue } : s
      ));
      toast.success(`Switch "${switchItem.name}" ${newValue ? 'enabled' : 'disabled'}`);
      logActivityDirect({
        actionType: newValue ? 'automation_switch_enabled' : 'automation_switch_disabled',
        entityType: 'automation_switch',
        entityId: switchItem.id,
        entityName: switchItem.name
      });
    }
  };

  const deleteSwitch = async (switchItem: AutoReportSwitch) => {
    if (!confirm(`Are you sure you want to delete "${switchItem.name}"?`)) return;
    
    const { data, error } = await invokeSecureFunction('manage-automation-settings', {
      operation: 'deleteSwitch',
      switchId: switchItem.id
    });
    
    if (error || !data?.success) {
      toast.error('Failed to delete switch');
    } else {
      setSwitches(prev => prev.filter(s => s.id !== switchItem.id));
      toast.success('Switch deleted');
      logActivityDirect({
        actionType: 'automation_switch_deleted',
        entityType: 'automation_switch',
        entityId: switchItem.id,
        entityName: switchItem.name
      });
    }
  };

  const openEditModal = (switchItem: AutoReportSwitch) => {
    setEditingSwitch(switchItem);
    setConfigModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingSwitch(null);
    setConfigModalOpen(true);
  };

  const handleSwitchSaved = () => {
    fetchSwitches();
    setConfigModalOpen(false);
    setEditingSwitch(null);
  };

  const getCriteriaCount = (criteria: SwitchCriteria): number => {
    let count = 0;
    if (criteria.propertyTypes?.length) count++;
    if (criteria.priceMin !== null && criteria.priceMin !== undefined) count++;
    if (criteria.priceMax !== null && criteria.priceMax !== undefined) count++;
    if (criteria.bedsMin !== null && criteria.bedsMin !== undefined) count++;
    if (criteria.bedsMax !== null && criteria.bedsMax !== undefined) count++;
    if (criteria.bathsMin !== null && criteria.bathsMin !== undefined) count++;
    if (criteria.bathsMax !== null && criteria.bathsMax !== undefined) count++;
    if (criteria.states?.length) count++;
    if (criteria.categories?.length) count++;
    if (criteria.confidenceMin !== null && criteria.confidenceMin !== undefined) count++;
    if (criteria.hasPrice !== null && criteria.hasPrice !== undefined) count++;
    if (criteria.sourceHosts?.length) count++;
    return count;
  };

  const enabledSwitchesCount = switches.filter(s => s.is_enabled).length;

  return (
    <>
      <DashboardThemeFrame
        variant="page"
        className="min-w-0 space-y-6 overflow-x-hidden rounded-[2rem] bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_30%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)/0.92))] p-3 pb-8 text-foreground sm:p-5 lg:p-6"
      >
        {/* Header */}
        <DashboardThemeFrame
          as="header"
          variant="hero"
          className="flex min-w-0 flex-col gap-4 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.86)_54%,hsl(var(--muted)/0.34))] shadow-[0_22px_70px_rgba(15,23,42,0.10)] dark:shadow-black/30 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-[0_14px_35px_hsl(var(--primary)/0.16)]">
              <Zap className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Auto Report Generation</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Configure automated investment report generation for incoming listings
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => setLogModalOpen(true)}
              size="sm"
              aria-label="View auto-generation log"
              className="min-h-[44px] border-border/70 bg-background/80 shadow-sm transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-foreground focus-visible:ring-primary/45 sm:size-default"
            >
              <History className="h-4 w-4 mr-2" />
              View Log
            </Button>
          </div>
        </DashboardThemeFrame>

        {/* Airtable Sync Controls */}
        {showPipelineControls && (
        <Card className="relative overflow-hidden rounded-3xl border border-info/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--info)/0.14),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.86)_58%,hsl(var(--info)/0.06))] shadow-[0_18px_52px_rgba(15,23,42,0.08)] ring-1 ring-white/45 dark:border-info/20 dark:ring-white/10 dark:shadow-black/25">
          <CardContent className="p-4 sm:p-5">
            <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-info/25 bg-info/15 text-info shadow-[0_12px_30px_hsl(var(--info)/0.14)] dark:text-info">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold tracking-tight text-foreground">Airtable Sync</p>
                    <p className="max-w-2xl text-xs leading-5 text-muted-foreground sm:text-sm">
                      Sync new listings from Airtable and auto-generate reports based on your switch criteria.
                    </p>
                  </div>
                  {syncStats && (
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="border-info/30 bg-background/70 text-foreground shadow-sm">
                        {syncStats.total} processed
                      </Badge>
                      <Badge variant="secondary" className="bg-primary/10 text-foreground shadow-sm">
                        {syncStats.generated} reports generated
                      </Badge>
                      {syncStats.lastSync && (
                        <span className="min-w-0 truncate rounded-full border border-border/60 bg-background/55 px-2.5 py-1 text-muted-foreground">
                          Last: {new Date(syncStats.lastSync).toLocaleDateString('en-AU')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:flex-nowrap lg:shrink-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      disabled={clearing || !syncStats?.total}
                      aria-label="Clear stuck report queue"
                      className="min-h-[44px] flex-1 border-destructive/25 bg-background/70 text-destructive shadow-sm transition-all hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/35 sm:min-h-0 sm:flex-none"
                    >
                      <XCircle className={`h-4 w-4 mr-1 ${clearing ? 'animate-spin' : ''}`} />
                      {clearing ? 'Clearing...' : 'Clear Queue'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="w-[95vw] rounded-2xl border-destructive/20 sm:w-auto">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear Stuck Reports?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will delete all reports with "processing", "pending", or "failed" status. 
                        Completed reports will NOT be affected. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={clearQueue} className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90">
                        Clear Queue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => runSync(true)}
                  disabled={syncing || !masterEnabled}
                  aria-label="Run Airtable sync dry run"
                  className="min-h-[44px] flex-1 border-warning/30 bg-warning/10 text-foreground shadow-sm transition-all hover:border-warning/45 hover:bg-warning/15 focus-visible:ring-warning/40 sm:min-h-0 sm:flex-none"
                >
                  <Eye className="h-4 w-4 mr-1 text-warning" />
                  Dry Run
                </Button>
                <Button 
                  size="sm"
                  onClick={() => runSync(false)}
                  disabled={syncing || !masterEnabled}
                  aria-label="Sync Airtable listings now"
                  className="min-h-[44px] flex-1 bg-primary text-primary-foreground shadow-[0_12px_28px_hsl(var(--primary)/0.20)] transition-all hover:bg-primary-hover focus-visible:ring-primary/45 sm:min-h-0 sm:flex-none"
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Master Switch Card */}
        <Card className={masterEnabled ? 'relative overflow-hidden rounded-3xl border-success/35 bg-[radial-gradient(circle_at_top_left,hsl(var(--success)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.86)_58%,hsl(var(--success)/0.08))] shadow-[0_18px_52px_rgba(15,23,42,0.08)] ring-1 ring-white/45 dark:border-success/20 dark:ring-white/10 dark:shadow-black/25' : 'relative overflow-hidden rounded-3xl border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--muted)/0.42),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.88)_58%,hsl(var(--muted)/0.18))] shadow-[0_18px_52px_rgba(15,23,42,0.07)] ring-1 ring-white/45 dark:border-white/10 dark:ring-white/10 dark:shadow-black/25'}>
          <CardHeader className="pb-4">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-[0_12px_30px_rgba(15,23,42,0.08)] ${masterEnabled ? 'border-success/30 bg-success/15 text-success dark:text-success' : 'border-border/70 bg-muted/60 text-muted-foreground'}`}>
                  <Zap className="h-6 w-6" />
                </div>
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-xl tracking-tight text-foreground">Master Switch</CardTitle>
                  <CardDescription className="max-w-2xl text-sm leading-5">
                    {masterEnabled 
                      ? `Active with ${enabledSwitchesCount} enabled switch${enabledSwitchesCount !== 1 ? 'es' : ''}`
                      : 'All auto-generation is currently disabled'
                    }
                  </CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/65 px-3 py-2 shadow-sm sm:justify-end">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.18em] ${masterEnabled ? 'border-success/30 bg-success/15 text-success dark:text-success' : 'border-border/70 bg-muted/70 text-muted-foreground'}`}>
                  {masterEnabled ? 'ON' : 'OFF'}
                </span>
                <Switch 
                  checked={masterEnabled} 
                  onCheckedChange={toggleMaster}
                  disabled={masterLoading}
                  aria-label="Toggle master auto-generation"
                  className="data-[state=checked]:bg-success focus-visible:ring-success/40"
                />
              </div>
            </div>
          </CardHeader>
          {!masterEnabled && switches.some(s => s.is_enabled) && (
            <CardContent className="pt-0">
              <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-foreground shadow-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span className="leading-5 text-muted-foreground">You have enabled switches but the master switch is off. No reports will be auto-generated.</span>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Switches Section */}
        <div className="space-y-4">
          <div className="flex min-w-0 flex-col gap-3 rounded-3xl border border-border/60 bg-card/70 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:shadow-black/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Filter Switches</h2>
            </div>
            {canEdit && (
              <Button onClick={openCreateModal} size="sm" aria-label="Create automation switch" className="min-h-[44px] bg-primary text-primary-foreground shadow-[0_12px_28px_hsl(var(--primary)/0.18)] transition-all hover:bg-primary-hover focus-visible:ring-primary/45 sm:size-default sm:min-h-0">
                <Plus className="h-4 w-4 mr-2" />
                Create Switch
              </Button>
            )}
          </div>

          {loading ? (
            <Card className="overflow-hidden rounded-3xl border-border/70 bg-card/85 shadow-[0_14px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:shadow-black/20">
              <CardContent className="px-4 py-10 text-center text-muted-foreground" role="status" aria-live="polite">
                Loading switches...
              </CardContent>
            </Card>
          ) : switches.length === 0 ? (
            <Card className="overflow-hidden rounded-3xl border-dashed border-primary/25 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_38%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.84))] shadow-[0_18px_52px_rgba(15,23,42,0.08)] dark:border-primary/20 dark:shadow-black/25">
              <CardContent className="px-4 py-14 text-center sm:px-6">
                <div className="mx-auto flex max-w-md flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-border/70 bg-background/75 text-muted-foreground shadow-sm">
                    <Settings2 className="h-9 w-9 text-muted-foreground/60" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">No switches configured</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      Create your first switch to start auto-generating reports
                    </p>
                  </div>
                  {canEdit && (
                    <Button onClick={openCreateModal} aria-label="Create automation switch from empty state" className="mt-2 min-h-[44px] bg-primary text-primary-foreground shadow-[0_12px_28px_hsl(var(--primary)/0.18)] hover:bg-primary-hover">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Switch
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {switches.map((switchItem) => (
                <Card 
                  key={switchItem.id} 
                  className={switchItem.is_enabled ? 'group overflow-hidden rounded-3xl border-primary/30 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--primary)/0.07))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_18px_48px_rgba(15,23,42,0.10)] dark:shadow-black/20' : 'group overflow-hidden rounded-3xl border-border/70 bg-card/85 shadow-[0_14px_40px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_48px_rgba(15,23,42,0.09)] dark:border-white/10 dark:shadow-black/20'}
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                        <div className="shrink-0 pt-1">
                          <Switch
                            checked={switchItem.is_enabled}
                            onCheckedChange={() => toggleSwitch(switchItem)}
                            disabled={!masterEnabled || !canEdit}
                            aria-label={`Toggle switch ${switchItem.name}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground sm:text-base">{switchItem.name}</span>
                            <Badge variant="secondary" className="border border-border/50 bg-background/70 text-xs text-foreground shadow-sm">
                              {getCriteriaCount(switchItem.criteria)} criteria
                            </Badge>
                            {switchItem.is_enabled ? (
                              <Badge className="border-success/30 bg-success/15 text-success shadow-sm dark:text-success">
                                <Play className="h-3 w-3 mr-1" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-border/70 bg-muted/50 text-muted-foreground shadow-sm">
                                <Pause className="h-3 w-3 mr-1" />
                                Paused
                              </Badge>
                            )}
                          </div>
                          {switchItem.description && (
                            <p className="max-w-3xl break-words text-sm leading-5 text-muted-foreground">
                              {switchItem.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 self-end rounded-2xl border border-border/50 bg-background/55 p-1 shadow-sm sm:self-auto">
                        {canEdit && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => openEditModal(switchItem)}
                            aria-label={`Edit switch ${switchItem.name}`}
                            className="min-h-[44px] min-w-[44px] rounded-xl hover:bg-primary/10 hover:text-foreground focus-visible:ring-primary/45 sm:min-h-0 sm:min-w-0"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => deleteSwitch(switchItem)}
                            aria-label={`Delete switch ${switchItem.name}`}
                            className="min-h-[44px] min-w-[44px] rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/35 sm:min-h-0 sm:min-w-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DashboardThemeFrame>

      <SwitchConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        editingSwitch={editingSwitch}
        onSaved={handleSwitchSaved}
        existingSwitches={switches}
      />

      <GenerationLogModal
        open={logModalOpen}
        onOpenChange={setLogModalOpen}
      />
    </>
  );
};

export default Automation;

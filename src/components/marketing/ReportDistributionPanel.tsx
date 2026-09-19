import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Plus, Send, Trash2, Edit, Loader2, Clock, CheckCircle2, XCircle, Calendar, Users, RotateCw, Target } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { format } from 'date-fns';

interface PipelineStageTarget {
  pipeline_id: string;       // Internal UUID
  pipeline_name: string;
  stage_id?: string;         // Internal UUID — omit for "all stages"
  stage_name?: string;
}

interface Schedule {
  id: string;
  name: string;
  description?: string;
  pipeline_id: string;
  pipeline_name?: string;
  stage_id?: string;
  stage_name?: string;
  pipeline_stage_targets?: PipelineStageTarget[];
  frequency: string;
  mailbox_source: string;
  sender_mailbox_email?: string;
  email_subject_template: string;
  email_body_template: string;
  is_enabled: boolean;
  last_sent_at?: string;
  next_scheduled_at?: string;
  created_at: string;
  report_type?: string;
  audience_segment?: string;
  content_rotation_enabled?: boolean;
  rotation_sequence?: string[];
  current_rotation_index?: number;
}

interface DistributionLog {
  id: string;
  schedule_id?: string;
  recipient_email: string;
  recipient_name?: string;
  status: string;
  error_message?: string;
  sent_at?: string;
  created_at: string;
}

interface Pipeline {
  id: string;
  ghl_pipeline_id: string;
  name: string;
}

interface Stage {
  id: string;
  ghl_stage_id: string;
  name: string;
  pipeline_id: string;
}

interface Mailbox {
  id: string;
  username: string;
  personal_mailbox: string;
}

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  ad_hoc: 'Ad-hoc (Manual)',
};

const REPORT_TYPE_OPTIONS: Record<string, string> = {
  full: 'Full Report',
  market_pulse: 'Market Pulse',
  hotspot_deep_dive: 'Hotspot Deep Dive',
  strategy_insight: 'Strategy Insight',
  finance_update: 'Finance & Lending',
  deal_breakdown: 'Deal Breakdown',
  myth_busting: 'Myth Busting',
  development_spotlight: 'Development Spotlight',
};

const AUDIENCE_OPTIONS: Record<string, string> = {
  general: 'General',
  investor: 'Investor',
  owner_occupier: 'Owner-Occupier',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  sent: { label: 'Sent', color: 'bg-success/10 text-success border-success/30', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: XCircle },
  pending: { label: 'Pending', color: 'bg-brand-500/10 text-brand-600 border-brand-500/30', icon: Clock },
  skipped: { label: 'Skipped', color: 'bg-muted text-muted-foreground border-border', icon: Clock },
};

export function ReportDistributionPanel() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<DistributionLog[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTargets, setFormTargets] = useState<PipelineStageTarget[]>([]);
  const [formFrequency, setFormFrequency] = useState('monthly');
  const [formMailboxSource, setFormMailboxSource] = useState('admin');
  const [formSenderEmail, setFormSenderEmail] = useState('');
  const [formSubject, setFormSubject] = useState('Your Market Intelligence Report — {{report_period}}');
  const [formBody, setFormBody] = useState('Please find attached the latest Market Intelligence Report, providing a comprehensive analysis of the Australian property market including interest rate movements, housing market data, economic indicators, and strategic outlook.');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formReportType, setFormReportType] = useState('full');
  const [formAudience, setFormAudience] = useState('general');
  const [formRotationEnabled, setFormRotationEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedulesRes, historyRes, pipelinesRes, stagesRes, mailboxesRes] = await Promise.all([
        invokeSecureFunction('dispatch-marketing-reports', { operation: 'getSchedules' }),
        invokeSecureFunction('dispatch-marketing-reports', { operation: 'getHistory', data: { limit: 20 } }),
        invokeSecureFunction('manage-automation-settings', { operation: 'getPipelines' }),
        invokeSecureFunction('manage-automation-settings', { operation: 'getStages' }),
        invokeSecureFunction('dispatch-marketing-reports', { operation: 'getMailboxes' }),
      ]);

      if (schedulesRes.data?.schedules) setSchedules(schedulesRes.data.schedules);
      if (historyRes.data?.logs) setHistory(historyRes.data.logs);
      if (pipelinesRes.data?.pipelines) setPipelines(pipelinesRes.data.pipelines);
      if (stagesRes.data?.stages) setStages(stagesRes.data.stages);
      if (mailboxesRes.data?.mailboxes) setMailboxes(mailboxesRes.data.mailboxes);
    } catch (err) {
      console.error('Error loading distribution data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormTargets([]);
    setFormFrequency('monthly');
    setFormMailboxSource('admin');
    setFormSenderEmail('');
    setFormSubject('Your Market Intelligence Report — {{report_period}}');
    setFormBody('Please find attached the latest Market Intelligence Report, providing a comprehensive analysis of the Australian property market including interest rate movements, housing market data, economic indicators, and strategic outlook.');
    setFormEnabled(true);
    setFormReportType('full');
    setFormAudience('general');
    setFormRotationEnabled(false);
    setEditingSchedule(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setFormName(schedule.name);
    setFormDescription(schedule.description || '');
    
    // Migrate legacy single pipeline/stage to targets array
    if (schedule.pipeline_stage_targets && schedule.pipeline_stage_targets.length > 0) {
      setFormTargets(schedule.pipeline_stage_targets);
    } else if (schedule.pipeline_id) {
      // Legacy: convert single pipeline/stage to targets format
      const pipeline = pipelines.find(p => p.ghl_pipeline_id === schedule.pipeline_id);
      setFormTargets([{
        pipeline_id: pipeline?.id || schedule.pipeline_id,
        pipeline_name: schedule.pipeline_name || pipeline?.name || 'Unknown',
        stage_id: schedule.stage_id || undefined,
        stage_name: schedule.stage_name || undefined,
      }]);
    } else {
      setFormTargets([]);
    }
    
    setFormFrequency(schedule.frequency);
    setFormMailboxSource(schedule.mailbox_source);
    setFormSenderEmail(schedule.sender_mailbox_email || '');
    setFormSubject(schedule.email_subject_template);
    setFormBody(schedule.email_body_template);
    setFormEnabled(schedule.is_enabled);
    setFormReportType(schedule.report_type || 'full');
    setFormAudience(schedule.audience_segment || 'general');
    setFormRotationEnabled(schedule.content_rotation_enabled || false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName || formTargets.length === 0) {
      toast.error('Name and at least one pipeline target are required');
      return;
    }

    setSaving(true);
    try {
      // Use first target as the legacy pipeline_id for backward compat
      const firstTarget = formTargets[0];

      const payload: Record<string, any> = {
        name: formName,
        description: formDescription || null,
        pipeline_id: firstTarget.pipeline_id,
        pipeline_name: firstTarget.pipeline_name,
        stage_id: firstTarget.stage_id || null,
        stage_name: firstTarget.stage_name || null,
        pipeline_stage_targets: formTargets,
        frequency: formFrequency,
        mailbox_source: formMailboxSource,
        sender_mailbox_email: formMailboxSource === 'personal' ? formSenderEmail : null,
        email_subject_template: formSubject,
        email_body_template: formBody,
        is_enabled: formEnabled,
        report_type: formReportType,
        audience_segment: formAudience,
        content_rotation_enabled: formRotationEnabled,
      };

      if (editingSchedule) {
        await invokeSecureFunction('dispatch-marketing-reports', {
          operation: 'updateSchedule',
          scheduleId: editingSchedule.id,
          data: payload,
        });
        toast.success('Schedule updated');
      } else {
        await invokeSecureFunction('dispatch-marketing-reports', {
          operation: 'createSchedule',
          data: payload,
        });
        toast.success('Schedule created');
      }

      setDialogOpen(false);
      resetForm();
      loadData();
    } catch (err) {
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this distribution schedule?')) return;
    try {
      await invokeSecureFunction('dispatch-marketing-reports', {
        operation: 'deleteSchedule',
        scheduleId: id,
      });
      toast.success('Schedule deleted');
      loadData();
    } catch (err) {
      toast.error('Failed to delete schedule');
    }
  };

  const handleDispatch = async (scheduleId: string) => {
    setDispatching(scheduleId);
    const toastId = toast.loading('Dispatching Market Intelligence Report...', {
      description: 'Generating report and sending emails — this may take a few minutes.',
    });

    try {
      const { data, error } = await invokeSecureFunction('dispatch-marketing-reports', {
        operation: 'dispatch',
        scheduleId,
      });

      if (error) throw new Error(error.message);

      toast.success(`Distribution complete`, {
        id: toastId,
        description: `${data?.sent || 0} sent, ${data?.failed || 0} failed`,
      });
      loadData();
    } catch (err: any) {
      toast.error('Dispatch failed', {
        id: toastId,
        description: err.message,
      });
    } finally {
      setDispatching(null);
    }
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    try {
      await invokeSecureFunction('dispatch-marketing-reports', {
        operation: 'updateSchedule',
        scheduleId: schedule.id,
        data: { is_enabled: !schedule.is_enabled },
      });
      loadData();
    } catch (err) {
      toast.error('Failed to update schedule');
    }
  };

  // ─── Pipeline/Stage Multi-Select Helpers ─────────────────────────────

  const toggleStageTarget = (pipeline: Pipeline, stage?: Stage) => {
    setFormTargets(prev => {
      const targetKey = stage
        ? `${pipeline.id}:${stage.id}`
        : `${pipeline.id}:all`;

      const exists = prev.some(t =>
        t.pipeline_id === pipeline.id && (stage ? t.stage_id === stage.id : !t.stage_id)
      );

      if (exists) {
        return prev.filter(t =>
          !(t.pipeline_id === pipeline.id && (stage ? t.stage_id === stage.id : !t.stage_id))
        );
      } else {
        // If adding "all stages", remove any individual stage selections for this pipeline
        if (!stage) {
          return [
            ...prev.filter(t => t.pipeline_id !== pipeline.id),
            { pipeline_id: pipeline.id, pipeline_name: pipeline.name },
          ];
        }
        // If adding a specific stage, remove "all stages" for this pipeline
        return [
          ...prev.filter(t => !(t.pipeline_id === pipeline.id && !t.stage_id)),
          {
            pipeline_id: pipeline.id,
            pipeline_name: pipeline.name,
            stage_id: stage.id,
            stage_name: stage.name,
          },
        ];
      }
    });
  };

  const isTargetSelected = (pipelineId: string, stageId?: string) => {
    return formTargets.some(t =>
      t.pipeline_id === pipelineId && (stageId ? t.stage_id === stageId : !t.stage_id)
    );
  };

  const getTargetSummary = (targets: PipelineStageTarget[]) => {
    if (!targets || targets.length === 0) return 'No targets';
    
    const grouped = new Map<string, string[]>();
    for (const t of targets) {
      const key = t.pipeline_name || t.pipeline_id;
      if (!grouped.has(key)) grouped.set(key, []);
      if (t.stage_name) {
        grouped.get(key)!.push(t.stage_name);
      } else {
        grouped.set(key, ['All stages']);
      }
    }

    return Array.from(grouped.entries())
      .map(([pipeline, stagesList]) => `${pipeline} → ${stagesList.join(', ')}`)
      .join(' | ');
  };

  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </span>
            <span>Report Distribution</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                  <Mail className="h-5 w-5 text-primary" />
                </span>
                <span className="truncate">Report Distribution</span>
              </CardTitle>
              <CardDescription className="mt-1">
                Automated Market Intelligence Report delivery to GHL pipeline contacts
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)} className="gap-1.5 rounded-xl border-primary/20 text-xs hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/45" aria-label={showHistory ? 'Show report schedules' : 'Show report distribution history'}>
                <Clock className="h-3.5 w-3.5" />
                {showHistory ? 'Schedules' : 'History'}
              </Button>
              <Button size="sm" onClick={openCreateDialog} className="gap-1.5 rounded-xl text-xs shadow-sm focus-visible:ring-primary/45" aria-label="Create new report distribution schedule">
                <Plus className="h-3.5 w-3.5" />
                New Schedule
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showHistory ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Distribution History</h4>
              {history.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/70 bg-background/45 py-8 text-center text-sm text-muted-foreground">No distribution history yet</p>
              ) : (
                <ScrollArea className="max-h-[320px] rounded-2xl border border-border/70 bg-background/35">
                  <Table className="min-w-[520px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Recipient</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Sent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map(log => {
                        const statusConfig = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                        const StatusIcon = statusConfig.icon;
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="py-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium" title={log.recipient_name || 'Unknown'}>{log.recipient_name || 'Unknown'}</p>
                                <p className="truncate text-[11px] text-muted-foreground" title={log.recipient_email}>{log.recipient_email}</p>
                              </div>
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge variant="outline" className={`gap-1 rounded-full text-[10px] ${statusConfig.color}`}>
                                <StatusIcon className="h-3 w-3" />
                                {statusConfig.label}
                              </Badge>
                              {log.error_message && (
                                <p className="text-[10px] text-destructive mt-0.5 max-w-[200px] truncate" title={log.error_message}>
                                  {log.error_message}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-[11px] text-muted-foreground">
                              {log.sent_at ? format(new Date(log.sent_at), 'dd MMM yy HH:mm') : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 py-10 text-center">
                  <Mail className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No distribution schedules configured</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Create a schedule to automatically send reports to pipeline contacts</p>
                </div>
              ) : (
                schedules.map(schedule => {
                  const targets = schedule.pipeline_stage_targets || [];
                  return (
                    <div key={schedule.id} className="space-y-3 rounded-2xl border border-border/70 bg-background/45 p-4 shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/[0.03]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="truncate text-sm font-semibold" title={schedule.name}>{schedule.name}</span>
                            <Badge variant="outline" className={`rounded-full text-[10px] ${schedule.is_enabled ? 'border-success/30 bg-success/5 text-success' : 'border-border text-muted-foreground'}`}>
                              {schedule.is_enabled ? 'Active' : 'Paused'}
                            </Badge>
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {FREQUENCY_LABELS[schedule.frequency] || schedule.frequency}
                            </Badge>
                            <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/5 text-[10px] text-primary">
                              {schedule.content_rotation_enabled ? '🔄 Rotation' : (REPORT_TYPE_OPTIONS[schedule.report_type || 'full'] || 'Full')}
                            </Badge>
                            {schedule.audience_segment && schedule.audience_segment !== 'general' && (
                              <Badge variant="outline" className="rounded-full border-brand-500/30 bg-brand-500/5 text-[10px] text-brand-600">
                                {AUDIENCE_OPTIONS[schedule.audience_segment] || schedule.audience_segment}
                              </Badge>
                            )}
                          </div>
                          {schedule.description && (
                            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{schedule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Switch
                            checked={schedule.is_enabled}
                            onCheckedChange={() => handleToggleEnabled(schedule)}
                            className="scale-75"
                            aria-label={`${schedule.is_enabled ? 'Pause' : 'Activate'} ${schedule.name}`}
                          />
                        </div>
                      </div>

                      <div className="grid gap-2 text-[11px] text-muted-foreground md:grid-cols-3">
                        <span className="flex min-w-0 items-center gap-1 rounded-xl bg-muted/30 px-2.5 py-1.5" title={targets.length > 0 ? getTargetSummary(targets) : `${schedule.pipeline_name || 'Pipeline'}${schedule.stage_name ? ` → ${schedule.stage_name}` : ' (All stages)'}`}>
                          <Users className="h-3 w-3" />
                          <span className="truncate">{targets.length > 0
                            ? getTargetSummary(targets)
                            : `${schedule.pipeline_name || 'Pipeline'}${schedule.stage_name ? ` → ${schedule.stage_name}` : ' (All stages)'}`
                          }</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1 rounded-xl bg-muted/30 px-2.5 py-1.5">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">{schedule.mailbox_source === 'personal' ? schedule.sender_mailbox_email || 'Personal' : 'Admin'}</span>
                        </span>
                        {schedule.last_sent_at && (
                          <span className="flex items-center gap-1 rounded-xl bg-muted/30 px-2.5 py-1.5">
                            <Calendar className="h-3 w-3" />
                            Last: {format(new Date(schedule.last_sent_at), 'dd MMM yy')}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleDispatch(schedule.id)}
                          disabled={dispatching === schedule.id}
                        >
                          {dispatching === schedule.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Send Now
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => openEditDialog(schedule)}>
                          <Edit className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDelete(schedule.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Schedule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{editingSchedule ? 'Edit' : 'Create'} Distribution Schedule</DialogTitle>
            <DialogDescription>
              Configure automated delivery of Market Intelligence Reports to GHL pipeline contacts.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule Name *</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Weekly Investor Update" className="h-9" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Optional description" className="h-9" />
              </div>

              <Separator />

              {/* Multi-Pipeline/Stage Selector */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1">
                  <Users className="h-3 w-3" /> Pipeline & Stage Targets *
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Select one or more pipeline stages. Contacts in selected stages will receive the report.
                </p>

                {formTargets.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {formTargets.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-secondary-foreground transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        onClick={() => {
                          const pipeline = pipelines.find(p => p.id === t.pipeline_id);
                          const stage = t.stage_id ? stages.find(s => s.id === t.stage_id) : undefined;
                          if (pipeline) toggleStageTarget(pipeline, stage);
                        }}
                        aria-label={`Remove target ${t.pipeline_name} ${t.stage_name || 'All stages'}`}
                      >
                        <span className="truncate">{t.pipeline_name} → {t.stage_name || 'All stages'}</span>
                        <XCircle className="h-2.5 w-2.5" />
                      </button>
                    ))}
                  </div>
                )}

                <div className="border rounded-lg divide-y max-h-[200px] overflow-y-auto">
                  {pipelines.map(pipeline => {
                    const pipelineStages = stages.filter(s => s.pipeline_id === pipeline.id);
                    const allStagesSelected = isTargetSelected(pipeline.id);

                    return (
                      <div key={pipeline.id} className="p-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Checkbox
                            checked={allStagesSelected}
                            onCheckedChange={() => toggleStageTarget(pipeline)}
                            id={`pipeline-all-${pipeline.id}`}
                          />
                          <label htmlFor={`pipeline-all-${pipeline.id}`} className="text-xs font-medium cursor-pointer flex-1">
                            {pipeline.name}
                            <span className="text-muted-foreground font-normal ml-1">(All stages)</span>
                          </label>
                        </div>
                        {!allStagesSelected && pipelineStages.length > 0 && (
                          <div className="ml-5 grid grid-cols-2 gap-1">
                            {pipelineStages.map(stage => (
                              <div key={stage.id} className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={isTargetSelected(pipeline.id, stage.id)}
                                  onCheckedChange={() => toggleStageTarget(pipeline, stage)}
                                  id={`stage-${stage.id}`}
                                  className="h-3.5 w-3.5"
                                />
                                <label htmlFor={`stage-${stage.id}`} className="text-[11px] cursor-pointer truncate">
                                  {stage.name}
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {pipelines.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No pipelines synced from GHL</p>
                  )}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={formFrequency} onValueChange={setFormFrequency}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Send From</Label>
                  <Select value={formMailboxSource} onValueChange={setFormMailboxSource}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">🏢 Admin Mailbox</SelectItem>
                      <SelectItem value="personal">👤 Personal Mailbox</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formMailboxSource === 'personal' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Sender Mailbox</Label>
                  <Select value={formSenderEmail} onValueChange={setFormSenderEmail}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select mailbox" /></SelectTrigger>
                    <SelectContent>
                      {mailboxes.map(m => (
                        <SelectItem key={m.id} value={m.personal_mailbox}>{m.personal_mailbox} ({m.username})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              {/* Report Type & Audience */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Target className="h-3 w-3" /> Report Type</Label>
                  <Select value={formReportType} onValueChange={setFormReportType} disabled={formRotationEnabled}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(REPORT_TYPE_OPTIONS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Users className="h-3 w-3" /> Audience</Label>
                  <Select value={formAudience} onValueChange={setFormAudience}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(AUDIENCE_OPTIONS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg border border-border/50 bg-muted/30">
                <RotateCw className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Switch checked={formRotationEnabled} onCheckedChange={setFormRotationEnabled} className="scale-75" />
                    <Label className="text-xs font-medium">Content Rotation</Label>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Automatically cycle through all 7 report types each send, creating a varied rhythm of communication
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label className="text-xs">Email Subject</Label>
                <Input value={formSubject} onChange={e => setFormSubject(e.target.value)} className="h-9" />
                <p className="text-[10px] text-muted-foreground">Use {'{{report_period}}'} for dynamic date</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Email Body</Label>
                <Textarea value={formBody} onChange={e => setFormBody(e.target.value)} rows={4} className="text-sm" />
                <p className="text-[10px] text-muted-foreground">Personalised greeting and signature are added automatically</p>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
                <Label className="text-xs">Enable automated sending</Label>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="text-xs">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5 text-xs">
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {editingSchedule ? 'Update' : 'Create'} Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

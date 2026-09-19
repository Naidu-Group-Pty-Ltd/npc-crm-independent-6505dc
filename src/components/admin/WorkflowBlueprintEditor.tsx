/**
 * Workflow Blueprint Editor
 *
 * Manual capture + flow-diagram visualization of a single GHL workflow's
 * internals (triggers, actions, webhook URLs, pipeline stage changes, etc.).
 *
 * GHL's public API does NOT expose workflow internals, so this is a manual
 * blueprint authored once per workflow from the GHL builder, then used as
 * the source-of-truth reference when rebuilding in the new account.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Trash2, ArrowDown, GitBranch, Webhook, Mail, MessageSquare, Clock,
  Tag, UserCog, Workflow as WorkflowIcon, Bell, Calendar, ListChecks,
  Save, Copy, Loader2, Zap, Code2,
} from 'lucide-react';
import { toast } from 'sonner';

// ---------------- types ----------------

export type TriggerType =
  | 'pipeline_stage_changed' | 'opportunity_created' | 'contact_created'
  | 'tag_added' | 'tag_removed' | 'form_submitted' | 'appointment_booked'
  | 'appointment_status' | 'inbound_webhook' | 'birthday' | 'custom_date'
  | 'note_added' | 'task_added' | 'call_status' | 'email_event'
  | 'sms_received' | 'manual' | 'other';

export type StepType =
  | 'send_email' | 'send_sms' | 'send_internal_notification' | 'wait'
  | 'if_else' | 'add_tag' | 'remove_tag' | 'update_contact_field'
  | 'pipeline_stage_change' | 'create_opportunity' | 'webhook'
  | 'create_task' | 'add_to_workflow' | 'remove_from_workflow'
  | 'assign_user' | 'math_op' | 'custom_code' | 'end' | 'other';

export interface BlueprintTrigger {
  id: string;
  type: TriggerType;
  label: string;
  pipeline?: string;
  stage?: string;
  form_name?: string;
  tag?: string;
  webhook_url?: string;
  filters?: string;
  raw_config?: string;
  notes?: string;
}

export interface BlueprintStep {
  id: string;
  type: StepType;
  label: string;
  // generic
  notes?: string;
  raw_config?: string;
  // type-specific
  email_template?: string;
  email_subject?: string;
  sms_message?: string;
  wait_duration?: string;
  webhook_url?: string;
  webhook_method?: string;
  webhook_payload?: string;
  pipeline?: string;
  stage?: string;
  tag?: string;
  field_name?: string;
  field_value?: string;
  assignee?: string;
  child_workflow?: string;
  // branching (if_else)
  condition?: string;
  yes_branch?: BlueprintStep[];
  no_branch?: BlueprintStep[];
}

export interface Blueprint {
  triggers: BlueprintTrigger[];
  steps: BlueprintStep[];
  general_notes?: string;
}

const EMPTY: Blueprint = { triggers: [], steps: [], general_notes: '' };

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: 'pipeline_stage_changed', label: 'Pipeline / Stage changed' },
  { value: 'opportunity_created', label: 'Opportunity created' },
  { value: 'contact_created', label: 'Contact created' },
  { value: 'tag_added', label: 'Tag added' },
  { value: 'tag_removed', label: 'Tag removed' },
  { value: 'form_submitted', label: 'Form submitted' },
  { value: 'appointment_booked', label: 'Appointment booked' },
  { value: 'appointment_status', label: 'Appointment status changed' },
  { value: 'inbound_webhook', label: 'Inbound webhook' },
  { value: 'birthday', label: 'Birthday reminder' },
  { value: 'custom_date', label: 'Custom date reminder' },
  { value: 'note_added', label: 'Note added' },
  { value: 'task_added', label: 'Task added' },
  { value: 'call_status', label: 'Call status changed' },
  { value: 'email_event', label: 'Email event (open/click)' },
  { value: 'sms_received', label: 'SMS received' },
  { value: 'manual', label: 'Manual trigger' },
  { value: 'other', label: 'Other / custom' },
];

const STEP_TYPES: { value: StepType; label: string; icon: any }[] = [
  { value: 'send_email', label: 'Send email', icon: Mail },
  { value: 'send_sms', label: 'Send SMS', icon: MessageSquare },
  { value: 'send_internal_notification', label: 'Internal notification', icon: Bell },
  { value: 'wait', label: 'Wait', icon: Clock },
  { value: 'if_else', label: 'If / Else condition', icon: GitBranch },
  { value: 'add_tag', label: 'Add tag', icon: Tag },
  { value: 'remove_tag', label: 'Remove tag', icon: Tag },
  { value: 'update_contact_field', label: 'Update contact field', icon: UserCog },
  { value: 'pipeline_stage_change', label: 'Move pipeline stage', icon: ListChecks },
  { value: 'create_opportunity', label: 'Create opportunity', icon: Plus },
  { value: 'webhook', label: 'Outbound webhook', icon: Webhook },
  { value: 'create_task', label: 'Create task', icon: ListChecks },
  { value: 'add_to_workflow', label: 'Add to workflow', icon: WorkflowIcon },
  { value: 'remove_from_workflow', label: 'Remove from workflow', icon: WorkflowIcon },
  { value: 'assign_user', label: 'Assign user', icon: UserCog },
  { value: 'math_op', label: 'Math operation', icon: Code2 },
  { value: 'custom_code', label: 'Custom code', icon: Code2 },
  { value: 'end', label: 'End workflow', icon: Zap },
  { value: 'other', label: 'Other / custom', icon: Zap },
];

const stepIcon = (t: StepType) => STEP_TYPES.find(s => s.value === t)?.icon || Zap;
const stepLabel = (t: StepType) => STEP_TYPES.find(s => s.value === t)?.label || t;

const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------- main component ----------------

interface Props {
  open: boolean;
  onClose: () => void;
  workflow: {
    id: string;
    workflow_id: string;
    name: string | null;
    rebuild_blueprint?: Blueprint | null;
  } | null;
  onSaved?: (blueprint: Blueprint) => void;
}

export function WorkflowBlueprintEditor({ open, onClose, workflow, onSaved }: Props) {
  const [bp, setBp] = useState<Blueprint>(EMPTY);
  const [tab, setTab] = useState('flow');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workflow) {
      const existing = workflow.rebuild_blueprint;
      setBp(existing && (existing.triggers || existing.steps)
        ? { triggers: existing.triggers || [], steps: existing.steps || [], general_notes: existing.general_notes || '' }
        : { ...EMPTY });
      setTab(existing && (existing.triggers?.length || existing.steps?.length) ? 'flow' : 'edit');
    }
  }, [workflow]);

  async function save() {
    if (!workflow) return;
    setSaving(true);
    try {
      const res = await invokeSecureFunction('ghl-workflow-visualizer', {
        action: 'save_blueprint', id: workflow.id, blueprint: bp,
      });
      if (!res.data?.success) throw new Error(res.data?.error || 'save failed');
      toast.success('Blueprint saved');
      onSaved?.(bp);
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function copyMarkdown() {
    const md = blueprintToMarkdown(workflow?.name || 'Workflow', bp);
    navigator.clipboard.writeText(md);
    toast.success('Markdown copied to clipboard');
  }

  // -------- mutations --------
  const addTrigger = () => setBp(p => ({ ...p, triggers: [...p.triggers, { id: newId(), type: 'pipeline_stage_changed', label: 'New trigger' }] }));
  const updTrigger = (id: string, patch: Partial<BlueprintTrigger>) =>
    setBp(p => ({ ...p, triggers: p.triggers.map(t => t.id === id ? { ...t, ...patch } : t) }));
  const delTrigger = (id: string) => setBp(p => ({ ...p, triggers: p.triggers.filter(t => t.id !== id) }));

  const addStep = (path: number[] = [], branch?: 'yes' | 'no') => {
    const node: BlueprintStep = { id: newId(), type: 'send_email', label: 'New step' };
    setBp(p => ({ ...p, steps: insertStep(p.steps, path, branch, node) }));
  };
  const updStep = (path: number[], branch: 'yes' | 'no' | undefined, idx: number, patch: Partial<BlueprintStep>) =>
    setBp(p => ({ ...p, steps: mutateStep(p.steps, path, branch, idx, s => ({ ...s, ...patch })) }));
  const delStep = (path: number[], branch: 'yes' | 'no' | undefined, idx: number) =>
    setBp(p => ({ ...p, steps: removeStep(p.steps, path, branch, idx) }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-2 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2">
            <WorkflowIcon className="h-4 w-4 text-primary" />
            Blueprint — {workflow?.name || 'Workflow'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Capture every trigger, step, and webhook URL exactly as it appears in the legacy GHL builder. Use as the rebuild reference.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-2">
            <TabsList>
              <TabsTrigger value="flow">Flow diagram</TabsTrigger>
              <TabsTrigger value="edit">Edit blueprint</TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>
          </div>

          {/* FLOW DIAGRAM */}
          <TabsContent value="flow" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                <FlowDiagram bp={bp} />
              </div>
            </ScrollArea>
          </TabsContent>

          {/* EDIT */}
          <TabsContent value="edit" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-6">
                {/* Triggers */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><Zap className="h-4 w-4 text-warning" /> Triggers</h3>
                    <Button size="sm" variant="outline" onClick={addTrigger}><Plus className="h-3.5 w-3.5 mr-1" /> Add trigger</Button>
                  </div>
                  {bp.triggers.length === 0 && <p className="text-xs text-muted-foreground italic">No triggers yet. Add the conditions that start this workflow.</p>}
                  <div className="space-y-2">
                    {bp.triggers.map(t => (
                      <TriggerCard key={t.id} t={t} onChange={(p) => updTrigger(t.id, p)} onDelete={() => delTrigger(t.id)} />
                    ))}
                  </div>
                </section>

                {/* Steps */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-primary" /> Steps</h3>
                    <Button size="sm" variant="outline" onClick={() => addStep()}><Plus className="h-3.5 w-3.5 mr-1" /> Add step</Button>
                  </div>
                  {bp.steps.length === 0 && <p className="text-xs text-muted-foreground italic">No steps yet.</p>}
                  <StepList
                    steps={bp.steps}
                    path={[]}
                    onUpdate={(idx, patch) => updStep([], undefined, idx, patch)}
                    onDelete={(idx) => delStep([], undefined, idx)}
                    onAddChild={(idx, branch) => addStep([idx], branch)}
                    onUpdateChild={(parentIdx, branch, idx, patch) => updStep([parentIdx], branch, idx, patch)}
                    onDeleteChild={(parentIdx, branch, idx) => delStep([parentIdx], branch, idx)}
                  />
                </section>

                {/* General notes */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">General notes</h3>
                  <Textarea
                    value={bp.general_notes || ''}
                    onChange={(e) => setBp(p => ({ ...p, general_notes: e.target.value }))}
                    placeholder="Anything else to remember when rebuilding…"
                    className="text-xs min-h-[80px]"
                  />
                </section>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* EXPORT */}
          <TabsContent value="export" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyMarkdown}><Copy className="h-3.5 w-3.5 mr-1" /> Copy as Markdown</Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(bp, null, 2));
                    toast.success('JSON copied');
                  }}><Copy className="h-3.5 w-3.5 mr-1" /> Copy JSON</Button>
                </div>
                <pre className="text-[11px] bg-muted/20 border border-border/60 rounded p-3 whitespace-pre-wrap break-all">
                  {blueprintToMarkdown(workflow?.name || 'Workflow', bp)}
                </pre>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter className="p-3 border-t border-border/60">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save blueprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- helpers ----------------

function insertStep(steps: BlueprintStep[], path: number[], branch: 'yes' | 'no' | undefined, node: BlueprintStep): BlueprintStep[] {
  if (path.length === 0) return [...steps, node];
  const [head, ...rest] = path;
  return steps.map((s, i) => {
    if (i !== head) return s;
    if (branch === 'yes') return { ...s, yes_branch: insertStep(s.yes_branch || [], rest, undefined, node) };
    if (branch === 'no') return { ...s, no_branch: insertStep(s.no_branch || [], rest, undefined, node) };
    return s;
  });
}
function mutateStep(steps: BlueprintStep[], path: number[], branch: 'yes' | 'no' | undefined, idx: number, fn: (s: BlueprintStep) => BlueprintStep): BlueprintStep[] {
  if (path.length === 0) return steps.map((s, i) => i === idx ? fn(s) : s);
  const [head, ...rest] = path;
  return steps.map((s, i) => {
    if (i !== head) return s;
    if (branch === 'yes') return { ...s, yes_branch: mutateStep(s.yes_branch || [], rest, undefined, idx, fn) };
    if (branch === 'no') return { ...s, no_branch: mutateStep(s.no_branch || [], rest, undefined, idx, fn) };
    return mutateStep([s], rest, branch, idx, fn)[0];
  });
}
function removeStep(steps: BlueprintStep[], path: number[], branch: 'yes' | 'no' | undefined, idx: number): BlueprintStep[] {
  if (path.length === 0) return steps.filter((_, i) => i !== idx);
  const [head, ...rest] = path;
  return steps.map((s, i) => {
    if (i !== head) return s;
    if (branch === 'yes') return { ...s, yes_branch: removeStep(s.yes_branch || [], rest, undefined, idx) };
    if (branch === 'no') return { ...s, no_branch: removeStep(s.no_branch || [], rest, undefined, idx) };
    return s;
  });
}

// ---------------- subcomponents ----------------

function TriggerCard({ t, onChange, onDelete }: { t: BlueprintTrigger; onChange: (p: Partial<BlueprintTrigger>) => void; onDelete: () => void }) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
      <div className="flex gap-2 items-center">
        <Select value={t.type} onValueChange={(v) => onChange({ type: v as TriggerType })}>
          <SelectTrigger className="w-[260px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TRIGGER_TYPES.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={t.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label" className="h-8 text-xs" />
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(t.type === 'pipeline_stage_changed' || t.type === 'opportunity_created') && (
          <>
            <Input value={t.pipeline || ''} onChange={(e) => onChange({ pipeline: e.target.value })} placeholder="Pipeline name" className="h-8 text-xs" />
            <Input value={t.stage || ''} onChange={(e) => onChange({ stage: e.target.value })} placeholder="Stage name (or any)" className="h-8 text-xs" />
          </>
        )}
        {(t.type === 'tag_added' || t.type === 'tag_removed') && (
          <Input value={t.tag || ''} onChange={(e) => onChange({ tag: e.target.value })} placeholder="Tag name" className="h-8 text-xs col-span-2" />
        )}
        {t.type === 'form_submitted' && (
          <Input value={t.form_name || ''} onChange={(e) => onChange({ form_name: e.target.value })} placeholder="Form name" className="h-8 text-xs col-span-2" />
        )}
        {t.type === 'inbound_webhook' && (
          <Input value={t.webhook_url || ''} onChange={(e) => onChange({ webhook_url: e.target.value })} placeholder="Webhook URL (paste full URL)" className="h-8 text-xs col-span-2 font-mono" />
        )}
      </div>
      <Input value={t.filters || ''} onChange={(e) => onChange({ filters: e.target.value })} placeholder="Filters (e.g. tag = X, has email…)" className="h-8 text-xs" />
      <Textarea value={t.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes" className="text-xs min-h-[40px]" />
    </div>
  );
}

function StepList({
  steps, path, onUpdate, onDelete, onAddChild, onUpdateChild, onDeleteChild,
}: {
  steps: BlueprintStep[]; path: number[];
  onUpdate: (idx: number, patch: Partial<BlueprintStep>) => void;
  onDelete: (idx: number) => void;
  onAddChild: (idx: number, branch: 'yes' | 'no') => void;
  onUpdateChild: (parentIdx: number, branch: 'yes' | 'no', idx: number, patch: Partial<BlueprintStep>) => void;
  onDeleteChild: (parentIdx: number, branch: 'yes' | 'no', idx: number) => void;
}) {
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <StepCard
          key={s.id} step={s}
          onChange={(p) => onUpdate(i, p)}
          onDelete={() => onDelete(i)}
          renderBranches={s.type === 'if_else' ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <BranchColumn
                label="YES branch" tone="success"
                steps={s.yes_branch || []}
                onAdd={() => onAddChild(i, 'yes')}
                onUpdate={(idx, p) => onUpdateChild(i, 'yes', idx, p)}
                onDelete={(idx) => onDeleteChild(i, 'yes', idx)}
              />
              <BranchColumn
                label="NO branch" tone="destructive"
                steps={s.no_branch || []}
                onAdd={() => onAddChild(i, 'no')}
                onUpdate={(idx, p) => onUpdateChild(i, 'no', idx, p)}
                onDelete={(idx) => onDeleteChild(i, 'no', idx)}
              />
            </div>
          ) : null}
        />
      ))}
    </div>
  );
}

function BranchColumn({ label, tone, steps, onAdd, onUpdate, onDelete }: {
  label: string; tone: 'success' | 'destructive'; steps: BlueprintStep[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<BlueprintStep>) => void;
  onDelete: (idx: number) => void;
}) {
  const border = tone === 'success' ? 'border-success/40' : 'border-destructive/40';
  const text = tone === 'success' ? 'text-success' : 'text-destructive';
  return (
    <div className={`rounded border ${border} p-2`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-semibold uppercase ${text}`}>{label}</span>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onAdd}><Plus className="h-3 w-3 mr-0.5" />Step</Button>
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <StepCard key={s.id} step={s} onChange={(p) => onUpdate(i, p)} onDelete={() => onDelete(i)} compact />
        ))}
        {steps.length === 0 && <p className="text-[10px] italic text-muted-foreground">empty</p>}
      </div>
    </div>
  );
}

function StepCard({
  step, onChange, onDelete, renderBranches, compact,
}: {
  step: BlueprintStep; onChange: (p: Partial<BlueprintStep>) => void; onDelete: () => void;
  renderBranches?: React.ReactNode; compact?: boolean;
}) {
  const Icon = stepIcon(step.type);
  return (
    <div className={`rounded border border-border/60 bg-muted/10 ${compact ? 'p-2' : 'p-3'} space-y-2`}>
      <div className="flex gap-2 items-center">
        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
        <Select value={step.type} onValueChange={(v) => onChange({ type: v as StepType })}>
          <SelectTrigger className="w-[200px] h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{STEP_TYPES.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={step.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Label" className="h-7 text-xs" />
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
      </div>

      {/* type-specific fields */}
      <div className="grid grid-cols-2 gap-2">
        {step.type === 'send_email' && (<>
          <Input value={step.email_subject || ''} onChange={(e) => onChange({ email_subject: e.target.value })} placeholder="Email subject" className="h-7 text-xs" />
          <Input value={step.email_template || ''} onChange={(e) => onChange({ email_template: e.target.value })} placeholder="Template name" className="h-7 text-xs" />
        </>)}
        {step.type === 'send_sms' && (
          <Textarea value={step.sms_message || ''} onChange={(e) => onChange({ sms_message: e.target.value })} placeholder="SMS message body" className="text-xs col-span-2 min-h-[50px]" />
        )}
        {step.type === 'wait' && (
          <Input value={step.wait_duration || ''} onChange={(e) => onChange({ wait_duration: e.target.value })} placeholder="Duration (e.g. 2 days, 3 hours)" className="h-7 text-xs col-span-2" />
        )}
        {step.type === 'webhook' && (<>
          <Select value={step.webhook_method || 'POST'} onValueChange={(v) => onChange({ webhook_method: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{['GET','POST','PUT','PATCH','DELETE'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={step.webhook_url || ''} onChange={(e) => onChange({ webhook_url: e.target.value })} placeholder="https://… full URL" className="h-7 text-xs font-mono" />
          <Textarea value={step.webhook_payload || ''} onChange={(e) => onChange({ webhook_payload: e.target.value })} placeholder="Payload JSON / body" className="text-xs col-span-2 min-h-[60px] font-mono" />
        </>)}
        {step.type === 'pipeline_stage_change' && (<>
          <Input value={step.pipeline || ''} onChange={(e) => onChange({ pipeline: e.target.value })} placeholder="Pipeline" className="h-7 text-xs" />
          <Input value={step.stage || ''} onChange={(e) => onChange({ stage: e.target.value })} placeholder="Target stage" className="h-7 text-xs" />
        </>)}
        {(step.type === 'add_tag' || step.type === 'remove_tag') && (
          <Input value={step.tag || ''} onChange={(e) => onChange({ tag: e.target.value })} placeholder="Tag name" className="h-7 text-xs col-span-2" />
        )}
        {step.type === 'update_contact_field' && (<>
          <Input value={step.field_name || ''} onChange={(e) => onChange({ field_name: e.target.value })} placeholder="Field name" className="h-7 text-xs" />
          <Input value={step.field_value || ''} onChange={(e) => onChange({ field_value: e.target.value })} placeholder="Value" className="h-7 text-xs" />
        </>)}
        {(step.type === 'add_to_workflow' || step.type === 'remove_from_workflow') && (
          <Input value={step.child_workflow || ''} onChange={(e) => onChange({ child_workflow: e.target.value })} placeholder="Workflow name" className="h-7 text-xs col-span-2" />
        )}
        {step.type === 'assign_user' && (
          <Input value={step.assignee || ''} onChange={(e) => onChange({ assignee: e.target.value })} placeholder="Assignee (user / round-robin)" className="h-7 text-xs col-span-2" />
        )}
        {step.type === 'if_else' && (
          <Input value={step.condition || ''} onChange={(e) => onChange({ condition: e.target.value })} placeholder="Condition (e.g. tag has X)" className="h-7 text-xs col-span-2" />
        )}
      </div>

      <Textarea value={step.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes / extra config" className="text-xs min-h-[36px]" />
      {renderBranches}
    </div>
  );
}

// ---------------- Flow diagram (read-only viz) ----------------

function FlowDiagram({ bp }: { bp: Blueprint }) {
  if (bp.triggers.length === 0 && bp.steps.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No blueprint yet — switch to "Edit blueprint" to capture triggers & steps.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Triggers */}
      <div className="w-full max-w-2xl space-y-2">
        {bp.triggers.map(t => <TriggerNode key={t.id} t={t} />)}
      </div>
      {bp.triggers.length > 0 && bp.steps.length > 0 && <ArrowDown className="h-5 w-5 text-muted-foreground" />}
      {/* Steps */}
      <FlowSteps steps={bp.steps} />
      {bp.general_notes && (
        <div className="w-full max-w-2xl mt-4 rounded border border-border/60 bg-muted/10 p-2 text-xs">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">General notes</div>
          <div className="whitespace-pre-wrap">{bp.general_notes}</div>
        </div>
      )}
    </div>
  );
}

function TriggerNode({ t }: { t: BlueprintTrigger }) {
  return (
    <div className="rounded-lg border-2 border-warning/50 bg-warning/10 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="h-4 w-4 text-warning" />
        <Badge variant="warning" className="text-[10px]">TRIGGER</Badge>
        <span className="text-[10px] text-muted-foreground">{TRIGGER_TYPES.find(x => x.value === t.type)?.label}</span>
      </div>
      <div className="text-sm font-medium">{t.label}</div>
      <TriggerDetails t={t} />
    </div>
  );
}

function TriggerDetails({ t }: { t: BlueprintTrigger }) {
  const rows: [string, string][] = [];
  if (t.pipeline) rows.push(['Pipeline', t.pipeline]);
  if (t.stage) rows.push(['Stage', t.stage]);
  if (t.tag) rows.push(['Tag', t.tag]);
  if (t.form_name) rows.push(['Form', t.form_name]);
  if (t.webhook_url) rows.push(['Webhook URL', t.webhook_url]);
  if (t.filters) rows.push(['Filters', t.filters]);
  if (rows.length === 0 && !t.notes) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-muted-foreground min-w-[80px]">{k}:</span>
          <span className={k === 'Webhook URL' ? 'font-mono break-all' : ''}>{v}</span>
        </div>
      ))}
      {t.notes && <div className="italic text-muted-foreground whitespace-pre-wrap">{t.notes}</div>}
    </div>
  );
}

function FlowSteps({ steps }: { steps: BlueprintStep[] }) {
  if (!steps?.length) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <StepNode s={s} />
          {i < steps.length - 1 && <ArrowDown className="h-4 w-4 text-muted-foreground" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function StepNode({ s }: { s: BlueprintStep }) {
  const Icon = stepIcon(s.type);
  if (s.type === 'if_else') {
    return (
      <div className="w-full max-w-3xl">
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3 mx-auto max-w-md">
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="h-4 w-4 text-primary" />
            <Badge variant="info" className="text-[10px]">IF / ELSE</Badge>
          </div>
          <div className="text-sm font-medium">{s.label}</div>
          {s.condition && <div className="text-[11px] mt-1"><span className="text-muted-foreground">Condition:</span> {s.condition}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="rounded border border-success/40 bg-success/5 p-2">
            <div className="text-[10px] font-semibold uppercase text-success mb-1">Yes</div>
            <FlowSteps steps={s.yes_branch || []} />
            {(!s.yes_branch || s.yes_branch.length === 0) && <p className="text-[10px] italic text-muted-foreground">empty</p>}
          </div>
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
            <div className="text-[10px] font-semibold uppercase text-destructive mb-1">No</div>
            <FlowSteps steps={s.no_branch || []} />
            {(!s.no_branch || s.no_branch.length === 0) && <p className="text-[10px] italic text-muted-foreground">empty</p>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 w-full max-w-2xl">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <Badge variant="outline" className="text-[10px]">{stepLabel(s.type)}</Badge>
        <span className="text-sm font-medium flex-1 truncate">{s.label}</span>
      </div>
      <StepDetails s={s} />
    </div>
  );
}

function StepDetails({ s }: { s: BlueprintStep }) {
  const rows: [string, string, boolean?][] = [];
  if (s.email_subject) rows.push(['Subject', s.email_subject]);
  if (s.email_template) rows.push(['Template', s.email_template]);
  if (s.sms_message) rows.push(['Message', s.sms_message]);
  if (s.wait_duration) rows.push(['Wait', s.wait_duration]);
  if (s.webhook_method || s.webhook_url) rows.push(['Webhook', `${s.webhook_method || 'POST'} ${s.webhook_url || ''}`, true]);
  if (s.webhook_payload) rows.push(['Payload', s.webhook_payload, true]);
  if (s.pipeline) rows.push(['Pipeline', s.pipeline]);
  if (s.stage) rows.push(['→ Stage', s.stage]);
  if (s.tag) rows.push(['Tag', s.tag]);
  if (s.field_name) rows.push(['Field', `${s.field_name} = ${s.field_value || ''}`]);
  if (s.assignee) rows.push(['Assignee', s.assignee]);
  if (s.child_workflow) rows.push(['Workflow', s.child_workflow]);
  if (rows.length === 0 && !s.notes) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] pl-6">
      {rows.map(([k, v, mono], i) => (
        <div key={i} className="flex gap-2">
          <span className="text-muted-foreground min-w-[70px]">{k}:</span>
          <span className={mono ? 'font-mono break-all' : 'whitespace-pre-wrap'}>{v}</span>
        </div>
      ))}
      {s.notes && <div className="italic text-muted-foreground whitespace-pre-wrap">{s.notes}</div>}
    </div>
  );
}

// ---------------- markdown export ----------------

function blueprintToMarkdown(name: string, bp: Blueprint): string {
  const lines: string[] = [`# ${name} — Rebuild Blueprint`, ''];
  lines.push('## Triggers');
  if (!bp.triggers.length) lines.push('_none_');
  bp.triggers.forEach((t, i) => {
    lines.push(`${i + 1}. **${t.label}** _(${t.type})_`);
    if (t.pipeline) lines.push(`   - Pipeline: ${t.pipeline}`);
    if (t.stage) lines.push(`   - Stage: ${t.stage}`);
    if (t.tag) lines.push(`   - Tag: ${t.tag}`);
    if (t.form_name) lines.push(`   - Form: ${t.form_name}`);
    if (t.webhook_url) lines.push(`   - Webhook URL: \`${t.webhook_url}\``);
    if (t.filters) lines.push(`   - Filters: ${t.filters}`);
    if (t.notes) lines.push(`   - Notes: ${t.notes}`);
  });
  lines.push('', '## Steps');
  if (!bp.steps.length) lines.push('_none_');
  const renderSteps = (steps: BlueprintStep[], indent = 0) => {
    steps.forEach((s, i) => {
      const pad = '  '.repeat(indent);
      lines.push(`${pad}${i + 1}. **${s.label}** _(${stepLabel(s.type)})_`);
      const add = (k: string, v?: string, mono = false) => v && lines.push(`${pad}   - ${k}: ${mono ? '`' + v + '`' : v}`);
      add('Subject', s.email_subject);
      add('Template', s.email_template);
      add('Message', s.sms_message);
      add('Wait', s.wait_duration);
      if (s.webhook_url || s.webhook_method) add('Webhook', `${s.webhook_method || 'POST'} ${s.webhook_url || ''}`, true);
      add('Payload', s.webhook_payload, true);
      add('Pipeline', s.pipeline);
      add('Stage', s.stage);
      add('Tag', s.tag);
      if (s.field_name) add('Field', `${s.field_name} = ${s.field_value || ''}`);
      add('Assignee', s.assignee);
      add('Workflow', s.child_workflow);
      add('Condition', s.condition);
      if (s.notes) add('Notes', s.notes);
      if (s.type === 'if_else') {
        lines.push(`${pad}   - **YES branch:**`);
        renderSteps(s.yes_branch || [], indent + 2);
        lines.push(`${pad}   - **NO branch:**`);
        renderSteps(s.no_branch || [], indent + 2);
      }
    });
  };
  renderSteps(bp.steps);
  if (bp.general_notes) {
    lines.push('', '## General notes', bp.general_notes);
  }
  return lines.join('\n');
}

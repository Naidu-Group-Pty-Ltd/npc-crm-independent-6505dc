import { useEffect, useMemo, useState } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Check, ClipboardList, LayoutTemplate, Plus, PlayCircle, Trash2, Clock, CheckCircle2, Loader2, Upload, X } from 'lucide-react';
import { useChecklistTemplates, useChecklistInstances, useChecklistMutations, type ChecklistTemplate, type ChecklistInstance } from '@/hooks/useChecklists';
import { TemplateBuilder } from '@/components/checklists/TemplateBuilder';
import { ChecklistInstanceView } from '@/components/checklists/ChecklistInstanceView';
import { TemplateImportDialog } from '@/components/checklists/TemplateImportDialog';
import { IconPicker } from '@/components/checklists/IconPicker';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import type { ParsedTemplate } from '@/utils/checklistTemplateParser';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';


const ChecklistLoadingState = ({ message }: { message: string }) => (
  <Card className="overflow-hidden border-brand/20 bg-gradient-to-b from-brand/10 via-card to-card" role="status" aria-live="polite">
    <CardContent className="py-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand-700 dark:text-brand">
        <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-foreground dark:text-foreground">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">Preparing the workflow workspace</p>
    </CardContent>
  </Card>
);

export default function Checklists() {
  const { canEdit, canDelete } = useModulePermissions('checklists');
  const [activeTab, setActiveTab] = useState('active');
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<ChecklistInstance | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newIcon, setNewIcon] = useState('📋');
  

  const { data: templates = [], isLoading: templatesLoading } = useChecklistTemplates();
  const { data: activeInstances = [], isLoading: instancesLoading } = useChecklistInstances('in_progress');
  const { data: completedInstances = [] } = useChecklistInstances('completed');
  const mutations = useChecklistMutations();
  const [selectedChecklistIds, setSelectedChecklistIds] = useState<Set<string>>(new Set());

  const visibleInstances = useMemo(() => {
    if (activeTab === 'active') return activeInstances;
    if (activeTab === 'completed') return completedInstances;
    return [];
  }, [activeTab, activeInstances, completedInstances]);

  const selectedVisibleIds = useMemo(
    () => visibleInstances.map(instance => instance.id).filter(id => selectedChecklistIds.has(id)),
    [visibleInstances, selectedChecklistIds],
  );
  const hasSelectableVisibleItems = (canEdit || canDelete) && visibleInstances.length > 0 && activeTab !== 'templates';
  const allVisibleSelected = hasSelectableVisibleItems && selectedVisibleIds.length === visibleInstances.length;
  const someVisibleSelected = selectedVisibleIds.length > 0 && !allVisibleSelected;

  useEffect(() => {
    setSelectedChecklistIds(new Set());
  }, [activeTab]);

  useEffect(() => {
    setSelectedChecklistIds(prev => {
      const visibleIds = new Set(visibleInstances.map(instance => instance.id));
      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleInstances]);

  const toggleChecklistSelection = (id: string) => {
    setSelectedChecklistIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedChecklistIds(allVisibleSelected ? new Set() : new Set(visibleInstances.map(instance => instance.id)));
  };

  const completeChecklists = async (ids: string[], message: string) => {
    if (!canEdit) return;
    try {
      await mutations.bulkUpdateInstances.mutateAsync({ ids, data: { status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
      setSelectedChecklistIds(new Set());
      toast.success(message);
    } catch (error) {
      console.error('Complete checklist error:', error);
      toast.error('Could not complete checklist. Please try again.');
    }
  };

  const deleteSelectedChecklists = async () => {
    if (!canDelete) return;
    const count = selectedVisibleIds.length;
    try {
      await mutations.bulkDeleteInstances.mutateAsync(selectedVisibleIds);
      setSelectedChecklistIds(new Set());
      toast.success(`${count} ${count === 1 ? 'checklist' : 'checklists'} deleted.`);
    } catch (error) {
      console.error('Delete checklist error:', error);
      toast.error('Could not delete checklist. Please try again.');
    }
  };

  // If viewing a template builder
  if (selectedTemplate) {
    return (
      <DashboardThemeFrame as="main" variant="page" className="flex max-h-[calc(100vh-2rem)] min-h-0 max-w-7xl flex-col space-y-6 overflow-hidden rounded-3xl border border-primary/15 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))] p-4 text-foreground shadow-2xl shadow-sm dark:shadow-black/30 md:p-6">
        <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82)_52%,hsl(var(--primary)/0.12))] p-5 shadow-inner shadow-sm dark:shadow-black/10">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-300/30 bg-gradient-to-br from-brand-300/20 via-card dark:via-background to-background dark:to-black text-brand-200">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold tracking-tight text-foreground dark:text-foreground">Checklists</h1>
              <p className="text-muted-foreground dark:text-muted-foreground">Manage checklist templates and track operational workflows</p>
            </div>
          </div>
        </DashboardThemeFrame>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 overscroll-contain [scrollbar-color:hsl(var(--primary)/0.35)_hsl(var(--muted)/0.72)]">
          <TemplateBuilder template={selectedTemplate} onBack={() => setSelectedTemplate(null)} />
        </div>
      </DashboardThemeFrame>
    );
  }

  // If viewing an instance
  if (selectedInstance) {
    return (
      <DashboardThemeFrame as="main" variant="page" className="flex max-h-[calc(100vh-2rem)] min-h-0 max-w-7xl flex-col space-y-6 overflow-hidden rounded-3xl border border-primary/15 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))] p-4 text-foreground shadow-2xl shadow-sm dark:shadow-black/30 md:p-6">
        <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82)_52%,hsl(var(--primary)/0.12))] p-5 shadow-inner shadow-sm dark:shadow-black/10">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-300/30 bg-gradient-to-br from-brand-300/20 via-card dark:via-background to-background dark:to-black text-brand-200">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold tracking-tight text-foreground dark:text-foreground">Checklists</h1>
              <p className="text-muted-foreground dark:text-muted-foreground">Manage checklist templates and track operational workflows</p>
            </div>
          </div>
        </DashboardThemeFrame>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 overscroll-contain [scrollbar-color:hsl(var(--primary)/0.35)_hsl(var(--muted)/0.72)]">
          <ChecklistInstanceView instance={selectedInstance} onBack={() => setSelectedInstance(null)} canEdit={canEdit} canDelete={canDelete} />
        </div>
      </DashboardThemeFrame>
    );
  }

  const handleCreateTemplate = () => {
    if (!newName.trim()) return;
    mutations.createTemplate.mutate(
      { name: newName.trim(), description: newDesc.trim() || null, icon: newIcon },
      { onSuccess: () => { setCreateDialogOpen(false); setNewName(''); setNewDesc(''); setNewIcon('📋'); } }
    );
  };

  const handleImportTemplate = async (parsed: ParsedTemplate) => {
    // Create template
    const result = await mutations.createTemplate.mutateAsync({
      name: parsed.name,
      description: parsed.description || null,
      icon: parsed.icon || '📋',
    });

    const templateId = result?.record?.id;
    if (!templateId) throw new Error('Failed to create template');

    // Create sections and items
    for (let si = 0; si < parsed.sections.length; si++) {
      const sec = parsed.sections[si];
      const sectionResult = await mutations.createSection.mutateAsync({
        template_id: templateId,
        title: sec.title,
        icon: sec.icon || '▶️',
        display_order: si,
      });
      const sectionId = sectionResult?.record?.id;
      if (sectionId && sec.items) {
        for (let ii = 0; ii < sec.items.length; ii++) {
          const item = sec.items[ii];
          await mutations.createItem.mutateAsync({
            section_id: sectionId,
            label: item.label,
            is_pre_checked: item.is_pre_checked || false,
            display_order: ii,
          });
        }
      }
    }
  };

  const renderInstanceCard = (instance: ChecklistInstance) => {
    const statusClass = instance.status === 'completed'
      ? 'border-success/35 bg-success/10 text-success'
      : 'border-brand-300/40 bg-brand-400/10 text-brand-200';
    const progressClass = instance.status === 'completed'
      ? '[&>div]:from-success [&>div]:via-success [&>div]:to-success'
      : '[&>div]:from-brand-500 [&>div]:via-brand-300 [&>div]:to-brand-200';
    const progressGlowClass = instance.status === 'completed'
      ? '[&>div]:shadow-[0_0_18px_rgba(16,185,129,0.18)]'
      : '[&>div]:shadow-[0_0_18px_rgba(245,158,11,0.18)]';
    const progressPercentClass = instance.status === 'completed'
      ? 'border-success/20 bg-success/10 text-success'
      : 'border-brand-300/20 bg-brand-300/10 text-brand-200';
    const cardInteractionClass = instance.status === 'completed'
      ? 'border-success/15 hover:border-success/60 hover:shadow-[0_24px_58px_rgba(16,185,129,0.13)] focus-visible:border-success/70 focus-visible:ring-success/45'
      : 'border-brand-500/15 hover:border-brand-300/70 hover:shadow-[0_24px_58px_rgba(245,158,11,0.16)] focus-visible:border-brand-300/75 focus-visible:ring-brand-300/45';
    const cardAccentClass = instance.status === 'completed'
      ? 'via-success/60'
      : 'via-brand-300/60';
    const cardGlowClass = instance.status === 'completed'
      ? 'bg-success/10'
      : 'bg-brand-400/10';
    const isSelected = selectedChecklistIds.has(instance.id);
    const formattedDate = new Date(instance.created_at).toLocaleDateString('en-AU');
    const actionLabel = `${instance.name} checklist dated ${formattedDate}`;

    return (
      <Card
        key={instance.id}
        className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-card shadow-sm outline-none transition-all duration-300 hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${isSelected ? 'border-primary bg-gradient-to-br from-primary/10 via-card to-card ring-1 ring-primary/30' : cardInteractionClass}`}
        onClick={() => setSelectedInstance(instance)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedInstance(instance);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open checklist ${instance.name}`}
      >
        <div className={`pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 ${cardAccentClass}`} />
        <div className={`pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full blur-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 ${cardGlowClass}`} />
        <CardContent className="relative p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
                {(canEdit || canDelete) && <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleChecklistSelection(instance.id)}
                  aria-label={`Select ${actionLabel}`}
                  className="mt-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                />}
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-300/20 bg-background/35 dark:bg-black/35 text-xl shadow-inner shadow-brand-950/20">{instance.icon}</span>
              </div>
              <div className="min-w-0">
                <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug text-foreground dark:text-foreground transition-colors group-hover:text-brand-50">{instance.name}</h3>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">
                  <Clock className="h-3 w-3 text-brand-300/75" />
                  {formattedDate}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <Badge variant="outline" className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm ${statusClass}`}>
                {instance.status === 'completed' && <CheckCircle2 className="mr-1 h-3 w-3" />}
                {instance.status}
              </Badge>
              {canEdit && instance.status === 'in_progress' && (
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full border border-success/20 bg-success/5 text-success hover:bg-success/10 focus-visible:ring-2 focus-visible:ring-success/45" aria-label={`Mark ${actionLabel} as completed`} disabled={mutations.bulkUpdateInstances.isPending} onClick={() => completeChecklists([instance.id], 'Checklist marked as completed.')}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border dark:border-white/5 bg-background/35 dark:bg-black/35 p-3.5 shadow-inner shadow-sm dark:shadow-black/35">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Progress</span>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${progressPercentClass}`}>{instance.progress_percent}%</span>
            </div>
            <Progress value={instance.progress_percent} className={`h-2.5 bg-muted/90 dark:bg-background/90 shadow-inner shadow-sm dark:shadow-black/40 [&>div]:bg-gradient-to-r [&>div]:transition-all [&>div]:duration-500 ${progressClass} ${progressGlowClass}`} />
            {instance.progress_percent === 0 && (
              <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Ready to start</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderSelectionToolbar = () => {
    if (!hasSelectableVisibleItems) return null;
    const selectedCount = selectedVisibleIds.length;
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-brand-300/15 bg-[linear-gradient(135deg,rgba(14,116,144,0.18),rgba(0,0,0,0.62)_42%,rgba(0,0,0,0.78))] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.24)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-primary/45">
            <Checkbox
              checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
              onCheckedChange={handleSelectAllVisible}
              aria-label="Select all visible checklist cards"
              className="border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            />
            <span>{allVisibleSelected ? 'Clear selection' : 'Select all'}</span>
          </label>
          <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-bold text-foreground">
            {selectedCount} {selectedCount === 1 ? 'selected' : 'selected'}
          </span>
        </div>
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && activeTab === 'active' && (
              <Button size="sm" className="gap-1 bg-success text-success-foreground hover:bg-success/90" disabled={mutations.bulkUpdateInstances.isPending} onClick={() => completeChecklists(selectedVisibleIds, `${selectedCount} ${selectedCount === 1 ? 'checklist' : 'checklists'} marked as completed.`)}>
                <Check className="h-3.5 w-3.5" /> Complete selected
              </Button>
            )}
            {canDelete && <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1 border-destructive/35 bg-destructive/5 text-destructive hover:bg-destructive/10" disabled={mutations.bulkDeleteInstances.isPending}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-3xl border-destructive/20 bg-[linear-gradient(180deg,rgba(24,24,27,0.98),rgba(3,3,3,0.98))] text-foreground shadow-2xl shadow-black/40">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete selected checklists?</AlertDialogTitle>
                  <AlertDialogDescription className="text-muted-foreground">
                    This will remove {selectedCount} checklist {selectedCount === 1 ? 'record' : 'records'}. This action cannot be undone. Checklist templates are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                  <AlertDialogCancel className="border-border bg-background text-foreground hover:bg-white/5">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteSelectedChecklists}>Delete selected</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>}
            <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground hover:bg-white/5 hover:text-foreground" onClick={() => setSelectedChecklistIds(new Set())}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <DashboardThemeFrame as="main" variant="page" className="flex max-h-[calc(100vh-2rem)] min-h-0 max-w-7xl flex-col space-y-6 overflow-hidden rounded-3xl border border-primary/15 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))] p-4 text-foreground shadow-2xl shadow-sm dark:shadow-black/30 md:p-6">
      <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82)_52%,hsl(var(--primary)/0.12))] p-5 shadow-inner shadow-sm dark:shadow-black/10">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-brand-300/30 bg-gradient-to-br from-brand-300/20 via-card dark:via-background to-background dark:to-black text-brand-200 shadow-[0_18px_42px_rgba(245,158,11,0.16)]">
              <ClipboardList className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold tracking-tight text-foreground dark:text-foreground md:text-4xl">Checklists</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground dark:text-muted-foreground md:text-base">Manage checklist templates and track operational workflows</p>
            </div>
          </div>
        </div>
      </DashboardThemeFrame>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 space-y-5">
        <DashboardThemeFrame variant="toolbar" className="overflow-x-auto overscroll-x-contain rounded-3xl border-primary/15 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--card)/0.92)_32%,hsl(var(--background)/0.96))] p-2 shadow-[0_18px_45px_rgba(0,0,0,0.28)] [scrollbar-color:hsl(var(--primary)/0.35)_hsl(var(--muted)/0.72)]">
          <TabsList className="inline-flex h-auto w-auto min-w-full gap-1 rounded-2xl border border-border dark:border-white/5 bg-background/70 dark:bg-black/70 p-1.5 md:grid md:w-full md:grid-cols-3">
            <TabsTrigger value="active" className="group flex min-h-12 min-w-[8rem] items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-muted-foreground dark:text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/5 hover:text-brand-100 hover:shadow-[0_10px_26px_rgba(245,158,11,0.12)] focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-500 data-[state=active]:to-brand-400 data-[state=active]:text-black data-[state=active]:shadow-[0_12px_30px_rgba(245,158,11,0.26)] md:text-sm">
              <ClipboardList className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=active]:scale-110 md:h-4 md:w-4" />
              <span>Active</span>
              <span className="rounded-full border border-current/20 bg-background/20 dark:bg-black/20 px-2 py-0.5 text-[10px] font-bold tabular-nums group-data-[state=active]:bg-black/10 md:text-xs">{activeInstances.length}</span>
            </TabsTrigger>
            <TabsTrigger value="completed" className="group flex min-h-12 min-w-[8rem] items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-muted-foreground dark:text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/5 hover:text-brand-100 hover:shadow-[0_10px_26px_rgba(245,158,11,0.12)] focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-500 data-[state=active]:to-brand-400 data-[state=active]:text-black data-[state=active]:shadow-[0_12px_30px_rgba(245,158,11,0.26)] md:text-sm">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=active]:scale-110 md:h-4 md:w-4" />
              <span>Completed</span>
              <span className="rounded-full border border-current/20 bg-background/20 dark:bg-black/20 px-2 py-0.5 text-[10px] font-bold tabular-nums group-data-[state=active]:bg-black/10 md:text-xs">{completedInstances.length}</span>
            </TabsTrigger>
            <TabsTrigger value="templates" className="group flex min-h-12 min-w-[8rem] items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-muted-foreground dark:text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/5 hover:text-brand-100 hover:shadow-[0_10px_26px_rgba(245,158,11,0.12)] focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-500 data-[state=active]:to-brand-400 data-[state=active]:text-black data-[state=active]:shadow-[0_12px_30px_rgba(245,158,11,0.26)] md:text-sm">
              <LayoutTemplate className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=active]:scale-110 md:h-4 md:w-4" />
              <span>Templates</span>
              <span className="rounded-full border border-current/20 bg-background/20 dark:bg-black/20 px-2 py-0.5 text-[10px] font-bold tabular-nums group-data-[state=active]:bg-black/10 md:text-xs">{templates.length}</span>
            </TabsTrigger>
          </TabsList>
        </DashboardThemeFrame>

        {/* Active Checklists */}
        <TabsContent value="active" className="space-y-4 rounded-2xl border border-border dark:border-white/5 bg-background/55 dark:bg-background/55 p-4 shadow-xl shadow-sm dark:shadow-black/20 max-h-[calc(100vh-17rem)] overflow-y-auto overscroll-contain pr-2 [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)]">
          {renderSelectionToolbar()}
          {instancesLoading ? (
            <ChecklistLoadingState message="Loading..." />
          ) : activeInstances.length === 0 ? (
            <Card className="overflow-hidden rounded-2xl border-dashed border-brand-500/25 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.14),transparent_34%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(3,3,3,0.96))] shadow-inner shadow-brand-950/20">
              <CardContent className="relative py-14 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-200 shadow-[0_18px_45px_rgba(245,158,11,0.16)]">
                  <ClipboardList className="h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground dark:text-foreground">No active checklists</h3>
                <p className="mb-5 text-sm text-muted-foreground dark:text-muted-foreground">Generate one from a template to get started</p>
                <Button variant="secondary" className="border border-brand-300/20 bg-brand-400/10 text-brand-100 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-400/20 hover:text-brand-50 hover:shadow-[0_12px_28px_rgba(245,158,11,0.14)] focus-visible:ring-2 focus-visible:ring-brand-300/60 motion-reduce:transition-none" onClick={() => setActiveTab('templates')}>
                  <LayoutTemplate className="h-4 w-4 mr-2" /> View Templates
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {activeInstances.map(renderInstanceCard)}
            </div>
          )}
        </TabsContent>

        {/* Completed */}
        <TabsContent value="completed" className="space-y-4 rounded-2xl border border-success/10 bg-[linear-gradient(180deg,rgba(6,78,59,0.12),rgba(9,9,11,0.72))] p-4 shadow-xl shadow-sm dark:shadow-black/20 max-h-[calc(100vh-17rem)] overflow-y-auto overscroll-contain pr-2 [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)]">
          {renderSelectionToolbar()}
          {completedInstances.length === 0 ? (
            <Card className="overflow-hidden rounded-2xl border-dashed border-success/25 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_34%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(3,7,18,0.96))] shadow-inner shadow-success/20">
              <CardContent className="relative py-14 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-success/25 bg-success/10 text-success shadow-[0_18px_45px_rgba(16,185,129,0.16)]">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground dark:text-foreground">No completed checklists yet</h3>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">Completed checklists will appear here</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {completedInstances.map(renderInstanceCard)}
            </div>
          )}
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="space-y-5 rounded-2xl border border-brand-500/10 bg-[linear-gradient(180deg,rgba(245,158,11,0.08),rgba(9,9,11,0.72))] p-4 shadow-xl shadow-sm dark:shadow-black/20 max-h-[calc(100vh-17rem)] overflow-y-auto overscroll-contain pr-2 [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)]">
          <div className="flex flex-col gap-4 rounded-2xl border border-brand-500/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.1),rgba(0,0,0,0.42)_42%,rgba(0,0,0,0.72))] p-4 shadow-inner shadow-brand-950/10 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground dark:text-foreground">Checklist Templates</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Reusable blueprints for generating checklists</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" className="gap-1 border-brand-300/25 bg-background/35 dark:bg-black/35 text-brand-100 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/55 hover:bg-brand-400/10 hover:text-brand-50 hover:shadow-[0_12px_28px_rgba(245,158,11,0.14)] focus-visible:ring-2 focus-visible:ring-brand-300/60 motion-reduce:transition-none" onClick={() => setUploadDialogOpen(true)}>
                  <Upload className="h-3 w-3" /> Import
                </Button>
              )}
              <TemplateImportDialog
                open={uploadDialogOpen}
                onOpenChange={setUploadDialogOpen}
                onImport={handleImportTemplate}
              />

              {canEdit && (
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1 bg-gradient-to-r from-brand-500 to-brand-400 font-semibold text-black shadow-[0_12px_28px_rgba(245,158,11,0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:from-brand-400 hover:to-brand-300 hover:shadow-[0_16px_34px_rgba(245,158,11,0.3)] focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none">
                      <Plus className="h-3 w-3" /> New Template
                    </Button>
                  </DialogTrigger>
                <DialogContent className="max-h-[min(85vh,720px)] w-[calc(100vw-2rem)] overflow-y-auto rounded-3xl overscroll-contain [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.72)] border-brand-500/15 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.14),transparent_34%),linear-gradient(180deg,#09090b,#030303)] text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/40">
                  <DialogHeader className="rounded-2xl border border-brand-500/10 bg-background/35 dark:bg-black/35 p-4 shadow-inner shadow-brand-950/10">
                    <DialogTitle className="text-2xl font-bold tracking-tight text-foreground dark:text-foreground">Create New Template</DialogTitle>
                    <DialogDescription className="text-muted-foreground dark:text-muted-foreground">Build a reusable checklist template from scratch</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 rounded-2xl border border-border dark:border-white/5 bg-background/70 dark:bg-background/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div className="w-20">
                        <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Icon</Label>
                        <div className="mt-1">
                          <IconPicker value={newIcon} onChange={setNewIcon} ariaLabel="Choose a template icon" triggerClassName="w-full border-brand-500/15 bg-background/35 dark:bg-black/35" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Name</Label>
                        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Daily Operations" aria-label="Template name" className="mt-1 border-brand-500/15 bg-background/35 dark:bg-black/35 text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black" />
                        <p className="mt-1.5 text-[11px] text-muted-foreground dark:text-muted-foreground">Give this blueprint a clear operational name.</p>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Description (optional)</Label>
                      <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What is this checklist for?" rows={2} aria-label="Template description" className="mt-1 border-brand-500/15 bg-background/35 dark:bg-black/35 text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black" />
                      <p className="mt-1.5 text-[11px] text-muted-foreground dark:text-muted-foreground">Use this to clarify when the template should be generated or followed.</p>
                    </div>
                  </div>
                  <DialogFooter className="flex-col gap-2 sm:flex-row">
                    <Button variant="ghost" className="w-full text-muted-foreground dark:text-foreground transition-all duration-200 sm:w-auto hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                    <Button className="w-full bg-gradient-to-r from-brand-500 to-brand-400 font-semibold text-black shadow-[0_12px_28px_rgba(245,158,11,0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:from-brand-400 hover:to-brand-300 hover:shadow-[0_16px_34px_rgba(245,158,11,0.3)] focus-visible:ring-2 focus-visible:ring-brand-300/70 motion-reduce:transition-none sm:w-auto" onClick={handleCreateTemplate} disabled={!newName.trim()}>Create Template</Button>
                  </DialogFooter>
                </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          {templatesLoading ? (
            <ChecklistLoadingState message="Loading templates..." />
          ) : templates.length === 0 ? (
            <Card className="overflow-hidden rounded-2xl border-dashed border-brand-500/25 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_34%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(3,3,3,0.96))] shadow-inner shadow-brand-950/20">
              <CardContent className="relative py-14 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-200 shadow-[0_18px_45px_rgba(245,158,11,0.14)]">
                  <LayoutTemplate className="h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground dark:text-foreground">No templates yet</h3>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">Create your first checklist template or import one</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {templates.map(template => (
                <Card
                  key={template.id}
                  className="group relative cursor-pointer overflow-hidden rounded-2xl border border-brand-500/15 bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(9,9,11,0.98)_46%,rgba(0,0,0,0.98))] shadow-lg shadow-sm dark:shadow-black/30 transition-all duration-300 hover:-translate-y-1 hover:border-brand-300/70 hover:shadow-[0_24px_58px_rgba(245,158,11,0.16)] focus-visible:-translate-y-1 focus-visible:border-brand-300/75 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none"
                  onClick={() => setSelectedTemplate(template)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedTemplate(template);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open template ${template.name}`}
                >
                  <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" />
                  <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-brand-400/10 blur-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <CardContent className="relative p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3.5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-300/20 bg-background/35 dark:bg-black/35 text-2xl shadow-inner shadow-brand-950/20">{template.icon}</span>
                        <div className="min-w-0">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug text-foreground dark:text-foreground transition-colors group-hover:text-brand-50">{template.name}</h3>
                            <Badge variant="outline" className="rounded-full border-brand-300/25 bg-brand-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-200">
                              Template
                            </Badge>
                          </div>
                          {template.description && (
                            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground dark:text-muted-foreground">{template.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border dark:border-white/5 bg-background/30 dark:bg-black/30 p-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {template.cron_enabled && (
                          <Badge variant="secondary" className="gap-1 rounded-full border border-brand-300/20 bg-brand-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-200">
                            <Clock className="h-2.5 w-2.5" />
                            Scheduled
                          </Badge>
                        )}
                        {template.cron_enabled && template.cron_description && (
                          <Badge variant="outline" className="rounded-full border-border/45 bg-card/70 dark:bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground dark:text-foreground">
                            {template.cron_description}
                          </Badge>
                        )}
                      </div>
                      <div className="flex w-full shrink-0 items-center justify-end gap-1 rounded-full border border-brand-500/10 bg-background/40 dark:bg-black/40 p-1 opacity-85 shadow-inner shadow-sm dark:shadow-black/30 transition-opacity group-hover:opacity-100 sm:w-auto" onClick={e => e.stopPropagation()}>
                        <Button
                          size="icon" variant="ghost" className="h-9 w-9 rounded-full text-brand-100 transition-all hover:bg-brand-400/10 hover:text-brand-50 focus-visible:ring-2 focus-visible:ring-brand-300/55"
                          onClick={() => mutations.generateFromTemplate.mutate(template)}
                          title="Generate checklist"
                          aria-label={`Generate checklist from ${template.name}`}
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label={`Delete template ${template.name}`} className="h-9 w-9 rounded-full text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/45">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-3xl border-destructive/20 bg-[linear-gradient(180deg,rgba(24,24,27,0.98),rgba(3,3,3,0.98))] text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/40">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-foreground dark:text-foreground">Delete Template</AlertDialogTitle>
                              <AlertDialogDescription className="text-muted-foreground dark:text-muted-foreground">Delete "{template.name}"? Existing generated checklists won't be affected.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                              <AlertDialogCancel className="border-border dark:border-white/10 bg-background/40 dark:bg-black/40 text-foreground dark:text-foreground hover:bg-white/5">Cancel</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => mutations.deleteTemplate.mutate(template.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}

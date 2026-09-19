import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Clock, Pencil, Check, X, PlayCircle } from 'lucide-react';
import { useChecklistTemplates, useChecklistTemplateSections, useChecklistTemplateItems, useChecklistMutations, type ChecklistTemplate, type ChecklistSection } from '@/hooks/useChecklists';
import { IconPicker } from '@/components/checklists/IconPicker';

interface TemplateBuilderProps {
  template: ChecklistTemplate;
  onBack: () => void;
}

const CRON_PRESETS = [
  { label: 'Every Weekday at 6 AM', value: '0 6 * * 1-5', desc: 'Mon–Fri at 6:00 AM' },
  { label: 'Every Day at 8 AM', value: '0 8 * * *', desc: 'Daily at 8:00 AM' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1', desc: 'Weekly on Monday at 9:00 AM' },
  { label: 'First of Month at 9 AM', value: '0 9 1 * *', desc: '1st of each month at 9:00 AM' },
  { label: 'Every 4 Hours', value: '0 */4 * * *', desc: 'Every 4 hours' },
];

export function TemplateBuilder({ template: initialTemplate, onBack }: TemplateBuilderProps) {
  // Use live query data so cron toggle reflects immediately
  const { data: templates = [] } = useChecklistTemplates();
  const template = templates.find(t => t.id === initialTemplate.id) || initialTemplate;

  const { data: sections = [], isLoading: sectionsLoading } = useChecklistTemplateSections(template.id);
  const sectionIds = sections.map(s => s.id);
  const { data: allItems = [] } = useChecklistTemplateItems(sectionIds);
  const mutations = useChecklistMutations();

  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionIcon, setNewSectionIcon] = useState('▶️');
  const [newItemLabels, setNewItemLabels] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState('');
  const [editSectionIcon, setEditSectionIcon] = useState('📋');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [cronExpression, setCronExpression] = useState(template.cron_expression || '');
  const [cronDesc, setCronDesc] = useState(template.cron_description || '');

  // Backfill local cron state once server data arrives, without clobbering
  // in-progress user input (only fills empty fields). Runs as an effect —
  // setState during render is illegal and tears with concurrent rendering.
  const serverCronExpr = template.cron_expression || '';
  const serverCronDesc = template.cron_description || '';
  useEffect(() => {
    if (serverCronExpr) setCronExpression((cur) => cur || serverCronExpr);
  }, [serverCronExpr]);
  useEffect(() => {
    if (serverCronDesc) setCronDesc((cur) => cur || serverCronDesc);
  }, [serverCronDesc]);

  const toggleSection = (id: string) => {
    const next = new Set(openSections);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setOpenSections(next);
  };

  const handleAddSection = () => {
    if (!newSectionTitle.trim()) return;
    mutations.createSection.mutate({
      template_id: template.id,
      title: newSectionTitle.trim(),
      icon: newSectionIcon,
      display_order: sections.length,
    });
    setNewSectionTitle('');
  };

  const handleAddItem = (sectionId: string) => {
    const label = newItemLabels[sectionId]?.trim();
    if (!label) return;
    const sectionItems = allItems.filter(i => i.section_id === sectionId);
    mutations.createItem.mutate({
      section_id: sectionId,
      label,
      is_pre_checked: false,
      display_order: sectionItems.length,
    });
    setNewItemLabels(prev => ({ ...prev, [sectionId]: '' }));
  };

  const handleCronToggle = (enabled: boolean) => {
    mutations.updateTemplate.mutate({
      id: template.id,
      cron_enabled: enabled,
      ...(cronExpression ? { cron_expression: cronExpression } : {}),
      ...(cronDesc ? { cron_description: cronDesc } : {}),
    });
  };

  const handleApplyCron = () => {
    mutations.updateTemplate.mutate({
      id: template.id,
      cron_expression: cronExpression,
      cron_description: cronDesc,
    });
  };

  const handleGenerate = () => {
    mutations.generateFromTemplate.mutate(template);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <IconPicker
                value={template.icon || '📋'}
                onChange={(icon) => mutations.updateTemplate.mutate({ id: template.id, icon })}
                ariaLabel={`Change the icon for ${template.name}`}
                triggerClassName="h-10 w-12 text-2xl"
              />
              {template.name}
            </h2>
            {template.description && (
              <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
            )}
          </div>
        </div>
        <Button onClick={handleGenerate} disabled={mutations.generateFromTemplate.isPending} className="gap-2">
          <PlayCircle className="h-4 w-4" />
          Generate Checklist
        </Button>
      </div>

      {/* Cron Scheduling Card */}
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Auto-Generation Schedule</CardTitle>
            </div>
            <Switch
              checked={template.cron_enabled}
              onCheckedChange={handleCronToggle}
            />
          </div>
          <CardDescription>Automatically generate a fresh blank checklist on a schedule</CardDescription>
        </CardHeader>
        {template.cron_enabled && (
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map(p => (
                <Badge
                  key={p.value}
                  variant={cronExpression === p.value ? 'default' : 'outline'}
                  className="cursor-pointer hover:bg-primary/10 transition-colors"
                  onClick={() => { setCronExpression(p.value); setCronDesc(p.desc); }}
                >
                  {p.label}
                </Badge>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Cron Expression</Label>
                <Input
                  value={cronExpression}
                  onChange={e => setCronExpression(e.target.value)}
                  placeholder="0 6 * * 1-5"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                  value={cronDesc}
                  onChange={e => setCronDesc(e.target.value)}
                  placeholder="Every weekday at 6:00 AM"
                />
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={handleApplyCron}>Save Schedule</Button>
            {template.last_generated_at && (
              <p className="text-xs text-muted-foreground">
                Last generated: {new Date(template.last_generated_at).toLocaleString('en-AU')}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Sections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sections & Items</CardTitle>
          <CardDescription>Build your checklist structure. Add sections and items within each.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sectionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading sections...</p>
          ) : sections.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No sections yet. Add your first section below.</p>
          ) : (
            sections.map(section => {
              const sectionItems = allItems.filter(i => i.section_id === section.id);
              const isOpen = openSections.has(section.id);
              const isEditing = editingSection === section.id;

              return (
                <Collapsible key={section.id} open={isOpen} onOpenChange={() => toggleSection(section.id)}>
                  <div className="border rounded-lg overflow-hidden">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          {!isEditing && <span className="text-base">{section.icon}</span>}
                          {isEditing ? (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <IconPicker
                                value={editSectionIcon}
                                onChange={setEditSectionIcon}
                                ariaLabel={`Choose an icon for ${section.title}`}
                                triggerClassName="h-7 w-9 text-base"
                              />
                              <Input
                                value={editSectionTitle}
                                onChange={e => setEditSectionTitle(e.target.value)}
                                className="h-7 w-48 text-sm"
                                autoFocus
                              />
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                                mutations.updateSection.mutate({ id: section.id, title: editSectionTitle, icon: editSectionIcon });
                                setEditingSection(null);
                              }}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingSection(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-medium text-sm">{section.title}</span>
                          )}
                          <Badge variant="secondary" className="text-xs">{sectionItems.length} items</Badge>
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingSection(section.id); setEditSectionTitle(section.title); setEditSectionIcon(section.icon || '📋'); }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Section</AlertDialogTitle>
                                <AlertDialogDescription>This will delete "{section.title}" and all its items. This cannot be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => mutations.deleteSection.mutate(section.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="p-4 space-y-2 bg-background">
                        {sectionItems.map(item => (
                          <div key={item.id} className="flex items-center justify-between gap-2 group py-1.5 px-2 rounded hover:bg-muted/30 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center text-xs ${item.is_pre_checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                                {item.is_pre_checked && <Check className="h-3 w-3" />}
                              </div>
                              <span className="text-sm">{item.label}</span>
                              {item.is_pre_checked && <Badge variant="outline" className="text-[10px] h-5">Pre-checked</Badge>}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon" variant="ghost" className="h-6 w-6"
                                onClick={() => mutations.updateItem.mutate({ id: item.id, is_pre_checked: !item.is_pre_checked })}
                                title={item.is_pre_checked ? 'Uncheck by default' : 'Pre-check by default'}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                                onClick={() => mutations.deleteItem.mutate(item.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        {/* Add item input */}
                        <div className="flex items-center gap-2 pt-2 border-t border-dashed">
                          <Input
                            placeholder="Add new item..."
                            value={newItemLabels[section.id] || ''}
                            onChange={e => setNewItemLabels(prev => ({ ...prev, [section.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleAddItem(section.id)}
                            className="h-8 text-sm"
                          />
                          <Button size="sm" variant="secondary" onClick={() => handleAddItem(section.id)} className="h-8 shrink-0">
                            <Plus className="h-3 w-3 mr-1" /> Add
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })
          )}

          {/* Add new section */}
          <div className="flex items-center gap-2 pt-3 border-t">
            <IconPicker
              value={newSectionIcon}
              onChange={setNewSectionIcon}
              ariaLabel="Choose a section icon"
            />
            <Input
              placeholder="New section title..."
              value={newSectionTitle}
              onChange={e => setNewSectionTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddSection()}
              className="flex-1"
            />
            <Button onClick={handleAddSection} className="gap-1 shrink-0">
              <Plus className="h-4 w-4" /> Add Section
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

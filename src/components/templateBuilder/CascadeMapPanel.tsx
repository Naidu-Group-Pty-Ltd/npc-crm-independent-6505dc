import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCopy, Download, Link2, MapPinned, Plus, Target, WandSparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { Block, Overlay, ReportAnchor, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import {
  buildCascadeAnchorSuggestions,
  buildCascadeDiagnosticsExport,
  buildCascadeMap,
  cascadeDiagnosticsToCsv,
  contractFromStructureTemplate,
  makeFieldAnchor,
  makeSectionAnchor,
  patchCascadeAnchorsQaStatus,
  selectStructureTemplate,
  type CascadeAnchorSuggestion,
  type CascadeQaStatus,
  type ReportOutputFieldContract,
  type ReportOutputSectionContract,
  type ReportStructureTemplateLike,
} from '@/lib/reportTemplate/cascadeMap';
import { toast } from 'sonner';

interface Props {
  template: ReportTemplate;
  templateId?: string;
  reportType?: string | null;
  tier?: string | null;
  sampleData?: Record<string, any>;
  selectedBlockId?: string | null;
  selectedOverlayId?: string | null;
  onUpdateTemplate: (next: ReportTemplate) => void;
  onSelectTarget?: (target: { pageId: string; blockId?: string | null; overlayId?: string | null }) => void;
}

function appendAnchor(existing: ReportAnchor[] | undefined, anchor: ReportAnchor): ReportAnchor[] {
  const list = Array.isArray(existing) ? existing : [];
  const key = anchor.fieldPath || anchor.sectionId || anchor.id;
  const withoutDuplicate = list.filter((a) => (a.fieldPath || a.sectionId || a.id) !== key);
  return [...withoutDuplicate, anchor];
}

function patchOverlayForAnchor(overlay: Overlay, anchor: ReportAnchor): Overlay {
  const next: any = { ...overlay, anchors: appendAnchor((overlay as any).anchors, anchor) };
  const binding = anchor.bindingPath || anchor.fieldPath;
  if (binding) {
    if (overlay.type === 'text' || overlay.type === 'textOnPath') next.content = `{{${binding}}}`;
    if (overlay.type === 'image') next.src = `{{${binding}}}`;
    if (overlay.type === 'table') next.data = binding;
  }
  return next as Overlay;
}

function safeFilePart(value: string | null | undefined, fallback: string): string {
  const safe = String(value || fallback).trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function patchTemplateForSuggestions(template: ReportTemplate, suggestions: CascadeAnchorSuggestion[]): { next: ReportTemplate; applied: number } {
  let applied = 0;
  const next: ReportTemplate = {
    ...template,
    pages: template.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => {
        const targetSuggestions = suggestions.filter((suggestion) => suggestion.pageId === page.id && suggestion.blockId === block.id);
        if (!targetSuggestions.length) return block;

        let nextBlock: Block = block;
        const blockSuggestions = targetSuggestions.filter((suggestion) => !suggestion.overlayId);
        for (const suggestion of blockSuggestions) {
          applied += 1;
          nextBlock = { ...nextBlock, anchors: appendAnchor((nextBlock as any).anchors, suggestion.anchor) } as Block;
        }

        const overlaySuggestions = targetSuggestions.filter((suggestion) => suggestion.overlayId);
        if (!overlaySuggestions.length) return nextBlock;
        return {
          ...nextBlock,
          overlays: nextBlock.overlays.map((overlay) => {
            const suggestionsForOverlay = overlaySuggestions.filter((item) => item.overlayId === overlay.id);
            if (!suggestionsForOverlay.length) return overlay;
            applied += suggestionsForOverlay.length;
            return {
              ...overlay,
              anchors: suggestionsForOverlay.reduce((anchors, suggestion) => appendAnchor(anchors, suggestion.anchor), (overlay as any).anchors),
            } as Overlay;
          }),
        } as Block;
      }),
    })),
  };
  return { next, applied };
}

const QA_STATUS_OPTIONS: Array<{ value: CascadeQaStatus; label: string }> = [
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'approved', label: 'Approved' },
  { value: 'needs_changes', label: 'Needs changes' },
  { value: 'rejected', label: 'Rejected' },
];

function issueTone(severity: string): string {
  if (severity === 'error') return 'border-destructive/40 bg-destructive/5 text-destructive';
  if (severity === 'warning') return 'border-brand-400/40 bg-brand-50 text-brand-800 dark:bg-brand-950/20 dark:text-brand-200';
  return 'border-info/30 bg-info/10 text-info dark:bg-info/20 dark:text-info';
}

export function CascadeMapPanel({
  template,
  templateId,
  reportType,
  tier,
  sampleData,
  selectedBlockId,
  selectedOverlayId,
  onUpdateTemplate,
  onSelectTarget,
}: Props) {
  const { data: structureRows = [], isLoading } = useQuery({
    queryKey: ['report-structure-templates', 'cascade-map', reportType ?? '', tier ?? ''],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_structure_templates',
        listOptions: {
          select: 'id,name,parsed_content,report_tier,report_category,priority,is_active,template_type',
          orderBy: 'priority',
          orderAsc: false,
          filters: { template_type: 'ai_structure', is_active: true },
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records ?? []) as ReportStructureTemplateLike[];
    },
  });

  const selectedStructure = useMemo(
    () => selectStructureTemplate(structureRows, { tier: tier || null, category: reportType || null }),
    [structureRows, tier, reportType],
  );
  const contract = useMemo(
    () => contractFromStructureTemplate(selectedStructure, { reportType: reportType || null, tier: tier || null, category: reportType || null }),
    [selectedStructure, reportType, tier],
  );
  const cascade = useMemo(
    () => buildCascadeMap(template, contract, { data: sampleData ?? {}, templateId }),
    [template, contract, sampleData, templateId],
  );

  const applyAnchor = (anchor: ReportAnchor) => {
    if (!selectedBlockId && !selectedOverlayId) {
      toast.error('Select a block or overlay before assigning a cascade anchor.');
      return;
    }
    let changed = false;
    const next: ReportTemplate = {
      ...template,
      pages: template.pages.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) => {
          if (selectedOverlayId) {
            const hasOverlay = block.overlays.some((overlay) => overlay.id === selectedOverlayId);
            if (!hasOverlay) return block;
            changed = true;
            return {
              ...block,
              overlays: block.overlays.map((overlay) => overlay.id === selectedOverlayId ? patchOverlayForAnchor(overlay, anchor) : overlay),
            };
          }
          if (block.id !== selectedBlockId) return block;
          changed = true;
          return { ...block, anchors: appendAnchor((block as any).anchors, anchor) } as Block;
        }),
      })),
    };
    if (!changed) {
      toast.error('Could not find the selected design target.');
      return;
    }
    onUpdateTemplate(next);
    toast.success(`Mapped ${anchor.label || anchor.fieldPath || anchor.sectionId || 'anchor'} to the selected ${selectedOverlayId ? 'overlay' : 'block'}.`);
  };

  const targetLabel = selectedOverlayId ? `overlay ${selectedOverlayId}` : selectedBlockId ? `block ${selectedBlockId}` : 'no selected target';
  const [includeRepeatedAutoMap, setIncludeRepeatedAutoMap] = useState(false);
  const [bulkQaStatusFilter, setBulkQaStatusFilter] = useState<CascadeQaStatus | 'all'>('unreviewed');
  const [bulkQaNextStatus, setBulkQaNextStatus] = useState<CascadeQaStatus>('approved');
  const [bulkQaRequiredOnly, setBulkQaRequiredOnly] = useState(true);
  const [bulkQaOwner, setBulkQaOwner] = useState('');
  const [bulkQaNote, setBulkQaNote] = useState('');
  const cascadeTargets = useMemo(() => [...cascade.sections.flatMap((section) => section.targets), ...cascade.unmappedTargets], [cascade]);
  const bulkQaTargets = useMemo(() => cascadeTargets.filter((target) => {
    const current = target.anchor.qaStatus ?? 'unreviewed';
    if (bulkQaStatusFilter !== 'all' && current !== bulkQaStatusFilter) return false;
    if (bulkQaRequiredOnly && !target.anchor.required) return false;
    return true;
  }), [bulkQaRequiredOnly, bulkQaStatusFilter, cascadeTargets]);
  const bulkQaStatusCounts = useMemo(() => {
    const counts = QA_STATUS_OPTIONS.reduce((acc, option) => ({ ...acc, [option.value]: 0 }), {} as Record<CascadeQaStatus, number>);
    for (const target of cascadeTargets) counts[target.anchor.qaStatus ?? 'unreviewed'] += 1;
    return counts;
  }, [cascadeTargets]);
  const primaryAnchorSuggestions = useMemo(() => buildCascadeAnchorSuggestions(template, contract), [template, contract]);
  const repeatedAnchorSuggestions = useMemo(() => buildCascadeAnchorSuggestions(template, contract, { includeDuplicates: true }), [template, contract]);
  const anchorSuggestions = includeRepeatedAutoMap ? repeatedAnchorSuggestions : primaryAnchorSuggestions;
  const repeatedSuggestionDelta = Math.max(0, repeatedAnchorSuggestions.length - primaryAnchorSuggestions.length);
  const hasAutoMapSuggestions = primaryAnchorSuggestions.length > 0 || repeatedSuggestionDelta > 0;
  const diagnostics = useMemo(() => buildCascadeDiagnosticsExport(cascade, contract), [cascade, contract]);
  const exportBaseName = `cascade-${safeFilePart(reportType, 'report')}-${safeFilePart(tier, 'any-tier')}`;
  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      toast.success('Cascade diagnostics copied as JSON');
    } catch {
      toast.error('Could not copy diagnostics to clipboard');
    }
  };
  const downloadJson = () => {
    downloadTextFile(`${exportBaseName}.json`, JSON.stringify(diagnostics, null, 2), 'application/json;charset=utf-8');
    toast.success('Downloaded cascade diagnostics JSON');
  };
  const downloadCsv = () => {
    downloadTextFile(`${exportBaseName}.csv`, cascadeDiagnosticsToCsv(diagnostics), 'text/csv;charset=utf-8');
    toast.success('Downloaded cascade diagnostics CSV');
  };
  const applyAnchorSuggestions = () => {
    const { next, applied } = patchTemplateForSuggestions(template, anchorSuggestions);
    if (!applied) {
      toast.info('No auto-map suggestions are available.');
      return;
    }
    onUpdateTemplate(next);
    toast.success(`Applied ${applied} cascade anchor suggestion${applied === 1 ? '' : 's'}.`);
  };
  const applyBulkQaStatus = () => {
    const { next, updated } = patchCascadeAnchorsQaStatus(
      template,
      {
        qaStatus: bulkQaNextStatus,
        qaOwner: bulkQaOwner.trim() || undefined,
        qaNote: bulkQaNote.trim() || undefined,
        qaReviewedAt: new Date().toISOString(),
      },
      {
        currentStatuses: bulkQaStatusFilter === 'all' ? undefined : [bulkQaStatusFilter],
        requiredOnly: bulkQaRequiredOnly,
      },
    );
    if (!updated) {
      toast.info('No Cascade anchors matched the bulk QA filter.');
      return;
    }
    onUpdateTemplate(next);
    toast.success(`Updated ${updated} Cascade anchor${updated === 1 ? '' : 's'} to ${QA_STATUS_OPTIONS.find((option) => option.value === bulkQaNextStatus)?.label ?? bulkQaNextStatus}.`);
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      <div className="border-b p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><MapPinned className="h-4 w-4 text-primary" /> Report cascade map</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Map configured report-structure sections and generated fields to exact PDF blocks or overlays.
            </p>
          </div>
          <Badge variant={cascade.stats.errorCount ? 'destructive' : 'secondary'} className="shrink-0">
            {cascade.stats.mappedRequiredSections}/{cascade.stats.requiredSections} required
          </Badge>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="rounded border p-2"><div className="text-muted-foreground">Structure</div><div className="font-medium truncate">{selectedStructure?.name || (isLoading ? 'Loading…' : 'Fallback')}</div></div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Sections</div><div className="font-medium">{cascade.stats.mappedSections}/{cascade.stats.totalSections}</div></div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Anchors</div><div className="font-medium">{cascade.stats.totalAnchors}</div></div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Issues</div><div className="font-medium">{cascade.stats.issueCount}</div></div>
        </div>
        <div className="rounded border bg-muted/30 p-2 text-xs">
          Assigning to: <span className="font-mono">{targetLabel}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyDiagnostics}>
            <ClipboardCopy className="h-3.5 w-3.5 mr-1" /> Copy JSON
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadJson}>
            <Download className="h-3.5 w-3.5 mr-1" /> JSON
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!anchorSuggestions.length} onClick={applyAnchorSuggestions}>
            <WandSparkles className="h-3.5 w-3.5 mr-1" /> Auto-map {anchorSuggestions.length || ''}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {hasAutoMapSuggestions && (
            <Card className="border-primary/30 bg-primary/5 p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold flex items-center gap-2"><WandSparkles className="h-3.5 w-3.5 text-primary" /> Auto-map suggestions</h4>
                  <p className="mt-1 text-muted-foreground">
                    Found {primaryAnchorSuggestions.length} primary unanchored report-structure binding target{primaryAnchorSuggestions.length === 1 ? '' : 's'} already present in the design.
                  </p>
                </div>
                <Button size="sm" className="h-7 text-xs shrink-0" disabled={!anchorSuggestions.length} onClick={applyAnchorSuggestions}>Apply all</Button>
              </div>
              {repeatedSuggestionDelta > 0 && (
                <label className="mt-2 flex items-start gap-2 rounded border bg-background/70 px-2 py-1.5 text-[11px]">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    checked={includeRepeatedAutoMap}
                    onChange={(event) => setIncludeRepeatedAutoMap(event.currentTarget.checked)}
                  />
                  <span>
                    <span className="font-medium">Include repeated uses</span>
                    <span className="ml-1 text-muted-foreground">Add {repeatedSuggestionDelta} additional anchor target{repeatedSuggestionDelta === 1 ? '' : 's'} for repeated bindings of the same generated field.</span>
                  </span>
                </label>
              )}
              <div className="mt-2 space-y-1">
                {anchorSuggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={`${suggestion.pageId}-${suggestion.blockId}-${suggestion.overlayId || 'block'}-${suggestion.fieldPath}`}
                    className="block w-full rounded border bg-background/70 px-2 py-1 text-left hover:border-primary/50"
                    onClick={() => onSelectTarget?.({ pageId: suggestion.pageId, blockId: suggestion.blockId, overlayId: suggestion.overlayId ?? null })}
                  >
                    <span className="font-medium">{suggestion.label}</span>
                    <span className="ml-1 text-muted-foreground">→ Page {suggestion.pageIndex + 1} · {suggestion.overlayId ? `overlay ${suggestion.overlayId}` : `block ${suggestion.blockId}`}</span>
                    {suggestion.duplicateBindingCount > 1 && <span className="ml-1 text-muted-foreground">(+{suggestion.duplicateBindingCount - 1} more binding use{suggestion.duplicateBindingCount === 2 ? '' : 's'})</span>}
                  </button>
                ))}
                {anchorSuggestions.length > 5 && <p className="text-[11px] text-muted-foreground">+{anchorSuggestions.length - 5} more suggestions.</p>}
              </div>
            </Card>
          )}

          {cascadeTargets.length > 0 && (
            <Card className="border-brand-400/30 bg-brand-50/60 p-3 text-xs dark:bg-brand-950/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-brand-600" /> Bulk QA signoff</h4>
                  <p className="mt-1 text-muted-foreground">
                    Filter mapped anchors by current QA status, assign an owner/note, and update their signoff state before activation.
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">{bulkQaTargets.length} matching</Badge>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-5">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current status</span>
                  <select className="h-8 w-full rounded border bg-background px-2 text-xs" value={bulkQaStatusFilter} onChange={(event) => setBulkQaStatusFilter(event.currentTarget.value as CascadeQaStatus | 'all')}>
                    <option value="all">All statuses</option>
                    {QA_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} ({bulkQaStatusCounts[option.value]})</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Set status</span>
                  <select className="h-8 w-full rounded border bg-background px-2 text-xs" value={bulkQaNextStatus} onChange={(event) => setBulkQaNextStatus(event.currentTarget.value as CascadeQaStatus)}>
                    {QA_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">QA owner</span>
                  <input className="h-8 w-full rounded border bg-background px-2 text-xs" placeholder="Reviewer" value={bulkQaOwner} onChange={(event) => setBulkQaOwner(event.currentTarget.value)} />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">QA note</span>
                  <input className="h-8 w-full rounded border bg-background px-2 text-xs" placeholder="Optional signoff note" value={bulkQaNote} onChange={(event) => setBulkQaNote(event.currentTarget.value)} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={bulkQaRequiredOnly} onChange={(event) => setBulkQaRequiredOnly(event.currentTarget.checked)} />
                  Required anchors only
                </label>
                <Button size="sm" className="h-7 text-xs" disabled={!bulkQaTargets.length} onClick={applyBulkQaStatus}>
                  Apply QA update
                </Button>
              </div>
            </Card>
          )}

          {cascade.issues.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diagnostics</h4>
              {cascade.issues.slice(0, 8).map((issue, index) => (
                <div key={`${issue.code}-${index}`} className={`rounded border px-2 py-1.5 text-xs ${issueTone(issue.severity)}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{issue.message}</span>
                  </div>
                </div>
              ))}
              {cascade.issues.length > 8 && <p className="text-[11px] text-muted-foreground">+{cascade.issues.length - 8} more diagnostics.</p>}
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Report structure</h4>
            {cascade.sections.map((sectionStatus) => {
              const section = contract.sections.find((s) => s.id === sectionStatus.sectionId)!;
              return (
                <Card key={section.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {sectionStatus.status === 'missing_anchor'
                          ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                          : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                        <div className="font-medium text-sm truncate">{section.label}</div>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">{section.id}</div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyAnchor(makeSectionAnchor(section))}>
                      <Target className="h-3.5 w-3.5 mr-1" /> Anchor section
                    </Button>
                  </div>

                  {sectionStatus.targets.length > 0 && (
                    <div className="space-y-1">
                      {sectionStatus.targets.slice(0, 3).map((target) => (
                        <button
                          key={`${target.anchorId}-${target.overlayId || target.blockId}`}
                          className="block w-full rounded border bg-muted/30 px-2 py-1 text-left text-[11px] hover:border-primary/50"
                          onClick={() => onSelectTarget?.({ pageId: target.pageId, blockId: target.blockId, overlayId: target.overlayId ?? null })}
                        >
                          <Link2 className="mr-1 inline h-3 w-3" /> Page {target.pageIndex + 1} · {target.overlayId ? `overlay ${target.overlayId}` : `block ${target.blockId}`}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {section.fields.map((field: ReportOutputFieldContract) => {
                      const mapped = sectionStatus.targets.some((target) => (target.fieldPath || target.anchor.fieldPath) === field.path);
                      return (
                        <div key={field.path} className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1.5 text-xs">
                          <div className="min-w-0">
                            <div className="truncate">{mapped ? '✅' : field.required ? '⚠️' : '○'} {field.label}</div>
                            <div className="font-mono text-[10px] text-muted-foreground truncate">{field.path}</div>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => applyAnchor(makeFieldAnchor(field))}>
                            <Plus className="h-3 w-3 mr-1" /> Map
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

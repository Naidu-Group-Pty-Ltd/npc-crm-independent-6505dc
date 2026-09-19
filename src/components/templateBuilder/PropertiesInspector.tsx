/**
 * PropertiesInspector — right rail. Edits the currently-selected overlay,
 * or page-level settings if none is selected.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Sparkles, Copy, Upload, Loader2, AlertTriangle, X, Maximize2, ChevronUp, ChevronDown, Plus, MapPinned } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { toast } from 'sonner';
import type { Block, Overlay, Page, ReportAnchor, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import {
  buildSuggestions,
  validateBindable,
  type BindingIssue,
} from '@/lib/reportTemplate/bindingValidation';
import { BLOCK_DEFS, type BlockField } from '@/lib/reportTemplate/blocks';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { templateEditorActions, useActivePage, useEditorTemplate, useSelectedOverlay, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { BlockStylePanel, BlockVisibilityPanel, BlockRepeatPanel, BlockAlignmentPanel, BlockInteractionsPanel } from './BlockStylePanels';
import { TypographyPanel, FontLibraryPopover } from './TypographyPanel';
import { InlineAiTextActions } from './InlineAiTextActions';
import { PaperSizePicker } from './PaperSizePicker';
import { EnhancedColorPicker } from './EnhancedColorPicker';
import { FontPicker } from './FontPicker';
import { FontSizeControl } from './FontSizeControl';
import { BackgroundGradientEditor, type GradientValue } from './BackgroundGradientEditor';
import { StyleClipboardButtons } from './StyleClipboardButtons';
import { EffectsPanel } from './EffectsPanel';
import { AlignmentGrid } from './AlignmentGrid';
import { TextRhythmControl } from './TextRhythmControl';
import { PalettePresets } from './PalettePresets';
import { Badge } from '@/components/ui/badge';
import { createEmptyListRow, updateListRowValue, type ListRow } from './listRows';


// Template, active page, selection, and mutators come straight from
// templateEditorStore (slice subscriptions, rehaul Phase 2) — only the
// template id (route param) remains a prop.
interface Props {
  templateId?: string;
}

function PropertiesInspectorImpl({ templateId }: Props) {
  const template = useEditorTemplate();
  const page = useActivePage();
  const overlay = useSelectedOverlay();
  const selectedBlockId = useTemplateEditorStore((s) => s.selectedBlockId);
  const {
    updateOverlay: onUpdateOverlay,
    deleteOverlay: onDeleteOverlay,
    duplicateOverlay: onDuplicateOverlay,
    updatePage: onUpdatePage,
    setSelectedBlockId: onSelectBlock,
    updateBlock: onUpdateBlock,
    deleteBlock: onDeleteBlock,
    duplicateBlock: onDuplicateBlock,
    moveBlock: onMoveBlock,
    setTemplate: onUpdateTemplate,
  } = templateEditorActions();
  const selectedBlock =
    page && selectedBlockId
      ? page.blocks.find((b) => b.id === selectedBlockId) ?? null
      : null;

  if (!overlay && !page) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Select an element on the canvas to edit its properties.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        {overlay ? (
          <OverlayEditor
            template={template}
            templateId={templateId}
            overlay={overlay}
            pageId={page?.id ?? null}
            selectedBlockId={selectedBlockId ?? null}
            onChange={onUpdateOverlay}
            onDelete={() => onDeleteOverlay(overlay.id)}
            onDuplicate={() => onDuplicateOverlay(overlay.id)}
            onUpdateTemplate={onUpdateTemplate}
          />
        ) : selectedBlock ? (
          <BlockEditor
            template={template}
            block={selectedBlock}
            page={page}
            onChange={(b) => onUpdateBlock?.(b)}
            onDelete={() => { onDeleteBlock?.(selectedBlock.id); onSelectBlock?.(null); }}
            onDuplicate={() => onDuplicateBlock?.(selectedBlock.id)}
            onBack={() => onSelectBlock?.(null)}
          />

        ) : (
          page && (
            <PageEditor
              template={template}
              page={page}
              onChange={onUpdatePage}
              onSelectBlock={onSelectBlock}
              onMoveBlock={onMoveBlock}
              onDeleteBlock={onDeleteBlock}
              onDuplicateBlock={onDuplicateBlock}
              onUpdateTemplate={onUpdateTemplate}
            />
          )
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * Memoized: at 1,600+ lines of editors this is the most expensive panel in the
 * editor; memo skips it when unrelated editor state (dialogs, presence, save
 * status, …) changes. Callers must pass useCallback-stable handlers.
 */
export const PropertiesInspector = memo(PropertiesInspectorImpl);

// ─────────────────────────────────────────────────────────────────────────────

function makeManualAnchor(targetId: string): ReportAnchor {
  return {
    id: `anchor_${targetId}_${Date.now().toString(36)}`,
    kind: 'field',
    label: 'New cascade anchor',
    fieldPath: 'sections.example.body',
    bindingPath: 'sections.example.body',
    visibility: 'designer',
    renderMode: 'replace',
    qaStatus: 'unreviewed',
  };
}

function CascadeAnchorEditor({
  targetId,
  anchors,
  onChange,
}: {
  targetId: string;
  anchors?: ReportAnchor[];
  onChange: (anchors: ReportAnchor[] | undefined) => void;
}) {
  const list = Array.isArray(anchors) ? anchors : [];
  const update = (index: number, patch: Partial<ReportAnchor>) => {
    onChange(list.map((anchor, i) => (i === index ? { ...anchor, ...patch } : anchor)));
  };
  const updateQaStatus = (index: number, status: NonNullable<ReportAnchor['qaStatus']>) => {
    update(index, {
      qaStatus: status,
      qaReviewedAt: status === 'unreviewed' ? undefined : new Date().toISOString(),
    });
  };
  const remove = (index: number) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length ? next : undefined);
  };

  return (
    <div className="space-y-2 rounded border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <MapPinned className="h-3.5 w-3.5 text-primary" /> Cascade anchors
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Map this design target to a report-structure section or generated field.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange([...list, makeManualAnchor(targetId)])}>
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No cascade anchors assigned. Use the Cascade tab for structure-aware mapping, or add one manually here.</p>
      ) : (
        <div className="space-y-2">
          {list.map((anchor, index) => (
            <div key={`${anchor.id}-${index}`} className="rounded border bg-background p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary" className="text-[10px]">{anchor.kind}</Badge>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(index)} title="Remove anchor">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind</Label>
                  <Select value={anchor.kind ?? 'field'} onValueChange={(v) => update(index, { kind: v as ReportAnchor['kind'] })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="section">section</SelectItem>
                      <SelectItem value="field">field</SelectItem>
                      <SelectItem value="repeat">repeat</SelectItem>
                      <SelectItem value="slot">slot</SelectItem>
                      <SelectItem value="diagnostic">diagnostic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Required</Label>
                  <Select value={anchor.required ? 'yes' : 'no'} onValueChange={(v) => update(index, { required: v === 'yes' })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Label</Label>
                <Input className="h-8 text-xs" value={anchor.label ?? ''} onChange={(e) => update(index, { label: e.target.value || undefined })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Section ID</Label>
                <Input className="h-8 text-xs font-mono" placeholder="executive_summary" value={anchor.sectionId ?? ''} onChange={(e) => update(index, { sectionId: e.target.value || undefined })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Field path</Label>
                <Input className="h-8 text-xs font-mono" placeholder="sections.executive_summary.body" value={anchor.fieldPath ?? ''} onChange={(e) => update(index, { fieldPath: e.target.value || undefined, bindingPath: anchor.bindingPath || e.target.value || undefined })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Binding path override</Label>
                <Input className="h-8 text-xs font-mono" placeholder="defaults to field path" value={anchor.bindingPath ?? ''} onChange={(e) => update(index, { bindingPath: e.target.value || undefined })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">QA status</Label>
                  <Select value={anchor.qaStatus ?? 'unreviewed'} onValueChange={(v) => updateQaStatus(index, v as NonNullable<ReportAnchor['qaStatus']>)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unreviewed">Unreviewed</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="needs_changes">Needs changes</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">QA owner</Label>
                  <Input className="h-8 text-xs" placeholder="Reviewer" value={anchor.qaOwner ?? ''} onChange={(e) => update(index, { qaOwner: e.target.value || undefined })} />
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">QA note</Label>
                <Textarea className="min-h-16 text-xs" placeholder="Why this generated field lands here; review notes for repeated uses." value={anchor.qaNote ?? ''} onChange={(e) => update(index, { qaNote: e.target.value || undefined })} />
                {anchor.qaReviewedAt && <div className="mt-1 text-[10px] text-muted-foreground">Reviewed {new Date(anchor.qaReviewedAt).toLocaleString('en-AU')}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverlayEditor({
  template,
  templateId,
  overlay,
  pageId,
  selectedBlockId,
  onChange,
  onDelete,
  onDuplicate,
  onUpdateTemplate,
}: {
  template: ReportTemplate;
  templateId?: string;
  overlay: Overlay;
  pageId: string | null;
  selectedBlockId: string | null;
  onChange: (n: Overlay) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateTemplate?: (t: ReportTemplate) => void;
}) {
  const patch = (p: Partial<Overlay>) => onChange({ ...overlay, ...(p as any) });
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold capitalize">{overlay.type} overlay</h3>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{overlay.id}</p>
        </div>
        <div className="flex items-center gap-1">
          <StyleClipboardButtons overlay={overlay} onChange={onChange} />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate} title="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setShowDelete(true)} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete overlay?</AlertDialogTitle>
            <AlertDialogDescription>
              This overlay will be removed from the page. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDelete(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { setShowDelete(false); onDelete(); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CascadeAnchorEditor
        targetId={overlay.id}
        anchors={(overlay as any).anchors}
        onChange={(anchors) => patch({ anchors } as any)}
      />

      {/* Position / size */}
      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={overlay.x} onChange={(v) => patch({ x: v })} />
        <NumField label="Y" value={overlay.y} onChange={(v) => patch({ y: v })} />
        <NumField label="W" value={overlay.width} onChange={(v) => patch({ width: v })} />
        <NumField label="H" value={overlay.height} onChange={(v) => patch({ height: v })} />
        <NumField label="Rotation" value={overlay.rotation || 0} onChange={(v) => patch({ rotation: v })} />
        <NumField
          label="Opacity"
          value={overlay.opacity ?? 1}
          step={0.05}
          min={0}
          max={1}
          onChange={(v) => patch({ opacity: v })}
        />
      </div>

      {(() => {
        const pg = template.pages.find((p) => p.id === pageId);
        if (!pg) return null;
        return (
          <AlignmentGrid
            pageWidth={pg.size.width ?? 595}
            pageHeight={pg.size.height ?? 842}
            overlayWidth={overlay.width}
            overlayHeight={overlay.height}
            safeArea={pg.safeArea ?? 0}
            onAlign={({ x, y }) => patch({ x, y })}
          />
        );
      })()}

      <Separator />

      {/* Phase 17 — visual effects (shared across all overlay types) */}
      <EffectsPanel
        value={(overlay as any).effects}
        onChange={(v) => patch({ effects: v } as any)}
      />

      <Separator />
      {overlay.type === 'text' && (
        <div className="space-y-3">
          {pageId && (
            <InlineAiTextActions
              template={template}
              overlay={overlay}
              pageId={pageId}
              blockId={selectedBlockId}
              onPatchContent={(newContent) => patch({ content: newContent } as any)}
            />
          )}
          <BindableField
            label="Content"
            value={String(overlay.content ?? '')}
            onChange={(v) => patch({ content: v } as any)}
            template={template}
            multiline
          />

          {/* Section 3 — paragraph style reference */}
          {(() => {
            const styles = (template.tokens as any).paragraphStyles as Record<string, any> | undefined;
            const keys = styles ? Object.keys(styles) : [];
            if (keys.length === 0) return null;
            const cur = String((overlay as any).styleRef ?? '__none__');
            return (
              <div>
                <Label className="text-xs">Paragraph style</Label>
                <Select value={cur} onValueChange={(v) => patch({ styleRef: v === '__none__' ? undefined : v } as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {keys.map((k) => (
                      <SelectItem key={k} value={k}>{styles![k].name ?? k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}

          {/* Section 3 — drop cap */}
          <div className="rounded border p-2 space-y-2">
            <label className="flex items-center justify-between text-xs">
              <span>Drop cap</span>
              <input
                type="checkbox"
                checked={!!(overlay as any).dropCap?.enabled}
                onChange={(e) => patch({ dropCap: e.target.checked ? { enabled: true, lines: (overlay as any).dropCap?.lines ?? 3 } : undefined } as any)}
              />
            </label>
            {(overlay as any).dropCap?.enabled && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Lines</Label>
                  <input
                    type="number" min={2} max={8} className="h-7 w-full text-xs rounded border bg-background px-1"
                    value={(overlay as any).dropCap?.lines ?? 3}
                    onChange={(e) => patch({ dropCap: { ...((overlay as any).dropCap ?? {}), enabled: true, lines: Math.max(2, Math.min(8, Number(e.target.value) || 3)) } } as any)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Margin (pt)</Label>
                  <input
                    type="number" min={0} max={48} className="h-7 w-full text-xs rounded border bg-background px-1"
                    value={(overlay as any).dropCap?.marginRight ?? 6}
                    onChange={(e) => patch({ dropCap: { ...((overlay as any).dropCap ?? {}), enabled: true, marginRight: Number(e.target.value) || 0 } } as any)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Color</Label>
                  <input
                    type="color" className="h-7 w-full rounded border bg-background"
                    value={(overlay as any).dropCap?.color ?? '#000000'}
                    onChange={(e) => patch({ dropCap: { ...((overlay as any).dropCap ?? {}), enabled: true, color: e.target.value } } as any)}
                  />
                </div>
              </div>
            )}
          </div>

          <FontSizeControl
            value={Number(overlay.fontSize) || 12}
            onChange={(v) => patch({ fontSize: v } as any)}
          />

          <div>
            <Label className="text-xs">Font family</Label>
            <FontPicker
              value={String(overlay.fontFamily || 'Helvetica')}
              weight={overlay.fontWeight}
              template={template}
              onChange={(family) => patch({ fontFamily: family } as any)}
              onWeightChange={(w) => patch({ fontWeight: w } as any)}
              onTemplateChange={onUpdateTemplate}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Align</Label>
              <Select value={overlay.align} onValueChange={(v) => patch({ align: v as any })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                  <SelectItem value="justify">Justify</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Style</Label>
              <Select value={overlay.fontStyle ?? 'normal'} onValueChange={(v) => patch({ fontStyle: v as any })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="italic">Italic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <EnhancedColorPicker
            label="Color"
            value={String(overlay.color || '#000000')}
            template={template}
            onChange={(v) => patch({ color: v } as any)}
          />
          <TypographyPanel
            overlay={overlay as any}
            template={template}
            onChange={(p) => patch(p as any)}
            onTemplateChange={onUpdateTemplate}
          />
          <Separator />
          <TextRhythmControl
            value={{
              lineHeight: (overlay as any).lineHeight,
              letterSpacing: (overlay as any).letterSpacing,
              textTransform: (overlay as any).textTransform,
              textDecoration: (overlay as any).textDecoration,
            }}
            fontFamily={String((overlay as any).fontFamily || '')}
            fontSize={Number((overlay as any).fontSize) || 12}
            color={String((overlay as any).color || '#000000')}
            onChange={(p) => patch(p as any)}
          />
        </div>
      )}

      {overlay.type === 'shape' && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Shape</Label>
            <Select value={overlay.shape} onValueChange={(v) => patch({ shape: v as any })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rect">Rectangle</SelectItem>
                <SelectItem value="ellipse">Ellipse</SelectItem>
                <SelectItem value="line">Line</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ColorField label="Fill" template={template} value={String(overlay.fill || '')} allowEmpty onChange={(v) => patch({ fill: v || undefined } as any)} />
          <ColorField label="Stroke" template={template} value={String(overlay.stroke || '')} allowEmpty onChange={(v) => patch({ stroke: v || undefined } as any)} />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Stroke W" value={overlay.strokeWidth || 0} onChange={(v) => patch({ strokeWidth: v } as any)} />
            <NumField label="Radius" value={overlay.borderRadius || 0} onChange={(v) => patch({ borderRadius: v } as any)} />
          </div>
        </div>
      )}

      {overlay.type === 'image' && (
        <div className="space-y-3">
          <BindableField
            label="Source (URL or binding)"
            value={String(overlay.src ?? '')}
            onChange={(v) => patch({ src: v } as any)}
            template={template}
          />
          <ImageUploadField
            templateId={templateId}
            overlay={overlay}
            onPatch={(p) => onChange({ ...overlay, ...(p as any) })}
          />
          <div>
            <Label className="text-xs">Fit</Label>
            <Select value={overlay.fit} onValueChange={(v) => patch({ fit: v as any })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Cover (crop to fill)</SelectItem>
                <SelectItem value="contain">Contain (letterbox)</SelectItem>
                <SelectItem value="fill">Fill (stretch)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CropControls
            crop={(overlay as any).crop}
            onChange={(c) => patch({ crop: c } as any)}
          />
        </div>
      )}

      {(overlay as any).type === 'textOnPath' && (
        <div className="space-y-3">
          <BindableField
            label="Content"
            value={String((overlay as any).content ?? '')}
            onChange={(v) => patch({ content: v } as any)}
            template={template}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Curve</Label>
              <Select value={(overlay as any).curve ?? 'arc-up'} onValueChange={(v) => patch({ curve: v as any } as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="arc-up">Arc up</SelectItem>
                  <SelectItem value="arc-down">Arc down</SelectItem>
                  <SelectItem value="wave">Wave</SelectItem>
                  <SelectItem value="circle">Circle</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Curvature</Label>
              <Input
                type="number" step="0.05" min={-1} max={1}
                className="h-8 text-xs"
                value={(overlay as any).curvature ?? 0.5}
                onChange={(e) => patch({ curvature: Math.max(-1, Math.min(1, Number(e.target.value) || 0)) } as any)}
              />
            </div>
            <div>
              <Label className="text-xs">Font size (pt)</Label>
              <Input
                type="number" className="h-8 text-xs"
                value={Number((overlay as any).fontSize) || 18}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 18 } as any)}
              />
            </div>
            <div>
              <Label className="text-xs">Letter spacing</Label>
              <Input
                type="number" step="0.1" className="h-8 text-xs"
                value={(overlay as any).letterSpacing ?? 0}
                onChange={(e) => patch({ letterSpacing: Number(e.target.value) || 0 } as any)}
              />
            </div>
            <div>
              <Label className="text-xs">Start offset (%)</Label>
              <Input
                type="number" min={0} max={100} className="h-8 text-xs"
                value={(overlay as any).startOffset ?? 0}
                onChange={(e) => patch({ startOffset: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } as any)}
              />
            </div>
            <div>
              <Label className="text-xs">Weight</Label>
              <Select value={String((overlay as any).fontWeight ?? 'normal')} onValueChange={(v) => patch({ fontWeight: v as any } as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="bold">Bold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <EnhancedColorPicker
            label="Color"
            value={String((overlay as any).color || '#000000')}
            template={template}
            onChange={(v) => patch({ color: v } as any)}
          />
        </div>
      )}

      {(overlay as any).type === 'table' && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Open the dedicated table editor from <strong>Advanced ▸ Edit table…</strong> for columns, data binding & per-cell styles.
          </p>
          <div>
            <Label className="text-xs">Data binding (array of objects)</Label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder="e.g. property.comparables"
              value={String((overlay as any).data ?? '')}
              onChange={(e) => patch({ data: e.target.value || undefined } as any)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Font size (pt)</Label>
              <Input type="number" className="h-8 text-xs" value={(overlay as any).fontSize ?? 10} onChange={(e) => patch({ fontSize: Number(e.target.value) || 10 } as any)} />
            </div>
            <div>
              <Label className="text-xs">Row height (pt)</Label>
              <Input type="number" className="h-8 text-xs" value={(overlay as any).rowHeight ?? 20} onChange={(e) => patch({ rowHeight: Number(e.target.value) || 20 } as any)} />
            </div>
          </div>
        </div>
      )}



      <Separator />
      <div>
        <Label className="text-xs">Conditional (e.g. <code>tier === 'compass'</code>)</Label>
        <Input
          value={overlay.conditional ?? ''}
          onChange={(e) => patch({ conditional: e.target.value || undefined } as any)}
          placeholder="Always shown if blank"
          className="text-xs font-mono"
        />
      </div>
    </div>
  );
}

function PageEditor({
  template,
  page,
  onChange,
  onSelectBlock,
  onMoveBlock,
  onDeleteBlock,
  onDuplicateBlock,
  onUpdateTemplate,
}: {
  template: ReportTemplate;
  page: Page;
  onChange: (n: Page) => void;
  onSelectBlock?: (id: string | null) => void;
  onMoveBlock?: (id: string, dir: -1 | 1) => void;
  onDeleteBlock?: (id: string) => void;
  onDuplicateBlock?: (id: string) => void;
  onUpdateTemplate?: (t: ReportTemplate) => void;
}) {
  const [bgImageUrl, setBgImageUrl] = useState(String(page.background?.imageUrl ?? ''));
  useEffect(() => { setBgImageUrl(String(page.background?.imageUrl ?? '')); }, [page.id]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Page settings</h3>
      <div>
        <Label className="text-xs">Name</Label>
        <Input value={page.name} onChange={(e) => onChange({ ...page, name: e.target.value })} className="text-xs" />
      </div>
      <PaperSizePicker
        width={page.size.width}
        height={page.size.height}
        onChange={(size) => onChange({ ...page, size: { ...page.size, ...size } })}
      />
      {onUpdateTemplate && (
        <>
          <Separator />
          <PalettePresets
            colors={(template.tokens?.colors as Record<string, string>) || {}}
            onChange={(nextColors) =>
              onUpdateTemplate({
                ...template,
                tokens: { ...template.tokens, colors: nextColors },
              })
            }
          />
          <Separator />
        </>
      )}
      <EnhancedColorPicker
        label="Background color"
        template={template}
        value={page.background?.color || ''}
        allowEmpty
        onChange={(v) => onChange({ ...page, background: { ...(page.background || {}), color: v || undefined } })}
      />
      <BackgroundGradientEditor
        value={(page.background as any)?.gradient as GradientValue | undefined}
        onChange={(g) => onChange({ ...page, background: { ...(page.background || {}), gradient: g } as any })}
      />
      <div>
        <Label className="text-xs">Background image URL</Label>
        <Input
          value={bgImageUrl}
          onChange={(e) => setBgImageUrl(e.target.value)}
          onBlur={() =>
            onChange({ ...page, background: { ...(page.background || {}), imageUrl: bgImageUrl || undefined } })
          }
          placeholder="https://… (preloaded for PDF render)"
          className="text-xs font-mono"
        />
      </div>
      <div>
        <Label className="text-xs">Conditional</Label>
        <Input
          value={page.conditional ?? ''}
          onChange={(e) => onChange({ ...page, conditional: e.target.value || undefined })}
          className="text-xs font-mono"
        />
      </div>

      <Separator />

      {/* Phase 5 — Baseline grid + print furniture */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Print & rhythm</h4>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Bleed (pt)" value={page.bleed ?? 0} min={0} max={36} onChange={(v) => onChange({ ...page, bleed: v || undefined })} />
          <NumField label="Safe area (pt)" value={page.safeArea ?? 0} min={0} max={72} onChange={(v) => onChange({ ...page, safeArea: v || undefined })} />
        </div>
        <div className="flex items-center justify-between rounded border border-border px-2 py-1">
          <Label className="text-xs">Show baseline grid</Label>
          <input
            type="checkbox"
            checked={!!page.baselineGrid?.show}
            onChange={(e) => onChange({
              ...page,
              baselineGrid: { size: 12, color: 'rgba(191,155,80,0.20)', offset: 0, ...(page.baselineGrid || {}), show: e.target.checked },
            })}
          />
        </div>
        {page.baselineGrid?.show && (
          <div className="grid grid-cols-3 gap-2">
            <NumField
              label="Size (pt)"
              value={page.baselineGrid.size ?? 12}
              min={4}
              max={64}
              onChange={(v) => onChange({ ...page, baselineGrid: { ...(page.baselineGrid as any), size: v } })}
            />
            <NumField
              label="Offset (pt)"
              value={page.baselineGrid.offset ?? 0}
              min={0}
              max={72}
              onChange={(v) => onChange({ ...page, baselineGrid: { ...(page.baselineGrid as any), offset: v } })}
            />
            <div>
              <Label className="text-xs">Color</Label>
              <Input
                value={page.baselineGrid.color ?? 'rgba(191,155,80,0.20)'}
                className="text-xs font-mono"
                onChange={(e) => onChange({ ...page, baselineGrid: { ...(page.baselineGrid as any), color: e.target.value } })}
              />
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Blocks list with reorder / duplicate / delete / open editor */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Blocks ({page.blocks.length})
        </h4>
        {page.blocks.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Use the left rail to insert a block.
          </p>
        ) : (
          <ul className="space-y-1">
            {page.blocks.map((b, i) => {
              const def = BLOCK_DEFS[b.type];
              return (
                <li
                  key={b.id}
                  className="flex items-center gap-1 rounded border bg-card px-2 py-1.5 text-xs hover:border-primary/50"
                >
                  <button
                    onClick={() => onSelectBlock?.(b.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="font-medium truncate">{def?.label ?? b.type}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {b.type} · {b.overlays.length} overlay{b.overlays.length === 1 ? '' : 's'}
                    </div>
                  </button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveBlock?.(b.id, -1)} disabled={i === 0} title="Move up">
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveBlock?.(b.id, 1)} disabled={i === page.blocks.length - 1} title="Move down">
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onDuplicateBlock?.(b.id)} title="Duplicate">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => onDeleteBlock?.(b.id)} title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Block editor (driven by BLOCK_DEFS.fields) ─────────────────────────────
function BlockEditor({
  template,
  block,
  page,
  onChange,
  onDelete,
  onDuplicate,
  onBack,
}: {
  template: ReportTemplate;
  block: Block;
  page: Page | null;
  onChange: (next: Block) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBack: () => void;
}) {

  const def = BLOCK_DEFS[block.type];
  const props = (block.props ?? {}) as Record<string, any>;
  const setProp = (key: string, value: unknown) =>
    onChange({ ...block, props: { ...props, [key]: value } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <button onClick={onBack} className="text-[10px] text-muted-foreground hover:text-foreground">
            ← Back to page
          </button>
          <h3 className="text-sm font-semibold truncate">{def?.label ?? block.type}</h3>
          <p className="text-[10px] font-mono text-muted-foreground truncate">{block.id}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDuplicate} title="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {def ? (
        <div className="space-y-3">
          {def.fields.map((f) => (
            <BlockFieldInput
              key={f.key}
              field={f}
              value={props[f.key]}
              sampleValue={def.defaultProps()[f.key]}
              template={template}
              onChange={(v) => setProp(f.key, v)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No editor schema for block type "{block.type}". Edit via JSON tab.
        </p>
      )}

      <Separator />
      <CascadeAnchorEditor
        targetId={block.id}
        anchors={(block as any).anchors}
        onChange={(anchors) => onChange({ ...block, anchors } as any)}
      />

      <Separator />
      <BlockAlignmentPanel block={block} page={page} onChange={onChange} />

      <Separator />
      <BlockStylePanel block={block} onChange={onChange} />

      <Separator />
      <BlockVisibilityPanel block={block} onChange={onChange} />

      <Separator />
      <BlockRepeatPanel block={block} onChange={onChange} />

      <Separator />
      <BlockInteractionsPanel block={block} onChange={onChange} pages={template.pages.map(p => ({ id: p.id, name: p.name }))} />


      <Separator />
      <div>
        <Label className="text-xs">Legacy conditional (compat)</Label>
        <Input
          value={block.conditional ?? ''}
          onChange={(e) => onChange({ ...block, conditional: e.target.value || undefined })}
          placeholder="Use Visibility section above instead"
          className="text-xs font-mono"
        />
      </div>
    </div>
  );
}


function BlockFieldInput({
  field, value, sampleValue, onChange, template,
}: {
  field: BlockField;
  value: unknown;
  sampleValue?: unknown;
  onChange: (v: unknown) => void;
  template: ReportTemplate;
}) {
  switch (field.kind) {
    case 'bindable':
      return (
        <BindableField
          label={field.label}
          value={String(value ?? '')}
          onChange={onChange}
          template={template}
          multiline={field.multiline}
        />
      );
    case 'number':
      return (
        <NumField
          label={field.label}
          value={Number(value ?? 0)}
          step={field.step}
          min={field.min}
          max={field.max}
          onChange={(n) => onChange(n)}
        />
      );
    case 'color':
      return (
        <ColorField
          label={field.label}
          value={String(value ?? '')}
          template={template}
          allowEmpty
          onChange={(v) => onChange(v || undefined)}
        />
      );
    case 'select':
      return (
        <div>
          <Label className="text-xs">{field.label}</Label>
          <Select value={String(value ?? field.options[0])} onValueChange={(v) => onChange(v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case 'list-strings':
      return (
        <ListStringsField
          label={field.label}
          values={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
        />
      );
    case 'list-rows':
      return (
        <ListRowsField
          label={field.label}
          rows={Array.isArray(value) ? (value as ListRow[]) : []}
          sampleRow={Array.isArray(sampleValue) ? (sampleValue[0] as ListRow | undefined) : undefined}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

function ListStringsField({
  label, values, onChange,
}: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onChange([...values, ''])} title="Add">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            value={v}
            onChange={(e) => {
              const next = [...values]; next[i] = e.target.value; onChange(next);
            }}
            className="h-7 text-xs"
          />
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
            onClick={() => onChange(values.filter((_, idx) => idx !== i))} title="Remove">
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function ListRowsField({
  label, rows, sampleRow, onChange,
}: { label: string; rows: ListRow[]; sampleRow?: ListRow; onChange: (v: ListRow[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Button size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => onChange([...rows, createEmptyListRow(rows[0] ?? sampleRow)])} title="Add row">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-1">
          <div className="flex-1 grid grid-cols-2 gap-1">
            {Object.entries(row).flatMap(([key, rowValue]) => {
              const values = Array.isArray(rowValue) ? rowValue : [rowValue];
              return values.map((item, valueIndex) => {
                const fieldLabel = Array.isArray(rowValue) ? `${key} ${valueIndex + 1}` : key;
                if (typeof item === 'boolean') {
                  return (
                    <label key={`${key}-${valueIndex}`} className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={item}
                        onChange={(e) => onChange(updateListRowValue(
                          rows,
                          i,
                          key,
                          e.target.checked,
                          Array.isArray(rowValue) ? valueIndex : undefined,
                        ))}
                      />
                      {fieldLabel}
                    </label>
                  );
                }
                return (
                  <div key={`${key}-${valueIndex}`}>
                    <Label className="sr-only" htmlFor={`${label}-${i}-${key}-${valueIndex}`}>{fieldLabel}</Label>
                    <Input
                      id={`${label}-${i}-${key}-${valueIndex}`}
                      type={typeof item === 'number' ? 'number' : 'text'}
                      value={String(item ?? '')}
                      placeholder={fieldLabel}
                      onChange={(e) => onChange(updateListRowValue(
                        rows,
                        i,
                        key,
                        typeof item === 'number' ? Number(e.target.value) : e.target.value,
                        Array.isArray(rowValue) ? valueIndex : undefined,
                      ))}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                );
              });
            })}
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))} title="Remove row">
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function NumField({
  label, value, onChange, step = 1, min, max,
}: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="h-8 text-xs"
      />
    </div>
  );
}

function ColorField({
  label, value, onChange, allowEmpty, template,
}: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean; template: ReportTemplate }) {
  const issues = validateBindable(value, template);
  return (
    <div>
      <EnhancedColorPicker
        label={label}
        value={value}
        onChange={onChange}
        template={template}
        allowEmpty={allowEmpty}
      />
      <BindingIssues issues={issues} />
    </div>
  );
}

/**
 * Reusable bindable text input with validation chip + autocomplete popover.
 */
function BindableField({
  label,
  value,
  onChange,
  template,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  template: ReportTemplate;
  multiline?: boolean;
}) {
  const issues = useMemo(() => validateBindable(value, template), [value, template]);
  const invalid = issues.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <BindingPicker template={template} onPick={(b) => onChange(`${value || ''}${b}`)} />
      </div>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={`font-mono text-xs ${invalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`text-xs ${invalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
        />
      )}
      <BindingIssues issues={issues} />
    </div>
  );
}

function BindingIssues({ issues }: { issues: BindingIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((i, idx) => (
        <li key={idx} className="text-[10px] text-destructive flex items-start gap-1">
          <AlertTriangle className="h-2.5 w-2.5 mt-[2px] flex-shrink-0" />
          <span className="font-mono">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

function BindingPicker({
  template,
  onPick,
}: {
  template: ReportTemplate;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => buildSuggestions(template), [template]);

  const groups = useMemo(() => {
    const g: Record<string, typeof suggestions> = {};
    for (const s of suggestions) (g[s.group] ||= []).push(s);
    return g;
  }, [suggestions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary inline-flex items-center gap-1"
          type="button"
        >
          <Sparkles className="h-2.5 w-2.5" /> Insert binding
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="end">
        <Command>
          <CommandInput placeholder="Search bindings…" className="h-9" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            {Object.entries(groups).map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((s) => (
                  <CommandItem
                    key={s.label}
                    value={`${s.group} ${s.label} ${s.detail ?? ''}`}
                    onSelect={() => {
                      onPick(s.insert);
                      setOpen(false);
                    }}
                    className="text-xs font-mono"
                  >
                    <span className="flex-1">{s.label}</span>
                    {s.detail && <span className="text-[10px] text-muted-foreground ml-2">{s.detail}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ImageWarning {
  level: 'warning' | 'info';
  message: string;
}

type ImageOverlay = Overlay & { src?: string; fit?: 'cover' | 'contain' | 'fill' };

function ImageUploadField({
  templateId,
  overlay,
  onPatch,
}: {
  templateId?: string;
  overlay: ImageOverlay;
  onPatch: (p: Partial<ImageOverlay>) => void;
}) {
  const overlayId = overlay.id;
  const currentSrc = String(overlay.src ?? '');
  const overlayWidthPt = overlay.width;
  const overlayHeightPt = overlay.height;
  const fit = overlay.fit ?? 'cover';

  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [warnings, setWarnings] = useState<ImageWarning[]>([]);
  const [imgDims, setImgDims] = useState<{ width: number; height: number } | null>(null);
  const [autoMatch, setAutoMatch] = useState<boolean>(() => {
    try { return localStorage.getItem('tb.autoMatchAspect') === '1'; } catch { return false; }
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';

  const toggleAutoMatch = (next: boolean) => {
    setAutoMatch(next);
    try { localStorage.setItem('tb.autoMatchAspect', next ? '1' : '0'); } catch { /* noop */ }
  };

  const hasImage = !!currentSrc && /^https?:\/\//i.test(currentSrc);

  // Load intrinsic dims of currentSrc for the live preview / fit ratio chips.
  useEffect(() => {
    if (!hasImage) { setImgDims(null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setImgDims({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { if (alive) setImgDims(null); };
    img.src = currentSrc;
    return () => { alive = false; };
  }, [currentSrc, hasImage]);

  /** Read intrinsic image dimensions client-side. */
  const readImageDims = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read image dimensions'));
      };
      img.src = url;
    });

  const checkDimensions = (px: { width: number; height: number }): ImageWarning[] => {
    const issues: ImageWarning[] = [];
    const minPxW = Math.round(overlayWidthPt);
    const minPxH = Math.round(overlayHeightPt);
    if (px.width < minPxW || px.height < minPxH) {
      issues.push({
        level: 'warning',
        message: `Image is ${px.width}×${px.height}px — smaller than the overlay (${minPxW}×${minPxH}pt) and will look blurry.`,
      });
    }
    const overlayRatio = overlayWidthPt / Math.max(overlayHeightPt, 1);
    const imageRatio = px.width / Math.max(px.height, 1);
    const drift = Math.abs(overlayRatio - imageRatio) / overlayRatio;
    if (drift > 0.15) {
      issues.push({
        level: 'warning',
        message: `Aspect ratio mismatch — image ${imageRatio.toFixed(2)}:1 vs overlay ${overlayRatio.toFixed(2)}:1.`,
      });
    }
    return issues;
  };

  /** Show an "Undo" sonner that restores the previous src. */
  const offerUndo = (prevSrc: string, label: string) => {
    if (!prevSrc) return;
    toast(label, {
      duration: 7000,
      action: {
        label: 'Undo',
        onClick: () => {
          onPatch({ src: prevSrc } as Partial<ImageOverlay>);
          toast.success('Image restored');
        },
      },
    });
  };

  const performUpload = async (file: File) => {
    const prevSrc = currentSrc;
    setBusy(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const folder = templateId ?? 'unassigned';
      const path = `${folder}/${overlayId}-${Date.now()}.${ext}`;
      const result = await secureStorageUpload('report-templates', path, file, {
        resourceId: templateId,
        contentType: file.type,
        upsert: true,
      });
      if (!result.success) {
        toast.error(`Upload failed: ${result.error ?? 'unknown error'}`);
        return;
      }
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/report-templates/${result.path ?? path}`;

      // Optionally compute fresh aspect ratio and apply it together with src.
      let nextPatch: Partial<ImageOverlay> = { src: publicUrl } as Partial<ImageOverlay>;
      if (autoMatch) {
        try {
          const dims = await readImageDims(file);
          const ratio = dims.width / Math.max(dims.height, 1);
          (nextPatch as any).height = Math.round((overlayWidthPt / ratio) * 100) / 100;
        } catch { /* ignore — keep current height */ }
      }
      onPatch(nextPatch);

      if (prevSrc && /^https?:\/\//i.test(prevSrc)) {
        offerUndo(prevSrc, autoMatch ? 'Image replaced & overlay resized' : 'Image replaced');
      } else {
        toast.success(autoMatch ? 'Image uploaded & overlay resized' : 'Image uploaded');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!supported.includes(file.type)) {
      toast.error('Unsupported format. Use PNG, JPEG, WEBP or GIF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5MB');
      return;
    }

    let dimWarnings: ImageWarning[] = [];
    try {
      const dims = await readImageDims(file);
      dimWarnings = checkDimensions(dims);
    } catch {
      dimWarnings = [{ level: 'warning', message: 'Could not read image dimensions.' }];
    }
    setWarnings(dimWarnings);

    if (hasImage) {
      setPendingFile(file);
      setConfirmReplaceOpen(true);
      return;
    }
    await performUpload(file);
  };

  const handleRemove = () => {
    const prevSrc = currentSrc;
    onPatch({ src: '' } as Partial<ImageOverlay>);
    setWarnings([]);
    offerUndo(prevSrc, 'Image removed');
  };

  const matchOverlayToImage = () => {
    if (!imgDims) return;
    const ratio = imgDims.width / Math.max(imgDims.height, 1);
    const nextHeight = Math.round((overlayWidthPt / ratio) * 100) / 100;
    onPatch({ height: nextHeight } as Partial<ImageOverlay>);
    toast.success(`Overlay resized to match image (${ratio.toFixed(2)}:1)`);
  };

  // ── Drag & drop handlers ────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  // Preview: render the overlay box at its true aspect, with the image positioned per fit.
  const overlayRatio = overlayWidthPt / Math.max(overlayHeightPt, 1);
  const imageRatio = imgDims ? imgDims.width / Math.max(imgDims.height, 1) : null;
  const ratioMismatch = imageRatio != null && Math.abs(imageRatio - overlayRatio) / overlayRatio > 0.02;
  const fitObjectClass =
    fit === 'cover' ? 'object-cover' : fit === 'contain' ? 'object-contain' : 'object-fill';
  const crop = (overlay as any).crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const hasCrop = crop.left || crop.right || crop.top || crop.bottom;
  const dimsLoading = hasImage && !imgDims;

  return (
    <div className="space-y-2">
      {hasImage && (
        <div className="space-y-1">
          <div
            className="relative rounded-md overflow-hidden border bg-[repeating-conic-gradient(theme(colors.muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]"
            style={{ aspectRatio: `${overlayRatio}` }}
          >
            {dimsLoading && (
              <div className="absolute inset-0 animate-pulse bg-muted/60" aria-hidden />
            )}
            <img
              src={currentSrc}
              alt="Overlay preview"
              className={`absolute inset-0 w-full h-full ${fitObjectClass} ${dimsLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`}
            />
            {hasCrop && !dimsLoading && (
              <>
                {/* Translucent strips show what manual crop will trim. */}
                <div className="absolute top-0 left-0 right-0 bg-destructive/40" style={{ height: `${crop.top}%` }} />
                <div className="absolute bottom-0 left-0 right-0 bg-destructive/40" style={{ height: `${crop.bottom}%` }} />
                <div className="absolute top-0 bottom-0 left-0 bg-destructive/40" style={{ width: `${crop.left}%` }} />
                <div className="absolute top-0 bottom-0 right-0 bg-destructive/40" style={{ width: `${crop.right}%` }} />
              </>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {dimsLoading ? 'Loading dimensions…' : imgDims ? `${imgDims.width}×${imgDims.height}px` : '—'} ·
              overlay {Math.round(overlayWidthPt)}×{Math.round(overlayHeightPt)}pt · fit: {fit}
            </span>
            {ratioMismatch && (
              <button
                type="button"
                onClick={matchOverlayToImage}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                title="Resize overlay height to match image aspect"
              >
                <Maximize2 className="h-2.5 w-2.5" /> Match aspect
              </button>
            )}
          </div>
          {ratioMismatch && (
            <p className="text-[10px] text-muted-foreground">
              {fit === 'cover' && 'Cover will crop the image to fill the overlay.'}
              {fit === 'contain' && 'Contain will letterbox the image inside the overlay.'}
              {fit === 'fill' && 'Fill will stretch the image to the overlay box.'}
            </p>
          )}
        </div>
      )}

      {/* Drag-and-drop zone + click-to-upload */}
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={`border-2 border-dashed rounded-md p-3 text-center cursor-pointer transition-colors ${
          dragActive
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border hover:border-primary/50 hover:bg-muted/30 text-muted-foreground'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = '';
          }}
        />
        {busy ? (
          <span className="text-xs inline-flex items-center gap-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
          </span>
        ) : (
          <span className="text-xs inline-flex items-center gap-1">
            <Upload className="h-3.5 w-3.5" />
            {hasImage ? 'Drop to replace, or click' : 'Drop image, or click to upload'}
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoMatch}
          onChange={(e) => toggleAutoMatch(e.target.checked)}
          className="h-3 w-3 accent-primary"
        />
        Auto-match overlay aspect to image on upload
      </label>

      {warnings.length > 0 && (
        <ul className="space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i} className="text-[10px] text-warning flex items-start gap-1">
              <AlertTriangle className="h-2.5 w-2.5 mt-[2px] flex-shrink-0" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      {hasImage && (
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-xs text-destructive hover:bg-destructive/10"
          onClick={() => setConfirmRemoveOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove image
        </Button>
      )}

      {/* Remove confirmation */}
      <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove image?</AlertDialogTitle>
            <AlertDialogDescription>
              The overlay's image source will be cleared. You can undo this from the toast for a few seconds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmRemoveOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmRemoveOpen(false); handleRemove(); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Replace confirmation */}
      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current image?</AlertDialogTitle>
            <AlertDialogDescription>
              The existing image will be overwritten by <strong>{pendingFile?.name ?? 'the new file'}</strong>.
              You'll be able to undo from the toast for a few seconds.
              {warnings.length > 0 && (
                <span className="block mt-2 text-warning">
                  Heads up: {warnings.length} warning{warnings.length === 1 ? '' : 's'} on the new image.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setConfirmReplaceOpen(false); setPendingFile(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const f = pendingFile;
                setConfirmReplaceOpen(false);
                setPendingFile(null);
                if (f) await performUpload(f);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Crop controls ───────────────────────────────────────────────────────────
type CropValue = { left: number; right: number; top: number; bottom: number };

function CropControls({
  crop,
  onChange,
}: {
  crop: CropValue | undefined;
  onChange: (next: CropValue | undefined) => void;
}) {
  const c: CropValue = crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const total = c.left + c.right + c.top + c.bottom;
  const set = (k: keyof CropValue, v: number) => {
    const clamped = Math.max(0, Math.min(95, Number.isFinite(v) ? v : 0));
    const next = { ...c, [k]: clamped };
    // Guard against opposite edges summing >= 100% (would zero the visible area).
    if (next.left + next.right >= 100) next[k === 'left' ? 'right' : k === 'right' ? 'left' : k] = c[k === 'left' ? 'right' : 'left'];
    if (next.top + next.bottom >= 100) next[k === 'top' ? 'bottom' : k === 'bottom' ? 'top' : k] = c[k === 'top' ? 'bottom' : 'top'];
    onChange(next);
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Manual crop (%)</Label>
        {total > 0 && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[10px] text-muted-foreground hover:text-destructive"
          >
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CropField label="Left" value={c.left} onChange={(v) => set('left', v)} />
        <CropField label="Right" value={c.right} onChange={(v) => set('right', v)} />
        <CropField label="Top" value={c.top} onChange={(v) => set('top', v)} />
        <CropField label="Bottom" value={c.bottom} onChange={(v) => set('bottom', v)} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Trims the source image from each edge. Red strips in the preview show what is removed.
      </p>
    </div>
  );
}

function CropField({
  label,
  value,
  onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        max={95}
        step={1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-8 text-xs"
      />
    </div>
  );
}

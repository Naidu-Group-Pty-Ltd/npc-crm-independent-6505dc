/**
 * OutlinePanel — Phase 2 tree view of the entire template:
 *   Template
 *     └ Pages
 *         └ Blocks
 *             └ Overlays
 *
 * Click any node to select. Pages and blocks support reorder via the
 * existing onMovePage / onMoveBlock callbacks (used by PagesPanel too).
 * Lightweight by design — no virtualisation, fine for ~100 pages.
 *
 * Also provides "saved selections": name a set of overlay ids on a page
 * and recall it later (e.g. "all KPI badges", "all CTAs"). Persisted on
 * template.savedSelections.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronRight, ChevronDown, FileText, Square, Type, ImageIcon, Save, Layers, Bookmark } from 'lucide-react';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';
import { templateEditorActions, useEditorTemplate, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { toast } from 'sonner';

// Template, selection, and mutators come straight from templateEditorStore
// (slice subscriptions, rehaul Phase 2) — the panel takes no props.
export function OutlinePanel() {
  const template = useEditorTemplate();
  const activePageId = useTemplateEditorStore((s) => s.activePageId);
  const selectedBlockId = useTemplateEditorStore((s) => s.selectedBlockId);
  const selectedOverlayId = useTemplateEditorStore((s) => s.selectedOverlayId);
  const multiOverlayIds = useTemplateEditorStore((s) => s.multiOverlayIds);
  const {
    selectPage: onSelectPage,
    selectBlockClearOverlay: onSelectBlock,
    setSelectedOverlayId,
    setSelectedBlockId,
    setTemplate: onChangeTemplate,
    toggleMultiOverlay: onToggleMultiOverlay,
  } = templateEditorActions();
  const onSelectOverlay = (overlayId: string | null) => {
    setSelectedOverlayId(overlayId);
    if (overlayId) setSelectedBlockId(null);
  };

  const [openPages, setOpenPages] = useState<Set<string>>(new Set([activePageId ?? '']));
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [newSelName, setNewSelName] = useState('');

  const togglePage = (id: string) => {
    const next = new Set(openPages);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpenPages(next);
  };
  const toggleBlock = (id: string) => {
    const next = new Set(openBlocks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpenBlocks(next);
  };

  const saved = template.savedSelections ?? {};
  const saveSelection = () => {
    if (!newSelName.trim() || !selectedOverlayId) {
      toast('Select an overlay and name the selection first');
      return;
    }
    onChangeTemplate({
      ...template,
      savedSelections: { ...saved, [newSelName.trim()]: [selectedOverlayId] },
    });
    setNewSelName('');
    toast.success(`Saved selection "${newSelName.trim()}"`);
  };
  const recall = (name: string) => {
    const ids = saved[name];
    if (!ids?.length) return;
    onSelectOverlay(ids[0]);
    toast.success(`Recalled "${name}"`);
  };
  const removeSelection = (name: string) => {
    const next = { ...saved };
    delete next[name];
    onChangeTemplate({ ...template, savedSelections: next });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center gap-2 text-xs">
        <Layers className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Outline</span>
        <span className="text-muted-foreground ml-auto">{template.pages.length} pages</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1 text-xs">
          {template.pages.map((p, pi) => {
            const isOpen = openPages.has(p.id);
            const isActivePage = p.id === activePageId;
            return (
              <div key={p.id}>
                <button
                  className={`w-full flex items-center gap-1 px-1.5 py-1 rounded hover:bg-muted/50 ${
                    isActivePage ? 'bg-primary/10 text-primary' : ''
                  }`}
                  onClick={() => { onSelectPage(p.id); togglePage(p.id); }}
                >
                  {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <FileText className="h-3 w-3" />
                  <span className="truncate">{pi + 1}. {p.name}</span>
                  {p.master && <span className="ml-auto text-[9px] bg-muted px-1 rounded">M</span>}
                </button>
                {isOpen && (
                  <div className="ml-4 border-l border-border pl-1">
                    {p.blocks.map((b, bi) => {
                      const bo = openBlocks.has(b.id);
                      const isActiveBlock = selectedBlockId === b.id;
                      return (
                        <div key={b.id}>
                          <button
                            className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/50 ${
                              isActiveBlock ? 'bg-primary/10 text-primary' : ''
                            }`}
                            onClick={() => {
                              if (!isActivePage) onSelectPage(p.id);
                              onSelectBlock(b.id);
                              toggleBlock(b.id);
                            }}
                          >
                            {bo ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <Square className="h-3 w-3" />
                            <span className="truncate">{bi + 1}. {b.type}</span>
                            {b.overlays.length > 0 && (
                              <span className="ml-auto text-[9px] text-muted-foreground">{b.overlays.length}</span>
                            )}
                          </button>
                          {bo && b.overlays.length > 0 && (
                            <div className="ml-4 border-l border-border pl-1">
                              {b.overlays.map((o) => (
                                <OverlayRow
                                  key={o.id}
                                  overlay={o}
                                  active={selectedOverlayId === o.id}
                                  multiActive={!!multiOverlayIds?.has(o.id)}
                                  onClick={(e) => {
                                    if (!isActivePage) onSelectPage(p.id);
                                    if ((e.shiftKey || e.metaKey || e.ctrlKey) && onToggleMultiOverlay) {
                                      onToggleMultiOverlay(o.id);
                                    } else {
                                      onSelectOverlay(o.id);
                                    }
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Saved selections */}
      <div className="border-t p-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Bookmark className="h-3 w-3" /> Saved selections
        </div>
        <div className="flex gap-1">
          <Input
            className="h-7 text-xs"
            placeholder="Name…"
            value={newSelName}
            onChange={(e) => setNewSelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveSelection(); }}
          />
          <Button size="sm" variant="outline" onClick={saveSelection}>
            <Save className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(saved).length === 0 ? (
            <span className="text-[10px] text-muted-foreground">Pick an overlay, name it, ⏎ to bookmark.</span>
          ) : (
            Object.keys(saved).map((n) => (
              <button
                key={n}
                className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/70 group"
                onClick={() => recall(n)}
                onContextMenu={(e) => { e.preventDefault(); removeSelection(n); }}
                title="Click to recall · Right-click to delete"
              >
                {n}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function OverlayRow({ overlay, active, multiActive, onClick }: { overlay: Overlay; active: boolean; multiActive?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const Icon = overlay.type === 'text' ? Type : overlay.type === 'image' ? ImageIcon : Square;
  const label = overlay.type === 'text' ? (overlay as any).content?.slice(0, 24) ?? 'Text' : overlay.type;
  return (
    <button
      className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/50 ${
        active ? 'bg-primary/10 text-primary' : multiActive ? 'bg-accent/30 ring-1 ring-primary/30' : ''
      }`}
      onClick={onClick}
      title="Shift/Cmd-click to multi-select"
    >
      <Icon className="h-3 w-3 ml-3" />
      <span className="truncate">{label}</span>
      {multiActive && <span className="ml-auto text-[9px] text-primary">●</span>}
    </button>
  );
}

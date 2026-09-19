/**
 * LayersPanel — InDesign/Figma-style overlay stack for the active page.
 *
 * Lists overlays of the active page (top-to-bottom = front-to-back), grouped
 * by their parent block. Supports:
 *   • lock / hide toggle
 *   • rename (double-click)
 *   • drag to reorder z-index within the same block
 *   • multi-select via ctrl/shift click
 *   • group / ungroup (when ≥2 selected & sharing a block)
 *
 * Pure UI — schema mutations go through the supplied callbacks.
 */
import { useMemo, useState } from 'react';
import {
  Eye, EyeOff, Lock, Unlock, Type, Image as ImageIcon, Square,
  GripVertical, Group as GroupIcon, Ungroup, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Page, Overlay } from '@/lib/reportTemplate/templateSchema';

interface Props {
  page: Page;
  selectedOverlayId: string | null;
  multiOverlayIds: Set<string>;
  onSelectOverlay: (id: string | null, additive?: boolean) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onToggleHidden: (id: string, hidden: boolean) => void;
  onRename: (id: string, name: string) => void;
  onReorderZ: (id: string, op: 'forward' | 'backward' | 'front' | 'back') => void;
  onGroup: (ids: string[]) => void;
  onUngroup: (ids: string[]) => void;
}

const ICONS: Record<string, typeof Type> = { text: Type, image: ImageIcon, shape: Square };

function overlayLabel(o: Overlay): string {
  const anyO = o as any;
  if (anyO.name) return anyO.name;
  if (anyO.type === 'text') return String(anyO.content ?? 'Text').slice(0, 32) || 'Text';
  if (anyO.type === 'image') return 'Image';
  if (anyO.type === 'shape') return `Shape · ${anyO.shape ?? 'rect'}`;
  return anyO.type;
}

export function LayersPanel({
  page, selectedOverlayId, multiOverlayIds,
  onSelectOverlay, onToggleLock, onToggleHidden, onRename, onReorderZ,
  onGroup, onUngroup,
}: Props) {
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const selectedIds = useMemo(() => {
    const s = new Set(multiOverlayIds);
    if (selectedOverlayId) s.add(selectedOverlayId);
    return s;
  }, [multiOverlayIds, selectedOverlayId]);

  const anyGrouped = useMemo(
    () => page.blocks.some((b) => b.overlays.some((o) => selectedIds.has(o.id) && o.groupId)),
    [page, selectedIds],
  );

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2 flex items-center justify-between border-b">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Layers
        </h3>
        <div className="flex items-center gap-1">
          <Button
            size="icon" variant="ghost" className="h-6 w-6"
            title="Group selected (⌘G)"
            disabled={selectedIds.size < 2}
            onClick={() => onGroup(Array.from(selectedIds))}
          >
            <GroupIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon" variant="ghost" className="h-6 w-6"
            title="Ungroup selected"
            disabled={!anyGrouped}
            onClick={() => onUngroup(Array.from(selectedIds))}
          >
            <Ungroup className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {page.blocks.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-6 italic">
              No blocks on this page
            </p>
          )}

          {page.blocks.map((b) => {
            const isCollapsed = collapsedBlocks.has(b.id);
            // render top-to-bottom = front-to-back (reverse of array order)
            const overlays = [...b.overlays].reverse();
            return (
              <div key={b.id} className="rounded-md border bg-muted/20">
                <button
                  type="button"
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-mono hover:bg-muted/50"
                  onClick={() => setCollapsedBlocks((p) => {
                    const n = new Set(p); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n;
                  })}
                >
                  {isCollapsed
                    ? <ChevronRight className="h-3 w-3" />
                    : <ChevronDown className="h-3 w-3" />}
                  <span className="flex-1 truncate text-left">{b.type}</span>
                  <span className="text-[10px] text-muted-foreground">{overlays.length}</span>
                </button>

                {!isCollapsed && (
                  <div className="px-1 pb-1 space-y-0.5">
                    {overlays.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-2 italic">
                        No overlays
                      </p>
                    )}
                    {overlays.map((o) => {
                      const Icon = ICONS[o.type] ?? Square;
                      const isSel = selectedIds.has(o.id);
                      const isHidden = !!o.hidden;
                      const isLocked = !!o.locked;
                      return (
                        <div
                          key={o.id}
                          draggable
                          onDragStart={(e) => {
                            setDragId(o.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => {
                            if (dragId && dragId !== o.id) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!dragId || dragId === o.id) return;
                            // determine which way: if dragging downward in UI -> backward; up -> forward
                            const fromIdx = overlays.findIndex((x) => x.id === dragId);
                            const toIdx = overlays.findIndex((x) => x.id === o.id);
                            if (fromIdx < 0 || toIdx < 0) return;
                            // overlays list is reversed; visual up = z forward
                            const op = toIdx < fromIdx ? 'forward' : 'backward';
                            const steps = Math.abs(toIdx - fromIdx);
                            // chain steps sequentially
                            for (let i = 0; i < steps; i++) onReorderZ(dragId, op);
                            setDragId(null);
                          }}
                          onDragEnd={() => setDragId(null)}
                          className={cn(
                            'group flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] cursor-pointer transition-colors',
                            isSel ? 'bg-primary/15 text-primary' : 'hover:bg-muted',
                            isHidden && 'opacity-50',
                          )}
                          onClick={(e) => onSelectOverlay(o.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                        >
                          <GripVertical className="h-3 w-3 text-muted-foreground cursor-grab active:cursor-grabbing" />
                          <Icon className="h-3 w-3" />
                          {renaming === o.id ? (
                            <Input
                              autoFocus
                              value={renameVal}
                              onChange={(e) => setRenameVal(e.target.value)}
                              onBlur={() => { onRename(o.id, renameVal); setRenaming(null); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { onRename(o.id, renameVal); setRenaming(null); }
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              className="h-6 text-[11px] px-1 py-0.5 flex-1"
                            />
                          ) : (
                            <span
                              className="flex-1 truncate"
                              onDoubleClick={() => { setRenameVal(o.name ?? overlayLabel(o)); setRenaming(o.id); }}
                              title="Double-click to rename"
                            >
                              {overlayLabel(o)}
                            </span>
                          )}
                          {o.groupId && (
                            <span
                              className="text-[8px] uppercase tracking-wider text-primary/70 font-mono"
                              title={`Group ${o.groupId}`}
                            >G</span>
                          )}
                          {typeof (o as any).confidence === 'number' && (o as any).confidence < 0.9 && (
                            <span
                              className={`text-[9px] font-semibold tabular-nums px-1 rounded ${(o as any).confidence < 0.5 ? 'bg-destructive/15 text-destructive' : 'bg-brand-500/15 text-brand-600'}`}
                              title={`Import extraction confidence: ${Math.round((o as any).confidence * 100)}%${(o as any).confidence < 0.5 ? ' — locked by default; unlock to edit' : ''}`}
                            >
                              {Math.round((o as any).confidence * 100)}%
                            </span>
                          )}
                          <button
                            type="button"
                            className="opacity-60 hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); onToggleHidden(o.id, !isHidden); }}
                            title={isHidden ? 'Show' : 'Hide'}
                          >
                            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                          <button
                            type="button"
                            className="opacity-60 hover:opacity-100"
                            onClick={(e) => { e.stopPropagation(); onToggleLock(o.id, !isLocked); }}
                            title={isLocked ? 'Unlock' : 'Lock'}
                          >
                            {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                          </button>
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
    </div>
  );
}

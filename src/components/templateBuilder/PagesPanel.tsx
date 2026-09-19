/**
 * PagesPanel — left rail. Shows pages (selectable, add/duplicate/delete) and
 * a block library to insert known blocks onto the active page.
 */
import {
  Plus, Copy, Trash2, FileText, Layers, Quote, Image as ImageIcon, Square, Type,
  LayoutTemplate, BarChart3, Table as TableIcon, Heading, AlignJustify, Minus,
  Hash, Columns2, MessageSquare, Images, ArrowUp, ArrowDown, QrCode, Tag, ListOrdered,
  PenLine, Space, GripVertical,
  Gauge, ShieldAlert, Milestone, Grid3x3, ClipboardList, CheckSquare, Lightbulb, ThumbsUp,
  Search, Star, Sparkles, Box, MousePointer2, Database,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { Block, Overlay, Page } from '@/lib/reportTemplate/templateSchema';
import { BLOCK_DEFS } from '@/lib/reportTemplate/blocks';
import { serializePaletteDrag, PALETTE_DRAG_MIME } from '@/lib/reportTemplate/overlayDropFactory';
import { templateEditorActions, useEditorPages, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { cn } from '@/lib/utils';

interface CommentAnchor {
  id: string;
  pageId?: string | null;
  blockId?: string | null;
  overlayId?: string | null;
  resolved?: boolean;
}

// Pages, selection, and all mutators come straight from templateEditorStore
// (slice subscriptions, rehaul Phase 2) — only editor-agnostic inputs remain
// as props.
interface Props {
  /** V2: make overlay palette items draggable onto the canvas (drop-to-place). */
  enableCanvasDrag?: boolean;
  commentAnchors?: CommentAnchor[];
}

type PaletteCategory = 'Core' | 'Data' | 'Media' | 'Layout' | 'Compass' | 'Overlays';
type PaletteItem = {
  label: string;
  icon: typeof Type;
  category: PaletteCategory;
  keywords?: string[];
  build: () => Block | { kind: 'overlay'; overlay: Overlay };
};

function blockFromDef(type: string): Block {
  const def = BLOCK_DEFS[type];
  return {
    id: crypto.randomUUID(),
    type,
    props: def ? def.defaultProps() : {},
    overlays: [],
  };
}

/** Components that need report data wired to render meaningfully (Phase 2). */
function dataHintForItem(item: PaletteItem): string | null {
  switch (item.category) {
    case 'Data': return 'Binds to report data — wire metrics / table / chart values in the inspector';
    case 'Compass': return 'Binds to Compass report data';
    case 'Media': return 'Binds to images / links from report data';
    default: return null;
  }
}

const PALETTE: PaletteItem[] = [
  { label: 'Cover', icon: LayoutTemplate, category: 'Core', keywords: ['front page', 'title'], build: () => blockFromDef('cover') },
  { label: 'Hero', icon: Heading, category: 'Core', keywords: ['heading', 'title'], build: () => blockFromDef('hero') },
  { label: 'KPI grid', icon: Layers, category: 'Data', keywords: ['metrics', 'numbers'], build: () => blockFromDef('kpi-grid') },
  { label: 'Data table', icon: TableIcon, category: 'Data', keywords: ['table', 'grid'], build: () => blockFromDef('data-table') },
  { label: 'Chart', icon: BarChart3, category: 'Data', keywords: ['graph'], build: () => blockFromDef('chart') },
  { label: 'Image block', icon: ImageIcon, category: 'Media', keywords: ['photo', 'picture'], build: () => blockFromDef('image') },
  { label: 'Text block', icon: AlignJustify, category: 'Core', keywords: ['copy', 'paragraph'], build: () => blockFromDef('text-block') },
  { label: 'Footer', icon: Minus, category: 'Layout', keywords: ['bottom'], build: () => blockFromDef('footer') },
  { label: 'Disclaimer', icon: Quote, category: 'Core', keywords: ['legal'], build: () => blockFromDef('disclaimer') },
  { label: 'Divider', icon: Minus, category: 'Layout', keywords: ['line'], build: () => blockFromDef('divider') },
  { label: 'Callout', icon: MessageSquare, category: 'Core', keywords: ['note', 'highlight'], build: () => blockFromDef('callout') },
  { label: 'Two-column', icon: Columns2, category: 'Layout', keywords: ['columns'], build: () => blockFromDef('two-column') },
  { label: 'Gallery', icon: Images, category: 'Media', keywords: ['photos'], build: () => blockFromDef('gallery') },
  { label: 'Page number', icon: Hash, category: 'Layout', keywords: ['pagination'], build: () => blockFromDef('page-number') },
  { label: 'Spacer', icon: Space, category: 'Layout', keywords: ['gap', 'blank'], build: () => blockFromDef('spacer') },
  { label: 'QR code', icon: QrCode, category: 'Media', keywords: ['link'], build: () => blockFromDef('qr') },
  { label: 'Badge list', icon: Tag, category: 'Core', keywords: ['tags', 'chips'], build: () => blockFromDef('badge-list') },
  { label: 'Contents', icon: ListOrdered, category: 'Layout', keywords: ['toc'], build: () => blockFromDef('toc') },
  { label: 'Signature', icon: PenLine, category: 'Core', keywords: ['sign'], build: () => blockFromDef('signature') },
  { label: 'Free / overlays', icon: Layers, category: 'Overlays', keywords: ['blank'], build: () => blockFromDef('free') },
  // ─── Compass-40 visual components (Phase 4) ───
  { label: 'Macro Scorecard',         icon: Gauge,         category: 'Compass', keywords: ['score'], build: () => blockFromDef('scorecard') },
  { label: 'Strengths & Watch',       icon: ThumbsUp,      category: 'Compass', keywords: ['watchlist'], build: () => blockFromDef('strengths-watch') },
  { label: 'Risk Register',           icon: ShieldAlert,   category: 'Compass', keywords: ['risk'], build: () => blockFromDef('risk-register') },
  { label: 'Infra Timeline',          icon: Milestone,     category: 'Compass', keywords: ['timeline', 'infrastructure'], build: () => blockFromDef('infra-timeline') },
  { label: 'Amenity Matrix',          icon: Grid3x3,       category: 'Compass', keywords: ['amenities'], build: () => blockFromDef('amenity-matrix') },
  { label: 'Planning Action Table',   icon: ClipboardList, category: 'Compass', keywords: ['planning'], build: () => blockFromDef('planning-table') },
  { label: 'DD Checklist',            icon: CheckSquare,   category: 'Compass', keywords: ['due diligence'], build: () => blockFromDef('dd-checklist') },
  { label: 'Decision Box',            icon: Lightbulb,     category: 'Compass', keywords: ['recommendation'], build: () => blockFromDef('decision-box') },
  {
    label: 'Text overlay',
    icon: Type,
    category: 'Overlays',
    keywords: ['text', 'label'],
    build: () => ({
      kind: 'overlay',
      overlay: {
        id: crypto.randomUUID(),
        type: 'text',
        x: 60, y: 60, width: 300, height: 40, rotation: 0, opacity: 1,
        content: 'New text',
        fontFamily: 'Helvetica',
        fontSize: 18,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#000000',
        align: 'left',
        lineHeight: 1.3,
        letterSpacing: 0,
      } as Overlay,
    }),
  },
  {
    label: 'Rectangle',
    icon: Square,
    category: 'Overlays',
    keywords: ['shape', 'box'],
    build: () => ({
      kind: 'overlay',
      overlay: {
        id: crypto.randomUUID(),
        type: 'shape',
        shape: 'rect',
        x: 60, y: 120, width: 200, height: 120, rotation: 0, opacity: 1,
        fill: 'token:primary',
        strokeWidth: 0,
        borderRadius: 6,
      } as Overlay,
    }),
  },
  {
    label: 'Image overlay',
    icon: ImageIcon,
    category: 'Overlays',
    keywords: ['photo', 'floating'],
    build: () => ({
      kind: 'overlay',
      overlay: {
        id: crypto.randomUUID(),
        type: 'image',
        x: 60, y: 260, width: 200, height: 140, rotation: 0, opacity: 1,
        src: '{{property.imageUrl}}',
        fit: 'cover',
      } as Overlay,
    }),
  },
  {
    label: 'Table overlay',
    icon: TableIcon,
    category: 'Overlays',
    keywords: ['table', 'rows', 'cells', 'grid'],
    build: () => ({
      kind: 'overlay',
      overlay: {
        id: crypto.randomUUID(),
        type: 'table',
        x: 60, y: 320, width: 460, height: 180, rotation: 0, opacity: 1,
        columns: [
          { key: 'col1', label: 'Column A', align: 'left' },
          { key: 'col2', label: 'Column B', align: 'right' },
        ],
        rows: [['Sample row', '0'], ['Another row', '0']],
        showHeader: true,
        headerHeight: 22,
        rowHeight: 20,
        fontSize: 10,
        headerBg: 'token:primary',
        headerColor: '#FFFFFF',
        headerFontWeight: 'bold',
        rowBg: '#FFFFFF',
        altRowBg: '#F6F6F6',
        rowColor: '#111111',
        borderColor: '#DDDDDD',
        borderWidth: 0.5,
        cellPadding: 6,
      } as any,
    }),
  },
  {
    label: 'Text on path',
    icon: PenLine,
    category: 'Overlays',
    keywords: ['curve', 'arc', 'wave', 'circle', 'svg'],
    build: () => ({
      kind: 'overlay',
      overlay: {
        id: crypto.randomUUID(),
        type: 'textOnPath',
        x: 60, y: 520, width: 380, height: 120, rotation: 0, opacity: 1,
        content: 'Curved headline',
        fontFamily: 'Helvetica',
        fontSize: 28,
        fontWeight: 'bold',
        color: 'token:primary',
        curve: 'arc-up',
        curvature: 0.55,
        letterSpacing: 0,
        startOffset: 0,
      } as any,
    }),
  },
];


const CATEGORY_OPTIONS: Array<'All' | 'Recent' | 'Favorites' | PaletteCategory> = [
  'All',
  'Recent',
  'Favorites',
  'Core',
  'Data',
  'Media',
  'Layout',
  'Compass',
  'Overlays',
];

const categoryIcon = (category: PaletteCategory) => {
  if (category === 'Data') return BarChart3;
  if (category === 'Media') return Images;
  if (category === 'Layout') return LayoutTemplate;
  if (category === 'Compass') return Sparkles;
  if (category === 'Overlays') return MousePointer2;
  return Box;
};

function PagesPanelImpl({
  enableCanvasDrag = false,
  commentAnchors = [],
}: Props) {
  // Slice subscriptions: this panel only re-renders when the pages array or
  // the page/block selection changes — token edits, dialog state, presence,
  // save status, etc. never touch it.
  const pages = useEditorPages();
  const activePageId = useTemplateEditorStore((s) => s.activePageId);
  const selectedBlockId = useTemplateEditorStore((s) => s.selectedBlockId);
  const {
    selectPage: onSelectPage,
    addPage: onAddPage,
    duplicatePage: onDuplicatePage,
    deletePage: onDeletePage,
    movePage: onMovePage,
    addBlockToActivePage: onAddBlock,
    addOverlayToActivePage: onAddOverlay,
    selectBlockClearOverlay: onSelectBlock,
    reorderBlocks: onReorderBlocks,
  } = templateEditorActions();
  const activePage = pages.find((p) => p.id === activePageId) || null;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [insertSearch, setInsertSearch] = useState('');
  const [insertCategory, setInsertCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>('All');
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(['Hero', 'Text overlay', 'Image block']));
  const [recent, setRecent] = useState<string[]>([]);
  const pageCommentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    commentAnchors.forEach((anchor) => {
      if (anchor.resolved || !anchor.pageId || anchor.blockId || anchor.overlayId) return;
      counts.set(anchor.pageId, (counts.get(anchor.pageId) ?? 0) + 1);
    });
    return counts;
  }, [commentAnchors]);
  const blockCommentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    commentAnchors.forEach((anchor) => {
      if (anchor.resolved || !anchor.blockId || anchor.overlayId) return;
      counts.set(anchor.blockId, (counts.get(anchor.blockId) ?? 0) + 1);
    });
    return counts;
  }, [commentAnchors]);

  const insertItems = useMemo(() => {
    const query = insertSearch.trim().toLowerCase();
    return PALETTE.filter((item) => {
      if (insertCategory === 'Recent' && !recent.includes(item.label)) return false;
      if (insertCategory === 'Favorites' && !favorites.has(item.label)) return false;
      if (!['All', 'Recent', 'Favorites'].includes(String(insertCategory)) && item.category !== insertCategory) return false;
      if (!query) return true;
      const haystack = [item.label, item.category, ...(item.keywords ?? [])].join(' ').toLowerCase();
      return haystack.includes(query);
    }).sort((a, b) => {
      if (insertCategory === 'Recent') return recent.indexOf(a.label) - recent.indexOf(b.label);
      return a.label.localeCompare(b.label);
    });
  }, [favorites, insertCategory, insertSearch, recent]);

  const insertPaletteItem = (item: PaletteItem) => {
    const built = item.build();
    if ('kind' in built && built.kind === 'overlay') {
      onAddOverlay(built.overlay);
    } else {
      onAddBlock(built as Block);
    }
    setRecent((prev) => [item.label, ...prev.filter((label) => label !== item.label)].slice(0, 8));
  };

  const toggleFavorite = (label: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };
  return (
    <div className="flex flex-col h-full border-r bg-muted/20">
      {/* Pages */}
      <div className="p-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pages</h3>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onAddPage} title="Add page">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 max-h-[40%]">
        <div className="px-2 pb-2 space-y-1">
          {pages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No pages yet</p>
          )}
          {pages.map((page, i) => (
            <button
              key={page.id}
              onClick={() => onSelectPage(page.id)}
              className={cn(
                'w-full text-left rounded-md px-2 py-2 text-xs flex items-center gap-2 group transition-colors',
                activePageId === page.id
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'hover:bg-muted',
              )}
            >
              <FileText className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1 truncate">
                {i + 1}. {page.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {page.blocks.reduce((acc, b) => acc + b.overlays.length, 0)}
              </span>
              {(pageCommentCounts.get(page.id) ?? 0) > 0 && (
                <span className="rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-medium text-brand-700" title="Unresolved page comments">
                  {pageCommentCounts.get(page.id)}
                </span>
              )}
              {onMovePage && i > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); onMovePage(page.id, -1); }}
                  className="opacity-0 group-hover:opacity-100 hover:text-foreground"
                  title="Move up"
                >
                  <ArrowUp className="h-3 w-3" />
                </span>
              )}
              {onMovePage && i < pages.length - 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); onMovePage(page.id, 1); }}
                  className="opacity-0 group-hover:opacity-100 hover:text-foreground"
                  title="Move down"
                >
                  <ArrowDown className="h-3 w-3" />
                </span>
              )}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicatePage(page.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-foreground"
                title="Duplicate"
              >
                <Copy className="h-3 w-3" />
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete page "${page.name}"?`)) onDeletePage(page.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      {/* Blocks on active page (drag to reorder) */}
      {activePage && (
        <>
          <div className="p-3 pb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Blocks ({activePage.blocks.length})
            </h3>
            <span className="text-[10px] text-muted-foreground">drag to reorder</span>
          </div>
          <ScrollArea className="max-h-[28%]">
            <div className="px-2 pb-2 space-y-0.5">
              {activePage.blocks.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-2 italic">No blocks yet</p>
              )}
              {activePage.blocks.map((b, i) => {
                const isSel = selectedBlockId === b.id;
                const isDragging = dragIndex === i;
                const isDropTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
                return (
                  <div
                    key={b.id}
                    draggable={!!onReorderBlocks}
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                      try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* noop */ }
                    }}
                    onDragOver={(e) => {
                      if (dragIndex === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropIndex !== i) setDropIndex(i);
                    }}
                    onDragLeave={() => { if (dropIndex === i) setDropIndex(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== i && onReorderBlocks) {
                        onReorderBlocks(dragIndex, i);
                      }
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                    onClick={() => onSelectBlock?.(b.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors',
                      isSel
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'hover:bg-muted border border-transparent',
                      isDragging && 'opacity-40',
                      isDropTarget && 'border-primary border-dashed',
                    )}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground flex-shrink-0 cursor-grab active:cursor-grabbing" />
                    <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                    <span className="flex-1 truncate font-mono">{b.type}</span>
                    {b.overlays.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{b.overlays.length}</span>
                    )}
                    {(blockCommentCounts.get(b.id) ?? 0) > 0 && (
                      <span className="rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-medium text-brand-700" title="Unresolved block comments">
                        {blockCommentCounts.get(b.id)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <Separator />
        </>
      )}

      {/* Block library */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Insert
          </h3>
          <span className="text-[10px] text-muted-foreground">{insertItems.length} shown</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={insertSearch}
            onChange={(event) => setInsertSearch(event.target.value)}
            placeholder="Search blocks…"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORY_OPTIONS.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setInsertCategory(category)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                insertCategory === category
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 pb-3 grid grid-cols-2 gap-2">
          {insertItems.length === 0 && (
            <div className="col-span-2 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              No insert items match your filters.
            </div>
          )}
          {insertItems.map((item) => {
            const Icon = item.icon;
            const CategoryIcon = categoryIcon(item.category);
            const favorite = favorites.has(item.label);
            const dataHint = dataHintForItem(item);
            return (
              <div key={item.label} className="relative group">
                <button
                  type="button"
                  draggable={enableCanvasDrag}
                  onDragStart={enableCanvasDrag ? (e) => {
                    e.dataTransfer.setData(PALETTE_DRAG_MIME, serializePaletteDrag(item.build()));
                    e.dataTransfer.effectAllowed = 'copy';
                  } : undefined}
                  onClick={() => insertPaletteItem(item)}
                  className="flex min-h-[86px] w-full flex-col items-center gap-1.5 rounded-md border bg-card hover:border-primary/50 hover:bg-muted/40 transition-colors p-3 text-xs"
                  title={`${enableCanvasDrag
                    ? `${item.label} — click to insert, or drag onto the canvas`
                    : `${item.category} · ${item.keywords?.join(', ') ?? item.label}`}${dataHint ? `\n${dataHint}` : ''}`}
                >
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="leading-tight text-center">{item.label}</span>
                  <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                    <CategoryIcon className="h-2.5 w-2.5" /> {item.category}
                  </span>
                  {dataHint && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-brand-600/90" title={dataHint}>
                      <Database className="h-2.5 w-2.5" /> needs data
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); toggleFavorite(item.label); }}
                  className={cn(
                    'absolute right-1 top-1 rounded p-1 transition-colors',
                    favorite ? 'text-brand-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-brand-500',
                  )}
                  title={favorite ? 'Remove favorite' : 'Favorite'}
                >
                  <Star className={cn('h-3 w-3', favorite && 'fill-current')} />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Memoized: the editor page re-renders on every keystroke/dialog toggle, but
 * this panel only depends on the template, selection, and stable callbacks.
 * Callers must pass useCallback-stable handlers for the memo to be effective.
 */
export const PagesPanel = memo(PagesPanelImpl);

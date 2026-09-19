/**
 * Page Templates Marketplace — browse the bundled STARTER_PAGE_PRESETS as
 * thumbnail cards with search + categories. Click to insert into the active
 * template. Categorisation is heuristic (cover / data / narrative / structural)
 * based on the preset id.
 */
import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { LayoutTemplate, Plus, Check } from 'lucide-react';
import { STARTER_PAGE_PRESETS, type StarterPagePreset } from '@/lib/reportTemplate/starterTemplates';
import type { Page } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInsert: (presetId: string) => void;
}

const CATEGORIES: Array<{ id: string; label: string; test: (p: StarterPagePreset) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'cover', label: 'Cover', test: (p) => /cover|hero|title/i.test(p.id) },
  { id: 'data', label: 'Data & KPIs', test: (p) => /kpi|chart|dashboard|table|stats|metric/i.test(p.id) },
  { id: 'narrative', label: 'Narrative', test: (p) => /two-column|narrative|copy|story|exec/i.test(p.id) },
  { id: 'structural', label: 'Structural', test: (p) => /toc|disclaimer|signature|footer|divider|index|appendix/i.test(p.id) },
];

function previewPage(preset: StarterPagePreset): Page {
  try { return preset.build(); } catch { return { id: '_', name: preset.label, size: { width: 595, height: 842 }, background: {}, blocks: [] } as any; }
}

function PreviewSvg({ page }: { page: Page }) {
  const W = page.size?.width ?? 595;
  const H = page.size?.height ?? 842;
  const bgColor =
    typeof page.background?.color === 'string' && page.background.color.startsWith('#')
      ? page.background.color
      : '#ffffff';
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
      style={{ background: bgColor }}
    >
      {page.blocks?.flatMap((b: any) => {
        const blocks: any[] = [];
        // Approximate block bounding box from overlays or props.x/y/width/height
        const bx = b.props?.x ?? 0;
        const by = b.props?.y ?? 0;
        const bw = b.props?.width ?? W;
        const bh = b.props?.height ?? 60;
        blocks.push(
          <rect key={`b-${b.id}`} x={bx} y={by} width={bw} height={bh}
            fill={b.type === 'cover' || b.type === 'hero' ? '#1f2937' : '#e2e8f0'}
            opacity={0.35} rx={4}
          />
        );
        (b.overlays || []).forEach((o: any) => {
          blocks.push(
            <rect key={o.id} x={o.x} y={o.y} width={Math.max(o.width, 6)} height={Math.max(o.height, 6)}
              fill={o.type === 'text' ? '#475569' : o.type === 'image' ? '#94a3b8' : '#a78bfa'}
              opacity={0.7} rx={2}
            />
          );
        });
        return blocks;
      })}
    </svg>
  );
}

export function PageTemplatesMarketplaceDialog({ open, onOpenChange, onInsert }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [recent, setRecent] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const test = CATEGORIES.find((c) => c.id === cat)?.test ?? (() => true);
    return STARTER_PAGE_PRESETS.filter((p) => {
      if (!test(p)) return false;
      if (!ql) return true;
      return p.label.toLowerCase().includes(ql) || p.description.toLowerCase().includes(ql) || p.id.includes(ql);
    });
  }, [q, cat]);

  const insert = (id: string) => {
    onInsert(id);
    setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 6));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            Page Templates Marketplace
            <Badge variant="outline" className="ml-1 text-[10px]">{STARTER_PAGE_PRESETS.length} layouts</Badge>
          </DialogTitle>
          <DialogDescription>
            Pick a pre-composed page layout. Click "Insert" to add it to your template; you can edit everything afterwards.
          </DialogDescription>
          <div className="flex items-center gap-2 pt-2">
            <SearchInput
              value={q}
              onValueChange={setQ}
              placeholder="Search layouts…"
              containerClassName="flex-1"
              className="h-8 text-xs"
              iconClassName="h-3.5 w-3.5 left-2"
            />
            <div className="flex items-center gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    cat === c.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:border-primary/50'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-sm text-muted-foreground py-12">
                No layouts match "{q}".
              </div>
            )}
            {filtered.map((preset) => {
              const inserted = recent.includes(preset.id);
              return (
                <div
                  key={preset.id}
                  className="group border rounded-lg overflow-hidden bg-card hover:border-primary/60 hover:shadow-sm transition-all flex flex-col"
                >
                  <div className="aspect-[595/842] bg-muted/30 border-b overflow-hidden">
                    <PreviewSvg page={previewPage(preset)} />
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-1">
                    <div className="text-xs font-semibold flex items-center justify-between">
                      <span className="truncate">{preset.label}</span>
                      {inserted && <Check className="h-3 w-3 text-success" />}
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{preset.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-[11px]"
                      onClick={() => insert(preset.id)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Insert
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t">
          <p className="text-[11px] text-muted-foreground mr-auto">
            Inserting adds the layout as a new page at the end of your template. All elements remain editable.
          </p>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

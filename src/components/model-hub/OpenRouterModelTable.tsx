import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Copy, ExternalLink, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/integrations/BrandMark';
import {
  extractExtras,
  familyFromId,
  familyTint,
  formatContext,
  formatPricePerM,
  formatReleased,
} from '@/lib/openrouter/format';
import type { OpenRouterCardModel } from './OpenRouterModelCard';
import type { SortKey } from '@/lib/openrouter/format';

interface Props {
  models: OpenRouterCardModel[];
  sort: SortKey;
  onSort: (k: SortKey) => void;
}

function SortHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-primary')}>
      {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

export function OpenRouterModelTable({ models, sort, onSort }: Props) {
  const copy = async (id: string) => {
    try { await navigator.clipboard.writeText(id); toast.success('Copied'); } catch { toast.error('Copy failed'); }
  };
  return (
    <div className="aurixa-glass overflow-hidden rounded-[20px]">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40">
              <TableHead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <SortHeader label="Name" active={sort === 'name-asc'} onClick={() => onSort('name-asc')} />
              </TableHead>
              <TableHead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Family</TableHead>
              <TableHead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <SortHeader label="Context" active={sort === 'context-desc'} onClick={() => onSort('context-desc')} />
              </TableHead>
              <TableHead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Modalities</TableHead>
              <TableHead className="text-right text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <SortHeader label="$/1M in" active={sort === 'price-asc'} onClick={() => onSort('price-asc')} />
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-[0.14em] text-muted-foreground">$/1M out</TableHead>
              <TableHead className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <SortHeader label="Released" active={sort === 'newest'} onClick={() => onSort('newest')} />
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => {
              const extras = extractExtras(m.raw_metadata);
              const family = familyFromId(m.model_id);
              const tint = familyTint(family);
              const mods = [...new Set([...extras.inputModalities, ...extras.outputModalities])];
              return (
                <TableRow key={m.model_id} className="border-border/30 hover:bg-primary/[0.03]">
                  <TableCell className="max-w-[280px]">
                    <div className="truncate text-sm font-medium text-foreground" title={m.display_name}>{m.display_name}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground" title={m.model_id}>{m.model_id}</div>
                  </TableCell>
                  <TableCell>
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium', tint.chip)}>
                      <BrandMark integrationId={family} size={12} fallback={<Boxes className="h-3 w-3" />} />
                      {family}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground">{formatContext(m.context_window)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{mods.slice(0, 3).join(' · ') || 'text'}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-foreground">{formatPricePerM(m.pricing_input_per_1m ?? undefined)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-foreground">{formatPricePerM(m.pricing_output_per_1m ?? undefined)}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">{formatReleased(extras.releasedAt)}</TableCell>
                  <TableCell className="w-[80px]">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(m.model_id)} aria-label="Copy ID">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild aria-label="Open on OpenRouter">
                        <a href={`https://openrouter.ai/${m.model_id}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

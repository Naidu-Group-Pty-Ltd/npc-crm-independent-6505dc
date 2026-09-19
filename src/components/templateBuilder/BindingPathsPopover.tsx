/**
 * BindingPathsPopover — a quick reference / clipboard helper that shows every
 * resolvable binding path from the current sample data, plus all defined
 * brand tokens. Click to copy the canonical `{{path}}` or `token:key` form.
 */
import { useMemo, useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Braces, Copy as CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { flattenPaths } from '@/lib/reportTemplate/sampleDataPresets';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  sampleData: Record<string, any>;
}

export function BindingPathsPopover({ template, sampleData }: Props) {
  const [q, setQ] = useState('');

  const paths = useMemo(() => flattenPaths(sampleData), [sampleData]);
  const tokenEntries = useMemo(() => {
    const t = template.tokens;
    return [
      ...Object.entries(t.colors || {}).map(([k, v]) => ({ key: k, value: String(v), kind: 'colors' as const })),
      ...Object.entries(t.fonts || {}).map(([k, v]) => ({ key: k, value: String(v), kind: 'fonts' as const })),
      ...Object.entries(t.spacing || {}).map(([k, v]) => ({ key: k, value: String(v), kind: 'spacing' as const })),
    ];
  }, [template.tokens]);

  const filteredPaths = paths.filter((p) => !q || p.path.toLowerCase().includes(q.toLowerCase()));
  const filteredTokens = tokenEntries.filter((t) => !q || t.key.toLowerCase().includes(q.toLowerCase()));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${text}`);
    } catch { toast.error('Copy failed'); }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title="Browse bindable paths">
          <Braces className="h-3.5 w-3.5 mr-1" /> Paths
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="p-2 border-b">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter paths or tokens…"
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-[420px]">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b">
            Data paths ({filteredPaths.length})
          </div>
          <ul className="divide-y">
            {filteredPaths.map((p) => (
              <li key={p.path} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
                <code className="text-[11px] font-mono flex-1 truncate">{`{{${p.path}}}`}</code>
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{p.preview}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(`{{${p.path}}}`)}>
                  <CopyIcon className="h-3 w-3" />
                </Button>
              </li>
            ))}
            {filteredPaths.length === 0 && (
              <li className="px-3 py-3 text-xs text-muted-foreground text-center italic">No matches</li>
            )}
          </ul>
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-t">
            Brand tokens ({filteredTokens.length})
          </div>
          <ul className="divide-y">
            {filteredTokens.map((t) => (
              <li key={`${t.kind}.${t.key}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
                <code className="text-[11px] font-mono flex-1 truncate">{`token:${t.key}`}</code>
                {t.kind === 'colors' && t.value.startsWith('#') && (
                  <span className="h-3 w-3 rounded-sm border" style={{ background: t.value }} />
                )}
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{t.value}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(`token:${t.key}`)}>
                  <CopyIcon className="h-3 w-3" />
                </Button>
              </li>
            ))}
            {filteredTokens.length === 0 && (
              <li className="px-3 py-3 text-xs text-muted-foreground text-center italic">No matches</li>
            )}
          </ul>
        </ScrollArea>
        <div className="px-3 py-2 border-t text-[10px] text-muted-foreground">
          Add a filter with <code className="font-mono">| currency</code>, <code className="font-mono">| date</code>, <code className="font-mono">| upper</code>…
        </div>
      </PopoverContent>
    </Popover>
  );
}

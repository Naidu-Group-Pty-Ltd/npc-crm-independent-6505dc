import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { FileText, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  kind: 'message' | 'note' | 'doc_request' | 'sms';
  vars?: Record<string, string>;
  onPick: (rendered: { body: string; title: string }) => void;
  align?: 'start' | 'end' | 'center';
  className?: string;
}

export function TemplatesPicker({ kind, vars, onPick, align = 'start', className }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['finance-templates', kind],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-templates', { operation: 'list', kind });
      if (error) throw new Error(error.message);
      return data?.templates ?? [];
    },
    enabled: open,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t: any) =>
      (t.title + ' ' + (t.category || '') + ' ' + t.body).toLowerCase().includes(q)
    );
  }, [templates, search]);

  const pick = async (id: string) => {
    const { data } = await invokeFinanceFunction('finance-portal-templates', { operation: 'use', id, vars: vars || {} });
    if (data?.rendered_body) {
      onPick({ body: data.rendered_body, title: data.rendered_title || '' });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['finance-templates', kind] });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-8 gap-1.5', className)} title="Insert template">
          <Sparkles className="h-3.5 w-3.5" />
          Templates
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[380px] p-0">
        <div className="p-2 border-b border-border">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search templates…"
            autoFocus
            className="h-8 text-xs"
            iconClassName="left-2 h-3.5 w-3.5"
          />
        </div>
        <ScrollArea className="max-h-[360px]">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No templates yet for {kind.replace('_', ' ')}
            </div>
          ) : (
            <div className="p-1">
              {filtered.map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => pick(t.id)}
                  className="w-full text-left p-2 rounded-md hover:bg-accent transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{t.title}</span>
                    {t.is_shared && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1">Shared</Badge>
                    )}
                  </div>
                  {t.category && (
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{t.category}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body}</p>
                  {t.use_count > 0 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Used {t.use_count} times</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

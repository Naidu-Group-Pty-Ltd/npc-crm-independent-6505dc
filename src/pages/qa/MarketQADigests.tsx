import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Mail } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { LiveModelBadge } from '@/components/agentModels';

interface Digest {
  id: string;
  cadence: 'daily' | 'weekly';
  digest_group: string | null;
  question_ids: string[];
  summary_md: string;
  delivery_channels: string[];
  sent_at: string;
  metadata: any;
}

export default function MarketQADigests() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-qa-digest-runner', { body: { action: 'list' } });
      if (error) throw new Error(error.message);
      const rows = (data as any)?.digests ?? [];
      setDigests(rows);
      if (rows.length && !active) setActive(rows[0].id);
    } catch (e) { toast.error(String((e as Error).message)); }
    finally { setLoading(false); }
  }, [active]);

  useEffect(() => { load(); }, [load]);

  const current = digests.find((d) => d.id === active);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Mail className="h-6 w-6 text-primary" /> Market Q&amp;A Digests</h1>
          <p className="text-sm text-muted-foreground">Synthesised daily/weekly briefings across your grouped subscriptions.</p>
        </div>
        <LiveModelBadge agentKey="market_digest" size="sm" showSlot={false} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-4 h-[75vh]">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">History</CardTitle>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[68vh]">
              <div className="p-2 space-y-1">
                {!digests.length && !loading && <p className="text-xs text-muted-foreground p-3">No digests yet. They arrive once your grouped subscriptions fire.</p>}
                {digests.map((d) => (
                  <button key={d.id} onClick={() => setActive(d.id)}
                    className={`w-full text-left rounded-md p-2 text-xs transition ${active === d.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/40'}`}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{d.cadence}</Badge>
                      {d.digest_group && <Badge variant="outline" className="text-[10px]">{d.digest_group}</Badge>}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(d.sent_at).toLocaleString('en-AU')} · {d.question_ids?.length ?? 0} Qs
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="col-span-8 h-[75vh]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {current ? `${current.cadence.toUpperCase()} — ${current.digest_group ?? 'Ungrouped'}` : 'Select a digest'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[65vh] pr-3">
              {current ? (
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{current.summary_md}</ReactMarkdown>
                </article>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing to show.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

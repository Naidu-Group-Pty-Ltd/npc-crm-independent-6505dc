import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { MarketQAAnswer } from '@/components/market-updates/MarketQAAnswer';
import type { MarketQARetrievedItem } from '@/types/marketUpdates';

interface Source { id: string; title: string; summary?: string; source_url?: string; source_name?: string; published_at?: string; impact_level?: string; }
interface Question { id: string; question: string; answer: string; used_ids?: string[]; confidence?: number; model?: string; created_at?: string; meta?: any; }

export default function SharedMarketQAAnswer() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<{ loading: boolean; error?: string; question?: Question; sources?: Source[]; share?: any }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('market-qa-share', { body: { action: 'resolve', slug } });
        if (cancelled) return;
        if (error || (data as any)?.error) {
          setState({ loading: false, error: (data as any)?.error ?? error?.message ?? 'Unable to load share.' });
          return;
        }
        setState({ loading: false, question: (data as any).question, sources: (data as any).sources ?? [], share: (data as any).share });
      } catch (err) {
        setState({ loading: false, error: String((err as Error).message) });
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (state.loading) {
    return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (state.error) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" />Answer unavailable</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{state.error === 'expired' ? 'This share link has expired.' : state.error === 'revoked' ? 'This share link has been revoked.' : state.error === 'not_found' ? 'We could not find that answer.' : state.error}</p></CardContent>
        </Card>
      </div>
    );
  }

  const q = state.question!;
  const citationSources: MarketQARetrievedItem[] = (state.sources ?? []).map((source) => ({
    id: source.id,
    title: source.title,
    source_name: source.source_name ?? '',
    source_url: source.source_url ?? '',
    source_published_at: source.published_at ?? null,
    impact_level: source.impact_level ?? null,
    used: true,
  }));
  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Market Q&amp;A · Shared answer</p>
          <h1 className="text-2xl font-semibold mt-1">{q.question}</h1>
          <p className="text-xs text-muted-foreground mt-2">
            {q.created_at ? new Date(q.created_at).toLocaleString('en-AU') : ''} · {q.model ?? 'model'} {typeof q.confidence === 'number' ? `· confidence ${(q.confidence * 100).toFixed(0)}%` : ''}
          </p>
        </div>
        <Card>
          <CardHeader><CardTitle>Answer</CardTitle></CardHeader>
          <CardContent>
            {/* Answers are sectioned markdown carrying inline [[id]] citation
                markers, so they need the same renderer as the dashboard —
                rendered raw they would show the markers and literal "##". The
                numbers on the citation chips index the Sources card below. */}
            <MarketQAAnswer content={q.answer} retrieved={citationSources} />
          </CardContent>
        </Card>
        {state.sources && state.sources.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Sources ({state.sources.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {state.sources.map((s) => (
                <div key={s.id} className="border-l-2 border-primary/40 pl-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.source_name} {s.published_at ? `· ${new Date(s.published_at).toLocaleDateString('en-AU')}` : ''}</div>
                    </div>
                    {s.impact_level && <Badge variant="outline" className="text-[10px] uppercase">{s.impact_level}</Badge>}
                  </div>
                  {s.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{s.summary}</p>}
                  {s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary mt-1 hover:underline">Open source <ExternalLink className="h-3 w-3" /></a>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Copy-to-clipboard + "Explain this answer" transparency panel for a Market Q&A turn.
 * Renders inline under an assistant message. Shows every retrieved source with
 * a used/considered badge so the user can audit the grounding.
 */
import { useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, Share2, Loader2, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { MarketQARetrievedItem } from '@/types/marketUpdates';

interface Props {
  content: string;
  retrieved?: MarketQARetrievedItem[];
  questionId?: string | null;
  questionText?: string | null;
  compact?: boolean;
}

export function MarketQAAnswerActions({ content, retrieved = [], questionId, questionText, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Answer copied to clipboard');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed');
    }
  };

  const handleShare = async () => {
    if (!questionId || sharing) return;
    setSharing(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-qa-share', {
        body: { action: 'create', question_id: questionId },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'Share failed');
      const slug = (data as any)?.share?.slug;
      if (!slug) throw new Error('No slug returned');
      const url = `${window.location.origin}/qa/market/${slug}`;
      await navigator.clipboard.writeText(url);
      toast.success('Public share link copied');
    } catch (err) {
      toast.error(String((err as Error).message));
    } finally {
      setSharing(false);
    }
  };

  const handleSubscribe = async () => {
    if (!questionText || subscribing) return;
    const cadence = window.prompt('Cadence — type "daily" or "weekly":', 'weekly');
    if (!cadence || !['daily', 'weekly'].includes(cadence)) return;
    setSubscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-qa-subscriptions', {
        body: { action: 'create', question_template: questionText, cadence, channels: ['in_app'] },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error ?? error?.message ?? 'Subscribe failed');
      toast.success('Subscribed — manage at /qa/subscriptions');
    } catch (err) {
      toast.error(String((err as Error).message));
    } finally {
      setSubscribing(false);
    }
  };



  const used = retrieved.filter(r => r.used).length;
  const total = retrieved.length;

  return (
    <div className={cn('mt-1.5 space-y-1.5', compact ? 'text-[10px]' : 'text-xs')}>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-primary"
          title="Copy answer"
        >
          {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
          Copy
        </button>
        {questionId && (
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50"
            title="Create a public shareable link"
          >
            {sharing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Share2 className="h-2.5 w-2.5" />}
            Share
          </button>
        )}
        {questionText && (
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={subscribing}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50"
            title="Get fresh answers on a schedule"
          >
            {subscribing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Bell className="h-2.5 w-2.5" />}
            Subscribe
          </button>
        )}
        {total > 0 && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', open && 'rotate-180')} />
            Explain ({used}/{total})
          </button>
        )}
      </div>
      {open && total > 0 && (
        <div className="space-y-1 rounded-lg border border-border/60 bg-background/60 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Retrieved context · used vs considered</p>
          {retrieved.map(r => (
            <div key={r.id} className="flex items-start gap-2 rounded border border-border/40 bg-background/70 p-1.5">
              <span className={cn('mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full',
                r.used ? 'bg-primary' : 'bg-muted-foreground/30')}
                title={r.used ? 'Used in answer' : 'Considered but not used'}
              />
              <div className="min-w-0 flex-1">
                <a href={r.source_url} target="_blank" rel="noreferrer" className="block truncate text-[11px] font-medium text-foreground hover:text-primary">
                  {r.title}
                  <ExternalLink className="ml-1 inline h-2.5 w-2.5" />
                </a>
                <p className="truncate text-[10px] text-muted-foreground">
                  {r.source_name}
                  {r.impact_level ? ` · ${r.impact_level} impact` : ''}
                  {r.used ? ' · used' : ' · considered'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

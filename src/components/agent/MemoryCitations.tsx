import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface RecalledMemory {
  id: string;
  content: string;
  tags?: string[] | null;
  importance?: number | null;
  similarity?: number | null;
  feedback_score?: number | null;
  kind?: string | null;
}

interface Props {
  messageId?: string;
  memories: RecalledMemory[];
  defaultOpen?: boolean;
}

type RatingState = 1 | -1 | null;

export function MemoryCitations({ messageId, memories, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [ratings, setRatings] = useState<Record<string, RatingState>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  if (!memories?.length) return null;

  const submitFeedback = async (memoryId: string, rating: 1 | -1) => {
    if (pending[memoryId] || ratings[memoryId] === rating) return;
    const previous = ratings[memoryId] ?? null;
    setRatings(prev => ({ ...prev, [memoryId]: rating }));
    setPending(prev => ({ ...prev, [memoryId]: true }));
    try {
      const res = await invokeSecureFunction('ai-dashboard-agent', {
        action: 'memory-feedback',
        memory_id: memoryId,
        message_id: messageId,
        rating,
      });
      if (!res.data?.success) throw new Error(res.data?.error || 'Feedback failed');
      if (rating === 1) toast.success('Thanks — I\'ll surface this more often.');
      else toast.success('Noted — I\'ll rely on this less.');
    } catch (err: any) {
      setRatings(prev => ({ ...prev, [memoryId]: previous }));
      toast.error(err?.message || 'Could not save feedback');
    } finally {
      setPending(prev => ({ ...prev, [memoryId]: false }));
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[hsl(var(--aurixa-hairline))]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="group flex items-center gap-2 text-[11px] text-muted-foreground hover:text-primary transition-colors"
      >
        <span className="h-5 w-5 rounded-full grid place-items-center bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
          <Brain className="h-3 w-3" />
        </span>
        <span className="font-mono uppercase tracking-[0.14em] text-[10px]">
          {memories.length} recalled {memories.length === 1 ? 'memory' : 'memories'}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2.5 -mx-1 px-1 flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1
                        [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5
                        [&::-webkit-scrollbar-thumb]:bg-primary/20 [&::-webkit-scrollbar-thumb]:rounded-full">
          {memories.map((m, i) => {
            const rating = ratings[m.id] ?? null;
            const sim = typeof m.similarity === 'number' ? Math.round(m.similarity * 100) : null;
            const confidence = sim ?? (typeof m.importance === 'number' ? m.importance * 20 : 50);

            return (
              <div
                key={m.id}
                className="snap-start shrink-0 w-[240px] aurixa-glass rounded-xl p-2.5 flex flex-col gap-2 animate-aurixa-rise"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] text-primary/70 px-1.5 py-0.5 rounded bg-primary/10 uppercase tracking-wider">
                    {m.kind || 'memory'}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground ml-auto">[{i + 1}]</span>
                </div>

                <p className="text-[11px] leading-snug text-foreground/90 line-clamp-4 break-words">
                  {m.content}
                </p>

                {m.tags?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {m.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-[9px] font-mono text-muted-foreground/80 px-1 py-0.5 rounded bg-muted/40">{t}</span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-auto space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Recall</span>
                    <div className="flex-1 h-[3px] rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                        style={{ width: `${Math.min(100, Math.max(4, confidence))}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-primary">{Math.round(confidence)}%</span>
                  </div>

                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-6 w-6 rounded-full',
                        rating === 1 && 'bg-success/15 text-success hover:bg-success/25',
                      )}
                      disabled={pending[m.id]}
                      onClick={() => submitFeedback(m.id, 1)}
                      aria-label="Helpful"
                    >
                      {pending[m.id] && rating === 1 ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-6 w-6 rounded-full',
                        rating === -1 && 'bg-destructive/15 text-destructive hover:bg-destructive/25',
                      )}
                      disabled={pending[m.id]}
                      onClick={() => submitFeedback(m.id, -1)}
                      aria-label="Not helpful"
                    >
                      {pending[m.id] && rating === -1 ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsDown className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

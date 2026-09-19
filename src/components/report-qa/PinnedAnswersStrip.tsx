import { Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface PinnedAnswer {
  id: string;
  content: string;
}

interface PinnedAnswersStripProps {
  pinned: PinnedAnswer[];
  onJump: (messageId: string) => void;
}

/**
 * Horizontal jump-strip of pinned answers in the current thread.
 * Click a chip to scroll the corresponding message into view.
 * Renders nothing when no answers are pinned.
 */
export function PinnedAnswersStrip({ pinned, onJump }: PinnedAnswersStripProps) {
  if (!pinned.length) return null;

  return (
    <div className="border-b border-border/50 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground flex-shrink-0">
          <Pin className="h-3 w-3 fill-current text-primary" />
          <span>Pinned</span>
          <span className="opacity-60">({pinned.length})</span>
        </div>
        <ScrollArea horizontal className="flex-1 max-w-full">
          <div className="flex gap-1.5">
            {pinned.map((m) => {
              const preview = m.content
                .replace(/[#*_`>]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 60);
              return (
                <Button
                  key={m.id}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs whitespace-nowrap flex-shrink-0 border-primary/30 hover:bg-primary/10"
                  onClick={() => onJump(m.id)}
                  title={m.content.slice(0, 200)}
                >
                  {preview}
                  {m.content.length > 60 && '…'}
                </Button>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}

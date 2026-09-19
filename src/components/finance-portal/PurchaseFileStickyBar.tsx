import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Eye, EyeOff, MessageSquare, FileText, Lightbulb, Calendar } from 'lucide-react';

interface Props {
  title: string;
  status: string;
  isWatched?: boolean;
  onToggleWatch?: () => void;
  onJumpDocs?: () => void;
  onJumpDecisions?: () => void;
  onJumpDates?: () => void;
  onOpenMessages?: () => void;
}

export function PurchaseFileStickyBar({
  title, status, isWatched, onToggleWatch,
  onJumpDocs, onJumpDecisions, onJumpDates, onOpenMessages,
}: Props) {
  return (
    <div className="sticky top-14 z-20 -mx-4 px-4 md:-mx-6 md:px-6 py-2 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm truncate max-w-[40ch]">{title}</p>
            <Badge variant="outline" className="text-[10px] capitalize">
              {status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {onJumpDates && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onJumpDates}>
              <Calendar className="h-3.5 w-3.5" /> Dates
            </Button>
          )}
          {onJumpDocs && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onJumpDocs}>
              <FileText className="h-3.5 w-3.5" /> Docs
            </Button>
          )}
          {onJumpDecisions && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onJumpDecisions}>
              <Lightbulb className="h-3.5 w-3.5" /> Decisions
            </Button>
          )}
          {onOpenMessages && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={onOpenMessages}>
              <MessageSquare className="h-3.5 w-3.5" /> Message
            </Button>
          )}
          {onToggleWatch && (
            <Button
              variant={isWatched ? 'default' : 'outline'}
              size="sm"
              className={cn('h-8 gap-1.5', isWatched && 'bg-primary/15 text-primary hover:bg-primary/20 border-primary/30')}
              onClick={onToggleWatch}
            >
              {isWatched ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {isWatched ? 'Watching' : 'Watch'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

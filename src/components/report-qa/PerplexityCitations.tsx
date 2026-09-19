import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PerplexityCitationsProps {
  citations: string[];
  className?: string;
}

export function PerplexityCitations({ citations, className }: PerplexityCitationsProps) {
  if (!citations || citations.length === 0) return null;

  // Extract domain from URL for display
  const getDomain = (url: string) => {
    try {
      const domain = new URL(url).hostname.replace('www.', '');
      return domain.length > 25 ? domain.substring(0, 22) + '...' : domain;
    } catch {
      return url.substring(0, 25);
    }
  };

  return (
    <div className={cn('mt-3 pt-3 border-t border-border/50', className)}>
      <div className="text-xs font-medium text-muted-foreground mb-2">Sources</div>
      <div className="flex flex-wrap gap-2">
        {citations.slice(0, 5).map((citation, index) => (
          <a
            key={index}
            href={citation}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-info/10 dark:bg-info/30 text-info dark:text-info hover:bg-info/15 dark:hover:bg-info/40 transition-colors border border-info/30 dark:border-info/30"
          >
            <span className="font-medium">[{index + 1}]</span>
            <span className="truncate max-w-[120px]">{getDomain(citation)}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        ))}
        {citations.length > 5 && (
          <span className="text-xs text-muted-foreground self-center">
            +{citations.length - 5} more
          </span>
        )}
      </div>
    </div>
  );
}

import { ExternalLink, FileText, GitCompare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Unified citations format. Backwards-compatible with the legacy
 * Perplexity-style URL array via the `urls` prop.
 *
 * `documents` are paragraph-level deep-links into uploaded reports,
 * produced by the report-qa edge function from RAG retrievals.
 */
export interface DocumentCitation {
  document_name: string;
  page_number?: number | null;
  paragraph_index?: number | null;
  snippet?: string;
  similarity?: number;
}

interface CitationsProps {
  documents?: DocumentCitation[];
  urls?: string[];
  comparisonMode?: boolean;
  className?: string;
  onDocumentClick?: (citation: DocumentCitation) => void;
}

function getDomain(url: string) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return domain.length > 25 ? domain.substring(0, 22) + '…' : domain;
  } catch {
    return url.substring(0, 25);
  }
}

function shortenDocName(name: string, max = 28) {
  if (!name) return 'Report';
  const trimmed = name.replace(/\.pdf$/i, '').trim();
  return trimmed.length > max ? trimmed.substring(0, max - 1) + '…' : trimmed;
}

export function Citations({
  documents,
  urls,
  comparisonMode,
  className,
  onDocumentClick,
}: CitationsProps) {
  const hasDocs = documents && documents.length > 0;
  const hasUrls = urls && urls.length > 0;
  if (!hasDocs && !hasUrls && !comparisonMode) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn('mt-3 pt-3 border-t border-border/50 space-y-2', className)}>
        {comparisonMode && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <GitCompare className="h-3 w-3 text-primary" />
            <span className="font-medium">Comparison mode</span>
            <span className="opacity-60">— answer compares the selected reports.</span>
          </div>
        )}

        {hasDocs && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Sources from your reports
            </div>
            <div className="flex flex-wrap gap-1.5">
              {documents!.slice(0, 8).map((c, i) => {
                const label = [
                  shortenDocName(c.document_name),
                  c.page_number ? `p.${c.page_number}` : null,
                  c.paragraph_index != null ? `¶${c.paragraph_index}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

                const chip = (
                  <button
                    type="button"
                    onClick={() => onDocumentClick?.(c)}
                    className={cn(
                      'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md',
                      'bg-primary/10 text-primary hover:bg-primary/20 transition-colors',
                      'border border-primary/20',
                      onDocumentClick ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <FileText className="h-3 w-3 flex-shrink-0" />
                    <span className="font-medium">[{i + 1}]</span>
                    <span className="truncate max-w-[200px]">{label}</span>
                  </button>
                );

                return c.snippet ? (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>{chip}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-sm text-xs">
                      <div className="font-medium mb-1">{c.document_name}</div>
                      <div className="opacity-80 whitespace-pre-wrap">
                        {c.snippet.length > 280
                          ? c.snippet.substring(0, 277) + '…'
                          : c.snippet}
                      </div>
                      {typeof c.similarity === 'number' && (
                        <div className="mt-1 opacity-60">
                          relevance {(c.similarity * 100).toFixed(0)}%
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={i}>{chip}</span>
                );
              })}
              {documents!.length > 8 && (
                <span className="text-xs text-muted-foreground self-center">
                  +{documents!.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {hasUrls && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              External sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              {urls!.slice(0, 5).map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-info/10 text-info dark:text-info hover:bg-info/20 transition-colors border border-info/20"
                >
                  <span className="font-medium">[{i + 1}]</span>
                  <span className="truncate max-w-[140px]">{getDomain(url)}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              ))}
              {urls!.length > 5 && (
                <span className="text-xs text-muted-foreground self-center">
                  +{urls!.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

import { Bot, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreamingTypingIndicatorProps {
  isMultiReport?: boolean;
  streamingContent?: string;
  className?: string;
}

export function StreamingTypingIndicator({ 
  isMultiReport, 
  streamingContent,
  className 
}: StreamingTypingIndicatorProps) {
  const hasContent = streamingContent && streamingContent.length > 0;
  
  return (
    <div className={cn("flex gap-3 justify-start", className)}>
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-brand-500/20 bg-brand-500/10 shadow-sm">
        <Bot className="h-4 w-4 text-brand-500" />
      </div>
      <div className="max-w-[80%] rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3 shadow-sm">
        {hasContent ? (
          <div className="space-y-2">
            <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
            <div className="flex items-center gap-2 rounded-full border border-brand-500/20 bg-background/60 px-2.5 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span className="text-xs font-medium text-brand-600 dark:text-brand-300">Generating...</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Skeleton loader for thinking state */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span 
                  className="w-2 h-2 rounded-full bg-brand-500/70 animate-bounce" 
                  style={{ animationDelay: '0ms', animationDuration: '0.8s' }} 
                />
                <span 
                  className="w-2 h-2 rounded-full bg-brand-500/70 animate-bounce" 
                  style={{ animationDelay: '150ms', animationDuration: '0.8s' }} 
                />
                <span 
                  className="w-2 h-2 rounded-full bg-brand-500/70 animate-bounce" 
                  style={{ animationDelay: '300ms', animationDuration: '0.8s' }} 
                />
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-200">
                <Sparkles className="h-3.5 w-3.5" />
                {isMultiReport ? 'Analyzing reports...' : 'Thinking...'}
              </span>
            </div>
            
            {/* Skeleton content preview */}
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-muted-foreground/10 rounded w-full" />
              <div className="h-3 bg-muted-foreground/10 rounded w-4/5" />
              <div className="h-3 bg-muted-foreground/10 rounded w-3/5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

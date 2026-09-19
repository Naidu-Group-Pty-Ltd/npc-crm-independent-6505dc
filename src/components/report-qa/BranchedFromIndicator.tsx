import { GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BranchedFromIndicatorProps {
  parentTitle: string;
  onOpenParent: () => void;
}

/**
 * Small breadcrumb shown at the top of a branched conversation so users
 * can see (and jump back to) the conversation it was forked from.
 */
export function BranchedFromIndicator({ parentTitle, onOpenParent }: BranchedFromIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-md bg-muted/40 border border-border/50">
      <GitBranch className="h-3 w-3 text-primary flex-shrink-0" />
      <span className="opacity-70">Branched from</span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs font-medium text-primary"
        onClick={onOpenParent}
      >
        {parentTitle}
      </Button>
    </div>
  );
}

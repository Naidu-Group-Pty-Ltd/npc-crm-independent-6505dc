import { Loader2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface CashFlowPaginationFooterProps {
  filteredCount: number;
  loadedCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function CashFlowPaginationFooter({ filteredCount, loadedCount, hasMore, loadingMore, onLoadMore }: CashFlowPaginationFooterProps) {
  return (
    <Card className="border-border/80 bg-muted/20 shadow-sm">
      <CardContent className="flex flex-col items-center justify-between gap-3 p-4 sm:flex-row">
        <div className="flex items-center gap-3 text-center sm:text-left">
          <div className="hidden rounded-2xl bg-primary/10 p-2 text-primary sm:block">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Showing {filteredCount} of {loadedCount} loaded report{loadedCount === 1 ? '' : 's'}
              {hasMore ? ' — more available' : ''}
            </p>
            {hasMore && (
              <p className="text-xs text-muted-foreground">
                {loadingMore ? 'Loading more cash-flow-ready reports…' : 'More reports are available in the library.'}
              </p>
            )}
          </div>
        </div>
        {hasMore && (
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadingMore ? 'Loading…' : 'Load more reports'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

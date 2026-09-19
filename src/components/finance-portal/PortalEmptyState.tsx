import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PortalEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function PortalEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: PortalEmptyStateProps) {
  return (
    <Card className={cn('relative overflow-hidden border-dashed', className)}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/20 via-primary/70 to-primary/20" />
      <CardContent className="flex flex-col items-center justify-center px-6 py-14 text-center sm:px-10 sm:py-16">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
          {icon}
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {actionLabel && onAction && (
          <Button
            type="button"
            onClick={onAction}
            className="mt-6 min-h-11 gap-2 rounded-xl px-5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
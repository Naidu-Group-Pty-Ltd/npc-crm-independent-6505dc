import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function DashboardErrorFallback({ error }: { error?: Error }) {
  return (
    <Card className="dashboard-empty-state mx-4 border-0 md:mx-6">
      <CardContent className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="dashboard-empty-icon mb-1 border-destructive/20 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="dashboard-eyebrow text-destructive">Attention required</div>
          <h3 className="text-lg font-semibold text-foreground">Something went wrong</h3>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            This page encountered an error. Please refresh or switch to another section.
          </p>
          {error && (
            <details className="mt-4 w-full max-w-2xl text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
                Show error details
              </summary>
              <pre className="dashboard-surface-control mt-2 max-h-48 overflow-auto rounded-xl p-3 text-xs text-destructive whitespace-pre-wrap break-all">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </details>
          )}
          <Button variant="default" className="mt-5 rounded-xl" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
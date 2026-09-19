import { AlertTriangle, ArrowLeft, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  error?: string | null;
  onBack: () => void;
}

export function InvestmentReportErrorState({ error, onBack }: Props) {
  return (
    <div className="flex-1 bg-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center">
        <Card className="w-full overflow-hidden border-destructive/20 bg-card shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-gradient-to-br from-background via-background to-destructive/5 p-6 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-destructive shadow-sm">
                  <FileWarning className="h-6 w-6" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Report unavailable
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">We couldn't load this investment report.</h1>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {error || 'Report not found'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <p className="text-sm text-muted-foreground">Go back and try opening the report again.</p>
              <Button variant="outline" onClick={onBack} className="sm:shrink-0">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Calculator, LineChart } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function CashFlowLoadingState() {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-primary/10 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3">
              <Calculator className="h-5 w-5 animate-pulse text-primary" />
            </div>
            <div>
              <p className="font-semibold">Loading cash-flow-ready reports</p>
              <p className="text-sm text-muted-foreground">Preparing report cards, assumptions, and investment metrics…</p>
            </div>
          </div>
          <LineChart className="hidden h-6 w-6 animate-pulse text-primary/60 sm:block" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="animate-pulse overflow-hidden">
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="h-5 w-24 rounded-full bg-muted" />
                <div className="h-5 w-20 rounded-full bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-5 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/2 rounded bg-muted" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="h-16 rounded-xl bg-muted" />
                <div className="h-16 rounded-xl bg-muted" />
              </div>
              <div className="h-20 rounded-xl bg-muted" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-9 rounded bg-muted" />
                <div className="h-9 rounded bg-muted" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

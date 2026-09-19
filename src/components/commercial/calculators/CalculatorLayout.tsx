import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function CalculatorTabShell({
  title,
  subtitle,
  chips = [],
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  chips?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <Card className="ci-card-premium">
        <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-xl font-semibold tracking-tight md:text-2xl">{title}</CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">{subtitle}</CardDescription>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {chips.map((chip) => (
                  <Badge key={chip} variant="outline" className="ci-badge">
                    {chip}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
        </CardHeader>
      </Card>
      {children}
    </section>
  );
}

export function CalculatorGuidancePanel({ items }: { items: Array<{ title: string; body: string }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <Card key={item.title} className="ci-card">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-foreground">{item.title}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

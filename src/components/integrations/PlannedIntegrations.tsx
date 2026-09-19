import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Calendar, Database, DollarSign, MapPin, AlertCircle } from 'lucide-react';

interface PlannedIntegration {
  id: string;
  name: string;
  description: string;
  purpose: string;
  estimatedCost: string;
  priority: 'high' | 'medium' | 'low';
  status: 'planned' | 'researching' | 'pending_budget';
  icon: React.ReactNode;
}

const plannedIntegrations: PlannedIntegration[] = [
  {
    id: 'corelogic',
    name: 'CoreLogic RP Data',
    description: 'Comprehensive property transaction database',
    purpose: 'Enable verified comparable sales data with actual settlement prices, dates, and property addresses for investment reports',
    estimatedCost: 'Enterprise pricing - contact for quote',
    priority: 'high',
    status: 'pending_budget',
    icon: <Database className="h-5 w-5" />,
  },
  {
    id: 'pricefinder',
    name: 'Pricefinder',
    description: 'Real-time property data and valuations',
    purpose: 'Access to comparable rental evidence with actual lease data, property history, and automated valuation models (AVM)',
    estimatedCost: '$200-500/month per user',
    priority: 'high',
    status: 'researching',
    icon: <DollarSign className="h-5 w-5" />,
  },
  {
    id: 'nearmap',
    name: 'Nearmap',
    description: 'High-resolution aerial imagery',
    purpose: 'Include current aerial property images in reports, track development changes over time',
    estimatedCost: 'Enterprise pricing - contact for quote',
    priority: 'medium',
    status: 'planned',
    icon: <MapPin className="h-5 w-5" />,
  },
];

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case 'high':
      return <Badge variant="outline" className="rounded-full border-brand-400/35 bg-brand-500/10 text-brand-700 dark:text-brand-300">High Priority</Badge>;
    case 'medium':
      return <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-primary">Medium</Badge>;
    case 'low':
      return <Badge variant="outline" className="rounded-full border-border/70 bg-muted/45 text-muted-foreground">Low</Badge>;
    default:
      return <Badge variant="outline" className="rounded-full">{priority}</Badge>;
  }
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'pending_budget':
      return <Badge variant="outline" className="rounded-full border-brand-400/35 bg-brand-500/10 text-brand-700 dark:text-brand-300">Pending Budget</Badge>;
    case 'researching':
      return <Badge variant="outline" className="rounded-full border-primary/35 bg-primary/10 text-primary">Researching</Badge>;
    case 'planned':
      return <Badge variant="outline" className="rounded-full border-border/70 bg-muted/45 text-muted-foreground">Planned</Badge>;
    default:
      return <Badge variant="outline" className="rounded-full">{status}</Badge>;
  }
};

export function PlannedIntegrations() {
  return (
    <Card className="min-w-0 overflow-hidden rounded-3xl border-dashed border-border/70 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.18)_100%)] shadow-[0_14px_40px_rgba(15,23,42,0.08)] ring-1 ring-white/45 dark:border-white/10 dark:ring-white/10 dark:shadow-black/30">
      <CardHeader className="border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--background)/0.46),hsl(var(--primary)/0.06))]">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_hsl(var(--primary)/0.14)]">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <CardTitle className="break-words text-lg">Future Integrations Roadmap</CardTitle>
            <CardDescription className="break-words leading-5">
              Planned paid API integrations for enhanced reporting capabilities
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        {/* Important Note */}
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-brand-400/25 bg-brand-500/10 p-3 shadow-inner shadow-sm">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-brand-600 dark:text-brand-300" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-brand-700 dark:text-brand-300">Data Sourcing Note</p>
            <p className="text-muted-foreground mt-1">
              Currently, individual comparable sales and rental data in investment reports are based on
              suburb-level statistics. Specific property addresses and transaction details require integration
              with paid data providers listed below.
            </p>
          </div>
        </div>

        <Separator />

        {/* Planned Integrations List */}
        <div className="grid min-w-0 gap-4">
          {plannedIntegrations.map((integration) => (
            <div
              key={integration.id}
              className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/65 bg-background/45 p-4 shadow-sm transition-all hover:border-primary/25 hover:bg-primary/5 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/35 sm:flex-row sm:items-start"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-card/80 text-primary shadow-sm">
                  {integration.icon}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h4 className="break-words font-semibold text-foreground">{integration.name}</h4>
                    {getPriorityBadge(integration.priority)}
                    {getStatusBadge(integration.status)}
                  </div>
                  <p className="break-words text-sm text-muted-foreground">{integration.description}</p>
                  <p className="mt-2 break-words text-sm leading-6">
                    <span className="font-medium">Purpose: </span>
                    {integration.purpose}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    <span className="font-medium">Est. Cost: </span>
                    {integration.estimatedCost}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Developer Notes */}
        <div className="mt-4 rounded-2xl border border-border/60 bg-muted/35 p-3 shadow-inner shadow-sm">
          <p className="break-words text-xs leading-5 text-muted-foreground">
            <span className="font-medium">Developer Notes: </span>
            When integrating these APIs, update the <code className="rounded bg-background px-1 text-foreground">generate-investment-report</code> edge
            function to fetch verified transaction data and remove the disclaimer about comparable data limitations.
            Search for <code className="rounded bg-background px-1 text-foreground">TODO: Re-enable when transaction data APIs are integrated</code> in the codebase.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

import { AlertTriangle, BarChart3, Building2, CalendarDays, Calculator, Filter, Home, MapPin, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BuildType, BuildTypeFilter, InvestmentReport } from './types';
import { getBuildTypeLabel } from './utils';
import { resolveCashFlowFinancialSummary } from './financialSummary';

interface CashFlowPageHeroProps {
  reports: InvestmentReport[];
  filteredReports: InvestmentReport[];
  dateRangeLabel: string;
  buildTypeFilter: BuildTypeFilter;
  getBuildType: (report: InvestmentReport) => BuildType;
}

export function CashFlowPageHero({ reports, filteredReports, dateRangeLabel, buildTypeFilter, getBuildType }: CashFlowPageHeroProps) {
  const buildTypeCounts = reports.reduce<Record<BuildType, number>>((counts, report) => {
    const buildType = getBuildType(report);
    counts[buildType] += 1;
    return counts;
  }, {
    new_build: 0,
    existing_property: 0,
    land_only: 0,
  });

  const representedBuildTypes = (Object.entries(buildTypeCounts) as Array<[BuildType, number]>).filter(([, count]) => count > 0);
  const weakRentCount = reports.filter((report) => resolveCashFlowFinancialSummary(report).weeklyRent === null).length;

  return (
    <Card className="glass-accent overflow-hidden text-foreground">
      <CardContent className="relative p-0">
        <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-brand-300 via-primary to-transparent" />

        <div className="relative grid gap-4 p-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.35fr)] xl:items-center xl:p-5">
          <div className="min-w-0 space-y-3">
            <div className="space-y-2">
              <Badge className="w-fit border-brand-300/30 bg-brand-300/10 text-brand-100 hover:bg-brand-300/10">
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                Cash Flow Intelligence Workspace
              </Badge>

              <div className="space-y-1.5">
                <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight md:text-2xl">
                  <span className="glass-inset rounded-lg p-1.5">
                    <Calculator className="h-5 w-5 text-primary" />
                  </span>
                  10-Year Cash Flow Analysis
                </h1>
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground md:text-sm">
                  Model rental growth, expenses, debt, equity and after-tax cash flow from generated reports.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {representedBuildTypes.length > 0 ? representedBuildTypes.map(([buildType, count]) => (
                <span key={buildType} className="glass-inset inline-flex items-center gap-1 rounded-full px-2.5 py-1">
                  {getBuildTypeIcon(buildType)}
                  {getBuildTypeLabel(buildType)}: {count}
                </span>
              )) : (
                <span className="glass-inset inline-flex items-center gap-1 rounded-full px-2.5 py-1">
                  <Building2 className="h-3.5 w-3.5" />
                  No build types represented yet
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <HeroMetric icon={BarChart3} label="Cash-flow-ready reports" value={reports.length.toLocaleString('en-AU')} />
            <HeroMetric icon={Filter} label="Visible reports" value={filteredReports.length.toLocaleString('en-AU')} />
            <HeroMetric icon={CalendarDays} label="Date range" value={dateRangeLabel} />
            <HeroMetric icon={Building2} label="Build types represented" value={representedBuildTypes.length.toLocaleString('en-AU')} detail={getFilterDetail(buildTypeFilter)} />
            {weakRentCount > 0 && (
              <HeroMetric
                icon={AlertTriangle}
                label="Missing/zero rent"
                value={weakRentCount.toLocaleString('en-AU')}
                detail="Loaded reports needing rent review"
                warning
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HeroMetric({ icon: Icon, label, value, detail, warning = false }: { icon: typeof Calculator; label: string; value: string; detail?: string; warning?: boolean }) {
  return (
    <div className={`min-h-[72px] rounded-lg border p-2.5 ${warning ? 'border-warning/30 bg-warning/10' : 'glass-inset'}`}>
      <div className="mb-1 flex items-start justify-between gap-1.5">
        <span className="text-[9px] font-semibold uppercase leading-3 tracking-wide text-muted-foreground">{label}</span>
        <span className={`rounded p-1 ${warning ? 'bg-warning/15 text-warning' : 'text-primary'}`}>
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <p className={`text-base font-bold capitalize leading-5 tabular-nums ${warning ? 'text-warning' : 'text-foreground'}`}>{value}</p>
      {detail && <p className="mt-0.5 line-clamp-1 text-[9px] leading-3 text-muted-foreground">{detail}</p>}
    </div>
  );
}

function getBuildTypeIcon(buildType: BuildType) {
  if (buildType === 'new_build') return <Building2 className="h-3.5 w-3.5" />;
  if (buildType === 'land_only') return <MapPin className="h-3.5 w-3.5" />;
  return <Home className="h-3.5 w-3.5" />;
}

function getFilterDetail(buildTypeFilter: BuildTypeFilter) {
  if (buildTypeFilter === 'all') return 'All build types selected';
  return `${getBuildTypeLabel(buildTypeFilter)} filter active`;
}

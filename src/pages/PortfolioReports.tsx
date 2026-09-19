import { useSearchParams, useNavigate } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { PortfolioAnalysisReportsList } from '@/components/clients/PortfolioAnalysisReportsList';
import { Button } from '@/components/ui/button';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { BarChart3, Sparkles, X } from 'lucide-react';

export default function PortfolioReports() {
  const { canEdit: canEditPortfolio, canDelete: canDeletePortfolio } = useModulePermissions('portfolio_reports');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get('clientId');

  return (
    <DashboardThemeFrame variant="hero" className="px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-7">
        {/* Header */}
        <div className="flex flex-col gap-5 rounded-3xl border border-border/70 bg-card/70 p-5 shadow-lg shadow-sm dark:shadow-black/10 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_48px_hsl(var(--primary)/0.10)] dark:border-white/10 dark:bg-background/35 dark:shadow-black/25 sm:flex-row sm:items-center sm:justify-between lg:p-7">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-400/10 text-brand-200 shadow-lg shadow-brand-950/30">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-400/20 bg-brand-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-brand-200">
                <Sparkles className="h-3.5 w-3.5" />
                Portfolio Intelligence
              </div>
              <h1 className="break-words text-[clamp(1.875rem,3vw,2.875rem)] font-bold leading-[1.08] tracking-[-0.035em] text-foreground dark:text-white">Portfolio Performance Reports</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground dark:text-foreground/90 sm:text-base">
                {clientId
                  ? 'Viewing reports for selected client'
                  : 'View all generated portfolio performance analysis reports across clients'}
              </p>
            </div>
          </div>
          {clientId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/portfolio-reports')}
              className="w-full justify-center border-primary/35 bg-background/40 text-primary transition-all hover:border-primary/60 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
            >
              <X className="mr-2 h-4 w-4" />
              Clear Filter
            </Button>
          )}
        </div>

        {/* Reports List */}
        <PortfolioAnalysisReportsList
          clientId={clientId || undefined}
          showHeader={true}
        />
      </div>
    </DashboardThemeFrame>
  );
}

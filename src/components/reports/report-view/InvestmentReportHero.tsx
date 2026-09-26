import { format } from 'date-fns';
import { AlertCircle, Calendar, CheckCircle2, FileText, GitBranch, ShieldAlert, Sparkles, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { InvestmentReport } from './types';
import { getInvestmentGradeTone, getInvestmentScoreSummary, getScoreTone } from './utils';
import { resolveInvestmentReportType } from '@/lib/reports/reportVariants';
import { ReportTypeBadge } from '@/components/reports/ReportTypeBadge';
import { generatedAtLabel, reportGeneratedAt } from '@/lib/reports/investment/reportGeneratedAt.pure';

interface Props {
  report: InvestmentReport;
  isClientReport: boolean;
  hasOverrides: boolean;
  reportTierLabel: string;
  reportVariantLabel: string;
  reportStatusLabel: string;
}

export function InvestmentReportHero({
  report,
  isClientReport,
  hasOverrides,
  reportTierLabel,
  reportVariantLabel,
  reportStatusLabel,
}: Props) {
  const overrideCount = report.manual_overrides ? Object.keys(report.manual_overrides).length : 0;
  const scoreSummary = getInvestmentScoreSummary(report);
  const scoreTone = getScoreTone(scoreSummary.score);
  const gradeTone = getInvestmentGradeTone(scoreSummary.grade);
  const isDerivedVariant = Boolean(report.derived_from_report_id);
  const reportType = resolveInvestmentReportType(report);
  // When this report was generated — a regeneration reuses the row, so
  // `created_at` would print the first generation's time.
  const generated = reportGeneratedAt(report);

  return (
    <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm">
      <CardContent className="p-0">
        <div className="border-b bg-background/40 p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> Investment Report</Badge>
                <ReportTypeBadge type={reportType} />
                {isDerivedVariant && <Badge variant="secondary" className="gap-1"><GitBranch className="h-3 w-3" /> Variant</Badge>}
                {isClientReport && <Badge variant="outline">Client-ready</Badge>}
                {hasOverrides && <Badge className="gap-1 bg-brand-600 text-foreground dark:text-white hover:bg-brand-600"><AlertCircle className="h-3 w-3" /> {overrideCount} Adjustment{overrideCount !== 1 ? 's' : ''}</Badge>}
              </div>

              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl xl:text-4xl">{report.property_address}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4" /> {generatedAtLabel(generated?.basis)} {format(new Date(generated?.at ?? report.created_at), 'PPpp')}</span>
                  <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" /> {isClientReport ? 'Client report' : 'Internal report'}</span>
                  {report.status && <span className="inline-flex items-center gap-1.5 capitalize"><CheckCircle2 className="h-4 w-4" /> {reportStatusLabel}</span>}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-background/70 p-4 shadow-sm xl:min-w-[300px]">
              <div className="flex items-center gap-4">
                <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold shadow-sm ${gradeTone}`}>
                  {scoreSummary.grade || '—'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Investment Grade</p>
                  {/*
                    * A withheld grade names its cause first — the scoring
                    * policy, not a failed calculation — and the client-facing
                    * sentence the record carries under it. It used to draw the
                    * record's literal "N/A" as the grade beside that sentence,
                    * which reads as a page that failed to populate.
                    */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scoreSummary.withheld
                      ? scoreSummary.withheld.statement
                      : (scoreSummary.recommendation || (scoreSummary.insufficient ? 'Insufficient data for a numeric investment score' : 'Score calculated from available report data'))}
                  </p>
                  {scoreSummary.withheld && scoreSummary.recommendation && (
                    <p className="mt-1 text-[11px] text-muted-foreground/80">{scoreSummary.recommendation}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Investment grade</p>
            <p className="mt-2 text-lg font-semibold">{scoreSummary.withheld ? 'Withheld' : (scoreSummary.grade || 'Not graded')}</p>
            {scoreSummary.withheld
              ? <p className="mt-1 text-xs text-muted-foreground">By the scoring policy</p>
              : scoreSummary.insufficient && <p className="mt-1 text-xs text-muted-foreground">Insufficient data</p>}
            {scoreSummary.evidenceCaution && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground" title={scoreSummary.evidenceCaution}>{scoreSummary.evidenceCaution}</p>}
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Score /100</p>
            {scoreSummary.insufficient ? (
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <ShieldAlert className="h-4 w-4" />
                {scoreSummary.withheld ? 'Withheld' : 'Insufficient data'}
              </div>
            ) : (
              <div className="mt-2 flex items-end gap-1">
                <Star className="mb-1 h-4 w-4 fill-brand-500 text-brand-500" />
                <span className={`text-2xl font-bold ${scoreTone}`}>{scoreSummary.score}</span>
                <span className="pb-1 text-sm text-muted-foreground">/100</span>
              </div>
            )}
            {scoreSummary.partialLabel && <p className="mt-1 text-xs text-muted-foreground">{scoreSummary.partialLabel}</p>}
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Report tier</p>
            <p className="mt-2 truncate text-lg font-semibold">{reportTierLabel}</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Manual overrides</p>
            <p className="mt-2 text-lg font-semibold">{overrideCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">{overrideCount === 0 ? 'No adjustments' : 'Adjusted fields'}</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Report status</p>
            <p className="mt-2 truncate text-lg font-semibold capitalize">{report.status ? reportStatusLabel : 'No status'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{isClientReport ? 'Client report' : 'Internal report'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

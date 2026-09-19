import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { CoverageResult } from '@/utils/threeYearCoverage';
import { Progress } from '@/components/ui/progress';

interface ThreeYearCoverageWarningProps {
  coverage: CoverageResult;
  label: string; // e.g. "Employment" or "Address"
  className?: string;
}

export function ThreeYearCoverageWarning({ coverage, label, className = '' }: ThreeYearCoverageWarningProps) {
  if (coverage.totalMonths === 0 && coverage.requiredMonths === 36) {
    // No records at all — show a neutral prompt
    return (
      <div className={`rounded-lg border border-border bg-muted/30 p-3 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          <span>Add {label.toLowerCase()} records with start dates to track 3-year history</span>
        </div>
      </div>
    );
  }

  if (coverage.isMet) {
    return (
      <div className={`rounded-lg border border-success/30 dark:border-success/30 bg-success/10 dark:bg-success/20 p-3 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-success dark:text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{label} — 3-year history met ({coverage.totalMonths} months)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/20 p-3 space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-sm text-brand-700 dark:text-brand-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium">{label} — {coverage.remainingMonths} months of history needed</span>
      </div>
      <Progress value={coverage.coveragePercent} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {coverage.totalMonths} of {coverage.requiredMonths} months covered ({coverage.coveragePercent}%)
        {!coverage.isMet && ' — Add previous records to meet the 3-year requirement'}
      </p>
      {coverage.gaps.length > 0 && (
        <div className="text-xs text-brand-600 dark:text-brand-500 space-y-0.5 pt-1 border-t border-brand-200/50 dark:border-brand-800/50">
          <span className="font-medium">Gaps detected:</span>
          {coverage.gaps.map((gap, i) => (
            <p key={i}>• {gap.from} → {gap.to} ({gap.months} months)</p>
          ))}
        </div>
      )}
    </div>
  );
}

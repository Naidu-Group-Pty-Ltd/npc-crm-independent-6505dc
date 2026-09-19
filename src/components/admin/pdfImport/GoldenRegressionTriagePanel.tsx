/**
 * GoldenRegressionTriagePanel — Phase 9B.
 * Renders a Phase 8F failure triage summary (top-line + recommendations). Pure display.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getRecoveryActionLabel,
  type PdfImportFailureTriageSeverity,
  type PdfImportFailureTriageSummary,
} from '@/lib/reportTemplate/ingestion/failureTriage';

interface GoldenRegressionTriagePanelProps {
  triage: PdfImportFailureTriageSummary | null;
}

function severityVariant(sev: PdfImportFailureTriageSeverity | string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (sev) {
    case 'info': return 'outline';
    case 'warning': return 'secondary';
    case 'error': return 'destructive';
    case 'critical': return 'destructive';
    default: return 'outline';
  }
}

export function GoldenRegressionTriagePanel({ triage }: GoldenRegressionTriagePanelProps) {
  if (!triage) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No triage generated yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Failure triage
          <Badge variant={severityVariant(triage.severity)}>{triage.severity}</Badge>
          <Badge variant="outline">{triage.outcome}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Primary owner</span><span className="font-medium">{triage.primaryOwner}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Primary action</span><span className="font-medium">{getRecoveryActionLabel(triage.primaryAction)}</span></div>
        </div>
        {triage.actionLabels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {triage.actionLabels.map((label) => (
              <Badge key={label} variant="outline" className="text-[10px] px-1 py-0">{label}</Badge>
            ))}
          </div>
        )}

        <Separator />

        {triage.recommendations.length === 0 ? (
          <div className="text-sm text-muted-foreground">No action required.</div>
        ) : (
          <div className="space-y-3">
            {triage.recommendations.map((rec) => (
              <div key={rec.rule.code} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{rec.rule.title}</span>
                  <Badge variant={severityVariant(rec.rule.severity)} className="text-[10px] px-1 py-0">{rec.rule.severity}</Badge>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{rec.rule.category}</Badge>
                  <span className="text-[11px] text-muted-foreground">owner: {rec.rule.owner}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground font-mono break-all">{rec.rule.code}</div>
                <div className="mt-1 text-xs"><span className="text-muted-foreground">Primary:</span> {getRecoveryActionLabel(rec.rule.primaryAction)}</div>
                {rec.rule.secondaryActions.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    <span className="text-muted-foreground">Then:</span>
                    {rec.rule.secondaryActions.map((a) => (
                      <Badge key={a} variant="outline" className="text-[10px] px-1 py-0">{getRecoveryActionLabel(a)}</Badge>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs">{rec.rule.operatorSummary}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{rec.rule.developerSummary}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default GoldenRegressionTriagePanel;

/**
 * RepairPatternAnalysisPanel — Phase 10C.
 * Pure display for the deterministic Repair Pattern Analysis. Advisory only; no
 * network, no repair application.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatRepairPatternScore,
  getRepairPatternLabel,
  getRepairPatternSeverityLabel,
  getRepairPatternSeverityTone,
  getRepairPatternStrategyLabel,
  getRepairPatternOperatorReviewLabel,
  type RepairPatternAnalysis,
} from '@/lib/reportTemplate/ingestion/repairPatterns';

interface RepairPatternAnalysisPanelProps {
  analysis: RepairPatternAnalysis | null;
}

const DASH = '—';
const text = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || v === '' ? DASH : String(v);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

export function RepairPatternAnalysisPanel({ analysis }: RepairPatternAnalysisPanelProps) {
  if (!analysis) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Repair pattern analysis</CardTitle></CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No repair pattern analysis generated.
        </CardContent>
      </Card>
    );
  }

  const topEvidence = analysis.evidence.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Repair pattern analysis
          <Badge variant={getRepairPatternSeverityTone(analysis.overallSeverity)}>
            {getRepairPatternLabel(analysis.primaryPatternId)}
          </Badge>
          <Badge variant={getRepairPatternSeverityTone(analysis.overallSeverity)}>
            {getRepairPatternSeverityLabel(analysis.overallSeverity)}
          </Badge>
          <Badge variant="outline">Confidence {formatRepairPatternScore(analysis.overallConfidence)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="text-xs font-medium mb-1">Strategy</div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Deterministic repair">{getRepairPatternStrategyLabel(analysis.deterministicRepairStrategy)}</Row>
            <Row label="AI reconciliation">{analysis.aiReconciliationUsefulness}</Row>
            <Row label="Export parity">{analysis.exportParityRequirement}</Row>
            <Row label="Operator review">{getRepairPatternOperatorReviewLabel(analysis.operatorReviewRequirement)}</Row>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">Matched patterns ({analysis.matchedPatterns.length})</div>
          {analysis.matchedPatterns.length === 0 ? (
            <div className="text-xs text-muted-foreground">No patterns matched.</div>
          ) : (
            <div className="space-y-1">
              {analysis.matchedPatterns.map((m) => (
                <div key={m.patternId} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getRepairPatternSeverityTone(m.severity)} className="text-[10px]">
                      {getRepairPatternLabel(m.patternId)}
                    </Badge>
                    <span className="text-muted-foreground">{m.category}</span>
                    <span className="text-muted-foreground">· {getRepairPatternSeverityLabel(m.severity)}</span>
                    <span className="text-muted-foreground">· score {formatRepairPatternScore(m.score)}</span>
                    <span className="text-muted-foreground">· conf {formatRepairPatternScore(m.confidence)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Action: <span className="text-foreground">{m.recommendedAction}</span> · Fallback: {m.manualFallback}
                  </div>
                  <div className="text-muted-foreground">{m.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {topEvidence.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">Evidence</div>
            <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
              {topEvidence.map((e, i) => (
                <li key={`${e.code}-${i}`} className="break-all">
                  <span className="font-medium text-foreground">{e.label}:</span> {text(e.value)} — {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium mb-1">Warnings ({analysis.warnings.length})</div>
            {analysis.warnings.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {analysis.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Blockers ({analysis.blockers.length})</div>
            {analysis.blockers.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs text-destructive space-y-0.5">
                {analysis.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default RepairPatternAnalysisPanel;

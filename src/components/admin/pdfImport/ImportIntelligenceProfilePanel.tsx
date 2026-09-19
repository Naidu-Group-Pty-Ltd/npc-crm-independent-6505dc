/**
 * ImportIntelligenceProfilePanel — Phase 10B.
 * Pure display for the deterministic Import Intelligence Profile. No network.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatImportIntelligenceScore,
  getImportIntelligenceCategoryLabel,
  getImportIntelligenceCategoryTone,
  getImportIntelligenceRiskLabel,
  getImportIntelligenceRiskTone,
  type ImportIntelligenceProfile,
} from '@/lib/reportTemplate/ingestion/importIntelligence';

interface ImportIntelligenceProfilePanelProps {
  profile: ImportIntelligenceProfile | null;
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

export function ImportIntelligenceProfilePanel({ profile }: ImportIntelligenceProfilePanelProps) {
  if (!profile) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Import intelligence profile</CardTitle></CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No import intelligence profile generated.
        </CardContent>
      </Card>
    );
  }

  const { scores, signals, recommendations } = profile;
  const topEvidence = profile.evidence.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Import intelligence profile
          <Badge variant={getImportIntelligenceCategoryTone(profile.profileCategory)}>
            {getImportIntelligenceCategoryLabel(profile.profileCategory)}
          </Badge>
          <Badge variant={getImportIntelligenceRiskTone(profile.riskLevel)}>
            {getImportIntelligenceRiskLabel(profile.riskLevel)}
          </Badge>
          <Badge variant="outline">Confidence {formatImportIntelligenceScore(profile.confidence)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
          <Row label="Complexity">{formatImportIntelligenceScore(scores.complexityScore)}</Row>
          <Row label="OCR risk">{formatImportIntelligenceScore(scores.ocrRiskScore)}</Row>
          <Row label="Table risk">{formatImportIntelligenceScore(scores.tableRiskScore)}</Row>
          <Row label="Image risk">{formatImportIntelligenceScore(scores.imageRiskScore)}</Row>
          <Row label="Design risk">{formatImportIntelligenceScore(scores.designRiskScore)}</Row>
          <Row label="Automation risk">{formatImportIntelligenceScore(scores.automationRiskScore)}</Row>
          <Row label="Manual review likelihood">{formatImportIntelligenceScore(scores.manualReviewLikelihood)}</Row>
        </div>

        <div className="rounded-md border bg-muted/30 p-2">
          <div className="text-xs font-medium mb-1">Recommendations</div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Visual QA">{recommendations.visualQaStrategy}</Row>
            <Row label="Repair">{recommendations.repairStrategy}</Row>
            <Row label="AI reconciliation">{recommendations.aiReconciliationStrategy}</Row>
            <Row label="Export parity">{recommendations.exportParityStrategy}</Row>
            <Row label="Operator">{recommendations.operatorStrategy}</Row>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
          <Row label="Page count">{text(signals.pageCount)}</Row>
          <Row label="Table estimate">{text(signals.tableCountEstimate)}</Row>
          <Row label="Image estimate">{text(signals.imageCountEstimate)}</Row>
          <Row label="Text density">{formatImportIntelligenceScore(signals.textDensityEstimate)}</Row>
          <Row label="Visual QA score">{formatImportIntelligenceScore(signals.visualQaScore)}</Row>
          <Row label="Repair status">{text(signals.repairStatus)}</Row>
          <Row label="Export parity status">{text(signals.exportParityStatus)}</Row>
          <Row label="Baseline outcome">{text(signals.baselineOutcome)}</Row>
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
            <div className="text-xs font-medium mb-1">Warnings ({profile.warnings.length})</div>
            {profile.warnings.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {profile.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Blockers ({profile.blockers.length})</div>
            {profile.blockers.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs text-destructive space-y-0.5">
                {profile.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ImportIntelligenceProfilePanel;

/**
 * GoldenRegressionSnapshotPanel — Phase 9B.
 * Renders the import quality snapshot from a Phase 9A orchestrator result.
 * Pure display; no network calls.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { GoldenCorpusImportQualitySnapshot } from '@/lib/reportTemplate/ingestion/goldenCorpus';

interface GoldenRegressionSnapshotPanelProps {
  snapshot: GoldenCorpusImportQualitySnapshot | null;
}

const DASH = '—';
const pct = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : DASH;
const text = (v: string | null | undefined) => (v && String(v).trim() !== '' ? v : DASH);
const yesNo = (v: boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : DASH);
const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : DASH);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

function ArtifactBadge({ path }: { path: string | null | undefined }) {
  return path ? <Badge variant="outline">Present</Badge> : <Badge variant="secondary">Missing</Badge>;
}

export function GoldenRegressionSnapshotPanel({ snapshot }: GoldenRegressionSnapshotPanelProps) {
  if (!snapshot) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No import snapshot loaded yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Import</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Import ID"><span className="font-mono text-xs">{text(snapshot.importId)}</span></Row>
          <Row label="Template ID"><span className="font-mono text-xs">{text(snapshot.templateId)}</span></Row>
          <Row label="Source filename">{text(snapshot.sourceFilename)}</Row>
          <Row label="Import status">{text(snapshot.importStatus)}</Row>
          <Row label="Engine version">{text(snapshot.engineVersion)}</Row>
          <Row label="Import page count">{num(snapshot.importPageCount)}</Row>
          <Row label="Template page count">{num(snapshot.templatePageCount)}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Visual QA</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Artifact"><ArtifactBadge path={snapshot.visualQaArtifactPath} /></Row>
          <Row label="Score">{pct(snapshot.visualQaScore)}</Row>
          <Row label="Manual review required">{yesNo(snapshot.visualQaManualReviewRequired)}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Repair</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Artifact"><ArtifactBadge path={snapshot.repairArtifactPath} /></Row>
          <Row label="Status">{text(snapshot.repairStatus)}</Row>
          <Row label="Final score">{pct(snapshot.repairFinalScore)}</Row>
          <Row label="Requires fallback">{yesNo(snapshot.repairRequiresFallback)}</Row>
          <Row label="Requires manual review">{yesNo(snapshot.repairRequiresManualReview)}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">AI reconciliation</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Status">{text(snapshot.aiReconciliationStatus)}</Row>
          <Row label="Recommendation">{text(snapshot.aiReconciliationRecommendation)}</Row>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Export parity</CardTitle></CardHeader>
        <CardContent className="pt-0 grid gap-x-8 gap-y-1 md:grid-cols-2">
          <Row label="Artifact"><ArtifactBadge path={snapshot.exportParityArtifactPath} /></Row>
          <Row label="Status">{text(snapshot.exportParityStatus)}</Row>
          <Row label="Mode">{text(snapshot.exportParityMode)}</Row>
          <Row label="Export vs source">{pct(snapshot.exportVsSourceScore)}</Row>
          <Row label="Editor vs source">{pct(snapshot.editorVsSourceScore)}</Row>
          <Row label="Export vs editor">{pct(snapshot.exportVsEditorScore)}</Row>
        </CardContent>
      </Card>
    </div>
  );
}

export default GoldenRegressionSnapshotPanel;

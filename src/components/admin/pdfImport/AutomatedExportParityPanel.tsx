/**
 * AutomatedExportParityPanel — Phase 9D.
 * Pure display for the export parity runner result: status, automation level,
 * mode, persistence, the three pair scores, blockers/warnings, and per-page
 * source-vs-editor comparisons.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ExportParityRunnerResult } from '@/lib/reportTemplate/ingestion/exportParity';

interface AutomatedExportParityPanelProps {
  result: ExportParityRunnerResult | null;
}

const DASH = '—';
const pct = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : DASH;

function statusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed': return 'default';
    case 'partial': return 'secondary';
    case 'manual_required': return 'secondary';
    case 'failed': return 'destructive';
    default: return 'outline'; // not_ready
  }
}

function pairStatusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'pass': return 'default';
    case 'warning': return 'secondary';
    case 'fail': return 'destructive';
    case 'manual_required': return 'secondary';
    default: return 'outline';
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

export function AutomatedExportParityPanel({ result }: AutomatedExportParityPanelProps) {
  if (!result) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Export parity automation has not run.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Export parity automation
            <Badge variant={statusTone(result.status)}>{result.status}</Badge>
            <Badge variant="outline">{result.automationLevel}</Badge>
            <Badge variant="outline">{result.mode}</Badge>
            <Badge variant={result.persisted ? 'default' : 'outline'}>
              {result.persisted ? 'Persisted' : 'Not persisted'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid gap-x-8 gap-y-0 md:grid-cols-2">
          <Row label="Export vs source">{pct(result.scores.exportVsSourceScore)}</Row>
          <Row label="Editor vs source">{pct(result.scores.editorVsSourceScore)}</Row>
          <Row label="Export vs editor">{pct(result.scores.exportVsEditorScore)}</Row>
          <Row label="Overall">{pct(result.scores.overallScore)}</Row>
          <Row label="Generated at">{result.generatedAt}</Row>
          {result.persistenceError && (
            <Row label="Persistence error"><span className="text-destructive text-xs">{result.persistenceError}</span></Row>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Blockers ({result.blockers.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {result.blockers.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{result.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Warnings ({result.warnings.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {result.warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{result.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      {result.pageComparisons.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Page comparisons ({result.pageComparisons.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {result.pageComparisons.map((c, i) => (
              <div key={`${c.pageNumber}-${c.pair}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant={pairStatusTone(c.status)} className="text-[10px]">{c.status}</Badge>
                  <span className="font-medium">Page {c.pageNumber}</span>
                  <span className="text-muted-foreground text-xs">{c.pair}</span>
                </span>
                <span className="text-right text-xs font-medium">{pct(c.score)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default AutomatedExportParityPanel;

/**
 * GoldenRegressionHistoryPanel — Phase 9C.
 *
 * Compact, read-only view of the golden run history ledger for a corpus/import.
 * It only calls `listGoldenRunHistory`; history is written by the orchestrator's
 * save step, never here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw, History } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  getGoldenRunBaselineOutcomeLabel,
  getGoldenRunBaselineOutcomeTone,
  listGoldenRunHistory,
  type GoldenRunHistoryRecord,
} from '@/lib/reportTemplate/ingestion/goldenCorpus';

interface GoldenRegressionHistoryPanelProps {
  corpusId?: string | null;
  importId?: string | null;
  /** Bump to force a refetch (e.g. after a new run is saved). */
  refreshKey?: number;
}

const DASH = '—';
const text = (v: string | null | undefined) => (v && String(v).trim() !== '' ? v : DASH);
const pct = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : DASH;

function gateTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'pass') return 'default';
  if (status === 'warning') return 'secondary';
  if (status === 'not_evaluated') return 'outline';
  return 'destructive';
}

export function GoldenRegressionHistoryPanel({
  corpusId,
  importId,
  refreshKey,
}: GoldenRegressionHistoryPanelProps) {
  const [records, setRecords] = useState<GoldenRunHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    if (!corpusId && !importId) {
      setErrorMessage('Provide a corpus or import to load history.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    const res = await listGoldenRunHistory({ corpusId, importId, limit: 50 });
    setLoading(false);
    setLoadedOnce(true);
    if (res.kind === 'error') {
      setErrorMessage(res.message);
      toast.error(`History load failed: ${res.message}`);
      return;
    }
    setRecords(res.history);
  }, [corpusId, importId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpusId, importId, refreshKey]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> Run history ({records.length})
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCcw className="h-3 w-3 mr-1" />}
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {errorMessage ? (
          <div className="text-sm text-destructive break-all">{errorMessage}</div>
        ) : records.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {loadedOnce ? 'No history yet for this corpus/import.' : 'Loading…'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Run ID</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="text-right">Visual QA</TableHead>
                  <TableHead className="text-right">Repair</TableHead>
                  <TableHead className="text-right">Export</TableHead>
                  <TableHead className="text-right">W / F</TableHead>
                  <TableHead>Baseline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{text(r.createdAt)}</TableCell>
                    <TableCell className="font-mono text-[11px] max-w-[160px] truncate" title={r.runId}>{text(r.runId)}</TableCell>
                    <TableCell><Badge variant={gateTone(r.qualityGateStatus)} className="text-[10px]">{r.qualityGateStatus}</Badge></TableCell>
                    <TableCell className="text-xs">{r.operatorDecision}</TableCell>
                    <TableCell className="text-right text-xs">{pct(r.visualQaScore)}</TableCell>
                    <TableCell className="text-right text-xs">{pct(r.repairFinalScore)}</TableCell>
                    <TableCell className="text-right text-xs">{pct(r.exportVsSourceScore)}</TableCell>
                    <TableCell className="text-right text-xs">{r.warningCount} / {r.failureCount}</TableCell>
                    <TableCell>
                      {r.baselineComparison ? (
                        <Badge variant={getGoldenRunBaselineOutcomeTone(r.baselineComparison.outcome)} className="text-[10px]">
                          {getGoldenRunBaselineOutcomeLabel(r.baselineComparison.outcome)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">{DASH}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default GoldenRegressionHistoryPanel;

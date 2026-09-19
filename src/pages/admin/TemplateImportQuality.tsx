/**
 * TemplateImportQuality — Phase 8 diagnostics dashboard for the Visual Import
 * Quality contract (Phases 4–6) and provider fallback hooks (Phase 7).
 *
 * Lists recent template imports with their persisted visual-quality summary,
 * aggregate stats (success rate, average overall score, manual-review count,
 * repair passes, final-mode mix), and opens the per-import review dialog with
 * full per-page rasters / scores / warnings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert, Sparkles, Eye, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { VisualQualityReviewDialog } from '@/components/templateBuilder/VisualQualityReviewDialog';
import {
  getGoldenRegressionDisplayState,
  type GoldenRegressionDisplayTone,
} from '@/lib/reportTemplate/ingestion/goldenCorpus';

interface VqSummary {
  overallScore: number | null;
  pageCount: number;
  manualReviewRequired: boolean;
  finalMode: 'semantic' | 'hybrid' | 'pixel-perfect' | null;
  repairPassesApplied: number;
  generatedAt: string;
}

interface ImportRow {
  id: string;
  user_id: string | null;
  status: string;
  fidelity_mode: string | null;
  source_filename: string | null;
  page_count: number | null;
  created_at: string;
  error: string | null;
  visual_quality_artifact_path: string | null;
  visual_quality: VqSummary | null;
  cdir_fidelity_summary: {
    overallScore?: number | null;
    textAccuracy?: number | null;
    warningCount?: number | null;
  } | null;
  provider_attempts: Array<{
    providerId: string;
    engine: string;
    outcome: 'success' | 'failure' | 'skipped';
    durationMs: number;
    error?: { kind: string; message: string };
  }> | null;
  // Phase 7F — export parity
  export_parity_artifact_path: string | null;
  export_parity: {
    status: string | null;
    mode: string | null;
    editorVsSourceScore: number | null;
    exportVsSourceScore: number | null;
    exportVsEditorScore: number | null;
    manualReviewRequired: boolean | null;
    problemCount: number | null;
    persistedAt: string | null;
  } | null;
  // Phase 8E — golden regression summary (normalized by list_visual_quality)
  golden_regression?: GoldenRegressionSummaryRow | null;
}

interface GoldenRegressionSummaryRow {
  version: string | null;
  runId: string | null;
  runBatchId: string | null;
  corpusId: string | null;
  category: string | null;
  qualityGateStatus: 'pass' | 'warning' | 'fail' | 'blocked' | 'not_evaluated' | string | null;
  operatorDecision: string | null;
  runStatus: string | null;
  runDecision: string | null;
  warningCount: number | null;
  failureCount: number | null;
  warnings: string[];
  failures: string[];
  generatedAt: string | null;
  persistedAt: string | null;
}

/** Map the display helper's tone to an available shadcn Badge variant. */
function goldenToneToVariant(
  tone: GoldenRegressionDisplayTone,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (tone) {
    case 'success': return 'default';
    case 'destructive': return 'destructive';
    case 'warning': return 'secondary';
    case 'secondary': return 'secondary';
    default: return 'outline';
  }
}

/** Compact golden-regression display for a dashboard row. */
function goldenDisplayForRow(row: ImportRow) {
  const g = row.golden_regression ?? null;
  const disp = getGoldenRegressionDisplayState({
    qualityGateStatus: g?.qualityGateStatus ?? null,
    operatorDecision: g?.operatorDecision ?? null,
    warningCount: g?.warningCount ?? null,
    failureCount: g?.failureCount ?? null,
    exportParityStatus: row.export_parity?.status ?? null,
    manualReviewRequired: row.visual_quality?.manualReviewRequired ?? null,
  });
  return { g, disp };
}

/** Compact export-parity badge content for the diagnostics table. */
function exportParityDisplay(ep: ImportRow['export_parity']): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (!ep || !ep.status) return { label: 'Not run', variant: 'outline' };
  if (ep.status === 'failed') return { label: 'Failed', variant: 'destructive' };
  if (ep.status === 'manual_required') return { label: 'Manual required', variant: 'secondary' };
  if (ep.status === 'completed') {
    const best = [ep.exportVsSourceScore, ep.exportVsEditorScore, ep.editorVsSourceScore]
      .find((s): s is number => typeof s === 'number' && Number.isFinite(s));
    return {
      label: best != null ? `Completed · ${Math.round(best * 100)}%` : 'Completed',
      variant: best != null ? scoreTone(best) : 'default',
    };
  }
  return { label: ep.status, variant: 'outline' };
}


interface StatsResponse {
  total: number;
  with_report: number;
  manual_review: number;
  avg_score: number | null;
  repair_passes_total: number;
  by_final_mode: Record<string, number>;
  golden?: {
    total: number;
    pass: number;
    warning: number;
    fail: number;
    blocked: number;
    not_evaluated: number;
    needs_review: number;
  } | null;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function scoreTone(score: number | null | undefined):
  'default' | 'secondary' | 'destructive' | 'outline' {
  if (score === null || score === undefined) return 'outline';
  if (score >= 0.92) return 'default';
  if (score >= 0.8) return 'secondary';
  if (score >= 0.65) return 'outline';
  return 'destructive';
}

export default function TemplateImportQuality() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyWithReport, setOnlyWithReport] = useState<'with' | 'all'>('with');
  const [manualReviewOnly, setManualReviewOnly] = useState<'all' | 'manual'>('all');
  const [finalMode, setFinalMode] = useState<string>('all');
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invokeSecureFunction<{ rows: ImportRow[]; stats: StatsResponse }>(
        'template-import-pdf',
        {
          body: {
            operation: 'list_visual_quality',
            limit: 100,
            only_with_report: onlyWithReport === 'with',
            manual_review_only: manualReviewOnly === 'manual',
            final_mode: finalMode === 'all' ? null : finalMode,
          },
        } as any,
      );
      if (res.error) {
        const friendly = describeAuthError(res.error.message);
        toast.error(friendly ?? res.error.message);
        setRows([]); setStats(null);
        return;
      }
      setRows(res.data?.rows ?? []);
      setStats(res.data?.stats ?? null);
    } finally {
      setLoading(false);
    }
  }, [onlyWithReport, manualReviewOnly, finalMode]);

  useEffect(() => { load(); }, [load]);

  const modeMixLabel = useMemo(() => {
    if (!stats?.by_final_mode) return '—';
    const entries = Object.entries(stats.by_final_mode).filter(([, n]) => n > 0);
    if (!entries.length) return '—';
    return entries.map(([k, n]) => `${k}:${n}`).join(' · ');
  }, [stats]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Template Import Quality</h1>
          <p className="text-sm text-muted-foreground">
            Visual Import Quality (Phases 4–6) + provider fallback diagnostics. Inspect
            per-import scores, manual-review flags, repair passes, and open the per-page
            review surface (Source / Generated / Diff).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Imports</div>
          <div className="text-2xl font-bold">{stats?.total ?? '—'}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">With VQ report</div>
          <div className="text-2xl font-bold">{stats?.with_report ?? '—'}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Avg overall</div>
          <div className="text-2xl font-bold">{pct(stats?.avg_score ?? null)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Manual review
          </div>
          <div className="text-2xl font-bold">{stats?.manual_review ?? '—'}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Repair passes
          </div>
          <div className="text-2xl font-bold">{stats?.repair_passes_total ?? '—'}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Final-mode mix</div>
          <div className="text-sm font-semibold truncate">{modeMixLabel}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Golden runs</div>
          <div className="text-2xl font-bold">{stats?.golden?.total ?? 0}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Pass {stats?.golden?.pass ?? 0} · Warn {stats?.golden?.warning ?? 0} ·
            {' '}Fail {(stats?.golden?.fail ?? 0) + (stats?.golden?.blocked ?? 0)}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent imports</CardTitle>
          <div className="flex gap-2">
            <Select value={onlyWithReport} onValueChange={(v) => setOnlyWithReport(v as any)}>
              <SelectTrigger className="w-[170px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="with">With VQ report</SelectItem>
                <SelectItem value="all">All imports</SelectItem>
              </SelectContent>
            </Select>
            <Select value={manualReviewOnly} onValueChange={(v) => setManualReviewOnly(v as any)}>
              <SelectTrigger className="w-[170px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any review state</SelectItem>
                <SelectItem value="manual">Manual review only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={finalMode} onValueChange={setFinalMode}>
              <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All final modes</SelectItem>
                <SelectItem value="semantic">semantic</SelectItem>
                <SelectItem value="hybrid">hybrid</SelectItem>
                <SelectItem value="pixel-perfect">pixel-perfect</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Overall</TableHead>
                  <TableHead>Final mode</TableHead>
                  <TableHead className="text-right">Repairs</TableHead>
                  <TableHead>Export</TableHead>
                  <TableHead>Golden</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Providers</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>

              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                      No imports match the current filters.
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => {
                  const vq = row.visual_quality;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelative(row.created_at)}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        <span className="text-sm">{row.source_filename ?? row.id.slice(0, 8)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'failed' ? 'destructive'
                          : row.status === 'processing' ? 'secondary' : 'outline'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {vq?.pageCount ?? row.page_count ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={scoreTone(vq?.overallScore ?? null)}>
                          {pct(vq?.overallScore ?? null)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{vq?.finalMode ?? '—'}</TableCell>
                      <TableCell className="text-right">{vq?.repairPassesApplied ?? 0}</TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const ep = exportParityDisplay(row.export_parity);
                          return (
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={ep.variant} className="text-[10px] px-1 py-0">{ep.label}</Badge>
                              {row.export_parity?.manualReviewRequired && row.export_parity?.status !== 'manual_required' ? (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">Review</Badge>
                              ) : null}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const { g, disp } = goldenDisplayForRow(row);
                          if (!g) {
                            return <Badge variant="outline" className="text-[10px] px-1 py-0">Not run</Badge>;
                          }
                          const counts: string[] = [];
                          if ((g.failureCount ?? 0) > 0) counts.push(`${g.failureCount}F`);
                          if ((g.warningCount ?? 0) > 0) counts.push(`${g.warningCount}W`);
                          const suffix = counts.length ? ` · ${counts.join(' ')}` : '';
                          return (
                            <div
                              className="flex flex-col gap-0.5"
                              title={[...(g.failures ?? []), ...(g.warnings ?? [])].slice(0, 4).join('\n') || undefined}
                            >
                              <span className="text-[10px] text-muted-foreground truncate max-w-[130px]">{g.corpusId ?? '—'}</span>
                              <Badge variant={goldenToneToVariant(disp.tone)} className="text-[10px] px-1 py-0 w-fit">
                                {disp.label}{suffix}
                              </Badge>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const { disp } = goldenDisplayForRow(row);
                          const variant = disp.actionRequired === 'fix' || disp.actionRequired === 'rerun'
                            ? 'destructive'
                            : disp.actionRequired === 'review' ? 'secondary' : 'outline';
                          return (
                            <Badge variant={variant} className="text-[10px] px-1 py-0">{disp.actionLabel}</Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.provider_attempts && row.provider_attempts.length > 0 ? (
                          <div className="flex flex-wrap gap-1" title={row.provider_attempts.map(a => `${a.providerId}: ${a.outcome}${a.error ? ` (${a.error.kind})` : ''} · ${a.durationMs}ms`).join('\n')}>
                            {row.provider_attempts.map((a, i) => (
                              <Badge
                                key={i}
                                variant={a.outcome === 'success' ? 'default' : a.outcome === 'failure' ? 'destructive' : 'outline'}
                                className="text-[10px] px-1 py-0"
                              >
                                {a.providerId}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {vq?.manualReviewRequired && (
                          <Badge variant="destructive" className="gap-1">
                            <ShieldAlert className="h-3 w-3" /> Manual
                          </Badge>
                        )}
                        {row.error && (
                          <Badge variant="destructive" className="gap-1 ml-1">
                            <AlertTriangle className="h-3 w-3" /> error
                          </Badge>
                        )}
                        {row.golden_regression && (row.golden_regression.failureCount ?? 0) > 0 && (
                          <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">Gate fail</Badge>
                        )}
                        {row.golden_regression
                          && (row.golden_regression.failureCount ?? 0) === 0
                          && (row.golden_regression.warningCount ?? 0) > 0 && (
                          <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">Gate warn</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!row.visual_quality_artifact_path}
                            onClick={() => setReviewing(row.id)}
                          >
                            <Eye className="h-3 w-3 mr-1" /> Review
                          </Button>
                          <Button asChild variant="ghost" size="sm" title="Open in Golden Regression console">
                            <Link
                              to={`/admin/pdf-golden-regression?importId=${encodeURIComponent(row.id)}${
                                row.golden_regression?.corpusId
                                  ? `&corpusId=${encodeURIComponent(row.golden_regression.corpusId)}`
                                  : ''
                              }`}
                            >
                              <ClipboardCheck className="h-3 w-3 mr-1" /> Golden
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <VisualQualityReviewDialog
        open={!!reviewing}
        onOpenChange={(open) => { if (!open) setReviewing(null); }}
        importId={reviewing}
      />
    </div>
  );
}

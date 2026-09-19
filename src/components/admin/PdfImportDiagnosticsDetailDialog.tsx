/**
 * PdfImportDiagnosticsDetailDialog — the C8 per-job drill-down.
 *
 * Fetches the correlated raw rows for one job (operation:'detail', superadmin-
 * mediated) and shapes them with the pure `buildDiagnosticsDetail` builder, so
 * the panel and the contract share one tested implementation. Surfaces the
 * job ↔ import ↔ template correlation, timings, page coverage, the C3-C6 quality
 * rollup, per-category failed pages (kept distinct, never collapsed), the chunk
 * breakdown, per-page verdicts, and short-lived signed artifact links.
 */
import { useEffect, useState } from 'react';
import { Loader2, Download, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import {
  buildDiagnosticsDetail,
  formatPageRanges,
  type DiagnosticsDetail,
  type DiagnosticsRawJob,
  type DiagnosticsGateSummary,
  type DiagnosticsChunkRow,
  type FailedPageCategory,
} from '@/lib/reportTemplate/ingestion/diagnostics/pdfImportDiagnosticsV2';
import {
  buildOperationalMetricsSummary,
  type OperationalMetricsSummary,
  type MetricTimingCell,
} from '@/lib/reportTemplate/ingestion/diagnostics/pdfImportOperationalMetricsSummary';

interface DetailResponse {
  job: DiagnosticsRawJob;
  importId: string | null;
  gate: DiagnosticsGateSummary | null;
  chunks: DiagnosticsChunkRow[];
  missingArtifactPages: number[];
  signedUrls: Record<string, string>;
}

interface Props {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FAILED_CATEGORY_COPY: Record<FailedPageCategory, { label: string; help: string; variant: 'destructive' | 'warning' | 'secondary' }> = {
  infra_failure: { label: 'Infra failure', help: 'Failed chunk / parse leaves', variant: 'destructive' },
  unscored: { label: 'Unscored', help: 'Not covered by visual QA', variant: 'warning' },
  manual_review: { label: 'Manual review', help: 'Low confidence / fallback unavailable', variant: 'warning' },
  missing_artifacts: { label: 'Missing artifacts', help: 'No per-page source artifact', variant: 'secondary' },
};

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function ms(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.floor((value % 60_000) / 1000)}s`;
}

const CONTAINMENT_ACTION_LABEL: Record<string, string> = {
  force_hybrid_fallback: 'Chart protected — source page',
  force_pixel_fallback: 'Unsafe/critical — source page',
  block_manual_review: 'Blocked — review (no source raster)',
  native_review: 'Native — review',
  allow_native: 'Native',
};

const METRIC_STATE_COPY: Record<string, string> = {
  measured: '',
  not_applicable: 'n/a',
  unavailable: 'unavailable',
  not_completed: 'not completed',
  failed_before_phase: 'failed before phase',
  not_observable_in_same_delivery: 'not observable',
  legacy: 'legacy sidecar',
  cache_hit: '',
  invalid: 'invalid',
};

/** One labelled timing cell: a null value is a state ("—" / label), never 0 ms. */
function MetricCell({ cell }: { cell: MetricTimingCell }) {
  const suffix = cell.aggregate === 'total' ? ' total' : cell.aggregate === 'slowest' ? ' (slowest)' : '';
  const stateLabel = cell.state !== 'measured' && cell.state !== 'cache_hit' ? METRIC_STATE_COPY[cell.state] ?? cell.state : '';
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1">
      <span className="text-xs text-muted-foreground">
        {cell.label}
        {cell.subsetOfUpload && <span className="ml-1 text-[10px] italic text-muted-foreground/70">(⊆ upload)</span>}
      </span>
      <span className="text-right text-xs font-medium tabular-nums">
        {cell.ms === null ? (
          <span className="text-muted-foreground">— {stateLabel && <span className="text-[10px]">{stateLabel}</span>}</span>
        ) : (
          `${ms(cell.ms)}${suffix}`
        )}
      </span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-right text-xs font-medium ${mono ? 'font-mono break-all' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

export function PdfImportDiagnosticsDetailDialog({ jobId, open, onOpenChange }: Props) {
  const [detail, setDetail] = useState<DiagnosticsDetail | null>(null);
  const [metrics, setMetrics] = useState<OperationalMetricsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setMetrics(null);
    (async () => {
      const res = await invokeSecureFunction<DetailResponse>('pdf-import-diagnostics', { operation: 'detail', jobId });
      if (cancelled) return;
      if (res.error || !res.data?.job) {
        toast.error(describeAuthError(res.error?.message ?? '') ?? res.error?.message ?? 'Could not load import detail');
        setLoading(false);
        return;
      }
      const job = res.data.job;
      setDetail(buildDiagnosticsDetail({
        job,
        importId: res.data.importId,
        gate: res.data.gate,
        chunks: res.data.chunks,
        missingArtifactPages: res.data.missingArtifactPages,
        signedUrls: res.data.signedUrls,
      }));
      // C11 — read-time operational-metrics summary (labelled, honest states).
      setMetrics(buildOperationalMetricsSummary({
        operationalMetrics: job.operational_metrics,
        cacheHit: job.cache_hit,
        cacheSourceJobId: job.cache_source_job_id,
        durationMs: job.duration_ms,
        planMs: job.plan_payload?.plan_ms,
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Import diagnostics detail</DialogTitle>
          <DialogDescription>Correlated job ↔ import ↔ template view with quality, failed pages, chunks, and artifacts.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading correlated detail…
            </div>
          ) : !detail ? (
            <Card className="p-4 text-sm text-muted-foreground">No detail is available for this job.</Card>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Card className="p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Correlation</div>
                  <Field label="Job" value={detail.correlation.jobId} mono />
                  <Field label="Import" value={detail.correlation.importId} mono />
                  <Field label="Template" value={detail.correlation.templateId} mono />
                  <Field label="File" value={detail.correlation.filename} />
                  <Field label="Hash" value={detail.correlation.fileHash} mono />
                </Card>
                <Card className="p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Routing & timing</div>
                  <Field label="Status" value={detail.status} />
                  <Field label="Requested mode" value={detail.modes.requested} />
                  <Field label="Effective mode" value={detail.modes.effective} />
                  <Field label="Lane" value={detail.modes.lane} />
                  <Field label="Service class" value={detail.modes.serviceClass} />
                  <Field label="Elapsed" value={ms(detail.timings.elapsedMs)} />
                  <Field label="Cloud Run" value={ms(detail.timings.cloudRunMs)} />
                </Card>
              </div>

              <Card className="p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality (C3–C6)</div>
                <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                  <Field label="Final score" value={pct(detail.quality.finalScore)} />
                  <Field label="Coverage" value={detail.quality.coverage ?? '—'} />
                  <Field label="Repair passes" value={detail.quality.repairPasses} />
                  <Field label="Manual review" value={detail.quality.manualReviewRequired === null ? '—' : detail.quality.manualReviewRequired ? 'yes' : 'no'} />
                  <Field label="Native" value={detail.quality.pagesNative} />
                  <Field label="Hybrid fallback" value={detail.quality.pagesHybridFallback} />
                  <Field label="Pixel fallback" value={detail.quality.pagesPixelFallback} />
                  <Field label="Fallback n/a" value={detail.quality.pagesFallbackUnavailable} />
                  <Field label="Pages" value={detail.pages.total} />
                  <Field label="Scored" value={detail.pages.scored} />
                  <Field label="Unscored" value={detail.pages.unscored} />
                  <Field label="Needs review" value={detail.pages.needingReview} />
                </div>
              </Card>

              {metrics && (
                <Card className="p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Operational metrics (C11)
                    <Badge variant={metrics.degraded ? 'warning' : metrics.kind === 'legacy_missing' ? 'secondary' : metrics.kind === 'cache_hit' ? 'secondary' : 'success'}>
                      {metrics.kind === 'legacy_missing' ? 'legacy sidecar' : metrics.kind === 'cache_hit' ? 'cache hit' : metrics.state}
                    </Badge>
                    {metrics.extractorLane && <span className="font-normal normal-case text-muted-foreground">lane: {metrics.extractorLane}</span>}
                    {metrics.memoryProfile && <span className="font-normal normal-case text-muted-foreground">· {metrics.memoryProfile}</span>}
                  </div>
                  {metrics.kind === 'legacy_missing' && (
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      This job predates Operational Metrics V1 (or ran on the old sidecar) — timings are unavailable, not zero.
                    </div>
                  )}
                  {metrics.degraded && metrics.kind !== 'legacy_missing' && (
                    <div className="mb-2 flex items-center gap-1 text-[11px] text-warning">
                      <AlertTriangle className="h-3 w-3" /> Metrics are degraded ({metrics.state}); values shown are partial.
                    </div>
                  )}
                  <div className="grid gap-x-6 sm:grid-cols-2">
                    {metrics.planMs !== null && <MetricCell cell={{ key: 'plan_ms', label: 'Plan', ms: metrics.planMs, state: 'measured' }} />}
                    {metrics.timings.map((cell) => <MetricCell key={cell.key} cell={cell} />)}
                    <MetricCell cell={{ key: 'edge', label: 'Edge callback processing', ms: metrics.callbackEdgeProcessingMs, state: metrics.callbackEdgeProcessingMs === null ? 'unavailable' : 'measured' }} />
                    {metrics.mergeMs !== null && <MetricCell cell={{ key: 'merge', label: 'Merge', ms: metrics.mergeMs, state: 'measured' }} />}
                    <MetricCell cell={{ key: 'parent', label: 'Parent elapsed (wall clock)', ms: metrics.parentElapsedMs, state: metrics.parentElapsedMs === null ? 'unavailable' : 'measured' }} />
                  </div>
                  {metrics.chunkCounts && (
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                      <Badge variant="outline">chunks: {metrics.chunkCounts.total}</Badge>
                      <Badge variant="success">valid {metrics.chunkCounts.valid}</Badge>
                      {metrics.chunkCounts.legacyMissing > 0 && <Badge variant="secondary">legacy {metrics.chunkCounts.legacyMissing}</Badge>}
                      {metrics.chunkCounts.invalid > 0 && <Badge variant="destructive">invalid {metrics.chunkCounts.invalid}</Badge>}
                      {metrics.chunkCounts.unknownVersion > 0 && <Badge variant="warning">unknown {metrics.chunkCounts.unknownVersion}</Badge>}
                    </div>
                  )}
                  {metrics.cache && (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Cache hit — copied from job <span className="font-mono">{metrics.cache.sourceJobId ?? '—'}</span>; no sidecar ran this time, so parse/raster are not applicable. Copy + elapsed are this run's own timings.
                    </div>
                  )}
                  <div className="mt-2 text-[10px] italic text-muted-foreground/70" title={metrics.callbackLimitationNote}>
                    {metrics.callbackLimitationNote}
                  </div>
                </Card>
              )}

              {detail.containment && (
                <Card className="p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Critical containment (E0)
                    <Badge variant={detail.containment.nativeSuppressed ? 'warning' : 'success'}>
                      {detail.containment.nativeSuppressed ? 'native suppressed' : 'no suppression'}
                    </Badge>
                    <span className="font-normal normal-case text-muted-foreground">{detail.containment.version ?? ''}</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1 text-[11px]">
                    <Badge variant="outline">critical pages: {detail.containment.criticalPageCount}</Badge>
                    {detail.containment.pagesForcedHybrid > 0 && <Badge variant="secondary">hybrid ×{detail.containment.pagesForcedHybrid}</Badge>}
                    {detail.containment.pagesForcedPixel > 0 && <Badge variant="secondary">pixel ×{detail.containment.pagesForcedPixel}</Badge>}
                    {detail.containment.pagesBlockedNoRaster > 0 && <Badge variant="destructive">blocked ×{detail.containment.pagesBlockedNoRaster}</Badge>}
                  </div>
                  {detail.containment.pages.length > 0 ? (
                    <div className="space-y-1">
                      {detail.containment.pages.map((p, i) => (
                        <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]">
                          <span>Page {p.pageNumber ?? '—'} · {CONTAINMENT_ACTION_LABEL[p.action ?? ''] ?? p.action}</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {p.contentKinds.map((k) => <Badge key={k} variant="outline">{k}</Badge>)}
                            {!p.sourceRasterAvailable && <Badge variant="destructive">no source raster</Badge>}
                            <span className="font-mono text-muted-foreground">{p.defectCodes.slice(0, 3).join(', ')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">No pages required containment.</div>
                  )}
                </Card>
              )}

              <Card className="p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" /> Failed pages by source
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(FAILED_CATEGORY_COPY) as FailedPageCategory[]).map((category) => {
                    const pages = detail.failedPages[category];
                    const copy = FAILED_CATEGORY_COPY[category];
                    return (
                      <div key={category} data-category={category} className="rounded border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={pages.length ? copy.variant : 'outline'}>{copy.label}</Badge>
                          <span className="text-xs font-medium tabular-nums">{pages.length}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{copy.help}</div>
                        {pages.length > 0 && (
                          <div className="mt-1 font-mono text-[11px] text-foreground">{formatPageRanges(pages)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {detail.chunks.length > 0 && (
                <Card className="p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chunks ({detail.chunks.length})</div>
                  <div className="space-y-1">
                    {detail.chunks.map((chunk, index) => (
                      <div key={index} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono">pp {chunk.range}</span>
                        <div className="flex items-center gap-2">
                          {chunk.attempts !== null && <span className="text-muted-foreground">×{chunk.attempts}</span>}
                          <Badge variant={chunk.status === 'succeeded' ? 'success' : chunk.status === 'failed' || chunk.status === 'fatal' ? 'destructive' : 'secondary'}>
                            {chunk.status ?? '—'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {detail.perPage.length > 0 && (
                <Card className="p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-page verdicts</div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {detail.perPage.map((page) => (
                      <div key={page.pageNumber} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px]">
                        <span>Page {page.pageNumber}</span>
                        <div className="flex items-center gap-2">
                          {page.outputStrategy && <Badge variant={page.outputStrategy === 'native' ? 'success' : 'warning'}>{page.outputStrategy}</Badge>}
                          <span className="tabular-nums text-muted-foreground">{pct(page.score)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Artifacts</div>
                <div className="mb-2 flex flex-wrap gap-1">
                  <Badge variant={detail.artifacts.diagnostics ? 'success' : 'outline'}>diagnostics</Badge>
                  <Badge variant={detail.artifacts.rastersManifest ? 'success' : 'outline'}>rasters manifest</Badge>
                  <Badge variant={detail.artifacts.pageRasters ? 'success' : 'outline'}>page rasters</Badge>
                  <Badge variant={detail.artifacts.perPageManifest ? 'success' : 'outline'}>per-page manifest</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(detail.signedUrls).map(([key, url]) => (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-primary underline-offset-2 hover:underline"
                    >
                      <Download className="h-3 w-3" /> {key}
                    </a>
                  ))}
                  {Object.keys(detail.signedUrls).length === 0 && (
                    <span className="text-[11px] text-muted-foreground">No signed artifact links available.</span>
                  )}
                </div>
              </Card>

              {detail.error && (
                <Card className="border-destructive/30 bg-destructive/5 p-3">
                  <div className="text-xs font-semibold text-destructive">Error {detail.error.code ? `· ${detail.error.code}` : ''}</div>
                  {detail.error.text && <div className="mt-1 text-[11px] text-muted-foreground break-words">{detail.error.text}</div>}
                </Card>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

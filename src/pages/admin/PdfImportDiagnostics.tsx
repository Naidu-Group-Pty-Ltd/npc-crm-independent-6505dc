/**
 * PdfImportDiagnostics — superadmin observability for the Docling pipeline.
 *
 * Phase 7 of the Docling pipeline plan. Surfaces every PDF import run with:
 *   - 7-day rollup (success rate, p50/p95 latency, average SSIM, engine mix)
 *   - Recent jobs table with status / engine / stage / duration / SSIM
 *   - Filter by status + engine
 *   - One-click signed-URL download of the diagnostics bundle for the row
 *   - Realtime updates via the existing `pdf_import_jobs` publication
 *
 * Reads through `pdf-import-diagnostics` edge fn (service-role mediated; the
 * table's RLS scopes to auth.uid() which doesn't fire for custom-auth users).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Download,
  Zap,
  Cpu,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  ShieldCheck,
  Database as DatabaseZap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { PdfImportDiagnosticsDetailDialog } from '@/components/admin/PdfImportDiagnosticsDetailDialog';
import {
  buildDiagnosticsListRow,
  formatPageRanges,
  expandChunkRanges,
  type DiagnosticsGateSummary,
} from '@/lib/reportTemplate/ingestion/diagnostics/pdfImportDiagnosticsV2';

type EngineValue = 'legacy' | 'docling';
type StatusValue =
  | 'queued'
  | 'uploading'
  | 'parsing'
  | 'mapping'
  | 'finalizing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

interface JobRow {
  id: string;
  user_id: string;
  template_id: string | null;
  source_file_name: string | null;
  source_file_size_bytes: number | null;
  engine: EngineValue;
  engine_version: string | null;
  mode: 'semantic' | 'hybrid' | 'pixel_perfect';
  status: StatusValue;
  stage: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  cloud_run_ms: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  page_count: number | null;
  chunked: boolean | null;
  chunks_total: number | null;
  chunks_completed: number | null;
  chunks_failed: number | null;
  ssim_score: number | null;
  error_code: string | null;
  error_text: string | null;
  diagnostics_path: string | null;
  result_payload: {
    summary?: {
      text_chars?: number;
      ocr_chars?: number;
      table_count?: number;
      avg_text_confidence?: number | null;
    } | null;
    ssim_path?: string | null;
    rasters_manifest_path?: string | null;
    page_raster_paths?: string[] | null;
    rasters_path?: string | null;
    legacy_rasters_path?: string | null;
  } | null;

  created_at: string;
  updated_at: string;
}

interface StatsResponse {
  totals: {
    total: number;
    succeeded: number;
    failed: number;
    inflight: number;
    legacy: number;
    docling: number;
  };
  latency: { p50_ms: number | null; p95_ms: number | null };
  ssim: { avg: number | null; sample_count: number };
  summary: {
    text_chars: number;
    avg_ocr_ratio: number | null;
    table_count: number;
    avg_confidence: number | null;
  };
  cohorts: {
    byEngineVersion: Record<string, number>;
    byUser: Record<string, number>;
    byFileSizeBucket: Record<string, number>;
    byPageCount: Record<string, number>;
  };
  cost: { cloud_run_ms: number; bytes_in: number; bytes_out: number };
}


const METRIC_CARD_CLASS = "overflow-hidden rounded-2xl border-primary/15 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.18)_100%)] shadow-[0_12px_34px_rgba(15,23,42,0.08)] ring-1 ring-white/35 dark:border-white/10 dark:bg-background/70 dark:ring-white/10 dark:shadow-black/30";
const METRIC_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const METRIC_VALUE_CLASS = "mt-2 text-2xl font-bold tracking-tight text-foreground";

const STATUS_COLOR: Record<StatusValue, string> = {
  queued: 'bg-muted text-muted-foreground',
  uploading: 'bg-warning/10 text-warning',
  parsing: 'bg-warning/10 text-warning',
  mapping: 'bg-warning/10 text-warning',
  finalizing: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

function formatMs(ms: number | null): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatBytes(b: number | null): string {
  if (!b) return '—';
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export default function PdfImportDiagnostics() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [engineVersionFilter, setEngineVersionFilter] = useState<string>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  // C8 — per-job quality-gate summaries (from the linked import) + detail drill-down.
  const [gates, setGates] = useState<Record<string, DiagnosticsGateSummary>>({});
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  // C8 fix — when the list degrades past missing (drift) columns, surface it
  // instead of a silent 500 / silently-blank columns.
  const [degradedColumns, setDegradedColumns] = useState<string[]>([]);
  // C8 fix — real failed page ranges per job (batch-fetched by the edge list op).
  const [failedChunkRanges, setFailedChunkRanges] = useState<Record<string, Array<{ page_start: number; page_end: number }>>>({});

  const loadStats = useCallback(async () => {
    const res = await invokeSecureFunction<StatsResponse>('pdf-import-diagnostics', {
      operation: 'stats',
    });
    if (res.error) {
      const msg = res.error.message;
      const friendly = describeAuthError(msg);
      if (friendly) toast.error(friendly);
      return;
    }
    if (res.data) setStats(res.data);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invokeSecureFunction<{ rows: JobRow[]; gates?: Record<string, DiagnosticsGateSummary>; degraded?: boolean; missingColumns?: string[]; failedChunkRanges?: Record<string, Array<{ page_start: number; page_end: number }>> }>('pdf-import-diagnostics', {
        operation: 'list',
        status: statusFilter === 'all' ? null : statusFilter,
        engine: engineFilter === 'all' ? null : engineFilter,
        engineVersion: engineVersionFilter === 'all' ? null : engineVersionFilter,
        limit: 100,
      });
      if (res.error) {
        const msg = res.error.message;
        const friendly = describeAuthError(msg);
        toast.error(friendly ?? msg);
        setRows([]);
        return;
      }
      setRows(res.data?.rows ?? []);
      setGates(res.data?.gates ?? {});
      setDegradedColumns(res.data?.degraded ? (res.data.missingColumns ?? []) : []);
      setFailedChunkRanges(res.data?.failedChunkRanges ?? {});
    } finally {
      setLoading(false);
    }
  }, [statusFilter, engineFilter, engineVersionFilter]);


  useEffect(() => {
    loadStats();
    loadRows();
  }, [loadStats, loadRows]);

  // Realtime — patch a row in-place when its status/stage changes.
  useEffect(() => {
    const channel = supabase
      .channel('pdf-import-diagnostics')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pdf_import_jobs' },
        (payload) => {
          const next = (payload.new ?? payload.old) as JobRow | undefined;
          if (!next?.id) return;
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === next.id);
            if (payload.eventType === 'DELETE') {
              return idx >= 0 ? prev.filter((r) => r.id !== next.id) : prev;
            }
            if (idx >= 0) {
              const merged = [...prev];
              merged[idx] = { ...merged[idx], ...(payload.new as JobRow) };
              return merged;
            }
            // INSERT: prepend, keep current size
            return [payload.new as JobRow, ...prev].slice(0, 100);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleDownload = useCallback(async (path: string | null, jobId: string) => {
    if (!path) {
      toast.error('No diagnostics bundle for this job');
      return;
    }
    setDownloading(jobId);
    try {
      const res = await invokeSecureFunction<{ signedUrl: string }>('pdf-import-diagnostics', {
        operation: 'download',
        diagnosticsPath: path,
        expiresIn: 300,
      });
      if (res.error || !res.data?.signedUrl) {
        toast.error(res.error?.message ?? 'Failed to sign URL');

        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(null);
    }
  }, []);

  const successRate = useMemo(() => {
    if (!stats || stats.totals.total === 0) return null;
    return (stats.totals.succeeded / stats.totals.total) * 100;
  }, [stats]);

  const engineVersions = useMemo(() => {
    const versions = new Set<string>();
    rows.forEach((row) => {
      if (row.engine_version) versions.add(row.engine_version);
    });
    Object.keys(stats?.cohorts.byEngineVersion ?? {}).forEach((version) => {
      if (version !== '(unset)') versions.add(version);
    });
    return Array.from(versions).sort();
  }, [rows, stats]);

  const topCohort = (items: Record<string, number> | undefined) => {
    const entries = Object.entries(items ?? {}).sort((a, b) => b[1] - a[1]);
    return entries[0] ? `${entries[0][0]} · ${entries[0][1]}` : '—';
  };

  return (
    <DashboardThemeFrame as="main" variant="page" className="min-w-0 space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex min-w-0 flex-col gap-5 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.90)_58%,hsl(var(--primary)/0.10))] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)] dark:shadow-black/35 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8"
      >
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-sm">
            <Activity className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-3xl font-bold tracking-tight text-foreground">PDF Import Diagnostics</h1>
              <Badge variant="outline" className="rounded-full border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                Docling observability
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              7-day observability for the Docling pipeline. Inspect every import, download
              raw Docling JSON + page rasters, and review engine performance.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-10 rounded-xl border-primary/25 bg-background/70 font-semibold shadow-sm hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40"
          >
            <Link to="/admin/pdf-import-monitoring">
              <Activity className="mr-2 h-4 w-4" />
              Monitoring
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-10 rounded-xl border-primary/25 bg-background/70 font-semibold shadow-sm hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40"
          >
            <Link to="/admin/template-import-quality">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Visual quality
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 rounded-xl border-primary/25 bg-background/70 font-semibold shadow-sm hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40"
            onClick={() => {
              loadStats();
              loadRows();
            }}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </DashboardThemeFrame>

      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Imports (7d)</div>
            <div className={METRIC_VALUE_CLASS}>{stats?.totals.total ?? '—'}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Success rate</div>
            <div className={METRIC_VALUE_CLASS}>
              {successRate !== null ? `${successRate.toFixed(1)}%` : '—'}
            </div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>In-flight</div>
            <div className={METRIC_VALUE_CLASS}>{stats?.totals.inflight ?? '—'}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>p50 / p95</div>
            <div className="mt-2 text-sm font-semibold text-foreground">
              {formatMs(stats?.latency.p50_ms ?? null)} /{' '}
              {formatMs(stats?.latency.p95_ms ?? null)}
            </div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Avg SSIM</div>
            <div className={METRIC_VALUE_CLASS}>
              {stats?.ssim.avg !== null && stats?.ssim.avg !== undefined
                ? stats.ssim.avg.toFixed(3)
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Engine mix</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" aria-hidden="true" />
                {stats?.totals.legacy ?? 0}
              </span>
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" aria-hidden="true" />
                {stats?.totals.docling ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Text chars</div>
            <div className={METRIC_VALUE_CLASS}>{stats?.summary.text_chars?.toLocaleString('en-AU') ?? '—'}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Avg OCR %</div>
            <div className={METRIC_VALUE_CLASS}>
              {stats?.summary.avg_ocr_ratio !== null && stats?.summary.avg_ocr_ratio !== undefined
                ? `${Math.round(stats.summary.avg_ocr_ratio * 100)}%`
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Tables</div>
            <div className={METRIC_VALUE_CLASS}>{stats?.summary.table_count ?? '—'}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Avg confidence</div>
            <div className={METRIC_VALUE_CLASS}>
              {stats?.summary.avg_confidence !== null && stats?.summary.avg_confidence !== undefined
                ? stats.summary.avg_confidence.toFixed(2)
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Cloud Run ms</div>
            <div className={METRIC_VALUE_CLASS}>{formatMs(stats?.cost.cloud_run_ms ?? null)}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>I/O bytes</div>
            <div className="mt-2 text-sm font-semibold text-foreground">
              {formatBytes(stats?.cost.bytes_in ?? null)} / {formatBytes(stats?.cost.bytes_out ?? null)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Top user cohort</div>
            <div className="mt-2 truncate text-sm font-semibold text-foreground">{topCohort(stats?.cohorts.byUser)}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Top file-size bucket</div>
            <div className="mt-2 text-sm font-semibold text-foreground">{topCohort(stats?.cohorts.byFileSizeBucket)}</div>
          </CardContent>
        </Card>
        <Card className={METRIC_CARD_CLASS}>
          <CardContent className="p-4 sm:p-5">
            <div className={METRIC_LABEL_CLASS}>Top page-count bucket</div>
            <div className="mt-2 text-sm font-semibold text-foreground">{topCohort(stats?.cohorts.byPageCount)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-3 overflow-hidden rounded-3xl border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--card))_42%,hsl(var(--background)/0.88))] shadow-[0_14px_42px_rgba(15,23,42,0.08)] ring-1 ring-white/35 dark:border-white/10 dark:ring-white/10 dark:shadow-black/30">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold text-foreground">Compliance-safe diagnostics access</div>
              <p className="text-xs leading-5 text-muted-foreground">
                Diagnostic bundle downloads continue to use short-lived signed URLs, existing permission checks, and audited download handling. This view surfaces availability and metadata only; it does not expose raw signed URL values or hidden diagnostic internals.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>


      <Card className="overflow-hidden rounded-3xl border-primary/15 bg-card/85 shadow-[0_18px_55px_rgba(15,23,42,0.10)] ring-1 ring-white/35 dark:border-white/10 dark:bg-background/60 dark:ring-white/10 dark:shadow-black/35">
        <CardHeader className="flex flex-col gap-4 border-b border-border/60 bg-muted/20 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseZap className="h-4 w-4 text-primary" aria-hidden="true" />
              Recent imports
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Attempt summaries, stages, SSIM, cost telemetry, and audited diagnostic bundles with short-lived access.</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full rounded-xl sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="succeeded">Succeeded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="parsing">Parsing</SelectItem>
                <SelectItem value="mapping">Mapping</SelectItem>
                <SelectItem value="finalizing">Finalizing</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={engineFilter} onValueChange={setEngineFilter}>
              <SelectTrigger className="h-9 w-full rounded-xl sm:w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All engines</SelectItem>
                <SelectItem value="legacy">Legacy</SelectItem>
                <SelectItem value="docling">Docling</SelectItem>
              </SelectContent>
            </Select>
            <Select value={engineVersionFilter} onValueChange={setEngineVersionFilter}>
              <SelectTrigger className="h-9 w-full rounded-xl sm:w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All engine versions</SelectItem>
                {engineVersions.map((version) => (
                  <SelectItem key={version} value={version}>{version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {degradedColumns.length > 0 && (
            <div className="mx-4 mb-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
              Diagnostics is running in a degraded mode — the database is missing expected column(s)
              ({degradedColumns.join(', ')}), so correlation/lane/metrics fields are blank. Apply the
              pending PDF-import migrations to restore full detail.
            </div>
          )}
          <div className="overflow-x-auto [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
            <Table className="min-w-[1320px]">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead className="text-right">Chars</TableHead>
                  <TableHead className="text-right">OCR</TableHead>
                  <TableHead className="text-right">Tables</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead className="text-right" title="Wall-clock elapsed for the whole job (start → callback). Open a row for the full C11 per-phase timing breakdown.">Elapsed</TableHead>
                  <TableHead className="text-right" title="Cumulative sidecar CPU work (parse + raster), NOT wall-clock. C11 per-phase timings are in the row detail.">CPU work</TableHead>
                  <TableHead className="text-right">SSIM</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={17} className="py-14">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-5 text-center shadow-sm" role="status" aria-live="polite">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
                        <div>
                          <div className="text-sm font-semibold text-foreground">Loading Docling diagnostics</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">Fetching attempt summaries, stages, SSIM, cost telemetry, and diagnostic bundle availability.</div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={17} className="py-14">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 p-5 text-center shadow-sm" role="status" aria-live="polite">
                        <Activity className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <div className="text-sm font-semibold text-foreground">No imports match the current filters</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">Adjust the status, engine, or version filters to inspect other Docling import attempts.</div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} className="transition-colors hover:bg-primary/5">
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRelative(row.created_at)}
                      </TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate text-sm font-medium">
                          {row.source_file_name ?? row.id.slice(0, 8)}
                        </div>
                        <div className={METRIC_LABEL_CLASS}>
                          {formatBytes(row.source_file_size_bytes)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="max-w-[260px] gap-1 overflow-hidden rounded-full border-primary/20 bg-background/70">
                          {row.engine === 'docling' ? (
                            <Cpu className="h-3 w-3" />
                          ) : (
                            <Zap className="h-3 w-3" />
                          )}
                          {row.engine}
                          {row.engine_version ? (
                            <span className="ml-1 truncate text-[10px] text-muted-foreground">
                              {row.engine_version}
                            </span>
                          ) : null}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{row.mode}</TableCell>
                      <TableCell>
                        <Badge className={`rounded-full gap-1 ${STATUS_COLOR[row.status]}`}>
                          {row.status === 'succeeded' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : row.status === 'failed' ? (
                            <XCircle className="h-3 w-3" />
                          ) : row.status === 'queued' || row.status === 'cancelled' ? (
                            <Clock className="h-3 w-3" />
                          ) : (
                            <Activity className="h-3 w-3 animate-pulse" />
                          )}
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                        {row.stage ?? '—'}
                        {row.error_text ? (
                          <div className="text-destructive truncate">{row.error_text}</div>
                        ) : null}
                        {row.result_payload?.rasters_manifest_path ? (
                          <div className="text-success text-[10px] truncate">
                            manifest · {(row.result_payload.page_raster_paths?.length ?? 0)} pages
                          </div>
                        ) : (row.result_payload?.rasters_path || row.result_payload?.legacy_rasters_path) ? (
                          <div className="text-warning text-[10px] truncate">legacy rasters.json only</div>
                        ) : null}
                      </TableCell>

                      <TableCell className="text-right text-sm">
                        {row.page_count ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {row.chunked ? (
                          <span>
                            {row.chunks_completed ?? 0}/{row.chunks_total ?? '—'}
                            {(row.chunks_failed ?? 0) > 0 ? (
                              <span className="text-destructive">
                                {' · '}{row.chunks_failed} failed
                                {failedChunkRanges[row.id]?.length ? (
                                  // C8 fix — show the REAL failed page ranges, not just a count.
                                  <span className="ml-1 text-[10px] text-muted-foreground">
                                    (pp {formatPageRanges(expandChunkRanges(failedChunkRanges[row.id]))})
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">mono</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.result_payload?.summary?.text_chars?.toLocaleString('en-AU') ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.result_payload?.summary?.text_chars
                          ? `${Math.round(((row.result_payload.summary.ocr_chars ?? 0) / row.result_payload.summary.text_chars) * 100)}%`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.result_payload?.summary?.table_count ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.result_payload?.summary?.avg_text_confidence !== null && row.result_payload?.summary?.avg_text_confidence !== undefined
                          ? row.result_payload.summary.avg_text_confidence.toFixed(2)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatMs(row.duration_ms)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatMs(row.cloud_run_ms)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.ssim_score !== null && row.ssim_score !== undefined
                          ? row.ssim_score.toFixed(3)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const listRow = buildDiagnosticsListRow(row as unknown as Parameters<typeof buildDiagnosticsListRow>[0], gates[row.id]);
                          if (!gates[row.id]) return <span className="text-muted-foreground">—</span>;
                          return (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1">
                                {listRow.visualCoverage && (
                                  <Badge
                                    variant={listRow.visualCoverage === 'complete' ? 'success' : listRow.visualCoverage === 'none' ? 'destructive' : 'warning'}
                                    className="rounded-full px-1.5 py-0 text-[10px]"
                                  >
                                    {listRow.visualCoverage}
                                  </Badge>
                                )}
                                {listRow.manualReviewRequired ? (
                                  <span className="text-[10px] text-warning">review</span>
                                ) : null}
                              </div>
                              <div className="text-[10px] text-muted-foreground tabular-nums">
                                N{listRow.pagesNative ?? 0}·H{listRow.pagesHybridFallback ?? 0}·P{listRow.pagesPixelFallback ?? 0}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-full px-2 text-xs hover:bg-primary/10 hover:text-primary"
                            onClick={() => setDetailJobId(row.id)}
                            aria-label="View correlated import diagnostics detail"
                          >
                            Details
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                            disabled={!row.diagnostics_path || downloading === row.id}
                            onClick={() => handleDownload(row.diagnostics_path, row.id)}
                            aria-label="Download audited diagnostics bundle"
                          >
                            {downloading === row.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <PdfImportDiagnosticsDetailDialog
        jobId={detailJobId}
        open={detailJobId !== null}
        onOpenChange={(next) => { if (!next) setDetailJobId(null); }}
      />
    </DashboardThemeFrame>
  );
}

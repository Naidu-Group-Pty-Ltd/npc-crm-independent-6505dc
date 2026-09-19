import React, { useEffect, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import {
  Download, RefreshCw, FileJson, Code, ExternalLink, Eye, FileArchive,
  Workflow, CheckCircle2, AlertCircle, Image as ImageIcon, Save,
} from 'lucide-react';
import { toast } from 'sonner';

interface SummaryRow {
  id: string;
  resource_type: 'form' | 'survey' | 'quiz' | 'funnel' | 'funnel_page' | 'workflow';
  ghl_id: string;
  name: string | null;
  parent_ghl_id: string | null;
  full_url: string | null;
  fetch_status: string;
  fetch_error: string | null;
  last_fetched_at: string;
  has_html: boolean;
  has_raw_html?: boolean;
  has_markdown?: boolean;
  has_css: boolean;
  has_inlined_css?: boolean;
  has_embed: boolean;
  has_screenshot?: boolean;
  has_links?: boolean;
  has_metadata?: boolean;
  has_submissions?: boolean;
  has_portable?: boolean;
  asset_count?: number;
  asset_bytes?: number;
  enrichment_sources?: any;
}

interface JobInfo {
  id: string;
  status: string;
  total_assets: number;
  processed_assets: number;
  failed_assets: number;
  current_label: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface BridgeRow {
  id: string;
  legacy_workflow_id: string;
  legacy_name: string | null;
  trigger_summary: string | null;
  step_count: number | null;
  new_workflow_id: string | null;
  status: string;
  notes: string | null;
}

const TYPE_COLOR: Record<string, string> = {
  form: 'bg-info/15 text-info border-info/30',
  survey: 'bg-accent/15 text-accent border-accent/30',
  quiz: 'bg-accent/15 text-accent border-accent/30',
  funnel: 'bg-brand-500/15 text-brand-400 border-brand-500/30',
  funnel_page: 'bg-success/15 text-success border-success/30',
  workflow: 'bg-destructive/15 text-destructive border-destructive/30',
};

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function GhlMarketingRawDump() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [detail, setDetail] = useState<{ summary: SummaryRow; full?: any } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bridge, setBridge] = useState<BridgeRow[]>([]);
  const [bridgeEdits, setBridgeEdits] = useState<Record<string, Partial<BridgeRow>>>({});
  const [funnelDomain, setFunnelDomain] = useState<string>(() => localStorage.getItem('ghl_funnel_domain') || 'scale.npcservices.com.au');
  const pollRef = useRef<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    const [list, br] = await Promise.all([
      invokeSecureFunction('ghl-marketing-raw-dump', { action: 'list' }),
      invokeSecureFunction('ghl-marketing-raw-dump', { action: 'workflow_bridge_list' }),
    ]);
    if (list.error) toast.error(list.error.message);
    else {
      setRows(list.data?.rows || []);
      setCounts(list.data?.counts || {});
    }
    if (br.data?.rows) setBridge(br.data.rows);
    setLoading(false);
  };

  useEffect(() => { refresh(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const r = await invokeSecureFunction('ghl-marketing-raw-dump', { action: 'job_status', job_id: jobId });
      if (r.data?.job) {
        setJob(r.data.job);
        if (['completed', 'failed', 'partial'].includes(r.data.job.status)) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          toast.success(`Dump ${r.data.job.status} — ${r.data.job.processed_assets}/${r.data.job.total_assets} assets`);
          refresh();
        }
      }
    }, 2500);
  };

  const handleStartJob = async () => {
    toast.info('Building queue and starting harvest…');
    // Apply the same domain to every funnel by passing a wildcard '*' the
    // backend supports — but to keep the API simple we list known funnel ids
    // from the current rows. If none yet, the backend will skip page rendering
    // and just store metadata.
    const funnelIds = Array.from(new Set(rows.filter(r => r.resource_type === 'funnel').map(r => r.ghl_id)));
    const funnel_domains: Record<string, string> = {};
    const cleaned = funnelDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (cleaned) {
      for (const fid of funnelIds) funnel_domains[fid] = cleaned;
      localStorage.setItem('ghl_funnel_domain', cleaned);
    }
    const res = await invokeSecureFunction('ghl-marketing-dump-enqueue', { account: 'legacy', funnel_domains });
    if (res.error) { toast.error(res.error.message); return; }
    const jobId = res.data?.job_id;
    setJob({ id: jobId, status: 'running', total_assets: res.data?.total_assets || 0, processed_assets: 0, failed_assets: 0, current_label: null, started_at: null, finished_at: null });
    startPolling(jobId);
  };

  const handleExportZip = async (assetId?: string) => {
    setExporting(true);
    toast.info('Building rebuild kit ZIP — this may take 30-60s…');
    const res = await invokeSecureFunction('ghl-marketing-dump-export', assetId ? { asset_id: assetId } : {}, { timeoutMs: 300_000 });
    setExporting(false);
    if (res.error) { toast.error(res.error.message); return; }
    if (res.data?.url) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ghl-rebuild-kit-${stamp}.zip`;
      try {
        const r = await fetch(res.data.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        toast.success(`ZIP downloaded (${fmtBytes(res.data.bytes || 0)}) — ${res.data.total_assets} assets`);
      } catch (e: any) {
        // Fallback: open in new tab
        window.open(res.data.url, '_blank');
        toast.warning(`Download fallback opened in new tab: ${e?.message || e}`);
      }
    }
  };

  const openDetail = async (row: SummaryRow) => {
    setDetail({ summary: row });
    setDetailLoading(true);
    const res = await invokeSecureFunction('ghl-marketing-raw-dump', { action: 'detail', id: row.id });
    setDetailLoading(false);
    if (res.error) { toast.error(res.error.message); setDetail(null); return; }
    setDetail({ summary: row, full: res.data?.row });
  };

  const saveBridgeRow = async (id: string) => {
    const edits = bridgeEdits[id];
    if (!edits) return;
    const res = await invokeSecureFunction('ghl-marketing-raw-dump', { action: 'workflow_bridge_update', id, ...edits });
    if (res.error) { toast.error(res.error.message); return; }
    toast.success('Saved');
    setBridgeEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
    const br = await invokeSecureFunction('ghl-marketing-raw-dump', { action: 'workflow_bridge_list' });
    if (br.data?.rows) setBridge(br.data.rows);
  };

  const filtered = rows.filter((r) => {
    if (typeFilter !== 'all' && r.resource_type !== typeFilter) return false;
    if (filter && !(`${r.name || ''} ${r.ghl_id}`).toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const progressPct = job && job.total_assets > 0
    ? Math.min(100, Math.round((job.processed_assets / job.total_assets) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileArchive className="h-5 w-5 text-primary" />
                Raw Marketing-Asset Deep Harvester
              </CardTitle>
              <CardDescription className="mt-1">
                Aggressively pulls forms, surveys/quizzes, funnels, funnel pages and workflows — API metadata,
                rendered HTML/CSS, screenshots, downloaded images & fonts, and a full rebuild kit ZIP.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={funnelDomain}
                  onChange={(e) => setFunnelDomain(e.target.value)}
                  placeholder="Funnel published domain (e.g. npcservices.com.au)"
                  className="h-9 w-[280px] text-xs"
                  title="Required to render funnel pages with Firecrawl. GHL's API does not expose published domains."
                />
              </div>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button onClick={handleStartJob} disabled={job?.status === 'running' || job?.status === 'queued'} size="sm">
                <RefreshCw className={`h-4 w-4 mr-2 ${job?.status === 'running' ? 'animate-spin' : ''}`} />
                {job?.status === 'running' || job?.status === 'queued' ? 'Harvesting…' : 'Start fresh deep harvest'}
              </Button>
              <Button onClick={() => handleExportZip()} variant="default" size="sm" disabled={rows.length === 0 || exporting}>
                <Download className="h-4 w-4 mr-2" />
                {exporting ? 'Building…' : 'Download rebuild kit (.zip)'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Job progress */}
          {job && (
            <Alert className="border-primary/30 bg-primary/5">
              <RefreshCw className={`h-4 w-4 text-primary ${job.status === 'running' ? 'animate-spin' : ''}`} />
              <AlertTitle className="flex items-center gap-2">
                Harvest {job.status}
                <Badge variant="outline">{job.processed_assets}/{job.total_assets}</Badge>
                {job.failed_assets > 0 && <Badge variant="destructive">{job.failed_assets} failed</Badge>}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <Progress value={progressPct} className="h-2" />
                <div className="text-xs text-muted-foreground">
                  {job.current_label ? `Current: ${job.current_label}` : 'Initializing…'}
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Alert className="border-border/40 bg-muted/20">
            <FileJson className="h-4 w-4" />
            <AlertTitle>What's recoverable</AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              <div>✅ <b>Forms / Surveys / Quizzes</b>: full field schema + rendered HTML + screenshot + last 50 submissions + downloaded assets.</div>
              <div>✅ <b>Funnel pages</b>: rendered HTML + inlined CSS + screenshot + every image/font downloaded into the rebuild kit.</div>
              <div>⚠️ <b>Funnel-builder JSON</b>: API-locked. Use screenshot + portable HTML as pixel reference.</div>
              <div>⚠️ <b>Workflows</b>: only metadata via API. Use the <b>Snapshot Bridge</b> below + GHL native Snapshot import.</div>
            </AlertDescription>
          </Alert>

          {/* Counts */}
          <div className="flex flex-wrap gap-2">
            <Button variant={typeFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter('all')}>
              All ({rows.length})
            </Button>
            {Object.entries(counts).map(([type, count]) => (
              <Button key={type} variant={typeFilter === type ? 'default' : 'outline'} size="sm" onClick={() => setTypeFilter(type)}>
                <Badge variant="outline" className={`mr-2 ${TYPE_COLOR[type] || ''}`}>{type}</Badge>{count}
              </Button>
            ))}
          </div>

          <SearchInput
            value={filter}
            onValueChange={setFilter}
            placeholder="Search by name or GHL ID…"
          />

          <ScrollArea className="h-[500px] border border-border/40 rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-64">Captured</TableHead>
                  <TableHead className="w-24">Assets</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                      {rows.length === 0 ? 'No data yet — click "Start fresh deep harvest" to begin.' : 'No matches.'}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(r)}>
                    <TableCell>
                      <Badge variant="outline" className={TYPE_COLOR[r.resource_type] || ''}>{r.resource_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name || <span className="text-muted-foreground">Unnamed</span>}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.ghl_id}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">JSON</Badge>
                        {r.has_raw_html && <Badge variant="outline" className="text-[10px] bg-success/10 text-success">HTML</Badge>}
                        {r.has_markdown && <Badge variant="outline" className="text-[10px] bg-info/10 text-info">MD</Badge>}
                        {r.has_inlined_css && <Badge variant="outline" className="text-[10px] bg-info/10 text-info">CSS</Badge>}
                        {r.has_portable && <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">Portable</Badge>}
                        {r.has_screenshot && <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent">Shot</Badge>}
                        {r.has_submissions && <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive">Subs</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(r.asset_count || 0) > 0 ? (
                        <div className="text-xs">
                          <div className="font-medium">{r.asset_count}</div>
                          <div className="text-muted-foreground">{fmtBytes(r.asset_bytes || 0)}</div>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.fetch_status === 'ok' ? 'default' : 'secondary'} className="text-[10px]">{r.fetch_status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.full_url && (
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); window.open(r.full_url!, '_blank'); }}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Workflow Snapshot Bridge */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5 text-destructive" />
            Workflow Snapshot Bridge
          </CardTitle>
          <CardDescription>
            Workflow internals are API-locked. Export a GHL <b>Snapshot</b> from the legacy account, import it into the new account,
            then paste each new workflow ID below to lock the legacy↔new mapping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] border border-border/40 rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Legacy workflow</TableHead>
                  <TableHead className="w-48">Trigger</TableHead>
                  <TableHead className="w-20">Steps</TableHead>
                  <TableHead className="w-72">New workflow ID</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-20 text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bridge.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No workflows yet — run a harvest first.
                  </TableCell></TableRow>
                )}
                {bridge.map((b) => {
                  const e = bridgeEdits[b.id] || {};
                  const newId = e.new_workflow_id ?? b.new_workflow_id ?? '';
                  const status = e.status ?? b.status ?? 'pending';
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.legacy_name || 'Unnamed'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{b.legacy_workflow_id}</div>
                      </TableCell>
                      <TableCell className="text-xs">{b.trigger_summary || '—'}</TableCell>
                      <TableCell className="text-xs">{b.step_count ?? '—'}</TableCell>
                      <TableCell>
                        <Input value={newId} onChange={(ev) => setBridgeEdits((p) => ({ ...p, [b.id]: { ...e, new_workflow_id: ev.target.value } }))}
                          placeholder="paste new ID" className="h-8 text-xs font-mono" />
                      </TableCell>
                      <TableCell>
                        <select className="h-8 text-xs bg-background border border-border rounded px-2 w-full"
                          value={status}
                          onChange={(ev) => setBridgeEdits((p) => ({ ...p, [b.id]: { ...e, status: ev.target.value } }))}>
                          <option value="pending">pending</option>
                          <option value="imported">imported</option>
                          <option value="verified">verified</option>
                          <option value="skipped">skipped</option>
                        </select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" disabled={!bridgeEdits[b.id]} onClick={() => saveBridgeRow(b.id)}>
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.summary && (
                <Badge variant="outline" className={TYPE_COLOR[detail.summary.resource_type] || ''}>
                  {detail.summary.resource_type}
                </Badge>
              )}
              {detail?.summary?.name || detail?.summary?.ghl_id}
              {detail?.summary && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => handleExportZip(detail.summary.id)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> ZIP this asset
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailLoading || !detail?.full ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />Loading…
            </div>
          ) : (
            <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="flex-wrap h-auto justify-start">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
                <TabsTrigger value="rawhtml" disabled={!detail.full.raw_html_content}>HTML</TabsTrigger>
                <TabsTrigger value="markdown" disabled={!detail.full.markdown_content}>Markdown</TabsTrigger>
                <TabsTrigger value="css" disabled={!detail.full.inlined_css && !detail.full.css_content}>CSS</TabsTrigger>
                <TabsTrigger value="screenshot" disabled={!detail.full.screenshot_url}><ImageIcon className="h-3.5 w-3.5 mr-1" />Screenshot</TabsTrigger>
                <TabsTrigger value="assets" disabled={!detail.full.asset_manifest?.length}>Assets ({detail.full.asset_manifest?.length || 0})</TabsTrigger>
                <TabsTrigger value="submissions" disabled={!detail.full.submissions_sample}>Submissions</TabsTrigger>
                <TabsTrigger value="embed" disabled={!detail.full.embed_code}>Embed</TabsTrigger>
                <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex-1 overflow-auto mt-2 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><b>GHL ID:</b> <code className="text-xs">{detail.full.ghl_id}</code></div>
                  <div><b>Status:</b> <Badge variant={detail.full.fetch_status === 'ok' ? 'default' : 'secondary'}>{detail.full.fetch_status}</Badge></div>
                  <div><b>Public URL:</b> {detail.full.full_url ? <a href={detail.full.full_url} target="_blank" rel="noreferrer" className="text-primary underline">{detail.full.full_url}</a> : '—'}</div>
                  <div><b>Assets:</b> {detail.full.asset_count || 0} ({fmtBytes(detail.full.asset_bytes || 0)})</div>
                  <div><b>Last fetched:</b> {detail.full.last_fetched_at}</div>
                  <div><b>Portable HTML:</b> {detail.full.portable_html_path ? <CheckCircle2 className="inline h-4 w-4 text-success" /> : '—'}</div>
                </div>
                {detail.full.reconstruction_notes && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Reconstruction notes</AlertTitle>
                    <AlertDescription>{detail.full.reconstruction_notes}</AlertDescription>
                  </Alert>
                )}
                {detail.full.fetch_error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{detail.full.fetch_error}</AlertDescription>
                  </Alert>
                )}
              </TabsContent>

              <TabsContent value="json" className="flex-1 overflow-hidden mt-2">
                <DownloadBar onClick={() => download(`${detail.summary.resource_type}-${detail.summary.ghl_id}.json`, JSON.stringify(detail.full.raw_payload, null, 2), 'application/json')} label="Download JSON" />
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{JSON.stringify(detail.full.raw_payload, null, 2)}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="rawhtml" className="flex-1 overflow-hidden mt-2">
                <DownloadBar onClick={() => download(`${detail.summary.resource_type}-${detail.summary.ghl_id}.html`, detail.full.raw_html_content || '', 'text/html')} label="Download HTML" />
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{detail.full.raw_html_content}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="markdown" className="flex-1 overflow-hidden mt-2">
                <DownloadBar onClick={() => download(`${detail.summary.resource_type}-${detail.summary.ghl_id}.md`, detail.full.markdown_content || '', 'text/markdown')} label="Download MD" />
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-words">{detail.full.markdown_content}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="css" className="flex-1 overflow-hidden mt-2">
                <DownloadBar onClick={() => download(`${detail.summary.resource_type}-${detail.summary.ghl_id}.css`, detail.full.inlined_css || detail.full.css_content || '', 'text/css')} label="Download CSS" />
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{detail.full.inlined_css || detail.full.css_content}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="screenshot" className="flex-1 overflow-auto mt-2">
                {detail.full.screenshot_url && <img src={detail.full.screenshot_url} alt="screenshot" className="w-full border border-border/40 rounded" />}
              </TabsContent>

              <TabsContent value="assets" className="flex-1 overflow-hidden mt-2">
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <Table>
                    <TableHeader><TableRow><TableHead>Original URL</TableHead><TableHead className="w-24">Size</TableHead><TableHead className="w-32">Status</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(detail.full.asset_manifest || []).map((a: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-[11px] font-mono break-all">{a.original_url}</TableCell>
                          <TableCell className="text-xs">{fmtBytes(a.bytes || 0)}</TableCell>
                          <TableCell className="text-xs">{a.skipped ? <Badge variant="secondary">{a.skipped}</Badge> : <Badge>stored</Badge>}</TableCell>
                          <TableCell>
                            {a.storage_path && (
                              <Button size="sm" variant="ghost" onClick={async () => {
                                const r = await invokeSecureFunction('ghl-marketing-raw-dump', { action: 'asset_signed_url', path: a.storage_path });
                                if (r.data?.url) window.open(r.data.url, '_blank');
                              }}><ExternalLink className="h-3.5 w-3.5" /></Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="submissions" className="flex-1 overflow-hidden mt-2">
                <DownloadBar onClick={() => download(`${detail.summary.resource_type}-${detail.summary.ghl_id}.submissions.json`, JSON.stringify(detail.full.submissions_sample, null, 2), 'application/json')} label="Download" />
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{JSON.stringify(detail.full.submissions_sample, null, 2)}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="embed" className="flex-1 overflow-hidden mt-2">
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{detail.full.embed_code}</pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="endpoints" className="flex-1 overflow-hidden mt-2">
                <ScrollArea className="h-full border border-border/40 rounded-md">
                  <pre className="text-[11px] p-3 font-mono whitespace-pre-wrap break-all">{JSON.stringify(detail.full.endpoints_tried, null, 2)}</pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DownloadBar({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex justify-end mb-2">
      <Button size="sm" variant="outline" onClick={onClick}><Download className="h-3.5 w-3.5 mr-1" />{label}</Button>
    </div>
  );
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

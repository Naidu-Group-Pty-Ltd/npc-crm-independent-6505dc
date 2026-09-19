/**
 * Report Engine Inspector
 *
 * Superadmin-only window into the report generation engine.
 * Surfaces every run, the exact system prompt sent, the data packet
 * captured, the embeddings retrieved per section, and every chunk's
 * inputs/outputs. Includes the dedicated agentic editor in the right rail.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, RefreshCw, Send, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import PromptLibrary from '@/components/admin/PromptLibrary';

interface Run {
  id: string;
  report_id: string | null;
  scope: string | null;
  variant: string | null;
  model: string | null;
  status: string;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cost_cents: number;
  started_at: string;
  finished_at: string | null;
  trigger_source: string | null;
  error: string | null;
  data_packet_size_bytes: number | null;
}

interface Chunk {
  id: string;
  section_key: string;
  section_label: string | null;
  ordinal: number;
  model: string | null;
  system_prompt: string | null;
  user_prompt: string | null;
  attached_template_chunk_ids: any;
  attached_packet_keys: string[];
  retrieval_meta: any;
  response: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number | null;
  status: string;
  error: string | null;
}

interface FullRun extends Run {
  template_ids: any;
  system_prompt: string | null;
  data_packet: any;
  data_packet_hash: string | null;
  registry_snapshot: any;
}

function fmtBytes(n: number | null | undefined) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtMs(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

export default function ReportEngineInspector() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<FullRun | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadRuns = async () => {
    setLoadingRuns(true);
    const { data, error } = await invokeSecureFunction<{ runs: Run[] }>(
      'report-engine-inspector', { op: 'list_runs', limit: 50 },
    );
    setLoadingRuns(false);
    if (error) { toast({ title: 'Failed to load runs', description: error.message, variant: 'destructive' }); return; }
    setRuns(data?.runs ?? []);
    if (!selectedId && data?.runs?.length) setSelectedId(data.runs[0].id);
  };

  const loadRun = async (id: string) => {
    setLoadingDetail(true);
    const { data, error } = await invokeSecureFunction<{ run: FullRun; chunks: Chunk[] }>(
      'report-engine-inspector', { op: 'get_run', run_id: id },
    );
    setLoadingDetail(false);
    if (error) { toast({ title: 'Failed to load run', description: error.message, variant: 'destructive' }); return; }
    setRun(data?.run ?? null);
    setChunks(data?.chunks ?? []);
  };

  useEffect(() => { loadRuns(); }, []);
  useEffect(() => { if (selectedId) loadRun(selectedId); }, [selectedId]);

  // Realtime: refresh detail when chunks stream in
  useEffect(() => {
    if (!selectedId) return;
    const ch = supabase
      .channel(`run-${selectedId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'report_generation_chunks', filter: `run_id=eq.${selectedId}` },
        () => loadRun(selectedId))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'report_generation_runs', filter: `id=eq.${selectedId}` },
        () => loadRun(selectedId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedId]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Report Engine Inspector</h1>
          <p className="text-sm text-muted-foreground">
            Every generation run, the exact prompt + data packet, embeddings retrieved per section, and an agent to edit the engine.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadRuns} disabled={loadingRuns}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loadingRuns ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="static">Static Plan</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Library</TabsTrigger>
          <TabsTrigger value="config">Engine Config</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-3 p-2">
              <ScrollArea className="h-[78vh]">
                {loadingRuns && <div className="p-4 text-sm text-muted-foreground">Loading runs…</div>}
                {!loadingRuns && runs.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    No runs yet. Generate a report once instrumentation is wired into the engine.
                  </div>
                )}
                <div className="space-y-1">
                  {runs.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors
                        ${selectedId === r.id ? 'bg-primary/10 border border-primary/40' : 'hover:bg-muted/50 border border-transparent'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{r.scope || 'run'} · {r.variant || '—'}</span>
                        <Badge variant={
                          r.status === 'completed' ? 'default' :
                          r.status === 'failed' ? 'destructive' :
                          r.status === 'running' ? 'secondary' : 'outline'
                        } className="h-4 px-1.5 text-[10px]">{r.status}</Badge>
                      </div>
                      <div className="text-muted-foreground mt-0.5 truncate">
                        {new Date(r.started_at).toLocaleString('en-AU')}
                      </div>
                      <div className="text-muted-foreground/80 mt-0.5">
                        {r.model || '—'} · {(r.total_prompt_tokens + r.total_completion_tokens) || 0} tok
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </Card>

            <Card className="col-span-6 p-4">
              {loadingDetail && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
              {!loadingDetail && !run && <div className="text-sm text-muted-foreground">Select a run.</div>}
              {!loadingDetail && run && <RunDetail run={run} chunks={chunks} />}
            </Card>

            <Card className="col-span-3 p-0 overflow-hidden">
              <EngineAgentPanel currentRunId={selectedId} onProposalApplied={() => loadRuns()} />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="static">
          <StaticPlanTab />
        </TabsContent>

        <TabsContent value="prompts">
          <PromptLibrary />
        </TabsContent>

        <TabsContent value="config">
          <EngineConfigEditor />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

// Heuristic: extract pre/post-gen manual override key names from a packet.
function extractOverrideMeta(packet: any): {
  preGenKeys: string[];
  postGenKeys: string[];
  preGenObj: Record<string, any> | null;
  postGenObj: Record<string, any> | null;
} {
  if (!packet || typeof packet !== 'object') {
    return { preGenKeys: [], postGenKeys: [], preGenObj: null, postGenObj: null };
  }
  const preGen =
    packet.manualOverrides ?? packet.manual_overrides ?? packet.preGenerationOverrides ??
    packet.pre_gen_overrides ?? null;
  const postGen =
    packet.postGenerationOverrides ?? packet.post_gen_overrides ?? packet.postEditedFields ?? null;
  return {
    preGenKeys: preGen && typeof preGen === 'object' ? Object.keys(preGen) : [],
    postGenKeys: postGen && typeof postGen === 'object' ? Object.keys(postGen) : [],
    preGenObj: preGen ?? null,
    postGenObj: postGen ?? null,
  };
}

// Pull every template-id reference (UUID) out of arbitrary jsonb shapes.
function collectTemplateIds(value: any, acc: Set<string> = new Set()): Set<string> {
  if (!value) return acc;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof value === 'string') {
    const stripped = value.replace(/^template:/, '');
    if (uuidRe.test(stripped)) acc.add(stripped);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectTemplateIds(v, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const k of ['template_id', 'templateId', 'document_name', 'id']) {
      if (typeof value[k] === 'string') collectTemplateIds(value[k], acc);
    }
    for (const v of Object.values(value)) collectTemplateIds(v, acc);
  }
  return acc;
}

interface TemplateMeta {
  id: string; name: string; template_type: string | null;
  report_tier: string | null; report_category: string | null;
  is_active: boolean; priority: number | null;
}

function RunDetail({ run, chunks }: { run: FullRun; chunks: Chunk[] }) {
  const packetKeys = useMemo(() => {
    if (!run.data_packet || typeof run.data_packet !== 'object') return [];
    return Object.keys(run.data_packet);
  }, [run.data_packet]);

  const overrides = useMemo(() => extractOverrideMeta(run.data_packet), [run.data_packet]);
  const overrideKeySet = useMemo(
    () => new Set([...overrides.preGenKeys, ...overrides.postGenKeys]),
    [overrides],
  );

  // Resolve all template IDs referenced anywhere in the run.
  const referencedTemplateIds = useMemo(() => {
    const acc = new Set<string>();
    collectTemplateIds(run.template_ids, acc);
    collectTemplateIds(run.registry_snapshot, acc);
    for (const c of chunks) {
      collectTemplateIds(c.attached_template_chunk_ids, acc);
      collectTemplateIds(c.retrieval_meta, acc);
    }
    return Array.from(acc);
  }, [run, chunks]);

  const [templateMeta, setTemplateMeta] = useState<Record<string, TemplateMeta>>({});
  useEffect(() => {
    if (referencedTemplateIds.length === 0) { setTemplateMeta({}); return; }
    (async () => {
      const { data } = await invokeSecureFunction<{ templates: TemplateMeta[] }>(
        'report-engine-inspector',
        { op: 'resolve_templates', template_ids: referencedTemplateIds },
      );
      const map: Record<string, TemplateMeta> = {};
      for (const t of data?.templates ?? []) map[t.id] = t;
      setTemplateMeta(map);
    })();
  }, [referencedTemplateIds.join('|')]);

  const totalPacketKeys = packetKeys.length;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2 className="text-lg font-semibold">{run.scope || 'run'} · {run.variant || '—'}</h2>
          <Badge variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge>
          {run.trigger_source && <Badge variant="outline" className="text-[10px]">{run.trigger_source}</Badge>}
          {overrides.preGenKeys.length > 0 && (
            <Badge variant="warning" className="text-[10px]">
              Pre-gen overrides · {overrides.preGenKeys.length}
            </Badge>
          )}
          {overrides.postGenKeys.length > 0 && (
            <Badge variant="info" className="text-[10px]">
              Post-gen edits · {overrides.postGenKeys.length}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground grid grid-cols-4 gap-x-4 gap-y-1">
          <div><span className="text-foreground/80">Model:</span> {run.model || '—'}</div>
          <div><span className="text-foreground/80">Tokens:</span> {run.total_prompt_tokens + run.total_completion_tokens}</div>
          <div><span className="text-foreground/80">Packet:</span> {fmtBytes(run.data_packet_size_bytes)}</div>
          <div><span className="text-foreground/80">Hash:</span> <span className="font-mono">{run.data_packet_hash?.slice(0, 10) || '—'}</span></div>
          <div><span className="text-foreground/80">Report:</span> <span className="font-mono">{run.report_id?.slice(0, 8) || '—'}</span></div>
          <div><span className="text-foreground/80">Templates:</span> {referencedTemplateIds.length}</div>
          <div><span className="text-foreground/80">Chunks:</span> {chunks.length}</div>
          <div><span className="text-foreground/80">Duration:</span> {run.finished_at ? fmtMs(new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) : 'running'}</div>
        </div>
        {run.error && (
          <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded p-2">{run.error}</div>
        )}
      </div>

      <Tabs defaultValue="prompt">
        <TabsList>
          <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="packet">Data Packet</TabsTrigger>
          <TabsTrigger value="overrides">Overrides ({overrides.preGenKeys.length + overrides.postGenKeys.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({referencedTemplateIds.length})</TabsTrigger>
          <TabsTrigger value="matrix">Packet Matrix</TabsTrigger>
          <TabsTrigger value="embeddings">Embeddings</TabsTrigger>
          <TabsTrigger value="chunks">Chunks ({chunks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          <ScrollArea className="h-[58vh] rounded border bg-muted/30 p-3">
            <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">{run.system_prompt || '— no system prompt captured —'}</pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="packet">
          <ScrollArea className="h-[58vh] rounded border bg-muted/30 p-3">
            <pre className="text-[11px] whitespace-pre-wrap font-mono">{JSON.stringify(run.data_packet ?? {}, null, 2)}</pre>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="overrides">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="warning">Pre-generation</Badge>
                <span className="text-xs text-muted-foreground">manualOverrides supplied at generation time</span>
              </div>
              {overrides.preGenKeys.length === 0 ? (
                <div className="text-xs text-muted-foreground">No pre-gen overrides captured in packet.</div>
              ) : (
                <ScrollArea className="h-[55vh]">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-muted-foreground"><th className="text-left p-1">Field</th><th className="text-left p-1">Value</th><th className="text-right p-1">Used in chunks</th></tr></thead>
                    <tbody>
                      {overrides.preGenKeys.map((k) => {
                        const v = (overrides.preGenObj as any)?.[k];
                        const usedIn = chunks.filter((c) =>
                          c.attached_packet_keys?.includes('manualOverrides') ||
                          c.attached_packet_keys?.includes('manual_overrides') ||
                          c.attached_packet_keys?.includes(k) ||
                          (c.user_prompt && c.user_prompt.toLowerCase().includes(k.toLowerCase()))
                        ).length;
                        return (
                          <tr key={k} className="border-t border-border/30">
                            <td className="p-1 font-mono">{k}</td>
                            <td className="p-1 font-mono text-foreground/80 truncate max-w-[180px]">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                            <td className="p-1 text-right">
                              <Badge variant={usedIn === chunks.length ? 'success' : usedIn === 0 ? 'destructive' : 'outline'} className="text-[10px]">
                                {usedIn}/{chunks.length}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="info">Post-generation</Badge>
                <span className="text-xs text-muted-foreground">edits applied after generation</span>
              </div>
              {overrides.postGenKeys.length === 0 ? (
                <div className="text-xs text-muted-foreground">No post-gen edits captured in packet.</div>
              ) : (
                <ScrollArea className="h-[55vh]">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap">{JSON.stringify(overrides.postGenObj, null, 2)}</pre>
                </ScrollArea>
              )}
            </Card>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            "Used in chunks" counts how many chunks have the override packet key attached or reference the field name in their prompt. <span className="text-warning">Anything &lt; total chunks</span> means the override is not flowing to every section.
          </p>
        </TabsContent>

        <TabsContent value="templates">
          <ScrollArea className="h-[58vh]">
            {referencedTemplateIds.length === 0 ? (
              <div className="text-xs text-muted-foreground p-4">No template references captured. Generators may not have wired template retrieval into the trace yet.</div>
            ) : (
              <div className="space-y-2">
                {referencedTemplateIds.map((id) => {
                  const meta = templateMeta[id];
                  const usedIn = chunks.filter((c) =>
                    JSON.stringify(c.attached_template_chunk_ids ?? '').includes(id) ||
                    JSON.stringify(c.retrieval_meta ?? '').includes(id)
                  );
                  return (
                    <div key={id} className="border rounded p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium truncate">{meta?.name || '(unresolved)'}</span>
                          {meta?.template_type && <Badge variant="outline" className="text-[10px]">{meta.template_type}</Badge>}
                          {meta?.report_tier && <Badge variant="secondary" className="text-[10px]">{meta.report_tier}</Badge>}
                          {meta?.report_category && <Badge variant="outline" className="text-[10px]">{meta.report_category}</Badge>}
                          {meta && !meta.is_active && <Badge variant="destructive" className="text-[10px]">inactive</Badge>}
                        </div>
                        <Badge variant={usedIn.length === 0 ? 'destructive' : 'success'} className="text-[10px] shrink-0">
                          used in {usedIn.length}/{chunks.length}
                        </Badge>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1">{id}</div>
                      {usedIn.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          sections: {usedIn.map((c) => c.section_key).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="matrix">
          {/* rows = chunks, columns = packet keys. Override keys are highlighted. */}
          <ScrollArea className="h-[58vh] rounded border">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-background">
                <tr>
                  <th className="text-left p-2 font-medium">Section</th>
                  <th className="p-1 font-medium text-left">Coverage</th>
                  {packetKeys.map((k) => (
                    <th key={k} className={`p-1 text-left font-mono ${overrideKeySet.has(k) ? 'text-warning' : 'text-muted-foreground'}`} title={overrideKeySet.has(k) ? `${k} (override field)` : k}>
                      <div className="rotate-[-45deg] origin-bottom-left translate-y-2 whitespace-nowrap">
                        {overrideKeySet.has(k) ? '★ ' : ''}{k}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chunks.map((c) => {
                  const attached = c.attached_packet_keys?.length ?? 0;
                  const isFull = attached >= totalPacketKeys && totalPacketKeys > 0;
                  return (
                    <tr key={c.id} className="border-t border-border/40">
                      <td className="p-2 font-mono whitespace-nowrap">{c.section_key}</td>
                      <td className="p-1">
                        <Badge variant={isFull ? 'success' : attached === 0 ? 'destructive' : 'outline'} className="text-[9px]">
                          {isFull ? 'FULL' : `${attached}/${totalPacketKeys}`}
                        </Badge>
                      </td>
                      {packetKeys.map((k) => (
                        <td key={k} className="p-1 text-center">
                          {c.attached_packet_keys?.includes(k)
                            ? <span className={`inline-block w-2.5 h-2.5 rounded-sm ${overrideKeySet.has(k) ? 'bg-warning' : 'bg-success'}`} />
                            : <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted" />}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {chunks.length === 0 && <div className="p-4 text-xs text-muted-foreground">No chunks recorded yet.</div>}
          </ScrollArea>
          <p className="text-[11px] text-muted-foreground mt-2">
            <span className="inline-block w-2 h-2 rounded-sm bg-success mr-1" /> regular key inlined ·
            <span className="inline-block w-2 h-2 rounded-sm bg-warning mx-1" /> override key inlined (★ marked column) ·
            <span className="inline-block w-2 h-2 rounded-sm bg-muted mx-1" /> not attached.
            "FULL" = chunk ingested entire packet.
          </p>
        </TabsContent>

        <TabsContent value="embeddings">
          <ScrollArea className="h-[58vh] space-y-2">
            {chunks.map((c) => {
              const chunkTemplateIds = Array.from(collectTemplateIds(c.attached_template_chunk_ids));
              const retrievalTemplateIds = Array.from(collectTemplateIds(c.retrieval_meta));
              const allIds = Array.from(new Set([...chunkTemplateIds, ...retrievalTemplateIds]));
              return (
                <div key={c.id} className="border rounded p-2 mb-2">
                  <div className="text-xs font-medium mb-1 flex items-center gap-2">
                    {c.section_key}
                    <Badge variant="outline" className="text-[9px]">{allIds.length} template{allIds.length === 1 ? '' : 's'}</Badge>
                  </div>
                  {allIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {allIds.map((id) => (
                        <span key={id} className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/40">
                          {templateMeta[id]?.name || id.slice(0, 8)}
                          {templateMeta[id]?.report_tier && <span className="text-muted-foreground"> · {templateMeta[id]?.report_tier}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.retrieval_meta ? (
                    <div className="text-[11px] space-y-1">
                      <div className="text-muted-foreground">
                        query: <span className="font-mono">{String(c.retrieval_meta.query || '').slice(0, 120)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        threshold: {c.retrieval_meta.threshold ?? '—'} · k: {c.retrieval_meta.k ?? '—'} · hits: {c.retrieval_meta.hits?.length ?? 0}
                      </div>
                      {Array.isArray(c.retrieval_meta.hits) && c.retrieval_meta.hits.slice(0, 5).map((h: any, i: number) => {
                        const tid = String(h.document_name || h.template_id || '').replace(/^template:/, '');
                        return (
                          <div key={i} className="font-mono text-[10px] truncate text-foreground/70">
                            {(h.similarity ?? 0).toFixed(3)} · {templateMeta[tid]?.name || tid.slice(0, 8) || ''} · {h.preview || h.chunk_id || ''}
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="text-[11px] text-muted-foreground">no retrieval captured</div>}
                </div>
              );
            })}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="chunks">
          <ScrollArea className="h-[58vh] space-y-2">
            {chunks.map((c) => (
              <ChunkCard
                key={c.id}
                chunk={c}
                templateMeta={templateMeta}
                totalPacketKeys={totalPacketKeys}
                overrideKeys={overrides.preGenKeys}
              />
            ))}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChunkCard({
  chunk, templateMeta, totalPacketKeys, overrideKeys,
}: {
  chunk: Chunk;
  templateMeta: Record<string, TemplateMeta>;
  totalPacketKeys: number;
  overrideKeys: string[];
}) {
  const [open, setOpen] = useState(false);
  const attached = chunk.attached_packet_keys?.length ?? 0;
  const isFull = attached >= totalPacketKeys && totalPacketKeys > 0;
  const overrideKeysAttached = overrideKeys.filter((k) =>
    chunk.attached_packet_keys?.includes(k) ||
    chunk.attached_packet_keys?.includes('manualOverrides') ||
    chunk.attached_packet_keys?.includes('manual_overrides')
  );
  const overrideCoverage = overrideKeys.length === 0
    ? 'n/a'
    : `${overrideKeysAttached.length}/${overrideKeys.length}`;
  const templateIds = Array.from(collectTemplateIds(chunk.attached_template_chunk_ids));
  return (
    <div className="border rounded mb-2">
      <button className="w-full text-left p-2 flex items-center justify-between gap-2" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center gap-2 min-w-0">
          {chunk.status === 'completed' ? <CheckCircle2 className="h-3 w-3 text-success shrink-0" /> :
           chunk.status === 'failed' ? <XCircle className="h-3 w-3 text-destructive shrink-0" /> :
           <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
          <span className="text-xs font-medium truncate">{chunk.section_key}</span>
          {chunk.section_label && <span className="text-[10px] text-muted-foreground truncate">{chunk.section_label}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant={isFull ? 'success' : attached === 0 ? 'destructive' : 'outline'} className="text-[9px]">
            packet {isFull ? 'FULL' : `${attached}/${totalPacketKeys}`}
          </Badge>
          {overrideKeys.length > 0 && (
            <Badge
              variant={overrideKeysAttached.length === overrideKeys.length ? 'success' : overrideKeysAttached.length === 0 ? 'destructive' : 'warning'}
              className="text-[9px]"
            >
              overrides {overrideCoverage}
            </Badge>
          )}
          {templateIds.length > 0 && (
            <Badge variant="outline" className="text-[9px]">
              {templateIds.length} tmpl
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {chunk.prompt_tokens + chunk.completion_tokens} tok · {fmtMs(chunk.latency_ms)}
          </span>
        </div>
      </button>
      {open && (
        <div className="p-2 border-t bg-muted/20 space-y-2">
          {templateIds.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-1">Embedding sources ({templateIds.length})</div>
              <div className="flex flex-wrap gap-1">
                {templateIds.map((id) => (
                  <span key={id} className="text-[9px] px-1.5 py-0.5 rounded border bg-background">
                    {templateMeta[id]?.name || id.slice(0, 8)}
                    {templateMeta[id]?.report_tier && <span className="text-muted-foreground"> · {templateMeta[id]?.report_tier}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Attached packet keys ({chunk.attached_packet_keys?.length ?? 0})</div>
            <div className="flex flex-wrap gap-1">
              {(chunk.attached_packet_keys ?? []).map((k) => (
                <span key={k} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${overrideKeys.includes(k) ? 'bg-warning/20 text-warning' : 'bg-primary/10'}`}>
                  {overrideKeys.includes(k) ? '★ ' : ''}{k}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-muted-foreground mb-1">User prompt</div>
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-auto bg-background rounded p-2">{chunk.user_prompt || '—'}</pre>
          </div>
          <div>
            <div className="text-[10px] font-medium text-muted-foreground mb-1">Response</div>
            <pre className="text-[10px] font-mono whitespace-pre-wrap max-h-40 overflow-auto bg-background rounded p-2">{chunk.response || '—'}</pre>
          </div>
          {chunk.error && <div className="text-[10px] text-destructive bg-destructive/10 rounded p-2">{chunk.error}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine agent panel
// ---------------------------------------------------------------------------

interface ChatMsg { role: 'user' | 'assistant' | 'tool' | 'system'; content: string; _invocations?: any[]; }

function EngineAgentPanel({ currentRunId, onProposalApplied }: { currentRunId: string | null; onProposalApplied: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [proposals, setProposals] = useState<any[]>([]);

  const loadProposals = async () => {
    const { data } = await invokeSecureFunction<{ proposals: any[] }>(
      'report-engine-inspector', { op: 'list_proposals', status: 'pending' });
    setProposals(data?.proposals ?? []);
  };
  useEffect(() => { loadProposals(); }, []);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: ChatMsg = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setSending(true);

    // Inject context about the currently-selected run
    const contextPrefix = currentRunId
      ? `(Context: user is viewing run ${currentRunId}. Use get_run if relevant.)\n`
      : '';
    const apiMessages = next.map((m, i) => ({
      role: m.role,
      content: i === 0 && contextPrefix ? `${contextPrefix}${m.content}` : m.content,
    }));

    const { data, error } = await invokeSecureFunction<{ assistant: string; tool_invocations: any[] }>(
      'report-engine-agent', { messages: apiMessages }, { timeoutMs: 120000 });

    setSending(false);
    if (error) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${error.message}` }]);
      return;
    }
    setMessages([...next, {
      role: 'assistant',
      content: data?.assistant || '(no reply)',
      _invocations: data?.tool_invocations ?? [],
    }]);
    loadProposals();
  };

  const apply = async (id: string) => {
    const { data, error } = await invokeSecureFunction<any>(
      'report-engine-inspector', { op: 'apply_proposal', proposal_id: id });
    if (error || !data?.ok) {
      toast({ title: 'Apply failed', description: error?.message || data?.error || 'unknown', variant: 'destructive' });
      return;
    }
    toast({ title: 'Proposal applied' });
    loadProposals();
    onProposalApplied();
  };
  const reject = async (id: string) => {
    await invokeSecureFunction('report-engine-inspector', { op: 'reject_proposal', proposal_id: id });
    loadProposals();
  };

  return (
    <div className="flex flex-col h-[78vh]">
      <div className="p-3 border-b">
        <div className="text-sm font-medium">Engine Agent</div>
        <div className="text-[11px] text-muted-foreground">Scoped to templates, registry, retrieval knobs. Proposals only.</div>
      </div>

      {proposals.length > 0 && (
        <div className="border-b bg-primary/5 p-2 space-y-2 max-h-40 overflow-auto">
          <div className="text-[11px] font-medium">Pending proposals ({proposals.length})</div>
          {proposals.map((p) => (
            <div key={p.id} className="border rounded p-2 bg-background">
              <div className="text-[11px] font-medium">{p.target_kind} {p.target_id ? `· ${String(p.target_id).slice(0, 8)}` : ''}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{p.rationale}</div>
              <div className="flex gap-1 mt-2">
                <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => apply(p.id)}>Apply</Button>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => reject(p.id)}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1 p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground space-y-2">
            <p>Ask me about the engine. Examples:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>"Show me the system prompt used in the most recent compass run"</li>
              <li>"Lower the retrieval threshold to 0.65 for ai_structure templates"</li>
              <li>"Which sections have the largest data packet?"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 ${m.role === 'user' ? 'text-right' : ''}`}>
            <div className={`inline-block max-w-full text-xs rounded px-2 py-1.5 whitespace-pre-wrap
              ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              {m.content}
            </div>
            {m._invocations && m._invocations.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m._invocations.map((inv: any) => (
                  <span key={inv.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-background">
                    <Wrench className="h-2.5 w-2.5" />{inv.name}
                    <span className="text-muted-foreground">{fmtMs(inv.duration_ms)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</div>}
      </ScrollArea>

      <div className="p-2 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask the engine agent…"
          disabled={sending}
        />
        <Button size="sm" onClick={send} disabled={sending || !input.trim()}>
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine Config editor
// ---------------------------------------------------------------------------

interface EngineConfigRow {
  id: string;
  config_key: string;
  scope: string;
  value: any;
  description: string | null;
  updated_at: string;
}

function EngineConfigEditor() {
  const [rows, setRows] = useState<EngineConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ config_key: string; scope: string; valueText: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction<{ configs: EngineConfigRow[] }>(
      'report-engine-inspector', { op: 'list_engine_config' },
    );
    setLoading(false);
    if (error) { toast({ title: 'Failed to load config', description: error.message, variant: 'destructive' }); return; }
    setRows(data?.configs ?? []);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => setEditing({ config_key: '', scope: 'default', valueText: '""', description: '' });
  const startEdit = (r: EngineConfigRow) => setEditing({
    config_key: r.config_key, scope: r.scope,
    valueText: typeof r.value === 'string' ? JSON.stringify(r.value) : JSON.stringify(r.value, null, 2),
    description: r.description || '',
  });

  const save = async () => {
    if (!editing || !editing.config_key) {
      toast({ title: 'config_key required', variant: 'destructive' }); return;
    }
    let parsed: any;
    try { parsed = JSON.parse(editing.valueText); }
    catch (e: any) { toast({ title: 'Invalid JSON value', description: e.message, variant: 'destructive' }); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction<{ ok: boolean }>(
      'report-engine-inspector',
      { op: 'upsert_engine_config', config_key: editing.config_key, scope: editing.scope, value: parsed, description: editing.description, rationale: 'direct edit from inspector' },
    );
    setSaving(false);
    if (error || !data?.ok) { toast({ title: 'Save failed', description: error?.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved' });
    setEditing(null);
    load();
  };

  const del = async (r: EngineConfigRow) => {
    if (!confirm(`Delete ${r.config_key}:${r.scope}?`)) return;
    const { error } = await invokeSecureFunction(
      'report-engine-inspector',
      { op: 'delete_engine_config', config_key: r.config_key, scope: r.scope, rationale: 'direct delete from inspector' },
    );
    if (error) { toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Deleted' });
    load();
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-5 p-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium">Engine Config</div>
            <div className="text-[11px] text-muted-foreground">Runtime overrides honored by the generator on the next run.</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={startNew}>+ New</Button>
          </div>
        </div>
        <ScrollArea className="h-[70vh]">
          {rows.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground p-4">
              No overrides set. The generator uses its in-code defaults. Click + New to override (e.g. <span className="font-mono">system_message</span> @ scope <span className="font-mono">default</span>).
            </div>
          )}
          <div className="space-y-1">
            {rows.map((r) => (
              <button key={r.id}
                onClick={() => startEdit(r)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs border transition-colors
                  ${editing?.config_key === r.config_key && editing?.scope === r.scope ? 'bg-primary/10 border-primary/40' : 'hover:bg-muted/50 border-transparent'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{r.config_key}</span>
                  <Badge variant="outline" className="text-[10px]">{r.scope}</Badge>
                </div>
                {r.description && <div className="text-muted-foreground mt-0.5 truncate">{r.description}</div>}
                <div className="text-muted-foreground/70 text-[10px] mt-0.5">updated {new Date(r.updated_at).toLocaleString('en-AU')}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="col-span-7 p-4">
        {!editing && <div className="text-sm text-muted-foreground">Select a row to edit, or create a new override.</div>}
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium">config_key</label>
                <Input value={editing.config_key} onChange={(e) => setEditing({ ...editing, config_key: e.target.value })} placeholder="system_message" />
              </div>
              <div>
                <label className="text-xs font-medium">scope</label>
                <Input value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })} placeholder="default | compass | suburb | postcode | statewide | executive" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">description</label>
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">value (JSON — use a quoted string for system_message)</label>
              <Textarea
                value={editing.valueText}
                onChange={(e) => setEditing({ ...editing, valueText: e.target.value })}
                className="font-mono text-xs h-[50vh]"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Tokens: <span className="font-mono">{'{{brand_name}}'}</span>, <span className="font-mono">{'{{scope}}'}</span> are substituted at runtime when value is a string.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              {rows.find((r) => r.config_key === editing.config_key && r.scope === editing.scope) && (
                <Button size="sm" variant="destructive" className="ml-auto"
                  onClick={() => del(rows.find((r) => r.config_key === editing.config_key && r.scope === editing.scope)!)}>
                  Delete override
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

function AuditLog() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await invokeSecureFunction<{ audit: any[] }>(
        'report-engine-inspector', { op: 'list_audit' });
      setRows(data?.audit ?? []);
      setLoading(false);
    })();
  }, []);
  return (
    <Card className="p-4">
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && rows.length === 0 && <div className="text-sm text-muted-foreground">No audit entries yet.</div>}
      <ScrollArea className="h-[75vh]">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="border rounded p-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.target_kind}</Badge>
                  <span className="font-mono text-[10px]">{r.target_id || '—'}</span>
                </div>
                <span className="text-muted-foreground text-[10px]">{new Date(r.performed_at).toLocaleString('en-AU')}</span>
              </div>
              {r.rationale && <div className="text-muted-foreground mt-1">{r.rationale}</div>}
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] text-muted-foreground">diff</summary>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <pre className="bg-muted/30 rounded p-2 text-[10px] overflow-auto max-h-60">{JSON.stringify(r.before_value, null, 2)}</pre>
                  <pre className="bg-muted/30 rounded p-2 text-[10px] overflow-auto max-h-60">{JSON.stringify(r.after_value, null, 2)}</pre>
                </div>
              </details>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Static Plan tab — visibility WITHOUT needing a live generation run.
// ---------------------------------------------------------------------------

interface PlanSection {
  id: string;
  ordinal: number;
  name: string;
  sourceHeadings?: string[];
  purpose?: string;
  pageBudget?: number;
}
interface PlanTemplate {
  id: string;
  name: string;
  template_type: string | null;
  report_tier: string | null;
  report_category: string | null;
  is_active: boolean;
  priority: number | null;
  embedding_chunks: number;
}
interface PlanResponse {
  scope: string;
  sections: PlanSection[];
  templates: PlanTemplate[];
  template_pool_size: number;
  total_embedding_chunks: number;
  retrieval_note: string;
  section_template_map: Record<string, string[]>;
  overrides: null | {
    report: any;
    pre_gen_overrides: Record<string, any>;
    pre_gen_keys: string[];
    post_gen_edits: Array<{ target_kind: string; after_value: any; performed_at: string; rationale: string | null }>;
    section_override_map: Array<{ section_id: string; override_keys: string[] }>;
  };
}

function StaticPlanTab() {
  const [scope, setScope] = useState<string>('compass');
  const [reportTier, setReportTier] = useState<string>('');
  const [reportCategory, setReportCategory] = useState<string>('investment');
  const [reportId, setReportId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [templateChunks, setTemplateChunks] = useState<Record<string, any[]>>({});
  const [savingMap, setSavingMap] = useState(false);
  const [overridesDraft, setOverridesDraft] = useState<string>('');
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [proposeMode, setProposeMode] = useState(false);
  const [pendingMapProps, setPendingMapProps] = useState<any[]>([]);
  const [lookup, setLookup] = useState<any | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);

  const loadPendingMapProposals = async () => {
    const { data } = await invokeSecureFunction<{ proposals: any[] }>(
      'report-engine-inspector', { op: 'list_proposals', status: 'pending' },
    );
    const filtered = (data?.proposals ?? []).filter((p: any) =>
      p.target_kind === 'engine_config' &&
      String(p.after_value?.config_key || '').startsWith('section_template_map:')
    );
    setPendingMapProps(filtered);
  };
  useEffect(() => { loadPendingMapProposals(); }, []);

  const doLookup = async (idArg?: string) => {
    const id = (idArg ?? lookupId).trim();
    if (!id) return;
    setLookupLoading(true);
    const { data, error } = await invokeSecureFunction<any>(
      'report-engine-inspector', { op: 'lookup_report', report_id: id },
    );
    setLookupLoading(false);
    if (error) { toast({ title: 'Lookup failed', description: error.message, variant: 'destructive' }); return; }
    setLookup(data);
  };

  const applyProposal = async (id: string) => {
    const { error } = await invokeSecureFunction('report-engine-inspector', { op: 'apply_proposal', proposal_id: id });
    if (error) { toast({ title: 'Apply failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Applied', description: 'Proposal applied' });
    await Promise.all([loadPendingMapProposals(), load()]);
  };
  const rejectProposal = async (id: string) => {
    const { error } = await invokeSecureFunction('report-engine-inspector', { op: 'reject_proposal', proposal_id: id, rejection_reason: 'rejected from static plan' });
    if (error) { toast({ title: 'Reject failed', description: error.message, variant: 'destructive' }); return; }
    loadPendingMapProposals();
  };

  const load = async (reportIdOverride?: string) => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction<PlanResponse>(
      'report-engine-inspector',
      {
        op: 'static_plan',
        scope,
        report_tier: reportTier || undefined,
        report_category: reportCategory || undefined,
        report_id: (reportIdOverride ?? reportId).trim() || undefined,
      },
    );
    setLoading(false);
    if (error) {
      toast({ title: 'Failed to load static plan', description: error.message, variant: 'destructive' });
      return;
    }
    setPlan(data ?? null);
    setOverridesDraft(JSON.stringify(data?.overrides?.pre_gen_overrides ?? {}, null, 2));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope, reportTier, reportCategory]);

  const sectionOverrideMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of plan?.overrides?.section_override_map ?? []) m.set(r.section_id, r.override_keys);
    return m;
  }, [plan]);

  const loadTemplateChunks = async (id: string) => {
    if (templateChunks[id]) return;
    const { data, error } = await invokeSecureFunction<{ chunks: any[] }>(
      'report-engine-inspector', { op: 'list_template_chunks', template_id: id, limit: 200 },
    );
    if (error) { toast({ title: 'Failed to load chunks', description: error.message, variant: 'destructive' }); return; }
    setTemplateChunks((prev) => ({ ...prev, [id]: data?.chunks ?? [] }));
  };

  const toggleSectionTemplate = async (sectionId: string, templateId: string, checked: boolean) => {
    if (!plan) return;
    const current = plan.section_template_map?.[sectionId] ?? [];
    const next = checked ? Array.from(new Set([...current, templateId])) : current.filter((x) => x !== templateId);
    setSavingMap(true);
    if (proposeMode) {
      const { error } = await invokeSecureFunction(
        'report-engine-inspector',
        { op: 'propose_section_template_map', scope, section_id: sectionId, template_ids: next },
      );
      setSavingMap(false);
      if (error) { toast({ title: 'Propose failed', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Proposed', description: `Pending: ${sectionId} → ${next.length} templates` });
      loadPendingMapProposals();
      return;
    }
    const { error } = await invokeSecureFunction(
      'report-engine-inspector',
      { op: 'set_section_template_map', scope, section_id: sectionId, template_ids: next },
    );
    setSavingMap(false);
    if (error) { toast({ title: 'Failed to save', description: error.message, variant: 'destructive' }); return; }
    setPlan({ ...plan, section_template_map: { ...plan.section_template_map, [sectionId]: next } });
    toast({ title: 'Saved', description: `${sectionId} → ${next.length} templates` });
  };

  const saveOverrides = async () => {
    if (!reportId.trim()) return;
    let parsed: any;
    try { parsed = JSON.parse(overridesDraft); }
    catch (e: any) { toast({ title: 'Invalid JSON', description: e.message, variant: 'destructive' }); return; }
    setSavingOverrides(true);
    const { error } = await invokeSecureFunction(
      'report-engine-inspector',
      { op: 'update_report_manual_overrides', report_id: reportId.trim(), manual_overrides: parsed },
    );
    setSavingOverrides(false);
    if (error) { toast({ title: 'Save failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Saved', description: 'manual_overrides updated' });
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Scope / Registry</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              className="w-full bg-background border rounded px-2 py-1.5 text-xs">
              <option value="compass">Compass (Location & Property Fit)</option>
              <option value="financial">FIN (Financial Performance)</option>
              <option value="pldd">PLDD (Property & Location DD)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Report Tier</label>
            <select value={reportTier} onChange={(e) => setReportTier(e.target.value)}
              className="w-full bg-background border rounded px-2 py-1.5 text-xs">
              <option value="">(any)</option>
              <option value="compass">compass</option>
              <option value="executive">executive</option>
              <option value="snapshot">snapshot</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Report Category</label>
            <select value={reportCategory} onChange={(e) => setReportCategory(e.target.value)}
              className="w-full bg-background border rounded px-2 py-1.5 text-xs">
              <option value="">(any)</option>
              <option value="investment">investment</option>
              <option value="comparison">comparison</option>
              <option value="suburb_snapshot">suburb_snapshot</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase text-muted-foreground">Report ID (optional overlay + edit)</label>
            <div className="flex gap-2">
              <Input value={reportId} onChange={(e) => setReportId(e.target.value)}
                placeholder="investment_reports.id"
                className="text-xs h-8 font-mono" />
              <Button size="sm" onClick={() => load()} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          {plan?.retrieval_note || 'Showing what the engine would do for the selected scope without running it.'}
          <span className="ml-2 text-foreground/70">Click a section or template row to drill down and edit.</span>
        </p>
      </Card>

      {/* Report ID lookup + drill-down */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Report Lookup</h3>
            <p className="text-[10px] text-muted-foreground">Enter a report ID to see its summary, latest run, and override keys.</p>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
              placeholder="investment_reports.id (uuid)"
              className="text-xs h-8 font-mono w-[340px]"
            />
            <Button size="sm" onClick={() => doLookup()} disabled={lookupLoading}>
              {lookupLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Lookup'}
            </Button>
            {lookup?.report?.id && (
              <Button size="sm" variant="outline" onClick={() => {
                const lookedUpReportId = lookup.report.id;
                setReportId(lookedUpReportId);
                load(lookedUpReportId);
              }}>
                Load as overlay
              </Button>
            )}
          </div>
        </div>
        {lookup?.report && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-2">
            <div className="border rounded p-2 bg-muted/20">
              <div className="text-[10px] uppercase text-muted-foreground">Summary</div>
              <div className="text-xs font-medium">{lookup.report.property_address || '—'}</div>
              <div className="text-[10px] text-muted-foreground">
                {lookup.report.report_tier ? `${lookup.report.report_tier} tier` : '—'}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge variant="outline" className="text-[10px]">{lookup.report.report_scope || '—'}</Badge>
                {lookup.report.report_variant && <Badge variant="secondary" className="text-[10px]">{lookup.report.report_variant}</Badge>}
                <Badge variant={lookup.report.status === 'completed' ? 'success' : 'outline'} className="text-[10px]">{lookup.report.status}</Badge>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate">{lookup.report.id}</div>
            </div>
            <div className="border rounded p-2 bg-muted/20">
              <div className="text-[10px] uppercase text-muted-foreground">Latest run ({lookup.runs?.length ?? 0} total)</div>
              {lookup.latest_run ? (
                <>
                  <div className="text-[10px] font-mono truncate">{lookup.latest_run.id}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="outline" className="text-[10px]">{lookup.latest_run.scope || '—'}</Badge>
                    {lookup.latest_run.variant && <Badge variant="secondary" className="text-[10px]">{lookup.latest_run.variant}</Badge>}
                    <Badge variant={lookup.latest_run.status === 'completed' ? 'success' : lookup.latest_run.status === 'failed' ? 'destructive' : 'outline'} className="text-[10px]">{lookup.latest_run.status}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {lookup.latest_run.model || '—'} · {(lookup.latest_run.total_prompt_tokens ?? 0) + (lookup.latest_run.total_completion_tokens ?? 0)} tok
                  </div>
                  <div className="text-[10px] text-muted-foreground">{lookup.latest_run.started_at && new Date(lookup.latest_run.started_at).toLocaleString('en-AU')}</div>
                </>
              ) : <div className="text-[10px] text-muted-foreground">No runs recorded.</div>}
            </div>
            <div className="border rounded p-2 bg-muted/20">
              <div className="text-[10px] uppercase text-muted-foreground">Override keys ({lookup.override_count})</div>
              {lookup.override_keys?.length ? (
                <div className="flex flex-wrap gap-1 mt-1 max-h-28 overflow-auto">
                  {lookup.override_keys.map((k: string) => (
                    <Badge key={k} variant="warning" className="text-[10px] font-mono">★ {k}</Badge>
                  ))}
                </div>
              ) : <div className="text-[10px] text-muted-foreground">No manual_overrides on this report.</div>}
            </div>
          </div>
        )}
      </Card>

      {/* Pending section_template_map proposals */}
      {pendingMapProps.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Pending section_template_map proposals</h3>
            <Badge variant="warning" className="text-[10px]">{pendingMapProps.length}</Badge>
          </div>
          <div className="space-y-1">
            {pendingMapProps.map((p) => {
              const cfgKey = String(p.after_value?.config_key || '');
              const beforeMap = p.before_value?.value || {};
              const afterMap = p.after_value?.value || {};
              const changedKeys = Array.from(new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]))
                .filter((k) => JSON.stringify(beforeMap[k]) !== JSON.stringify(afterMap[k]));
              return (
                <div key={p.id} className="border rounded p-2 text-[11px] flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono">{cfgKey}</div>
                    {changedKeys.map((k) => (
                      <div key={k} className="text-[10px] text-muted-foreground">
                        <span className="font-mono">{k}</span>: {Array.isArray(beforeMap[k]) ? beforeMap[k].length : 0} → {Array.isArray(afterMap[k]) ? afterMap[k].length : 0} templates
                      </div>
                    ))}
                    {p.rationale && <div className="text-[10px] text-muted-foreground italic mt-0.5">{p.rationale}</div>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => rejectProposal(p.id)}>Reject</Button>
                    <Button size="sm" onClick={() => applyProposal(p.id)}>Apply</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}



      {!plan ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* Template pool — clickable cards expand to show embedding chunks */}
          <Card className="col-span-5 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Eligible Template Pool</h3>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[10px]">{plan.template_pool_size} templates</Badge>
                <Badge variant="secondary" className="text-[10px]">{plan.total_embedding_chunks} embeddings</Badge>
              </div>
            </div>
            <ScrollArea className="h-[60vh]">
              {plan.templates.length === 0 ? (
                <div className="text-xs text-muted-foreground p-3">
                  No active templates match the current filters. Add or activate templates under Report Structure Configuration.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {plan.templates.map((t) => {
                    const open = expandedTemplate === t.id;
                    return (
                      <div key={t.id} className="border rounded">
                        <button
                          type="button"
                          onClick={() => {
                            const next = open ? null : t.id;
                            setExpandedTemplate(next);
                            if (next) loadTemplateChunks(t.id);
                          }}
                          className="w-full text-left p-2 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium truncate">{open ? '▾ ' : '▸ '}{t.name}</span>
                            <Badge variant={t.embedding_chunks === 0 ? 'destructive' : 'success'} className="text-[10px] shrink-0">
                              {t.embedding_chunks} chunks
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {t.template_type && <Badge variant="outline" className="text-[10px]">{t.template_type}</Badge>}
                            {t.report_tier && <Badge variant="secondary" className="text-[10px]">{t.report_tier}</Badge>}
                            {t.report_category && <Badge variant="outline" className="text-[10px]">{t.report_category}</Badge>}
                            {t.priority != null && <Badge variant="outline" className="text-[10px]">p{t.priority}</Badge>}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate">{t.id}</div>
                        </button>
                        {open && (
                          <div className="border-t bg-muted/20 p-2 space-y-1">
                            {!templateChunks[t.id] ? (
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" /> loading chunks…
                              </div>
                            ) : templateChunks[t.id].length === 0 ? (
                              <div className="text-[10px] text-muted-foreground">No embeddings ingested for this template yet.</div>
                            ) : (
                              templateChunks[t.id].map((c: any) => (
                                <details key={c.id} className="border rounded bg-background/60">
                                  <summary className="cursor-pointer text-[10px] px-2 py-1 flex justify-between">
                                    <span>chunk #{c.chunk_index} · {c.token_count ?? '?'} tok</span>
                                    <span className="font-mono text-muted-foreground">{String(c.id).slice(0, 8)}</span>
                                  </summary>
                                  <pre className="text-[10px] whitespace-pre-wrap font-mono p-2 max-h-48 overflow-auto">{c.chunk_text}</pre>
                                </details>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </Card>

          {/* Sections — clickable rows expand to show per-section template assignment + overrides */}
          <Card className="col-span-7 p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="text-sm font-semibold">Registry Sections ({plan.sections.length})</h3>
              <div className="flex gap-2 items-center flex-wrap">
                <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none px-2 py-1 rounded border bg-muted/30">
                  <input type="checkbox" checked={proposeMode} onChange={(e) => setProposeMode(e.target.checked)} />
                  Propose mode {proposeMode ? '(requires Apply)' : '(direct save)'}
                </label>
                {plan.overrides && (
                  <>
                    <Badge variant="warning" className="text-[10px]">
                      Pre-gen overrides: {plan.overrides.pre_gen_keys.length}
                    </Badge>
                    <Badge variant="info" className="text-[10px]">
                      Post-gen edits: {plan.overrides.post_gen_edits.length}
                    </Badge>
                  </>
                )}
              </div>
            </div>
            <ScrollArea className="h-[60vh]">
              <div className="space-y-1">
                {plan.sections.map((s) => {
                  const ov = sectionOverrideMap.get(s.id) ?? [];
                  const assigned = plan.section_template_map?.[s.id] ?? [];
                  const open = expandedSection === s.id;
                  return (
                    <div key={s.id} className="border rounded">
                      <button
                        type="button"
                        onClick={() => setExpandedSection(open ? null : s.id)}
                        className="w-full text-left p-2 hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-[11px] text-muted-foreground w-6 shrink-0">{s.ordinal}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium">{open ? '▾ ' : '▸ '}{s.name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground truncate">{s.id}</div>
                            {s.sourceHeadings && s.sourceHeadings.length > 0 && (
                              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                headings: {s.sourceHeadings.join(' · ')}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Badge variant={assigned.length > 0 ? 'success' : 'outline'} className="text-[10px]">
                              {assigned.length > 0 ? `${assigned.length} pinned` : `pool: ${plan.template_pool_size}`}
                            </Badge>
                            {ov.length > 0 && (
                              <Badge variant="warning" className="text-[10px]">★ {ov.length} override{ov.length > 1 ? 's' : ''}</Badge>
                            )}
                          </div>
                        </div>
                      </button>
                      {open && (
                        <div className="border-t bg-muted/20 p-3 space-y-3">
                          {s.purpose && <div className="text-[10px] text-muted-foreground italic">{s.purpose}</div>}
                          {s.pageBudget != null && (
                            <div className="text-[10px] text-muted-foreground">Page budget: {s.pageBudget}</div>
                          )}

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] uppercase font-semibold text-muted-foreground">Template Assignment</span>
                              {savingMap && <Loader2 className="h-3 w-3 animate-spin" />}
                            </div>
                            <p className="text-[10px] text-muted-foreground mb-2">
                              Tick a template to <span className="text-foreground">pin</span> it to this section. If none pinned, the engine retrieves from the full pool by similarity.
                            </p>
                            <div className="space-y-1 max-h-56 overflow-auto pr-1">
                              {plan.templates.map((t) => {
                                const checked = assigned.includes(t.id);
                                return (
                                  <label key={t.id} className="flex items-center gap-2 text-[11px] cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={savingMap}
                                      onChange={(e) => toggleSectionTemplate(s.id, t.id, e.target.checked)}
                                    />
                                    <span className="truncate flex-1">{t.name}</span>
                                    <Badge variant="outline" className="text-[9px]">{t.embedding_chunks}c</Badge>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {ov.length > 0 && (
                            <div>
                              <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Pre-gen override keys matched to this section</div>
                              <div className="flex flex-wrap gap-1">
                                {ov.map((k) => (
                                  <Badge key={k} variant="warning" className="text-[10px] font-mono">★ {k}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>

          {/* Editable manual_overrides packet */}
          {reportId.trim() && (
            <Card className="col-span-12 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold">Data Packet · manual_overrides</h3>
                  <p className="text-[10px] text-muted-foreground">Direct edit of <span className="font-mono">investment_reports.manual_overrides</span> for report <span className="font-mono">{reportId.trim()}</span>. Audited on save.</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setOverridesDraft(JSON.stringify(plan.overrides?.pre_gen_overrides ?? {}, null, 2))}>Reset</Button>
                  <Button size="sm" onClick={saveOverrides} disabled={savingOverrides}>
                    {savingOverrides ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Save overrides
                  </Button>
                </div>
              </div>
              <Textarea
                value={overridesDraft}
                onChange={(e) => setOverridesDraft(e.target.value)}
                className="font-mono text-[11px] h-72"
                spellCheck={false}
              />
              {plan.overrides && plan.overrides.post_gen_edits.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Recent post-gen audit entries</div>
                  <ScrollArea className="h-40 rounded border bg-muted/20 p-2">
                    <div className="space-y-1">
                      {plan.overrides.post_gen_edits.map((e, i) => (
                        <div key={i} className="border-b border-border/40 pb-1">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="text-[10px]">{e.target_kind}</Badge>
                            <span className="text-[10px] text-muted-foreground">{new Date(e.performed_at).toLocaleString('en-AU')}</span>
                          </div>
                          {e.rationale && <div className="text-[10px] text-muted-foreground mt-0.5">{e.rationale}</div>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback, useMemo } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, UploadCloud, FileText, Trash2, Copy, ExternalLink, Plus, Users, History, Eye, Check } from 'lucide-react';
import { toast } from 'sonner';

const UNASSIGNED = '__unassigned__';

interface LeadMagnet {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  ghl_pipeline_id: string | null;
  ghl_stage_id: string | null;
  ghl_tag: string | null;
  is_active: boolean;
  download_count: number;
  active_version_id: string | null;
  created_at: string;
}

interface MagnetVersion {
  id: string;
  magnet_id: string;
  version_number: number;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  notes: string | null;
  created_at: string;
}

interface PipelineRow { id: string; ghl_id: string; name: string; }
interface StageRow { id: string; ghl_id: string; pipeline_id: string; name: string; position: number | null; }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildEmbedSnippet(host: string, slug: string) {
  return `<script src="${host}/lm.js" data-slug="${slug}"></script>`;
}

export function LeadMagnetsPanel() {
  const [magnets, setMagnets] = useState<LeadMagnet[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState<LeadMagnet | null>(null);
  const [versionsOpen, setVersionsOpen] = useState<LeadMagnet | null>(null);
  const [previewOpen, setPreviewOpen] = useState<LeadMagnet | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: a }, { data: b }] = await Promise.all([
      invokeSecureFunction('manage-lead-magnets', { operation: 'list' }),
      invokeSecureFunction('manage-lead-magnets', { operation: 'list_pipelines' }),
    ]);
    setMagnets(a?.magnets || []);
    setPipelines(b?.pipelines || []);
    setStages(b?.stages || []);
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this lead magnet (and all its versions)? This is permanent.')) return;
    const { error } = await invokeSecureFunction('manage-lead-magnets', { operation: 'delete', id });
    if (error) toast.error(error.message); else { toast.success('Deleted'); reload(); }
  };

  const toggleActive = async (m: LeadMagnet) => {
    const { error } = await invokeSecureFunction('manage-lead-magnets', { operation: 'update', id: m.id, is_active: !m.is_active });
    if (error) toast.error(error.message); else reload();
  };

  const copyEmbed = (m: LeadMagnet) => {
    const snippet = buildEmbedSnippet(window.location.origin, m.slug);
    navigator.clipboard.writeText(snippet);
    toast.success('Embed snippet copied — paste it on any landing page');
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">Lead Magnets</h2>
          <p className="text-sm text-muted-foreground">Embed once per page — swap the PDF anytime without touching the embed.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0 rounded-xl shadow-sm focus-visible:ring-primary/45" aria-label="Create new lead magnet"><Plus className="h-4 w-4 mr-1.5" /> New Lead Magnet</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : magnets.length === 0 ? (
        <Card className="overflow-hidden border-dashed border-border/70 bg-card/95"><CardContent className="py-12 text-center text-sm text-muted-foreground">No lead magnets yet. Click "New Lead Magnet" to upload your first.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {magnets.map(m => {
            const pipeline = pipelines.find(p => p.ghl_id === m.ghl_pipeline_id);
            const stage = stages.find(s => s.ghl_id === m.ghl_stage_id);
            return (
              <Card key={m.id} className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-sm dark:shadow-black/5 transition-colors hover:border-primary/25 hover:bg-primary/[0.03] dark:border-white/10 dark:shadow-black/20">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="h-10 w-10 rounded-2xl border border-primary/20 bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="truncate font-medium" title={m.title}>{m.title}</h3>
                        <Badge variant={m.is_active ? 'default' : 'secondary'} className="rounded-full">{m.is_active ? 'Active' : 'Disabled'}</Badge>
                        <Badge variant="outline" className="rounded-full">{m.download_count} downloads</Badge>
                      </div>
                      {m.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{m.description}</p>}
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                        <span className="min-w-0 rounded-xl bg-muted/30 px-2.5 py-1.5">slug: <code className="break-all">{m.slug}</code></span>
                        <span className="min-w-0 truncate rounded-xl bg-muted/30 px-2.5 py-1.5" title={m.file_name}>file: {m.file_name}</span>
                        {pipeline && <span className="min-w-0 truncate rounded-xl bg-muted/30 px-2.5 py-1.5" title={`Pipeline: ${pipeline.name}${stage ? ` → ${stage.name}` : ''}`}>Pipeline: {pipeline.name}{stage ? ` → ${stage.name}` : ''}</span>}
                        {m.ghl_tag && <span className="min-w-0 truncate rounded-xl bg-muted/30 px-2.5 py-1.5" title={`Tag: ${m.ghl_tag}`}>Tag: {m.ghl_tag}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1 lg:justify-end">
                      <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} aria-label={`${m.is_active ? 'Disable' : 'Enable'} ${m.title}`} />
                      <Button size="sm" variant="ghost" title="Copy embed snippet" aria-label={`Copy embed snippet for ${m.title}`} onClick={() => copyEmbed(m)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Live preview" aria-label={`Open live preview for ${m.title}`} onClick={() => setPreviewOpen(m)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="PDF versions" aria-label={`Open PDF versions for ${m.title}`} onClick={() => setVersionsOpen(m)}>
                        <History className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Captures" aria-label={`Open captures for ${m.title}`} onClick={() => setDownloadsOpen(m)}>
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Open capture page" aria-label={`Open capture page for ${m.title}`} onClick={() => window.open(`${window.location.origin}/lead-magnet-embed.html?slug=${encodeURIComponent(m.slug)}`, '_blank')}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Delete" aria-label={`Delete ${m.title}`} onClick={() => handleDelete(m.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateLeadMagnetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); reload(); }}
        pipelines={pipelines}
        stages={stages}
      />

      <DownloadsDialog magnet={downloadsOpen} onClose={() => setDownloadsOpen(null)} />
      <VersionsDialog magnet={versionsOpen} onClose={() => setVersionsOpen(null)} onChanged={reload} />
      <PreviewDialog magnet={previewOpen} onClose={() => setPreviewOpen(null)} />
    </div>
  );
}

function CreateLeadMagnetDialog({ open, onClose, onCreated, pipelines, stages }: {
  open: boolean; onClose: () => void; onCreated: () => void;
  pipelines: PipelineRow[]; stages: StageRow[];
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [pipelineGhl, setPipelineGhl] = useState<string>(UNASSIGNED);
  const [stageGhl, setStageGhl] = useState<string>(UNASSIGNED);
  const [tag, setTag] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const filteredStages = useMemo(() => {
    if (pipelineGhl === UNASSIGNED) return [];
    const p = pipelines.find(p => p.ghl_id === pipelineGhl);
    if (!p) return [];
    return stages.filter(s => s.pipeline_id === p.id);
  }, [pipelineGhl, pipelines, stages]);

  const reset = () => { setTitle(''); setSlug(''); setDescription(''); setPipelineGhl(UNASSIGNED); setStageGhl(UNASSIGNED); setTag(''); setFile(null); };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast.error('File must be under 50MB'); return; }
    setFile(f);
  };

  const submit = async () => {
    if (!title || !file) { toast.error('Title and file required'); return; }
    setSubmitting(true);
    try {
      const file_data = await fileToBase64(file);
      const { data, error } = await invokeSecureFunction('manage-lead-magnets', {
        operation: 'create',
        title,
        slug: slug || slugify(title),
        description,
        file_data,
        file_name: file.name,
        mime_type: file.type || 'application/pdf',
        ghl_pipeline_id: pipelineGhl === UNASSIGNED ? null : pipelineGhl,
        ghl_stage_id: stageGhl === UNASSIGNED ? null : stageGhl,
        ghl_tag: tag || null,
        is_active: true,
      });
      if (error || data?.error) { toast.error(error?.message || data.error); return; }
      toast.success('Lead magnet created');
      reset();
      onCreated();
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>New Lead Magnet</DialogTitle></DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0] || null); }}
              className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border bg-background/45'}`}
            >
              <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFile(null)}>Remove</Button>
                </div>
              ) : (
                <>
                  <p className="text-sm">Drag & drop a PDF or asset here</p>
                  <p className="text-xs text-muted-foreground mb-2">or</p>
                  <Input type="file" accept="application/pdf,.pdf,.docx,.doc,.zip" onChange={(e) => handleFile(e.target.files?.[0] || null)} className="max-w-xs mx-auto" />
                </>
              )}
            </div>

            <div>
              <Label>Title *</Label>
              <Input value={title} onChange={(e) => { setTitle(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} placeholder="e.g. The First-Time Investor Playbook" />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="auto-generated from title" />
              <p className="text-xs text-muted-foreground mt-1">Slug is the permanent ID — it will not change when you replace the PDF later.</p>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Internal note (not shown on form)" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>GHL Pipeline</Label>
                <Select value={pipelineGhl} onValueChange={(v) => { setPipelineGhl(v); setStageGhl(UNASSIGNED); }}>
                  <SelectTrigger><SelectValue placeholder="Select pipeline" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>None</SelectItem>
                    {pipelines.map(p => <SelectItem key={p.id} value={p.ghl_id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pipeline Stage</Label>
                <Select value={stageGhl} onValueChange={setStageGhl} disabled={pipelineGhl === UNASSIGNED}>
                  <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>None</SelectItem>
                    {filteredStages.map(s => <SelectItem key={s.id} value={s.ghl_id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>GHL Contact Tag</Label>
              <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={`Lead Magnet: ${title || 'Title'}`} />
              <p className="text-xs text-muted-foreground mt-1">Defaults to "Lead Magnet: {'{title}'}" if blank.</p>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !title || !file}>
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({ magnet, onClose, onChanged }: { magnet: LeadMagnet | null; onClose: () => void; onChanged: () => void }) {
  const [versions, setVersions] = useState<MagnetVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!magnet) return;
    setLoading(true);
    const { data } = await invokeSecureFunction('manage-lead-magnets', { operation: 'list_versions', magnet_id: magnet.id });
    setVersions(data?.versions || []);
    setLoading(false);
  }, [magnet]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!magnet || !file) return;
    if (file.size > 50 * 1024 * 1024) { toast.error('File must be under 50MB'); return; }
    setUploading(true);
    try {
      const file_data = await fileToBase64(file);
      const { data, error } = await invokeSecureFunction('manage-lead-magnets', {
        operation: 'upload_version',
        magnet_id: magnet.id,
        file_data, file_name: file.name, mime_type: file.type || 'application/pdf',
        notes: notes || null, activate: true,
      });
      if (error || data?.error) { toast.error(error?.message || data.error); return; }
      toast.success(`Version ${data.version.version_number} uploaded and activated`);
      setFile(null); setNotes('');
      await load();
      onChanged();
    } finally { setUploading(false); }
  };

  const activate = async (v: MagnetVersion) => {
    if (!magnet) return;
    const { data, error } = await invokeSecureFunction('manage-lead-magnets', {
      operation: 'activate_version', magnet_id: magnet.id, version_id: v.id,
    });
    if (error || data?.error) { toast.error(error?.message || data.error); return; }
    toast.success(`Rolled back to v${v.version_number}`);
    await load();
    onChanged();
  };

  const remove = async (v: MagnetVersion) => {
    if (!confirm(`Delete version ${v.version_number}? This is permanent.`)) return;
    const { data, error } = await invokeSecureFunction('manage-lead-magnets', {
      operation: 'delete_version', version_id: v.id,
    });
    if (error || data?.error) { toast.error(error?.message || data.error); return; }
    toast.success('Version deleted');
    await load();
  };

  return (
    <Dialog open={!!magnet} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="truncate">PDF Versions — {magnet?.title}</DialogTitle></DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            <Card className="overflow-hidden border-border/70 bg-card/95">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <UploadCloud className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">Upload new version</span>
                </div>
                <Input type="file" accept="application/pdf,.pdf,.docx,.doc,.zip" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes (what changed in this version?)" />
                <div className="flex justify-end">
                  <Button onClick={upload} disabled={!file || uploading}>
                    {uploading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    Upload & make active
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Slug stays the same — embeds keep working. The new file is served immediately.</p>
              </CardContent>
            </Card>

            {loading ? (
              <div className="py-8 text-center"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {versions.map(v => {
                  const isActive = magnet?.active_version_id === v.id;
                  return (
                    <div key={v.id} className={`border rounded-2xl p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${isActive ? 'border-primary bg-primary/5' : 'border-border/70 bg-background/45'}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={isActive ? 'default' : 'outline'} className="rounded-full">v{v.version_number}{isActive && ' · ACTIVE'}</Badge>
                          <span className="text-sm font-medium truncate" title={v.file_name}>{v.file_name}</span>
                          <span className="text-xs text-muted-foreground">{v.file_size ? `${(v.file_size / 1024 / 1024).toFixed(2)} MB` : ''}</span>
                        </div>
                        {v.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.notes}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(v.created_at).toLocaleString('en-AU')}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 shrink-0">
                        {!isActive && (
                          <Button size="sm" variant="outline" onClick={() => activate(v)}>
                            <Check className="h-3.5 w-3.5 mr-1" /> Make active
                          </Button>
                        )}
                        {!isActive && (
                          <Button size="sm" variant="ghost" onClick={() => remove(v)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ magnet, onClose }: { magnet: LeadMagnet | null; onClose: () => void }) {
  return (
    <Dialog open={!!magnet} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate">Live Preview — {magnet?.title}</DialogTitle>
          <p className="text-xs text-muted-foreground">This is exactly what visitors see when they land on a page with your embed.</p>
        </DialogHeader>
        <div className="flex-1 overflow-hidden bg-muted/30 rounded-2xl border border-border/70">
          {magnet && (
            <iframe
              src={`${window.location.origin}/lead-magnet-embed.html?slug=${encodeURIComponent(magnet.slug)}`}
              className="w-full h-full border-0"
              title="Lead magnet preview"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DownloadsDialog({ magnet, onClose }: { magnet: LeadMagnet | null; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!magnet) return;
    setLoading(true);
    invokeSecureFunction('manage-lead-magnets', { operation: 'list_downloads', magnet_id: magnet.id })
      .then(({ data }) => setRows(data?.downloads || []))
      .finally(() => setLoading(false));
  }, [magnet]);

  const stats = useMemo(() => {
    const total = rows.length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const last7 = rows.filter(r => new Date(r.created_at).getTime() >= sevenDaysAgo).length;
    const synced = rows.filter(r => r.ghl_synced).length;
    const syncRate = total ? Math.round((synced / total) * 100) : 0;
    return { total, last7, syncRate };
  }, [rows]);

  return (
    <Dialog open={!!magnet} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="truncate">Captures — {magnet?.title}</DialogTitle></DialogHeader>

        <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-3">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Total captures</p><p className="text-2xl font-semibold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Last 7 days</p><p className="text-2xl font-semibold">{stats.last7}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">GHL sync rate</p><p className="text-2xl font-semibold">{stats.syncRate}%</p></CardContent></Card>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No downloads yet.</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map(r => (
                <div key={r.id} className="text-sm border border-border/70 bg-background/45 rounded-2xl p-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate" title={`${r.full_name} — ${r.email}`}>{r.full_name} <span className="text-muted-foreground font-normal">— {r.email}</span></p>
                    <p className="text-xs text-muted-foreground">{r.phone || 'no phone'} · {new Date(r.created_at).toLocaleString('en-AU')}</p>
                  </div>
                  <Badge variant={r.ghl_synced ? 'default' : 'secondary'} className="shrink-0 rounded-full">{r.ghl_synced ? 'GHL synced' : 'Pending'}</Badge>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

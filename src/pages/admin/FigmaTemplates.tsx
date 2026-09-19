/**
 * Admin Figma Templates manager.
 *
 * Lets superadmins:
 *  - Paste a Figma URL to register a new template (no IDs hardcoded)
 *  - Sync from Figma → compile to ReportTemplate JSON
 *  - Toggle active / default
 *  - Preview thumbnail
 *  - Open the compiled schema in the existing Template Builder for fine-tuning
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2, Plus, RefreshCw, Trash2, ExternalLink, AlertCircle, CheckCircle2,
  Eye, Layers, Frame as FigmaIcon, Star,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface FigmaTemplate {
  id: string;
  label: string;
  description: string | null;
  figma_file_key: string;
  figma_node_id: string | null;
  figma_url: string | null;
  report_type: string;
  tier: string | null;
  version: number;
  is_active: boolean;
  is_default: boolean;
  thumbnail_url: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  compile_warnings: any;
  created_at: string;
  updated_at: string;
}

const REPORT_TYPES = ['investment', 'cashflow', 'qa', 'borrowing_capacity', 'portfolio', 'comparison'];

export default function FigmaTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<FigmaTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Register form
  const [figmaUrl, setFigmaUrl] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [reportType, setReportType] = useState('investment');
  const [tier, setTier] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('figma-template-sync', { op: 'list' });
      if (error) throw new Error(error.message || 'Failed to load');
      setTemplates((data as any)?.templates ?? []);
    } catch (e: any) {
      toast({ title: 'Failed to load templates', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRegister() {
    if (!figmaUrl.trim()) {
      toast({ title: 'Figma URL required', variant: 'destructive' });
      return;
    }
    setRegistering(true);
    try {
      const { data, error } = await invokeSecureFunction('figma-template-sync', {
        op: 'register_from_url',
        figma_url: figmaUrl,
        label: label || undefined,
        description: description || undefined,
        report_type: reportType,
        tier: tier || undefined,
      });
      if (error) throw new Error(error.message);
      toast({ title: 'Template registered', description: 'Click Sync to pull from Figma.' });
      setShowRegister(false);
      setFigmaUrl(''); setLabel(''); setDescription(''); setTier('');
      await load();
      // Auto-sync immediately
      const id = (data as any)?.template?.id;
      if (id) await handleSync(id);
    } catch (e: any) {
      toast({ title: 'Registration failed', description: e?.message, variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const { data, error } = await invokeSecureFunction('figma-template-sync', { op: 'sync', id });
      if (error) throw new Error(error.message);
      const stats = (data as any)?.stats;
      toast({
        title: 'Synced from Figma',
        description: stats
          ? `${stats.pages} pages • ${stats.blocks} blocks • ${stats.overlays} overlays (${stats.bound} bound)`
          : 'Done',
      });
      await load();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e?.message, variant: 'destructive' });
      await load();
    } finally {
      setSyncingId(null);
    }
  }

  async function handleUpdate(id: string, patch: Partial<FigmaTemplate>) {
    try {
      const { error } = await invokeSecureFunction('figma-template-sync', { op: 'update', id, ...patch });
      if (error) throw new Error(error.message);
      await load();
    } catch (e: any) {
      toast({ title: 'Update failed', description: e?.message, variant: 'destructive' });
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      const { error } = await invokeSecureFunction('figma-template-sync', { op: 'delete', id });
      if (error) throw new Error(error.message);
      toast({ title: 'Deleted' });
      await load();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e?.message, variant: 'destructive' });
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, FigmaTemplate[]> = {};
    for (const t of templates) (g[t.report_type] ||= []).push(t);
    return g;
  }, [templates]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <FigmaIcon className="h-7 w-7 text-primary" />
            Figma Templates
          </h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Register Figma frames as report templates, sync the design into the ReportTemplate schema,
            and pick them dynamically when generating reports. No template IDs are hardcoded — every
            template is created here from a Figma URL.
          </p>
        </div>
        <Button onClick={() => setShowRegister(true)}>
          <Plus className="h-4 w-4 mr-1" /> Register Figma URL
        </Button>
      </div>

      {loading && templates.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading templates…
        </CardContent></Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FigmaIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <CardTitle className="text-lg">No Figma templates yet</CardTitle>
            <CardDescription className="mt-2 max-w-md mx-auto">
              Paste a Figma frame URL to register your first template. Use layer name prefixes
              like <code>bind:property.address</code>, <code>slot:footer</code>, or <code>token:primary</code> to
              control how the design maps to live report data.
            </CardDescription>
            <Button onClick={() => setShowRegister(true)} className="mt-6">
              <Plus className="h-4 w-4 mr-1" /> Register first template
            </Button>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([rt, list]) => (
          <div key={rt} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {rt.replace(/_/g, ' ')} ({list.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {list.map((t) => (
                <Card key={t.id} className="overflow-hidden hover:border-primary/40 transition-colors">
                  {t.thumbnail_url ? (
                    <div className="aspect-video bg-muted overflow-hidden">
                      <img src={t.thumbnail_url} alt={t.label} className="w-full h-full object-contain" loading="lazy" />
                    </div>
                  ) : (
                    <div className="aspect-video bg-muted flex items-center justify-center">
                      <FigmaIcon className="h-10 w-10 text-muted-foreground/40" />
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base truncate flex items-center gap-1.5">
                          {t.is_default && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                          {t.label}
                        </CardTitle>
                        {t.description && (
                          <CardDescription className="line-clamp-1 text-xs">{t.description}</CardDescription>
                        )}
                      </div>
                      <Badge variant={t.is_active ? 'default' : 'outline'} className="text-xs shrink-0">
                        {t.is_active ? 'Active' : 'Draft'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1 text-xs">
                      {t.tier && <Badge variant="secondary">{t.tier}</Badge>}
                      <Badge variant="outline">v{t.version}</Badge>
                      {t.last_sync_status === 'success' && (
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle2 className="h-3 w-3 text-success" /> Synced
                        </Badge>
                      )}
                      {t.last_sync_status === 'error' && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" /> Error
                        </Badge>
                      )}
                      {Array.isArray(t.compile_warnings) && t.compile_warnings.length > 0 && (
                        <Badge variant="outline" className="gap-1">
                          <AlertCircle className="h-3 w-3 text-warning" /> {t.compile_warnings.length} warn
                        </Badge>
                      )}
                    </div>
                    {t.last_sync_error && (
                      <p className="text-xs text-destructive line-clamp-2">{t.last_sync_error}</p>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t.last_synced_at ? `Synced ${new Date(t.last_synced_at).toLocaleString('en-AU')}` : 'Never synced'}</span>
                      {t.figma_url && (
                        <a href={t.figma_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                          Figma <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={t.is_active}
                          onCheckedChange={(v) => handleUpdate(t.id, { is_active: v })}
                        />
                        <Label className="text-xs">Active</Label>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={t.is_default}
                          onCheckedChange={(v) => handleUpdate(t.id, { is_default: v })}
                        />
                        <Label className="text-xs">Default</Label>
                      </div>
                    </div>

                    <div className="flex gap-1.5 pt-1">
                      <Button
                        size="sm" variant="default" className="flex-1"
                        onClick={() => handleSync(t.id)}
                        disabled={syncingId === t.id}
                      >
                        {syncingId === t.id
                          ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                        Sync
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDetailId(t.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDelete(t.id, t.label)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Register dialog */}
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Figma template</DialogTitle>
            <DialogDescription>
              Paste any Figma URL. Both the file key and the selected frame's node ID are parsed
              automatically — nothing is hardcoded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Figma URL *</Label>
              <Input
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/abc123…?node-id=12-34"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Label *</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Investment Report v2026" />
              </div>
              <div>
                <Label className="text-xs">Tier (optional)</Label>
                <Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="compass / lite / pro" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Report type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Internal note about what this template is for"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRegister(false)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={registering}>
              {registering && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Register & sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <FigmaTemplateDetail id={detailId} open={!!detailId} onClose={() => setDetailId(null)} onChanged={load} />
    </div>
  );
}

function FigmaTemplateDetail({
  id, open, onClose, onChanged,
}: { id: string | null; open: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !id) { setData(null); return; }
    (async () => {
      setLoading(true);
      try {
        const { data: d, error } = await invokeSecureFunction('figma-template-sync', { op: 'get', id });
        if (error) throw new Error(error.message);
        setData(d);
      } catch (e: any) {
        toast({ title: 'Failed to load detail', description: e?.message, variant: 'destructive' });
      } finally { setLoading(false); }
    })();
  }, [id, open, toast]);

  const tpl = data?.template;
  const logs = data?.logs ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {tpl?.label || 'Template detail'}
          </DialogTitle>
        </DialogHeader>
        {loading || !tpl ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="schema">Compiled schema</TabsTrigger>
              <TabsTrigger value="warnings">Warnings ({(tpl.compile_warnings || []).length})</TabsTrigger>
              <TabsTrigger value="logs">Sync log ({logs.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="flex-1 min-h-0">
              <ScrollArea className="h-full pr-3">
                <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                  <dt className="text-muted-foreground">File key</dt><dd className="font-mono text-xs">{tpl.figma_file_key}</dd>
                  <dt className="text-muted-foreground">Node ID</dt><dd className="font-mono text-xs">{tpl.figma_node_id || '—'}</dd>
                  <dt className="text-muted-foreground">Report type</dt><dd>{tpl.report_type}</dd>
                  <dt className="text-muted-foreground">Tier</dt><dd>{tpl.tier || '—'}</dd>
                  <dt className="text-muted-foreground">Version</dt><dd>v{tpl.version}</dd>
                  <dt className="text-muted-foreground">Active</dt><dd>{tpl.is_active ? 'Yes' : 'No'}</dd>
                  <dt className="text-muted-foreground">Default</dt><dd>{tpl.is_default ? 'Yes' : 'No'}</dd>
                  <dt className="text-muted-foreground">Last synced</dt><dd>{tpl.last_synced_at ? new Date(tpl.last_synced_at).toLocaleString('en-AU') : '—'}</dd>
                  <dt className="text-muted-foreground">Last status</dt><dd>{tpl.last_sync_status || '—'}</dd>
                  <dt className="text-muted-foreground">Pages</dt><dd>{tpl.compiled_schema?.pages?.length ?? 0}</dd>
                </dl>
                {tpl.figma_url && (
                  <Button variant="outline" size="sm" className="mt-4" asChild>
                    <a href={tpl.figma_url} target="_blank" rel="noreferrer">
                      Open in Figma <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="schema" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <pre className="text-[10px] font-mono bg-muted p-3 rounded">
                  {JSON.stringify(tpl.compiled_schema, null, 2)}
                </pre>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="warnings" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                {(tpl.compile_warnings || []).length === 0
                  ? <p className="text-sm text-muted-foreground">No warnings.</p>
                  : (
                    <ul className="space-y-1.5 text-xs">
                      {(tpl.compile_warnings || []).map((w: string, i: number) => (
                        <li key={i} className="flex gap-2"><AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />{w}</li>
                      ))}
                    </ul>
                  )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="logs" className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <ul className="space-y-2 text-xs">
                  {logs.map((l: any) => (
                    <li key={l.id} className="border border-border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={l.status === 'success' ? 'outline' : 'destructive'}>{l.status}</Badge>
                        <span className="font-medium">{l.operation}</span>
                        <span className="text-muted-foreground ml-auto">{new Date(l.created_at).toLocaleString('en-AU')}</span>
                      </div>
                      {l.summary && <p>{l.summary}</p>}
                      {l.error && <p className="text-destructive">{l.error}</p>}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

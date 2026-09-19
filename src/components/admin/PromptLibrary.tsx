/**
 * Prompt Library — superadmin editor for every report-generation system prompt.
 *
 * Surfaces the full PROMPT_CATALOG from the engine, side-by-side default vs
 * override, with per-prompt save / revert / copy / token preview, plus bulk
 * import/export of all overrides as JSON.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { invokeSecureFunction, hasActiveSession } from '@/lib/secureInvoke';
import { toast } from '@/hooks/use-toast';
import { Copy, Download, Upload, RotateCcw, Save, RefreshCw } from 'lucide-react';

interface PromptRow {
  key: string;
  label: string;
  family: string;
  function: string;
  description: string;
  tokens: string[];
  default: string;
  override: string | null;
  has_override: boolean;
  updated_at: string | null;
  override_description: string | null;
}

const FAMILY_LABELS: Record<string, string> = {
  investment_report: 'Investment Report',
  market_intelligence: 'Market Intelligence',
  portfolio_analysis: 'Portfolio Analysis',
  chart_analysis: 'Chart Analysis',
  condense: 'Condense (tiered)',
  regenerate: 'Regenerate',
  comparison: 'Property Comparison',
};

function approxTokens(s: string) {
  // Rough heuristic: ~4 chars per token
  return Math.max(1, Math.round(s.length / 4));
}

function diffLines(a: string, b: string) {
  // Cheap line-by-line diff for visual hint, not a true LCS.
  const al = a.split('\n');
  const bl = b.split('\n');
  const max = Math.max(al.length, bl.length);
  const out: Array<{ type: 'same' | 'a' | 'b'; text: string }> = [];
  for (let i = 0; i < max; i++) {
    if (al[i] === bl[i]) out.push({ type: 'same', text: al[i] ?? '' });
    else {
      if (al[i] != null) out.push({ type: 'a', text: al[i] });
      if (bl[i] != null) out.push({ type: 'b', text: bl[i] });
    }
  }
  return out;
}

export default function PromptLibrary() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [draftDesc, setDraftDesc] = useState<string>('');
  const [rationale, setRationale] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [showDiff, setShowDiff] = useState(false);

  const load = async () => {
    if (!hasActiveSession()) {
      setLoading(false);
      toast({
        title: 'Sign in required',
        description: 'Your session has expired. Please sign in again to load the prompt library.',
        variant: 'destructive',
      });
      return;
    }
    setLoading(true);
    const { data, error } = await invokeSecureFunction<{ prompts: PromptRow[] }>(
      'report-engine-inspector', { op: 'list_prompts' },
    );
    setLoading(false);
    if (error) {
      const msg = error.message || 'Unknown error';
      const friendly = /auth|session|401|403|forbidden/i.test(msg)
        ? 'Your session expired or you lack superadmin access. Sign in again and retry.'
        : msg;
      toast({ title: 'Failed to load prompts', description: friendly, variant: 'destructive' });
      return;
    }
    if (!Array.isArray(data?.prompts)) {
      toast({
        title: 'Failed to load prompts',
        description: 'Unexpected response from report-engine-inspector.',
        variant: 'destructive',
      });
      return;
    }
    setPrompts(data!.prompts);
    if (!selectedKey && data!.prompts.length) {
      selectPrompt(data!.prompts[0], data!.prompts);
    }
  };

  const selectPrompt = (p: PromptRow, all = prompts) => {
    setSelectedKey(p.key);
    setDraft(p.override ?? p.default);
    setDraftDesc(p.override_description ?? '');
    setRationale('');
    setShowDiff(false);
    // ensure list reference for the immediate render
    void all;
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const selected = useMemo(
    () => prompts.find((p) => p.key === selectedKey) ?? null,
    [prompts, selectedKey],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return prompts.filter((p) => {
      if (familyFilter !== 'all' && p.family !== familyFilter) return false;
      if (!q) return true;
      return (
        p.key.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        p.function.toLowerCase().includes(q) ||
        (p.override ?? '').toLowerCase().includes(q) ||
        p.default.toLowerCase().includes(q)
      );
    });
  }, [prompts, filter, familyFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, PromptRow[]>();
    for (const p of filtered) {
      if (!map.has(p.family)) map.set(p.family, []);
      map.get(p.family)!.push(p);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const isDirty = selected ? draft !== (selected.override ?? selected.default) : false;

  const save = async () => {
    if (!selected) return;
    if (!draft.trim()) { toast({ title: 'Prompt cannot be empty', variant: 'destructive' }); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction<{ ok: boolean }>(
      'report-engine-inspector',
      { op: 'upsert_prompt', key: selected.key, text: draft, description: draftDesc || null, rationale: rationale || null },
    );
    setSaving(false);
    if (error || !data?.ok) { toast({ title: 'Save failed', description: error?.message, variant: 'destructive' }); return; }
    toast({ title: `Saved override for ${selected.label}` });
    await load();
  };

  const revert = async () => {
    if (!selected || !selected.has_override) return;
    if (!confirm(`Revert "${selected.label}" to the built-in default? The override will be deleted.`)) return;
    const { error } = await invokeSecureFunction(
      'report-engine-inspector',
      { op: 'delete_prompt', key: selected.key, rationale: rationale || 'revert to default' },
    );
    if (error) { toast({ title: 'Revert failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Reverted to default' });
    setDraft(selected.default);
    setRationale('');
    await load();
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const exportAll = async () => {
    const { data, error } = await invokeSecureFunction<any>(
      'report-engine-inspector', { op: 'export_prompts' });
    if (error) { toast({ title: 'Export failed', description: error.message, variant: 'destructive' }); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-engine-prompts-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${Object.keys(data?.prompts ?? {}).length} overrides` });
  };

  const importAll = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e: any) => {
      const file: File | undefined = e.target?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const promptsObj = parsed.prompts ?? parsed;
        const { data, error } = await invokeSecureFunction<{ results: any[] }>(
          'report-engine-inspector', { op: 'import_prompts', prompts: promptsObj, rationale: `imported from ${file.name}` });
        if (error) throw new Error(error.message);
        const okCount = data?.results?.filter((r: any) => r.ok).length ?? 0;
        const failCount = (data?.results?.length ?? 0) - okCount;
        toast({ title: `Imported ${okCount}`, description: failCount ? `${failCount} failed (check console)` : 'all ok' });
        if (failCount) console.warn('import_prompts failures:', data?.results?.filter((r: any) => !r.ok));
        await load();
      } catch (err: any) {
        toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
      }
    };
    input.click();
  };

  const overrideCount = prompts.filter((p) => p.has_override).length;

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-4 p-3">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <div className="text-sm font-medium">Prompt Library</div>
            <div className="text-[11px] text-muted-foreground">{prompts.length} prompts · {overrideCount} overridden</div>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={load} disabled={loading} title="Reload">
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" variant="outline" onClick={exportAll} title="Export overrides">
              <Download className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" onClick={importAll} title="Import overrides">
              <Upload className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder="Search prompts…"
          containerClassName="mb-2"
          className="h-8 text-xs"
          iconClassName="h-3 w-3 left-2"
        />
        <div className="flex flex-wrap gap-1 mb-2">
          <button
            onClick={() => setFamilyFilter('all')}
            className={`text-[10px] px-2 py-0.5 rounded border ${familyFilter === 'all' ? 'bg-primary/10 border-primary/40' : 'border-border'}`}
          >all</button>
          {Object.entries(FAMILY_LABELS).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setFamilyFilter(k)}
              className={`text-[10px] px-2 py-0.5 rounded border ${familyFilter === k ? 'bg-primary/10 border-primary/40' : 'border-border'}`}
            >{lbl}</button>
          ))}
        </div>
        <ScrollArea className="h-[65vh]">
          {grouped.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground p-4">No prompts match.</div>
          )}
          {grouped.map(([family, rows]) => (
            <div key={family} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                {FAMILY_LABELS[family] ?? family}
              </div>
              <div className="space-y-1">
                {rows.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => selectPrompt(p)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs border transition-colors
                      ${selectedKey === p.key ? 'bg-primary/10 border-primary/40' : 'hover:bg-muted/50 border-transparent'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{p.label}</span>
                      {p.has_override && <Badge variant="default" className="h-4 px-1.5 text-[9px]">override</Badge>}
                    </div>
                    <div className="text-muted-foreground/80 text-[10px] mt-0.5 font-mono truncate">{p.key}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </ScrollArea>
      </Card>

      <Card className="col-span-8 p-4">
        {!selected && <div className="text-sm text-muted-foreground">Select a prompt on the left.</div>}
        {selected && (
          <div className="space-y-3">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{selected.label}</h2>
                  <div className="text-[11px] text-muted-foreground font-mono">{selected.key}</div>
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <Badge variant="outline">{FAMILY_LABELS[selected.family] ?? selected.family}</Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">{selected.function}</Badge>
                  {selected.has_override
                    ? <Badge variant="default">override active</Badge>
                    : <Badge variant="secondary">built-in default</Badge>}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{selected.description}</p>
              {selected.tokens.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-muted-foreground">Substituted at runtime:</span>
                  {selected.tokens.map((t) => (
                    <code key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{`{{${t}}}`}</code>
                  ))}
                </div>
              )}
              {selected.updated_at && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  Override last saved {new Date(selected.updated_at).toLocaleString('en-AU')}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">Built-in default <span className="text-muted-foreground">(read-only)</span></label>
                  <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => copyToClipboard(selected.default, 'Default')}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <ScrollArea className="h-[40vh] border rounded bg-muted/30">
                  <pre className="text-[11px] whitespace-pre-wrap font-mono p-2">{selected.default}</pre>
                </ScrollArea>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {selected.default.length} chars · ~{approxTokens(selected.default)} tokens
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">
                    Your override
                    {isDirty && <span className="ml-1 text-warning">●</span>}
                  </label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setDraft(selected.default)} title="Load default into editor">
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => copyToClipboard(draft, 'Override')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="font-mono text-[11px] h-[40vh]"
                  spellCheck={false}
                />
                <div className="text-[10px] text-muted-foreground mt-1">
                  {draft.length} chars · ~{approxTokens(draft)} tokens
                  {draft.length !== selected.default.length && (
                    <span className="ml-2">Δ {draft.length - selected.default.length >= 0 ? '+' : ''}{draft.length - selected.default.length}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <Button size="sm" variant="outline" onClick={() => setShowDiff((d) => !d)}>
                {showDiff ? 'Hide diff' : 'Show diff vs default'}
              </Button>
              {showDiff && (
                <span className="text-muted-foreground">Red = default-only, green = override-only</span>
              )}
            </div>

            {showDiff && (
              <ScrollArea className="h-[28vh] border rounded">
                <div className="text-[10px] font-mono p-2">
                  {diffLines(selected.default, draft).map((d, i) => (
                    <div
                      key={i}
                      className={
                        d.type === 'a' ? 'bg-destructive/15 text-destructive' :
                        d.type === 'b' ? 'bg-success/15 text-success' :
                        'text-muted-foreground'
                      }
                    >
                      <span className="opacity-50 pr-2">{d.type === 'a' ? '-' : d.type === 'b' ? '+' : ' '}</span>
                      {d.text || '\u00A0'}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium">Override description (optional)</label>
                <Input value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="e.g. tightened brand voice 2026-Q2" />
              </div>
              <div>
                <label className="text-xs font-medium">Rationale (audit log)</label>
                <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. removing hedging language per Nathan" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={!isDirty || saving}>
                <Save className="h-3 w-3 mr-1" />{saving ? 'Saving…' : selected.has_override ? 'Update override' : 'Save as override'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setDraft(selected.override ?? selected.default); setRationale(''); }} disabled={!isDirty}>
                Discard changes
              </Button>
              {selected.has_override && (
                <Button size="sm" variant="destructive" className="ml-auto" onClick={revert}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Revert to default
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Phase 15 — AI Authoring dialog.
 *
 * Three tabs:
 *   1. Generate Page — natural-language prompt creates a new page with blocks.
 *   2. Rewrite Copy — pick a text overlay on the current page and rewrite it.
 *   3. Suggest Name — names the template from its current content.
 *
 * The dialog is purely a UI shell around `aiAuthor` (Lovable AI Gateway).
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Check, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { aiAuthor, type GeneratedLayout } from '@/lib/reportTemplate/aiAuthorClient';
import { BLOCK_DEFS } from '@/lib/reportTemplate/blocks';
import type { Block, Page, ReportTemplate, Overlay } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  activePage: Page | null;
  tier?: string;
  /** Append a brand new page produced by AI to the template. */
  onAddPage: (page: Page, rationale?: string) => void;
  /** Replace text on a single overlay (id + page). */
  onUpdateOverlayText: (pageId: string, overlayId: string, nextText: string) => void;
  /** Optional: set the template name + description (Generate Name tab). */
  onApplyName?: (name: string, description: string) => void;
}

export function TemplateAIAuthorDialog({
  open,
  onOpenChange,
  template,
  activePage,
  tier,
  onAddPage,
  onUpdateOverlayText,
  onApplyName,
}: Props) {
  const allowedBlockTypes = useMemo(() => Object.keys(BLOCK_DEFS), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" /> AI Authoring
          </DialogTitle>
          <DialogDescription>
            Generate page layouts, rewrite copy, and name templates with Lovable AI.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="generate" className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="generate">Generate Page</TabsTrigger>
            <TabsTrigger value="cover">Cover Designer</TabsTrigger>
            <TabsTrigger value="rewrite">Rewrite Copy</TabsTrigger>
            <TabsTrigger value="name">Name & Describe</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="flex-1 min-h-0">
            <GeneratePanel
              tier={tier}
              allowedBlockTypes={allowedBlockTypes}
              pageSize={{ width: activePage?.size?.width ?? 595, height: activePage?.size?.height ?? 842 }}
              onApply={(layout) => {
                const page = layoutToPage(layout, { width: activePage?.size?.width ?? 595, height: activePage?.size?.height ?? 842 });
                onAddPage(page, layout.rationale);
                onOpenChange(false);
              }}
            />
          </TabsContent>

          <TabsContent value="cover" className="flex-1 min-h-0">
            <CoverPanel
              tier={tier}
              pageSize={{ width: activePage?.size?.width ?? 595, height: activePage?.size?.height ?? 842 }}
              onApply={(page, rationale) => {
                onAddPage(page, rationale);
                onOpenChange(false);
              }}
            />
          </TabsContent>

          <TabsContent value="rewrite" className="flex-1 min-h-0">
            <RewritePanel
              activePage={activePage}
              onApply={(overlayId, nextText) => {
                if (!activePage) return;
                onUpdateOverlayText(activePage.id, overlayId, nextText);
                toast.success('Copy updated');
              }}
            />
          </TabsContent>

          <TabsContent value="name" className="flex-1 min-h-0">
            <NamePanel
              template={template}
              onApply={(name, description) => {
                onApplyName?.(name, description);
                toast.success('Name applied');
                onOpenChange(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Generate Page tab
// ────────────────────────────────────────────────────────────────────────────
function GeneratePanel({
  tier,
  allowedBlockTypes,
  pageSize,
  onApply,
}: {
  tier?: string;
  allowedBlockTypes: string[];
  pageSize: { width: number; height: number };
  onApply: (layout: GeneratedLayout) => void;
}) {
  const [prompt, setPrompt] = useState(
    'A cover page for a property investment report — hero image, headline, subheadline, and a KPI strip with weekly rent, gross yield and capital growth.',
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedLayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setError(null); setResult(null);
    try {
      const out = await aiAuthor.generateLayout({
        prompt,
        tier,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        availableBlocks: allowedBlockTypes,
      });
      setResult(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col gap-3 pt-3">
      <Label>Describe the page you want</Label>
      <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
      <div className="flex justify-end">
        <Button onClick={generate} disabled={loading || !prompt.trim()}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Generate Layout
        </Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      {result && (
        <ScrollArea className="flex-1 border rounded-md p-3">
          <div className="space-y-2">
            <div className="font-semibold">{result.pageName}</div>
            {result.rationale && <div className="text-xs text-muted-foreground">{result.rationale}</div>}
            <div className="text-xs uppercase text-muted-foreground mt-2">Blocks ({result.blocks.length})</div>
            <ul className="text-sm space-y-1">
              {result.blocks.map((b, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Badge variant="outline">{b.type}</Badge>
                  <span className="text-muted-foreground">{b.name ?? ''}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end pt-3">
              <Button size="sm" onClick={() => onApply(result)}>
                <Check className="h-4 w-4 mr-1" /> Add as new page
              </Button>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rewrite Copy tab
// ────────────────────────────────────────────────────────────────────────────
function RewritePanel({
  activePage,
  onApply,
}: {
  activePage: Page | null;
  onApply: (overlayId: string, nextText: string) => void;
}) {
  const textOverlays = useMemo(() => {
    const out: Array<{ id: string; blockId: string; content: string }> = [];
    for (const b of activePage?.blocks ?? []) {
      for (const o of b.overlays ?? []) {
        if (o.type === 'text' && typeof (o as any).content === 'string') {
          out.push({ id: o.id, blockId: b.id, content: (o as any).content });
        }
      }
    }
    return out;
  }, [activePage]);

  const [selectedId, setSelectedId] = useState<string>('');
  const [mode, setMode] = useState<'improve'|'shorten'|'lengthen'|'simplify'|'punch'>('improve');
  const [tone, setTone] = useState('premium-editorial');
  const [loading, setLoading] = useState(false);
  const [rewritten, setRewritten] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const selected = textOverlays.find(o => o.id === selectedId);

  async function run() {
    if (!selected) return;
    setLoading(true); setError(null); setRewritten('');
    try {
      const out = await aiAuthor.rewriteCopy({ text: selected.content, mode, tone, preserveBindings: true });
      setRewritten(out.text);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!activePage) return <div className="text-sm text-muted-foreground pt-6">Select a page first.</div>;
  if (textOverlays.length === 0) return <div className="text-sm text-muted-foreground pt-6">No text overlays on this page.</div>;

  return (
    <div className="h-full flex flex-col gap-3 pt-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3">
          <Label>Text overlay</Label>
          <select
            className="w-full mt-1 border rounded-md bg-background h-9 px-2 text-sm"
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setRewritten(''); }}
          >
            <option value="">— choose —</option>
            {textOverlays.map(o => (
              <option key={o.id} value={o.id}>{o.content.slice(0, 80) || '(empty)'}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Mode</Label>
          <select className="w-full mt-1 border rounded-md bg-background h-9 px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="improve">Improve</option>
            <option value="shorten">Shorten</option>
            <option value="lengthen">Lengthen</option>
            <option value="simplify">Simplify</option>
            <option value="punch">Add punch</option>
          </select>
        </div>
        <div className="col-span-2">
          <Label>Tone</Label>
          <Input value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1" />
        </div>
      </div>
      {selected && (
        <>
          <Label className="text-xs uppercase text-muted-foreground">Original</Label>
          <div className="text-sm border rounded-md p-2 bg-muted/30 max-h-32 overflow-auto whitespace-pre-wrap">{selected.content}</div>
        </>
      )}
      <div className="flex justify-end">
        <Button onClick={run} disabled={!selected || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Rewrite
        </Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      {rewritten && (
        <>
          <Label className="text-xs uppercase text-muted-foreground">Rewritten</Label>
          <Textarea value={rewritten} onChange={(e) => setRewritten(e.target.value)} rows={6} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => selected && onApply(selected.id, rewritten)}>
              <Check className="h-4 w-4 mr-1" /> Apply to overlay
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Name & Describe tab
// ────────────────────────────────────────────────────────────────────────────
function NamePanel({
  template,
  onApply,
}: {
  template: ReportTemplate;
  onApply: (name: string, description: string) => void;
}) {
  const summary = useMemo(() => summariseTemplate(template), [template]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ name: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const out = await aiAuthor.nameSuggest({ summary });
      setResult(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col gap-3 pt-3">
      <Label>Template summary (auto-extracted)</Label>
      <ScrollArea className="border rounded-md p-2 max-h-40 text-xs whitespace-pre-wrap">{summary}</ScrollArea>
      <div className="flex justify-end">
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Suggest name
        </Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      {result && (
        <div className="space-y-2">
          <div><Label>Name</Label><Input value={result.name} onChange={(e) => setResult({ ...result, name: e.target.value })} /></div>
          <div><Label>Description</Label><Textarea value={result.description} onChange={(e) => setResult({ ...result, description: e.target.value })} rows={2} /></div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => onApply(result.name, result.description)}>
              <Check className="h-4 w-4 mr-1" /> Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function summariseTemplate(t: ReportTemplate): string {
  const lines: string[] = [`Pages: ${t.pages.length}`];
  for (const p of t.pages.slice(0, 12)) {
    const types = (p.blocks ?? []).map(b => b.type).join(', ');
    lines.push(`• ${p.name}: ${types || '(empty)'}`);
  }
  return lines.join('\n');
}

function layoutToPage(layout: GeneratedLayout, size?: { width: number; height: number }): Page {
  const pageSize = size ?? { width: 595, height: 842 };
  const blocks: Block[] = (layout.blocks ?? []).map((b) => ({
    id: crypto.randomUUID(),
    type: b.type,
    name: b.name,
    props: (b.props ?? {}) as Record<string, unknown>,
    overlays: [] as Overlay[],
  }));
  return {
    id: crypto.randomUUID(),
    name: layout.pageName || 'AI Page',
    size: pageSize,
    background: {},
    blocks,
  } as Page;
}

// ────────────────────────────────────────────────────────────────────────────
// Cover Designer tab
// ────────────────────────────────────────────────────────────────────────────
function CoverPanel({
  tier,
  pageSize,
  onApply,
}: {
  tier?: string;
  pageSize: { width: number; height: number };
  onApply: (page: Page, rationale?: string) => void;
}) {
  const [brief, setBrief] = useState(
    'A premium investment-grade cover for a NSW house & land report. Mood: confident, editorial, gold accents on near-black. Hero image of a modern Australian home at twilight.',
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const out = await aiAuthor.generateCover({ brief, tier, pageWidth: pageSize.width, pageHeight: pageSize.height });
      setResult(out);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function applyCover() {
    if (!result) return;
    const blocks: Block[] = (result.blocks ?? []).map((b: any) => ({
      id: crypto.randomUUID(),
      type: b.type,
      name: b.name,
      props: (b.props ?? {}) as Record<string, unknown>,
      overlays: (b.overlays ?? []).map((o: any) => ({
        id: crypto.randomUUID(),
        type: o.type,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        content: o.content,
        fontSize: o.fontSize,
        fontWeight: o.fontWeight,
        color: o.color,
        alt: o.alt,
      })) as Overlay[],
    }));
    const page: Page = {
      id: crypto.randomUUID(),
      name: result.pageName || 'AI Cover',
      size: pageSize,
      background: result.background ?? {},
      blocks,
    } as Page;
    onApply(page, result.rationale);
  }

  return (
    <div className="h-full flex flex-col gap-3 pt-3">
      <Label>Describe the cover you want</Label>
      <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} />
      <div className="flex justify-end">
        <Button onClick={run} disabled={loading || !brief.trim()}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Generate Cover
        </Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      {result && (
        <ScrollArea className="flex-1 border rounded-md p-3">
          <div className="space-y-2">
            <div className="font-semibold">{result.pageName}</div>
            {result.rationale && <div className="text-xs text-muted-foreground">{result.rationale}</div>}
            {result.heroImagePrompt && (
              <div className="text-xs"><span className="text-muted-foreground">Hero image prompt:</span> <em>{result.heroImagePrompt}</em></div>
            )}
            <div className="text-xs uppercase text-muted-foreground mt-2">Blocks ({result.blocks?.length ?? 0})</div>
            <ul className="text-sm space-y-1">
              {(result.blocks ?? []).map((b: any, i: number) => (
                <li key={i} className="flex items-center gap-2">
                  <Badge variant="outline">{b.type}</Badge>
                  <span className="text-muted-foreground">{b.name ?? ''} {b.overlays?.length ? `· ${b.overlays.length} overlays` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end pt-3">
              <Button size="sm" onClick={applyCover}>
                <Check className="h-4 w-4 mr-1" /> Add cover page
              </Button>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/**
 * BrandKitPanel — Phase 1 UI for the Template Builder's "Brand kit" tab.
 *
 * - Lists existing brand kits (org-scoped reusable bundles).
 * - Lets the user create / edit / attach a kit to the active template.
 * - Attaching merges the kit's palette + font-pairing into the template's
 *   tokens and writes `tokens.brandKitId` so the link is persisted.
 * - Theme switcher (light / dark / print / custom) lives in the same panel
 *   so the user can flip context with one click.
 */
import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Save, Trash2, Link as LinkIcon, Sun, Moon, Printer, Sparkles } from 'lucide-react';
import { useBrandKits, applyBrandKitToTokens, type BrandKit } from '@/hooks/useBrandKits';
import { contrastRatio, colorRamp, hexToCmyk } from '@/lib/reportTemplate/colorUtils';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  onChange: (next: ReportTemplate) => void;
}

const EMPTY: Partial<BrandKit> = {
  name: '',
  description: '',
  palette: { primary: '#BF9B50', accent: '#F0D78C', bg: '#0D0D0D', text: '#FFFFFF' },
  font_pairing: { heading: 'Helvetica', body: 'Helvetica' },
};

export function BrandKitPanel({ template, onChange }: Props) {
  const { kits, loading, upsert, remove } = useBrandKits();
  const [editing, setEditing] = useState<Partial<BrandKit> | null>(null);
  const activeId = template.tokens?.brandKitId;
  const activeKit = useMemo(() => kits.find((k) => k.id === activeId), [kits, activeId]);

  const attach = (kit: BrandKit) => {
    onChange({ ...template, tokens: applyBrandKitToTokens(template.tokens as any, kit) });
  };
  const detach = () => {
    const next = { ...(template.tokens as any) };
    delete next.brandKitId;
    onChange({ ...template, tokens: next });
  };
  const setTheme = (theme: 'light' | 'dark' | 'print' | 'custom') => {
    onChange({ ...template, tokens: { ...(template.tokens as any), activeTheme: theme } });
  };
  const activeTheme = (template.tokens as any)?.activeTheme ?? 'light';

  return (
    <div className="space-y-6">
      {/* Theme switcher */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-medium text-sm">Active theme</h3>
            <p className="text-xs text-muted-foreground">Light, dark, print-safe, or custom — drives token resolution at render time.</p>
          </div>
          <div className="flex gap-1">
            {([
              ['light', Sun, 'Light'],
              ['dark', Moon, 'Dark'],
              ['print', Printer, 'Print'],
              ['custom', Sparkles, 'Custom'],
            ] as const).map(([id, Icon, label]) => (
              <Button key={id} size="sm" variant={activeTheme === id ? 'default' : 'outline'} onClick={() => setTheme(id)}>
                <Icon className="h-3.5 w-3.5 mr-1" /> {label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Attached brand kit */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Attached brand kit</h3>
          {activeKit && (
            <Button variant="ghost" size="sm" onClick={detach}>Detach</Button>
          )}
        </div>
        {activeKit ? (
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{activeKit.name}</Badge>
            <div className="flex gap-1">
              {Object.values(activeKit.palette || {}).slice(0, 6).map((c, i) => (
                <span key={i} className="h-5 w-5 rounded border border-border" style={{ background: c }} />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No brand kit attached. Pick one below to inherit palette + font pairing.</p>
        )}
      </Card>

      {/* Kit library */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">Brand kit library</h3>
          <Button size="sm" onClick={() => setEditing(EMPTY)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New kit
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : kits.length === 0 ? (
          <p className="text-xs text-muted-foreground">No brand kits yet. Create one to reuse palette/typography across templates.</p>
        ) : (
          <div className="grid gap-2">
            {kits.map((k) => (
              <div key={k.id} className="flex items-center gap-3 border rounded-md p-2">
                <div className="flex gap-1">
                  {Object.values(k.palette || {}).slice(0, 5).map((c, i) => (
                    <span key={i} className="h-6 w-6 rounded border border-border" style={{ background: c }} />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{k.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{k.description || '—'}</div>
                </div>
                <Button size="sm" variant={activeId === k.id ? 'default' : 'outline'} onClick={() => attach(k)}>
                  <LinkIcon className="h-3.5 w-3.5 mr-1" /> {activeId === k.id ? 'Attached' : 'Attach'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(k)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Editor */}
      {editing && (
        <KitEditor
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={async (kit) => {
            await upsert(kit);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function KitEditor({
  value,
  onSave,
  onCancel,
}: {
  value: Partial<BrandKit>;
  onSave: (kit: Partial<BrandKit> & { name: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Partial<BrandKit>>(value);
  const setPalette = (k: string, v: string) => setDraft({ ...draft, palette: { ...(draft.palette || {}), [k]: v } });
  const palette = draft.palette || {};
  const primary = palette.primary || '#000000';
  const bg = palette.bg || '#FFFFFF';
  const contrast = contrastRatio(palette.text || '#000', bg);
  const ramp = colorRamp(primary);
  const cmyk = hexToCmyk(primary);

  return (
    <Card className="p-4 space-y-4 border-primary">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{draft.id ? 'Edit' : 'New'} brand kit</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={!draft.name} onClick={() => onSave(draft as any)}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Default?</Label>
          <Select value={draft.is_default ? 'yes' : 'no'} onValueChange={(v) => setDraft({ ...draft, is_default: v === 'yes' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no">No</SelectItem>
              <SelectItem value="yes">Yes — apply to new templates by default</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Description</Label>
        <Textarea rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </div>

      <div>
        <Label className="text-xs">Palette</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
          {['primary','accent','bg','surface','text','muted','success','danger'].map((k) => (
            <div key={k} className="flex items-center gap-2">
              <input type="color" value={palette[k] || '#000000'} onChange={(e) => setPalette(k, e.target.value)} className="h-8 w-8 rounded border border-border bg-transparent" />
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <Input className="h-7 text-xs" value={palette[k] ?? ''} onChange={(e) => setPalette(k, e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Heading font</Label>
          <Input value={draft.font_pairing?.heading ?? ''} onChange={(e) => setDraft({ ...draft, font_pairing: { ...(draft.font_pairing || {}), heading: e.target.value } })} />
        </div>
        <div>
          <Label className="text-xs">Body font</Label>
          <Input value={draft.font_pairing?.body ?? ''} onChange={(e) => setDraft({ ...draft, font_pairing: { ...(draft.font_pairing || {}), body: e.target.value } })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Default footer</Label>
          <Textarea rows={2} value={draft.default_footer ?? ''} onChange={(e) => setDraft({ ...draft, default_footer: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Default disclaimer</Label>
          <Textarea rows={2} value={draft.default_disclaimer ?? ''} onChange={(e) => setDraft({ ...draft, default_disclaimer: e.target.value })} />
        </div>
      </div>

      {/* QA — contrast + ramp + CMYK */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Text on background contrast</span>
          {contrast ? (
            <span className="font-mono">
              {contrast.ratio.toFixed(2)}× — <Badge variant={contrast.grade === 'fail' ? 'destructive' : 'secondary'}>{contrast.grade.toUpperCase()}</Badge>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Primary ramp</div>
          <div className="flex">
            {Object.entries(ramp).map(([k, v]) => (
              <div key={k} className="flex-1 h-6" style={{ background: v }} title={`${k} — ${v}`} />
            ))}
          </div>
        </div>
        {cmyk && (
          <div className="text-xs text-muted-foreground font-mono">
            Primary CMYK: C{cmyk.c} M{cmyk.m} Y{cmyk.y} K{cmyk.k}
          </div>
        )}
      </div>
    </Card>
  );
}

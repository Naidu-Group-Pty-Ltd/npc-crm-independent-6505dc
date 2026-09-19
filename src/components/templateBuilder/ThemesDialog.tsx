/**
 * ThemesDialog — Phase 10.
 * Manage named themes (partial token overlays). The active theme is merged
 * atop the template's base tokens; per-page themeId overrides apply on top.
 */
import { useState } from 'react';
import { Palette, Plus, Trash2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { THEME_PRESETS } from '@/lib/reportTemplate/themePresets';

interface Props {
  template: ReportTemplate;
  onChange: (next: ReportTemplate) => void;
}

type Theme = NonNullable<ReportTemplate['themes']>[string];

const TOKEN_GROUPS: Array<{ key: 'colors'|'fonts'|'spacing'; label: string; sample: Record<string, string|number> }> = [
  { key: 'colors',  label: 'Colors',  sample: { primary: '#bf9b50', bg: '#0d0d0d', text: '#ffffff', muted: '#999999', accent: '#f0d78c' } },
  { key: 'fonts',   label: 'Fonts',   sample: { heading: 'Helvetica', body: 'Helvetica' } },
  { key: 'spacing', label: 'Spacing', sample: { gutter: 16, sectionGap: 24, padding: 24 } },
];

export function ThemesDialog({ template, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const themes = template.themes ?? {};
  const ids = Object.keys(themes);
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const t = activeId ? themes[activeId] : null;

  const updateTheme = (id: string, patch: Partial<Theme>) => {
    const cur = themes[id]; if (!cur) return;
    onChange({ ...template, themes: { ...themes, [id]: { ...cur, ...patch } } });
  };
  const setTokenValue = (id: string, group: 'colors'|'fonts'|'spacing', key: string, value: string) => {
    const cur = themes[id]; if (!cur) return;
    const grp = { ...(cur.tokens as any)[group] ?? {} };
    if (!value) delete grp[key];
    else grp[key] = group === 'spacing' ? Number(value) || 0 : value;
    updateTheme(id, { tokens: { ...cur.tokens, [group]: grp } as any });
  };

  const addBlank = () => {
    const id = crypto.randomUUID();
    const theme: Theme = {
      id, name: `Theme ${ids.length + 1}`, kind: 'custom',
      tokens: { colors: {}, fonts: {}, spacing: {} },
    };
    onChange({
      ...template,
      themes: { ...themes, [id]: theme },
      activeThemeId: template.activeThemeId ?? id,
    });
    setActiveId(id);
  };

  const addFromPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const id = crypto.randomUUID();
    const theme: Theme = {
      id, name: preset.label, kind: 'brand',
      description: preset.description, swatch: preset.swatch,
      tokens: { ...preset.tokens },
    } as Theme;
    onChange({
      ...template,
      themes: { ...themes, [id]: theme },
      activeThemeId: template.activeThemeId ?? id,
    });
    setActiveId(id);
  };

  const deleteTheme = (id: string) => {
    const next = { ...themes }; delete next[id];
    const nextActive = template.activeThemeId === id ? undefined : template.activeThemeId;
    // strip page references to this id
    const pages = template.pages.map((p) =>
      (p as any).themeId === id ? { ...p, themeId: undefined } : p,
    );
    onChange({ ...template, themes: next, activeThemeId: nextActive, pages });
    setActiveId(Object.keys(next)[0] ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Palette className="h-3.5 w-3.5" /> Themes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Themes & multi-brand</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[240px_1fr] gap-4 h-[68vh]">
          {/* Sidebar */}
          <div className="border-r pr-3 flex flex-col">
            <div className="flex gap-1 mb-2">
              <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={addBlank}>
                <Plus className="h-3.5 w-3.5" /> Blank
              </Button>
              <Select onValueChange={addFromPreset}>
                <SelectTrigger className="h-8 text-xs w-[110px]">
                  <SelectValue placeholder="From preset" />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-1">
                {ids.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">
                    No themes yet. Add one or import from a preset to enable multi-brand rendering.
                  </p>
                )}
                {ids.map((id) => {
                  const theme = themes[id];
                  const swatch = theme.swatch ?? Object.values(theme.tokens.colors ?? {}).slice(0, 4);
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveId(id)}
                      className={`w-full text-left rounded px-2 py-1.5 text-xs flex items-center gap-2 ${activeId === id ? 'bg-primary/10 text-primary border border-primary/30' : 'hover:bg-muted'}`}
                    >
                      <span className="flex">
                        {swatch.slice(0, 4).map((c, i) => (
                          <span key={i} className="h-3 w-3 rounded-sm border border-border" style={{ background: String(c) }} />
                        ))}
                      </span>
                      <span className="flex-1 truncate">{theme.name}</span>
                      {template.activeThemeId === id && (
                        <span className="text-[10px] text-muted-foreground">active</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="pt-2 border-t mt-2">
              <Label className="text-[10px] uppercase text-muted-foreground">Active theme</Label>
              <Select
                value={template.activeThemeId ?? '__none__'}
                onValueChange={(v) => onChange({ ...template, activeThemeId: v === '__none__' ? undefined : v })}
              >
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (base tokens only)</SelectItem>
                  {ids.map((id) => <SelectItem key={id} value={id}>{themes[id].name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Editor */}
          <ScrollArea>
            {!t && (
              <p className="text-sm text-muted-foreground p-4">
                Select or create a theme to edit its tokens. Themes only need to declare what they override.
              </p>
            )}
            {t && (
              <div className="space-y-4 pr-3">
                <div className="grid grid-cols-[1fr_140px_36px] gap-2 items-end">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input value={t.name} onChange={(e) => updateTheme(t.id, { name: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Kind</Label>
                    <Select value={t.kind ?? 'custom'} onValueChange={(v) => updateTheme(t.id, { kind: v as any })}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['light','dark','print','brand','custom'].map((k) => (
                          <SelectItem key={k} value={k}>{k}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteTheme(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Live preview */}
                <div className="rounded-md border p-3 text-xs" style={{
                  background: (t.tokens.colors as any)?.bg ?? '#0d0d0d',
                  color: (t.tokens.colors as any)?.text ?? '#ffffff',
                  fontFamily: (t.tokens.fonts as any)?.body ?? 'Helvetica',
                }}>
                  <div style={{
                    fontFamily: (t.tokens.fonts as any)?.heading ?? 'Helvetica',
                    color: (t.tokens.colors as any)?.primary ?? '#bf9b50',
                    fontSize: 18, fontWeight: 600,
                  }}>{t.name}</div>
                  <div style={{ opacity: 0.7 }}>The quick brown fox jumps over the lazy dog.</div>
                  <div className="flex gap-1.5 mt-2">
                    {['primary','accent','success','danger','muted'].map((k) => {
                      const v = (t.tokens.colors as any)?.[k];
                      if (!v) return null;
                      return (
                        <span key={k} className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ background: v, color: '#fff', mixBlendMode: 'normal' }}>
                          {k}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Token editors */}
                {TOKEN_GROUPS.map((g) => {
                  const current = (t.tokens as any)[g.key] ?? {};
                  const keys = Array.from(new Set([...Object.keys(g.sample), ...Object.keys(current)]));
                  return (
                    <div key={g.key}>
                      <Label className="text-xs uppercase text-muted-foreground">{g.label}</Label>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        {keys.map((k) => (
                          <div key={k} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-20 truncate">{k}</span>
                            <Input
                              value={current[k] ?? ''}
                              onChange={(e) => setTokenValue(t.id, g.key, k, e.target.value)}
                              placeholder={String((g.sample as any)[k] ?? '')}
                              className="h-7 text-[11px] font-mono"
                            />
                            {g.key === 'colors' && current[k] && (
                              <span className="h-5 w-5 rounded border border-border" style={{ background: String(current[k]) }} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Per-page theme assignment */}
        <div className="border-t pt-3">
          <Label className="text-xs uppercase text-muted-foreground">Assign theme to pages</Label>
          <ScrollArea className="max-h-32 mt-2">
            <div className="space-y-1 pr-3">
              {template.pages.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <Select
                    value={(p as any).themeId ?? '__inherit__'}
                    onValueChange={(v) => {
                      const next = template.pages.map((pp) =>
                        pp.id === p.id ? { ...pp, themeId: v === '__inherit__' ? undefined : v } : pp,
                      );
                      onChange({ ...template, pages: next });
                    }}
                  >
                    <SelectTrigger className="h-7 w-48 text-xs"><SelectValue placeholder="Inherit active" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__inherit__">Inherit (active theme)</SelectItem>
                      {ids.map((id) => <SelectItem key={id} value={id}>{themes[id].name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

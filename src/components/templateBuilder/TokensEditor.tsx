/**
 * TokensEditor — edit the template's brand token map (colors / fonts /
 * spacing) with import/export, clipboard sharing, and brand sync.
 *
 * Extracted from TemplateBuilderEdit (rehaul Phase 2 / file split).
 */
import { useRef } from 'react';
import { Copy as CopyIcon, Download, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnhancedColorPicker } from '@/components/templateBuilder/EnhancedColorPicker';
import { useBrand } from '@/branding/BrandProvider';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

export function TokensEditor({
  template,
  onChange,
}: {
  template: ReportTemplate;
  onChange: (tokens: ReportTemplate['tokens']) => void;
}) {
  const tokens = template.tokens;
  const updateGroup = (
    group: 'colors' | 'fonts' | 'spacing',
    key: string,
    value: string | number,
  ) => {
    const next = { ...tokens, [group]: { ...tokens[group], [key]: value } };
    onChange(next);
  };
  const removeKey = (group: 'colors' | 'fonts' | 'spacing', key: string) => {
    const copy = { ...tokens[group] } as Record<string, any>;
    delete copy[key];
    onChange({ ...tokens, [group]: copy });
  };
  const addKey = (group: 'colors' | 'fonts' | 'spacing') => {
    const key = window.prompt(`New ${group} token key (e.g. "primary")`)?.trim();
    if (!key) return;
    const def = group === 'colors' ? '#000000' : group === 'fonts' ? 'Helvetica' : 0;
    updateGroup(group, key, def as any);
  };

  // ── Import / export tokens (share brand themes between templates) ──────────
  const fileRef = useRef<HTMLInputElement | null>(null);
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(tokens, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brand-tokens.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Tokens exported');
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tokens, null, 2));
      toast.success('Tokens copied to clipboard');
    } catch { toast.error('Copy failed'); }
  };
  const applyImport = (raw: unknown, mode: 'merge' | 'replace') => {
    if (!raw || typeof raw !== 'object') {
      toast.error('Invalid token JSON: expected an object');
      return;
    }
    const incoming = raw as Partial<ReportTemplate['tokens']>;
    const sanitised = {
      colors: incoming.colors && typeof incoming.colors === 'object' ? incoming.colors : {},
      fonts: incoming.fonts && typeof incoming.fonts === 'object' ? incoming.fonts : {},
      spacing: incoming.spacing && typeof incoming.spacing === 'object' ? incoming.spacing : {},
    };
    if (mode === 'replace') {
      onChange(sanitised as ReportTemplate['tokens']);
    } else {
      onChange({
        colors: { ...tokens.colors, ...sanitised.colors },
        fonts: { ...tokens.fonts, ...sanitised.fonts },
        spacing: { ...tokens.spacing, ...sanitised.spacing },
      });
    }
    const total =
      Object.keys(sanitised.colors).length +
      Object.keys(sanitised.fonts).length +
      Object.keys(sanitised.spacing).length;
    toast.success(`Imported ${total} token${total === 1 ? '' : 's'} (${mode})`);
  };
  const handleImportFile = (file: File) => {
    const mode: 'merge' | 'replace' = window.confirm(
      'Replace all existing tokens with the imported file?\n\nOK = Replace, Cancel = Merge (keep existing keys, overwrite matches).',
    ) ? 'replace' : 'merge';
    const reader = new FileReader();
    reader.onload = () => {
      try { applyImport(JSON.parse(String(reader.result)), mode); }
      catch (e: any) { toast.error(`Import failed: ${e?.message ?? 'invalid JSON'}`); }
    };
    reader.readAsText(file);
  };
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      applyImport(JSON.parse(text), 'merge');
    } catch (e: any) { toast.error(`Paste failed: ${e?.message ?? 'invalid JSON'}`); }
  };

  // ── Sync from current brand (BrandProvider / whitelabel_settings) ──────────
  const brand = useBrand();
  const handleSyncBrand = () => {
    const themeCfg = brand?.settings?.themeConfig;
    const primary = themeCfg?.primaryColor || brand?.settings?.primaryColor;
    const accent = themeCfg?.accentColor || brand?.settings?.accentColor;
    const incoming: Record<string, string> = {};
    if (primary) incoming.primary = primary;
    if (accent) incoming.accent = accent;
    if (Object.keys(incoming).length === 0) {
      toast.info('No brand colours configured to sync');
      return;
    }
    onChange({ ...tokens, colors: { ...tokens.colors, ...incoming } });
    toast.success(`Synced ${Object.keys(incoming).length} brand colour${Object.keys(incoming).length === 1 ? '' : 's'}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b">
        <Label className="text-xs text-muted-foreground mr-auto">
          Share brand themes between templates by exporting / importing this token set.
        </Label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="default" onClick={handleSyncBrand} title="Pull primary/accent from brand settings">
          <Sparkles className="h-3.5 w-3.5 mr-1" /> Sync from brand
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Import
        </Button>
        <Button size="sm" variant="outline" onClick={handlePaste} title="Import tokens from clipboard">
          Paste
        </Button>
        <Button size="sm" variant="outline" onClick={handleCopy}>
          <CopyIcon className="h-3.5 w-3.5 mr-1" /> Copy
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export
        </Button>
      </div>
      {(['colors', 'fonts', 'spacing'] as const).map((group) => {
        const entries = Object.entries(tokens[group] || {});
        return (
          <section key={group}>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">{group}</Label>
              <Button size="sm" variant="ghost" onClick={() => addKey(group)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No {group} tokens.</p>
            ) : (
              <div className="space-y-1.5">
                {entries.map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <Input value={k} disabled className="w-32 h-8 text-xs font-mono" />
                    {group === 'colors' ? (
                      <div className="flex-1">
                        <EnhancedColorPicker
                          value={String(v)}
                          onChange={(next) => updateGroup(group, k, next)}
                          template={template}
                          allowEmpty
                        />
                      </div>
                    ) : group === 'spacing' ? (
                      <Input
                        type="number"
                        value={Number(v)}
                        onChange={(e) => updateGroup(group, k, Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                    ) : (
                      <Input
                        value={String(v)}
                        onChange={(e) => updateGroup(group, k, e.target.value)}
                        className="h-8 text-xs"
                      />
                    )}
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeKey(group, k)} title="Remove">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Reference tokens in any block field via <code>token:primary</code>, <code>token:heading</code>, etc. Color values accept <code>#RRGGBB</code>, <code>#RRGGBBAA</code>, <code>rgb()</code>, <code>rgba()</code>, <code>hsl()</code>, and <code>token:name</code>.
      </p>
    </div>
  );
}

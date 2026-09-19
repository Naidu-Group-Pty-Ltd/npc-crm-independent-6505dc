/**
 * TypographyPanel — Phase 5 advanced typography controls for text overlays.
 * Renders a comprehensive set of OpenType, paragraph, multi-column, decoration,
 * baseline-grid and rich-text editing controls used by the Properties Inspector.
 */
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Type } from 'lucide-react';
import { toast } from 'sonner';
import type { Overlay, ReportTemplate, FontFace } from '@/lib/reportTemplate/templateSchema';

const GOOGLE_FONT_PRESETS = [
  { family: 'Inter', cssUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap' },
  { family: 'Manrope', cssUrl: 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap' },
  { family: 'DM Sans', cssUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&display=swap' },
  { family: 'Space Grotesk', cssUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' },
  { family: 'Archivo', cssUrl: 'https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700;800&display=swap' },
  { family: 'Playfair Display', cssUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap' },
  { family: 'Fraunces', cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&display=swap' },
  { family: 'Cormorant Garamond', cssUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&display=swap' },
  { family: 'Libre Caslon Text', cssUrl: 'https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap' },
  { family: 'Crimson Pro', cssUrl: 'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300..900;1,300..900&display=swap' },
  { family: 'JetBrains Mono', cssUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap' },
  { family: 'IBM Plex Mono', cssUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&display=swap' },
];

const BUILT_IN_FAMILIES = ['Helvetica', 'Times', 'Courier', 'Georgia', 'Arial'];

interface FontLibraryPopoverProps {
  template: ReportTemplate;
  onTemplateChange: (t: ReportTemplate) => void;
  onPick: (family: string) => void;
}

export function FontLibraryPopover({ template, onTemplateChange, onPick }: FontLibraryPopoverProps) {
  const faces: FontFace[] = (template.tokens as any).fontFaces ?? [];

  const addFace = (face: FontFace) => {
    if (faces.some((f) => f.family === face.family)) {
      onPick(face.family);
      return;
    }
    onTemplateChange({
      ...template,
      tokens: { ...template.tokens, fontFaces: [...faces, face] } as any,
    });
    onPick(face.family);
    toast.success(`${face.family} added to template`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Font library">
          <Type className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        <div className="text-[10px] text-muted-foreground uppercase font-medium px-1">In template</div>
        <div className="space-y-1 max-h-32 overflow-auto">
          {[...BUILT_IN_FAMILIES, ...faces.map(f => f.family)].map((fam) => (
            <button
              key={fam}
              type="button"
              onClick={() => onPick(fam)}
              className="w-full text-left px-2 py-1 rounded text-sm hover:bg-accent"
              style={{ fontFamily: fam }}
            >
              {fam}
            </button>
          ))}
        </div>
        <Separator />
        <div className="text-[10px] text-muted-foreground uppercase font-medium px-1">Add Google font</div>
        <div className="space-y-1 max-h-56 overflow-auto">
          {GOOGLE_FONT_PRESETS.map((p) => (
            <button
              key={p.family}
              type="button"
              onClick={() => addFace(p)}
              className="w-full flex items-center justify-between px-2 py-1 rounded text-sm hover:bg-accent group"
              style={{ fontFamily: p.family }}
            >
              <span>{p.family}</span>
              <Plus className="h-3 w-3 opacity-40 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface TypographyPanelProps {
  overlay: Overlay & { type: 'text' };
  template: ReportTemplate;
  onChange: (patch: Partial<Overlay>) => void;
  onTemplateChange?: (t: ReportTemplate) => void;
}

export function TypographyPanel({ overlay, template, onChange, onTemplateChange }: TypographyPanelProps) {
  const o = overlay as any;
  const setNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value === '' ? undefined : Number(e.target.value);
    onChange({ [k]: v } as any);
  };
  return (
    <div className="space-y-3 pt-2">
      <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">Typography</div>

      {/* Decoration / transform */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Decoration</Label>
          <Select value={o.textDecoration ?? 'none'} onValueChange={(v) => onChange({ textDecoration: v === 'none' ? undefined : v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="underline">Underline</SelectItem>
              <SelectItem value="line-through">Strikethrough</SelectItem>
              <SelectItem value="overline">Overline</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Transform</Label>
          <Select value={o.textTransform ?? 'none'} onValueChange={(v) => onChange({ textTransform: v === 'none' ? undefined : v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="uppercase">UPPERCASE</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="capitalize">Capitalize</SelectItem>
              <SelectItem value="small-caps">Small caps</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Vertical align / wrap */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">V-align</Label>
          <Select value={o.verticalAlign ?? 'top'} onValueChange={(v) => onChange({ verticalAlign: v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top</SelectItem>
              <SelectItem value="middle">Middle</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">White-space</Label>
          <Select value={o.whiteSpace ?? 'normal'} onValueChange={(v) => onChange({ whiteSpace: v === 'normal' ? undefined : v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="nowrap">No wrap</SelectItem>
              <SelectItem value="pre">Preserve</SelectItem>
              <SelectItem value="pre-wrap">Pre-wrap</SelectItem>
              <SelectItem value="pre-line">Pre-line</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Padding quad */}
      <div>
        <Label className="text-xs">Padding (T/R/B/L pt)</Label>
        <div className="grid grid-cols-4 gap-1">
          {(['paddingTop','paddingRight','paddingBottom','paddingLeft'] as const).map((k) => (
            <Input key={k} type="number" min={0} max={96} className="h-8 text-xs" value={o[k] ?? ''} onChange={setNum(k)} placeholder="0" />
          ))}
        </div>
      </div>

      <Separator />

      {/* Paragraph */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">First-line indent (pt)</Label>
          <Input type="number" min={0} max={96} className="h-8 text-xs" value={o.paragraphIndent ?? ''} onChange={setNum('paragraphIndent')} placeholder="0" />
        </div>
        <div>
          <Label className="text-xs">¶ spacing (pt)</Label>
          <Input type="number" min={0} max={96} className="h-8 text-xs" value={o.paragraphSpacing ?? ''} onChange={setNum('paragraphSpacing')} placeholder="0" />
        </div>
        <div>
          <Label className="text-xs">Columns</Label>
          <Input type="number" min={1} max={6} className="h-8 text-xs" value={o.columns ?? ''} onChange={setNum('columns')} placeholder="1" />
        </div>
        <div>
          <Label className="text-xs">Column gap (pt)</Label>
          <Input type="number" min={0} max={96} className="h-8 text-xs" value={o.columnGap ?? ''} onChange={setNum('columnGap')} placeholder="0" />
        </div>
        <div>
          <Label className="text-xs">Max lines</Label>
          <Input type="number" min={1} max={50} className="h-8 text-xs" value={o.maxLines ?? ''} onChange={setNum('maxLines')} placeholder="∞" />
        </div>
        <div>
          <Label className="text-xs">Hyphens</Label>
          <Select value={o.hyphens ?? 'manual'} onValueChange={(v) => onChange({ hyphens: v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="auto">Auto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* OpenType */}
      <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">OpenType</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Ligatures</Label>
          <Select value={o.ligatures ?? 'common'} onValueChange={(v) => onChange({ ligatures: v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="common">Common</SelectItem>
              <SelectItem value="discretionary">Discretionary</SelectItem>
              <SelectItem value="historical">Historical</SelectItem>
              <SelectItem value="contextual">Contextual</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Numeric</Label>
          <Select value={o.fontVariantNumeric ?? 'normal'} onValueChange={(v) => onChange({ fontVariantNumeric: v === 'normal' ? undefined : v } as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="lining-nums">Lining</SelectItem>
              <SelectItem value="oldstyle-nums">Old-style</SelectItem>
              <SelectItem value="tabular-nums">Tabular</SelectItem>
              <SelectItem value="proportional-nums">Proportional</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between rounded border border-border px-2 py-1">
        <Label className="text-xs">Kerning</Label>
        <Switch checked={o.kerning !== false} onCheckedChange={(v) => onChange({ kerning: v } as any)} />
      </div>
      <div>
        <Label className="text-xs">Variation settings (variable fonts)</Label>
        <Input
          className="h-8 text-xs font-mono"
          placeholder='"wght" 600, "opsz" 32'
          value={o.fontVariationSettings ?? ''}
          onChange={(e) => onChange({ fontVariationSettings: e.target.value || undefined } as any)}
        />
      </div>
      <div>
        <Label className="text-xs">Text shadow (raw CSS)</Label>
        <Input
          className="h-8 text-xs font-mono"
          placeholder="0 1pt 2pt rgba(0,0,0,.3)"
          value={o.textShadow ?? ''}
          onChange={(e) => onChange({ textShadow: e.target.value || undefined } as any)}
        />
      </div>

      <Separator />

      {/* Rich text */}
      <div className="flex items-center justify-between rounded border border-border px-2 py-1">
        <div className="space-y-0.5">
          <Label className="text-xs">Rich text (HTML)</Label>
          <p className="text-[10px] text-muted-foreground">Render content as raw HTML — use {`<strong>`}, {`<em>`}, etc.</p>
        </div>
        <Switch checked={!!o.rich} onCheckedChange={(v) => onChange({ rich: v } as any)} />
      </div>

      {/* Baseline */}
      <div className="flex items-center justify-between rounded border border-border px-2 py-1">
        <Label className="text-xs">Snap to baseline grid</Label>
        <Switch checked={!!o.snapToBaseline} onCheckedChange={(v) => onChange({ snapToBaseline: v } as any)} />
      </div>
    </div>
  );
}

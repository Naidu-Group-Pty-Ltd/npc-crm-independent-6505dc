/**
 * FontPicker — replaces the legacy font Select. Categorised browser of the
 * curated Google Fonts catalog with live previews, search, weight selection,
 * and one-click font-pairing presets.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  BUILT_IN_FAMILIES,
  FONT_CATALOG,
  FONT_CATEGORIES,
  FONT_PAIR_PRESETS,
  findCatalogFont,
  googleFontsCssUrl,
  type FontCategory,
} from '@/lib/reportTemplate/fontCatalog';
import type { FontFace, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  value: string;
  weight?: 'normal' | 'bold' | number;
  template: ReportTemplate;
  onChange: (family: string) => void;
  onWeightChange?: (weight: 'normal' | 'bold') => void;
  onTemplateChange?: (t: ReportTemplate) => void;
}

export function FontPicker({ value, weight, template, onChange, onWeightChange, onTemplateChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | FontCategory>('All');
  const [customGoogleFamily, setCustomGoogleFamily] = useState('');
  const faces: FontFace[] = (template.tokens as any).fontFaces ?? [];

  // Ensure preview fonts are actually loaded in the editor doc.
  useEffect(() => {
    if (!open) return;
    const toLoad = FONT_CATALOG.filter((f) => category === 'All' || f.category === category);
    toLoad.slice(0, 40).forEach((f) => ensureFontLink(f.cssUrl));
  }, [open, category]);

  useEffect(() => {
    if (!open || !customGoogleFamily.trim()) return;
    ensureFontLink(findCatalogFont(customGoogleFamily.trim())?.cssUrl ?? googleFontsCssUrl(customGoogleFamily.trim()));
  }, [open, customGoogleFamily]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FONT_CATALOG.filter((f) => {
      if (category !== 'All' && f.category !== category) return false;
      if (!q) return true;
      return f.family.toLowerCase().includes(q) || f.category.toLowerCase().includes(q);
    });
  }, [query, category]);

  const addFamily = (family: string) => {
    const cat = findCatalogFont(family);
    if (cat && onTemplateChange && !faces.some((f) => f.family === family) && !BUILT_IN_FAMILIES.includes(family)) {
      onTemplateChange({
        ...template,
        tokens: { ...template.tokens, fontFaces: [...faces, { family, cssUrl: cat.cssUrl }] } as any,
      });
    }
    onChange(family);
    setOpen(false);
    toast.success(`${family} applied`);
  };

  const addPublicGoogleFont = () => {
    const family = customGoogleFamily.trim().replace(/\s+/g, ' ');
    if (!family) return;
    const cssUrl = findCatalogFont(family)?.cssUrl ?? googleFontsCssUrl(family);
    ensureFontLink(cssUrl);
    const isBuiltIn = BUILT_IN_FAMILIES.some((builtIn) => builtIn.toLowerCase() === family.toLowerCase());
    const isInstalled = faces.some((f) => f.family.toLowerCase() === family.toLowerCase());
    if (onTemplateChange && !isInstalled && !isBuiltIn) {
      onTemplateChange({
        ...template,
        tokens: { ...template.tokens, fontFaces: [...faces, { family, cssUrl }] } as any,
      });
    }
    onChange(family);
    setCustomGoogleFamily('');
    setOpen(false);
    toast.success(`${family} added from Google Fonts`);
  };

  const applyPair = (heading: string, body: string) => {
    let faceList = [...faces];
    [heading, body].forEach((fam) => {
      const cat = findCatalogFont(fam);
      if (cat && !faceList.some((f) => f.family === fam) && !BUILT_IN_FAMILIES.includes(fam)) {
        faceList.push({ family: fam, cssUrl: cat.cssUrl });
      }
      ensureFontLink(cat?.cssUrl);
    });
    if (onTemplateChange) {
      onTemplateChange({
        ...template,
        tokens: {
          ...template.tokens,
          fontFaces: faceList,
          fonts: { ...(template.tokens.fonts ?? {}), heading, body },
        } as any,
      });
    }
    onChange(heading);
    setOpen(false);
    toast.success(`Pairing applied: ${heading} + ${body}`);
  };

  const currentCat = findCatalogFont(value);

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs">
            <span className="truncate flex items-center gap-1.5" style={{ fontFamily: value }}>
              {value || 'Pick font'}
              {currentCat && <span className="text-[9px] text-muted-foreground">· {currentCat.category}</span>}
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] p-0">
          <Tabs defaultValue="browse" className="w-full">
            <TabsList className="grid w-full grid-cols-3 rounded-none">
              <TabsTrigger value="browse" className="text-xs">Browse</TabsTrigger>
              <TabsTrigger value="google" className="text-xs">Google</TabsTrigger>
              <TabsTrigger value="pairs" className="text-xs gap-1">
                <Sparkles className="h-3 w-3" /> Pairings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="p-2 space-y-2 m-0">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search fonts…"
                autoFocus
                className="h-8 text-xs"
                iconClassName="left-2 h-3.5 w-3.5"
              />
              <div className="flex flex-wrap gap-1">
                {(['All', ...FONT_CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      category === c
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <Separator />
              <ScrollArea className="h-[280px] pr-2">
                <div className="space-y-0.5">
                  {/* Built-in PDF fonts */}
                  {category === 'All' && !query && (
                    <>
                      <div className="px-1 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">PDF built-ins</div>
                      {BUILT_IN_FAMILIES.map((fam) => (
                        <FontRow key={fam} family={fam} sub="System" active={value === fam} onClick={() => { onChange(fam); setOpen(false); }} />
                      ))}
                      <Separator className="my-1" />
                      <div className="px-1 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">Google Fonts</div>
                    </>
                  )}
                  {filtered.map((f) => (
                    <FontRow
                      key={f.family}
                      family={f.family}
                      sub={f.category}
                      active={value === f.family}
                      onClick={() => addFamily(f.family)}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-center text-[11px] text-muted-foreground py-6">No matches.</p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="google" className="p-3 space-y-3 m-0">
              <div className="space-y-1">
                <Label className="text-xs">Public Google Font family</Label>
                <div className="flex gap-2">
                  <Input
                    value={customGoogleFamily}
                    onChange={(e) => setCustomGoogleFamily(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addPublicGoogleFont(); }}
                    placeholder="e.g. Roboto, Noto Sans, Playfair Display"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" className="h-8" onClick={addPublicGoogleFont} disabled={!customGoogleFamily.trim()}>Add</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Uses the public Google Fonts CSS2 endpoint and stores the face in this template’s fontFaces so preview/export can load it.
                </p>
              </div>
              {customGoogleFamily.trim() && (
                <div className="rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview</div>
                  <div className="mt-1 text-xl" style={{ fontFamily: customGoogleFamily }}>
                    {customGoogleFamily.trim()} — The quick brown fox
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="pairs" className="p-2 space-y-1 m-0">
              <p className="text-[10px] text-muted-foreground px-1 pb-1">
                One click installs both faces and sets the heading family.
              </p>
              <ScrollArea className="h-[320px]">
                <div className="space-y-1">
                  {FONT_PAIR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPair(p.heading, p.body)}
                      className="w-full rounded-md border border-border bg-card hover:border-primary/50 transition-colors p-2 text-left"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-medium">{p.label}</span>
                        <span className="text-[9px] text-muted-foreground">{p.mood}</span>
                      </div>
                      <div className="text-base leading-tight" style={{ fontFamily: p.heading }}>{p.heading}</div>
                      <div className="text-[11px] text-muted-foreground" style={{ fontFamily: p.body }}>
                        Body — {p.body}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>

      {onWeightChange && (
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => onWeightChange('normal')}
            className={`h-6 rounded text-[10px] border ${weight === 'normal' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            Regular
          </button>
          <button
            type="button"
            onClick={() => onWeightChange('bold')}
            className={`h-6 rounded text-[10px] font-bold border ${weight === 'bold' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            Bold
          </button>
        </div>
      )}
    </div>
  );
}

function FontRow({ family, sub, active, onClick }: { family: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent transition-colors ${active ? 'bg-primary/10' : ''}`}
    >
      <span className="truncate text-sm" style={{ fontFamily: family }}>{family}</span>
      <span className="flex items-center gap-2">
        <span className="text-[9px] text-muted-foreground">{sub}</span>
        {active && <Check className="h-3 w-3 text-primary" />}
      </span>
    </button>
  );
}

function ensureFontLink(cssUrl?: string) {
  if (!cssUrl || typeof document === 'undefined') return;
  if (document.querySelector(`link[data-tpl-font="${cssUrl}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssUrl;
  link.dataset.tplFont = cssUrl;
  document.head.appendChild(link);
}

/**
 * Template Builder → Brand systems.
 *
 * ## What this replaces
 *
 * A 516-line dialog that could only create. `saveDesignSystem` has always taken
 * an `id` and an `isActive` and nothing ever passed either, so a saved design
 * system could not be renamed, edited or retired — only added to, forever. And
 * a system was shown as three swatches, so `chapterStyle`, `tableStyle`,
 * `coverStyle`, `density` and `bodyScale` were chosen from a dropdown with a
 * sentence of hint under it. You found out what `opener_band` meant by
 * rendering a document.
 *
 * ## Laid out like the Design System pane, on purpose
 *
 * The published NPC Services Design System is a gallery of grouped specimen
 * cards — Brand, Colors, Type, Spacing, Elevation, Components — each a
 * standalone HTML preview at a declared viewport with a name, a subtitle, a
 * mono token line and a paragraph saying why the thing is the way it is. This
 * page is that: `BRAND_SPECIMENS` carries the same four card fields, the same
 * two lines beneath, and the gallery groups by `group` exactly as the pane
 * does.
 *
 * The specimens are the real renderer — `buildReportCss` and the actual
 * primitives in a sandboxed iframe — so changing a control redraws them into
 * what WeasyPrint will print, rather than into a React impression of it.
 *
 * ## Three ways a system comes to exist
 *
 * Authored here, drafted by Claude from a brief, or **imported** from a design
 * system published on claude.ai/design. The third is the new one and the reason
 * for the rest: an imported system brings its own paper, ink, hairline and
 * accent, which the four presets — permutations of three hardcoded values —
 * cannot express.
 */
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  EyeOff,
  FileJson,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { BrandSpecimenCard } from '@/components/brandDesign/BrandSpecimenCard';
import { DesignSystemImport } from '@/components/brandDesign/DesignSystemImport';
import { specimensByGroup } from '@/lib/brandDesign/specimens';
import {
  auditDesignSystem,
  generateDesignSystem,
  importDesignSystemFile,
  listDesignSystems,
  saveDesignSystem,
} from '@/lib/brandDesign/requestBrandDesignSystem';
import {
  BRAND_HEX_PATTERN,
  BRIEF_EXAMPLES,
  CHAPTER_STYLE_OPTIONS,
  COVER_STYLE_OPTIONS,
  DENSITY_OPTIONS,
  type LabelledOption,
  PRESET_OPTIONS,
  SUGGESTED_BRAND_HEXES,
  TABLE_STYLE_OPTIONS,
} from '@/lib/brandDesign/formOptions';
import {
  type BrandDesignSystem,
  MAX_BRIEF_CHARS,
  slugify,
} from '@/lib/brandDesign/system.pure';
import {
  type BrandDesignSystemSummary,
  MIN_BRIEF_CHARS,
} from '@/lib/brandDesign/route.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { DEFAULT_REPORT_DESIGN_OPTIONS } from '@/lib/reportDesign/options.pure';
import { TEMPLATE_BUILDER_PATH } from '@/lib/reportTemplate/templateStartRoutes';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';

export const BRAND_SYSTEMS_QUERY_KEY = ['brand-design-systems', 'all'] as const;

const BLANK: BrandDesignSystem = {
  name: '',
  slug: '',
  description: '',
  brandHex: null,
  options: { ...DEFAULT_REPORT_DESIGN_OPTIONS },
  neutrals: null,
  origin: 'authored',
  brief: '',
  sourceNamespace: '',
};

/** The swatch value as a CSS custom property, so no inline colour is written. */
const swatchVar = (hex: string | null): React.CSSProperties =>
  ({ '--converter-swatch': hex ?? 'transparent' } as React.CSSProperties);

const ORIGIN_LABEL: Record<BrandDesignSystem['origin'], string> = {
  authored: 'Authored',
  generated: 'Drafted by Claude',
  imported: 'Imported from Claude Design',
};

/** A Select plus the hint for whichever option is chosen. */
function OptionSelect<T extends string>({
  id, label, value, options, onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<LabelledOption<T>>;
  onChange: (v: T) => void;
}) {
  const hint = options.find((o) => o.value === value)?.hint ?? '';
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function BrandSystems() {
  const queryClient = useQueryClient();

  const [system, setSystem] = useState<BrandDesignSystem>(BLANK);
  const [hexDraft, setHexDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<string>('');
  const [auditProblems, setAuditProblems] = useState<string>('');
  const [auditOk, setAuditOk] = useState<boolean | null>(null);

  // Through the route, not `supabase.from(...)` — the browser client is
  // permanently anonymous and the table is granted to `authenticated`, so a
  // direct read is refused at the grant level before RLS is consulted. The
  // error is surfaced rather than swallowed into an empty list: "the read
  // failed" and "nobody has made one" must not look the same.
  const { data: systems = [], isLoading, error: listError, refetch } = useQuery({
    queryKey: BRAND_SYSTEMS_QUERY_KEY,
    queryFn: async () => (await listDesignSystems(true)).systems,
    staleTime: 30_000,
  });

  const hexValid = hexDraft === '' || BRAND_HEX_PATTERN.test(hexDraft);
  const brandHex = hexValid && hexDraft ? hexDraft.toUpperCase() : null;

  /** What the gallery is drawing. Imported grounds win over the preset's. */
  const palette = useMemo(
    () => resolveReportPalette({
      preset: system.options.preset,
      brandHex,
      neutrals: system.neutrals,
    }),
    [system.options.preset, brandHex, system.neutrals],
  );

  // The verdict, debounced, from the server — the same modules the renderer
  // uses, so what this shows is what the document will do.
  useEffect(() => {
    if (!hexValid) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const r = await auditDesignSystem({ ...system, name: system.name || 'Draft', brandHex });
        if (!live) return;
        setAuditOk(r.audit.ok);
        setAuditProblems(r.audit.summary);
      } catch {
        if (live) { setAuditOk(null); setAuditProblems(''); }
      }
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [system, brandHex, hexValid]);

  const set = (patch: Partial<BrandDesignSystem>) => setSystem((s) => ({ ...s, ...patch }));
  const setOption = <K extends keyof BrandDesignSystem['options']>(
    key: K, value: BrandDesignSystem['options'][K],
  ) => setSystem((s) => ({ ...s, options: { ...s.options, [key]: value } }));

  const startBlank = () => {
    setSystem(BLANK);
    setHexDraft('');
    setEditingId(null);
    setImportNotes([]);
    setImportSummary('');
    setImportError(null);
  };

  const open = (row: BrandDesignSystemSummary) => {
    setSystem({
      name: row.name,
      slug: row.slug,
      description: row.description,
      brandHex: row.brandHex,
      options: row.options,
      neutrals: row.neutrals,
      origin: row.origin,
      brief: '',
      sourceNamespace: row.sourceNamespace,
    });
    setHexDraft(row.brandHex ?? '');
    setEditingId(row.id);
    setImportNotes([]);
    setImportSummary(row.sourceNamespace ? `Imported from ${row.sourceNamespace}.` : '');
    setImportError(null);
  };

  const importing = useMutation({
    mutationFn: ({ source, name }: { source: string; name: string }) =>
      importDesignSystemFile(source, name),
    onSuccess: (r) => {
      setSystem(r.system);
      setHexDraft(r.system.brandHex ?? '');
      setEditingId(null);
      setImportError(null);
      setImportNotes(r.imported?.notes ?? []);
      setImportSummary(
        r.imported
          ? `${r.imported.colorCount} colour tokens`
            + `${r.imported.cardCount ? `, ${r.imported.cardCount} cards` : ''}`
            + `${r.imported.themes.length ? `, themes: ${r.imported.themes.join(', ')}` : ''}`
            + `${r.imported.brandFonts.length ? `, fonts: ${r.imported.brandFonts.join(', ')}` : ''}.`
          : '',
      );
      toast.success(`Read "${r.system.name}"`, {
        description: 'The specimens show what it does to a document. Save it if you want to keep it.',
      });
    },
    onError: (e: Error) => setImportError(e.message),
  });

  const drafting = useMutation({
    mutationFn: () => generateDesignSystem(brief, ''),
    onSuccess: (r) => {
      setSystem(r.system);
      setHexDraft(r.system.brandHex ?? '');
      setEditingId(null);
      toast.success(`Drafted "${r.system.name}"`, {
        description: 'Change anything you disagree with, then save it.',
      });
    },
    onError: (e: Error) => toast.error('Could not draft a design system', { description: e.message }),
  });

  const saving = useMutation({
    mutationFn: (args: { candidate: BrandDesignSystem; id: string | null; isActive: boolean }) =>
      saveDesignSystem(args.candidate, { id: args.id, isActive: args.isActive }),
    onSuccess: (r, args) => {
      queryClient.invalidateQueries({ queryKey: BRAND_SYSTEMS_QUERY_KEY });
      setEditingId(r.id);
      toast.success(args.id ? `Saved "${r.system.name}"` : `Created "${r.system.name}"`);
    },
    onError: (e: Error) => toast.error('Could not save the design system', { description: e.message }),
  });

  const candidate: BrandDesignSystem = {
    ...system,
    brandHex,
    slug: system.slug || slugify(system.name),
  };
  const canSave = !saving.isPending && system.name.trim().length >= 2 && hexValid && auditOk === true;
  const briefTooShort = brief.trim().length < MIN_BRIEF_CHARS;
  const groups = useMemo(() => specimensByGroup(), []);

  // The design factor is hidden product-wide (designControlsVisibility.ts).
  // The route stays declared and still resolves — hiding is never deleting, and
  // a bookmark or an old link landing on a 404 tells the reader the product is
  // broken rather than that a feature is off. So the page answers, briefly, and
  // offers the way back. Every hook above this line runs on both paths.
  if (!REPORT_DESIGN_CONTROLS_VISIBLE) {
    return (
      <div className="container mx-auto max-w-2xl space-y-4 py-10">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link to={TEMPLATE_BUILDER_PATH}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Template Builder
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Brand systems</h1>
        <p className="text-sm text-muted-foreground">
          Designing and editing brand systems is turned off at the moment. Reports keep rendering
          in the house design and in any system already saved, so nothing you have generated or
          converted is affected.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild>
            <Link to={TEMPLATE_BUILDER_PATH}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Template Builder
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Brand systems</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A design system is a saved position on the report design system — the paper, the ink,
            the accent and how a chapter announces itself. Every card on the right is the real
            renderer, so what you see is what the PDF prints.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={startBlank}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            New
          </Button>
          <Button
            onClick={() => saving.mutate({ candidate, id: editingId, isActive: true })}
            disabled={!canSave}
          >
            {saving.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <Save className="mr-2 h-4 w-4" aria-hidden />}
            {editingId ? 'Save changes' : 'Save design system'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* ── The rail ─────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Saved systems</CardTitle>
              <CardDescription>
                Select one to edit it, or use it as the starting point for another.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading && <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>}

              {listError && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  <AlertTitle>Design systems could not be loaded</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-3">
                    <span>{(listError as Error).message}</span>
                    <Button size="sm" variant="outline" onClick={() => refetch()}>
                      <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {!isLoading && !listError && systems.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">
                  None yet. Import one from Claude Design below, or set the levers yourself.
                </p>
              )}

              {systems.map((row) => (
                <div
                  key={row.id}
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    editingId === row.id ? 'border-primary bg-primary/5' : ''
                  } ${row.isActive ? '' : 'opacity-60'}`}
                >
                  {/* `--converter-swatch`, not an inline background: a design
                      system's accent is document data and must show its real
                      value, but the style ratchet rightly counts an inline
                      colour. See `src/styles/components.css`. */}
                  <span
                    aria-hidden
                    className="converter-swatch mt-1 h-3.5 w-3.5 shrink-0 rounded-full border"
                    style={swatchVar(row.brandHex)}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => open(row)}
                      className="block w-full truncate text-left text-sm font-medium hover:underline"
                    >
                      {row.name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.description || 'No description.'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{ORIGIN_LABEL[row.origin]}</Badge>
                      {row.neutrals && (
                        <Badge variant="outline" className="text-[10px]">own paper and ink</Badge>
                      )}
                      {!row.isActive && <Badge variant="outline" className="text-[10px]">Retired</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Duplicate"
                      aria-label={`Duplicate ${row.name}`}
                      onClick={() => {
                        open(row);
                        setEditingId(null);
                        setSystem((s) => ({ ...s, name: `${row.name} copy`, slug: '' }));
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title={row.isActive ? 'Retire' : 'Restore'}
                      aria-label={`${row.isActive ? 'Retire' : 'Restore'} ${row.name}`}
                      onClick={() => saving.mutate({
                        candidate: {
                          name: row.name,
                          slug: row.slug,
                          description: row.description,
                          brandHex: row.brandHex,
                          options: row.options,
                          neutrals: row.neutrals,
                          origin: row.origin,
                          brief: '',
                          sourceNamespace: row.sourceNamespace,
                        },
                        id: row.id,
                        isActive: !row.isActive,
                      })}
                    >
                      <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="import">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="import">Import</TabsTrigger>
                  <TabsTrigger value="brief">Brief</TabsTrigger>
                  <TabsTrigger value="levers">Levers</TabsTrigger>
                </TabsList>

                <TabsContent value="import" className="pt-4">
                  <DesignSystemImport
                    onImport={(source, name) => importing.mutate({ source, name })}
                    pending={importing.isPending}
                    error={importError}
                  />
                  {importSummary && (
                    <p className="mt-4 text-xs text-muted-foreground">{importSummary}</p>
                  )}
                  {/* Every compromise the derivation made, named. A silent
                      substitution is how somebody discovers their report has
                      our champagne panels in it after they have sent it. */}
                  {importNotes.length > 0 && (
                    <Alert className="mt-3">
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                      <AlertTitle>
                        {importNotes.length} substitution{importNotes.length === 1 ? '' : 's'}
                      </AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc space-y-1 pl-4 text-xs">
                          {importNotes.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </TabsContent>

                <TabsContent value="brief" className="space-y-3 pt-4">
                  <Label htmlFor="brand-brief">What are these documents for?</Label>
                  <Textarea
                    id="brand-brief"
                    rows={5}
                    value={brief}
                    maxLength={MAX_BRIEF_CHARS}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={BRIEF_EXAMPLES[0]}
                  />
                  <Button
                    onClick={() => drafting.mutate()}
                    disabled={drafting.isPending || briefTooShort}
                  >
                    {drafting.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
                    Draft a design system
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Claude chooses the accent and the levers. It does not choose paper and ink —
                    seven interdependent greys against four contrast floors is a worse proposition
                    than one hue, and an import already produces those from values a designer set.
                  </p>
                </TabsContent>

                <TabsContent value="levers" className="space-y-4 pt-4">
                  <OptionSelect
                    id="ds-preset" label="Preset" value={system.options.preset}
                    options={PRESET_OPTIONS} onChange={(v) => setOption('preset', v)}
                  />
                  {system.neutrals && (
                    <p className="text-xs text-muted-foreground">
                      This system brings its own paper and ink, so the preset only names it —
                      it supplies nothing.
                    </p>
                  )}
                  <OptionSelect
                    id="ds-density" label="Density" value={system.options.density}
                    options={DENSITY_OPTIONS} onChange={(v) => setOption('density', v)}
                  />
                  <OptionSelect
                    id="ds-chapter" label="Chapter openers" value={system.options.chapterStyle}
                    options={CHAPTER_STYLE_OPTIONS} onChange={(v) => setOption('chapterStyle', v)}
                  />
                  <OptionSelect
                    id="ds-table" label="Tables" value={system.options.tableStyle}
                    options={TABLE_STYLE_OPTIONS} onChange={(v) => setOption('tableStyle', v)}
                  />
                  <OptionSelect
                    id="ds-cover" label="Cover" value={system.options.coverStyle}
                    options={COVER_STYLE_OPTIONS} onChange={(v) => setOption('coverStyle', v)}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="ds-scale">Body size — {system.options.bodyScale}%</Label>
                    <Slider
                      id="ds-scale" min={85} max={115} step={1}
                      value={[system.options.bodyScale]}
                      onValueChange={([v]) => setOption('bodyScale', v)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ds-intensity">
                      Visual intensity — {system.options.visualIntensity}%
                    </Label>
                    <Slider
                      id="ds-intensity" min={0} max={100} step={1}
                      value={[system.options.visualIntensity]}
                      onValueChange={([v]) => setOption('visualIntensity', v)}
                    />
                  </div>

                  {([
                    ['showSectionNumbers', 'Section numbers'],
                    ['justifyText', 'Justified text'],
                    ['showDropCaps', 'Drop caps'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label htmlFor={`ds-${key}`}>{label}</Label>
                      <Switch
                        id={`ds-${key}`}
                        checked={system.options[key]}
                        onCheckedChange={(v) => setOption(key, v)}
                      />
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* ── The gallery ──────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ds-name">Name</Label>
                <Input
                  id="ds-name" value={system.name} maxLength={80}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Warm Editorial"
                />
                {system.name.trim().length >= 2 && (
                  <p className="text-xs text-muted-foreground">
                    Handle: <code className="font-mono">{slugify(system.name)}</code>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ds-hex">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="converter-swatch h-9 w-9 shrink-0 rounded-md border"
                    style={swatchVar(palette.accentOnPaper)}
                  />
                  <Input
                    id="ds-hex" value={hexDraft} aria-invalid={!hexValid}
                    onChange={(e) => setHexDraft(e.target.value)}
                    placeholder="Leave blank for the house brand"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SUGGESTED_BRAND_HEXES.map((s) => (
                    <button
                      key={s.hex}
                      type="button"
                      title={`${s.name} · ${s.hex}`}
                      aria-label={s.name}
                      onClick={() => setHexDraft(s.hex)}
                      className="converter-swatch h-6 w-6 rounded border transition-transform hover:scale-110"
                      style={swatchVar(s.hex)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="ds-description">When to reach for it</Label>
                <Input
                  id="ds-description" value={system.description} maxLength={400}
                  onChange={(e) => set({ description: e.target.value })}
                  placeholder="Board packs and anything that gets filed."
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <Badge variant="outline">{ORIGIN_LABEL[system.origin]}</Badge>
                {system.sourceNamespace && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    <FileJson className="mr-1 h-3 w-3" aria-hidden />
                    {system.sourceNamespace}
                  </Badge>
                )}
                {system.neutrals && <Badge variant="outline">own paper and ink</Badge>}
                <Separator orientation="vertical" className="h-4" />
                {auditOk === true && (
                  <span className="flex items-center gap-1.5 text-sm text-success">
                    <Check className="h-4 w-4" aria-hidden />
                    Every ink role clears its floor
                  </span>
                )}
                {auditOk === false && (
                  <span className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    {auditProblems || 'This system cannot be made legible'}
                  </span>
                )}
                {auditOk === null && (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Checking contrast…
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {groups.map(({ group, specimens }) => (
            <section key={group} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Palette className="h-4 w-4" aria-hidden />
                {group}
              </h2>
              <div className="grid gap-4 xl:grid-cols-2">
                {specimens.map((specimen) => (
                  <BrandSpecimenCard
                    key={specimen.id}
                    specimen={specimen}
                    palette={palette}
                    options={system.options}
                    masthead={system.name || 'Specimen'}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

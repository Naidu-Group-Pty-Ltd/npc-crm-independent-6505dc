/**
 * Template Builder → Converter.
 *
 * Upload a template somebody has been sending clients for years; get it back
 * set through the report design system and bound to a report format.
 *
 * ## The three steps are three steps on purpose
 *
 * Upload, review, render. The middle one is why this is a page rather than a
 * button: binding is *suggested and then confirmed*. A wrong automatic binding
 * produces a document where the "Serviceability" chapter is filled with the fee
 * schedule, which looks entirely correct and is completely wrong. So every
 * proposal arrives with its score visible and a dropdown beside it, and a weak
 * match says so in words rather than in a number nobody reads.
 *
 * ## What is taken from the upload
 *
 * Sections, their order, their nesting, and whether they are tabular. Not
 * margins, not colours, not where a logo sat — those are what the design system
 * is replacing. Carrying them across would reproduce the document rather than
 * refurbish it.
 *
 * ## Nothing the upload contained is discarded
 *
 * A section no chapter wanted is printed as an appendix, not dropped. Somebody
 * chose to put it in their template, and a converter that silently eats a third
 * of an upload is a converter nobody trusts twice. The counts are on the screen
 * for the same reason.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Download,
  FileUp,
  Loader2,
  Palette,
  PencilRuler,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { BrandDesignSystemDialog } from '@/components/templateBuilder/converter/BrandDesignSystemDialog';
import { listDesignSystems } from '@/lib/brandDesign/requestBrandDesignSystem';
import type { BrandDesignSystemSummary } from '@/lib/brandDesign/route.pure';
import {
  conversionChapters,
  deliverConvertedTemplate,
  extractTemplate,
  proposeTemplateBinding,
  RECENT_CONVERSIONS_QUERY_KEY,
} from '@/lib/reports/converted/requestTemplateConversion';
import { RecentConversions } from '@/components/templateBuilder/converter/RecentConversions';
import { buildConvertedTemplate } from '@/lib/reportTemplate/convertedTemplateSchema.pure';
import { useReportTemplateMutations } from '@/hooks/useReportTemplates';
import {
  type ConvertExtractResponse,
  type ConvertRenderResponse,
  MAX_SOURCE_BYTES,
  TEXT_SUFFIXES,
} from '@/lib/reports/converted/route.pure';
import {
  bindableFormats,
  type BindingPlan,
  type ChapterBinding,
  formatName,
  WEAK_MATCH,
} from '@/lib/reports/converted/binding.pure';
import { CONVERTED_REPORT_TYPES } from '@/lib/reports/converted/reportType';
import { type ConversionFidelity } from '@/lib/reports/converted/enrich.pure';
import { FIDELITY_CHOICES, fidelityLabel } from '@/lib/reports/converted/fidelityChoices';
import { BRAND_SYSTEMS_PATH } from '@/lib/reportTemplate/templateStartRoutes';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';
import type { ReportArchetypeId } from '@/lib/reportDesign/structure.pure';

const ACCEPT = [...TEXT_SUFFIXES, '.pdf'].join(',');
/** The dropdown value for "no section", since a Select cannot hold empty. */
const NONE = '__none__';



export default function TemplateConverter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { create } = useReportTemplateMutations();

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ReportArchetypeId>(() => bindableFormats()[0]);
  const [extracting, setExtracting] = useState(false);
  const [reproposing, setReproposing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [materialising, setMaterialising] = useState(false);

  const [extracted, setExtracted] = useState<ConvertExtractResponse | null>(null);
  const [plan, setPlan] = useState<BindingPlan | null>(null);
  const [designSystemId, setDesignSystemId] = useState<string | null>(null);
  // Not `DEFAULT_FIDELITY`. That constant is the *parse* fallback — what an
  // unrecognised or absent field on a request means — and it stays conservative
  // for that job. What a person gets without choosing is a separate question,
  // and the strict answer produced a document that read as a transcript.
  const [fidelity, setFidelity] = useState<ConversionFidelity>('connective');
  const [final, setFinal] = useState(false);
  const [systemDialogOpen, setSystemDialogOpen] = useState(false);
  const [result, setResult] = useState<ConvertRenderResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Through the edge function, not `supabase.from(...)`.
  //
  // The browser client is permanently anonymous under this app's cookie auth
  // and `brand_design_systems` is granted to `authenticated` only, so the
  // direct read is refused at the grant level. It used to be caught and turned
  // into `[]`, which made a broken read look exactly like an empty table — the
  // picker was silently, permanently empty for everybody.
  //
  // The error is deliberately not swallowed now: a failure renders as a failure.
  const {
    data: systems = [],
    isLoading: systemsLoading,
    error: systemsError,
    refetch: refetchSystems,
  } = useQuery({
    queryKey: ['brand-design-systems'],
    queryFn: async (): Promise<BrandDesignSystemSummary[]> =>
      (await listDesignSystems()).systems,
  });

  /** A stale selection must not blank the trigger — see `onSaved`. */
  const selectedSystem = systems.find((s) => s.id === designSystemId) ?? null;

  const { data: whitelabel } = useQuery({
    queryKey: ['whitelabel-company-name'],
    queryFn: async () => {
      const { data } = await supabase.from('whitelabel_settings').select('company_name').limit(1).maybeSingle();
      return String(data?.company_name ?? '');
    },
  });

  // The object URL is revoked when it is replaced and when the page goes away.
  // A preview iframe holding a stale blob is a memory leak with a picture in it.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const sections = extracted?.sections ?? [];
  const sectionTitle = (index: number | null) =>
    index === null ? null : sections.find((s) => s.index === index)?.title ?? null;

  /** Sections not bound to any chapter — printed as an appendix. */
  const unbound = useMemo(() => {
    if (!plan) return [];
    const taken = new Set(plan.bindings.map((b) => b.sectionIndex).filter((i): i is number => i !== null));
    return sections.filter((s) => !taken.has(s.index));
  }, [plan, sections]);

  const boundCount = plan?.bindings.filter((b) => b.sectionIndex !== null).length ?? 0;

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true);
    setResult(null);
    try {
      const response = await extractTemplate(file, format);
      setExtracted(response);
      setPlan(response.binding as BindingPlan);
      toast.success(`Read ${response.title}`, { description: response.summary });
    } catch (e) {
      toast.error('Could not read the template', { description: (e as Error).message });
    } finally {
      setExtracting(false);
    }
  };

  const handleFormatChange = async (next: ReportArchetypeId) => {
    setFormat(next);
    if (!extracted) return;
    setReproposing(true);
    try {
      const response = await proposeTemplateBinding(extracted.conversionId, next);
      setPlan(response.binding as BindingPlan);
      setResult(null);
      toast.success(`Re-bound to ${response.formatName}`);
    } catch (e) {
      toast.error('Could not re-bind', { description: (e as Error).message });
    } finally {
      setReproposing(false);
    }
  };

  /**
   * Move one chapter's binding.
   *
   * One-to-one is enforced here as well as on the route: taking a section that
   * another chapter already holds releases it from that chapter rather than
   * duplicating it. A section bound twice prints the same three paragraphs in
   * two places and looks entirely deliberate.
   */
  const bindChapter = (chapter: string, value: string) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = value === NONE ? null : Number(value);
      const bindings: ChapterBinding[] = prev.bindings.map((b) => {
        if (b.chapter === chapter) {
          return {
            ...b,
            sectionIndex: next,
            confirmed: true,
            confidence: next === null ? 0 : b.sectionIndex === next ? b.confidence : 100,
            reason: next === null ? 'Left for the live report.' : 'Chosen by hand.',
          };
        }
        if (next !== null && b.sectionIndex === next) {
          return {
            ...b,
            sectionIndex: null,
            confidence: 0,
            reason: `Released — "${sectionTitle(next)}" was moved to ${chapter}.`,
            confirmed: true,
          };
        }
        return b;
      });
      return {
        ...prev,
        bindings,
        unfilled: bindings.filter((b) => b.sectionIndex === null).map((b) => b.chapter),
        unbound: sections
          .filter((s) => !bindings.some((b) => b.sectionIndex === s.index))
          .map((s) => s.index),
      };
    });
    setResult(null);
  };

  /**
   * The same conversion, as pages you can edit.
   *
   * A second artefact rather than a replacement: the PDF is the finished
   * document and this is a working copy of its words. The layout is not
   * carried across — it never was, the converter keeps structure and throws
   * layout away — so this produces text laid out from the chapters, which is
   * what "editable" can honestly mean here.
   */
  const handleMaterialise = async () => {
    if (!extracted || !result) return;
    setMaterialising(true);
    try {
      const { chapters, title, format: boundFormat, formatName: boundName } =
        await conversionChapters(extracted.conversionId);

      const schema = buildConvertedTemplate({
        title,
        formatName: boundName,
        chapters,
        systemName: result.designSystemName,
      });

      // Through the existing mutation, which posts to `manage-templates`. A
      // direct insert cannot work: the browser client is anonymous and the
      // INSERT policy is `auth.uid() = created_by`.
      // The mutation already sets `version: 1`, `is_active: false` and
      // `is_default: false`, which is the exact shape
      // `validateReportTemplateInsert` waves through — nothing here should
      // override them.
      const record = await create.mutateAsync({
        name: `${title} (converted)`.slice(0, 120),
        description: `Converted from ${extracted.sections.length} sections of an uploaded template, `
          + `bound to ${boundName}.`,
        // The *stored* bound format, not the picker's current value — this is
        // asked for after a render, and the copy has to be filed under the
        // format the document was actually produced as.
        report_type: CONVERTED_REPORT_TYPES[boundFormat],
        schema,
      });

      const id = (record as { id?: string } | null)?.id;
      if (!id) throw new Error('the template was created but returned no id');
      // No toast here: the mutation raises its own on success, and two for one
      // action reads as two things having happened.
      navigate(`/admin/template-builder/${id}`);
    } catch (e) {
      toast.error('Could not create an editable template', { description: (e as Error).message });
    } finally {
      setMaterialising(false);
    }
  };

  const handleRender = async () => {
    if (!extracted || !plan) return;
    setRendering(true);
    try {
      const delivered = await deliverConvertedTemplate({
        conversionId: extracted.conversionId,
        format,
        binding: plan,
        designSystemId,
        fidelity,
        final,
      });
      setResult(delivered);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(delivered.blob);
      });
      // So the row appears in "Earlier conversions" on this screen, which is
      // how somebody learns that list is where their document went.
      queryClient.invalidateQueries({ queryKey: RECENT_CONVERSIONS_QUERY_KEY });
      toast.success(`Converted — ${delivered.pageCount ?? '?'} pages`, {
        description: `${delivered.boundCount} bound, ${delivered.unfilledCount} left to the live report, `
          + `${delivered.appendixCount} in the appendix. `
          + `${delivered.enrichedChapters} of ${delivered.attemptedChapters} chapters designed.`,
      });
    } catch (e) {
      toast.error('The conversion failed', { description: (e as Error).message });
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild>
            <Link to="/admin/template-builder">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Template Builder
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Converter</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Upload a template you already send clients and have it re-set through the report design
            system, bound to one of the migrated report formats so real report data can flow into it
            later.
          </p>
        </div>
      </div>

      {/* Onboarding, not chrome.
          It answers the three questions somebody has before they upload
          anything — what goes in, what comes out, and what this is *not* — and
          disappears the moment there is work on the screen. */}
      {!extracted && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wide">Step one</Badge>
              <CardTitle className="text-sm">What goes in</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A PDF, Markdown or text file up to {MAX_SOURCE_BYTES / 1024 / 1024} MB. Only its
              heading structure is read — which sections exist, in what order. The old layout is
              deliberately left behind.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wide">What you get</Badge>
              <CardTitle className="text-sm">A finished PDF, kept</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Set in the report design system and bound to a report format. It is saved and stays
              downloadable from <span className="font-medium">Earlier conversions</span> at the
              bottom of this page. You can also open it as an editable template.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wide">Not this</Badge>
              <CardTitle className="text-sm">Not a copy of your design</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Nothing of the original's layout is reproduced. If you want your document back looking
              as it does now, use{' '}
              <Link to="/admin/template-builder" className="font-medium underline underline-offset-2">
                Import a PDF
              </Link>{' '}
              in the Template Builder instead.
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 1 · The upload ─────────────────────────────────────────────── */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · The template</CardTitle>
          <CardDescription>
            A PDF, Markdown or text file up to {MAX_SOURCE_BYTES / 1024 / 1024} MB. Only the section
            structure is taken — headings, their order and their nesting. A source exported with
            real headings converts far better than one where the headings are text sized to look
            like them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="converter-file">File</Label>
              <input
                ref={fileInput}
                id="converter-file"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
              />
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" />
                {file ? file.name : 'Choose a template'}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="converter-format">Bind to</Label>
              <Select
                value={format}
                onValueChange={(v) => handleFormatChange(v as ReportArchetypeId)}
                disabled={reproposing}
              >
                <SelectTrigger id="converter-format" className="w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bindableFormats().map((id) => (
                    <SelectItem key={id} value={id}>{formatName(id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleExtract} disabled={!file || extracting}>
              {extracting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {extracting ? 'Reading…' : 'Read the sections'}
            </Button>
          </div>

          {file && file.name.toLowerCase().endsWith('.pdf') && (
            <p className="text-xs text-muted-foreground">
              A PDF is transcribed to Markdown before its structure is read, which takes a minute or
              two for a long template. The words are transcribed as they are — nothing is
              summarised or rewritten.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 2 · The binding ────────────────────────────────────────────── */}

      {/* Steps two and three are on screen from the start, greyed until they
          are reachable. They used to render only once an upload had been read,
          so a first-time user saw a single card and no evidence that a third
          step — the one that produces the document — existed at all. */}
      {!(extracted && plan) ? (
        <Card aria-disabled className="opacity-60">
          <CardHeader>
            <CardTitle className="text-base">2 · What plays which part</CardTitle>
            <CardDescription>
              Each chapter of the report format gets a section of your template, proposed with a
              confidence score you can override. Available once the sections have been read.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · What plays which part</CardTitle>
            <CardDescription>
              {extracted.summary} Every proposal below is a guess with its score attached — change
              anything that looks wrong before rendering.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {extracted.unstructured && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>The upload had no headings</AlertTitle>
                <AlertDescription>
                  No heading structure was found, so the whole document became one section and
                  nothing could be bound. Re-exporting the original with real headings converts far
                  better.
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">{formatName(format)} chapter</TableHead>
                  <TableHead>From the template</TableHead>
                  <TableHead className="w-[110px]">Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.bindings.map((binding) => (
                  <TableRow key={binding.chapter}>
                    <TableCell className="font-medium align-top">{binding.chapter}</TableCell>
                    <TableCell className="align-top">
                      <Select
                        value={binding.sectionIndex === null ? NONE : String(binding.sectionIndex)}
                        onValueChange={(v) => bindChapter(binding.chapter, v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— nothing; the live report supplies it —</SelectItem>
                          {sections.map((s) => (
                            <SelectItem key={s.index} value={String(s.index)}>
                              {s.depth > 1 ? '· ' : ''}{s.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground leading-snug">{binding.reason}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      {binding.sectionIndex === null
                        ? <Badge variant="outline">Unfilled</Badge>
                        : binding.confidence >= WEAK_MATCH
                          ? <Badge variant="secondary">{binding.confidence}</Badge>
                          : <Badge variant="destructive">Weak · {binding.confidence}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {unbound.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {unbound.length} unmatched {unbound.length === 1 ? 'section' : 'sections'} — kept as an appendix
                </p>
                <p className="text-xs text-muted-foreground">
                  Printed at the back rather than discarded. Nothing from the upload disappears.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {unbound.map((s) => (
                    <li key={s.index}>
                      <Badge variant="outline">{s.title}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {boundCount} of {plan.bindings.length} chapters bound
              {plan.bindings.length - boundCount > 0
                ? `, ${plan.bindings.length - boundCount} left to the live report`
                : ''}
              {unbound.length > 0 ? `, ${unbound.length} in the appendix` : ''}.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── 3 · The design system, and the render ──────────────────────── */}

      {!(extracted && plan) ? (
        <Card aria-disabled className="opacity-60">
          <CardHeader>
            <CardTitle className="text-base">3 · How it is set</CardTitle>
            <CardDescription>
              Choose a brand design system — or make one — and convert. The PDF appears here and is
              kept below. Available once a binding is confirmed.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · How it is set</CardTitle>
            <CardDescription>
              The design system decides the palette, the typography and the furniture. It applies to
              every migrated report format too, not only this conversion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="converter-system">Design system</Label>
                {systemsLoading ? (
                  <Skeleton className="h-9 w-[280px]" />
                ) : (
                  <Select
                    // Falls back to the house design when the selected id is not
                    // in the list. Radix renders an *empty* trigger for a value
                    // with no matching item, so without this a system saved
                    // while the list was stale showed as a blank box — live, but
                    // invisible.
                    value={selectedSystem ? selectedSystem.id : NONE}
                    onValueChange={(v) => { setDesignSystemId(v === NONE ? null : v); setResult(null); }}
                  >
                    <SelectTrigger id="converter-system" className="w-[280px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>House design</SelectItem>
                      {systems.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* The design pass, beside the design system, because they are
                  the two halves of one answer: the system decides how a KPI
                  strip looks and this decides whether the chapter has one.

                  It opens on "Write the connective tissue" rather than the
                  strictest setting. Under Keep the words the model may not
                  write a single new sentence, so a source line like
                  "Stressed: $787,477" survives verbatim under a sentence that
                  already said it, and a real conversion read as a transcript
                  rather than a report. Keep the words is still one click away
                  and is still what an unrecognised request falls back to. */}
              <div className="space-y-1.5">
                <Label htmlFor="converter-fidelity">Design pass</Label>
                <Select
                  value={fidelity}
                  onValueChange={(v) => { setFidelity(v as ConversionFidelity); setResult(null); }}
                >
                  <SelectTrigger id="converter-fidelity" className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIDELITY_CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Draft furniture is right up to the moment somebody has decided
                  the binding is correct, and wrong from then on. The default is
                  off, because the safe reading of an unset flag on a document
                  that might reach a client is the loud one. */}
              <div className="flex items-center gap-2 self-end pb-2">
                <Switch
                  id="converter-final"
                  checked={final}
                  onCheckedChange={(v) => { setFinal(v); setResult(null); }}
                />
                <Label htmlFor="converter-final" className="cursor-pointer">
                  Print as a finished document
                </Label>
              </div>

              {/* Authoring a design system is hidden product-wide — see
                  `designControlsVisibility.ts`. Both doors are inside the one
                  guard: the in-flow dialog, and the link to the Brand systems
                  page, which is hidden by the same switch (a door to a hidden
                  page is worse than no door). SELECTING an existing system is
                  deliberately outside the guard — the converter needs one to
                  convert, and it still has every system already saved. */}
              {REPORT_DESIGN_CONTROLS_VISIBLE && (
                <>
                  <Button variant="outline" onClick={() => setSystemDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New design system
                  </Button>

                  <Button variant="ghost" asChild>
                    <Link to={BRAND_SYSTEMS_PATH}>
                      <Palette className="mr-2 h-4 w-4" aria-hidden />
                      Manage brand systems
                    </Link>
                  </Button>
                </>
              )}

              <Button onClick={handleRender} disabled={rendering}>
                {rendering
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Palette className="mr-2 h-4 w-4" />}
                {rendering ? 'Converting…' : result ? 'Render again' : 'Convert and save the PDF'}
              </Button>
            </div>

            {/* Where it lands, said before it is clicked rather than after. */}
            {!result && (
              <p className="text-xs text-muted-foreground">
                The PDF appears below and is kept in <span className="font-medium">Earlier
                conversions</span> at the bottom of this page.
              </p>
            )}

            {/* A failed read says so. Returning an empty list instead is what
                made "the query was refused" indistinguishable from "nobody has
                made one yet" — the document still renders, in the house
                design, and that is worth saying out loud rather than
                discovering from the cover. */}
            {systemsError && (
              <Alert>
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Design systems could not be loaded</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>Converting now will use the house design.</span>
                  <Button size="sm" variant="outline" onClick={() => refetchSystems()}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {selectedSystem && (
              <p className="text-xs text-muted-foreground">
                {selectedSystem.description || 'No description.'}
                {selectedSystem.origin === 'generated' ? ' · Drafted by Claude' : ''}
              </p>
            )}

            {/* What the chosen pass will do, in the words somebody choosing it
                needs. The figures line repeats at every level on purpose: "will
                my client's numbers change?" is the only question anyone has and
                it should not depend on which option is selected to find the
                answer. */}
            {(() => {
              const choice = FIDELITY_CHOICES.find((c) => c.value === fidelity);
              return choice ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{choice.label}.</span>{' '}
                  {choice.body} {choice.figures}
                </p>
              ) : null;
            })()}

            {result && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Check className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium">
                      {result.fileName} · {result.pageCount ?? '?'} pages · set in {result.designSystemName}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = previewUrl ?? result.url;
                        a.download = result.fileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                    {/* No "Re-render" here — the button above already flips to
                        "Render again" and does exactly this. Two controls for
                        one action is how a page starts feeling crowded. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleMaterialise}
                      disabled={materialising || create.isPending}
                    >
                      {materialising || create.isPending
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <PencilRuler className="mr-2 h-4 w-4" />}
                      Open as an editable template
                    </Button>
                  </div>

                  {/* Said plainly, because the two artefacts are not the same
                      thing and somebody will otherwise expect the editable copy
                      to look like the PDF. */}
                  <p className="text-xs text-muted-foreground">
                    The PDF is the finished document. An editable template is a working copy of its
                    words — the chapters laid out as text you can rearrange, not a reproduction of
                    this design. Its page breaks are estimated from the text, so a page may run long
                    until you adjust it.
                  </p>

                  {/* Whether a model designed this, said on the screen.
                      "Is the converter running this through Claude at all?" was
                      a question that could not be answered from the page — the
                      honest answer was "for the transcription yes, for the
                      design no", and nothing said either. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={result.enrichedChapters > 0 ? 'default' : 'outline'}>
                      {result.enrichedChapters > 0
                        ? `${result.enrichedChapters} of ${result.attemptedChapters} chapters designed`
                        : 'No chapter was designed'}
                    </Badge>
                    <Badge variant="outline">{fidelityLabel(result.fidelity)}</Badge>
                    {result.enrichmentModel && (
                      <Badge variant="outline">{result.enrichmentModel}</Badge>
                    )}
                    {Object.entries(result.blockCounts)
                      .filter(([kind]) => kind !== 'prose')
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, n]) => (
                        <Badge key={kind} variant="outline">{n} {kind}</Badge>
                      ))}
                  </div>

                  {/* Every guard rejection and fallback, rather than a silent
                      one. A chapter that fell back to flat prose because it
                      invented a figure is the most useful thing this screen can
                      tell somebody, and it is invisible in the PDF. */}
                  {result.enrichmentNotes.length > 0 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {result.enrichmentNotes.length} note
                        {result.enrichmentNotes.length === 1 ? '' : 's'} from the design pass
                      </summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {result.enrichmentNotes.map((note, i) => <li key={i}>{note}</li>)}
                      </ul>
                    </details>
                  )}

                  {result.bandNote.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>Longer than this format usually runs</AlertTitle>
                      <AlertDescription>
                        {result.bandNote.join(' ')} A converted draft carries appendix chapters the
                        format never has, so this is worth knowing rather than an error.
                      </AlertDescription>
                    </Alert>
                  )}

                  {result.brandGaps.length > 0 && (
                    <Alert>
                      <TriangleAlert className="h-4 w-4" />
                      <AlertTitle>The brand snapshot was incomplete</AlertTitle>
                      <AlertDescription>{result.brandGaps.join('; ')}</AlertDescription>
                    </Alert>
                  )}

                  {previewUrl && (
                    <iframe
                      title={`${result.fileName} preview`}
                      src={previewUrl}
                      className="h-[70vh] w-full rounded-md border"
                    />
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Always here, not only after a render.
          This is the answer to "where will the output be rendered": the newest
          row is the document you just made, and it is still here tomorrow. */}
      <Card>
        <CardContent className="pt-6">
          <RecentConversions />
        </CardContent>
      </Card>

      {/* Guarded here too, so the hidden feature mounts nothing at all. */}
      {REPORT_DESIGN_CONTROLS_VISIBLE && (
      <BrandDesignSystemDialog
        open={systemDialogOpen}
        onOpenChange={setSystemDialogOpen}
        companyName={whitelabel ?? ''}
        onSaved={(summary) => {
          // Seeded before the refetch, not after. The refetch is a round trip
          // and the selection happens on this tick; without the seed the newly
          // saved system is selected while absent from the list, which Radix
          // renders as an empty trigger.
          queryClient.setQueryData<BrandDesignSystemSummary[]>(
            ['brand-design-systems'],
            (prev) => [summary, ...(prev ?? []).filter((s) => s.id !== summary.id)],
          );
          queryClient.invalidateQueries({ queryKey: ['brand-design-systems'] });
          setDesignSystemId(summary.id);
          setResult(null);
        }}
      />
      )}
    </div>
  );
}

/**
 * Creating a brand design system from the UI.
 *
 * Two ways in, one way out. A person either sets the levers themselves or gives
 * Claude a brief and edits what comes back — and in both cases the thing being
 * saved is the same `BrandDesignSystem`, read by the same reader and cleared by
 * the same contrast audit. There is no "generated" path that skips a check the
 * authored path has to pass.
 *
 * ## The audit runs before saving, not after
 *
 * `resolveReportPalette` corrects the two accent roles against the worst ground
 * each prints on, and `auditPaletteContrast` then checks every ink role against
 * every ground. Both run on the server — the same modules the renderer uses —
 * so what this dialog shows is what the document will actually do, rather than
 * a browser-side approximation that can disagree with it.
 *
 * A system that fails cannot be saved. Nudging the hue until it passes would
 * hand somebody a colour nobody chose under a name that says it was designed
 * for them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Check, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  type BrandDesignSystem,
  MAX_BRIEF_CHARS,
  readBrandDesignSystem,
  slugify,
} from '@/lib/brandDesign/system.pure';
import { DEFAULT_REPORT_DESIGN_OPTIONS } from '@/lib/reportDesign/options.pure';
import { type BrandDesignSystemSummary, MIN_BRIEF_CHARS } from '@/lib/brandDesign/route.pure';
import {
  auditDesignSystem,
  type BrandDesignSystemResult,
  generateDesignSystem,
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
import type { ReportDesignOptions } from '@/lib/reportDesign/options.pure';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';

const BLANK: BrandDesignSystem = {
  name: '',
  slug: '',
  description: '',
  brandHex: null,
  options: { ...DEFAULT_REPORT_DESIGN_OPTIONS },
  origin: 'authored',
  brief: '',
  neutrals: null,
  sourceNamespace: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The saved system, in picker shape.
   *
   * The whole summary rather than an id, so the caller can seed its cache and
   * select the system on the same tick. Handing back only an id meant selecting
   * something that was not yet in the list, which renders as an empty control.
   */
  onSaved: (summary: BrandDesignSystemSummary) => void;
  /** Printed into the prompt so a generated system knows whose documents these are. */
  companyName: string;
}

/** A labelled dropdown, because five of these in a row is five of the same thing. */
function OptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<LabelledOption<T>>;
  onChange: (v: T) => void;
}) {
  const hint = options.find((o) => o.value === value)?.hint ?? '';
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground leading-snug">{hint}</p>
    </div>
  );
}

export function BrandDesignSystemDialog({ open, onOpenChange, onSaved, companyName }: Props) {
  const [system, setSystem] = useState<BrandDesignSystem>(BLANK);
  const [hexDraft, setHexDraft] = useState('');
  const [brief, setBrief] = useState('');
  const [audit, setAudit] = useState<BrandDesignSystemResult['audit'] | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Every audit carries the request that asked for it, so a slow reply for an
  // old colour cannot overwrite the verdict on the current one. Without this a
  // person dragging a slider sees the audit flicker backwards.
  const auditSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setSystem(BLANK);
    setHexDraft('');
    setBrief('');
    setAudit(null);
    setAuditError(null);
  }, [open]);

  const setOptions = useCallback((patch: Partial<ReportDesignOptions>) => {
    setSystem((prev) => ({ ...prev, options: { ...prev.options, ...patch } }));
  }, []);

  const hexValid = !hexDraft || BRAND_HEX_PATTERN.test(hexDraft);

  // Only the colour and the preset decide the palette. Keying the effect on the
  // whole system re-audits on every keystroke of the name, which is a round trip
  // per character for a verdict that cannot change.
  const preset = system.options.preset;

  // Debounced, because a person setting up a system touches both repeatedly.
  useEffect(() => {
    if (!open) return;
    if (!hexValid) { setAudit(null); return; }
    const candidate: BrandDesignSystem = {
      ...BLANK,
      // The audit needs a legal system to read, and a half-typed name is not
      // one. The name has no bearing on contrast.
      name: 'Draft',
      options: { ...DEFAULT_REPORT_DESIGN_OPTIONS, preset },
      brandHex: hexDraft ? hexDraft.toUpperCase() : null,
    };
    const seq = auditSeq.current + 1;
    auditSeq.current = seq;
    const timer = setTimeout(() => {
      setAuditing(true);
      auditDesignSystem(candidate)
        .then((r) => { if (auditSeq.current === seq) { setAudit(r.audit); setAuditError(null); } })
        .catch((e: Error) => { if (auditSeq.current === seq) { setAudit(null); setAuditError(e.message); } })
        .finally(() => { if (auditSeq.current === seq) setAuditing(false); });
    }, 350);
    return () => clearTimeout(timer);
  }, [open, hexDraft, hexValid, preset]);

  const swatchStyle = useMemo(
    () => ({ '--converter-swatch': audit?.accentOnPaper ?? 'transparent' } as React.CSSProperties),
    [audit?.accentOnPaper],
  );
  const paperStyle = useMemo(
    () => ({ '--converter-swatch': audit?.paper ?? 'transparent' } as React.CSSProperties),
    [audit?.paper],
  );
  const fieldStyle = useMemo(
    () => ({ '--converter-swatch': audit?.field ?? 'transparent' } as React.CSSProperties),
    [audit?.field],
  );

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateDesignSystem(brief, companyName);
      setSystem(result.system);
      setHexDraft(result.system.brandHex ?? '');
      setAudit(result.audit);
      setAuditError(null);
      toast.success(`Drafted "${result.system.name}"`, {
        description: 'Edit anything you disagree with, then save it.',
      });
    } catch (e) {
      toast.error('Could not draft a design system', { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    const candidate: BrandDesignSystem = {
      ...system,
      brandHex: hexDraft ? hexDraft.toUpperCase() : null,
      brief: system.origin === 'generated' ? brief || system.brief : '',
    };
    // The same reader the route uses, run here first so a missing name is a
    // sentence rather than a round trip.
    const read = readBrandDesignSystem(candidate);
    if (read.ok === false) { toast.error(read.error); return; }

    setSaving(true);
    try {
      const result = await saveDesignSystem(read.system);
      toast.success(`Saved "${result.system.name}"`);
      onSaved({
        id: result.id ?? '',
        name: result.system.name,
        slug: result.slug,
        description: result.system.description,
        origin: result.system.origin,
        brandHex: result.system.brandHex,
        isActive: true,
        updatedAt: new Date().toISOString(),
        neutrals: result.system.neutrals,
        sourceNamespace: result.system.sourceNamespace,
        options: result.system.options,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error('Could not save the design system', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const briefTooShort = brief.trim().length < MIN_BRIEF_CHARS;
  const canSave = !saving && system.name.trim().length >= 2 && hexValid && audit?.ok === true;

  // Authoring a design system is hidden product-wide
  // (designControlsVisibility.ts). The refusal lives here rather than only at
  // the call site so a future mount inherits the decision. Selecting an
  // EXISTING system is untouched — the converter still needs one to convert.
  if (!REPORT_DESIGN_CONTROLS_VISIBLE) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New brand design system</DialogTitle>
          <DialogDescription>
            A saved position on the report design system — a brand colour and a set of typographic
            decisions. Every converted template and every migrated report format can be set in it.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="author">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="author">Set it myself</TabsTrigger>
            <TabsTrigger value="brief">Draft it from a brief</TabsTrigger>
          </TabsList>

          <TabsContent value="brief" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="brand-brief">The brief</Label>
              <Textarea
                id="brand-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value.slice(0, MAX_BRIEF_CHARS))}
                placeholder={BRIEF_EXAMPLES[0]}
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Say what the documents are for and who reads them. The levers are chosen from that;
                the colour is treated as a request for a hue, and its contrast is re-derived
                regardless of what comes back.
              </p>
            </div>
            <Button onClick={handleGenerate} disabled={generating || briefTooShort}>
              {generating
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Sparkles className="mr-2 h-4 w-4" />}
              {generating ? 'Drafting…' : 'Draft a design system'}
            </Button>
            {briefTooShort && brief.length > 0 && (
              <p className="text-xs text-muted-foreground">
                A few more words — at least {MIN_BRIEF_CHARS} characters.
              </p>
            )}
          </TabsContent>

          <TabsContent value="author" className="pt-4" />
        </Tabs>

        <Separator />

        {/* The form below is shared: a generated system lands in it and is edited
            here, so there is one set of controls rather than two that drift. */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Name</Label>
            <Input
              id="brand-name"
              value={system.name}
              onChange={(e) => setSystem((p) => ({ ...p, name: e.target.value.slice(0, 80) }))}
              placeholder="Warm Editorial"
            />
            {system.name.trim().length >= 2 && (
              <p className="text-xs text-muted-foreground">
                Handle: <code>{slugify(system.name)}</code>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-hex">Brand colour</Label>
            <div className="flex items-center gap-2">
              <span
                className="converter-swatch h-9 w-9 shrink-0 rounded-md border"
                style={swatchStyle}
                aria-hidden
              />
              <Input
                id="brand-hex"
                value={hexDraft}
                onChange={(e) => setHexDraft(e.target.value.trim())}
                placeholder="Leave blank for the house brand"
                aria-invalid={!hexValid}
              />
            </div>
            {/* No example hex in the message below: the style ratchet counts a
                hex literal in a component as a hardcoded colour, and it is not
                wrong to — the shape is the useful part, and the swatches under
                the field are the example. */}
            {!hexValid && (
              <p className="text-xs text-destructive">
                A hash followed by six hex digits. Pick one below to start from.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SUGGESTED_BRAND_HEXES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => setHexDraft(s.hex)}
                  className="converter-swatch h-6 w-6 rounded border transition-transform hover:scale-110"
                  style={{ '--converter-swatch': s.hex } as React.CSSProperties}
                  title={`${s.name} · ${s.hex}`}
                  aria-label={s.name}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="brand-description">What it is for</Label>
            <Input
              id="brand-description"
              value={system.description}
              onChange={(e) => setSystem((p) => ({ ...p, description: e.target.value.slice(0, 400) }))}
              placeholder="Client-facing strategy documents. Long-form, read on paper."
            />
          </div>

          <OptionSelect
            label="Preset"
            value={system.options.preset}
            options={PRESET_OPTIONS}
            onChange={(preset) => setOptions({ preset })}
          />
          <OptionSelect
            label="Density"
            value={system.options.density}
            options={DENSITY_OPTIONS}
            onChange={(density) => setOptions({ density })}
          />
          <OptionSelect
            label="Chapter openers"
            value={system.options.chapterStyle}
            options={CHAPTER_STYLE_OPTIONS}
            onChange={(chapterStyle) => setOptions({ chapterStyle })}
          />
          <OptionSelect
            label="Tables"
            value={system.options.tableStyle}
            options={TABLE_STYLE_OPTIONS}
            onChange={(tableStyle) => setOptions({ tableStyle })}
          />
          <OptionSelect
            label="Cover"
            value={system.options.coverStyle}
            options={COVER_STYLE_OPTIONS}
            onChange={(coverStyle) => setOptions({ coverStyle })}
          />

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Body size — {system.options.bodyScale}%
              </Label>
              <Slider
                value={[system.options.bodyScale]}
                min={85}
                max={115}
                step={1}
                onValueChange={([bodyScale]) => setOptions({ bodyScale })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Visual intensity — {system.options.visualIntensity}
              </Label>
              <Slider
                value={[system.options.visualIntensity]}
                min={0}
                max={100}
                step={1}
                onValueChange={([visualIntensity]) => setOptions({ visualIntensity })}
              />
              <p className="text-xs text-muted-foreground leading-snug">
                Panel tints and band weight. It never changes type colour — an invisible eyebrow
                is not a style.
              </p>
            </div>
          </div>

          <div className="md:col-span-2 flex flex-wrap gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={system.options.showSectionNumbers}
                onCheckedChange={(showSectionNumbers) => setOptions({ showSectionNumbers })}
              />
              Section numbers
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={system.options.justifyText}
                onCheckedChange={(justifyText) => setOptions({ justifyText })}
              />
              Justified text
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={system.options.showDropCaps}
                onCheckedChange={(showDropCaps) => setOptions({ showDropCaps })}
              />
              Drop caps
            </label>
          </div>
        </div>

        {/* ── The verdict ───────────────────────────────────────────────── */}

        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-2">
            {auditing
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : audit?.ok
                ? <Check className="h-4 w-4 text-success" />
                : <AlertTriangle className="h-4 w-4 text-destructive" />}
            <span className="text-sm font-medium">
              {auditing
                ? 'Checking contrast…'
                : audit?.ok
                  ? 'Every ink role clears its floor on every ground it prints on'
                  : audit
                    ? 'This system cannot be made legible'
                    : auditError ?? 'Set a name and a colour to check contrast'}
            </span>
          </div>

          {audit && !audit.ok && (
            <p className="text-sm text-muted-foreground">{audit.summary}</p>
          )}

          {audit && (
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="converter-swatch h-4 w-4 rounded border" style={paperStyle} aria-hidden />
                <span className="text-xs text-muted-foreground">Paper</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="converter-swatch h-4 w-4 rounded border" style={fieldStyle} aria-hidden />
                <span className="text-xs text-muted-foreground">Field</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="converter-swatch h-4 w-4 rounded border" style={swatchStyle} aria-hidden />
                <span className="text-xs text-muted-foreground">
                  Accent{audit.accentOnPaper !== (hexDraft || '').toUpperCase() && hexDraft
                    ? ' (corrected for contrast)'
                    : ''}
                </span>
              </div>
              {system.origin === 'generated' && <Badge variant="secondary">Drafted by Claude</Badge>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save design system
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

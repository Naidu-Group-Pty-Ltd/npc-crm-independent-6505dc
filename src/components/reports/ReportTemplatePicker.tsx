/**
 * Choose the template a report format is generated with — by looking at it.
 *
 * ## Why this dialog exists
 *
 * A template reached a document by ranking alone — `resolve_report_template()`
 * sorted the active rows and took the first — and the only surface in the
 * product that touched templates was the Template Builder. So "use this
 * template for my Investment reports" meant opening an editor, forking a
 * working copy and hoping the ranking landed on it. This is the chooser that
 * was missing. It navigates nowhere.
 *
 * ## The design is the picture, so the picture does the choosing
 *
 * The first version of this dialog was sixty radio rows of names — ten
 * families × five layouts, plus the individual designs — and a name is the one
 * thing a design cannot be ranked by. Every choice now leads with its real
 * first page (`TemplateDocumentPreview`, the same renderer the customer's PDF
 * goes through), and the catalogue is arranged the way a person compares:
 *
 * - **Families first.** One tile per design family — ten visually different
 *   documents — never five variants of the same family stacked above the next
 *   family's first appearance. Opening a family reveals its layout variants
 *   and its curated colourways, and choosing a colourway repaints every sheet
 *   in the tray, so "Oxblood or Platinum?" is answered by watching.
 * - **Then the individual designs**, each with its own face.
 * - **Active rows with no library lineage** (hand-built templates, the
 *   Compass pilot) get a face too: their page one is fetched — lazily, page
 *   one and tokens only, never the whole schema — when the dialog opens.
 *
 * ## The library IS the choice, not a place the choice points at
 *
 * Picking a library design asks the server for a *selectable* copy
 * (`use_for_reports` — active, approved, user-scoped, idempotent on
 * entry + version + colourway) and stores it as the selection in one flow. The
 * seeded house masters are found by lineage before any copy is made, so
 * adopting the default never mints a private duplicate. An existing selection
 * is followed: its family opens pre-expanded with the design checked and
 * badged, and the choice can always be changed or returned to automatic.
 *
 * ## What it will and will not claim
 *
 * Active rows with no library lineage are still listed and still selectable.
 * A template whose engine is not WeasyPrint says on its face that it produces
 * the legacy document — it is selectable because it is what the ranking would
 * have picked anyway.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { assessTemplateFit, templateFitCaveat } from '@/lib/reportTemplate/templateFormatFit.pure';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, ChevronDown, Layers, Loader2, TriangleAlert, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';
import { useAdoptForReports, useTemplateLibraryEntries } from '@/hooks/useTemplateLibrary';
import {
  fetchActiveTemplatePreviewPages,
  normaliseReportType,
  templateRendersThroughDesignSystem,
  type SelectableTemplateRow,
} from '@/lib/reportTemplate/templateSelection';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';
import {
  axisLabel, colourwayOverridesFor, entryColourways, entryDefaultColourwayId,
} from '@/lib/templateLibrary/entryDesign';
import { ColourwaySwatch } from '@/components/templateLibrary/TemplateColourwayPicker';
import { ReportTemplateSheet } from '@/components/reports/ReportTemplateSheet';

/** The sentinel for "no fixed template" — the resolver's ranking decides. */
const AUTOMATIC = '__automatic__';
/** Radio value for a library design: `lib:<entryId>`. Colourway rides beside it. */
const libValue = (entryId: string) => `lib:${entryId}`;

interface Props {
  /** Any spelling of the format; it is normalised before anything is stored. */
  reportType: string;
  /** What to call the format on screen. */
  formatLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A design family's entries, in the approved variant order (A first). */
interface FamilyGroup {
  key: string;
  name: string;
  note: string | null;
  defaultColourwayId: string | null;
  entries: TemplateLibraryListEntry[];
}

function groupByFamily(entries: TemplateLibraryListEntry[]): {
  families: FamilyGroup[];
  loose: TemplateLibraryListEntry[];
} {
  const families = new Map<string, FamilyGroup>();
  const loose: TemplateLibraryListEntry[] = [];
  for (const entry of entries) {
    const meta = entry.designMeta;
    if (!meta?.familyKey) { loose.push(entry); continue; }
    let group = families.get(meta.familyKey);
    if (!group) {
      group = {
        key: meta.familyKey,
        name: meta.familyName || meta.familyKey,
        note: meta.familyNote || null,
        defaultColourwayId: entryDefaultColourwayId(entry),
        entries: [],
      };
      families.set(meta.familyKey, group);
    }
    group.entries.push(entry);
  }
  for (const group of families.values()) {
    group.entries.sort((a, b) =>
      String(a.designMeta?.variantAxis ?? '').localeCompare(String(b.designMeta?.variantAxis ?? '')));
  }
  return {
    families: [...families.values()].sort((a, b) => a.name.localeCompare(b.name)),
    loose: loose.sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

/** The active row this (entry, colourway) already exists as, if any. */
function candidateForEntry(
  candidates: SelectableTemplateRow[],
  entry: TemplateLibraryListEntry,
  colourwayId: string | null,
): SelectableTemplateRow | null {
  return candidates.find((row) => {
    const lineage = row.libraryLineage;
    if (!lineage?.entryId) return false;
    return lineage.entryId === entry.id
      && Number(lineage.entryVersion ?? -1) === Number(entry.version ?? -2)
      && ((lineage.colourway ?? null) === (colourwayId ?? null));
  }) ?? null;
}

/**
 * One choosable design, led by its sheet.
 *
 * The tile is a `<label>` around its radio, so the whole face is the hit
 * target; the radio stays visible in the caption row because it is the only
 * focus indicator the tile needs and it says "this is a choice" — the family
 * tiles beside these open a tray instead, and the two must not look
 * interchangeable.
 */
function ChoiceTile({
  value, checked, sheet, title, meta, badges,
}: {
  value: string;
  checked: boolean;
  sheet: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-lg border transition',
        checked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40',
      )}
    >
      {sheet}
      <span className="flex min-w-0 flex-1 flex-col gap-1 border-t border-border/60 px-2.5 pb-2.5 pt-2">
        <span className="flex items-start gap-2">
          <RadioGroupItem value={value} className="mt-0.5 shrink-0" aria-label={title} />
          <span className="min-w-0 text-[13px] font-medium leading-snug">{title}</span>
        </span>
        {(badges || meta) && (
          <span className="flex flex-wrap items-center gap-1.5 pl-6">
            {badges}
            {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
          </span>
        )}
      </span>
    </label>
  );
}

export function ReportTemplatePicker({ reportType, formatLabel, open, onOpenChange }: Props) {
  const { state, isLoading, error, isSaving, select, clear } = useReportTemplateSelection(reportType);
  const adopt = useAdoptForReports();
  const library = useTemplateLibraryEntries({ enabled: open });
  const [choice, setChoice] = useState<string>(AUTOMATIC);
  // One colourway per family, keyed by familyKey. Missing key = family default.
  const [colourwayByFamily, setColourwayByFamily] = useState<Record<string, string>>({});
  // Which family's tray is open. Families are compared as covers first; a
  // family's five layouts appear only once it is opened, which is the ordering
  // this dialog exists to fix — variants never crowd out the next family.
  const [openFamilyKey, setOpenFamilyKey] = useState<string | null>(null);
  // A design whose vocabulary this format does not publish is composed around
  // the report at render time — its empty pages left out, another design's
  // body spliced in under its palette. That used to be announced by a toast
  // raised after the PDF existed. It is asked here instead, before anything
  // is made, and the answer is remembered only for the design it was given
  // for.
  const [consentedChoice, setConsentedChoice] = useState<string | null>(null);

  const format = normaliseReportType(reportType);

  /** The library's production designs for this format, grouped by family. */
  const { families, loose } = useMemo(() => {
    const entries = (library.data ?? []).filter((entry) =>
      normaliseReportType(entry.reportType) === format
      && entry.status === 'published'
      && entry.compatibility.productionReady
      && entry.compatibility.engine === 'weasyprint');
    return groupByFamily(entries);
  }, [library.data, format]);

  const candidates = state?.candidates ?? [];
  const libraryEntryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of families) for (const entry of group.entries) ids.add(entry.id);
    for (const entry of loose) ids.add(entry.id);
    return ids;
  }, [families, loose]);

  // Active rows that descend from a listed design are represented BY that
  // design's row — listing them twice would make one choice look like two.
  // Everything else (hand-built templates, the Compass pilot, copies of
  // designs the library no longer lists) stays in its own section.
  const standaloneCandidates = useMemo(
    () => candidates.filter((row) =>
      !row.libraryLineage?.entryId || !libraryEntryIds.has(row.libraryLineage.entryId)),
    [candidates, libraryEntryIds],
  );

  // Standalone rows carry no `preview_schema`, so their faces are fetched —
  // page one and tokens only, on open, and only when there is a face to fetch.
  // A failed read degrades those tiles to the empty sheet; it never blocks the
  // chooser, and the library designs above it keep their previews regardless.
  const standalonePreviews = useQuery({
    queryKey: ['report-template-selection', 'active-previews'],
    queryFn: fetchActiveTemplatePreviewPages,
    enabled: open && standaloneCandidates.length > 0,
    staleTime: 5 * 60_000,
  });

  /** The family holding the house default, drawn first in the gallery. */
  const houseDefaultFamilyKey = useMemo(() => {
    const row = candidates.find((c) => c.is_default && c.libraryLineage?.familyKey);
    const key = row?.libraryLineage?.familyKey ?? null;
    return key && families.some((g) => g.key === key) ? key : null;
  }, [candidates, families]);

  const orderedFamilies = useMemo(() => {
    if (!houseDefaultFamilyKey) return families;
    return [...families].sort((a, b) => {
      if (a.key === houseDefaultFamilyKey) return -1;
      if (b.key === houseDefaultFamilyKey) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [families, houseDefaultFamilyKey]);

  /** What the stored selection means in this dialog's vocabulary. */
  const storedChoice = useMemo(() => {
    if (state?.status !== 'selected' || !state.selectedTemplateId) return AUTOMATIC;
    const lineage = state.template?.libraryLineage;
    if (lineage?.entryId && libraryEntryIds.has(lineage.entryId)) return libValue(lineage.entryId);
    return state.selectedTemplateId;
  }, [state?.status, state?.selectedTemplateId, state?.template, libraryEntryIds]);

  const storedFamilyKey = useMemo(() => {
    if (state?.status !== 'selected') return null;
    const key = state.template?.libraryLineage?.familyKey ?? null;
    return key && families.some((g) => g.key === key) ? key : null;
  }, [state?.status, state?.template, families]);

  // Re-seed from the server every time it opens, so a dialog dismissed without
  // saving never carries a phantom choice into the next viewing. The stored
  // selection's colourway seeds its family's swatch, and its family opens
  // pre-expanded, so "what you have" is on screen before anything is touched.
  //
  // Once per opening, and only once the answers have landed. The library
  // query is `enabled: open`, so `storedChoice` provably changes value AFTER
  // the dialog is interactive — automatic, then the raw row id, then
  // `lib:<entryId>` as the library resolves — and this effect's dependency
  // array used to include it. Each transition re-ran the seed over whatever
  // the person had done: a tile clicked in that window was reverted, the tray
  // they opened was closed and the stored family's reopened, and their
  // colourway was overwritten by the stored one.
  //
  // What stops it is a TOUCH, not a load. Gating on "both queries have landed"
  // was the first attempt and it is wrong in the same direction: a person who
  // clicks while the library is still resolving is still overwritten when it
  // lands. Gating on "seed once at open" is wrong in the other direction — the
  // stored choice resolves after the dialog is interactive, so the dialog
  // would open on "Choose automatically" for somebody who has a choice. So the
  // seed keeps following the server until the person touches something, and
  // never afterwards.
  const touched = useRef(false);
  useEffect(() => { if (!open) touched.current = false; }, [open]);
  useEffect(() => {
    if (!open || touched.current) return;
    setConsentedChoice(null);
    setChoice(storedChoice);
    setOpenFamilyKey(storedFamilyKey);
    const lineage = state?.status === 'selected' ? state.template?.libraryLineage : null;
    if (lineage?.familyKey && lineage.colourway) {
      setColourwayByFamily((prev) => ({ ...prev, [lineage.familyKey!]: lineage.colourway! }));
    }
  }, [open, storedChoice, storedFamilyKey, state]);

  /** Every control that changes a choice says so, so the seed stops following. */
  const chooseTemplate = (value: string) => { touched.current = true; setChoice(value); };

  // Opening a family from the gallery's second row would otherwise reveal its
  // tray below the fold — a click that appears to do nothing. `nearest` keeps
  // the gallery still when the tray is already visible.
  useEffect(() => {
    if (!openFamilyKey) return;
    const el = document.getElementById(`family-tray-${openFamilyKey}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [openFamilyKey]);

  const colourwayFor = (group: FamilyGroup): string | null =>
    colourwayByFamily[group.key] ?? group.defaultColourwayId;

  /** Null when the family default is chosen — "the authored palette, unbaked". */
  const normalisedColourway = (group: FamilyGroup | null, entry: TemplateLibraryListEntry): string | null => {
    if (!group) return null;
    const chosen = colourwayFor(group);
    return chosen && chosen !== entryDefaultColourwayId(entry) ? chosen : null;
  };

  const entryById = useMemo(() => {
    const map = new Map<string, { entry: TemplateLibraryListEntry; group: FamilyGroup | null }>();
    for (const group of families) for (const entry of group.entries) map.set(entry.id, { entry, group });
    for (const entry of loose) map.set(entry.id, { entry, group: null });
    return map;
  }, [families, loose]);

  // An unavailable selection is ALWAYS a change worth saving. It collapses to
  // `AUTOMATIC` above, so choosing "Choose automatically" left `unchanged`
  // true and Save disabled — while the alert on screen asked the reader to
  // pick another. The orphan row stayed, and so did the alert.
  const unchanged = state?.status !== 'unavailable' && choice === storedChoice && (() => {
    // A library choice is also its colourway: the same design in a different
    // palette is a different document.
    if (!choice.startsWith('lib:')) return true;
    const found = entryById.get(choice.slice(4));
    if (!found) return true;
    const storedColourway = state?.status === 'selected'
      ? state.template?.libraryLineage?.colourway ?? null
      : null;
    return normalisedColourway(found.group, found.entry) === storedColourway;
  })();

  /** What the chosen design's own declared bindings say about this format. */
  const chosenFit = useMemo(() => {
    if (!choice.startsWith('lib:')) return null;
    const found = entryById.get(choice.slice(4));
    if (!found) return null;
    const reading = assessTemplateFit(found.entry.compatibility.requiredBindings, normaliseReportType(reportType) ?? reportType);
    const caveat = templateFitCaveat(reading, formatLabel);
    return caveat ? { reading, caveat } : null;
  }, [choice, entryById, reportType, formatLabel]);
  const needsConsent = !!chosenFit && consentedChoice !== choice;

  const busy = isSaving || adopt.isPending;

  const save = async () => {
    // Nothing is produced until the substitution has been agreed to. The
    // caveat and its "Use it anyway" sit in the footer, so the question and
    // the answer are in one place.
    if (needsConsent) return;
    try {
      if (choice === AUTOMATIC) {
        await clear();
        toast.success(`${formatLabel} reports will use the default template again.`);
      } else if (choice.startsWith('lib:')) {
        const found = entryById.get(choice.slice(4));
        if (!found) {
          // This used to `return` with no toast, no close and no state
          // change, so any drift between the checked tile and the loaded
          // library — a background refetch, a deprecation, a read that failed
          // after the tile was drawn — turned Save into a button that does
          // nothing at all.
          toast.error('That design is no longer in the library. Reopen the chooser and pick again.');
          return;
        }
        const colourwayId = normalisedColourway(found.group, found.entry);
        // An active row that already IS this (design, version, colourway) —
        // the seeded house master, or a copy adopted earlier — is selected
        // directly. Only a genuinely new combination asks the server for one,
        // and the server dedupes again in case another tab got there first.
        const existing = candidateForEntry(candidates, found.entry, colourwayId);
        const templateId = existing?.id
          ?? (await adopt.mutateAsync({ entryId: found.entry.id, colourwayId })).templateId;
        await select(templateId);
        const cwName = colourwayId
          ? entryColourways(found.entry).find((c) => c.id === colourwayId)?.name
          : null;
        toast.success(
          `${formatLabel} reports will now use ${found.entry.name}${cwName ? ` · ${cwName}` : ''}.`,
        );
      } else {
        await select(choice);
        const name = candidates.find((t) => t.id === choice)?.name ?? 'the selected template';
        toast.success(`${formatLabel} reports will now use ${name}.`);
      }
      onOpenChange(false);
    } catch (e) {
      // Selection errors are toasted by the hook; adoption errors are ours to
      // explain — and the current choice still stands, which is the half a
      // person needs to hear.
      if (choice.startsWith('lib:')) {
        toast.error(
          e instanceof Error && e.message
            ? `${e.message} Your current template choice is unchanged.`
            : 'The design could not be prepared. Your current template choice is unchanged.',
        );
      }
      // The dialog stays open so a retry costs nothing and the choice is not lost.
    }
  };

  const isSelectedRow = (entry: TemplateLibraryListEntry, group: FamilyGroup | null): boolean => {
    if (state?.status !== 'selected') return false;
    const lineage = state.template?.libraryLineage;
    if (!lineage || lineage.entryId !== entry.id) return false;
    return (lineage.colourway ?? null) === normalisedColourway(group, entry);
  };

  const openGroup = orderedFamilies.find((g) => g.key === openFamilyKey) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            Pick the design <span className="font-medium text-foreground">{formatLabel}</span>{' '}
            reports are generated with — every tile is that template’s real first page. Your
            choice is kept for every report of this format until you change it here.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-4">
            <Skeleton className="aspect-[3/4]" />
            <Skeleton className="aspect-[3/4]" />
            <Skeleton className="hidden aspect-[3/4] sm:block" />
            <Skeleton className="hidden aspect-[3/4] sm:block" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>We couldn’t load the templates</AlertTitle>
            <AlertDescription>
              {error.message} Reports still generate with the default template in the meantime.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3 py-1">
            {state?.status === 'unavailable' && (
              // A choice that stopped applying is news, and saying nothing would
              // mean documents quietly changing template under someone.
              <Alert variant="default">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Your previous choice is no longer available</AlertTitle>
                <AlertDescription>
                  The template you had chosen has been deactivated or moved to another format,
                  so these reports are using the default again. Pick another below.
                </AlertDescription>
              </Alert>
            )}

            <div data-testid="template-picker-scroll" className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
              <RadioGroup value={choice} onValueChange={chooseTemplate} className="space-y-5">
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
                    choice === AUTOMATIC ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                  )}
                >
                  <RadioGroupItem value={AUTOMATIC} className="mt-1 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Wand2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      Choose automatically
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Use whichever active template ranks highest for this format. This is what
                      happens when nothing is chosen.
                    </span>
                  </span>
                </label>

                {families.length > 0 && (
                  <section className="space-y-2.5" aria-label="Design families">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                        Design families
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {orderedFamilies.length} distinct designs from the Template Library.
                        Open one to choose its layout and colours.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {orderedFamilies.map((group) => {
                        const representative = group.entries[0];
                        const colourways = entryColourways(representative);
                        const isOpen = openFamilyKey === group.key;
                        const holdsCurrent = storedFamilyKey === group.key;
                        const chosenCw = colourwayFor(group);
                        return (
                          <button
                            key={group.key}
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={`family-tray-${group.key}`}
                            onClick={() => {
                              // Opening a family CHOOSES it.
                              //
                              // This tile used to set `openFamilyKey` and
                              // nothing else, while painting itself
                              // `border-primary ring-1 ring-primary` — the
                              // same treatment `ChoiceTile` uses for
                              // `checked` — and carrying a "Current" badge.
                              // So a person who clicked a family, picked a
                              // colourway and pressed Save had changed
                              // nothing `save()` can persist, and the button
                              // was disabled anyway because `choice` had not
                              // moved. The tray still offers the five
                              // layouts; this only makes the family's own
                              // reference layout the standing choice while it
                              // is open, which is what the tile already
                              // looked like it was doing.
                              touched.current = true;
                              const opening = !isOpen;
                              setOpenFamilyKey(opening ? group.key : null);
                              if (opening && representative
                                && !group.entries.some((e) => choice === libValue(e.id))) {
                                setChoice(libValue(representative.id));
                              }
                            }}
                            className={cn(
                              'group flex flex-col overflow-hidden rounded-lg border text-left transition',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                              isOpen ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40',
                            )}
                          >
                            <ReportTemplateSheet
                              schema={representative?.previewSchema ?? null}
                              tokenOverrides={representative
                                ? colourwayOverridesFor(representative, chosenCw)
                                : undefined}
                              pageCount={representative?.pageCount ?? 1}
                              label={`First page of ${group.name}, its reference layout`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-1 border-t border-border/60 px-2.5 pb-2.5 pt-2">
                              <span className="flex items-start justify-between gap-1.5">
                                <span className="min-w-0 text-[13px] font-semibold leading-snug">
                                  {group.name}
                                </span>
                                <ChevronDown
                                  aria-hidden="true"
                                  className={cn(
                                    'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                    isOpen && 'rotate-180',
                                  )}
                                />
                              </span>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Layers className="h-3 w-3" aria-hidden="true" />
                                  {group.entries.length} layout{group.entries.length === 1 ? '' : 's'}
                                  {colourways.length > 1 ? ` · ${colourways.length} colourways` : ''}
                                </span>
                                {group.key === houseDefaultFamilyKey && (
                                  <Badge variant="secondary" className="text-[10px]">House default</Badge>
                                )}
                                {holdsCurrent && <Badge className="text-[10px]">Current</Badge>}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {openGroup && (
                      <div
                        id={`family-tray-${openGroup.key}`}
                        className="space-y-3 rounded-lg border border-primary/40 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{openGroup.name}</span>
                            {openGroup.note && (
                              <span className="block text-xs text-muted-foreground">{openGroup.note}</span>
                            )}
                          </span>
                          {/* The ten colourways, as the catalogue presents them:
                              paper behind, accent in front. Selecting one repaints
                              every sheet in this tray rather than opening anything. */}
                          {entryColourways(openGroup.entries[0]).length > 1 && (
                            <span
                              className="flex flex-wrap items-center gap-1"
                              role="group"
                              aria-label={`Colourway for ${openGroup.name} designs`}
                            >
                              {entryColourways(openGroup.entries[0]).map((c) => {
                                const active = (colourwayFor(openGroup) ?? '') === c.id;
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => {
                                      touched.current = true;
                                      setColourwayByFamily((prev) => ({ ...prev, [openGroup.key]: c.id }));
                                    }}
                                    title={`${c.name} · ${c.ground}`}
                                    aria-label={`${c.name}, ${c.ground} ground`}
                                    aria-pressed={active}
                                    className={cn(
                                      'rounded-[2px] p-[1.5px] transition-shadow',
                                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      active ? 'ring-2 ring-foreground' : 'ring-1 ring-border hover:ring-foreground/40',
                                    )}
                                  >
                                    <ColourwaySwatch colourway={c} size={14} />
                                  </button>
                                );
                              })}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                          {openGroup.entries.map((entry) => {
                            const axis = axisLabel(entry.designMeta?.variantAxis);
                            return (
                              <ChoiceTile
                                key={entry.id}
                                value={libValue(entry.id)}
                                checked={choice === libValue(entry.id)}
                                title={entry.name}
                                sheet={(
                                  <ReportTemplateSheet
                                    schema={entry.previewSchema ?? null}
                                    tokenOverrides={colourwayOverridesFor(entry, colourwayFor(openGroup))}
                                    pageCount={entry.pageCount}
                                    label={`First page of ${entry.name}`}
                                  />
                                )}
                                meta={`${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'}`}
                                badges={(
                                  <>
                                    {axis && (
                                      <Badge variant="outline" className="text-[10px] capitalize">{axis}</Badge>
                                    )}
                                    {!!candidateForEntry(candidates, entry, null)?.is_default && (
                                      <Badge variant="secondary" className="text-[10px]">House default</Badge>
                                    )}
                                    {isSelectedRow(entry, openGroup) && (
                                      <Badge className="text-[10px]">Current</Badge>
                                    )}
                                  </>
                                )}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {loose.length > 0 && (
                  <section className="space-y-2.5" aria-label="Individual designs">
                    <p className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      Individual designs
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {loose.map((entry) => (
                        <ChoiceTile
                          key={entry.id}
                          value={libValue(entry.id)}
                          checked={choice === libValue(entry.id)}
                          title={entry.name}
                          sheet={(
                            <ReportTemplateSheet
                              schema={entry.previewSchema ?? null}
                              pageCount={entry.pageCount}
                              label={`First page of ${entry.name}`}
                            />
                          )}
                          meta={entry.pageCount > 0
                            ? `${entry.pageCount} page${entry.pageCount === 1 ? '' : 's'}`
                            : undefined}
                          badges={(
                            <>
                              {!!candidateForEntry(candidates, entry, null)?.is_default && (
                                <Badge variant="secondary" className="text-[10px]">House default</Badge>
                              )}
                              {isSelectedRow(entry, null) && <Badge className="text-[10px]">Current</Badge>}
                            </>
                          )}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {standaloneCandidates.length > 0 && (
                  <section className="space-y-2.5" aria-label="Other active templates">
                    <p className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      Other active templates
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {standaloneCandidates.map((template) => {
                        const drawn = templateRendersThroughDesignSystem(template);
                        return (
                          <ChoiceTile
                            key={template.id}
                            value={template.id}
                            checked={choice === template.id}
                            title={template.name || 'Untitled template'}
                            sheet={(
                              <ReportTemplateSheet
                                schema={standalonePreviews.data?.get(template.id) ?? null}
                                label={`First page of ${template.name || 'this template'}`}
                              />
                            )}
                            badges={(
                              <>
                                {template.is_default && (
                                  <Badge variant="secondary" className="text-[10px]">House default</Badge>
                                )}
                                {template.scope && template.scope !== 'global' && (
                                  <Badge variant="outline" className="text-[10px] capitalize">{template.scope}</Badge>
                                )}
                                {state?.status === 'selected' && state.selectedTemplateId === template.id && (
                                  <Badge className="text-[10px]">Current</Badge>
                                )}
                                {!drawn && (
                                  // Selectable, and honest: this is what the ranking
                                  // would have picked too, and it produces the legacy
                                  // document either way.
                                  <span className="flex items-start gap-1 text-[11px] text-muted-foreground">
                                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                                    Renders through the standard generator.
                                  </span>
                                )}
                              </>
                            )}
                          />
                        );
                      })}
                    </div>
                  </section>
                )}
              </RadioGroup>

              {library.isLoading && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Skeleton className="aspect-[3/4]" />
                  <Skeleton className="aspect-[3/4]" />
                  <Skeleton className="hidden aspect-[3/4] sm:block" />
                  <Skeleton className="hidden aspect-[3/4] sm:block" />
                </div>
              )}
              {library.error != null && (
                // The library failing to load must not take the chooser down
                // with it: the active templates above are still the truth.
                <p className="text-xs text-muted-foreground">
                  The Template Library couldn’t be reached, so only the active templates are
                  shown. Your current choice is unaffected.
                </p>
              )}
            </div>

            {standaloneCandidates.length === 0 && families.length === 0 && loose.length === 0
              && !library.isLoading && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No templates have been published for {formatLabel} yet, so these reports
                use the standard generator. A design becomes available here once it is
                published to the Template Library.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
          {chosenFit && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-left text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-muted-foreground">{chosenFit.caveat}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {needsConsent ? (
              <Button variant="outline" onClick={() => setConsentedChoice(choice)} disabled={busy || isLoading}>
                Use it anyway
              </Button>
            ) : (
              <Button onClick={save} disabled={busy || unchanged || isLoading || !!error}>
                {busy
                  ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</>
                  : <><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Save choice</>}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

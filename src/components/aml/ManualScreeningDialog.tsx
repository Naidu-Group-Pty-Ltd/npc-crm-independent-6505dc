/**
 * Record a screening the MLRO performed by hand.
 *
 * ── What this is, and what it must never become ───────────────────────
 * This is a second EXECUTION METHOD for a screening the policy already
 * requires. It is not an exemption, it does not touch the obligation, and
 * nothing here can make a required scope `not_required` — the dialog cannot
 * even express that, because it sends no `required` flag and the server
 * derives the obligation from the recorded policy decision rather than from
 * anything a caller says.
 *
 * ── Why the evidence fields are not optional ──────────────────────────
 * "No match" is the claim that a customer does not appear on a sanctions
 * list. Recorded without the sources checked, the names searched and a
 * reason, it is indistinguishable afterwards from a screening that never
 * happened — and it would read as `clear` to every consumer of
 * `screening_checks`. So the same rule is enforced three times: here (early
 * enough to say which field is missing), in the edge function (which never
 * trusts a browser), and by a table constraint (which catches a code path
 * that forgets).
 *
 * The rule is not written three times. `planManualScreening` is the one
 * implementation, imported by both this dialog and the edge function, so the
 * button cannot enable on something the server would refuse.
 *
 * `unable_to_complete` is the honest failure state and is deliberately held
 * to a different bar: it asserts the screening could NOT be concluded, which
 * is the opposite of a claim about the customer. It carries a reason code,
 * it satisfies nothing, and the obligation stays outstanding.
 *
 * ── Why the layout is owned here rather than inherited ────────────────
 * The shared `DialogContent` is a `grid gap-4` that is `max-w-lg` and
 * `sm:overflow-visible`. Widening it with `max-w-2xl` and putting
 * `overflow-y-auto` back on the whole element — which is what this dialog did
 * — produces the worst of both: a 672px column on a 1920px screen, and a
 * single scroll region containing the header, the form AND the footer. On a
 * 1366x768 display the form is roughly three viewports tall, so the submit
 * button sits about two screens below the fold and an operator has to zoom
 * the browser out to work the form at all. Browser zoom is not an input
 * method for a compliance workflow.
 *
 * So this uses the primitive's `bareLayout` escape hatch — which exists for
 * exactly this — and owns three areas: a header and a footer that do not
 * scroll, and a body between them that does (`flex-1 min-h-0`). The width is
 * `min(1100px, 94vw)`, and the form goes multi-column at `lg` so the width is
 * actually used rather than being a wider version of the same tall column.
 * Nothing about what is collected, required or sent changes.
 */
import { useMemo, useState } from "react";
import { ClipboardCheck, Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  amlCasesApi,
  type AmlManualOutcome,
  type AmlManualUnableReason,
  type AmlPartyScreeningSubject,
} from "@/lib/aml/amlCasesApi";
import {
  UNABLE_REASON_TEXT,
  planManualScreening,
  type ManualScreeningRejection,
} from "../../../supabase/functions/_shared/aml/manualScreening.pure";


const OUTCOMES: Array<{ value: AmlManualOutcome; label: string; detail: string }> = [
  {
    value: "no_match",
    label: "No match",
    detail: "The searches ran and the party does not appear. Discharges the "
      + "obligation, so it carries the full evidence record.",
  },
  {
    value: "possible_match",
    label: "Possible match",
    detail: "A candidate needs adjudicating, through the same path an "
      + "automated candidate takes.",
  },
  {
    value: "confirmed_match",
    label: "Confirmed match",
    detail: "The listed party is this party. Recorded as a confirmed match.",
  },
  {
    value: "unable_to_complete",
    label: "Unable to complete",
    detail: "It could not be concluded. Nothing is asserted about the party "
      + "and the obligation stays outstanding.",
  },
];

const SOURCE_TYPES = [
  { value: "sanctions_list", label: "Sanctions list" },
  { value: "regulator_register", label: "Regulator / government register" },
  { value: "court_record", label: "Court or tribunal record" },
  { value: "media_search", label: "Media search" },
  { value: "provider_portal", label: "Provider portal (searched by hand)" },
  { value: "other", label: "Other" },
];

const SCOPES = [
  { value: "sanctions", label: "Sanctions" },
  { value: "adverse_media", label: "Adverse media" },
  { value: "watchlist", label: "Watchlist" },
] as const;

interface SourceRow {
  source_type: string; source_name: string; source_reference: string; searched_at: string;
}
interface CandidateRow {
  matchedName: string; listName: string; jurisdiction: string; reference: string; matchBasis: string;
}

const emptySource = (): SourceRow => ({
  source_type: "sanctions_list", source_name: "", source_reference: "", searched_at: "",
});
const emptyCandidate = (): CandidateRow => ({
  matchedName: "", listName: "", jurisdiction: "", reference: "", matchBasis: "",
});

export function ManualScreeningDialog({
  subject, open, onOpenChange, onRecorded,
}: {
  subject: AmlPartyScreeningSubject;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onRecorded: () => void;
}) {
  const [scope, setScope] = useState<"sanctions" | "adverse_media" | "watchlist">("sanctions");
  const [outcome, setOutcome] = useState<AmlManualOutcome>("no_match");
  const [unableReason, setUnableReason] = useState<AmlManualUnableReason>("insufficient_identity");
  // Pre-filled with the name the case actually screens, because that is the
  // name that was almost certainly searched — and an empty field invites a
  // record that does not say which name was put to the source.
  const [names, setNames] = useState(subject.screened_name);
  const [sources, setSources] = useState<SourceRow[]>([emptySource()]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([emptyCandidate()]);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  const parsedNames = useMemo(
    () => names.split("\n").map((n) => n.trim()).filter(Boolean),
    [names],
  );
  const parsedSources = useMemo(
    () => sources.filter((s) => s.source_name.trim()).map((s) => ({
      source_type: s.source_type,
      source_name: s.source_name.trim(),
      source_reference: s.source_reference.trim() || null,
      searched_at: s.searched_at.trim() || null,
    })),
    [sources],
  );
  const parsedCandidates = useMemo(
    () => candidates.filter((c) => c.matchedName.trim()).map((c) => ({
      matchedName: c.matchedName.trim(),
      listName: c.listName.trim() || null,
      jurisdiction: c.jurisdiction.trim() || null,
      reference: c.reference.trim() || null,
      matchBasis: c.matchBasis.trim() || null,
    })),
    [candidates],
  );

  /*
   * The SAME decision the server will make, from the same module. When this
   * refuses, the message shown is the server's own message — so the operator
   * is never told one thing by the form and another by the response.
   */
  const plan = useMemo(() => planManualScreening({
    outcome, sources: parsedSources, searchedNames: parsedNames,
    rationale, unableReason, candidates: parsedCandidates,
  }), [outcome, parsedSources, parsedNames, rationale, unableReason, parsedCandidates]);

  // Cast rather than narrow: the app typecheck runs with `strict` off, where
  // the `ok: true` / `ok: false` discriminant does not narrow this union, so
  // reading `message` off the false branch has to be stated explicitly.
  const rejection = plan.ok ? null : (plan as ManualScreeningRejection);


  const isUnable = outcome === "unable_to_complete";
  const isMatch = outcome === "possible_match" || outcome === "confirmed_match";

  const submit = async () => {
    if (!plan.ok) return;
    setBusy(true);
    try {
      const r = await amlCasesApi.recordManualScreening({
        subject_id: subject.id,
        scope,
        outcome,
        sources: parsedSources,
        searched_names: parsedNames,
        rationale,
        unable_reason: isUnable ? unableReason : null,
        candidates: isMatch ? parsedCandidates : undefined,
      });
      toast({
        title: "Manual screening recorded",
        description: r.satisfies_obligation
          ? "Recorded against the case as a completed screening, performed by you, with the "
            + "sources and rationale you gave. The obligation itself is unchanged."
          : outcome === "unable_to_complete"
            ? "Recorded as unable to complete. Nothing is asserted about this party and the "
              + "screening obligation remains outstanding."
            : "Recorded. The candidates now need adjudicating in the same workflow an "
              + "automated candidate uses.",
      });
      onRecorded();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Could not record manual screening",
        description: e?.message, variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      {/*
        `bareLayout` drops the shared grid + overflow treatment so this dialog
        owns its own box. Three areas: a header and footer that stay put, and
        a body that scrolls between them.
      */}
      <DialogContent
        bareLayout
        className={[
          "flex flex-col overflow-hidden",
          // Narrow: a near-full-height sheet, single column.
          "inset-x-0 bottom-0 top-auto w-full max-h-[95dvh] rounded-t-2xl border-x-0 border-b-0",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          // Desktop: centred, and WIDE. 1100px is the point at which the
          // evidence grid stops crowding; 94vw keeps it inside a 1280 or
          // 1366 viewport with the scrim still visible around it.
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto",
          "sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:w-[min(1100px,94vw)] sm:max-w-none sm:max-h-[90dvh] sm:rounded-lg sm:border",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        ].join(" ")}
      >
        {/* ── 1. Header — never scrolls ───────────────────────────────── */}
        <DialogHeader
          data-testid="manual-screening-header"
          className="shrink-0 space-y-0 border-b border-border/60 px-5 py-3.5 pr-14 text-left sm:px-6"
        >
          {/*
            `sm:flex-nowrap` keeps the scope select on the header's right at
            desktop widths instead of wrapping onto its own row — worth ~40px
            of height, which is 40px the form gets back.
          */}
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 sm:flex-nowrap">
            <div className="min-w-0">
              <DialogTitle className="text-base">Record a manual screening</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                <span className="font-medium text-foreground">{subject.screened_name}</span>
                {" · manual screening · MLRO. "}
                {/*
                  The compliance point still has to be on the page — choosing
                  to screen by hand is a statement about METHOD — but it is one
                  line here rather than the four-line paragraph that used to
                  push the form down.
                */}
                A different way of carrying the screening out, not a way of standing it
                down: the case&rsquo;s obligation is unchanged by anything recorded here.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Label htmlFor="manual-scope" className="text-xs text-muted-foreground">
                Screened
              </Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger id="manual-scope" className="h-9 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        {/* ── 2. Body — the only scroll region ────────────────────────── */}
        <div
          data-testid="manual-screening-body"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6"
        >
          <div className="space-y-5">
            <section aria-labelledby="manual-outcome-heading" className="space-y-2">
              <h3 id="manual-outcome-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outcome
              </h3>
              {/*
                Four full-width stacked cards were most of the dialog's height.
                Two columns on desktop, one on a narrow screen. The controls
                and their labels are unchanged, so keyboard behaviour is too.
              */}
              <RadioGroup
                value={outcome}
                onValueChange={(v) => setOutcome(v as AmlManualOutcome)}
                data-testid="manual-outcome-grid"
                className="grid gap-2 sm:grid-cols-2"
              >
                {OUTCOMES.map((o) => (
                  <label
                    key={o.value}
                    htmlFor={`manual-outcome-${o.value}`}
                    className="flex cursor-pointer gap-2.5 rounded-md border border-border/60 p-2.5
                      has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5"
                  >
                    <RadioGroupItem value={o.value} id={`manual-outcome-${o.value}`} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{o.label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {o.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </section>

            {isUnable ? (
              <section aria-labelledby="manual-unable-heading" className="space-y-2">
                <h3 id="manual-unable-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Why it could not be concluded
                </h3>
                <RadioGroup
                  value={unableReason}
                  onValueChange={(v) => setUnableReason(v as AmlManualUnableReason)}
                  data-testid="manual-unable-grid"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(Object.keys(UNABLE_REASON_TEXT) as AmlManualUnableReason[]).map((r) => (
                    <label
                      key={r}
                      htmlFor={`manual-unable-${r}`}
                      className="flex cursor-pointer gap-2.5 rounded-md border border-border/60 p-2.5
                        has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value={r} id={`manual-unable-${r}`} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">
                          {r.replace(/_/g, " ")}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {UNABLE_REASON_TEXT[r]}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                <div className="pt-1">
                  <Label htmlFor="manual-rationale">What was attempted (optional)</Label>
                  <Textarea
                    id="manual-rationale" rows={3} value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    className="mt-1.5"
                    placeholder="What was searched, and what stopped it concluding."
                  />
                </div>
              </section>
            ) : (
              <section
                aria-labelledby="manual-evidence-heading"
                data-testid="manual-evidence-grid"
                className="grid gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
              >
                <h3 id="manual-evidence-heading" className="sr-only">Evidence</h3>

                {/* Left: what was actually searched, and where. */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="manual-names">Names actually searched</Label>
                    <Textarea
                      id="manual-names" rows={2} value={names}
                      onChange={(e) => setNames(e.target.value)}
                      className="mt-1.5"
                      placeholder="One per line — the legal name and any alias or transliteration searched."
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {parsedNames.length} name{parsedNames.length === 1 ? "" : "s"} recorded.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Sources actually checked</Label>
                    {sources.map((src, i) => (
                      <div
                        key={i}
                        data-testid="manual-source-row"
                        className="grid gap-2 rounded-md border border-border/60 p-2.5 sm:grid-cols-2"
                      >
                        <Select
                          value={src.source_type}
                          onValueChange={(v) => setSources((prev) =>
                            prev.map((row, j) => j === i ? { ...row, source_type: v } : row))}
                        >
                          <SelectTrigger aria-label={`Source ${i + 1} type`} className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SOURCE_TYPES.map((t) =>
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-9"
                          aria-label={`Source ${i + 1} name`}
                          placeholder="Which source, e.g. DFAT Consolidated List"
                          value={src.source_name}
                          onChange={(e) => setSources((prev) =>
                            prev.map((row, j) => j === i ? { ...row, source_name: e.target.value } : row))}
                        />
                        <Input
                          className="h-9"
                          aria-label={`Source ${i + 1} reference`}
                          placeholder="Reference, URL or list version"
                          value={src.source_reference}
                          onChange={(e) => setSources((prev) =>
                            prev.map((row, j) => j === i ? { ...row, source_reference: e.target.value } : row))}
                        />
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="h-9"
                            aria-label={`Source ${i + 1} searched at`}
                            placeholder="When searched (optional)"
                            value={src.searched_at}
                            onChange={(e) => setSources((prev) =>
                              prev.map((row, j) => j === i ? { ...row, searched_at: e.target.value } : row))}
                          />
                          {sources.length > 1 && (
                            <Button
                              type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0"
                              aria-label={`Remove source ${i + 1}`}
                              onClick={() => setSources((prev) => prev.filter((_, j) => j !== i))}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button" size="sm" variant="outline"
                      onClick={() => setSources((prev) => [...prev, emptySource()])}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add another source
                    </Button>
                  </div>
                </div>

                {/* Right: the reasoning, and what matched when something did. */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="manual-rationale">Why the conclusion is reasonable</Label>
                    <Textarea
                      id="manual-rationale" rows={isMatch ? 4 : 7} value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                      className="mt-1.5"
                      placeholder="How the searches were run and why the result follows from them."
                    />
                  </div>

                  {isMatch && (
                    <div className="space-y-2">
                      <Label>What matched</Label>
                      {candidates.map((c, i) => (
                        <div
                          key={i}
                          data-testid="manual-candidate-row"
                          className="grid gap-2 rounded-md border border-border/60 p-2.5 sm:grid-cols-2"
                        >
                          <Input
                            className="h-9"
                            aria-label={`Candidate ${i + 1} listed name`}
                            placeholder="The listed name that matched"
                            value={c.matchedName}
                            onChange={(e) => setCandidates((prev) =>
                              prev.map((row, j) => j === i ? { ...row, matchedName: e.target.value } : row))}
                          />
                          <Input
                            className="h-9"
                            aria-label={`Candidate ${i + 1} list`}
                            placeholder="Which list"
                            value={c.listName}
                            onChange={(e) => setCandidates((prev) =>
                              prev.map((row, j) => j === i ? { ...row, listName: e.target.value } : row))}
                          />
                          <Input
                            className="h-9"
                            aria-label={`Candidate ${i + 1} jurisdiction`}
                            placeholder="Jurisdiction"
                            value={c.jurisdiction}
                            onChange={(e) => setCandidates((prev) =>
                              prev.map((row, j) => j === i ? { ...row, jurisdiction: e.target.value } : row))}
                          />
                          <Input
                            className="h-9"
                            aria-label={`Candidate ${i + 1} reference`}
                            placeholder="Listing reference"
                            value={c.reference}
                            onChange={(e) => setCandidates((prev) =>
                              prev.map((row, j) => j === i ? { ...row, reference: e.target.value } : row))}
                          />
                          <div className="flex items-center gap-1.5 sm:col-span-2">
                            <Input
                              className="h-9"
                              aria-label={`Candidate ${i + 1} basis`}
                              placeholder="What matched — name, date of birth, address…"
                              value={c.matchBasis}
                              onChange={(e) => setCandidates((prev) =>
                                prev.map((row, j) => j === i ? { ...row, matchBasis: e.target.value } : row))}
                            />
                            {candidates.length > 1 && (
                              <Button
                                type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0"
                                aria-label={`Remove candidate ${i + 1}`}
                                onClick={() => setCandidates((prev) => prev.filter((_, j) => j !== i))}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button" size="sm" variant="outline"
                        onClick={() => setCandidates((prev) => [...prev, emptyCandidate()])}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add another candidate
                      </Button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        {/*
          ── 3. Footer — never scrolls ────────────────────────────────────
          The reason a submission is refused sits HERE, beside the disabled
          button, because that is where somebody looks when the button will
          not press. It used to be at the bottom of the scrolling column,
          which on a 1366x768 screen meant hunting for it.
        */}
        <div
          data-testid="manual-screening-footer"
          className="flex shrink-0 flex-col gap-2 border-t border-border/60 px-5 py-3
            sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <p
            role="status"
            className={`min-w-0 text-xs ${plan.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {plan.ok
              ? (plan.satisfiesObligation
                ? "Will be recorded as a completed screening, performed by you."
                : "This does not discharge the screening obligation.")
              : rejection?.message}

          </p>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={busy || !plan.ok}>
              {busy
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <ClipboardCheck className="mr-1.5 h-4 w-4" />}
              Record manual screening
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

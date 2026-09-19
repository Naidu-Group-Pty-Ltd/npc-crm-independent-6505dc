/**
 * The PEP determination, as three steps rather than two text boxes.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * A generic prompt dialog with two free-text areas. It had already decided
 * the ANSWER before it opened (the CTA called `recordPep(subject, "not_pep")`
 * and the dialog was headed "Record not-PEP determination"), and its own
 * example of a source was the DFAT Consolidated List — a targeted financial
 * sanctions register, which says nothing whatever about political exposure.
 * An operator following the product's guidance produced a record that could
 * not be defended.
 *
 * ── The shape ─────────────────────────────────────────────────────────
 *   1  What the customer told us — read-only, and labelled as evidence
 *   2  Check the sources — one row per source, opened with one click,
 *      recording what was searched and what came back
 *   3  The determination — including "cannot determine yet", which writes
 *      no determination at all
 *
 * All three stay on screen. This is a checklist, not a wizard: an operator
 * reaching step 3 has to be able to see what they found in step 2 while they
 * write down why it is reasonable.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It performs no search and reads no result — the links open a source, a
 * person looks, and the person records what they saw. Nothing here can
 * return "no match", because a partial index reporting "no match" is a
 * confident clear against nothing, which is the failure this stage exists to
 * prevent.
 *
 * Admissibility is judged by `pepEvidence.pure.ts` — the same module
 * `record_pep_determination` enforces — so the button's disabled state, the
 * message under it, and what the server accepts are one rule.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Check, Circle, ClipboardCheck, Info, Loader2,
  Plus, ShieldCheck, X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import {
  amlCasesApi, type AmlPartyScreeningSubject,
} from "@/lib/aml/amlCasesApi";
import {
  PEP_DECLARATION_KIND,
  PEP_DEFERRAL_REASONS, PEP_DEFERRAL_REASON_LABEL, PEP_SOURCE_KINDS,
  PEP_SOURCE_KIND_LABEL, assessPepDeferral, assessPepEvidence, normalisePepMethods,
  sanctionsSignalForPep,
  type PepDeferralReason, type PepMethod, type PepSourceKind, type SanctionsSignal,
} from "@/lib/aml/pepEvidence";
import {
  PEP_SEARCH_COVERAGE_GAPS, buildPepSearches,
} from "@/lib/aml/pepSearchLinks.pure";
import { PepScreeningRunPanel } from "@/components/aml/PepScreeningRunPanel";
import { PepCoverageGaps } from "@/components/aml/PepCoverageGaps";
import {
  classifyManualChecks, describeManualChecks,
} from "@/lib/aml/pepManualChecks";
import {
  cascadeRunResults, type RunSourceReading,
} from "@/lib/aml/pepRunCascade";
import {
  describeOutstanding, pepDeterminationRequirements,
} from "@/lib/aml/pepDeterminationSteps";
import type { PepDeclarationReading } from "@/lib/aml/pepDeclaration";
import { PEP_RELATIONSHIP_LABEL } from "@/lib/aml/pepDeclaration";

type Outcome = "not_pep" | "pep" | "defer";

const PEP_TYPES = [
  { value: "foreign", label: "Foreign PEP",
    note: "Always requires enhanced CDD and senior-manager approval." },
  { value: "domestic", label: "Domestic PEP",
    note: "Enhanced measures apply where the customer is high risk." },
  { value: "international_organisation", label: "International organisation PEP",
    note: "Enhanced measures apply where the customer is high risk." },
] as const;

const RELATIONSHIPS = ["self", "family_member", "close_associate"] as const;

interface Row {
  id: string;
  /**
   * The listed search this row was opened from, when it was. Rows are bound
   * to their register by THIS and never by the source label — an operator who
   * types a register's name into a hand-added row must not have their row
   * teleported into that register's card mid-edit, which is exactly what
   * label-matching did.
   */
  searchId?: string;
  /**
   * Recorded from the run rather than typed by a person.
   *
   * Presentational and provenance only: the row is submitted, validated and
   * counted exactly as any other. It exists so the card can say where the
   * result came from, and so a run that is re-run or fails can withdraw its
   * own rows without touching anything an operator wrote.
   */
  fromRun?: boolean;
  kind: PepSourceKind;
  source: string;
  reference: string;
  result: string;
}


let rowSeq = 0;
const newRow = (over: Partial<Row> = {}): Row => ({
  id: `row-${(rowSeq += 1)}`,
  kind: "open_source", source: "", reference: "", result: "", ...over,
});

/** One numbered step heading, in the same language as the Stage 5 path. */
function StepHeading({ n, title, hint, done }: {
  n: number; title: string; hint?: string; done?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          done
            ? "border-success/50 bg-success/10 text-success"
            : "border-primary/50 bg-primary/10 text-primary",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function PepDeterminationDialog({
  subject, caseId, declaration, sanctionsSignal = "none", open, onOpenChange, onRecorded,
}: {
  subject: AmlPartyScreeningSubject;
  caseId: string;
  /** What the customer said, carried from the stage sync. Evidence only. */
  declaration?: PepDeclarationReading | null;
  /** Whether this party has a sanctions candidate or confirmed match. */
  sanctionsSignal?: SanctionsSignal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [rationale, setRationale] = useState("");
  const [pepType, setPepType] = useState("");
  const [relationship, setRelationship] = useState("");
  const [position, setPosition] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [currentlyHeld, setCurrentlyHeld] = useState<string>("");
  const [deferReason, setDeferReason] = useState<string>("");
  const [needed, setNeeded] = useState("");
  const [busy, setBusy] = useState(false);

  const searches = useMemo(() => buildPepSearches({
    name: subject.screened_name,
    jurisdiction: declaration?.country ?? null,
  }), [subject.screened_name, declaration?.country]);

  /*
   * ── ONE EDITING SESSION, AND WHAT MAY END IT ──────────────────────────
   *
   * This state is initialised once per (open dialog, party) and by nothing
   * else. That is what `sessionKey` is: the identity of the thing being
   * worked on, as a string.
   *
   * It used to be keyed on the `declaration` OBJECT:
   *
   *     }, [open, declaration]);
   *
   * The workspace behind this dialog keeps an open case current with
   * `useLiveCaseRefresh`, which refetches on `focus` and `visibilitychange`.
   * This screen's own design asks the operator to open official registers in
   * a new tab and come back — so **returning from a register is a refetch,
   * every time**. The refetch parses fresh JSON, `pep_declaration` is a new
   * object with identical content, and this effect fired: the run's cascade
   * was cleared, every row it had written was stripped, and anything typed
   * into the determination went with it. The screening card above stayed —
   * the run lives in the child — so the checklist below simply emptied, and
   * the only way back was to run the screening again.
   *
   * The poll runs on a timer too, so it could also land mid-sentence with
   * nothing the operator did to provoke it.
   *
   * **Object identity of refetched data is not a signal that anything
   * changed.** A session ends when the operator closes the dialog or moves to
   * a different party, and those are the only two things that may reset this.
   */
  const sessionKey = open ? subject.id : null;
  const initialisedFor = useRef<string | null>(null);
  const seededDeclarationFor = useRef<string | null>(null);
  /* Read at initialisation without being a dependency of it. */
  const declarationRef = useRef(declaration);
  declarationRef.current = declaration;

  useEffect(() => {
    if (!sessionKey || initialisedFor.current === sessionKey) return;
    initialisedFor.current = sessionKey;
    seededDeclarationFor.current = null;
    const decl = declarationRef.current;
    setOutcome(null);
    setRationale("");
    setPepType(""); setRelationship(""); setPosition("");
    setJurisdiction(decl?.country ?? "");
    setCurrentlyHeld(""); setDeferReason(""); setNeeded("");
    // A new party has run nothing yet. Carrying the previous one's coverage
    // across would tell an operator a register was searched for somebody it
    // was never searched for — the same lie as losing it, from the other
    // direction, which is why the reset is narrowed rather than removed.
    setRunSources(null);
    setRows([]);
  }, [sessionKey]);

  /*
   * The customer's own answer is seeded as a row — as a DECLARATION, which
   * `assessPepEvidence` counts separately and which can never satisfy the
   * independent-source rule on its own. Seeding it saves retyping; it does
   * not lower the bar.
   *
   * Seeded ONCE per session, and never rewritten. The declaration can arrive
   * after the dialog opens, so this cannot live in the initialiser above —
   * and its dependencies are the answer's PRIMITIVES rather than the object,
   * so a refetch carrying the same answer does nothing.
   *
   * If the customer later changes their answer, that is a real event and it
   * is not handled by silently editing a row the operator may already have
   * relied on. The screening run reads the declaration server-side at the
   * moment it runs, which is where a changed answer is picked up.
   */
  useEffect(() => {
    if (!sessionKey || seededDeclarationFor.current === sessionKey) return;
    if (!declaration?.answered) return;
    seededDeclarationFor.current = sessionKey;
    setRows((prev) => (prev.some((r) => r.kind === "client_declaration")
      ? prev
      : [newRow({
        kind: "client_declaration",
        source: "The customer's declaration in the client portal",
        reference: `Answered: ${declaration.answer === "yes" ? "yes" : "no"}`,
        result: declaration.summary,
      }), ...prev]));
  }, [sessionKey, declaration?.answered, declaration?.answer, declaration?.summary]);

  /*
   * What the last run read. `null` means no run has been made in this dialog,
   * which is not the same as a run that reached nothing — see
   * `describeManualChecks`.
   */
  const [runSources, setRunSources] = useState<RunSourceReading[] | null>(null);

  /*
   * ── The run's own results, cascaded into the checklist ────────────────
   * A register the run reports as `searched` is recorded from the run: the
   * operator is not asked to go and repeat a search the platform has already
   * performed and displayed one card above.
   *
   * Only `searched` cascades — an unavailable, failed or unreachable register
   * stays outstanding, because a read that failed is not a register that was
   * empty. A row an operator already put against that register is never
   * touched, and a run that is re-run or fails withdraws only the rows it
   * wrote itself.
   */
  useEffect(() => {
    if (!open) return;
    if (runSources === null) {
      setRows((prev) => prev.filter((r) => !r.fromRun));
      return;
    }
    const drafts = cascadeRunResults({
      targets: searches
        .filter((s) => s.tier === "register")
        .map((s) => ({
          id: s.id, kind: s.kind, label: s.label, searchTerms: s.searchTerms,
        })),
      sources: runSources,
    });
    setRows((prev) => {
      /* Withdraw this run's own rows, keep everything a person wrote. */
      const kept = prev.filter((r) => !r.fromRun);
      const held = new Set(kept.map((r) => r.searchId).filter(Boolean));
      const added = drafts
        .filter((d) => !held.has(d.searchId))
        .map((d) => newRow({
          searchId: d.searchId,
          kind: (PEP_SOURCE_KINDS as readonly string[]).includes(d.kind)
            ? d.kind as PepSourceKind : "official_register",
          source: d.source, reference: d.reference, result: d.result,
          fromRun: true,
        }));
      return added.length === 0 && kept.length === prev.length
        ? prev : [...kept, ...added];
    });
    /* `searches` is derived from the party's name and jurisdiction, both
       primitives, so it is stable for the life of a session. */
  }, [open, runSources]);

  const methods: PepMethod[] = useMemo(
    () => normalisePepMethods(rows.map((r) => ({
      kind: r.kind, source: r.source, reference: r.reference, result: r.result,
    }))),
    [rows],
  );

  /* One rule, rendered and enforced. */
  const verdict = useMemo(() => {
    if (outcome === "defer") {
      return assessPepDeferral({ reason: deferReason, needed, methods });
    }
    if (outcome === "not_pep" || outcome === "pep") {
      const base = assessPepEvidence({ result: outcome, methods, rationale });
      const errors = [...base.errors];
      if (outcome === "pep") {
        if (!pepType) {
          errors.push({ field: "pep_type", message: "Choose the PEP category." });
        }
        if (!relationship) {
          errors.push({ field: "relationship", message: "Say who holds the position." });
        }
        if (!currentlyHeld) {
          errors.push({
            field: "currently_held",
            message: "Say whether the position is currently held — a former office "
              + "holder is assessed on risk, not written off.",
          });
        }
      }
      return { ok: errors.length === 0, errors };
    }
    return {
      ok: false,
      errors: [{ field: "outcome", message: "Choose what was determined." }],
    };
  }, [outcome, methods, rationale, deferReason, needed, pepType, relationship, currentlyHeld]);

  const manualChecks = useMemo(
    () => classifyManualChecks({
      linkIds: searches.filter((x) => x.tier === "register").map((x) => x.id),
      runSources,
    }),
    [searches, runSources],
  );

  /*
   * Everything outstanding, at once.
   *
   * The footer showed `verdict.errors[0]` — and before an outcome is chosen
   * the only error is "Choose what was determined", so every other
   * requirement was invisible until an outcome existed. An operator picked
   * one, discovered they needed an independent source, supplied it,
   * discovered they needed a rationale. Each message correct; the sequence a
   * corridor of closed doors.
   *
   * The list is built from the errors the assessment ACTUALLY produces, so
   * what is shown outstanding and what the server refuses cannot become two
   * standards.
   */
  const requirements = useMemo(
    () => pepDeterminationRequirements({
      outcome, methodCount: methods.length, errors: verdict.errors,
    }),
    [outcome, methods.length, verdict.errors],
  );

  const errorFor = (field: string) =>
    verdict.errors.find((e) => e.field === field || e.field.startsWith(`${field}.`));

  const signal = sanctionsSignalForPep(sanctionsSignal);

  const submit = async () => {
    if (!verdict.ok || !outcome) return;
    setBusy(true);
    try {
      if (outcome === "defer") {
        await amlCasesApi.deferPepDetermination({
          case_id: caseId,
          party_screening_subject_id: subject.id,
          reason: deferReason as PepDeferralReason,
          needed: needed.trim(),
          methods,
        });
        toast({
          title: "Determination deferred",
          description: "No determination was recorded. Stage 5 stays open on this party.",
        });
      } else {
        await amlCasesApi.recordPepDetermination({
          case_id: caseId,
          party_screening_subject_id: subject.id,
          party_type: subject.party_type,
          party_id: subject.party_id ?? undefined,
          subject_name: subject.screened_name,
          result: outcome,
          ...(outcome === "pep"
            ? {
              pep_type: pepType as "foreign" | "domestic" | "international_organisation",
              pep_relationship: relationship as "self" | "family_member" | "close_associate",
              position_held: position.trim() || undefined,
              jurisdiction: jurisdiction.trim() || undefined,
              holds_position_currently: currentlyHeld === "yes",
            }
            : {}),
          methods,
          rationale: rationale.trim(),
        });
        toast({
          title: outcome === "pep" ? "PEP determination recorded" : "Determination recorded",
          description: outcome === "pep"
            ? "Enhanced due diligence and approval requirements follow from the category."
            : "Recorded as not a politically exposed person, on the sources you checked.",
        });
      }
      onRecorded();
      onOpenChange(false);
    } catch (e: unknown) {
      toast({
        title: "Could not record the determination",
        description: e instanceof Error ? e.message : "The server refused it.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  /*
   * Step 2 is settled when the SOURCES are, and that is a question about the
   * sources alone.
   *
   * This used to read `!errorFor("methods")` off the live verdict, which
   * carries only an "outcome" error until an outcome is picked — so the step
   * showed a green tick with nothing in it but the customer's own
   * declaration, which can never satisfy the independent-source rule. A tick
   * on a step that is not settled is worse than no tick: it is the product
   * telling an operator they are done.
   *
   * Asking `assessPepEvidence` directly keeps one rule. The rationale is
   * irrelevant here and only the `methods.*` failures are read.
   */
  const sourcesDone = useMemo(() => {
    if (methods.length === 0) return false;
    const probe = assessPepEvidence({ result: "not_pep", methods, rationale: "" });
    return !probe.errors.some((e) => e.field.startsWith("methods"));
  }, [methods]);

  /*
   * ── The customer's own answer belongs to step 1, not step 2 ──────────
   * It was seeded into the step-2 list because that is where the record
   * keeps it — and it then sat in a grid of editable "Kind of source /
   * Source / Searched / What came back" boxes identical to the registers an
   * operator checks by hand. Two things followed. The first row of "check
   * the sources" was a source nobody checked, and step 2's own rule (at
   * least one source INDEPENDENT of the customer) was contradicted by its
   * first entry.
   *
   * So the declaration renders under step 1, where the same answer is
   * already stated, as a read-only evidence line. It is still the same `Row`
   * in the same `rows` state and still travels in `methods`, so nothing
   * about what is submitted or what the server enforces changes — this is
   * where it is SHOWN.
   */
  const declarationRows = useMemo(
    () => rows.filter((r) => r.kind === PEP_DECLARATION_KIND), [rows]);
  const checkedRows = useMemo(
    () => rows.filter((r) => r.kind !== PEP_DECLARATION_KIND), [rows]);
  /* Step 2's own count: what the operator actually went and checked. */
  const independentCount = checkedRows.length;

  /*
   * ── The checklist ────────────────────────────────────────────────────
   * A register is bound to its rows by the search it was opened from, so what
   * came back is captured on the register that produced it rather than in a
   * detached grid. Anything not opened from a listed source — an accepted run
   * candidate, a web search, a source typed by hand — falls to the general
   * list, so nothing can be filtered out of view.
   */
  const registerSearches = useMemo(
    () => searches.filter((s) => s.tier === "register"), [searches]);
  const otherRows = useMemo(
    () => checkedRows.filter((r) => !r.searchId), [checkedRows]);

  /*
   * ── Two different obligations, counted separately ─────────────────────
   * "1 of 4 recorded" read as a three-quarters-empty checklist, and three of
   * those four could never have been filled by the run: ParlInfo is a
   * full-text archive of the parliamentary record and ABN Lookup is a company
   * register that happens to name office holders. Neither is a register the
   * index could hold, so counting them alongside the ones it does reports a
   * coverage failure that does not exist — and buries the one register that
   * genuinely still needs a person.
   *
   * `classifyManualChecks` already draws that line (`not_held_by_platform`).
   * This reads it rather than re-deciding it, so nothing here can disagree
   * with the run above.
   */
  const stateOf = useMemo(() => {
    const byId = new Map(manualChecks.map((m) => [m.id, m.state]));
    return (id: string) => byId.get(id);
  }, [manualChecks]);
  const heldRegisters = useMemo(
    () => registerSearches.filter((s) => stateOf(s.id) !== "not_held_by_platform"),
    [registerSearches, stateOf]);
  const unheldRegisters = useMemo(
    () => registerSearches.filter((s) => stateOf(s.id) === "not_held_by_platform"),
    [registerSearches, stateOf]);

  const hasResult = useMemo(
    () => (id: string) => checkedRows.some(
      (r) => r.searchId === id && r.result.trim().length > 0),
    [checkedRows]);

  /* The progress bar measures the registers the platform can read. */
  const registerTotal = heldRegisters.length;
  const registerDone = useMemo(
    () => heldRegisters.filter((s) => hasResult(s.id)).length,
    [heldRegisters, hasResult]);
  /*
   * What is left for a person, named.
   *
   * Once the run's own results cascade in, "0 of 4 recorded" is no longer the
   * honest reading — some of those have been read and recorded, and the
   * remainder are the ones no server can reach. Those are what this lists, so
   * the operator sees the actual outstanding work rather than the whole list
   * again.
   */
  const outstandingRegisters = useMemo(
    () => heldRegisters.filter((s) => !hasResult(s.id)),
    [heldRegisters, hasResult]);
  /* Sources nobody's server could have covered: offered, never counted as a
     coverage gap, and still recordable by hand. */
  const outstandingOther = useMemo(
    () => unheldRegisters.filter((s) => !hasResult(s.id)),
    [unheldRegisters, hasResult]);





  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Three areas: a header and footer that never scroll, a body that does.
          The same treatment the manual screening dialog needed — a form this
          long inside the shared `max-w-lg` grid puts the submit button two
          screens below the fold at 1366x768. */}
      {/*
        ── `bareLayout` means THIS dialog owns its position ─────────────
        The primitive drops every positioning class when `bareLayout` is
        set — the base is `fixed z-50` and nothing else — so a caller that
        supplies only size classes gets a `position: fixed` box with `auto`
        insets. The browser then lays it out at its static position inside
        the portal, which is off-screen, and the operator sees the scrim
        with nothing on it: a grey screen.

        That is exactly what this dialog shipped. Every test passed, because
        jsdom does no layout at all — testing-library finds an element that
        a real browser never paints. `pepDeterminationDialogLayout.test.tsx`
        now asserts the classes rather than trusting the query.

        The treatment mirrors `ManualScreeningDialog`, which needed the same
        box: a near-full-height sheet on a narrow screen, centred and wide
        on a desktop.
      */}
      <DialogContent
        bareLayout
        className={cn(
          "flex flex-col overflow-hidden gap-0 p-0",
          // Narrow: a bottom sheet, single column.
          "inset-x-0 bottom-0 top-auto w-full max-w-none max-h-[95dvh]",
          "rounded-t-2xl border-x-0 border-b-0",
          "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          // Desktop: centred, and wide enough for the source rows to be a
          // grid rather than a stack.
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto",
          "sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:w-[min(1100px,94vw)] sm:max-w-none sm:max-h-[90dvh] sm:rounded-lg sm:border",
          "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        )}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-border/60 px-5 py-3.5 pr-14 text-left sm:px-6">
          <DialogTitle className="text-base">
            Record the PEP determination — {subject.screened_name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            A politically-exposed-person determination is established by Aurixa{" "}
            <span className="font-medium text-foreground">on reasonable grounds</span>.
            Work down the three steps; what you record here is the evidence it rests on.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 sm:px-6">
          {/* ── 1 · what the customer said ───────────────────────────── */}
          <section className="space-y-2">
            {/* An UNANSWERED question is not a settled step. A tick here
                would read as "the customer told us no", which is exactly the
                reading `readPepDeclaration` refuses to make. */}
            <StepHeading
              n={1} done={Boolean(declaration?.answered)}
              title="What the customer told us"
              hint="Evidence towards the determination — never the determination itself."
            />
            <div className="ml-[2.125rem] rounded-md border border-border/60 bg-muted/30 p-3">
              {declaration?.answered ? (
                <>
                  <p className="text-sm">{declaration.summary}</p>
                  {declaration.answer === "yes" && (
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-muted-foreground">Who holds it</dt>
                        <dd className="font-medium">
                          {declaration.relationship
                            ? PEP_RELATIONSHIP_LABEL[declaration.relationship]
                            : "Not given"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Position</dt>
                        <dd className="font-medium">{declaration.role ?? "Not given"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Jurisdiction</dt>
                        <dd className="font-medium">{declaration.country ?? "Not given"}</dd>
                      </div>
                    </dl>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-1.5 text-sm text-warning">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The customer has not answered the political-exposure question. That is
                  not a declaration that they are not politically exposed.
                </p>
              )}
            </div>

            {/*
              ── The same answer, as it will be recorded ─────────────────
              This is the row that used to open step 2's source grid. It is
              the customer's own answer, so it is shown here — read-only,
              beside the answer it repeats — and labelled with the one thing
              an operator needs to know about it: it counts as evidence and
              it can never stand alone.
            */}
            {declarationRows.length > 0 && (
              <div className="ml-[2.125rem] rounded-md border border-border/60 bg-background p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <ClipboardCheck aria-hidden className="h-3 w-3" />
                  Carried into the record as evidence
                </p>
                <ul className="mt-2 space-y-2">
                  {declarationRows.map((row) => (
                    <li key={row.id} className="text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground">{row.source}</span>
                        {row.reference && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {row.reference}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {PEP_SOURCE_KIND_LABEL[row.kind]}
                        </Badge>
                      </div>
                      {row.result && (
                        <p className="mt-1 text-muted-foreground">{row.result}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                  A declaration is not a check. Step 2 still needs at least one source
                  independent of the customer.
                </p>
              </div>
            )}


            {/* A sanctions match is a signal, and only in one direction. */}
            {signal && (
              <p className="ml-[2.125rem] flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {signal}
              </p>
            )}
          </section>

          {/* ── 2 · the sources ──────────────────────────────────────── */}
          <section className="space-y-3">
            <StepHeading
              n={2} done={sourcesDone} title="Check the sources"
              hint="Open a source, look, and record what came back. At least one source
                independent of the customer is required."
            />

            <div className="ml-[2.125rem] space-y-3">
              {/*
                ── The screening first ─────────────────────────────────
                The platform searches the registers it holds and shows what
                came back. It informs the determination and never makes one:
                the verdict vocabulary has no "clear" in it, an empty result
                is drawn neutrally, and everything the run could not reach is
                named so the manual checks below have a purpose.

                A completed run, and every candidate the operator accepts,
                becomes a source row here — so the evidence is captured as it
                is gathered rather than retyped from memory afterwards.
              */}
              <PepScreeningRunPanel
                caseId={caseId} subjectId={subject.id}
                onSources={setRunSources}
                onEvidence={(draft) => setRows((prev) => [...prev, newRow({
                  kind: (PEP_SOURCE_KINDS as readonly string[]).includes(draft.kind)
                    ? draft.kind as PepSourceKind : "official_register",
                  source: draft.source, reference: draft.reference, result: draft.result,
                })])}
              />

              {/*
                ── The manual checks, kept and DERIVED ─────────────────
                This section used to say, in fixed prose, that "the two
                Commonwealth registers block automated requests, so the run
                above cannot read them". By the time anybody read it, one of
                them had become a register the server searches on every run —
                and the panel directly above said so, in the same scroll.

                Correcting the number would have been true until the next
                source moved, which is the whole direction of this programme.
                So the wording and the count come off the run's own sources
                now, and a register the platform read is offered as a place to
                CONFIRM rather than as a hole to fill.
              */}
              {/*
                ── The checklist ────────────────────────────────────────
                The registers used to be a wrap of buttons, and what came
                back went into a separate grid of rows further down — so the
                thing an operator has to finish (open a register, look,
                write down what they saw) was split across two lists that
                never referred to each other, and "have I done this one?"
                had no answer on screen. It is one numbered checklist now:
                each register carries its own state, its own capture field
                and its own tick, and the header counts them.

                Nothing here is derived differently. The state comes off
                `classifyManualChecks` and the rows are the same `rows`
                state `methods` is built from.
              */}
              <div
                className={cn(
                  "space-y-3 transition-opacity duration-500",
                  runSources !== null && "animate-fade-in",
                )}
              >
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        Official registers — what is recorded, and what still needs you
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {describeManualChecks(manualChecks, runSources !== null)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {registerDone} of {registerTotal} recorded
                      </span>
                      <div
                        className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={registerDone}
                        aria-valuemin={0}
                        aria-valuemax={registerTotal}
                        aria-label="Registers recorded"
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                          style={{
                            width: registerTotal > 0
                              ? `${Math.round((registerDone / registerTotal) * 100)}%`
                              : "0%",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/*
                    The outstanding work, named.
                    A list of every register with "0 of 4 recorded" beside it
                    told an operator to repeat, by hand, searches the panel
                    above had just performed. What is left is what this says.
                  */}
                  {outstandingRegisters.length > 0 ? (
                    <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
                      <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        Still needs a person ({outstandingRegisters.length}):{" "}
                        <span className="font-medium">
                          {outstandingRegisters.map((s) => s.label).join(" · ")}
                        </span>
                      </span>
                    </p>
                  ) : registerTotal > 0 && (
                    <p className="flex items-start gap-1.5 rounded-md border border-success/40 bg-success/5 px-2 py-1.5 text-[11px] text-success">
                      <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        Every register the platform holds has a result recorded
                        against it. What was recorded is a result about the search,
                        not a clearance — the determination in step 3 is still yours.
                      </span>
                    </p>
                  )}

                  {/*
                    And the sources that were never the run's to read. Stated
                    separately, because listing them as outstanding coverage
                    reports a failure that does not exist.
                  */}
                  {outstandingOther.length > 0 && (
                    <p className="flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                      <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {outstandingOther.length}{" "}
                        {outstandingOther.length === 1 ? "source is" : "sources are"}{" "}
                        not a register the platform could hold —{" "}
                        <span className="font-medium">
                          {outstandingOther.map((s) => s.label).join(" · ")}
                        </span>
                        . Open them where the determination needs them; they are
                        not counted above.
                      </span>
                    </p>
                  )}
                </div>



                {/*
                  What the loaded registers do not evidence at all. Measured by
                  the loader, and the direct answer to "the run found nothing —
                  what had it never looked at?".
                */}
                <PepCoverageGaps />

                {/*
                  Two groups, in the order the work happens: the registers the
                  platform reads (so most of them arrive recorded), then the
                  sources it never could. One renderer, so a card cannot say
                  one thing in one group and another in the other.
                */}
                {[
                  { key: "held", list: heldRegisters, heading: null as string | null },
                  {
                    key: "other",
                    list: unheldRegisters,
                    heading: "Not registers the platform holds — an archive and a "
                      + "company register, always opened by hand",
                  },
                ].filter((group) => group.list.length > 0).map((group) => (
                <div key={group.key} className="space-y-2">
                  {group.heading && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {group.heading}
                    </p>
                  )}
                  <ol className="space-y-2">
                  {group.list.map((s) => {
                    const check = manualChecks.find((m) => m.id === s.id);
                    const covered = check?.state === "searched_by_platform";
                    /* Never a coverage gap — so never ringed, never counted. */
                    const unheld = check?.state === "not_held_by_platform";
                    const bound = checkedRows.filter((r) => r.searchId === s.id);

                    const recorded = bound.some((r) => r.result.trim().length > 0);
                    /*
                     * Recorded FROM THE RUN is a different fact from recorded
                     * by a person: the row is identical and carries the same
                     * weight, but the card has to say where it came from, or
                     * an operator cannot tell what they have and have not
                     * personally seen.
                     */
                    const runRecorded = recorded && bound.every(
                      (r) => r.fromRun === true || r.result.trim().length === 0);
                    const open = () => {
                      window.open(s.url, "_blank", "noopener,noreferrer");
                      setRows((prev) => [...prev, newRow({
                        searchId: s.id,
                        kind: s.kind, source: s.label, reference: s.searchTerms,
                      })]);
                    };

                    /* Recorded by the run · recorded by you · looked but
                       nothing written · outstanding. Never collapsed. */
                    const status = runRecorded
                      ? {
                        label: "Recorded from the run",
                        tone: "border-info/50 bg-info/10 text-info",
                      }
                      : recorded
                        ? { label: "Recorded", tone: "border-success/50 bg-success/10 text-success" }
                        : bound.length > 0
                          ? {
                            label: "Waiting on what came back",
                            tone: "border-warning/50 bg-warning/10 text-warning",
                          }
                          : covered
                            ? {
                              label: "Read by the run — confirm",
                              tone: "border-info/50 bg-info/10 text-info",
                            }
                            : unheld
                              ? {
                                /* Not "Needs you": nothing here was ever owed
                                   to the automated search, and calling it
                                   outstanding reports a gap that never was. */
                                label: "By hand if you need it",
                                tone: "border-border/60 bg-muted/40 text-muted-foreground",
                              }
                              : {
                                label: "Needs you",
                                tone: "border-warning/50 bg-warning/10 text-warning",
                              };

                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "rounded-lg border p-3 transition-colors duration-300",
                          recorded
                            ? runRecorded
                              ? "border-info/40 bg-info/5"
                              : "border-success/40 bg-success/5"
                            : bound.length > 0
                              ? "border-warning/40 bg-warning/5"
                              : unheld
                                ? "border-border/60 bg-muted/10"
                              /* Outstanding work is the only thing on this list
                                 that a person still has to do, so it is the only
                                 thing given a ring. */
                                : "border-warning/50 bg-warning/[0.04] ring-1 ring-warning/25",
                        )}
                      >

                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                              recorded
                                ? runRecorded
                                  ? "border-info/50 bg-info/10 text-info"
                                  : "border-success/50 bg-success/10 text-success"
                                : unheld
                                  ? "border-border/60 bg-muted/40 text-muted-foreground"
                                  : "border-warning/50 bg-warning/10 text-warning",

                            )}
                          >
                            {recorded
                              ? <Check className="h-3.5 w-3.5" />
                              : <Circle className="h-2.5 w-2.5" />}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{s.label}</span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                  status.tone,
                                )}
                              >
                                {status.label}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {check?.action ?? s.purpose}
                              {covered && " · searched on this run"}
                            </p>

                            {bound.length === 0 ? (
                              <Button
                                type="button" variant="outline" size="sm"
                                className="mt-2 h-8"
                                onClick={open}
                              >
                                {covered
                                  ? <ShieldCheck aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                                  : <ArrowUpRight aria-hidden className="mr-1.5 h-3.5 w-3.5" />}
                                Open register and record
                              </Button>
                            ) : (
                              <div className="mt-2 space-y-2">
                                {bound.map((row) => {
                                  /* Indexed against the SUBMITTED methods,
                                     which is `rows` — never a filtered view. */
                                  const i = rows.indexOf(row);
                                  const rowError = verdict.errors.find(
                                    (e) => e.field === `methods.${i}`
                                      || e.field === `methods.${i}.result`);
                                  return (
                                    <div
                                      key={row.id}
                                      className="rounded-md border border-border/50 bg-background/70 p-2.5"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="min-w-0 text-[11px] text-muted-foreground">
                                          Searched:{" "}
                                          <span className="text-foreground">
                                            {row.reference || "not stated"}
                                          </span>
                                        </p>
                                        <Button
                                          type="button" size="icon" variant="ghost"
                                          className="h-6 w-6 shrink-0"
                                          aria-label={`Remove ${row.source || "source"}`}
                                          onClick={() => setRows((prev) =>
                                            prev.filter((r) => r.id !== row.id))}
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                      <Label
                                        className="mt-1.5 block text-[11px] text-muted-foreground"
                                        htmlFor={`pep-result-${row.id}`}
                                      >
                                        What came back
                                      </Label>
                                      <Input
                                        id={`pep-result-${row.id}`}
                                        className="mt-1 h-9" value={row.result}
                                        aria-label={`What came back ${i + 1}`}
                                        placeholder="e.g. no entry found for this name"
                                        onChange={(e) => setRows((prev) => prev.map((r) =>
                                          r.id === row.id
                                            ? { ...r, result: e.target.value } : r))}
                                      />
                                      {/* Two common answers, typed once. Both
                                          are what the operator SAW; neither is
                                          a clearance, and the wording says so. */}
                                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {[
                                          "No entry found for this name",
                                          "Entry found — see the note below",
                                          "Register could not be searched",
                                        ].map((q) => (
                                          <button
                                            key={q} type="button"
                                            onClick={() => setRows((prev) => prev.map((r) =>
                                              r.id === row.id ? { ...r, result: q } : r))}
                                            className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                                          >
                                            {q}
                                          </button>
                                        ))}
                                      </div>
                                      {rowError && (
                                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                                          <AlertTriangle
                                            aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                                          {rowError.message}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                                <Button
                                  type="button" variant="ghost" size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={open}
                                >
                                  <ArrowUpRight aria-hidden className="mr-1 h-3 w-3" />
                                  Open again / search another name
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  </ol>
                </div>
                ))}


                {/*
                  A general web search is not a register, and the list used to
                  end with two search-engine rows sitting beside DFAT as though
                  they were peers. It stays — AUSTRAC accepts internet research,
                  and it is the only route to a foreign office or a family
                  connection nothing publishes — but it is labelled and last.
                */}
                {searches.some((s) => s.tier === "open_web") && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      A starting point, not a source of record
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {searches.filter((s) => s.tier === "open_web").map((s) => (
                        <Button
                          key={s.id} type="button" variant="ghost" size="sm"
                          className="h-auto justify-start py-1.5 text-left"
                          onClick={() => {
                            window.open(s.url, "_blank", "noopener,noreferrer");
                            setRows((prev) => [...prev, newRow({
                              searchId: s.id,
                              kind: s.kind, source: s.label, reference: s.searchTerms,
                            })]);
                          }}
                        >
                          <ArrowUpRight aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium">{s.label}</span>
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              {s.purpose}
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Everything not bound to a register above: the run's own
                    accepted candidates, a web search, a source typed by hand.
                    Empty is stated rather than left as a gap, because an empty
                    list and a satisfied step look identical when nothing is
                    drawn. */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Other sources you recorded
                    {otherRows.length > 0 && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal">
                        · {otherRows.length}
                      </span>
                    )}
                  </p>
                  {independentCount === 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Nothing checked yet. Open a register above, or add a source by hand —
                      the customer's own declaration is held under step 1 and does not count
                      here.
                    </p>
                  )}
                </div>

                <ul className="space-y-2">
                  {otherRows.map((row) => {
                    /* The error field is indexed against the SUBMITTED methods,
                       which is `rows` — never this filtered view. */
                    const i = rows.indexOf(row);
                    const rowError = verdict.errors.find(
                      (e) => e.field === `methods.${i}` || e.field === `methods.${i}.result`);

                    return (
                      <li
                        key={row.id}
                        className={cn("rounded-md border p-3",
                          rowError ? "border-destructive/50 bg-destructive/5" : "border-border/60")}
                      >
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <div>
                            <Label
                              className="text-[11px] text-muted-foreground"
                              htmlFor={`pep-kind-${row.id}`}
                            >
                              Kind of source
                            </Label>
                            <Select
                              value={row.kind}
                              onValueChange={(v) => setRows((prev) => prev.map((r) =>
                                r.id === row.id ? { ...r, kind: v as PepSourceKind } : r))}
                            >
                              <SelectTrigger
                                id={`pep-kind-${row.id}`} className="mt-1 h-9"
                                aria-label={`Kind of source ${i + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {/* The customer's own declaration is not on
                                    offer here: it is step 1's record, and
                                    choosing it would move a row out of this
                                    list mid-edit. */}
                                {PEP_SOURCE_KINDS
                                  .filter((k) => k !== PEP_DECLARATION_KIND)
                                  .map((k) => (
                                    <SelectItem key={k} value={k}>
                                      {PEP_SOURCE_KIND_LABEL[k]}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label
                              className="text-[11px] text-muted-foreground"
                              htmlFor={`pep-source-${row.id}`}
                            >
                              Source
                            </Label>
                            <Input
                              id={`pep-source-${row.id}`}
                              className="mt-1 h-9" value={row.source}
                              aria-label={`Source ${i + 1}`}
                              placeholder="e.g. Australian Government Directory"
                              onChange={(e) => setRows((prev) => prev.map((r) =>
                                r.id === row.id ? { ...r, source: e.target.value } : r))}
                            />
                          </div>
                          <div>
                            <Label
                              className="text-[11px] text-muted-foreground"
                              htmlFor={`pep-ref-${row.id}`}
                            >
                              Searched / reference
                            </Label>
                            <Input
                              id={`pep-ref-${row.id}`}
                              className="mt-1 h-9" value={row.reference}
                              aria-label={`Searched or reference ${i + 1}`}
                              placeholder="names or terms searched, or a record reference"
                              onChange={(e) => setRows((prev) => prev.map((r) =>
                                r.id === row.id ? { ...r, reference: e.target.value } : r))}
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button" size="icon" variant="ghost" className="h-9 w-9"
                              aria-label={`Remove ${row.source || "source"}`}
                              onClick={() => setRows((prev) =>
                                prev.filter((r) => r.id !== row.id))}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2">
                          <Label
                            className="text-[11px] text-muted-foreground"
                            htmlFor={`pep-result-${row.id}`}
                          >
                            What came back
                          </Label>
                          <Input
                            id={`pep-result-${row.id}`}
                            className="mt-1 h-9" value={row.result}
                            aria-label={`What came back ${i + 1}`}
                            placeholder="e.g. no entry found for this name"
                            onChange={(e) => setRows((prev) => prev.map((r) =>
                              r.id === row.id ? { ...r, result: e.target.value } : r))}
                          />
                        </div>
                        {rowError && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                            <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                            {rowError.message}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => setRows((prev) => [...prev, newRow()])}
                >
                  <Plus aria-hidden className="mr-1.5 h-3.5 w-3.5" /> Add a source
                </Button>

                {/* Said every time, beside the searches themselves. */}
                <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Info aria-hidden className="h-3 w-3" /> What these searches do not reach
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {PEP_SEARCH_COVERAGE_GAPS.map((g) => (
                      <li key={g} className="text-xs text-muted-foreground">— {g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* ── 3 · the determination ────────────────────────────────── */}
          <section className="space-y-3">
            <StepHeading
              n={3} done={verdict.ok} title="The determination"
              hint="What you concluded, and why it is reasonable on the sources above."
            />
            <div className="ml-[2.125rem] space-y-3">
              <RadioGroup
                value={outcome ?? ""}
                onValueChange={(v) => setOutcome(v as Outcome)}
                className="grid gap-2"
              >
                <label className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-sm">
                  <RadioGroupItem
                    value="not_pep" className="mt-0.5"
                    aria-label="Not a politically exposed person"
                  />
                  <span>
                    <span className="font-medium">
                      Not a politically exposed person
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Established on reasonable grounds, on the sources recorded above.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-sm">
                  <RadioGroupItem
                    value="pep" className="mt-0.5"
                    aria-label="Politically exposed person"
                  />
                  <span>
                    <span className="font-medium">Politically exposed person</span>
                    <span className="block text-xs text-muted-foreground">
                      Enhanced due diligence and approval requirements follow from the
                      category — the case is not refused.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-md border border-border/60 p-3 text-sm">
                  <RadioGroupItem
                    value="defer" className="mt-0.5"
                    aria-label="Cannot determine yet"
                  />
                  <span>
                    <span className="font-medium">Cannot determine yet</span>
                    <span className="block text-xs text-muted-foreground">
                      Records what is missing and keeps this step open.{" "}
                      <span className="font-medium text-foreground">
                        No determination is written.
                      </span>
                    </span>
                  </span>
                </label>
              </RadioGroup>

              {outcome === "pep" && (
                <div className="grid gap-3 rounded-md border border-border/60 p-3 lg:grid-cols-2">
                  <div>
                    <Label className="text-xs">PEP category</Label>
                    <RadioGroup value={pepType} onValueChange={setPepType} className="mt-1.5 grid gap-1.5">
                      {PEP_TYPES.map((t) => (
                        <label key={t.value} className="flex items-start gap-2 text-sm">
                          <RadioGroupItem
                            value={t.value} className="mt-0.5" aria-label={t.label}
                          />
                          <span>
                            {t.label}
                            <span className="block text-[11px] text-muted-foreground">{t.note}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Who holds the position?</Label>
                      <RadioGroup value={relationship} onValueChange={setRelationship} className="mt-1.5 grid gap-1.5">
                        {RELATIONSHIPS.map((r) => (
                          <label key={r} className="flex items-start gap-2 text-sm">
                            <RadioGroupItem
                              value={r} className="mt-0.5"
                              aria-label={PEP_RELATIONSHIP_LABEL[r]}
                            />
                            <span>{PEP_RELATIONSHIP_LABEL[r]}</span>
                          </label>
                        ))}
                      </RadioGroup>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs" htmlFor="pep-position">
                          Position or office
                        </Label>
                        <Input
                          id="pep-position" className="mt-1 h-9" value={position}
                          onChange={(e) => setPosition(e.target.value)}
                          placeholder="e.g. Member of Parliament"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="pep-jurisdiction">
                          Jurisdiction
                        </Label>
                        <Input
                          id="pep-jurisdiction" className="mt-1 h-9" value={jurisdiction}
                          onChange={(e) => setJurisdiction(e.target.value)}
                          placeholder="e.g. Australia"
                        />
                      </div>
                    </div>
                    {/*
                      Current or former, as an attribute of the determination
                      rather than a softer outcome. Leaving a position does not
                      end the risk: the treatment is a risk assessment, not an
                      expiry date, so this feeds the assessment instead of
                      quietly switching the controls off.
                    */}
                    <div>
                      <Label className="text-xs">Is the position currently held?</Label>
                      <RadioGroup value={currentlyHeld} onValueChange={setCurrentlyHeld} className="mt-1.5 flex gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <RadioGroupItem value="yes" aria-label="Currently held" /> Currently held
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <RadioGroupItem value="no" aria-label="Formerly held" /> Formerly held
                        </label>
                      </RadioGroup>
                      {currentlyHeld === "no" && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          A former office holder remains a risk consideration. The controls
                          are decided by the risk assessment, not by the passage of time.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {outcome === "defer" && (
                <div className="space-y-3 rounded-md border border-border/60 p-3">
                  <div>
                    <Label className="text-xs">Why can it not be determined yet?</Label>
                    {/* A radio group rather than a select: five short reasons,
                        and the next person reading this record is better served
                        by an operator who saw all five than by one who opened a
                        menu and took the first plausible line. */}
                    <RadioGroup
                      value={deferReason} onValueChange={setDeferReason}
                      className="mt-1.5 grid gap-1.5"
                    >
                      {PEP_DEFERRAL_REASONS.map((r) => (
                        <label key={r} className="flex items-start gap-2 text-sm">
                          <RadioGroupItem
                            value={r} className="mt-0.5"
                            aria-label={PEP_DEFERRAL_REASON_LABEL[r]}
                          />
                          <span>{PEP_DEFERRAL_REASON_LABEL[r]}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="pep-needed">
                      What is needed before this can be determined?
                    </Label>
                    <Textarea
                      id="pep-needed" rows={3} className="mt-1" value={needed}
                      onChange={(e) => setNeeded(e.target.value)}
                      placeholder="e.g. the customer's date of birth, to separate them from a
                        same-named office holder"
                    />
                  </div>
                </div>
              )}

              {outcome !== "defer" && (
                <div>
                  <Label className="text-xs" htmlFor="pep-rationale">
                    Why you are satisfied on reasonable grounds
                  </Label>
                  <Textarea
                    id="pep-rationale" rows={3} className="mt-1" value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="The objective test: could somebody in your position, reviewing
                      the same material, reach the same conclusion?"
                  />
                </div>
              )}
            </div>
          </section>
        </div>

        {/* The footer never scrolls, and it says what is missing rather than
            leaving a disabled button to be interpreted. */}
        <div
          data-testid="pep-determination-footer"
          className="flex shrink-0 flex-col gap-2 border-t border-border/60 px-5 py-3
            sm:flex-row sm:items-center sm:justify-between sm:px-6"
        >
          <div className="min-w-0">
            <p
              role="status"
              className={cn("min-w-0 text-xs",
                verdict.ok ? "text-muted-foreground" : "text-destructive")}
            >
              {verdict.ok
                ? (outcome === "defer"
                  ? "No determination will be recorded. Stage 5 stays open on this party."
                  : "Will be recorded against this party, with the sources above.")
                : describeOutstanding(requirements)}
            </p>
            {/*
              ── Everything still needed, not the first thing ──────────
              One error at a time turned a four-item checklist into four
              separate refusals discovered in sequence. This is the same
              information with an order, which is the whole of what was
              missing.

              A `pending` requirement is drawn as pending rather than as
              failing: an unmet requirement is work to do, and a question
              nobody has asked yet is not, and a red cross against the second
              misstates the operator's progress.
            */}
            {!verdict.ok && (
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {requirements.filter((r) => !r.met).map((r) => (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-start gap-1 text-[11px]",
                      r.pending ? "text-muted-foreground" : "text-destructive",
                    )}
                  >
                    <Circle aria-hidden className="mt-[3px] h-2 w-2 shrink-0" />
                    <span>
                      {r.label}
                      <span className="text-muted-foreground"> · step {r.step}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* "1 source" used to be the customer's own declaration, on a
                dialog where nothing had been checked. The badge counts what
                was checked; the declaration is named in step 1. */}
            {outcome !== "defer" && independentCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {independentCount} checked
              </Badge>
            )}

            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !verdict.ok}>
              {busy
                ? <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />
                : <ClipboardCheck aria-hidden className="mr-1.5 h-4 w-4" />}
              {outcome === "defer" ? "Record what is needed" : "Record determination"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

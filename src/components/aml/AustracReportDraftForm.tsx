/**
 * The AUSTRAC report draft — the form itself, lifted out of the modal.
 *
 * ── Why this is a component and not a dialog body ─────────────────────
 * It was a dialog: a fixed box over a darkened page that could not be
 * deep-linked, could not be returned to with the back button, and closed on
 * an outside click or the Escape key with whatever had been typed in it.
 * Drafting a report to a regulator is the longest single piece of writing
 * anyone does in this product, so it now has a URL of its own and this is
 * what that page draws.
 *
 * Nothing about WHAT is asked changed in the move, and nothing about what
 * saves a draft changed either — a kind and a title, exactly as before,
 * because a Suspicious Matter Report is often started the minute the
 * suspicion forms and finished an hour later. What the page adds is room:
 * the narrative is a tall box rather than a scrap, and the reference beside
 * it does not compete with the form for a modal's worth of height.
 */
import { CalendarClock, Check, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AustracDraftGuidancePanel, AustracTippingOffNotice,
} from "@/components/aml/AustracDraftGuidancePanel";
import { AustracCustomerPicker } from "@/components/aml/AustracCustomerPicker";
import { AUSTRAC_OBLIGATIONS, isCustomerReport } from "@/lib/aml/austracReportPath.pure";
import {
  AUSTRAC_KIND_LABEL, KIND_GUIDANCE, draftClock, draftSections, narrativeSkeleton,
  toObligationKind, type DraftFacts, type DraftSection,
} from "@/lib/aml/austracDraftGuidance.pure";
import { displayDateTime } from "@/lib/aml/displayDate";
import type { AmlReport, AmlReportKind } from "@/lib/aml/amlReportingApi";

/** The customers a report can be filed against. */
export interface DraftCaseOption {
  id: string;
  subject_display_name: string;
  case_reference: string;
}

/**
 * One numbered section of the draft.
 *
 * The form is in four parts and deliberately NOT a wizard: gating the fields
 * behind one another would make the obligation harder to meet rather than
 * easier. What the numbering adds is where the operator is, why they are
 * being asked, and what is still owed.
 */
function DraftStep({ section, children }: { section: DraftSection; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`draft-step-${section.key}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold "
            + (section.state === "complete"
              ? "bg-success/15 text-success"
              : section.state === "optional"
                ? "bg-muted text-muted-foreground"
                : "bg-primary/15 text-primary")
          }
        >
          {section.state === "complete" ? <Check className="h-4 w-4" /> : section.n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`draft-step-${section.key}`} className="text-base font-semibold leading-tight text-foreground">
            {section.title}
            {section.state === "optional" && (
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                optional
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.purpose}</p>
        </div>
      </div>
      <div className="space-y-4 pl-10">{children}</div>
    </section>
  );
}

export function AustracReportDraftForm({
  draft, onChange, cases, casesFailed, showPath = true,
}: {
  draft: Partial<AmlReport>;
  onChange: (next: (d: Partial<AmlReport>) => Partial<AmlReport>) => void;
  cases: DraftCaseOption[];
  /** The case list could not be read — a draft can still be written. */
  casesFailed?: boolean;
  /**
   * Draw the six-step orientation list in the reference panel.
   *
   * False where the live path card is already on the page: two renderings
   * of the same path on one screen is how they come to disagree about which
   * step is open.
   */
  showPath?: boolean;
}) {
  const obligationAt = (draft.metadata as Record<string, unknown> | undefined)?.obligation_at ?? null;

  const facts: DraftFacts = {
    kind: draft.kind ?? null,
    caseId: draft.case_id ?? null,
    title: draft.title ?? null,
    narrative: draft.narrative ?? null,
    obligationAt: obligationAt ? String(obligationAt) : null,
    terrorismFinancing: (draft.metadata as Record<string, unknown> | undefined)?.terrorism_financing === true,
    periodStart: draft.reporting_period_start ?? null,
    periodEnd: draft.reporting_period_end ?? null,
  };

  /**
   * `reports.kind` accepts five values and the obligation table is keyed by
   * four — `compliance` and `annual` are one obligation under two spellings.
   * Reading the table with the raw column value returns `undefined` and
   * throws on the next property access, so every read goes through the one
   * translation and a kind it cannot place renders no clock at all.
   */
  const kind = toObligationKind(draft.kind ?? null);
  const obligation = kind ? AUSTRAC_OBLIGATIONS[kind] : null;
  const sections = draftSections(facts);
  const deadline = draftClock(facts);
  const narrativeIsEmpty = (draft.narrative ?? "").trim().length === 0;

  return (
    <div className="space-y-5">
      {kind && <AustracTippingOffNotice kind={kind} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-8">
          <DraftStep section={sections[0]}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="draft-kind">Kind of report</Label>
                <Select
                  value={String(draft.kind ?? "smr")}
                  onValueChange={(v) => onChange((d) => ({ ...d, kind: v as AmlReportKind }))}
                >
                  <SelectTrigger id="draft-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUSTRAC_KIND_LABEL).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{k.toUpperCase()} — {l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draft-ref">Your reference code</Label>
                <Input
                  id="draft-ref"
                  value={draft.reference_code ?? ""}
                  onChange={(e) => onChange((d) => ({ ...d, reference_code: e.target.value }))}
                  placeholder="Optional — your own file reference"
                />
              </div>
            </div>

            {/*
              ── What starts the statutory clock ─────────────────────────
              An SMR is due 3 business days after the suspicion was FORMED
              (24 hours where it concerns terrorism financing); a TTR and an
              IFTI 10 business days after the transaction or instruction.
              None of those is the reporting period, so the date is asked for
              separately and kept in `metadata` — a deadline derived from the
              wrong date is worse than no deadline at all.
            */}
            {obligation && obligation.businessDays !== null && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="draft-obligation-at">Obligation arose</Label>
                  <Input
                    id="draft-obligation-at"
                    type="datetime-local"
                    value={obligationAt ? String(obligationAt).slice(0, 16) : ""}
                    onChange={(e) => onChange((d) => ({
                      ...d,
                      metadata: {
                        ...(d.metadata ?? {}),
                        obligation_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      },
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {obligation.clockStarts.replace(/^the /, "The ")} — this is what the deadline is
                    counted from, and it is not the reporting period.
                  </p>
                </div>
                {kind === "smr" && (
                  <div className="flex items-start gap-2.5 sm:pt-7">
                    <Checkbox
                      id="draft-tf"
                      checked={Boolean((draft.metadata as Record<string, unknown> | undefined)?.terrorism_financing)}
                      onCheckedChange={(v) => onChange((d) => ({
                        ...d,
                        metadata: { ...(d.metadata ?? {}), terrorism_financing: v === true },
                      }))}
                    />
                    <Label htmlFor="draft-tf" className="text-sm font-normal leading-snug">
                      The suspicion concerns terrorism financing
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Tightens the deadline from 3 business days to 24 hours.
                      </span>
                    </Label>
                  </div>
                )}
              </div>
            )}

            {/* The deadline the answers above produce, while they are typed. */}
            {deadline?.dueAt && (
              <div
                className={
                  "flex items-start gap-2.5 rounded-md border p-3 "
                  + (deadline.overdue
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-primary/30 bg-primary/5")
                }
              >
                <CalendarClock
                  aria-hidden
                  className={"mt-0.5 h-4 w-4 shrink-0 " + (deadline.overdue ? "text-destructive" : "text-primary")}
                />
                <p className="text-xs leading-relaxed text-foreground/90">
                  <strong className="font-semibold">
                    {deadline.overdue ? "This report is already past its window." : "Due"}
                  </strong>{" "}
                  {displayDateTime(deadline.dueAt)} — {deadline.window} ({deadline.basis}).
                  {deadline.overdue
                    ? " Lodge it and record why it was late; a late report is still a report, and the lateness is itself a matter of record."
                    : ""}
                </p>
              </div>
            )}
          </DraftStep>

          {/*
            ── Which customer this is about ────────────────────────────
            The field the dialog never had. Without it the report is filed
            against nobody: it does not reach the customer's compliance file,
            does not appear on their case timeline, and cannot be found from
            their record. The server has always written the case event when
            given a case; it was never given one.
          */}
          <DraftStep section={sections[1]}>
            {kind && !isCustomerReport(kind) ? (
              <p className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                Nothing to link. An annual compliance report accounts for the reporting entity's own
                programme, so it is not filed against a customer. A matter about an individual customer
                belongs in a suspicious matter, threshold transaction or international transfer report
                instead.
              </p>
            ) : (
              <div className="max-w-xl space-y-1.5">
                <Label htmlFor="draft-case">Customer</Label>
                <AustracCustomerPicker
                  id="draft-case"
                  cases={cases}
                  value={draft.case_id ?? null}
                  onChange={(caseId) => onChange((d) => ({ ...d, case_id: caseId }))}
                />
                <p className="text-xs text-muted-foreground">
                  Type part of the name, or the Passport reference — with or without its hyphens.
                </p>
                {casesFailed && (
                  <p className="text-xs text-warning">
                    The compliance cases could not be listed. The draft can still be saved and the
                    customer linked afterwards.
                  </p>
                )}
              </div>
            )}
          </DraftStep>

          <DraftStep section={sections[2]}>
            <div className="max-w-2xl space-y-1.5">
              <Label htmlFor="draft-title">Title</Label>
              <Input
                id="draft-title"
                value={draft.title ?? ""}
                onChange={(e) => onChange((d) => ({ ...d, title: e.target.value }))}
                placeholder="A short description of the matter"
              />
            </div>
            <div className="space-y-1.5">
              {/*
                One label, above the box, with room between them.
                It used to share a `flex items-end` row with a character
                counter: the counter made the row taller, `items-end` dropped
                the label to the row's foot, and `leading-none` left its
                descenders sitting on the textarea's own border. There is no
                counter now, so there is no row.
              */}
              <Label htmlFor="draft-narrative">Narrative</Label>
              <Textarea
                id="draft-narrative"
                rows={18}
                className="min-h-[22rem] leading-relaxed"
                value={draft.narrative ?? ""}
                onChange={(e) => onChange((d) => ({ ...d, narrative: e.target.value }))}
                placeholder="Set out the facts in plain language, in the order they happened."
              />
              {/*
                Offered only into a narrative that is empty, and it inserts
                the QUESTIONS rather than any answer — nothing it produces can
                reach a lodged report as an assertion nobody made.
              */}
              {kind && narrativeIsEmpty && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => onChange((d) => ({ ...d, narrative: narrativeSkeleton(kind) }))}
                >
                  <ListChecks className="mr-2 h-3.5 w-3.5" /> Start from the questions to answer
                </Button>
              )}
              {kind && (
                <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    A narrative AUSTRAC can act on answers
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {KIND_GUIDANCE[kind].narrativeAsks.map((q) => (
                      <li key={q} className="text-xs leading-relaxed text-muted-foreground">• {q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DraftStep>

          <DraftStep section={sections[3]}>
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="draft-period-start">Period start</Label>
                <Input
                  id="draft-period-start"
                  type="datetime-local"
                  value={draft.reporting_period_start ? String(draft.reporting_period_start).slice(0, 16) : ""}
                  onChange={(e) => onChange((d) => ({
                    ...d,
                    reporting_period_start: e.target.value ? new Date(e.target.value).toISOString() : null,
                  }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draft-period-end">Period end</Label>
                <Input
                  id="draft-period-end"
                  type="datetime-local"
                  value={draft.reporting_period_end ? String(draft.reporting_period_end).slice(0, 16) : ""}
                  onChange={(e) => onChange((d) => ({
                    ...d,
                    reporting_period_end: e.target.value ? new Date(e.target.value).toISOString() : null,
                  }))}
                />
              </div>
            </div>
          </DraftStep>
        </div>

        {/*
          The reference travels with the form on a wide screen and follows it
          on a narrow one. It is sticky here in a way it could not be inside a
          modal's own scroll box: the narrative is tall, and the reasons for
          the report are worth having in view while it is written.
        */}
        {kind && (
          <div className="xl:sticky xl:top-4 xl:self-start">
            <AustracDraftGuidancePanel
              kind={kind}
              caseId={draft.case_id ?? null}
              title={draft.title ?? null}
              narrative={draft.narrative ?? null}
              showPath={showPath}
            />
          </div>
        )}
      </div>
    </div>
  );
}

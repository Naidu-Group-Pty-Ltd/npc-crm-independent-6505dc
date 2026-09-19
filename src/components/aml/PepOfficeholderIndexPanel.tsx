/**
 * The office-holder index, inside the determination.
 *
 * ── What this renders, and the one thing it must never render ─────────
 * A HIT is a candidate. A MISS is nothing.
 *
 * Every reading this panel can show carries the index's own COVERAGE
 * underneath it — what the sources hold, what they do not, how many entries
 * loaded and when. That is not a courtesy: the dangerous reading is the empty
 * one, and an empty result with nothing beside it is indistinguishable from
 * "this person is not an office holder". This platform has already shipped
 * that shape once, with a sanctions table that was empty from the day it was
 * built.
 *
 * So there is no "no match" badge, no tick, and no green anywhere in the
 * empty state. An index that has never loaded — or whose last load failed —
 * says it is UNAVAILABLE rather than empty, because it has not looked.
 *
 * ── A candidate becomes a source only through the operator ────────────
 * "Record this" prefills the source row with the office and the identity the
 * index holds, and leaves `result` EMPTY. The operator confirms the candidate
 * against the official register and writes what they saw. The platform
 * writing that sentence for them is what would make the record indefensible.
 */
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarClock, Info, Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import {
  assessIndexRecency,
  candidateToMethodDraft,
  describeTenure,
  type PepIndexCandidate, type PepIndexRecency, type PepIndexVerdict,
} from "@/lib/aml/pepOfficeholderIndex";

function CoverageNote({ verdict }: { verdict: PepIndexVerdict }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Info aria-hidden className="h-3 w-3" /> What this index holds
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {verdict.coverage.map((c) => (
          <li key={c.sourceCode} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{c.label}</span>
            {" — "}
            {c.entryCount > 0 && c.lastSyncStatus === "succeeded"
              ? `${c.entryCount.toLocaleString('en-AU')} people`
              : "not loaded"}
            {/* MEASURED, not claimed. A load holding two offices used to read
                identically to one holding seven hundred. */}
            {c.officeCount !== null && ` across ${c.officeCount.toLocaleString('en-AU')} offices`}
            {c.sourceAsAt && `, current to ${c.sourceAsAt}`}.
            <span className="block">Covers {c.covers}</span>
            {c.sampleOffices.length > 0 && (
              <span className="block">
                For example: {c.sampleOffices.slice(0, 6).join("; ")}.
              </span>
            )}
            {/*
              * Coverage against the AML/CTF Rules, MEASURED by the load.
              *
              * "676 offices" is a number about a database. The question an
              * operator has when this returns nothing is whether it had ever
              * looked at judges, or ambassadors, or the Chief of Navy — so the
              * gaps are named first and in the same words the Rules use.
              *
              * A load from before this was measured says so rather than
              * reporting every category as a gap it never tested for.
              */}
            {c.ruleCoverageMeasured && c.ruleCategories.length > 0 && (
              <span className="mt-1 block">
                {(() => {
                  const missing = c.ruleCategories.filter((r) => r.notEvidenced);
                  const held = c.ruleCategories.filter((r) => !r.notEvidenced);
                  return (
                    <>
                      {held.length > 0 && (
                        <span className="block">
                          Holds at least:{" "}
                          {held.map((r) => `${r.label.toLowerCase()} (${r.officeCount})`)
                            .join(", ")}.
                          {c.unclassifiedOffices > 0 && ` A further ${c.unclassifiedOffices} `
                            + "office titles matched no category, so every number here "
                            + "is a floor."}
                        </span>
                      )}
                      {missing.length > 0 && (
                        <span className="block font-medium text-warning">
                          Not evidenced, so check by hand:{" "}
                          {missing.map((r) => r.label.toLowerCase()).join(", ")}.
                        </span>
                      )}
                    </>
                  );
                })()}
              </span>
            )}
            <span className="block font-medium text-foreground">
              Does not cover {c.excludes}
            </span>
            {/*
              * How current it is — a different question from whether it
              * loaded, and the one nothing was asking. A load that succeeded
              * eight months ago passes `indexIsUsable` exactly as this
              * morning's does, and every Parliament row it holds still says
              * the seat is held.
              */}
            {(() => {
              const r = assessIndexRecency(c, Date.now());
              if (r.reading === "fresh" || r.reading === "never") {
                return <span className="block">{r.reason}</span>;
              }
              return (
                <span className={cn(
                  "block font-medium",
                  r.reading === "stale" ? "text-warning" : "text-foreground",
                )}>
                  {r.reason}
                </span>
              );
            })()}
            {c.collaborative && (
              <span className="block">
                Collaboratively edited — a hit here is a lead, and the official
                register is the source.
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateRow({ c, onRecord, recencyFor }: {
  c: PepIndexCandidate;
  onRecord: (c: PepIndexCandidate) => void;
  /** How current the register this candidate came from is. */
  recencyFor: (sourceCode: string) => PepIndexRecency;
}) {
  const span = [c.positionStart, c.positionEnd].filter(Boolean).join(" – ");
  return (
    <li className="rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{c.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {c.positionTitle}
            {c.jurisdiction ? ` · ${c.jurisdiction}` : ""}
            {span ? ` · ${span}` : ""}
          </p>
          {c.aliases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Also recorded as {c.aliases.slice(0, 4).join(", ")}
            </p>
          )}
          {/*
            * The date of birth, in words.
            *
            * This is the only thing on the card that can tell this person
            * apart from somebody who merely shares their name — and it is
            * shown rather than acted on. It did not decide that this
            * candidate is here: the threshold reads the name score alone,
            * and a date that disagrees never removes a lead.
            *
            * `corroborates` styles it and nothing more. A disagreement is
            * muted, not struck through or coloured as a rejection, because
            * the registers disagree with each other and with official
            * records often enough that a date is a reason to look harder.
            */}
          {c.dob?.sentence && (
            <p className={cn(
              "mt-1 flex items-start gap-1 text-[11px]",
              c.dob.corroborates ? "text-foreground" : "text-muted-foreground",
            )}>
              <CalendarClock aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{c.dob.sentence}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/*
            * Held AS AT a date, never the bare word "Current".
            *
            * Every row from the Parliament register carries
            * `currently_held: true` by construction — the files are a
            * snapshot of who sits on the day they are downloaded. That is
            * accurate at the load and decays from then on, so a member who
            * lost their seat reads as "Current" for as long as nothing
            * reloads. The date is what makes the claim checkable, and it
            * travels into the evidence record the same way.
            */}
          <Badge variant="outline" className="text-[10px]">
            {describeTenure(c.currentlyHeld, recencyFor(c.sourceCode))}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {Math.round(c.score * 100)}% name match
          </Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {c.confirmUrl && (
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => window.open(c.confirmUrl!, "_blank", "noopener,noreferrer")}
          >
            <ArrowUpRight aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            Open to confirm
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => onRecord(c)}>
          Record this as a source
        </Button>
      </div>
    </li>
  );
}

export function PepOfficeholderIndexPanel({ caseId, subjectId, onAddSource }: {
  caseId: string;
  subjectId: string;
  /** Adds a source row. `result` arrives empty, on purpose. */
  onAddSource: (draft: { kind: string; source: string; reference: string; result: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<PepIndexVerdict | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const res = await amlCasesApi.searchPepOfficeholders({
        case_id: caseId, party_screening_subject_id: subjectId,
      });
      setVerdict(res as PepIndexVerdict);
    } catch (e: unknown) {
      // A failure is a technical condition and is shown as one. Reporting it
      // as "nothing found" is how an error becomes an outcome.
      setVerdict(null);
      toast({
        title: "The index could not be searched",
        description: e instanceof Error ? e.message : "The server refused the search.",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Search the office-holder index</p>
          <p className="text-[11px] text-muted-foreground">
            A shortcut to the public registers, held locally. It can surface a
            candidate; it can never clear anybody.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
          {busy
            ? <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            : <Search aria-hidden className="mr-1.5 h-3.5 w-3.5" />}
          Search
        </Button>
      </div>

      {verdict && (
        <div className="mt-3 space-y-3">
          <p
            role="status"
            className={cn(
              "flex items-start gap-1.5 text-xs",
              verdict.reading === "candidates" ? "text-warning"
                : verdict.reading === "unavailable" ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            {verdict.reading !== "no_candidates" && (
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {verdict.message}
          </p>

          {verdict.candidates.length > 0 && (
            <ul className="space-y-2">
              {verdict.candidates.map((c) => (
                <CandidateRow
                  key={`${c.sourceCode}:${c.externalId}`} c={c}
                  onRecord={(cand) => onAddSource(candidateToMethodDraft(cand))}
                  recencyFor={(code) => assessIndexRecency(
                    verdict.coverage.find((v) => v.sourceCode === code)
                      /*
                       * A candidate whose register is not in the coverage
                       * list is a state that should not arise, and if it
                       * does the answer is "never loaded" rather than a
                       * confident date. An invented as-at is worse than
                       * none: it is the claim, not the gap, that misleads.
                       */
                      ?? { sourceCode: code, label: code, covers: "", excludes: "",
                           collaborative: true, entryCount: 0, officeCount: null,
                           sampleOffices: [], ruleCategories: [],
                           ruleCoverageMeasured: false, unclassifiedOffices: 0,
                           sourceAsAt: null, lastSyncedAt: null, lastSyncStatus: "never" },
                    Date.now(),
                  )}
                />
              ))}
            </ul>
          )}

          {/* Rendered under EVERY reading, including — especially — the
              empty one. */}
          <CoverageNote verdict={verdict} />
        </div>
      )}
    </div>
  );
}

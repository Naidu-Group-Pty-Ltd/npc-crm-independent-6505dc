/**
 * What the loaded registers do NOT evidence, named on the step that needs it.
 *
 * ── Why this is here and not only in the index panel ──────────────────
 * The loader has measured coverage against the AML/CTF Rule categories since
 * the index gained a second register: judiciary, vice-regal, Defence,
 * diplomatic, heads of local government, and the rest. It renders inside the
 * office-holder search panel, two clicks from where the determination is
 * actually made.
 *
 * The measurement's whole value is the answer to one question an operator has
 * at exactly this moment: **when the run came back with nothing, what had it
 * never looked at?** That belongs beside the manual checks, because the answer
 * IS the manual checks.
 *
 * ── What it may say ───────────────────────────────────────────────────
 * It describes registers, never a person. A category with nothing recognised
 * reads as NOT EVIDENCED rather than "not covered": an office title the
 * classifier does not recognise is indistinguishable from one that is absent,
 * so the honest statement is that this index cannot show it looked.
 *
 * Counts are floors and say so. A coverage line that overstates is worse than
 * none — it tells an operator an absence means more than it does, which is the
 * failure this index has already had once.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import type { PepIndexCoverage } from "@/lib/aml/pepOfficeholderIndex";
import type { PepRuleCoverage } from "@/lib/aml/pepRuleCoverage";

type State =
  | { kind: "loading" }
  | { kind: "unreadable" }
  | { kind: "read"; coverage: PepIndexCoverage[] };

/**
 * A category is evidenced if ANY loaded register evidences it.
 *
 * Per-register would list "judiciary" as a gap against the Parliament files,
 * which is true and useless: nobody expects a register of seats to hold
 * judges, and the index as a whole does hold 26 judicial offices.
 */
function gapsAcrossRegisters(coverage: PepIndexCoverage[]): PepRuleCoverage[] {
  const measured = coverage.filter((c) => c.ruleCoverageMeasured);
  if (measured.length === 0) return [];
  const byCode = new Map<string, PepRuleCoverage>();
  for (const reg of measured) {
    for (const cat of reg.ruleCategories) {
      const seen = byCode.get(cat.code);
      if (!seen || (seen.notEvidenced && !cat.notEvidenced)) byCode.set(cat.code, cat);
    }
  }
  return [...byCode.values()].filter((c) => c.notEvidenced);
}

export function PepCoverageGaps({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await amlCasesApi.pepOfficeholderIndexStatus();
        if (live) setState({ kind: "read", coverage: res?.coverage ?? [] });
      } catch {
        // Unknown is not empty. An index whose state could not be read must
        // never render as an index that covers nothing.
        if (live) setState({ kind: "unreadable" });
      }
    })();
    return () => { live = false; };
  }, []);

  if (state.kind === "loading") {
    return (
      <p className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        Checking what the registers cover…
      </p>
    );
  }

  if (state.kind === "unreadable") {
    return (
      <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
        <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        What the registers cover could not be read. Work through the sources
        below as you would for a category nothing is known about.
      </p>
    );
  }

  const gaps = gapsAcrossRegisters(state.coverage);
  /*
   * Nothing measured is NOT "no gaps". A load from before coverage was
   * measured has not been tested for any category, and rendering that as a
   * clean bill is the empty-register failure in miniature.
   */
  const measured = state.coverage.some((c) => c.ruleCoverageMeasured);
  if (!measured) {
    return (
      <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
        <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        The loaded registers have not been measured against the Rule
        categories, so what they leave out is not known from here.
      </p>
    );
  }
  if (gaps.length === 0) return null;

  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] text-muted-foreground", className)}>
      <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        <span className="font-medium text-foreground">
          No register the platform holds evidences{" "}
          {gaps.map((g) => g.label.toLowerCase()).join(", ")}.
        </span>{" "}
        The run cannot have checked{" "}
        {gaps.length === 1 ? "that category" : "those categories"} for this
        party — if any of them could apply, check by hand and record what came
        back.
      </span>
    </p>
  );
}

/**
 * What the office-holder index holds, said on the step itself.
 *
 * ── Why this is not inside the dialog ─────────────────────────────────
 * It was. The coverage was reachable only as a side-effect of running a
 * search, which means an operator learned whether the index was loaded
 * AFTER they had already leaned on it — and the reading that matters most
 * is the one they get before.
 *
 * It also made a whole working integration invisible: the index loaded,
 * the endpoint answered, and Stage 5 looked exactly as it had the day
 * before, because every sign of it was two clicks deep.
 *
 * ── What it may and may not say ───────────────────────────────────────
 * The same rule as everywhere else here: this describes a TOOL, never a
 * subject. It reports how many people and offices are loaded and how
 * current they are. It says nothing about the party being determined, and
 * an index in perfect health is not evidence about anybody.
 *
 * An index that has not loaded says so plainly and does not hide the step:
 * the determination is made from the sources an operator checks, and this
 * only saves them typing.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Database, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import { indexIsUsable, type PepIndexCoverage } from "@/lib/aml/pepOfficeholderIndex";

type State =
  | { kind: "loading" }
  | { kind: "unreadable" }
  | { kind: "read"; coverage: PepIndexCoverage[]; usable: boolean };

export function PepIndexReadiness({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await amlCasesApi.pepOfficeholderIndexStatus();
        if (!live) return;
        const coverage = res?.coverage ?? [];
        setState({ kind: "read", coverage, usable: indexIsUsable(coverage) });
      } catch {
        // Unknown is not empty. An index whose state could not be read must
        // never render as an index holding nothing.
        if (live) setState({ kind: "unreadable" });
      }
    })();
    return () => { live = false; };
  }, []);

  if (state.kind === "loading") {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        Checking the office-holder index…
      </p>
    );
  }

  if (state.kind === "unreadable") {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
        <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        The office-holder index state could not be read. The determination is
        unaffected — it is made from the sources you check.
      </p>
    );
  }

  const loaded = state.coverage.filter(
    (c) => c.entryCount > 0 && c.lastSyncStatus === "succeeded");
  /*
   * Each register is reported on its own terms, and their entry counts are
   * NEVER added together.
   *
   * The two sources overlap heavily — every sitting member of the federal
   * Parliament is in both — so a sum is a count of ROWS presented as a count
   * of PEOPLE. That is the same overstatement this index already shipped
   * once, when a load holding two offices read identically to one holding
   * seven hundred, and the lesson recorded then was that anything countable
   * is measured per load and rendered from the load.
   */
  const asAt = loaded.map((c) => c.sourceAsAt).filter(Boolean).sort().reverse()[0] ?? null;
  const describe = (c: PepIndexCoverage) =>
    `${c.label} — ${c.entryCount.toLocaleString('en-AU')} people`
    + (c.officeCount ? ` across ${c.officeCount.toLocaleString('en-AU')} offices` : "");

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        state.usable ? "text-muted-foreground" : "text-warning",
        className,
      )}
    >
      {state.usable
        ? <Database aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
        : <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
      {state.usable ? (
        <span>
          <span className="font-medium text-foreground">
            Office-holder index ready
          </span>
          {" — "}
          {loaded.map(describe).join("; ")}
          {asAt && `, current to ${asAt}`}. Searched from inside the
          determination. A hit is a candidate to confirm; it never clears
          anybody.
          {/* A register that has NOT loaded is named here rather than
              omitted. An operator reading "index ready" while half of it is
              missing is being told the search reached further than it did. */}
          {state.coverage.length > loaded.length && (
            <span className="block">
              Not loaded, and therefore not searched:{" "}
              {state.coverage.filter((c) => !loaded.includes(c))
                .map((c) => c.label).join("; ")}.
            </span>
          )}
        </span>
      ) : (
        <span>
          <span className="font-medium">Office-holder index not loaded.</span>{" "}
          The public sources still open from inside the determination, and the
          determination is made from what you record.
        </span>
      )}
    </p>
  );
}

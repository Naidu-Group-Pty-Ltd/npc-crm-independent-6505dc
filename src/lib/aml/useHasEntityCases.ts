import { useEffect, useState } from "react";
import { amlCasesApi } from "./amlCasesApi";

/**
 * Does this tenant hold any customer that is not a natural person?
 *
 * ── What it is for ────────────────────────────────────────────────────
 * Beneficial ownership is a question about companies, trusts and SMSFs. An
 * individual purchaser does not carry an ownership structure — the case
 * workspace says exactly that on its own Ownership & Control card — so on a
 * tenant whose customers are all individuals, that tab is not merely unused,
 * it is inapplicable to every case they have.
 *
 * It is also mandatory the day that stops being true. So the navigation asks
 * the data rather than asking somebody to remember: the tab is absent while
 * there is no such case, and returns by itself when the first one is opened.
 *
 * ── Four rules ────────────────────────────────────────────────────────
 *
 * **The server answers it.** A client cannot decide this from a page of
 * results — the first entity case could be the two-hundredth row — so it is a
 * filtered query with `limit: 1` and the total read off the response. One row
 * over the wire, whatever the tenant's size.
 *
 * **A failure never hides the tab.** An error resolves to *present*. Hiding a
 * compliance surface because a read failed is the worse of the two mistakes,
 * and it is a failure this codebase has already shipped once — a flag read
 * that returned `[]` under RLS and told every partner a page did not exist.
 *
 * **It asks once per session, not once per page.** The AML shell mounts on
 * every AML route, and a navigation strip that re-queries on each of them
 * would be a request per click for an answer that changes when a customer
 * type is onboarded. The in-flight promise is shared at module scope, so
 * concurrent mounts join one request rather than starting several.
 *
 * **It is deliberately not react-query.** The shell is mounted by every AML
 * page and by the layout tests; taking a `QueryClientProvider` dependency
 * would make a navigation detail a mounting requirement for all of them.
 *
 * Whether the tab is drawn says nothing about who may open the page —
 * `AmlGuard` and the server decide that exactly as they did before, and the
 * route is reachable either way.
 */
export interface EntityCasePresence {
  /** True when the tab should be drawn. Includes the fail-open case. */
  present: boolean;
  /** False while the first read is in flight — the tab is simply not drawn yet. */
  settled: boolean;
}

/** Shared across mounts so the strip asks once, not once per page. */
let inFlight: Promise<boolean> | null = null;
let resolved: boolean | null = null;

async function readPresence(): Promise<boolean> {
  try {
    const { total } = await amlCasesApi.list({ subject_type: "not_individual", limit: 1 });
    return (total ?? 0) > 0;
  } catch {
    // Fail open. See the header.
    return true;
  }
}

/** Test seam — the module cache would otherwise leak between cases. */
export function __resetEntityCaseCache() {
  inFlight = null;
  resolved = null;
}

export function useHasEntityCases(): EntityCasePresence {
  const [state, setState] = useState<EntityCasePresence>(() =>
    resolved === null
      ? { present: false, settled: false }
      : { present: resolved, settled: true },
  );

  useEffect(() => {
    if (resolved !== null) return;
    let alive = true;
    inFlight ??= readPresence().then((v) => { resolved = v; inFlight = null; return v; });
    inFlight.then((v) => { if (alive) setState({ present: v, settled: true }); });
    return () => { alive = false; };
  }, []);

  return state;
}

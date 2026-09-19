import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BookMarked, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from '@/components/ui/search-input';
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { caseStage } from "@/lib/aml/caseDimensions";
import {
  AmlEmptyState,
  AmlErrorState,
  AmlPageHeader,
  AmlRefreshButton,
  AmlStageBadge,
} from "@/components/aml/primitives";
import { PassportWorkspace } from "@/components/aml/passport/design/PassportWorkspace";
import { cn } from "@/lib/utils";
import { filterCases } from "@/lib/aml/caseSearch.pure";

/**
 * Compliance Passport — the module-level destination.
 *
 * The Passport is the RESULTING RECORD of an AML/CTF case, so the page is a
 * two-part surface: pick a customer on the left, read their Passport on the
 * right. It is deliberately not a second case register — the register owns
 * casework, this page owns the record the casework produced.
 *
 * Performance (§45): the case list is one call, and a Passport projection is
 * fetched only for the customer actually opened. Nothing preloads every
 * passport.
 *
 * Honesty: a customer with no issued attestation shows the derived
 * "Not issued" state rather than an invented one, and issuance stays where
 * it belongs — the MLRO controls inside the case workspace.
 */
export default function AmlPassports() {
  const navigate = useNavigate();
  /* `?case=<id>` — the case workspace's "Preview the digital passport" step
   * lands here on the RIGHT customer, not whoever sorts first. */
  const [searchParams] = useSearchParams();
  const requestedCaseId = searchParams.get("case");
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { cases: rows } = await amlCasesApi.list({ limit: 100 });
      setCases(rows ?? []);
      // The deep-linked case wins on first load — but only when it exists in
      // the list; an unknown id falls back to the first row, never a blank.
      const requested = requestedCaseId && (rows ?? []).some((r) => r.id === requestedCaseId)
        ? requestedCaseId
        : null;
      setSelected((current) => current ?? requested ?? (rows ?? [])[0]?.id ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "The customer list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [requestedCaseId]);

  useEffect(() => { void load(); }, [load]);

  /*
    The matching rule is shared with the AUSTRAC draft's customer picker. A
    customer who can be found on one screen and not on another is how an
    operator concludes a case does not exist — and this filter is where the
    convention started, so it is the one that moved rather than a second one
    that agrees with it.
  */
  const filtered = useMemo(() => filterCases(cases, search), [cases, search]);

  const selectedCase = cases.find((c) => c.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <AmlPageHeader
        title="Compliance Passport"
        description="The verified compliance record produced by each customer's AML/CTF journey — issued versions, evidence, stamps and partner reliance."
        icon={BookMarked}
        actions={<AmlRefreshButton onClick={() => void load()} loading={loading} />}
      />

      {error && <AmlErrorState message={error} onRetry={() => void load()} />}

      {!error && (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
          {/* ── customers ─────────────────────────────────────────────── */}
          <Card className="glass-panel lg:sticky lg:top-4 lg:self-start">
            <CardContent className="space-y-3 py-4">
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search customers"
                aria-label="Search customers"
                iconClassName="left-2.5 h-3.5 w-3.5"
              />

              {loading && (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading customers…
                </div>
              )}

              {!loading && filtered.length === 0 && (
                <p className="py-4 text-sm text-muted-foreground">
                  {cases.length === 0
                    ? "No compliance cases exist yet. A Passport is created by the AML/CTF journey — start a customer's compliance from their client record."
                    : "No customer matches that search."}
                </p>
              )}

              {!loading && filtered.length > 0 && (
                <nav aria-label="Customers with a compliance record" className="flex flex-col gap-1">
                  {filtered.map((c) => {
                    const active = c.id === selected;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected(c.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-primary/40 bg-primary/10"
                            : "border-transparent hover:border-border/70 hover:bg-muted/50",
                        )}
                      >
                        <div className="truncate text-sm font-medium">
                          {c.subject_display_name || "Unnamed customer"}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {c.case_reference}
                          </span>
                          <AmlStageBadge stage={caseStage(c)} className="text-[10px]" />
                        </div>
                      </button>
                    );
                  })}
                </nav>
              )}
            </CardContent>
          </Card>

          {/* ── the passport ──────────────────────────────────────────── */}
          <div className="min-w-0">
            {!loading && !selectedCase && (
              <AmlEmptyState
                icon={BookMarked}
                title="Select a customer"
                body="Choose a customer to open their Compliance Passport."
              />
            )}

            {selectedCase && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-base font-semibold">{selectedCase.subject_display_name}</h3>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {selectedCase.case_reference}
                  </Badge>
                </div>
                {/* Renders the derived record; shows nothing at all while the
                    server-side aml_passport_command_view flag is off. */}
                <PassportWorkspace
                  key={selectedCase.id}
                  caseId={selectedCase.id}
                  // The bridge back to where the work is done. The page owns
                  // the route; the Passport shell only says when to take it.
                  onOpenCase={(id) => navigate(`/admin/aml/cases/${id}`)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { SearchInput } from '@/components/ui/search-input';
import { Info, ArrowRight, Loader2, Search } from "lucide-react";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { recordLegacyAliasHit } from "@/lib/aml/legacyAliasTelemetry";

/**
 * Legacy alias banner.
 *
 * Rendered at the top of the standalone Verification / Screening / Risk /
 * Finance pages to signal that they are now embedded in the case workspace,
 * and to offer a one-click jump to any recent case with the correct tab
 * pre-selected. The legacy route itself stays fully functional per Phase
 * 1/4 non-destruction rules.
 *
 * Phase 12 additions:
 *  - Optional `tabHint` — deep-links into /admin/aml/cases?open=<id>&tab=<hint>.
 *  - Inline case picker (Popover) with search over recent 25 cases.
 *  - Local `recordLegacyAliasHit` telemetry consumed by the Cutover Console.
 */
export function LegacyAliasBanner({
  label,
  tabHint,
  routePath,
}: {
  label: string;
  tabHint?: string;
  routePath?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [search, setSearch] = useState("");

  const path = routePath ?? (typeof window !== "undefined" ? window.location.pathname : "");

  useEffect(() => {
    if (!path) return;
    recordLegacyAliasHit(path, label);
    // Only record once per mount per path/label pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, label]);

  useEffect(() => {
    if (!open || cases.length > 0) return;
    setLoading(true);
    amlCasesApi
      .list({ limit: 25 })
      .then((res) => setCases(res.cases))
      .catch(() => setCases([]))
      .finally(() => setLoading(false));
  }, [open, cases.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(
      (c) =>
        c.subject_display_name?.toLowerCase().includes(q) ||
        c.case_reference?.toLowerCase().includes(q),
    );
  }, [cases, search]);

  const jump = (id: string) => {
    const params = new URLSearchParams({ open: id });
    if (tabHint) params.set("tab", tabHint);
    setOpen(false);
    navigate(`/admin/aml/cases?${params.toString()}`);
  };

  return (
    <Alert className="border-primary/30 bg-primary/5">
      <Info className="h-4 w-4" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{label} moved into the case workspace</span>
      </AlertTitle>
      <AlertDescription className="text-xs space-y-2">
        <p>
          This page is preserved as a legacy alias. The recommended workflow is
          to open a case from the{" "}
          <Link to="/admin/aml/cases" className="underline font-medium">
            Case register
          </Link>{" "}
          and use the <span className="font-medium">{label}</span> tab there —
          every action stays scoped to a single case_id and hash-chained audit
          trail.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                Jump to a case
                <ArrowRight className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] p-0">
              <div className="p-2 border-b border-border">
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search recent cases…"
                  autoFocus
                  className="h-8 text-xs"
                  iconClassName="left-2 h-3.5 w-3.5"
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1">
                {loading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No cases match.
                  </p>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => jump(c.id)}
                      className="w-full text-left px-3 py-2 hover:bg-accent transition text-xs"
                    >
                      <div className="font-medium truncate">
                        {c.subject_display_name}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {c.case_reference} · {c.subject_type}
                      </div>
                    </button>
                  ))
                )}
              </div>
              {tabHint && (
                <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
                  Will open with the <span className="font-medium">{tabHint}</span> tab active.
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Link
            to="/admin/aml/cases"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Open case register
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}

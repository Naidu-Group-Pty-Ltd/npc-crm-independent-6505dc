import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, FileSearch, Gavel, Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability } from "@/lib/aml/permissions";
import { amlReportingApi, type AmlReportingSummary } from "@/lib/aml/amlReportingApi";

/**
 * AML V3 — Phase 5 (Regulatory & Assurance surfacing).
 *
 * Read-only readiness ribbon summarising the state of AUSTRAC reporting for
 * users who hold `aml.report`. Gated by `aml_v3_regulatory_hub`.
 *
 * Guardrails:
 *  - Tipping-off: only rendered for reporters (aml.report). Never surfaced
 *    to Client Portal or Finance Portal.
 *  - Read-only. No mutations; every write path remains inside AUSTRAC Hub
 *    (`AmlAustracReporting`) where MLRO/step-up gating already runs.
 *  - No new tables, no schema change, no cron.
 */
export function RegulatoryAssuranceHeader() {
  const { roles } = useAmlAccess();
  const [summary, setSummary] = useState<AmlReportingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canReport = hasAmlCapability(roles, "aml.report");

  useEffect(() => {
    if (!canReport) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const s = await amlReportingApi.summary();
        if (alive) setSummary(s);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Unable to load reporting summary");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [canReport]);

  if (!canReport) return null;

  const awaiting = summary?.awaiting_mlro ?? 0;
  const approved = summary?.approved ?? 0;
  const rejected = summary?.rejected ?? 0;
  const submitted = summary?.submitted ?? 0;
  const drafts = summary?.draft ?? 0;

  const attention = awaiting + rejected;
  const tone =
    rejected > 0
      ? "border-destructive/40 bg-destructive/5"
      : awaiting > 0
      ? "border-warning/40 bg-warning/5"
      : "border-success/40 bg-success/5";

  return (
    <Card className={`border ${tone}`} aria-label="Regulatory & Assurance readiness">
      <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-background/70 p-2">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : rejected > 0 ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : awaiting > 0 ? (
              <AlertTriangle className="h-5 w-5 text-warning" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Regulatory & Assurance readiness</div>
            <p className="text-xs text-muted-foreground">
              {error
                ? error
                : loading
                ? "Checking AUSTRAC submission pipeline…"
                : attention > 0
                ? `${attention} report${attention === 1 ? "" : "s"} need MLRO attention before submission.`
                : "AUSTRAC submission pipeline is clear. Continue routine assurance activities."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip label="Drafts" value={drafts} />
              <Chip label="Awaiting MLRO" value={awaiting} tone={awaiting > 0 ? "warning" : "muted"} />
              <Chip label="Approved" value={approved} tone="primary" />
              <Chip label="Submitted" value={submitted} tone="primary" />
              <Chip label="Rejected" value={rejected} tone={rejected > 0 ? "destructive" : "muted"} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/aml/monitoring"><FileSearch className="mr-1.5 h-4 w-4" /> Monitoring</Link>
          </Button>
          {hasAmlCapability(roles, "aml.investigate") && (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/investigations"><ClipboardList className="mr-1.5 h-4 w-4" /> Investigations</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/aml/records"><Gavel className="mr-1.5 h-4 w-4" /> Records</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Chip({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "warning" | "destructive" | "primary";
}) {
  const toneClass =
    tone === "warning"
      ? "bg-warning/15 text-warning border-warning/30"
      : tone === "destructive"
      ? "bg-destructive/15 text-destructive border-destructive/30"
      : tone === "primary"
      ? "bg-primary/10 text-primary border-primary/30"
      : "bg-muted text-muted-foreground border-border/60";
  return (
    <Badge variant="outline" className={`${toneClass} gap-1.5 px-2 py-0.5 text-xs font-medium`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </Badge>
  );
}

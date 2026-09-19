import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Loader2 } from "lucide-react";
import { amlFinanceApi, type AmlLimitedStatus } from "@/lib/aml/amlFinanceApi";
import {
  FINANCE_PORTAL_STATUS_LABELS,
  type AmlFinancePortalStatus,
} from "@/lib/aml/caseDimensions";

const FINANCE_STATUS_TONE: Record<string, string> = {
  not_requested: "bg-muted text-muted-foreground",
  information_required: "bg-warning/15 text-warning",
  submitted: "bg-primary/15 text-primary",
  clarification_required: "bg-warning/15 text-warning",
  under_review: "bg-primary/15 text-primary",
  accepted: "bg-success/15 text-success",
  no_further_action: "bg-muted text-muted-foreground",
};

/**
 * Finance-portal-side AML status pill (Phase 1 finance-safe contract).
 * Purposefully limited: no case detail, no PII, no discrepancy text and no
 * internal risk information. Shows the finance task state + service readiness
 * so brokers know when to act without visibility into restricted material.
 */
interface Props {
  purchaseFileId?: string;
  clientId?: string;
}

export function LimitedAmlStatusCard({ purchaseFileId, clientId }: Props) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AmlLimitedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchaseFileId && !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const s = await amlFinanceApi.limitedStatus({ purchase_file_id: purchaseFileId, client_id: clientId });
        if (!cancelled) setStatus(s);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unable to load AML status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [purchaseFileId, clientId]);

  const financeLabel = status
    ? FINANCE_PORTAL_STATUS_LABELS[status.finance_status as AmlFinancePortalStatus] ??
      status.finance_status.replace(/_/g, " ")
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Compliance readiness</CardTitle>
              <CardDescription className="text-xs">Limited view — compliance team owns the case</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="text-xs text-muted-foreground">Status unavailable</div>
        ) : status ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={FINANCE_STATUS_TONE[status.finance_status] ?? "bg-muted text-muted-foreground"}>
              {financeLabel}
            </Badge>
            <Badge
              variant="outline"
              className={
                status.service_readiness === "service_ready"
                  ? "border-success/40 text-success"
                  : "border-muted-foreground/30 text-muted-foreground"
              }
            >
              {status.service_readiness === "service_ready" ? "Service ready" : "Service not ready"}
            </Badge>
            {typeof status.open_finance_discrepancies === "number" && status.open_finance_discrepancies > 0 && (
              <Badge variant="outline" className="border-warning/40 text-warning">
                {status.open_finance_discrepancies} open discrepancies
              </Badge>
            )}
            {status.updated_at && (
              <span className="text-[11px] text-muted-foreground">
                Updated {new Date(status.updated_at).toLocaleDateString('en-AU')}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No compliance record on file</div>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { useFinancePortalAuth } from "@/hooks/useFinancePortalAuth";
import type { AmlHandoffSnapshot } from "@/lib/aml/amlFinanceApi";

const SEV_TONE: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  low: "bg-primary/15 text-primary",
  medium: "bg-warning/15 text-warning",
  high: "bg-destructive/15 text-destructive",
  critical: "bg-destructive text-destructive-foreground",
};

export default function AmlCaseSnapshot() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AmlHandoffSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await invokeFinanceFunction("aml-finance", {
          op: "redeem_case_handoff",
          token,
        });
        if (err) throw new Error(err.message);
        if (data?.error) throw new Error(data.error);
        if (!cancelled) setSnapshot(data?.snapshot ?? null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unable to load AML snapshot");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">AML/CTF Case Snapshot</CardTitle>
          <CardDescription>
            Read-only, single-use view. Restricted case detail is not shared with the finance portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading snapshot…
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Snapshot unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : snapshot ? (
            <>
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Tipping-off notice</AlertTitle>
                <AlertDescription className="text-xs">{snapshot.tipping_off_notice}</AlertDescription>
              </Alert>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Status: {snapshot.status.replace(/_/g, " ")}</Badge>
                {snapshot.risk_rating && <Badge variant="secondary">Risk: {snapshot.risk_rating}</Badge>}
                {snapshot.updated_at && (
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(snapshot.updated_at).toLocaleString('en-AU')}
                  </span>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Open discrepancies ({snapshot.open_discrepancies.length})</h4>
                {snapshot.open_discrepancies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None open.</p>
                ) : (
                  <ul className="space-y-1">
                    {snapshot.open_discrepancies.map((d, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <Badge className={SEV_TONE[d.severity] ?? "bg-muted text-muted-foreground"}>
                          {d.severity}
                        </Badge>
                        <span>{d.kind.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">· {d.status.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Evidence on file ({snapshot.evidence_summary.length})</h4>
                {snapshot.evidence_summary.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No evidence recorded.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {snapshot.evidence_summary.map((e, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Badge variant="outline">{e.reference_type.replace(/_/g, " ")}</Badge>
                        <span>{e.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {snapshot.finance_comparison && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">Latest finance comparison</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Captured</span><div>{new Date(snapshot.finance_comparison.captured_at).toLocaleString('en-AU')}</div></div>
                    <div><span className="text-muted-foreground">Source</span><div>{snapshot.finance_comparison.source}</div></div>
                    <div><span className="text-muted-foreground">Lender</span><div>{snapshot.finance_comparison.lender ?? "—"}</div></div>
                    <div><span className="text-muted-foreground">LVR</span><div>{snapshot.finance_comparison.lvr ?? "—"}</div></div>
                    <div><span className="text-muted-foreground">Purchase price</span><div>{snapshot.finance_comparison.purchase_price ?? "—"}</div></div>
                    <div><span className="text-muted-foreground">Loan amount</span><div>{snapshot.finance_comparison.loan_amount ?? "—"}</div></div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No snapshot available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

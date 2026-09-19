/**
 * Legacy verification history — read-only, collapsed by default.
 *
 * aml.identity_checks is history: no action here can create, retry or promote
 * a legacy row, and a simulator execution is labelled as what it is rather
 * than shown as a customer failure.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { amlVerificationApi, type IdentityCheck } from "@/lib/aml/amlVerificationApi";
import { displayDateTime } from "@/lib/aml/displayDate";

function legacyLabel(r: IdentityCheck): { label: string; tone: "secondary" | "destructive" | "outline" | "default" } {
  if (r.execution_mode === "simulation" || r.provider === "simulator") {
    return { label: "Test simulation — not compliance evidence", tone: "secondary" };
  }
  if (r.result_payload?.error_category) {
    return { label: `${String(r.result_payload.error_category).replace(/_/g, " ")} — attempt not consumed`, tone: "secondary" };
  }
  switch (r.status) {
    case "verified": return { label: "Verified (legacy)", tone: "default" };
    case "failed": return { label: "Failed (legacy)", tone: "destructive" };
    case "manual_review": return { label: "Manual review (legacy)", tone: "outline" };
    default: return { label: `${r.status} (legacy)`, tone: "outline" };
  }
}

export function LegacyVerificationHistoryPanel({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<IdentityCheck[] | null>(null);

  useEffect(() => {
    if (!open || items) return;
    amlVerificationApi.listIdv(caseId)
      .then((r) => setItems(r.identity_checks))
      .catch(() => setItems([]));
  }, [open, items, caseId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <Button
          variant="ghost" size="sm" className="h-auto justify-start px-0 hover:bg-transparent"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open} aria-controls="legacy-verification-body"
        >
          {open ? <ChevronDown className="mr-1.5 h-4 w-4" /> : <ChevronRight className="mr-1.5 h-4 w-4" />}
          <CardTitle className="text-sm">Legacy verification history</CardTitle>
        </Button>
        <CardDescription>
          Read-only records from the earlier staff/provider workflow. Nothing here can be retried or promoted;
          canonical verification lives in the panel above.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent id="legacy-verification-body" className="pt-0">
          {items === null ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading legacy history" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No legacy verification records for this case.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((r) => {
                const p = legacyLabel(r);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{r.subject_label}</div>
                      <div className="text-xs text-muted-foreground">
                        legacy · {r.provider} · {r.method} · {displayDateTime(r.requested_at)}
                        {r.environment && <> · {r.environment}</>}
                        {r.authoritative === false && <> · non-authoritative</>}
                      </div>
                    </div>
                    <Badge variant={p.tone}>{p.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

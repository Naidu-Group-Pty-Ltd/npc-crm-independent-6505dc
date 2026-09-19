import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Handshake } from "lucide-react";
import { amlRelianceApi, type PartnerQueueEntry } from "@/lib/aml/amlRelianceApi";

/**
 * Compliance Home strip for the partner-domain queues (Phase 8).
 *
 * Fails closed: while aml_partner_operations_reporting is off (or the ops
 * are absent in this environment) the dashboard op answers an error and this
 * renders NOTHING — the Compliance Home is unchanged. When it renders, every
 * count links to /admin/aml/partner-operations with the SAME register filter
 * the count was computed from.
 */
export function PartnerOpsQueueStrip() {
  const [queues, setQueues] = useState<PartnerQueueEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    amlRelianceApi.getPartnerOperationsDashboard()
      .then((d) => { if (!cancelled) setQueues(d.queues ?? []); })
      .catch(() => { if (!cancelled) setQueues(null); });
    return () => { cancelled = true; };
  }, []);

  if (!queues || queues.length === 0) return null;
  const active = queues.filter((q) => q.count > 0);

  return (
    <Card data-testid="partner-ops-queue-strip">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" aria-hidden="true" />
          Partner compliance queues
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting in the partner-domain queues.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {active.map((q) => (
              <li key={q.key}>
                <Link
                  to={`/admin/aml/partner-operations?register=${encodeURIComponent(q.register)}${q.registerStatus ? `&status=${encodeURIComponent(q.registerStatus)}` : ""}`}
                  className="flex items-baseline justify-between gap-2 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40"
                  aria-label={`${q.label}: ${q.count} — open the filtered register`}
                >
                  <span className="text-xs text-muted-foreground">{q.label}</span>
                  <span className={`tabular-nums font-semibold ${
                    q.age === "escalate" ? "text-destructive" : q.age === "warn" ? "text-warning" : "text-foreground"
                  }`}>
                    {q.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
